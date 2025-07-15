import Binance from 'binance-api-node';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { BinanceCredentials, MarketData, OrderBook, OrderBookAnalysis, VolumeAnalysis } from '../../interfaces/trading';
import { logger, TradingLogger } from '../../utils/logger';
import { config } from '../../config/config';
import { fearGreedService } from '../fearGreed/fearGreedService';
import { OrderBookService } from '../orderBook/orderBookService';

export class BinanceService extends EventEmitter {
  private client: any;
  private marketDataClient: any; // For live market data even in testnet
  private ws: WebSocket | NodeJS.Timeout | null = null;
  private credentials: BinanceCredentials;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 5000;
  private orderBookService: OrderBookService | null = null;
  private currentMarketData: MarketData | null = null;

  constructor(credentials: BinanceCredentials) {
    super();
    this.credentials = credentials;
    this.initializeClient();
  }

  private initializeClient(): void {
    try {
      // Trading client (respects testnet setting)
      this.client = Binance({
        apiKey: this.credentials.apiKey,
        apiSecret: this.credentials.apiSecret,
        ...(this.credentials.testnet && { 
          httpBase: 'https://testnet.binance.vision',
          wsBase: 'wss://testnet.binance.vision'
        })
      });

      // Market data client (always live for real-time price feeds)
      this.marketDataClient = Binance({
        apiKey: this.credentials.apiKey,
        apiSecret: this.credentials.apiSecret
        // No testnet override - always use live market data
      });

      logger.info(`Binance clients initialized - Trading: ${this.credentials.testnet ? 'TESTNET' : 'LIVE'}, Market Data: LIVE`);
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'BinanceService.initializeClient' });
      throw new Error('Failed to initialize Binance client');
    }
  }

  async validateConnection(): Promise<boolean> {
    try {
      await this.client.ping();
      const accountInfo = await this.client.accountInfo();
      logger.info('Binance connection validated successfully', {
        canTrade: accountInfo.canTrade,
        balances: accountInfo.balances.filter((b: any) => parseFloat(b.free) > 0).length
      });
      return true;
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'BinanceService.validateConnection' });
      return false;
    }
  }

  async getAccountBalance(asset: string = 'USDT'): Promise<number> {
    try {
      const accountInfo = await this.client.accountInfo();
      const balance = accountInfo.balances.find((b: any) => b.asset === asset);
      return balance ? parseFloat(balance.free) : 0;
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'BinanceService.getAccountBalance' });
      throw new Error('Failed to get account balance');
    }
  }

  async getCurrentPrice(symbol: string): Promise<number> {
    try {
      const ticker = await this.client.prices({ symbol });
      return parseFloat(ticker[symbol]);
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'BinanceService.getCurrentPrice' });
      throw new Error('Failed to get current price');
    }
  }

  async get24hrStats(symbol: string): Promise<MarketData> {
    try {
      const stats = await this.client.dailyStats({ symbol });
      return {
        symbol,
        price: parseFloat(stats.lastPrice),
        timestamp: Date.now(),
        volume: parseFloat(stats.volume),
        change24h: parseFloat(stats.priceChangePercent),
        high24h: parseFloat(stats.highPrice),
        low24h: parseFloat(stats.lowPrice)
      };
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'BinanceService.get24hrStats' });
      throw new Error('Failed to get 24hr stats');
    }
  }

  async getHistoricalData(symbol: string, interval: string = '1m', limit: number = 100): Promise<any[]> {
    try {
      const candles = await this.client.candles({
        symbol,
        interval,
        limit
      });
      
      return candles.map((candle: any) => ({
        timestamp: candle.openTime,
        open: parseFloat(candle.open),
        high: parseFloat(candle.high),
        low: parseFloat(candle.low),
        close: parseFloat(candle.close),
        volume: parseFloat(candle.volume)
      }));
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'BinanceService.getHistoricalData' });
      throw new Error('Failed to get historical data');
    }
  }

  private symbolInfoCache: Map<string, any> = new Map();

  private async getSymbolInfo(symbol: string): Promise<any> {
    if (this.symbolInfoCache.has(symbol)) {
      return this.symbolInfoCache.get(symbol);
    }

    try {
      const exchangeInfo = await this.client.exchangeInfo();
      const symbolInfo = exchangeInfo.symbols.find((s: any) => s.symbol === symbol);
      
      if (symbolInfo) {
        this.symbolInfoCache.set(symbol, symbolInfo);
        return symbolInfo;
      }
      
      throw new Error(`Symbol ${symbol} not found`);
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'BinanceService.getSymbolInfo' });
      throw new Error('Failed to get symbol info');
    }
  }

  private async formatQuantity(symbol: string, quantity: number): Promise<string> {
    try {
      const symbolInfo = await this.getSymbolInfo(symbol);
      const lotSizeFilter = symbolInfo.filters.find((f: any) => f.filterType === 'LOT_SIZE');
      
      if (lotSizeFilter) {
        const stepSize = parseFloat(lotSizeFilter.stepSize);
        const minQty = parseFloat(lotSizeFilter.minQty);
        
        // Adjust quantity to match step size
        const adjustedQty = Math.floor(quantity / stepSize) * stepSize;
        
        if (adjustedQty < minQty) {
          throw new Error(`Quantity ${adjustedQty} is below minimum ${minQty} for ${symbol}`);
        }
        
        // Format to the correct number of decimal places
        const precision = stepSize.toString().split('.')[1]?.length || 0;
        return adjustedQty.toFixed(precision);
      }
      
      // Fallback if no LOT_SIZE filter found
      return quantity.toFixed(6);
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'BinanceService.formatQuantity' });
      throw error;
    }
  }

  async placeMarketOrder(symbol: string, side: 'BUY' | 'SELL', quantity: number): Promise<any> {
    try {
      // Validate inputs
      if (!symbol || !side || !quantity || quantity <= 0) {
        throw new Error(`Invalid order parameters: symbol=${symbol}, side=${side}, quantity=${quantity}`);
      }

      if (isNaN(quantity) || !isFinite(quantity)) {
        throw new Error(`Invalid quantity: ${quantity}`);
      }

      // Format quantity according to symbol's LOT_SIZE filter
      const formattedQuantity = await this.formatQuantity(symbol, quantity);

      const order = await this.client.order({
        symbol,
        side,
        type: 'MARKET',
        quantity: formattedQuantity
      });
      
      // Check for slippage if price data available
      if (order.fills && order.fills.length > 0) {
        const avgFillPrice = order.fills.reduce((sum: number, fill: any) => 
          sum + (parseFloat(fill.price) * parseFloat(fill.qty)), 0) / parseFloat(order.executedQty);
        
        // Log execution details for monitoring
        TradingLogger.logTrade('MARKET_ORDER_FILLED', {
          orderId: order.orderId,
          symbol,
          side,
          requestedQty: quantity,
          executedQty: parseFloat(order.executedQty),
          avgFillPrice,
          status: order.status
        });
      }
      
      TradingLogger.logTrade('MARKET_ORDER_PLACED', {
        orderId: order.orderId,
        symbol,
        side,
        quantity,
        status: order.status
      });
      
      return order;
    } catch (error) {
      TradingLogger.logError(error as Error, { 
        context: 'BinanceService.placeMarketOrder',
        orderDetails: { symbol, side, quantity }
      });
      throw new Error('Failed to place market order');
    }
  }

  private async formatPrice(symbol: string, price: number): Promise<string> {
    try {
      const symbolInfo = await this.getSymbolInfo(symbol);
      const priceFilter = symbolInfo.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
      
      if (priceFilter) {
        const tickSize = parseFloat(priceFilter.tickSize);
        const minPrice = parseFloat(priceFilter.minPrice);
        const maxPrice = parseFloat(priceFilter.maxPrice);
        
        // Adjust price to match tick size
        const adjustedPrice = Math.round(price / tickSize) * tickSize;
        
        if (adjustedPrice < minPrice) {
          throw new Error(`Price ${adjustedPrice} is below minimum ${minPrice} for ${symbol}`);
        }
        
        if (adjustedPrice > maxPrice) {
          throw new Error(`Price ${adjustedPrice} is above maximum ${maxPrice} for ${symbol}`);
        }
        
        // Format to the correct number of decimal places
        const precision = tickSize.toString().split('.')[1]?.length || 0;
        return adjustedPrice.toFixed(precision);
      }
      
      // Fallback if no PRICE_FILTER found
      return price.toFixed(6);
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'BinanceService.formatPrice' });
      throw error;
    }
  }

  async placeStopLossOrder(symbol: string, side: 'BUY' | 'SELL', quantity: number, stopPrice: number): Promise<any> {
    try {
      // Format quantity and price according to symbol filters
      const formattedQuantity = await this.formatQuantity(symbol, quantity);
      const formattedPrice = await this.formatPrice(symbol, stopPrice);

      const order = await this.client.order({
        symbol,
        side,
        type: 'STOP_LOSS_LIMIT',
        quantity: formattedQuantity,
        price: formattedPrice,
        stopPrice: formattedPrice,
        timeInForce: 'GTC'
      });
      
      TradingLogger.logTrade('STOP_LOSS_ORDER_PLACED', {
        orderId: order.orderId,
        symbol,
        side,
        quantity,
        stopPrice,
        status: order.status
      });
      
      return order;
    } catch (error) {
      TradingLogger.logError(error as Error, { 
        context: 'BinanceService.placeStopLossOrder',
        orderDetails: { symbol, side, quantity, stopPrice }
      });
      throw new Error('Failed to place stop loss order');
    }
  }

  async placeTakeProfitOrder(symbol: string, side: 'BUY' | 'SELL', quantity: number, targetPrice: number): Promise<any> {
    try {
      // Format quantity and price according to symbol filters
      const formattedQuantity = await this.formatQuantity(symbol, quantity);
      const formattedPrice = await this.formatPrice(symbol, targetPrice);

      const order = await this.client.order({
        symbol,
        side,
        type: 'LIMIT',
        quantity: formattedQuantity,
        price: formattedPrice,
        timeInForce: 'GTC'
      });
      
      TradingLogger.logTrade('TAKE_PROFIT_ORDER_PLACED', {
        orderId: order.orderId,
        symbol,
        side,
        quantity,
        targetPrice,
        status: order.status
      });
      
      return order;
    } catch (error) {
      TradingLogger.logError(error as Error, { 
        context: 'BinanceService.placeTakeProfitOrder',
        orderDetails: { symbol, side, quantity, targetPrice }
      });
      throw new Error('Failed to place take profit order');
    }
  }

  async cancelOrder(symbol: string, orderId: string): Promise<any> {
    try {
      const result = await this.client.cancelOrder({ symbol, orderId });
      TradingLogger.logTrade('ORDER_CANCELLED', { orderId, symbol, status: result.status });
      return result;
    } catch (error) {
      TradingLogger.logError(error as Error, { 
        context: 'BinanceService.cancelOrder',
        orderDetails: { symbol, orderId }
      });
      throw new Error('Failed to cancel order');
    }
  }

  async getOpenOrders(symbol: string): Promise<any[]> {
    try {
      return await this.client.openOrders({ symbol });
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'BinanceService.getOpenOrders' });
      throw new Error('Failed to get open orders');
    }
  }

  private async initializeOrderBookService(symbol: string): Promise<void> {
    try {
      if (this.orderBookService) {
        await this.orderBookService.disconnect();
      }
      
      this.orderBookService = new OrderBookService(symbol);
      
      // Set up event listeners for order book updates
      this.orderBookService.on('orderBookUpdate', (orderBook: OrderBook) => {
        // Update current market data with latest order book
        if (this.currentMarketData) {
          this.currentMarketData.orderBook = orderBook;
        }
      });
      
      this.orderBookService.on('orderBookAnalysis', (analysis: OrderBookAnalysis) => {
        // Update current market data with latest analysis
        if (this.currentMarketData) {
          this.currentMarketData.orderBookAnalysis = analysis;
        }
        // Emit for strategy use
        this.emit('orderBookAnalysis', analysis);
      });
      
      this.orderBookService.on('volumeAnalysis', (volumeAnalysis: VolumeAnalysis) => {
        // Update current market data with latest volume analysis
        if (this.currentMarketData) {
          this.currentMarketData.volumeAnalysis = volumeAnalysis;
        }
        // Emit for strategy use
        this.emit('volumeAnalysis', volumeAnalysis);
      });
      
      // Connect to order book streams
      await this.orderBookService.connect();
      logger.info(`Order book service initialized for ${symbol}`);
      
    } catch (error) {
      logger.error('Failed to initialize order book service', { error, symbol });
    }
  }

  startRealTimeData(symbol: string): void {
    try {
      // HYBRID APPROACH: Use live WebSocket for price data even in testnet mode
      // This gives us real-time market data for better RSI/Bollinger calculations
      // while still using testnet for actual order execution
      
      logger.info(`Starting real-time data stream for ${symbol}${this.credentials.testnet ? ' (testnet trading with live market data)' : ''}`);
      
      // Initialize order book service for enhanced market analysis
      this.initializeOrderBookService(symbol);
      
      // Try using the library's WebSocket first
      try {
        const stream = this.marketDataClient.ws.ticker(symbol, async (ticker: any) => {
          const marketData: MarketData = {
            symbol: ticker.symbol,
            price: parseFloat(ticker.curDayClose),
            timestamp: Date.now(),
            volume: parseFloat(ticker.volume),
            change24h: parseFloat(ticker.priceChangePercent),
            high24h: parseFloat(ticker.high),
            low24h: parseFloat(ticker.low)
          };
          
          // Add Fear and Greed Index if enabled
          if (config.fearGreedIndexEnabled) {
            try {
              const fearGreedData = await fearGreedService.getFearGreedIndex();
              if (fearGreedData) {
                marketData.fearGreedIndex = fearGreedData;
              }
            } catch (error) {
              // Silently handle Fear and Greed Index errors to avoid disrupting market data
              logger.debug('Failed to fetch Fear and Greed Index for market data', { error });
            }
          }
          
          // Add order book data if available
          if (this.orderBookService) {
            const orderBook = this.orderBookService.getCurrentOrderBook();
            const orderBookAnalysis = this.orderBookService.getCurrentAnalysis();
            const volumeAnalysis = this.orderBookService.getCurrentVolumeAnalysis();
            
            if (orderBook) marketData.orderBook = orderBook;
            if (orderBookAnalysis) marketData.orderBookAnalysis = orderBookAnalysis;
            if (volumeAnalysis) marketData.volumeAnalysis = volumeAnalysis;
          }
          
          this.currentMarketData = marketData;
          this.emit('marketData', marketData);
        });

        // Check if stream has event methods
        if (stream && typeof stream.on === 'function') {
          stream.on('open', () => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            logger.info(`Real-time data stream started for ${symbol}`);
          });

          stream.on('close', () => {
            this.isConnected = false;
            logger.warn(`Real-time data stream closed for ${symbol}`);
            this.handleReconnection(symbol);
          });

          stream.on('error', (error: Error) => {
            TradingLogger.logError(error, { context: 'BinanceService.realTimeStream' });
            this.handleReconnection(symbol);
          });
        } else {
          // Fallback to manual WebSocket
          this.startManualWebSocket(symbol);
        }

      } catch (wsError) {
        logger.warn('Library WebSocket failed, using manual connection');
        this.startManualWebSocket(symbol);
      }

    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'BinanceService.startRealTimeData' });
      
      // Final fallback to polling only if WebSocket completely fails
      if (this.credentials.testnet) {
        logger.warn('WebSocket failed, falling back to polling for testnet');
        this.startPollingData(symbol);
      } else {
        throw new Error('Failed to start real-time data stream');
      }
    }
  }

  private startPollingData(symbol: string): void {
    logger.info(`Starting polling data for ${symbol} (testnet mode)`);
    this.isConnected = true;
    
    const pollInterval = setInterval(async () => {
      try {
        const price = await this.getCurrentPrice(symbol);
        const stats = await this.get24hrStats(symbol);
        
        const marketData: MarketData = {
          symbol: symbol,
          price: price,
          timestamp: Date.now(),
          volume: stats.volume,
          change24h: stats.change24h,
          high24h: stats.high24h,
          low24h: stats.low24h
        };
        
        // Add Fear and Greed Index if enabled
        if (config.fearGreedIndexEnabled) {
          try {
            const fearGreedData = await fearGreedService.getFearGreedIndex();
            if (fearGreedData) {
              marketData.fearGreedIndex = fearGreedData;
            }
          } catch (error) {
            // Silently handle Fear and Greed Index errors to avoid disrupting market data
            logger.debug('Failed to fetch Fear and Greed Index for polling data', { error });
          }
        }
        
        this.emit('marketData', marketData);
      } catch (error) {
        TradingLogger.logError(error as Error, { context: 'BinanceService.pollingData' });
      }
    }, 2000); // Poll every 2 seconds for testnet
    
    // Store interval for cleanup
    this.ws = pollInterval as any;
  }

  private startManualWebSocket(symbol: string): void {
    try {
      // Always use live WebSocket for market data (even in testnet trading mode)
      const wsUrl = `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`;
      
      this.ws = new WebSocket(wsUrl);
      
      this.ws.on('open', () => {
        this.isConnected = true;
        this.reconnectAttempts = 0;
        logger.info(`Live market data WebSocket connected for ${symbol}${this.credentials.testnet ? ' (testnet trading mode)' : ''}`);
      });
      
      this.ws.on('message', async (data: WebSocket.Data) => {
        try {
          const ticker = JSON.parse(data.toString());
          const marketData: MarketData = {
            symbol: ticker.s,
            price: parseFloat(ticker.c),
            timestamp: Date.now(),
            volume: parseFloat(ticker.v),
            change24h: parseFloat(ticker.P),
            high24h: parseFloat(ticker.h),
            low24h: parseFloat(ticker.l)
          };
          
          // Add Fear and Greed Index if enabled
          if (config.fearGreedIndexEnabled) {
            try {
              const fearGreedData = await fearGreedService.getFearGreedIndex();
              if (fearGreedData) {
                marketData.fearGreedIndex = fearGreedData;
              }
            } catch (error) {
              // Silently handle Fear and Greed Index errors to avoid disrupting market data
              logger.debug('Failed to fetch Fear and Greed Index for WebSocket data', { error });
            }
          }
          
          this.emit('marketData', marketData);
        } catch (parseError) {
          TradingLogger.logError(parseError as Error, { context: 'WebSocket.parseMessage' });
        }
      });
      
      this.ws.on('close', () => {
        this.isConnected = false;
        logger.warn(`Live market data WebSocket closed for ${symbol}`);
        this.handleReconnection(symbol);
      });
      
      this.ws.on('error', (error: Error) => {
        TradingLogger.logError(error, { context: 'BinanceService.liveMarketDataWebSocket' });
        this.handleReconnection(symbol);
      });
      
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'BinanceService.startManualWebSocket' });
      throw new Error('Failed to start live market data WebSocket connection');
    }
  }

  private handleReconnection(symbol: string): void {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      logger.info(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      
      setTimeout(() => {
        this.startRealTimeData(symbol);
      }, this.reconnectDelay * this.reconnectAttempts);
    } else {
      logger.error('Max reconnection attempts reached. Manual intervention required.');
      this.emit('connectionFailed');
    }
  }

  isStreamConnected(): boolean {
    return this.isConnected;
  }

  disconnect(): void {
    if (this.ws) {
      if (typeof this.ws.close === 'function') {
        // It's a WebSocket
        this.ws.close();
      } else {
        // It's a polling interval
        clearInterval(this.ws as any);
      }
      this.ws = null;
    }
    
    // Disconnect order book service
    if (this.orderBookService) {
      this.orderBookService.disconnect();
      this.orderBookService = null;
    }
    
    this.isConnected = false;
    logger.info('Binance service disconnected');
  }

  // Order book data access methods
  getCurrentOrderBook(): OrderBook | null {
    return this.orderBookService?.getCurrentOrderBook() || null;
  }

  getCurrentOrderBookAnalysis(): OrderBookAnalysis | null {
    return this.orderBookService?.getCurrentAnalysis() || null;
  }

  getCurrentVolumeAnalysis(): VolumeAnalysis | null {
    return this.orderBookService?.getCurrentVolumeAnalysis() || null;
  }

  isOrderBookConnected(): boolean {
    return this.orderBookService?.isOrderBookConnected() || false;
  }
}
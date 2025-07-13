import Binance from 'binance-api-node';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { BinanceCredentials, MarketData, Order } from '../../interfaces/trading';
import { logger, TradingLogger } from '../../utils/logger';

export class BinanceService extends EventEmitter {
  private client: any;
  private marketDataClient: any; // For live market data even in testnet
  private ws: WebSocket | NodeJS.Timeout | null = null;
  private credentials: BinanceCredentials;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 5000;

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

  async placeMarketOrder(symbol: string, side: 'BUY' | 'SELL', quantity: number): Promise<any> {
    try {
      // Validate order parameters
      const orderValue = quantity * (await this.getCurrentPrice(symbol));
      const minOrderValue = 10; // Binance minimum order value
      
      if (orderValue < minOrderValue) {
        throw new Error(`Order value ${orderValue.toFixed(2)} below minimum ${minOrderValue}`);
      }
      
      if (quantity <= 0) {
        throw new Error(`Invalid quantity: ${quantity}`);
      }

      const order = await this.client.order({
        symbol,
        side,
        type: 'MARKET',
        quantity: quantity.toFixed(6)
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

  async placeStopLossOrder(symbol: string, side: 'BUY' | 'SELL', quantity: number, stopPrice: number): Promise<any> {
    try {
      const order = await this.client.order({
        symbol,
        side,
        type: 'STOP_LOSS_LIMIT',
        quantity: quantity.toFixed(6),
        price: stopPrice.toFixed(6),
        stopPrice: stopPrice.toFixed(6),
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
      const order = await this.client.order({
        symbol,
        side,
        type: 'LIMIT',
        quantity: quantity.toFixed(6),
        price: targetPrice.toFixed(6),
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

  startRealTimeData(symbol: string): void {
    try {
      // HYBRID APPROACH: Use live WebSocket for price data even in testnet mode
      // This gives us real-time market data for better RSI/Bollinger calculations
      // while still using testnet for actual order execution
      
      logger.info(`Starting real-time data stream for ${symbol}${this.credentials.testnet ? ' (testnet trading with live market data)' : ''}`);
      
      // Try using the library's WebSocket first
      try {
        const stream = this.marketDataClient.ws.ticker(symbol, (ticker: any) => {
          const marketData: MarketData = {
            symbol: ticker.symbol,
            price: parseFloat(ticker.curDayClose),
            timestamp: Date.now(),
            volume: parseFloat(ticker.volume),
            change24h: parseFloat(ticker.priceChangePercent),
            high24h: parseFloat(ticker.high),
            low24h: parseFloat(ticker.low)
          };
          
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
      
      this.ws.on('message', (data: WebSocket.Data) => {
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
    this.isConnected = false;
    logger.info('Binance service disconnected');
  }
}
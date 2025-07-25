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
  private userDataStream: any = null;
  private listenKey: string | null = null;
  private userDataKeepAliveInterval: NodeJS.Timeout | null = null;
  private credentials: BinanceCredentials;
  private isConnected: boolean = false;
  private userDataConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 5000;
  private orderBookService: OrderBookService | null = null;
  private currentMarketData: MarketData | null = null;
  private activeOrders: Map<string, any> = new Map(); // Track order status
  private currentBalance: Map<string, number> = new Map(); // Track balances

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
    } catch (error: any) {
      // Check if the error is "Unknown order" - this means order doesn't exist anymore
      if (error.message && error.message.includes('Unknown order')) {
        TradingLogger.logRisk(`Order ${orderId} no longer exists (already filled/cancelled)`, {
          context: 'BinanceService.cancelOrder',
          orderDetails: { symbol, orderId }
        });
        return { status: 'NOT_FOUND', orderId, symbol };
      }
      
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

  async initializeUserDataStream(): Promise<void> {
    try {
      // Get listen key for authenticated user data stream
      const response = await this.client.getDataStream();
      this.listenKey = response.listenKey;
      
      logger.info('User Data Stream listen key obtained', { 
        listenKey: this.listenKey?.substring(0, 8) + '...' 
      });

      // Start the user data stream
      this.userDataStream = this.client.ws.user((msg: any) => {
        this.handleUserDataEvent(msg);
      }, this.listenKey);

      // Set up keep-alive for listen key (every 30 minutes)
      this.userDataKeepAliveInterval = setInterval(async () => {
        try {
          if (this.listenKey) {
            await this.client.keepDataStream({ listenKey: this.listenKey });
            logger.debug('User Data Stream keep-alive sent');
          }
        } catch (error) {
          logger.error('Failed to keep alive user data stream:', error);
          this.reconnectUserDataStream();
        }
      }, 30 * 60 * 1000); // 30 minutes

      this.userDataConnected = true;
      logger.info('✅ User Data Stream connected - real-time position tracking active');
    } catch (error) {
      logger.error('Failed to initialize User Data Stream:', error);
      throw new Error('Failed to initialize User Data Stream');
    }
  }

  private handleUserDataEvent(msg: any): void {
    try {
      logger.debug('User Data Stream event received', { eventType: msg.eventType });
      
      switch (msg.eventType) {
        case 'executionReport':
          this.handleOrderExecution(msg);
          break;
        case 'outboundAccountPosition':
          this.handleAccountUpdate(msg);
          break;
        case 'balanceUpdate':
          this.handleBalanceUpdate(msg);
          break;
        case 'listStatus':
          this.handleListStatusUpdate(msg);
          break;
        default:
          logger.debug('Unhandled user data event', { eventType: msg.eventType });
      }
    } catch (error) {
      TradingLogger.logError(error as Error, { 
        context: 'BinanceService.handleUserDataEvent',
        event: msg 
      });
    }
  }

  private handleOrderExecution(execution: any): void {
    const orderId = execution.orderId;
    const symbol = execution.symbol;
    const side = execution.side; // BUY or SELL
    const orderType = execution.orderType;
    const orderStatus = execution.orderStatus; // NEW, PARTIALLY_FILLED, FILLED, CANCELED, REJECTED
    const executedQty = parseFloat(execution.executedQuantity);
    const cummulativeQuoteQty = parseFloat(execution.cummulativeQuoteQuantity);
    const price = parseFloat(execution.price);
    const lastExecutedPrice = parseFloat(execution.lastExecutedPrice);
    const lastExecutedQuantity = parseFloat(execution.lastExecutedQuantity);

    // Update our active orders tracking
    this.activeOrders.set(orderId, {
      ...execution,
      timestamp: Date.now(),
      parsedPrice: price,
      parsedExecutedQty: executedQty
    });

    logger.info(`📊 Order Execution: ${symbol} ${side} ${orderStatus}`, {
      orderId,
      orderType,
      executedQty,
      price: lastExecutedPrice || price,
      totalValue: cummulativeQuoteQty
    });

    // Emit events based on order status
    switch (orderStatus) {
      case 'NEW':
        this.emit('orderPlaced', {
          orderId,
          symbol,
          side,
          quantity: parseFloat(execution.quantity),
          price,
          orderType
        });
        break;
        
      case 'FILLED':
        this.emit('orderFilled', {
          orderId,
          symbol,
          side,
          executedQty,
          avgPrice: cummulativeQuoteQty / executedQty,
          totalValue: cummulativeQuoteQty,
          execution
        });
        
        // Remove from active orders since it's fully filled
        this.activeOrders.delete(orderId);
        break;
        
      case 'PARTIALLY_FILLED':
        this.emit('orderPartiallyFilled', {
          orderId,
          symbol,
          side,
          executedQty,
          remainingQty: parseFloat(execution.quantity) - executedQty,
          lastExecutedPrice,
          lastExecutedQuantity,
          execution
        });
        break;
        
      case 'CANCELED':
        this.emit('orderCanceled', {
          orderId,
          symbol,
          side,
          reason: 'User canceled',
          execution
        });
        
        // Remove from active orders
        this.activeOrders.delete(orderId);
        break;
        
      case 'REJECTED':
        this.emit('orderRejected', {
          orderId,
          symbol,
          side,
          reason: execution.rejectReason || 'Unknown',
          execution
        });
        
        // Remove from active orders
        this.activeOrders.delete(orderId);
        break;
    }
  }

  private handleAccountUpdate(account: any): void {
    logger.info('📈 Account position update received', {
      eventTime: account.eventTime,
      balances: account.balances?.length || 0
    });

    // Update balance tracking
    if (account.balances && Array.isArray(account.balances)) {
      account.balances.forEach((balance: any) => {
        const asset = balance.asset;
        const free = parseFloat(balance.free);
        const locked = parseFloat(balance.locked);
        
        this.currentBalance.set(asset, free);
        
        if (free > 0 || locked > 0) {
          logger.debug(`Balance update: ${asset}`, { free, locked });
        }
      });
    }

    this.emit('accountUpdate', {
      eventTime: account.eventTime,
      balances: account.balances,
      currentBalance: Object.fromEntries(this.currentBalance)
    });
  }

  private handleBalanceUpdate(balance: any): void {
    const asset = balance.asset;
    const balanceDelta = parseFloat(balance.balanceDelta);
    const clearTime = balance.clearTime;

    logger.info(`💰 Balance Update: ${asset} ${balanceDelta > 0 ? '+' : ''}${balanceDelta}`, {
      asset,
      balanceDelta,
      clearTime
    });

    // Update our balance tracking
    const currentBalance = this.currentBalance.get(asset) || 0;
    this.currentBalance.set(asset, currentBalance + balanceDelta);

    this.emit('balanceUpdate', {
      asset,
      balanceDelta,
      newBalance: this.currentBalance.get(asset),
      clearTime
    });
  }

  private handleListStatusUpdate(listStatus: any): void {
    logger.info('📋 OCO List Status Update', {
      symbol: listStatus.symbol,
      orderListId: listStatus.orderListId,
      listStatusType: listStatus.listStatusType,
      listOrderStatus: listStatus.listOrderStatus
    });

    this.emit('listStatusUpdate', listStatus);
  }

  private async reconnectUserDataStream(): Promise<void> {
    try {
      logger.warn('Reconnecting User Data Stream...');
      
      // Clean up existing stream
      if (this.userDataKeepAliveInterval) {
        clearInterval(this.userDataKeepAliveInterval);
        this.userDataKeepAliveInterval = null;
      }
      
      if (this.userDataStream && typeof this.userDataStream.close === 'function') {
        this.userDataStream.close();
      }
      
      this.userDataConnected = false;
      
      // Wait a bit before reconnecting
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Reinitialize
      await this.initializeUserDataStream();
      
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'BinanceService.reconnectUserDataStream' });
      
      // Retry after delay
      setTimeout(() => {
        this.reconnectUserDataStream();
      }, 5000);
    }
  }

  getActiveOrders(): Map<string, any> {
    return new Map(this.activeOrders);
  }

  getCurrentBalances(): Map<string, number> {
    return new Map(this.currentBalance);
  }

  isUserDataStreamConnected(): boolean {
    return this.userDataConnected;
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
    // Clean up user data stream
    if (this.userDataKeepAliveInterval) {
      clearInterval(this.userDataKeepAliveInterval);
      this.userDataKeepAliveInterval = null;
    }

    if (this.userDataStream && typeof this.userDataStream.close === 'function') {
      this.userDataStream.close();
      this.userDataStream = null;
    }

    if (this.listenKey) {
      // Note: We should call closeUserDataStream but it's async and this method is sync
      // In a real implementation, consider making this async
      this.listenKey = null;
    }

    // Clean up market data WebSocket
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
    this.userDataConnected = false;
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
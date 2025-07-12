import Binance from 'binance-api-node';
import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { BinanceCredentials, MarketData, Order } from '../../interfaces/trading';
import { logger, TradingLogger } from '../../utils/logger';

export class BinanceService extends EventEmitter {
  private client: any;
  private ws: WebSocket | null = null;
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
      this.client = Binance({
        apiKey: this.credentials.apiKey,
        apiSecret: this.credentials.apiSecret,
        ...(this.credentials.testnet && { 
          httpBase: 'https://testnet.binance.vision',
          wsBase: 'wss://testnet.binance.vision'
        })
      });
      logger.info('Binance client initialized successfully');
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
      const order = await this.client.order({
        symbol,
        side,
        type: 'MARKET',
        quantity: quantity.toFixed(6)
      });
      
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
      const stream = this.client.ws.ticker(symbol, (ticker: any) => {
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

    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'BinanceService.startRealTimeData' });
      throw new Error('Failed to start real-time data stream');
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
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    logger.info('Binance service disconnected');
  }
}
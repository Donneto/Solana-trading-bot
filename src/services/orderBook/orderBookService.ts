import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { 
  OrderBook, 
  OrderBookAnalysis, 
  TradeData, 
  VolumeAnalysis 
} from '../../interfaces/trading';
import { logger } from '../../utils/logger';

export class OrderBookService extends EventEmitter {
  private orderBookWs: WebSocket | null = null;
  private tradeWs: WebSocket | null = null;
  private currentOrderBook: OrderBook | null = null;
  private recentTrades: TradeData[] = [];
  private symbol: string;
  private isConnected: boolean = false;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 3000;

  // Configuration
  private readonly depthLevels: number = 20; // Number of order book levels to track
  private readonly tradeHistorySize: number = 100; // Number of recent trades to keep
  private readonly volumeAnalysisPeriod: number = 60000; // 1 minute for volume analysis
  
  constructor(symbol: string) {
    super();
    this.symbol = symbol.toUpperCase();
  }

  async connect(): Promise<void> {
    try {
      await this.connectOrderBookStream();
      await this.connectTradeStream();
      this.isConnected = true;
      logger.info(`Order book service connected for ${this.symbol}`);
    } catch (error) {
      logger.error('Failed to connect order book service', { error, symbol: this.symbol });
      throw error;
    }
  }

  private async connectOrderBookStream(): Promise<void> {
    const wsUrl = `wss://stream.binance.com:9443/ws/${this.symbol.toLowerCase()}@depth${this.depthLevels}@100ms`;
    
    this.orderBookWs = new WebSocket(wsUrl);

    this.orderBookWs.on('open', () => {
      logger.info(`Order book WebSocket connected for ${this.symbol}`);
      this.reconnectAttempts = 0;
    });

    this.orderBookWs.on('message', (data: string) => {
      try {
        const depthData = JSON.parse(data);
        this.processOrderBookUpdate(depthData);
      } catch (error) {
        logger.error('Error processing order book data', { error, symbol: this.symbol });
      }
    });

    this.orderBookWs.on('close', () => {
      logger.warn(`Order book WebSocket closed for ${this.symbol}`);
      this.scheduleReconnect('orderbook');
    });

    this.orderBookWs.on('error', (error) => {
      logger.error('Order book WebSocket error', { error, symbol: this.symbol });
    });
  }

  private async connectTradeStream(): Promise<void> {
    const wsUrl = `wss://stream.binance.com:9443/ws/${this.symbol.toLowerCase()}@trade`;
    
    this.tradeWs = new WebSocket(wsUrl);

    this.tradeWs.on('open', () => {
      logger.info(`Trade stream WebSocket connected for ${this.symbol}`);
    });

    this.tradeWs.on('message', (data: string) => {
      try {
        const tradeData = JSON.parse(data);
        this.processTradeUpdate(tradeData);
      } catch (error) {
        logger.error('Error processing trade data', { error, symbol: this.symbol });
      }
    });

    this.tradeWs.on('close', () => {
      logger.warn(`Trade stream WebSocket closed for ${this.symbol}`);
      this.scheduleReconnect('trade');
    });

    this.tradeWs.on('error', (error) => {
      logger.error('Trade stream WebSocket error', { error, symbol: this.symbol });
    });
  }

  private processOrderBookUpdate(data: any): void {
    const orderBook: OrderBook = {
      symbol: this.symbol,
      bids: data.b?.map((level: string[]) => ({
        price: parseFloat(level[0] || '0'),
        quantity: parseFloat(level[1] || '0')
      })) || [],
      asks: data.a?.map((level: string[]) => ({
        price: parseFloat(level[0] || '0'),
        quantity: parseFloat(level[1] || '0')
      })) || [],
      timestamp: Date.now(),
      lastUpdateId: data.u || 0
    };

    // Filter out zero quantity levels
    orderBook.bids = orderBook.bids.filter(level => level.quantity > 0);
    orderBook.asks = orderBook.asks.filter(level => level.quantity > 0);

    // Sort bids descending (highest price first) and asks ascending (lowest price first)
    orderBook.bids.sort((a, b) => b.price - a.price);
    orderBook.asks.sort((a, b) => a.price - b.price);

    this.currentOrderBook = orderBook;
    
    // Generate analysis
    const analysis = this.analyzeOrderBook(orderBook);
    
    // Emit events
    this.emit('orderBookUpdate', orderBook);
    this.emit('orderBookAnalysis', analysis);
  }

  private processTradeUpdate(data: any): void {
    const trade: TradeData = {
      symbol: data.s,
      price: parseFloat(data.p),
      quantity: parseFloat(data.q),
      side: data.m ? 'SELL' : 'BUY', // m=true means buyer is market maker (sell order filled)
      timestamp: data.T,
      tradeId: data.t,
      isBuyerMaker: data.m
    };

    // Add to recent trades
    this.recentTrades.push(trade);
    
    // Maintain trade history size
    if (this.recentTrades.length > this.tradeHistorySize) {
      this.recentTrades = this.recentTrades.slice(-this.tradeHistorySize);
    }

    // Generate volume analysis
    const volumeAnalysis = this.analyzeVolume();

    // Emit events
    this.emit('tradeUpdate', trade);
    this.emit('volumeAnalysis', volumeAnalysis);
  }

  private analyzeOrderBook(orderBook: OrderBook): OrderBookAnalysis {
    const topLevels = 10; // Analyze top 10 levels for depth
    const strongOrderThreshold = this.calculateStrongOrderThreshold(orderBook);
    
    // Calculate liquidity depth
    const bidDepth = orderBook.bids
      .slice(0, topLevels)
      .reduce((sum, level) => sum + (level.price * level.quantity), 0);
    
    const askDepth = orderBook.asks
      .slice(0, topLevels)
      .reduce((sum, level) => sum + (level.price * level.quantity), 0);

    // Calculate spread
    const bestBid = orderBook.bids[0]?.price || 0;
    const bestAsk = orderBook.asks[0]?.price || 0;
    const spread = bestAsk - bestBid;
    const spreadPercent = bestBid > 0 ? (spread / bestBid) * 100 : 0;

    // Find strong levels (large orders)
    const strongBidLevels = orderBook.bids.filter(level => 
      level.price * level.quantity >= strongOrderThreshold
    );
    
    const strongAskLevels = orderBook.asks.filter(level => 
      level.price * level.quantity >= strongOrderThreshold
    );

    // Calculate metrics
    const liquidityRatio = askDepth > 0 ? bidDepth / askDepth : 0;
    const totalLiquidity = bidDepth + askDepth;
    const liquidityScore = Math.min(100, Math.max(0, (totalLiquidity / 1000000) * 100)); // Normalize to 0-100
    
    // Volatility risk based on spread and liquidity
    const volatilityRisk = Math.min(100, Math.max(0, (spreadPercent * 100) + (100 - liquidityScore)));
    
    // Market pressure based on liquidity imbalance
    let marketPressure: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    if (liquidityRatio > 1.2) {
      marketPressure = 'SELL'; // More bid liquidity suggests selling pressure
    } else if (liquidityRatio < 0.8) {
      marketPressure = 'BUY'; // More ask liquidity suggests buying pressure
    }

    return {
      symbol: orderBook.symbol,
      timestamp: orderBook.timestamp,
      bidDepth,
      askDepth,
      spreadPercent,
      liquidityRatio,
      strongBidLevels: strongBidLevels.slice(0, 5), // Top 5 strong levels
      strongAskLevels: strongAskLevels.slice(0, 5),
      liquidityScore,
      volatilityRisk,
      marketPressure
    };
  }

  private calculateStrongOrderThreshold(orderBook: OrderBook): number {
    // Calculate threshold as 3x the median order value
    const allOrders = [...orderBook.bids, ...orderBook.asks]
      .map(level => level.price * level.quantity)
      .sort((a, b) => a - b);
    
    if (allOrders.length === 0) return 1000; // Default threshold
    
    const median = allOrders[Math.floor(allOrders.length / 2)] || 0;
    return median * 3;
  }

  private analyzeVolume(): VolumeAnalysis {
    const now = Date.now();
    const periodTrades = this.recentTrades.filter(
      trade => (now - trade.timestamp) <= this.volumeAnalysisPeriod
    );

    if (periodTrades.length === 0) {
      return {
        symbol: this.symbol,
        timestamp: now,
        volumeMA: 0,
        currentVolume: 0,
        volumeSpike: false,
        volumeRatio: 1,
        buyVolume: 0,
        sellVolume: 0,
        netFlow: 0,
        flowDirection: 'NEUTRAL'
      };
    }

    // Calculate volume metrics
    const currentVolume = periodTrades.reduce((sum, trade) => sum + trade.quantity, 0);
    const buyVolume = periodTrades
      .filter(trade => trade.side === 'BUY')
      .reduce((sum, trade) => sum + trade.quantity, 0);
    const sellVolume = periodTrades
      .filter(trade => trade.side === 'SELL')
      .reduce((sum, trade) => sum + trade.quantity, 0);

    // Simple moving average (would be better with historical data)
    const volumeMA = this.calculateVolumeMA();
    const volumeRatio = volumeMA > 0 ? currentVolume / volumeMA : 1;
    const volumeSpike = volumeRatio > 2; // 2x normal volume

    const netFlow = buyVolume - sellVolume;
    let flowDirection: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
    
    if (Math.abs(netFlow) > currentVolume * 0.1) { // 10% threshold
      flowDirection = netFlow > 0 ? 'BUY' : 'SELL';
    }

    return {
      symbol: this.symbol,
      timestamp: now,
      volumeMA,
      currentVolume,
      volumeSpike,
      volumeRatio,
      buyVolume,
      sellVolume,
      netFlow,
      flowDirection
    };
  }

  private calculateVolumeMA(): number {
    // Simple implementation - in production would use rolling window
    if (this.recentTrades.length < 10) return 0;
    
    const totalVolume = this.recentTrades.reduce((sum, trade) => sum + trade.quantity, 0);
    return totalVolume / this.recentTrades.length;
  }

  private scheduleReconnect(streamType: 'orderbook' | 'trade'): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error(`Max reconnection attempts reached for ${streamType} stream`, { symbol: this.symbol });
      return;
    }

    this.reconnectAttempts++;
    
    setTimeout(() => {
      logger.info(`Attempting to reconnect ${streamType} stream (${this.reconnectAttempts}/${this.maxReconnectAttempts})`, { symbol: this.symbol });
      
      if (streamType === 'orderbook') {
        this.connectOrderBookStream();
      } else {
        this.connectTradeStream();
      }
    }, this.reconnectDelay);
  }

  // Public methods for getting current data
  getCurrentOrderBook(): OrderBook | null {
    return this.currentOrderBook;
  }

  getRecentTrades(): TradeData[] {
    return [...this.recentTrades];
  }

  getCurrentAnalysis(): OrderBookAnalysis | null {
    if (!this.currentOrderBook) return null;
    return this.analyzeOrderBook(this.currentOrderBook);
  }

  getCurrentVolumeAnalysis(): VolumeAnalysis {
    return this.analyzeVolume();
  }

  isOrderBookConnected(): boolean {
    return this.isConnected && this.orderBookWs?.readyState === WebSocket.OPEN;
  }

  async disconnect(): Promise<void> {
    this.isConnected = false;
    
    if (this.orderBookWs) {
      this.orderBookWs.close();
      this.orderBookWs = null;
    }
    
    if (this.tradeWs) {
      this.tradeWs.close();
      this.tradeWs = null;
    }
    
    logger.info(`Order book service disconnected for ${this.symbol}`);
  }
}
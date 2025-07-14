export interface TradingConfig {
  symbol: string;
  initialCapital: number;
  dailyProfitTarget: number;
  maxDailyLoss: number;
  positionSizePercentage: number;
  
  stopLossPercentage: number;
  takeProfitPercentage: number;
  trailingStopPercentage: number;
  maxOpenPositions: number;
  
  meanReversionPeriod: number;
  deviationThreshold: number;
  gridLevels: number;
  gridSpacingPercentage: number;
  
  fearGreedIndexEnabled: boolean;
}

export interface MarketData {
  symbol: string;
  price: number;
  timestamp: number;
  volume: number;
  change24h: number;
  high24h: number;
  low24h: number;
  fearGreedIndex?: FearGreedData;
  orderBook?: OrderBook;
  orderBookAnalysis?: OrderBookAnalysis;
  volumeAnalysis?: VolumeAnalysis;
}

export interface FearGreedData {
  value: number;
  valueClassification: 'Extreme Fear' | 'Fear' | 'Neutral' | 'Greed' | 'Extreme Greed';
  timestamp: number;
  nextUpdate: number;
  source: 'api' | 'scraper' | 'cached';
}

export interface FearGreedCacheEntry {
  data: FearGreedData;
  cachedAt: number;
  expiresAt: number;
}

export interface FearGreedConfig {
  enabled: boolean;
  apiKey: string;
  cacheExpiryHours: number;
  retryAttempts: number;
  retryDelayMs: number;
  fallbackToScraper: boolean;
  scrapingUrl: string;
}

export interface Position {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  trailingStopPrice: number;
  timestamp: number;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
}

export interface Order {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT' | 'STOP_LOSS' | 'TAKE_PROFIT' | 'TRAILING_STOP';
  quantity: number;
  price?: number;
  stopPrice?: number;
  timeInForce: 'GTC' | 'IOC' | 'FOK';
  status: 'NEW' | 'FILLED' | 'CANCELLED' | 'REJECTED';
  timestamp: number;
}

export interface TradingSignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  price: number;
  quantity: number;
  reason: string;
  timestamp: number;
  stopLoss: number;
  takeProfit: number;
}

export interface RiskMetrics {
  dailyPnL: number;
  totalPnL: number;
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  currentExposure: number;
  positionsCount: number;
  riskScore: number;
}

export interface BinanceCredentials {
  apiKey: string;
  apiSecret: string;
  testnet: boolean;
}

export interface OrderBookLevel {
  price: number;
  quantity: number;
}

export interface OrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
  lastUpdateId: number;
}

export interface OrderBookAnalysis {
  symbol: string;
  timestamp: number;
  
  // Liquidity metrics
  bidDepth: number;        // Total bid quantity in top N levels
  askDepth: number;        // Total ask quantity in top N levels
  spreadPercent: number;   // Bid-ask spread as percentage
  liquidityRatio: number;  // Bid depth / Ask depth
  
  // Support/Resistance levels
  strongBidLevels: OrderBookLevel[];  // Large bid orders (potential support)
  strongAskLevels: OrderBookLevel[];  // Large ask orders (potential resistance)
  
  // Market condition indicators
  liquidityScore: number;   // 0-100, higher = more liquid
  volatilityRisk: number;   // 0-100, higher = more volatile conditions
  marketPressure: 'BUY' | 'SELL' | 'NEUTRAL';  // Based on order imbalance
}

export interface TradeData {
  symbol: string;
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  timestamp: number;
  tradeId: number;
  isBuyerMaker: boolean;
}

export interface VolumeAnalysis {
  symbol: string;
  timestamp: number;
  
  // Volume metrics
  volumeMA: number;        // Moving average volume
  currentVolume: number;   // Recent period volume
  volumeSpike: boolean;    // Is current volume significantly higher?
  volumeRatio: number;     // Current vs average volume
  
  // Trade flow analysis
  buyVolume: number;       // Aggressive buy volume
  sellVolume: number;      // Aggressive sell volume
  netFlow: number;         // Buy volume - sell volume
  flowDirection: 'BUY' | 'SELL' | 'NEUTRAL';
}
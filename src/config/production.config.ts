import { TradingConfig, BinanceCredentials, FearGreedConfig } from '../interfaces/trading';

interface CoinProfile {
  symbol: string;
  volatility: 'low' | 'medium' | 'high';
  strategy: 'meanReversion' | 'gridTrading' | 'momentum';
  meanReversionPeriod: number;
  deviationThreshold: number;
  stopLossPercentage: number;
  takeProfitPercentage: number;
  trailingStopPercentage: number;
  positionSizePercentage: number;
  maxOpenPositions: number;
  gridLevels: number;
  gridSpacingPercentage: number;
  description?: string;
}

export const productionCoinProfiles: Record<string, CoinProfile> = {
  'BTCUSDT': {
    symbol: 'BTCUSDT',
    volatility: 'low',
    strategy: 'gridTrading',
    meanReversionPeriod: 14,
    deviationThreshold: 1.5,
    stopLossPercentage: 1.5,
    takeProfitPercentage: 2.5,
    trailingStopPercentage: 1.0,
    positionSizePercentage: 10,
    maxOpenPositions: 2,
    gridLevels: 6,
    gridSpacingPercentage: 1.0,
    description: 'Production Bitcoin - grid trading for low volatility institutional patterns'
  },
  'SOLUSDT': {
    symbol: 'SOLUSDT',
    volatility: 'medium',
    strategy: 'meanReversion',
    meanReversionPeriod: 20,
    deviationThreshold: 2.0,
    stopLossPercentage: 2.0,
    takeProfitPercentage: 3.0,
    trailingStopPercentage: 1.5,
    positionSizePercentage: 8,
    maxOpenPositions: 2,
    gridLevels: 8,
    gridSpacingPercentage: 1.2,
    description: 'Production Solana - mean reversion for balanced volatility oscillations'
  },
  'ADAUSDT': {
    symbol: 'ADAUSDT',
    volatility: 'high',
    strategy: 'momentum',
    meanReversionPeriod: 25,
    deviationThreshold: 2.2,
    stopLossPercentage: 2.0,
    takeProfitPercentage: 3.5,
    trailingStopPercentage: 1.8,
    positionSizePercentage: 2.0,
    maxOpenPositions: 5,
    gridLevels: 6,
    gridSpacingPercentage: 1.5,
    description: 'Production Cardano - momentum strategy for high volatility trend movements'
  },
  'XRPUSDT': {
    symbol: 'XRPUSDT',
    volatility: 'high',
    strategy: 'momentum',
    meanReversionPeriod: 22,
    deviationThreshold: 2.1,
    stopLossPercentage: 1.8,
    takeProfitPercentage: 3.2,
    trailingStopPercentage: 1.6,
    positionSizePercentage: 7,
    maxOpenPositions: 3,
    gridLevels: 6,
    gridSpacingPercentage: 1.3,
    description: 'Production XRP - momentum strategy for news-driven volatility patterns'
  }
};

export function getProductionCoinProfile(symbol: string): CoinProfile {
  const normalizedSymbol = symbol.toUpperCase();
  const profile = productionCoinProfiles[normalizedSymbol];
  if (profile) {
    console.log(`🚀 Loading production ${symbol} profile: ${profile.description}`);
    return profile;
  } else {
    console.log(`⚠️  No production profile found for ${symbol}, using SOL defaults`);
    const defaultProfile = productionCoinProfiles['SOLUSDT'];
    if (!defaultProfile) {
      throw new Error('Default production SOL profile not found');
    }
    return defaultProfile;
  }
}

export function createProductionConfig(tradingSymbol: string, actualBalance?: number): TradingConfig {
  const coinProfile = getProductionCoinProfile(tradingSymbol);
  
  // REQUIRE actual balance - no fallbacks for production safety
  if (!actualBalance) {
    throw new Error('Actual account balance is required for production - no fallback values allowed');
  }
  
  return {
    symbol: tradingSymbol,
    initialCapital: actualBalance,
    dailyProfitTarget: actualBalance * 0.04, // 4% of actual balance
    maxDailyLoss: actualBalance * 0.10, // 10% of actual balance
    
    strategy: coinProfile.strategy,
    positionSizePercentage: parseFloat(process.env.POSITION_SIZE_PERCENTAGE || coinProfile.positionSizePercentage.toString()),
    stopLossPercentage: parseFloat(process.env.STOP_LOSS_PERCENTAGE || coinProfile.stopLossPercentage.toString()),
    takeProfitPercentage: parseFloat(process.env.TAKE_PROFIT_PERCENTAGE || coinProfile.takeProfitPercentage.toString()),
    trailingStopPercentage: parseFloat(process.env.TRAILING_STOP_PERCENTAGE || coinProfile.trailingStopPercentage.toString()),
    maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || coinProfile.maxOpenPositions.toString()),
    
    meanReversionPeriod: parseInt(process.env.MEAN_REVERSION_PERIOD || coinProfile.meanReversionPeriod.toString()),
    deviationThreshold: parseFloat(process.env.DEVIATION_THRESHOLD || coinProfile.deviationThreshold.toString()),
    gridLevels: parseInt(process.env.GRID_LEVELS || coinProfile.gridLevels.toString()),
    gridSpacingPercentage: parseFloat(process.env.GRID_SPACING_PERCENTAGE || coinProfile.gridSpacingPercentage.toString()),
    
    fearGreedIndexEnabled: process.env.FEAR_GREED_INDEX_ENABLED === 'true',
  };
}

export function getProductionBinanceConfig(): BinanceCredentials {
  return {
    apiKey: process.env.BINANCE_API_KEY || '',
    apiSecret: process.env.BINANCE_API_SECRET || '',
    testnet: false,
  };
}

export function getProductionFearGreedConfig(): FearGreedConfig {
  return {
    enabled: process.env.FEAR_GREED_INDEX_ENABLED === 'true',
    apiKey: process.env.COINMARKETCAP_API_KEY || '',
    cacheExpiryHours: parseInt(process.env.FEAR_GREED_CACHE_HOURS || '12'),
    retryAttempts: parseInt(process.env.FEAR_GREED_RETRY_ATTEMPTS || '3'),
    retryDelayMs: parseInt(process.env.FEAR_GREED_RETRY_DELAY || '5000'),
    fallbackToScraper: process.env.FEAR_GREED_FALLBACK_SCRAPER === 'true',
    scrapingUrl: 'https://coinmarketcap.com/fear-and-greed/'
  };
}
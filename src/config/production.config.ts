import { TradingConfig, BinanceCredentials, FearGreedConfig } from '../interfaces/trading';

interface CoinProfile {
  symbol: string;
  volatility: 'low' | 'medium' | 'high';
  meanReversionPeriod: number;
  deviationThreshold: number;
  stopLossPercentage: number;
  takeProfitPercentage: number;
  trailingStopPercentage: number;
  positionSizePercentage: number;
  maxOpenPositions: number;
  description: string;
}

export const productionCoinProfiles: Record<string, CoinProfile> = {
  'BTCUSDT': {
    symbol: 'BTCUSDT',
    volatility: 'low',
    meanReversionPeriod: 14,
    deviationThreshold: 1.5,
    stopLossPercentage: 1.5,
    takeProfitPercentage: 2.5,
    trailingStopPercentage: 1.0,
    positionSizePercentage: 10,
    maxOpenPositions: 2,
    description: 'Production Bitcoin - conservative settings for live trading'
  },
  'SOLUSDT': {
    symbol: 'SOLUSDT',
    volatility: 'medium',
    meanReversionPeriod: 20,
    deviationThreshold: 2.0,
    stopLossPercentage: 2.0,
    takeProfitPercentage: 3.0,
    trailingStopPercentage: 1.5,
    positionSizePercentage: 8,
    maxOpenPositions: 2,
    description: 'Production Solana - balanced risk for live trading'
  },
  'ADAUSDT': {
    symbol: 'ADAUSDT',
    volatility: 'high',
    meanReversionPeriod: 25,
    deviationThreshold: 2.2,
    stopLossPercentage: 2.0,
    takeProfitPercentage: 3.5,
    trailingStopPercentage: 1.8,
    positionSizePercentage: 6,
    maxOpenPositions: 3,
    description: 'Production Cardano - controlled volatility for live trading'
  },
  'XRPUSDT': {
    symbol: 'XRPUSDT',
    volatility: 'high',
    meanReversionPeriod: 22,
    deviationThreshold: 2.1,
    stopLossPercentage: 1.8,
    takeProfitPercentage: 3.2,
    trailingStopPercentage: 1.6,
    positionSizePercentage: 7,
    maxOpenPositions: 3,
    description: 'Production XRP - conservative approach for regulatory volatility'
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

export function createProductionConfig(tradingSymbol: string): TradingConfig {
  const coinProfile = getProductionCoinProfile(tradingSymbol);
  
  return {
    symbol: tradingSymbol,
    initialCapital: parseFloat(process.env.INITIAL_CAPITAL || '300'),
    dailyProfitTarget: parseFloat(process.env.DAILY_PROFIT_TARGET || '12'),
    maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || '30'),
    
    positionSizePercentage: parseFloat(process.env.POSITION_SIZE_PERCENTAGE || coinProfile.positionSizePercentage.toString()),
    stopLossPercentage: parseFloat(process.env.STOP_LOSS_PERCENTAGE || coinProfile.stopLossPercentage.toString()),
    takeProfitPercentage: parseFloat(process.env.TAKE_PROFIT_PERCENTAGE || coinProfile.takeProfitPercentage.toString()),
    trailingStopPercentage: parseFloat(process.env.TRAILING_STOP_PERCENTAGE || coinProfile.trailingStopPercentage.toString()),
    maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || coinProfile.maxOpenPositions.toString()),
    
    meanReversionPeriod: parseInt(process.env.MEAN_REVERSION_PERIOD || coinProfile.meanReversionPeriod.toString()),
    deviationThreshold: parseFloat(process.env.DEVIATION_THRESHOLD || coinProfile.deviationThreshold.toString()),
    gridLevels: parseInt(process.env.GRID_LEVELS || '5'),
    gridSpacingPercentage: parseFloat(process.env.GRID_SPACING_PERCENTAGE || '0.5'),
    
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
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

export const testnetCoinProfiles: Record<string, CoinProfile> = {
  'BTCUSDT': {
    symbol: 'BTCUSDT',
    volatility: 'low',
    meanReversionPeriod: 12,
    deviationThreshold: 1.5,
    stopLossPercentage: 4.0,
    takeProfitPercentage: 6.0,
    trailingStopPercentage: 3.0,
    positionSizePercentage: 35,
    maxOpenPositions: 6,
    description: 'Testnet Bitcoin - aggressive for strategy validation'
  },
  'SOLUSDT': {
    symbol: 'SOLUSDT',
    volatility: 'medium',
    meanReversionPeriod: 18,
    deviationThreshold: 2.0,
    stopLossPercentage: 5.0,
    takeProfitPercentage: 7.0,
    trailingStopPercentage: 3.5,
    positionSizePercentage: 30,
    maxOpenPositions: 7,
    description: 'Testnet Solana - high risk for strategy testing'
  },
  'ADAUSDT': {
    symbol: 'ADAUSDT',
    volatility: 'high',
    meanReversionPeriod: 22,
    deviationThreshold: 2.5,
    stopLossPercentage: 6.0,
    takeProfitPercentage: 8.0,
    trailingStopPercentage: 4.0,
    positionSizePercentage: 25,
    maxOpenPositions: 8,
    description: 'Testnet Cardano - maximum risk for validation'
  },
  'XRPUSDT': {
    symbol: 'XRPUSDT',
    volatility: 'high',
    meanReversionPeriod: 20,
    deviationThreshold: 2.3,
    stopLossPercentage: 5.5,
    takeProfitPercentage: 7.5,
    trailingStopPercentage: 3.8,
    positionSizePercentage: 28,
    maxOpenPositions: 7,
    description: 'Testnet XRP - aggressive volatility settings for testing'
  }
};

export function getTestnetCoinProfile(symbol: string): CoinProfile {
  const normalizedSymbol = symbol.toUpperCase();
  const profile = testnetCoinProfiles[normalizedSymbol];
  if (profile) {
    console.log(`🧪 Loading testnet ${symbol} profile: ${profile.description}`);
    return profile;
  } else {
    console.log(`⚠️  No testnet profile found for ${symbol}, using SOL defaults`);
    const defaultProfile = testnetCoinProfiles['SOLUSDT'];
    if (!defaultProfile) {
      throw new Error('Default testnet SOL profile not found');
    }
    return defaultProfile;
  }
}

export function createTestnetConfig(tradingSymbol: string): TradingConfig {
  const coinProfile = getTestnetCoinProfile(tradingSymbol);
  
  return {
    symbol: tradingSymbol,
    initialCapital: parseFloat(process.env.INITIAL_CAPITAL || '50000'),
    dailyProfitTarget: parseFloat(process.env.DAILY_PROFIT_TARGET || '1000'),
    maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || '2500'),
    
    positionSizePercentage: parseFloat(process.env.POSITION_SIZE_PERCENTAGE || coinProfile.positionSizePercentage.toString()),
    stopLossPercentage: parseFloat(process.env.STOP_LOSS_PERCENTAGE || coinProfile.stopLossPercentage.toString()),
    takeProfitPercentage: parseFloat(process.env.TAKE_PROFIT_PERCENTAGE || coinProfile.takeProfitPercentage.toString()),
    trailingStopPercentage: parseFloat(process.env.TRAILING_STOP_PERCENTAGE || coinProfile.trailingStopPercentage.toString()),
    maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || coinProfile.maxOpenPositions.toString()),
    
    meanReversionPeriod: parseInt(process.env.MEAN_REVERSION_PERIOD || coinProfile.meanReversionPeriod.toString()),
    deviationThreshold: parseFloat(process.env.DEVIATION_THRESHOLD || coinProfile.deviationThreshold.toString()),
    gridLevels: parseInt(process.env.GRID_LEVELS || '8'),
    gridSpacingPercentage: parseFloat(process.env.GRID_SPACING_PERCENTAGE || '0.8'),
    
    fearGreedIndexEnabled: process.env.FEAR_GREED_INDEX_ENABLED === 'true',
  };
}

export function getTestnetBinanceConfig(): BinanceCredentials {
  return {
    apiKey: process.env.BINANCE_API_KEY || '',
    apiSecret: process.env.BINANCE_API_SECRET || '',
    testnet: true,
  };
}

export function getTestnetFearGreedConfig(): FearGreedConfig {
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
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

export const testnetCoinProfiles: Record<string, CoinProfile> = {
  'BTCUSDT': {
    symbol: 'BTCUSDT',
    volatility: 'low',
    strategy: 'momentum',
    meanReversionPeriod: 12,
    deviationThreshold: 1.5,
    stopLossPercentage: 3.0,
    takeProfitPercentage: 4.5,
    trailingStopPercentage: 2.0,
    positionSizePercentage: 15,
    maxOpenPositions: 4,
    gridLevels: 8,
    gridSpacingPercentage: 1.2,
    description: 'Testnet Bitcoin - momentum strategy for trend following'
  },
  'SOLUSDT': {
    symbol: 'SOLUSDT',
    volatility: 'medium',
    strategy: 'gridTrading',
    meanReversionPeriod: 18,
    deviationThreshold: 2.0,
    stopLossPercentage: 3.5,
    takeProfitPercentage: 5.0,
    trailingStopPercentage: 2.5,
    positionSizePercentage: 12,
    maxOpenPositions: 5,
    gridLevels: 10,
    gridSpacingPercentage: 1.5,
    description: 'Testnet Solana - grid trading for volatility capture ($10K scale)'
  },
  'ADAUSDT': {
    symbol: 'ADAUSDT',
    volatility: 'high',
    strategy: 'momentum',
    meanReversionPeriod: 22,
    deviationThreshold: 2.5,
    stopLossPercentage: 4.0,
    takeProfitPercentage: 6.0,
    trailingStopPercentage: 3.0,
    positionSizePercentage: 10,
    maxOpenPositions: 6,
    gridLevels: 8,
    gridSpacingPercentage: 2.0,
    description: 'Testnet Cardano - momentum strategy for trend following ($10K scale)'
  },
  'XRPUSDT': {
    symbol: 'XRPUSDT',
    volatility: 'high',
    strategy: 'meanReversion',
    meanReversionPeriod: 20,
    deviationThreshold: 2.3,
    stopLossPercentage: 4.5,
    takeProfitPercentage: 6.5,
    trailingStopPercentage: 3.0,
    positionSizePercentage: 13,
    maxOpenPositions: 5,
    gridLevels: 9,
    gridSpacingPercentage: 1.8,
    description: 'Testnet XRP - moderate volatility settings for $10K testing'
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
    initialCapital: parseFloat(process.env.INITIAL_CAPITAL || '10000'),
    dailyProfitTarget: parseFloat(process.env.DAILY_PROFIT_TARGET || '200'),
    maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || '500'),
    
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
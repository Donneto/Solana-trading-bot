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
    strategy: 'gridTrading',
    meanReversionPeriod: 12,
    deviationThreshold: 1.5,
    stopLossPercentage: 3.0,
    takeProfitPercentage: 4.5,
    trailingStopPercentage: 2.0,
    positionSizePercentage: 15,
    maxOpenPositions: 4,
    gridLevels: 8,
    gridSpacingPercentage: 0.5,
    description: 'Testnet Bitcoin - grid trading strategy for low volatility institutional trading'
  },
  'SOLUSDT': {
    symbol: 'SOLUSDT',
    volatility: 'medium',
    strategy: 'meanReversion',
    meanReversionPeriod: 18,
    deviationThreshold: 2.0,
    stopLossPercentage: 3.5,
    takeProfitPercentage: 5.0,
    trailingStopPercentage: 2.5,
    positionSizePercentage: 12,
    maxOpenPositions: 5,
    gridLevels: 10,
    gridSpacingPercentage: 0.5,
    description: 'Testnet Solana - mean reversion strategy for balanced volatility patterns'
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
    positionSizePercentage: 2,
    maxOpenPositions: 3,
    gridLevels: 8,
    gridSpacingPercentage: 0.5,
    description: 'Testnet Cardano - momentum strategy for high volatility trend movements'
  },
  'XRPUSDT': {
    symbol: 'XRPUSDT',
    volatility: 'high',
    strategy: 'momentum',
    meanReversionPeriod: 20,
    deviationThreshold: 2.3,
    stopLossPercentage: 4.5,
    takeProfitPercentage: 6.5,
    trailingStopPercentage: 3.0,
    positionSizePercentage: 13,
    maxOpenPositions: 5,
    gridLevels: 9,
    gridSpacingPercentage: 0.5,
    description: 'Testnet XRP - momentum strategy for news-driven volatility and quick trends'
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

export function createTestnetConfig(tradingSymbol: string, actualBalance?: number): TradingConfig {
  const coinProfile = getTestnetCoinProfile(tradingSymbol);
  
  // REQUIRE actual balance - no fallbacks
  if (!actualBalance) {
    throw new Error('Actual testnet balance is required - no fallback values allowed');
  }
  
  return {
    symbol: tradingSymbol,
    initialCapital: actualBalance,
    dailyProfitTarget: actualBalance * 0.02, // 2% of actual balance
    maxDailyLoss: actualBalance * 0.05, // 5% of actual balance
    
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
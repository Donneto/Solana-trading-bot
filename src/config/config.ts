import dotenv from 'dotenv';
import { TradingConfig, BinanceCredentials, FearGreedConfig } from '../interfaces/trading';
import fs from 'fs';
import path from 'path';

// Trading profiles for different cryptocurrencies
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

const coinProfiles: Record<string, CoinProfile> = {
  'BTCUSDT': {
    symbol: 'BTCUSDT',
    volatility: 'low',
    meanReversionPeriod: 14,
    deviationThreshold: 1.5,
    stopLossPercentage: 1.5,
    takeProfitPercentage: 2.5,
    trailingStopPercentage: 1.0,
    positionSizePercentage: 15,
    maxOpenPositions: 2,
    description: 'Conservative settings for Bitcoin - lower volatility, institutional trading'
  },
  'SOLUSDT': {
    symbol: 'SOLUSDT',
    volatility: 'medium',
    meanReversionPeriod: 20,
    deviationThreshold: 2.0,
    stopLossPercentage: 2.0,
    takeProfitPercentage: 3.0,
    trailingStopPercentage: 1.5,
    positionSizePercentage: 10,
    maxOpenPositions: 3,
    description: 'Balanced settings for Solana - medium volatility, good mean reversion'
  },
  'ADAUSDT': {
    symbol: 'ADAUSDT',
    volatility: 'high',
    meanReversionPeriod: 25,
    deviationThreshold: 2.5,
    stopLossPercentage: 2.5,
    takeProfitPercentage: 4.0,
    trailingStopPercentage: 2.0,
    positionSizePercentage: 8,
    maxOpenPositions: 4,
    description: 'Higher volatility settings for Cardano - wider bands, more positions'
  },
  'XRPUSDT': {
    symbol: 'XRPUSDT',
    volatility: 'high',
    meanReversionPeriod: 22,
    deviationThreshold: 2.3,
    stopLossPercentage: 2.2,
    takeProfitPercentage: 3.5,
    trailingStopPercentage: 1.8,
    positionSizePercentage: 9,
    maxOpenPositions: 4,
    description: 'Aggressive settings for XRP - regulatory news volatility, quick reversions'
  }
};

// Load environment variables with smart file detection
function loadEnvironment() {
  // First load default .env to check if testnet is enabled
  dotenv.config();
  
  // If testnet is enabled, try to load testnet.env
  if (process.env.BINANCE_TESTNET === 'true') {
    const testnetEnvPath = path.join(process.cwd(), 'testnet.env');
    if (fs.existsSync(testnetEnvPath)) {
      console.log('🧪 Loading testnet configuration from testnet.env');
      dotenv.config({ path: testnetEnvPath, override: true });
    } else {
      console.log('⚠️  testnet.env not found, using .env with testnet=true');
    }
  } else {
    console.log('🚀 Loading live trading configuration from .env');
  }
}

// Get coin profile or default values
function getCoinProfile(symbol: string): CoinProfile {
  const normalizedSymbol = symbol.toUpperCase();
  const profile = coinProfiles[normalizedSymbol];
  if (profile) {
    console.log(`🎯 Loading ${symbol} profile: ${profile.description}`);
    return profile;
  } else {
    console.log(`⚠️  No profile found for ${symbol}, using SOL defaults`);
    // Fallback to SOL profile (guaranteed to exist)
    const defaultProfile = coinProfiles['SOLUSDT'];
    if (!defaultProfile) {
      throw new Error('Default SOL profile not found');
    }
    return defaultProfile;
  }
}

// Load the appropriate environment
loadEnvironment();

// Get trading symbol - this will be set by command line or environment
let tradingSymbol = process.env.TRADING_SYMBOL || 'SOLUSDT';

// Function to set trading symbol from command line
export function setTradingSymbol(symbol: string): void {
  tradingSymbol = symbol;
  // Update the config with new symbol
  config = createConfig();
}

// Function to get current coin profile
function getCurrentCoinProfile(): CoinProfile {
  return getCoinProfile(tradingSymbol);
}

// Function to create configuration (called after symbol is potentially updated)
function createConfig(): TradingConfig {
  const coinProfile = getCurrentCoinProfile();
  
  return {
    symbol: tradingSymbol,
    initialCapital: parseFloat(process.env.INITIAL_CAPITAL || '300'),
    dailyProfitTarget: parseFloat(process.env.DAILY_PROFIT_TARGET || '12'),
    maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || '30'),
    
    // Use coin profile values with environment overrides
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

// Get config function that returns current configuration
export function getConfig(): TradingConfig {
  return createConfig();
}

// Initialize with default config
export let config = createConfig();

export const fearGreedConfig: FearGreedConfig = {
  enabled: process.env.FEAR_GREED_INDEX_ENABLED === 'true',
  apiKey: process.env.COINMARKETCAP_API_KEY || '',
  cacheExpiryHours: parseInt(process.env.FEAR_GREED_CACHE_HOURS || '12'),
  retryAttempts: parseInt(process.env.FEAR_GREED_RETRY_ATTEMPTS || '3'),
  retryDelayMs: parseInt(process.env.FEAR_GREED_RETRY_DELAY || '5000'),
  fallbackToScraper: process.env.FEAR_GREED_FALLBACK_SCRAPER === 'true',
  scrapingUrl: 'https://coinmarketcap.com/fear-and-greed/'
};

export const binanceConfig: BinanceCredentials = {
  apiKey: process.env.BINANCE_API_KEY || '',
  apiSecret: process.env.BINANCE_API_SECRET || '',
  testnet: process.env.BINANCE_TESTNET === 'true',
};

// Display configuration summary
function displayConfigSummary(): void {
  const currentConfig = getConfig();
  const coinProfile = getCurrentCoinProfile();
  
  console.log(`💰 Capital: $${currentConfig.initialCapital} | Target: $${currentConfig.dailyProfitTarget}/day | Max Loss: $${currentConfig.maxDailyLoss}/day`);
  console.log(`📊 Mode: ${binanceConfig.testnet ? 'TESTNET' : 'LIVE TRADING'} | Coin: ${currentConfig.symbol} (${coinProfile.volatility} vol) | Position Size: ${currentConfig.positionSizePercentage}%`);
  console.log(`⚙️  Profile: Bollinger(${currentConfig.meanReversionPeriod}, ${currentConfig.deviationThreshold}) | Stop: ${currentConfig.stopLossPercentage}% | Take: ${currentConfig.takeProfitPercentage}%`);
}

export const validateConfig = (): void => {
  const currentConfig = getConfig();
  
  if (!binanceConfig.apiKey || !binanceConfig.apiSecret) {
    throw new Error('Binance API credentials are required');
  }
  
  if (currentConfig.initialCapital <= 0) {
    throw new Error('Initial capital must be greater than 0');
  }
  
  if (currentConfig.dailyProfitTarget <= 0) {
    throw new Error('Daily profit target must be greater than 0');
  }
  
  if (currentConfig.stopLossPercentage <= 0 || currentConfig.stopLossPercentage >= 100) {
    throw new Error('Stop loss percentage must be between 0 and 100');
  }
  
  if (currentConfig.takeProfitPercentage <= 0 || currentConfig.takeProfitPercentage >= 100) {
    throw new Error('Take profit percentage must be between 0 and 100');
  }
  
  // Display configuration after validation
  displayConfigSummary();
};
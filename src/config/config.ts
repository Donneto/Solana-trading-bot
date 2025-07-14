import dotenv from 'dotenv';
import { TradingConfig, BinanceCredentials, FearGreedConfig } from '../interfaces/trading';
import fs from 'fs';
import path from 'path';
import { createTestnetConfig, getTestnetBinanceConfig, getTestnetFearGreedConfig } from './testnet.config';
import { createProductionConfig, getProductionBinanceConfig, getProductionFearGreedConfig } from './production.config';

// Environment detection and loading
function loadEnvironment(): 'testnet' | 'production' {
  // Preserve CLI-set environment variables before loading files
  const cliTradingSymbol = process.env.TRADING_SYMBOL;
  
  // Load base .env first
  dotenv.config();
  
  const tradingEnv = process.env.TRADING_ENV || process.env.NODE_ENV || 'testnet';
  
  if (tradingEnv === 'production') {
    // Load production environment
    const prodEnvPath = path.join(process.cwd(), '.env.production');
    if (fs.existsSync(prodEnvPath)) {
      console.log('🚀 Loading production configuration from .env.production');
      dotenv.config({ path: prodEnvPath, override: true });
    } else {
      console.log('⚠️  .env.production not found, using .env');
    }
    
    // Restore CLI-set variables
    if (cliTradingSymbol) {
      process.env.TRADING_SYMBOL = cliTradingSymbol;
    }
    
    return 'production';
  } else {
    // Load testnet environment (default)
    const testnetEnvPath = path.join(process.cwd(), '.env.testnet');
    if (fs.existsSync(testnetEnvPath)) {
      console.log('🧪 Loading testnet configuration from .env.testnet');
      dotenv.config({ path: testnetEnvPath, override: true });
    } else {
      console.log('⚠️  .env.testnet not found, using .env with testnet defaults');
    }
    
    // Restore CLI-set variables
    if (cliTradingSymbol) {
      process.env.TRADING_SYMBOL = cliTradingSymbol;
    }
    
    return 'testnet';
  }
}

// Load the appropriate environment
const currentEnvironment = loadEnvironment();

// Get trading symbol - this will be set by command line or environment
let tradingSymbol = process.env.TRADING_SYMBOL || 'SOLUSDT';

// Function to set trading symbol from command line
export function setTradingSymbol(symbol: string): void {
  tradingSymbol = symbol;
  // Update environment variable so logger can pick it up
  process.env.TRADING_SYMBOL = symbol;
  // Update the config with new symbol
  config = createConfig();
}

// Function to create configuration based on environment
function createConfig(): TradingConfig {
  if (currentEnvironment === 'production') {
    return createProductionConfig(tradingSymbol);
  } else {
    return createTestnetConfig(tradingSymbol);
  }
}

// Get config function that returns current configuration
export function getConfig(): TradingConfig {
  return createConfig();
}

// Initialize with default config
export let config = createConfig();

// Export environment-specific configurations
export function getFearGreedConfig(): FearGreedConfig {
  return currentEnvironment === 'production'
    ? getProductionFearGreedConfig() 
    : getTestnetFearGreedConfig();
}
export function getBinanceConfig(): BinanceCredentials {
  return currentEnvironment === 'production'
    ? getProductionBinanceConfig()
    : getTestnetBinanceConfig();
}

// Legacy exports for backward compatibility
export const fearGreedConfig: FearGreedConfig = getFearGreedConfig();
export const binanceConfig: BinanceCredentials = getBinanceConfig();

// Display configuration summary
function displayConfigSummary(): void {
  const currentConfig = getConfig();
  const envLabel = currentEnvironment === 'production' ? 'LIVE TRADING' : 'TESTNET';
  
  console.log(`💰 Capital: $${currentConfig.initialCapital} | Target: $${currentConfig.dailyProfitTarget}/day | Max Loss: $${currentConfig.maxDailyLoss}/day`);
  console.log(`📊 Mode: ${envLabel} | Coin: ${currentConfig.symbol} | Position Size: ${currentConfig.positionSizePercentage}%`);
  console.log(`⚙️  Strategy: Bollinger(${currentConfig.meanReversionPeriod}, ${currentConfig.deviationThreshold}) | Stop: ${currentConfig.stopLossPercentage}% | Take: ${currentConfig.takeProfitPercentage}%`);
}

export const validateConfig = (): void => {
  const currentConfig = getConfig();
  const currentBinanceConfig = getBinanceConfig();
  
  if (!currentBinanceConfig.apiKey || !currentBinanceConfig.apiSecret) {
    console.error('❌ Configuration Error: Binance API credentials are missing');
    console.error('🔍 Current environment:', currentEnvironment);
    console.error('🔍 API Key present:', !!currentBinanceConfig.apiKey);
    console.error('🔍 API Secret present:', !!currentBinanceConfig.apiSecret);
    console.error('');
    console.error('💡 Possible solutions:');
    console.error('   1. Check your .env.testnet file has valid API credentials');
    console.error('   2. Use correct syntax: npm run dev -- TICKER');
    console.error('   3. Or use: TRADING_SYMBOL=TICKER npm run dev');
    console.error('');
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
  
  // Production-specific validations
  if (currentEnvironment === 'production') {
    if (currentConfig.positionSizePercentage > 15) {
      throw new Error('Production mode: Position size cannot exceed 15% for safety');
    }
    if (currentConfig.maxDailyLoss > currentConfig.initialCapital * 0.2) {
      throw new Error('Production mode: Max daily loss cannot exceed 20% of initial capital');
    }
  }
  
  // Display configuration after validation
  displayConfigSummary();
};
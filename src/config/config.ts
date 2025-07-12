import dotenv from 'dotenv';
import { TradingConfig, BinanceCredentials } from '../interfaces/trading';

dotenv.config();

export const config: TradingConfig = {
  symbol: process.env.TRADING_SYMBOL || 'SOLUSDT',
  initialCapital: parseFloat(process.env.INITIAL_CAPITAL || '300'),
  dailyProfitTarget: parseFloat(process.env.DAILY_PROFIT_TARGET || '12'),
  maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS || '30'),
  positionSizePercentage: parseFloat(process.env.POSITION_SIZE_PERCENTAGE || '10'),
  
  stopLossPercentage: parseFloat(process.env.STOP_LOSS_PERCENTAGE || '2'),
  takeProfitPercentage: parseFloat(process.env.TAKE_PROFIT_PERCENTAGE || '3'),
  trailingStopPercentage: parseFloat(process.env.TRAILING_STOP_PERCENTAGE || '1.5'),
  maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '3'),
  
  meanReversionPeriod: parseInt(process.env.MEAN_REVERSION_PERIOD || '20'),
  deviationThreshold: parseFloat(process.env.DEVIATION_THRESHOLD || '2'),
  gridLevels: parseInt(process.env.GRID_LEVELS || '5'),
  gridSpacingPercentage: parseFloat(process.env.GRID_SPACING_PERCENTAGE || '0.5'),
};

export const binanceConfig: BinanceCredentials = {
  apiKey: process.env.BINANCE_API_KEY || '',
  apiSecret: process.env.BINANCE_API_SECRET || '',
  testnet: process.env.BINANCE_TESTNET === 'true',
};

export const validateConfig = (): void => {
  if (!binanceConfig.apiKey || !binanceConfig.apiSecret) {
    throw new Error('Binance API credentials are required');
  }
  
  if (config.initialCapital <= 0) {
    throw new Error('Initial capital must be greater than 0');
  }
  
  if (config.dailyProfitTarget <= 0) {
    throw new Error('Daily profit target must be greater than 0');
  }
  
  if (config.stopLossPercentage <= 0 || config.stopLossPercentage >= 100) {
    throw new Error('Stop loss percentage must be between 0 and 100');
  }
  
  if (config.takeProfitPercentage <= 0 || config.takeProfitPercentage >= 100) {
    throw new Error('Take profit percentage must be between 0 and 100');
  }
};
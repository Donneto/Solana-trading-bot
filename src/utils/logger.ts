import winston from 'winston';
import fs from 'fs';
import path from 'path';

// Environment context detection - now dynamic
function getEnvironmentContext(): string {
  // Check new environment system first, then fallback to legacy
  const tradingEnv = process.env.TRADING_ENV;
  const isTestnet = tradingEnv === 'testnet' || process.env.BINANCE_TESTNET === 'true';
  const nodeEnv = process.env.NODE_ENV || 'development';
  
  // Get the symbol from environment, fallback to detecting from config
  let symbol = process.env.TRADING_SYMBOL;
  if (!symbol) {
    // Try to read from the binance config if loaded
    try {
      const config = require('../config/config');
      symbol = config?.config?.symbol || 'UNKNOWN';
    } catch {
      symbol = 'UNKNOWN';
    }
  }
  
  // Detect if we're running in a test
  const isTest = nodeEnv === 'test' || 
                 process.env.JEST_WORKER_ID !== undefined ||
                 process.argv.some(arg => arg.includes('jest')) ||
                 process.argv.some(arg => arg.includes('test'));
  
  if (isTest) {
    return '[TEST]';
  } else if (isTestnet) {
    return `[TESTNET-${symbol}]`;
  } else {
    return `[LIVE-${symbol}]`;
  }
}

// Get current trading symbol for log file naming
function getCurrentSymbol(): string {
  // Always get fresh symbol from environment or config
  let symbol = process.env.TRADING_SYMBOL;
  if (!symbol) {
    try {
      // Clear require cache to get fresh config
      delete require.cache[require.resolve('../config/config')];
      const config = require('../config/config');
      symbol = config?.config?.symbol;
    } catch {
      // Fallback if config loading fails
    }
  }
  return symbol || 'UNKNOWN';
}

// Ensure logs directory exists
function ensureLogsDirectory(): void {
  const logsDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }
}

// Create ticker-specific log file paths
function getLogFilePaths(symbol?: string): { tradingLog: string; errorLog: string } {
  ensureLogsDirectory();
  const currentSymbol = symbol || getCurrentSymbol();
  
  // For tests, use generic names to avoid cluttering with many test files
  const isTest = process.env.NODE_ENV === 'test' || 
                 process.env.JEST_WORKER_ID !== undefined ||
                 process.argv.some(arg => arg.includes('jest')) ||
                 process.argv.some(arg => arg.includes('test'));
  
  if (isTest) {
    return {
      tradingLog: 'logs/trading-test.log',
      errorLog: 'logs/error-test.log'
    };
  }
  
  return {
    tradingLog: `logs/trading-${currentSymbol}.log`,
    errorLog: `logs/error-${currentSymbol}.log`
  };
}

// Cache for logger instances per symbol
const loggerCache = new Map<string, winston.Logger>();

// Create or get logger for specific symbol
function getLoggerForSymbol(symbol?: string): winston.Logger {
  const currentSymbol = symbol || getCurrentSymbol();
  
  // Return cached logger if exists
  if (loggerCache.has(currentSymbol)) {
    return loggerCache.get(currentSymbol)!;
  }
  
  // Create new logger for this symbol
  const logFilePaths = getLogFilePaths(currentSymbol);
  
  const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ level, message, timestamp, stack }) => {
      // Get environment context dynamically for each log entry - this ensures current symbol
      const environmentContext = getEnvironmentContext();
      return `${timestamp} ${environmentContext} [${level.toUpperCase()}]: ${stack || message}`;
    })
  );
  
  const symbolLogger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: logFormat,
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          logFormat
        )
      }),
      new winston.transports.File({
        filename: logFilePaths.errorLog,
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5,
      }),
      new winston.transports.File({
        filename: logFilePaths.tradingLog,
        maxsize: 5242880, // 5MB
        maxFiles: 10,
      }),
    ],
  });
  
  // Cache the logger
  loggerCache.set(currentSymbol, symbolLogger);
  return symbolLogger;
}

// Default logger (backwards compatibility) - uses current symbol
export let logger = getLoggerForSymbol();

// Function to refresh logger when trading symbol changes
export function refreshLogger(): void {
  // Clear the old logger from cache to force recreation
  const currentSymbol = getCurrentSymbol();
  if (loggerCache.has(currentSymbol)) {
    loggerCache.delete(currentSymbol);
  }
  // Re-export the logger with new symbol
  logger = getLoggerForSymbol();
}

export class TradingLogger {
  static logTrade(action: string, details: any, symbol?: string): void {
    const environmentContext = getEnvironmentContext();
    const targetLogger = symbol ? getLoggerForSymbol(symbol) : logger;
    targetLogger.info(`TRADE: ${action}`, { ...details, type: 'TRADE', environment: environmentContext });
  }
  
  static logSignal(signal: any, symbol?: string): void {
    const environmentContext = getEnvironmentContext();
    const targetLogger = symbol ? getLoggerForSymbol(symbol) : logger;
    targetLogger.info(`SIGNAL: ${signal.action}`, { ...signal, type: 'SIGNAL', environment: environmentContext });
  }
  
  static logRisk(message: string, data: any, symbol?: string): void {
    const environmentContext = getEnvironmentContext();
    const targetLogger = symbol ? getLoggerForSymbol(symbol) : logger;
    targetLogger.warn(`RISK: ${message}`, { ...data, type: 'RISK', environment: environmentContext });
  }
  
  static logError(error: Error, context?: any, symbol?: string): void {
    const environmentContext = getEnvironmentContext();
    const targetLogger = symbol ? getLoggerForSymbol(symbol) : logger;
    targetLogger.error('ERROR', { error: error.message, stack: error.stack, context, type: 'ERROR', environment: environmentContext });
  }
  
  static logPerformance(metrics: any, symbol?: string): void {
    const environmentContext = getEnvironmentContext();
    const targetLogger = symbol ? getLoggerForSymbol(symbol) : logger;
    targetLogger.info('PERFORMANCE', { ...metrics, type: 'PERFORMANCE', environment: environmentContext });
  }
}

// Export environment context getter for use in other modules
export { getEnvironmentContext, getLoggerForSymbol };
import winston from 'winston';

// Environment context detection - now dynamic
function getEnvironmentContext(): string {
  const isTestnet = process.env.BINANCE_TESTNET === 'true';
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

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    // Get environment context dynamically for each log entry
    const environmentContext = getEnvironmentContext();
    return `${timestamp} ${environmentContext} [${level.toUpperCase()}]: ${stack || message}`;
  })
);

export const logger = winston.createLogger({
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
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: 'logs/trading.log',
      maxsize: 5242880, // 5MB
      maxFiles: 10,
    }),
  ],
});

export class TradingLogger {
  static logTrade(action: string, details: any): void {
    const environmentContext = getEnvironmentContext();
    logger.info(`TRADE: ${action}`, { ...details, type: 'TRADE', environment: environmentContext });
  }
  
  static logSignal(signal: any): void {
    const environmentContext = getEnvironmentContext();
    logger.info(`SIGNAL: ${signal.action}`, { ...signal, type: 'SIGNAL', environment: environmentContext });
  }
  
  static logRisk(message: string, data: any): void {
    const environmentContext = getEnvironmentContext();
    logger.warn(`RISK: ${message}`, { ...data, type: 'RISK', environment: environmentContext });
  }
  
  static logError(error: Error, context?: any): void {
    const environmentContext = getEnvironmentContext();
    logger.error('ERROR', { error: error.message, stack: error.stack, context, type: 'ERROR', environment: environmentContext });
  }
  
  static logPerformance(metrics: any): void {
    const environmentContext = getEnvironmentContext();
    logger.info('PERFORMANCE', { ...metrics, type: 'PERFORMANCE', environment: environmentContext });
  }
}

// Export environment context getter for use in other modules
export { getEnvironmentContext };
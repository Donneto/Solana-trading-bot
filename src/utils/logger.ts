import winston from 'winston';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, stack }) => {
    return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
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
    logger.info(`TRADE: ${action}`, { ...details, type: 'TRADE' });
  }
  
  static logSignal(signal: any): void {
    logger.info(`SIGNAL: ${signal.action}`, { ...signal, type: 'SIGNAL' });
  }
  
  static logRisk(message: string, data: any): void {
    logger.warn(`RISK: ${message}`, { ...data, type: 'RISK' });
  }
  
  static logError(error: Error, context?: any): void {
    logger.error('ERROR', { error: error.message, stack: error.stack, context, type: 'ERROR' });
  }
  
  static logPerformance(metrics: any): void {
    logger.info('PERFORMANCE', { ...metrics, type: 'PERFORMANCE' });
  }
}
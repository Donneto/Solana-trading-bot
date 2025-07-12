import { TerminalInterface } from './interfaces/terminalInterface';
import { validateConfig } from './config/config';
import { logger } from './utils/logger';

async function main() {
  try {
    // Validate configuration
    validateConfig();
    
    // Create and start terminal interface
    const terminal = new TerminalInterface();
    await terminal.start();
    
  } catch (error) {
    logger.error('Application startup failed:', error);
    console.error('Failed to start trading bot:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  process.exit(0);
});

main();
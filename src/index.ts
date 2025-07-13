import { TerminalInterface } from './interfaces/terminalInterface';
import { validateConfig, setTradingSymbol } from './config/config';
import { logger } from './utils/logger';

function parseCommandLineArgs(): string | null {
  const args = process.argv.slice(2);
  
  // Check for ticker argument (first positional argument or --ticker flag)
  if (args.length > 0) {
    // If first argument doesn't start with '-', treat it as ticker
    const firstArg = args[0];
    if (firstArg && !firstArg.startsWith('-')) {
      return firstArg.toUpperCase();
    }
    
    // Look for --ticker flag
    const tickerIndex = args.findIndex(arg => arg === '--ticker' || arg === '-t');
    if (tickerIndex !== -1 && tickerIndex + 1 < args.length) {
      const tickerValue = args[tickerIndex + 1];
      if (tickerValue) {
        return tickerValue.toUpperCase();
      }
    }
  }
  
  return null;
}

function showUsage() {
  console.log('Usage: npm start [TICKER] or npm start --ticker TICKER');
  console.log('Examples:');
  console.log('  npm start BTCUSDT');
  console.log('  npm start --ticker SOLUSDT');
  console.log('  npm start -t ADAUSDT');
  console.log('');
  console.log('Available tickers: BTCUSDT, SOLUSDT, ADAUSDT, XRPUSDT');
}

async function main() {
  try {
    // Parse command line arguments
    const ticker = parseCommandLineArgs();
    
    // Show usage if --help is provided
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      showUsage();
      process.exit(0);
    }
    
    // Set trading symbol if provided
    if (ticker) {
      setTradingSymbol(ticker);
    }
    
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
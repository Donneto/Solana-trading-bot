import chalk from 'chalk';
import inquirer from 'inquirer';
import { TradingEngine } from '../services/tradingEngine';
import { BinanceService } from '../services/binance/binanceService';
import { config, binanceConfig } from '../config/config';
import { MarketData, Position, RiskMetrics } from '../interfaces/trading';
import { fearGreedService } from '../services/fearGreed/fearGreedService';

export class TerminalInterface {
  private tradingEngine: TradingEngine;
  private binanceService: BinanceService;
  private refreshInterval: NodeJS.Timeout | null = null;
  private isDisplaying: boolean = false;

  constructor() {
    this.binanceService = new BinanceService(binanceConfig);
    this.tradingEngine = new TradingEngine(this.binanceService, config);
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    this.tradingEngine.on('started', () => {
      this.logInfo('Trading engine started successfully');
    });

    this.tradingEngine.on('stopped', () => {
      this.logInfo('Trading engine stopped');
    });

    this.tradingEngine.on('emergencyShutdown', () => {
      this.logError('EMERGENCY SHUTDOWN ACTIVATED');
    });

    this.tradingEngine.on('tradeExecuted', (data) => {
      this.logSuccess(`Trade executed: ${data.position.side} ${data.position.quantity} at ${data.position.entryPrice}`);
    });

    this.tradingEngine.on('positionClosed', (data) => {
      this.logInfo(`Position closed: ${data.reason}, PnL: ${data.position.unrealizedPnL.toFixed(2)}`);
    });

    this.tradingEngine.on('dailyProfitTargetReached', (pnl) => {
      this.logSuccess(`Daily profit target reached: $${pnl.toFixed(2)}`);
    });

    this.tradingEngine.on('dailyLossLimitReached', (pnl) => {
      this.logError(`Daily loss limit reached: $${pnl.toFixed(2)}`);
    });
  }

  async start(): Promise<void> {
    // Add simple Ctrl+C handler for immediate exit
    process.on('SIGINT', () => {
      console.log('\n\nGoodbye!');
      process.exit(0);
    });

    this.clearScreen();
    this.displayBanner();
    
    try {
      await this.showMainMenu();
    } catch (error) {
      this.logError(`Application error: ${error}`);
      process.exit(1);
    }
  }

  private clearScreen(): void {
    console.clear();
  }

  private displayBanner(): void {
    const envStatus = binanceConfig.testnet ? '🧪 TESTNET' : '🚀 LIVE TRADING';
    const ticker = config.symbol;
    const statusLine = `${envStatus} | Trading: ${ticker}`;
    
    console.log(chalk.cyan('╔══════════════════════════════════════════════════════════════╗'));
    console.log(chalk.cyan('║') + chalk.yellow.bold('              ENTERPRISE CRYPTO TRADING BOT                  ') + chalk.cyan('║'));
    console.log(chalk.cyan('║') + chalk.white('                  Mean Reversion Strategy                     ') + chalk.cyan('║'));
    console.log(chalk.cyan('║') + chalk.white(statusLine.padStart(Math.floor((62 + statusLine.length) / 2)).padEnd(62)) + chalk.cyan('║'));
    console.log(chalk.cyan('╚══════════════════════════════════════════════════════════════╝'));
    console.log();
  }

  private async showMainMenu(): Promise<void> {
    const choices = [
      'Start Trading',
      'View Configuration',
      'View Account Status',
      'Run Backtest',
      'Live Monitor',
      'Emergency Stop',
      'Exit'
    ];

    const answer = await inquirer.prompt({
      type: 'list',
      name: 'action',
      message: 'Select an action:',
      choices
    });

    switch (answer.action) {
      case 'Start Trading':
        await this.startTrading();
        break;
      case 'View Configuration':
        await this.viewConfiguration();
        break;
      case 'View Account Status':
        await this.viewAccountStatus();
        break;
      case 'Run Backtest':
        await this.runBacktest();
        break;
      case 'Live Monitor':
        await this.startLiveMonitor();
        break;
      case 'Emergency Stop':
        await this.emergencyStop();
        break;
      case 'Exit':
        // Immediate termination - no await, no async
        console.log('Goodbye!');
        process.exit(0);
    }
  }

  private async startTrading(): Promise<void> {
    try {
      this.logInfo('Initializing trading engine...');
      
      const confirmation = await inquirer.prompt({
        type: 'confirm',
        name: 'proceed',
        message: chalk.yellow('Are you sure you want to start live trading? This will use real money.'),
        default: false
      });

      if (!confirmation.proceed) {
        await this.showMainMenu();
        return;
      }

      await this.tradingEngine.start();
      await this.startLiveMonitor();
      
    } catch (error) {
      this.logError(`Failed to start trading: ${error}`);
      await this.pressAnyKey();
      await this.showMainMenu();
    }
  }

  private async viewConfiguration(): Promise<void> {
    console.log(chalk.blue('\n📊 Trading Configuration:'));
    console.log(chalk.white('━'.repeat(50)));
    
    const configs = [
      ['Environment', binanceConfig.testnet ? chalk.yellow('🧪 TESTNET') : chalk.red('🚀 LIVE TRADING')],
      ['Symbol', config.symbol],
      ['Initial Capital', `$${config.initialCapital.toLocaleString()}`],
      ['Daily Profit Target', `$${config.dailyProfitTarget}`],
      ['Max Daily Loss', `$${config.maxDailyLoss}`],
      ['Position Size', `${config.positionSizePercentage}%`],
      ['Stop Loss', `${config.stopLossPercentage}%`],
      ['Take Profit', `${config.takeProfitPercentage}%`],
      ['Trailing Stop', `${config.trailingStopPercentage}%`],
      ['Max Positions', config.maxOpenPositions],
      ['Fear & Greed Index', config.fearGreedIndexEnabled ? chalk.green('ENABLED') : chalk.gray('DISABLED')],
      ['Strategy', 'Mean Reversion + Live Market Data'],
      ['Risk Level', binanceConfig.testnet ? 'Safe (Fake Money)' : 'Real Money']
    ];

    configs.forEach(([key, value]) => {
      const keyStr = String(key);
      console.log(`${chalk.gray(keyStr.padEnd(20))} : ${chalk.white(value)}`);
    });

    await this.pressAnyKey();
    await this.showMainMenu();
  }

  private async viewAccountStatus(): Promise<void> {
    try {
      this.logInfo('Fetching account information...');
      
      const isConnected = await this.binanceService.validateConnection();
      if (!isConnected) {
        this.logError('Failed to connect to Binance API');
        await this.pressAnyKey();
        await this.showMainMenu();
        return;
      }

      const balance = await this.binanceService.getAccountBalance('USDT');
      const solBalance = await this.binanceService.getAccountBalance('SOL').catch(() => 0);
      const currentPrice = await this.binanceService.getCurrentPrice(config.symbol);
      const marketStats = await this.binanceService.get24hrStats(config.symbol);

      console.log(chalk.blue('\n💰 Account Status:'));
      console.log(chalk.white('━'.repeat(50)));
      console.log(`${chalk.gray('USDT Balance'.padEnd(20))} : ${chalk.green('$' + balance.toFixed(2))}`);
      console.log(`${chalk.gray('SOL Balance'.padEnd(20))} : ${chalk.green(solBalance.toFixed(6) + ' SOL')}`);
      console.log(`${chalk.gray('Total Value'.padEnd(20))} : ${chalk.green('$' + (balance + (solBalance * currentPrice)).toFixed(2))}`);
      
      console.log(chalk.blue('\n📈 Market Data:'));
      console.log(chalk.white('━'.repeat(50)));
      console.log(`${chalk.gray('Current Price'.padEnd(20))} : ${chalk.white('$' + currentPrice.toFixed(2))}`);
      console.log(`${chalk.gray('24h Change'.padEnd(20))} : ${marketStats.change24h >= 0 ? chalk.green('+' + marketStats.change24h.toFixed(2) + '%') : chalk.red(marketStats.change24h.toFixed(2) + '%')}`);
      console.log(`${chalk.gray('24h High'.padEnd(20))} : ${chalk.white('$' + marketStats.high24h.toFixed(2))}`);
      console.log(`${chalk.gray('24h Low'.padEnd(20))} : ${chalk.white('$' + marketStats.low24h.toFixed(2))}`);
      console.log(`${chalk.gray('24h Volume'.padEnd(20))} : ${chalk.white(marketStats.volume.toLocaleString())}`);

    } catch (error) {
      this.logError(`Failed to fetch account status: ${error}`);
    }

    await this.pressAnyKey();
    await this.showMainMenu();
  }

  private async runBacktest(): Promise<void> {
    this.logInfo('Backtesting feature coming soon...');
    this.logInfo('This would test the strategy against historical data');
    
    await this.pressAnyKey();
    await this.showMainMenu();
  }

  private async startLiveMonitor(): Promise<void> {
    this.isDisplaying = true;
    
    const envStatus = binanceConfig.testnet ? chalk.yellow('🧪 TESTNET') : chalk.red('🚀 LIVE');
    const ticker = chalk.cyan(config.symbol);
    
    console.log(chalk.blue('\n🎯 Live Trading Monitor'));
    console.log(`${envStatus} | Trading: ${ticker}`);
    console.log(chalk.gray('Press Ctrl+C to return to main menu\n'));

    this.refreshInterval = setInterval(() => {
      if (this.isDisplaying) {
        this.displayLiveData();
      }
    }, 1000);

    // Handle Ctrl+C - simple and clean
    const handleExit = () => {
      this.stopLiveMonitor();
      process.removeAllListeners('SIGINT');
      console.log(chalk.yellow('\n\nReturning to main menu...'));
      setTimeout(() => this.showMainMenu(), 100);
    };
    
    process.on('SIGINT', handleExit);
  }

  private stopLiveMonitor(): void {
    this.isDisplaying = false;
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  private displayLiveData(): void {
    if (!this.isDisplaying) return;

    // Clear previous display
    process.stdout.write('\x1B[2J\x1B[0f');
    
    // Header with ticker and environment
    const envStatus = binanceConfig.testnet ? chalk.yellow('🧪 TESTNET') : chalk.red('🚀 LIVE');
    const ticker = chalk.cyan(config.symbol);
    
    console.log(chalk.blue('🎯 Live Trading Monitor') + chalk.gray(` - ${new Date().toLocaleTimeString()}`));
    console.log(`${envStatus} | Trading: ${ticker} | ${chalk.gray('Press Ctrl+C to exit')}`);
    console.log(chalk.white('═'.repeat(80)));

    // Engine Status
    const isRunning = this.tradingEngine.isEngineRunning();
    const status = isRunning ? chalk.green('RUNNING') : chalk.red('STOPPED');
    const emergencyMode = this.tradingEngine.isInEmergencyMode();
    
    console.log(`${chalk.blue('Engine Status')}    : ${status}${emergencyMode ? chalk.red(' [EMERGENCY]') : ''}`);
    console.log(`${chalk.blue('Balance')}          : ${chalk.green('$' + this.tradingEngine.getCurrentBalance().toFixed(2))}`);

    // Market Data
    const marketData = this.tradingEngine.getLastMarketData();
    if (marketData) {
      console.log(`${chalk.blue('Current Price')}    : ${chalk.white('$' + marketData.price.toFixed(2))}`);
      console.log(`${chalk.blue('24h Change')}       : ${marketData.change24h >= 0 ? chalk.green('+' + marketData.change24h.toFixed(2) + '%') : chalk.red(marketData.change24h.toFixed(2) + '%')}`);
      
      // Display Fear and Greed Index if available
      if (marketData.fearGreedIndex) {
        const fgi = marketData.fearGreedIndex;
        const fearGreedColor = this.getFearGreedColor(fgi.value);
        const ageInfo = this.getFearGreedAge(fgi.timestamp);
        console.log(`${chalk.blue('Fear & Greed')}     : ${fearGreedColor(fgi.value + ' - ' + fgi.valueClassification)} ${chalk.gray('(' + ageInfo + ')')}`);
      } else if (config.fearGreedIndexEnabled) {
        // Try to fetch if enabled but not present
        this.fetchFearGreedIndex().then(fgiData => {
          if (fgiData && marketData) {
            marketData.fearGreedIndex = fgiData;
          }
        }).catch(() => {
          // Silently handle error to avoid disrupting display
        });
        console.log(`${chalk.blue('Fear & Greed')}     : ${chalk.gray('Loading...')}`);
      }
    }

    // Risk Metrics
    const riskMetrics = this.tradingEngine.getRiskMetrics();
    console.log('\n' + chalk.blue('📊 Risk Metrics:'));
    console.log(chalk.white('─'.repeat(40)));
    console.log(`${chalk.gray('Daily P&L')}        : ${riskMetrics.dailyPnL >= 0 ? chalk.green('+$' + riskMetrics.dailyPnL.toFixed(2)) : chalk.red('-$' + Math.abs(riskMetrics.dailyPnL).toFixed(2))}`);
    console.log(`${chalk.gray('Total P&L')}        : ${riskMetrics.totalPnL >= 0 ? chalk.green('+$' + riskMetrics.totalPnL.toFixed(2)) : chalk.red('-$' + Math.abs(riskMetrics.totalPnL).toFixed(2))}`);
    console.log(`${chalk.gray('Open Positions')}   : ${chalk.white(riskMetrics.positionsCount)}`);
    console.log(`${chalk.gray('Win Rate')}         : ${chalk.white(riskMetrics.winRate.toFixed(1) + '%')}`);
    console.log(`${chalk.gray('Risk Score')}       : ${this.colorizeRiskScore(riskMetrics.riskScore)}`);

    // Open Positions
    const positions = this.tradingEngine.getOpenPositions();
    if (positions.length > 0) {
      console.log('\n' + chalk.blue('📈 Open Positions:'));
      console.log(chalk.white('─'.repeat(80)));
      console.log(chalk.gray('ID'.padEnd(8) + 'Side'.padEnd(6) + 'Qty'.padEnd(12) + 'Entry'.padEnd(10) + 'Current'.padEnd(10) + 'P&L'.padEnd(10) + 'Stop'.padEnd(10) + 'Target'.padEnd(10)));
      
      positions.forEach(position => {
        const pnlColor = position.unrealizedPnL >= 0 ? chalk.green : chalk.red;
        const sideColor = position.side === 'BUY' ? chalk.green : chalk.red;
        
        console.log(
          chalk.white(position.id.substring(0, 6).padEnd(8)) +
          sideColor(position.side.padEnd(6)) +
          chalk.white(position.quantity.toFixed(6).padEnd(12)) +
          chalk.white(position.entryPrice.toFixed(2).padEnd(10)) +
          chalk.white(position.currentPrice.toFixed(2).padEnd(10)) +
          pnlColor(position.unrealizedPnL.toFixed(2).padEnd(10)) +
          chalk.white(position.stopLossPrice.toFixed(2).padEnd(10)) +
          chalk.white(position.takeProfitPrice.toFixed(2).padEnd(10))
        );
      });
    }

    // Strategy State
    const strategyState = this.tradingEngine.getStrategyState();
    console.log('\n' + chalk.blue('🧠 Strategy State:'));
    console.log(chalk.white('─'.repeat(40)));
    console.log(`${chalk.gray('Price History')}    : ${chalk.white(strategyState.priceHistoryLength + ' candles')}`);
    console.log(`${chalk.gray('Last Price')}       : ${chalk.white('$' + (strategyState.lastPrice || 0).toFixed(2))}`);
    
    if (strategyState.indicators) {
      console.log(`${chalk.gray('SMA')}              : ${chalk.white('$' + strategyState.indicators.sma.toFixed(2))}`);
      console.log(`${chalk.gray('Upper Band')}       : ${chalk.white('$' + strategyState.indicators.bollinger.upper.toFixed(2))}`);
      console.log(`${chalk.gray('Lower Band')}       : ${chalk.white('$' + strategyState.indicators.bollinger.lower.toFixed(2))}`);
      console.log(`${chalk.gray('RSI')}              : ${chalk.white(strategyState.indicators.rsi.toFixed(1))}`);
    }

    // Fear and Greed Service Health (only if enabled)
    if (config.fearGreedIndexEnabled) {
      const fgiHealth = fearGreedService.getHealthStatus();
      console.log('\n' + chalk.blue('😱 Fear & Greed Index Service:'));
      console.log(chalk.white('─'.repeat(40)));
      console.log(`${chalk.gray('Status')}           : ${fgiHealth.hasValidCache ? chalk.green('ACTIVE') : chalk.yellow('WARMING UP')}`);
      console.log(`${chalk.gray('Cache Age')}        : ${chalk.white(fgiHealth.cacheAge ? this.formatDuration(fgiHealth.cacheAge) : 'N/A')}`);
      console.log(`${chalk.gray('Next Refresh')}     : ${chalk.white(fgiHealth.cacheExpiresIn ? this.formatDuration(fgiHealth.cacheExpiresIn) : 'Soon')}`);
      if (fgiHealth.consecutiveFailures > 0) {
        console.log(`${chalk.gray('Failures')}         : ${chalk.red(fgiHealth.consecutiveFailures)}`);
      }
    }

    console.log('\n' + chalk.gray('Press Ctrl+C to return to main menu'));
  }

  private async fetchFearGreedIndex() {
    try {
      return await fearGreedService.getFearGreedIndex();
    } catch (error) {
      return null;
    }
  }

  private getFearGreedColor(value: number): (text: string) => string {
    if (value <= 25) return chalk.red.bold;      // Extreme Fear - red
    if (value <= 45) return chalk.red;           // Fear - red
    if (value <= 55) return chalk.yellow;        // Neutral - yellow
    if (value <= 75) return chalk.green;         // Greed - green
    return chalk.green.bold;                     // Extreme Greed - bold green
  }

  private getFearGreedAge(timestamp: number): string {
    const ageMs = Date.now() - timestamp;
    return this.formatDuration(ageMs);
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ago`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
  }

  private colorizeRiskScore(score: number): string {
    if (score < 30) return chalk.green(score.toFixed(1));
    if (score < 60) return chalk.yellow(score.toFixed(1));
    return chalk.red(score.toFixed(1));
  }

  private async emergencyStop(): Promise<void> {
    const confirmation = await inquirer.prompt({
      type: 'confirm',
      name: 'proceed',
      message: chalk.red.bold('EMERGENCY STOP: This will immediately close all positions and stop trading. Continue?'),
      default: false
    });

    if (confirmation.proceed) {
      this.tradingEngine.emergencyShutdown();
      this.logError('Emergency stop activated');
    }

    await this.pressAnyKey();
    await this.showMainMenu();
  }

  private async pressAnyKey(): Promise<void> {
    await inquirer.prompt({
      type: 'input',
      name: 'continue',
      message: 'Press Enter to continue...'
    });
  }

  private logInfo(message: string): void {
    console.log(chalk.blue('ℹ ') + chalk.white(message));
  }

  private logSuccess(message: string): void {
    console.log(chalk.green('✓ ') + chalk.white(message));
  }

  private logError(message: string): void {
    console.log(chalk.red('✗ ') + chalk.white(message));
  }
}
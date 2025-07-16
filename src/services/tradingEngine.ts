import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { BinanceService } from '../services/binance/binanceService';
import { RiskManager } from '../services/risk/riskManager';
import { MeanReversionStrategy } from '../strategies/meanReversion/meanReversionStrategy';
import { GridTradingStrategy } from '../strategies/gridTrading/gridTradingStrategy';
import { MomentumStrategy } from '../strategies/momentum/momentumStrategy';
import { Position, TradingSignal, MarketData, TradingConfig } from '../interfaces/trading';
import { logger, TradingLogger } from '../utils/logger';

export class TradingEngine extends EventEmitter {
  private binanceService: BinanceService;
  private riskManager: RiskManager;
  private strategy: MeanReversionStrategy | GridTradingStrategy | MomentumStrategy | null = null;
  private config: TradingConfig;
  
  private isRunning: boolean = false;
  private currentBalance: number = 0;
  private lastMarketData: MarketData | null = null;
  private openOrderIds: Set<string> = new Set();
  private emergencyStop: boolean = false;
  private signalStats = {
    total: 0,
    executed: 0,
    rejected: 0,
    lastReset: Date.now()
  };

  constructor(
    binanceService: BinanceService,
    config: TradingConfig
  ) {
    super();
    this.binanceService = binanceService;
    this.config = config;
    this.riskManager = new RiskManager(config);
    this.currentBalance = config.initialCapital;
  }

  private createStrategy(config: TradingConfig): MeanReversionStrategy | GridTradingStrategy | MomentumStrategy {
    switch (config.strategy) {
      case 'momentum':
        return new MomentumStrategy(config);
      case 'meanReversion':
        return new MeanReversionStrategy(config);
      case 'gridTrading':
        return new GridTradingStrategy(config);
      default:
        throw new Error(`Unknown strategy: ${config.strategy}`);
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Trading engine is already running');
      return;
    }

    try {
      logger.info('🚀 Starting trading engine...');
      
      // Validate Binance connection
      const isConnected = await this.binanceService.validateConnection();
      if (!isConnected) {
        throw new Error('Failed to establish Binance connection');
      }

      // Initialize User Data Stream for real-time position tracking
      try {
        await this.binanceService.initializeUserDataStream();
        logger.info('✅ Real-time position tracking initialized');
      } catch (error) {
        logger.warn('⚠️  User Data Stream failed - continuing with polling mode', { error });
      }

      // Set up User Data Stream event listeners
      this.setupUserDataStreamListeners();

      // Load existing positions from Binance
      await this.loadExistingPositions();
      
      // Initialize strategy
      this.strategy = this.createStrategy(this.config);

      // Inject risk manager into strategy for position-aware calculations
      if (this.strategy && 'setRiskManager' in this.strategy) {
        (this.strategy as any).setRiskManager(this.riskManager);
      }

      // Update strategy with current balance
      if (this.strategy && 'updateCurrentBalance' in this.strategy) {
        (this.strategy as any).updateCurrentBalance(this.currentBalance);
      }

      // Set up strategy event listeners
      this.strategy.on('signal', this.handleTradingSignal.bind(this));

      // Start market data stream
      await this.binanceService.startRealTimeData(this.config.symbol);
      
      // Set up market data and connection event listeners
      this.binanceService.on('marketData', this.handleMarketData.bind(this));
      this.binanceService.on('connectionFailed', this.handleConnectionFailure.bind(this));

      // Set up risk manager event listeners
      this.riskManager.on('dailyLossLimitReached', this.handleDailyLossLimit.bind(this));
      this.riskManager.on('dailyProfitTargetReached', this.handleDailyProfitTarget.bind(this));
      this.riskManager.on('positionClosed', this.handlePositionClosed.bind(this));

      this.isRunning = true;
      this.emit('started');
      
      TradingLogger.logTrade('TRADING_ENGINE_STARTED', {
        symbol: this.config.symbol,
        strategy: this.config.strategy,
        initialCapital: this.config.initialCapital,
        userDataStreamActive: this.binanceService.isUserDataStreamConnected()
      });

    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'TradingEngine.start' });
      throw error;
    }
  }

  private setupUserDataStreamListeners(): void {
    // Real-time order fill notifications
    this.binanceService.on('orderFilled', (data: any) => {
      logger.info(`🎯 Order FILLED: ${data.symbol} ${data.side} ${data.executedQty} @ $${data.avgPrice}`, {
        orderId: data.orderId,
        totalValue: data.totalValue
      });
      
      // Update position in risk manager
      this.handleOrderFilled(data);
    });

    // Partial fills
    this.binanceService.on('orderPartiallyFilled', (data: any) => {
      logger.info(`⚡ Order PARTIALLY FILLED: ${data.symbol} ${data.side} ${data.executedQty}/${data.executedQty + data.remainingQty}`, {
        orderId: data.orderId,
        executedQty: data.executedQty,
        remainingQty: data.remainingQty
      });
    });

    // Order rejections
    this.binanceService.on('orderRejected', (data: any) => {
      logger.error(`❌ Order REJECTED: ${data.symbol} ${data.side} - ${data.reason}`, {
        orderId: data.orderId
      });
    });

    // Balance updates
    this.binanceService.on('balanceUpdate', (data: any) => {
      logger.info(`💰 Balance Update: ${data.asset} ${data.balanceDelta > 0 ? '+' : ''}${data.balanceDelta}`, {
        newBalance: data.newBalance
      });
      
      // Update current balance if it's USDT
      if (data.asset === 'USDT') {
        this.currentBalance = data.newBalance;
      }
    });

    // Account updates
    this.binanceService.on('accountUpdate', (data: any) => {
      logger.debug('Account position update received', {
        balances: data.balances?.length || 0
      });
    });
  }

  private handleOrderFilled(orderData: any): void {
    try {
      const { orderId, symbol, side, executedQty, avgPrice, totalValue } = orderData;
      
      // Find if this relates to an existing position in our risk manager
      const existingPositions = this.riskManager.getOpenPositions();
      const relatedPosition = existingPositions.find(p => p.symbol === symbol);
      
      if (relatedPosition) {
        // Update existing position
        logger.info(`Updating existing position ${relatedPosition.id} with new fill`);
        // Note: In a full implementation, you'd update the position quantity/price
        // For now, we'll create a new position entry
      }
      
      // Create new position from the filled order
      const position: Position = {
        id: `fill-${orderId}`,
        symbol,
        side: side as 'BUY' | 'SELL',
        quantity: executedQty,
        entryPrice: avgPrice,
        currentPrice: avgPrice,
        unrealizedPnL: 0,
        stopLossPrice: this.riskManager.calculateStopLoss(avgPrice, side as 'BUY' | 'SELL'),
        takeProfitPrice: this.riskManager.calculateTakeProfit(avgPrice, side as 'BUY' | 'SELL'),
        trailingStopPrice: 0,
        timestamp: Date.now(),
        status: 'OPEN'
      };
      
      // Add to risk manager
      this.riskManager.addPosition(position);
      
      logger.info(`📊 Position created from order fill: ${side} ${executedQty} ${symbol} @ $${avgPrice}`);
      
      // Emit event for other components
      this.emit('positionCreated', position);
      
    } catch (error) {
      TradingLogger.logError(error as Error, { 
        context: 'TradingEngine.handleOrderFilled',
        orderData 
      });
    }
  }

  private async handleMarketData(marketData: MarketData): Promise<void> {
    if (!this.isRunning) return;

    this.lastMarketData = marketData;

    // Update all open positions with current price
    const openPositions = this.riskManager.getOpenPositions();
    for (const position of openPositions) {
      if (position.symbol === marketData.symbol) {
        this.riskManager.updatePosition(position.id, marketData.price);
      }
    }

    // Generate trading signal from strategy
    if (this.strategy) {
      const signal = await this.strategy.analyzeMarketAsync(marketData);
      if (signal) {
        await this.handleTradingSignal(signal);
      }
    }
  }

  private async handleTradingSignal(signal: TradingSignal): Promise<void> {
    if (!this.isRunning) return;

    try {
      // Only process BUY and SELL signals, skip HOLD
      if (signal.action === 'HOLD') return;

      this.signalStats.total++;
      this.logExecutionStats();

      logger.info(`🔄 Processing ${signal.action} signal: ${signal.quantity} @ $${signal.price} (${signal.confidence}% confidence)`);

      // Fetch real-time balance before validation
      await this.updateBalance();
      logger.debug('Real-time balance fetched', { currentBalance: this.currentBalance });

      // Validate trade with risk manager
      const validation = this.riskManager.validateTrade(
        signal.action as 'BUY' | 'SELL',
        signal.quantity,
        signal.price,
        this.currentBalance
      );

      if (!validation.isValid) {
        this.signalStats.rejected++;
        logger.warn('🚫 Trade signal rejected by risk manager', {
          reason: validation.reason,
          action: signal.action,
          quantity: signal.quantity,
          price: signal.price,
          currentBalance: this.currentBalance,
          tradeValue: (signal.quantity * signal.price).toFixed(2),
          positionSizePercentage: ((signal.quantity * signal.price / this.currentBalance) * 100).toFixed(2) + '%',
          executionRate: `${this.signalStats.executed}/${this.signalStats.total} (${((this.signalStats.executed / this.signalStats.total) * 100).toFixed(1)}%)`
        });
        return;
      }

      logger.info(`✅ Risk validation passed, executing trade...`);
      this.signalStats.executed++;

      // Execute the trade
      await this.executeTrade(signal);

    } catch (error) {
      TradingLogger.logError(error as Error, { 
        context: 'TradingEngine.handleTradingSignal',
        signal: signal
      });
    }
  }

  private logExecutionStats(): void {
    const timeSinceReset = Date.now() - this.signalStats.lastReset;
    const hoursSinceReset = timeSinceReset / (1000 * 60 * 60);
    
    // Log stats every 100 signals or every 4 hours
    if (this.signalStats.total % 100 === 0 || hoursSinceReset >= 4) {
      const executionRate = this.signalStats.total > 0 ? (this.signalStats.executed / this.signalStats.total) * 100 : 0;
      const rejectionRate = this.signalStats.total > 0 ? (this.signalStats.rejected / this.signalStats.total) * 100 : 0;
      
      logger.info(`📊 Execution Statistics:`, {
        totalSignals: this.signalStats.total,
        executed: this.signalStats.executed,
        rejected: this.signalStats.rejected,
        executionRate: `${executionRate.toFixed(1)}%`,
        rejectionRate: `${rejectionRate.toFixed(1)}%`,
        timePeriod: `${hoursSinceReset.toFixed(1)} hours`
      });
      
      // Reset stats if it's been more than 12 hours
      if (hoursSinceReset >= 12) {
        this.signalStats = {
          total: 0,
          executed: 0,
          rejected: 0,
          lastReset: Date.now()
        };
        logger.info('📊 Execution statistics reset');
      }
    }
  }

  private async executeTrade(signal: TradingSignal): Promise<void> {
    try {
      // Only execute BUY and SELL signals
      if (signal.action === 'HOLD') return;

      // Additional validation before trade execution
      const currentBalance = await this.binanceService.getAccountBalance('USDT');
      const positionValue = signal.quantity * signal.price;
      
      // Safety check: ensure we have sufficient balance with larger buffer
      if (positionValue > currentBalance * 0.85) {
        logger.warn('Insufficient balance for trade - too large position', {
          positionValue,
          currentBalance,
          maxAllowed: currentBalance * 0.85,
          signal: signal.action
        });
        return;
      }

      // Place market order
      const marketOrder = await this.binanceService.placeMarketOrder(
        this.config.symbol,
        signal.action,
        signal.quantity
      );

      if (marketOrder.status === 'FILLED') {
        const fillPrice = parseFloat(marketOrder.fills[0].price);
        const fillQuantity = parseFloat(marketOrder.executedQty);
        
        // Validate fill price isn't too far from expected (slippage protection)
        const expectedPrice = signal.price;
        const slippage = Math.abs((fillPrice - expectedPrice) / expectedPrice) * 100;
        
        if (slippage > 1.0) { // 1% max acceptable slippage
          logger.warn('High slippage detected', {
            expectedPrice,
            fillPrice,
            slippage: slippage.toFixed(2) + '%',
            orderId: marketOrder.orderId
          });
        }

        // Position creation will be handled by User Data Stream
        // via handleOrderFilled when the executionReport arrives
        
        logger.info(`✅ Order executed: ${signal.action} ${fillQuantity} ${this.config.symbol} @ $${fillPrice}`);

      } else {
        logger.warn('Market order not filled', { orderId: marketOrder.orderId, status: marketOrder.status });
      }

    } catch (error) {
      TradingLogger.logError(error as Error, { 
        context: 'TradingEngine.executeTrade',
        signal: signal
      });
    }
  }

  private async loadExistingPositions(): Promise<void> {
    try {
      logger.info('Checking for existing open positions...');
      
      // Get open orders from Binance
      const openOrders = await this.binanceService.getOpenOrders(this.config.symbol);
      
      if (openOrders.length > 0) {
        logger.info(`Found ${openOrders.length} open orders for ${this.config.symbol}`);
        
        // Convert Binance orders to our Position format and add to risk manager
        for (const order of openOrders) {
          try {
            const entryPrice = parseFloat(order.price || order.stopPrice || '0');
            
            // Create position from order data
            const position = {
              id: `binance-${order.orderId}`,
              symbol: order.symbol,
              side: order.side as 'BUY' | 'SELL',
              quantity: parseFloat(order.origQty),
              entryPrice: entryPrice,
              currentPrice: entryPrice, // Will be updated with market data
              unrealizedPnL: 0, // Will be calculated when price updates
              stopLossPrice: this.riskManager.calculateStopLoss(entryPrice, order.side as 'BUY' | 'SELL'),
              takeProfitPrice: this.riskManager.calculateTakeProfit(entryPrice, order.side as 'BUY' | 'SELL'),
              trailingStopPrice: 0, // Will be set if trailing stop is enabled
              timestamp: order.time,
              status: 'OPEN' as const
            };
            
            // Add position to risk manager
            this.riskManager.addPosition(position);
            
            logger.info(`Loaded existing position: ${position.side} ${position.quantity} ${position.symbol} @ $${position.entryPrice}`);
            
          } catch (error) {
            TradingLogger.logError(error as Error, { 
              context: 'TradingEngine.loadExistingPositions',
              orderId: order.orderId
            });
          }
        }
        
        // Display summary
        const totalPositions = this.riskManager.getOpenPositions().length;
        logger.info(`✅ Loaded ${totalPositions} existing positions into risk manager`);
        
      } else {
        logger.info('No existing open positions found');
      }
      
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'TradingEngine.loadExistingPositions' });
      logger.warn('Failed to load existing positions - continuing with startup');
    }
  }

  private handlePositionClosed(position: Position, reason: string): void {
    logger.info(`Position closed: ${position.id} - ${reason}`, {
      symbol: position.symbol,
      side: position.side,
      pnl: position.unrealizedPnL
    });
  }

  private async handleDailyLossLimit(dailyPnL: number): Promise<void> {
    logger.error('Daily loss limit reached - stopping all trading', { dailyPnL });
    
    await this.closeAllPositions('DAILY_LOSS_LIMIT');
    await this.cancelAllOpenOrders();
    
    this.isRunning = false;
    this.emit('dailyLossLimitReached', dailyPnL);
  }

  private async handleDailyProfitTarget(dailyPnL: number): Promise<void> {
    logger.info('Daily profit target reached - considering shutdown', { dailyPnL });
    
    // Optionally continue trading or stop for the day
    // For conservative approach, we'll stop trading
    await this.closeAllPositions('DAILY_PROFIT_TARGET');
    await this.cancelAllOpenOrders();
    
    this.isRunning = false;
    this.emit('dailyProfitTargetReached', dailyPnL);
  }

  private handleConnectionFailure(): void {
    logger.error('Binance connection failed - initiating emergency procedures');
    this.emergencyShutdown();
  }

  private async closeAllPositions(reason: string): Promise<void> {
    const openPositions = this.riskManager.getOpenPositions();
    
    for (const position of openPositions) {
      try {
        await this.forceClosePosition(position.id, reason);
      } catch (error) {
        TradingLogger.logError(error as Error, { 
          context: 'TradingEngine.closeAllPositions',
          positionId: position.id
        });
      }
    }
  }

  private async forceClosePosition(positionId: string, reason: string): Promise<void> {
    try {
      const position = this.riskManager.getOpenPositions().find(p => p.id === positionId);
      if (!position) return;

      const oppositeAction = position.side === 'BUY' ? 'SELL' : 'BUY';
      
      const closeOrder = await this.binanceService.placeMarketOrder(
        position.symbol,
        oppositeAction,
        position.quantity
      );

      this.riskManager.closePosition(positionId, reason);
      
      TradingLogger.logTrade('FORCE_CLOSE_POSITION', {
        positionId,
        reason,
        closeOrderId: closeOrder.orderId
      });

    } catch (error) {
      TradingLogger.logError(error as Error, { 
        context: 'TradingEngine.forceClosePosition',
        positionId
      });
    }
  }

  private async cancelAllOpenOrders(): Promise<void> {
    try {
      const openOrders = await this.binanceService.getOpenOrders(this.config.symbol);
      
      for (const order of openOrders) {
        try {
          await this.binanceService.cancelOrder(this.config.symbol, order.orderId);
          this.openOrderIds.delete(order.orderId);
        } catch (error) {
          // Continue canceling other orders even if one fails
        }
      }
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'TradingEngine.cancelAllOpenOrders' });
    }
  }

  async stop(): Promise<void> {
    try {
      logger.info('Stopping trading engine...');
      
      this.isRunning = false;
      
      // Close all open positions
      await this.closeAllPositions('ENGINE_SHUTDOWN');
      
      // Cancel all open orders
      await this.cancelAllOpenOrders();
      
      // Disconnect from Binance
      this.binanceService.disconnect();
      
      this.emit('stopped');
      logger.info('Trading engine stopped');
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'TradingEngine.stop' });
    }
  }

  emergencyShutdown(): void {
    this.emergencyStop = true;
    this.isRunning = false;
    
    logger.error('🚨 EMERGENCY SHUTDOWN ACTIVATED');
    
    // Attempt to close positions and cancel orders
    this.closeAllPositions('EMERGENCY_SHUTDOWN').catch(() => {});
    this.cancelAllOpenOrders().catch(() => {});
    
    this.emit('emergencyShutdown');
  }

  // Public getters
  isEngineRunning(): boolean {
    return this.isRunning;
  }

  getCurrentBalance(): number {
    return this.currentBalance;
  }

  getLastMarketData(): MarketData | null {
    return this.lastMarketData;
  }

  getRiskMetrics() {
    return this.riskManager.getRiskMetrics();
  }

  getOpenPositions(): Position[] {
    return this.riskManager.getOpenPositions();
  }

  getStrategyState(): any {
    return this.strategy?.getStrategyState() || null;
  }

  isInEmergencyMode(): boolean {
    return this.emergencyStop;
  }

  async updateBalance(): Promise<void> {
    try {
      this.currentBalance = await this.binanceService.getAccountBalance('USDT');
      
      // Also update strategy with new balance
      if (this.strategy && 'updateCurrentBalance' in this.strategy) {
        (this.strategy as any).updateCurrentBalance(this.currentBalance);
      }
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'TradingEngine.updateBalance' });
    }
  }
}
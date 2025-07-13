import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import { BinanceService } from '../services/binance/binanceService';
import { RiskManager } from '../services/risk/riskManager';
import { MeanReversionStrategy } from '../strategies/meanReversion/meanReversionStrategy';
import { Position, TradingSignal, MarketData, TradingConfig } from '../interfaces/trading';
import { logger, TradingLogger } from '../utils/logger';

export class TradingEngine extends EventEmitter {
  private binanceService: BinanceService;
  private riskManager: RiskManager;
  private strategy: MeanReversionStrategy;
  private config: TradingConfig;
  
  private isRunning: boolean = false;
  private currentBalance: number = 0;
  private lastMarketData: MarketData | null = null;
  private openOrderIds: Set<string> = new Set();
  private emergencyStop: boolean = false;

  constructor(
    binanceService: BinanceService,
    config: TradingConfig
  ) {
    super();
    this.binanceService = binanceService;
    this.config = config;
    this.riskManager = new RiskManager(config);
    this.strategy = new MeanReversionStrategy(config);
    
    this.setupEventListeners();
  }

  private setupEventListeners(): void {
    // Market data events
    this.binanceService.on('marketData', this.handleMarketData.bind(this));
    this.binanceService.on('connectionFailed', this.handleConnectionFailure.bind(this));

    // Strategy events
    this.strategy.on('signal', this.handleTradingSignal.bind(this));

    // Risk management events
    this.riskManager.on('positionClosed', this.handlePositionClosed.bind(this));
    this.riskManager.on('dailyLossLimitReached', this.handleDailyLossLimit.bind(this));
    this.riskManager.on('dailyProfitTargetReached', this.handleDailyProfitTarget.bind(this));
  }

  async start(): Promise<void> {
    try {
      logger.info('Starting trading engine...');
      
      // Validate Binance connection
      const connectionValid = await this.binanceService.validateConnection();
      if (!connectionValid) {
        throw new Error('Failed to validate Binance connection');
      }

      // Get initial balance
      await this.updateBalance();
      
      if (this.currentBalance < this.config.initialCapital * 0.1) {
        throw new Error(`Insufficient balance: ${this.currentBalance} USDT`);
      }

      // Start real-time data feed
      this.binanceService.startRealTimeData(this.config.symbol);
      
      this.isRunning = true;
      logger.info('Trading engine started successfully', {
        symbol: this.config.symbol,
        balance: this.currentBalance,
        strategy: 'Mean Reversion'
      });

      this.emit('started');

    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'TradingEngine.start' });
      throw error;
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
      
      logger.info('Trading engine stopped successfully');
      this.emit('stopped');

    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'TradingEngine.stop' });
    }
  }

  emergencyShutdown(): void {
    logger.error('EMERGENCY SHUTDOWN INITIATED');
    this.emergencyStop = true;
    this.stop();
    this.emit('emergencyShutdown');
  }

  private async handleMarketData(marketData: MarketData): Promise<void> {
    if (!this.isRunning || this.emergencyStop) return;

    try {
      this.lastMarketData = marketData;
      
      // Update open positions with current price
      const openPositions = this.riskManager.getOpenPositions();
      for (const position of openPositions) {
        this.riskManager.updatePosition(position.id, marketData.price);
      }

      // Get trading signal from strategy
      // Use async method if Fear and Greed Index is enabled for enhanced analysis
      if (this.config.fearGreedIndexEnabled) {
        await this.strategy.analyzeMarketAsync(marketData);
      } else {
        this.strategy.analyzeMarket(marketData);
      }
      
      // Emit market data for UI
      this.emit('marketData', marketData);

    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'TradingEngine.handleMarketData' });
    }
  }

  private async handleTradingSignal(signal: TradingSignal): Promise<void> {
    if (!this.isRunning || this.emergencyStop) return;

    try {
      // Only process BUY and SELL signals, ignore HOLD
      if (signal.action === 'HOLD') return;

      // Update balance before trading
      await this.updateBalance();

      // Validate trade with risk manager
      const validation = this.riskManager.validateTrade(
        signal.action,
        signal.quantity,
        signal.price,
        this.currentBalance
      );

      if (!validation.isValid) {
        logger.warn('Trade rejected by risk manager', {
          reason: validation.reason,
          signal: {
            action: signal.action,
            price: signal.price,
            quantity: signal.quantity
          }
        });
        return;
      }

      // Execute the trade
      await this.executeTrade(signal);

    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'TradingEngine.handleTradingSignal' });
    }
  }

  private async executeTrade(signal: TradingSignal): Promise<void> {
    try {
      // Only execute BUY and SELL signals
      if (signal.action === 'HOLD') return;

      // Additional validation before trade execution
      const currentBalance = await this.binanceService.getAccountBalance('USDT');
      const positionValue = signal.quantity * signal.price;
      
      // Safety check: ensure we have sufficient balance
      if (positionValue > currentBalance * 0.95) {
        logger.warn('Insufficient balance for trade', {
          positionValue,
          currentBalance,
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

        // Create position
        const position: Position = {
          id: uuidv4(),
          symbol: this.config.symbol,
          side: signal.action,
          quantity: fillQuantity,
          entryPrice: fillPrice,
          currentPrice: fillPrice,
          unrealizedPnL: 0,
          stopLossPrice: this.riskManager.calculateStopLoss(fillPrice, signal.action),
          takeProfitPrice: this.riskManager.calculateTakeProfit(fillPrice, signal.action),
          trailingStopPrice: this.riskManager.calculateTrailingStop(fillPrice, fillPrice, signal.action),
          timestamp: Date.now(),
          status: 'OPEN'
        };

        // Add position to risk manager
        this.riskManager.addPosition(position);

        // Place protective orders
        await this.placeProtectiveOrders(position);

        this.emit('tradeExecuted', { position, marketOrder });

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

  private async placeProtectiveOrders(position: Position): Promise<void> {
    try {
      const oppositeAction = position.side === 'BUY' ? 'SELL' : 'BUY';

      // Place stop loss order
      const stopLossOrder = await this.binanceService.placeStopLossOrder(
        position.symbol,
        oppositeAction,
        position.quantity,
        position.stopLossPrice
      );
      this.openOrderIds.add(stopLossOrder.orderId);

      // Place take profit order
      const takeProfitOrder = await this.binanceService.placeTakeProfitOrder(
        position.symbol,
        oppositeAction,
        position.quantity,
        position.takeProfitPrice
      );
      this.openOrderIds.add(takeProfitOrder.orderId);

      logger.info('Protective orders placed', {
        positionId: position.id,
        stopLossOrderId: stopLossOrder.orderId,
        takeProfitOrderId: takeProfitOrder.orderId
      });

    } catch (error) {
      TradingLogger.logError(error as Error, { 
        context: 'TradingEngine.placeProtectiveOrders',
        positionId: position.id
      });
      
      // If protective orders fail, close position immediately
      await this.forceClosePosition(position.id, 'PROTECTIVE_ORDER_FAILURE');
    }
  }

  private async handlePositionClosed(position: Position, reason: string): Promise<void> {
    try {
      const oppositeAction = position.side === 'BUY' ? 'SELL' : 'BUY';
      
      // Place market order to close position
      const closeOrder = await this.binanceService.placeMarketOrder(
        position.symbol,
        oppositeAction,
        position.quantity
      );

      // Cancel any remaining protective orders for this position
      await this.cancelOrdersForPosition(position.id);

      TradingLogger.logTrade('POSITION_CLOSED_BY_RISK_MANAGER', {
        positionId: position.id,
        reason,
        closeOrderId: closeOrder.orderId,
        realizedPnL: position.unrealizedPnL
      });

      this.emit('positionClosed', { position, closeOrder, reason });

    } catch (error) {
      TradingLogger.logError(error as Error, { 
        context: 'TradingEngine.handlePositionClosed',
        positionId: position.id
      });
    }
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

  private async updateBalance(): Promise<void> {
    try {
      this.currentBalance = await this.binanceService.getAccountBalance('USDT');
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'TradingEngine.updateBalance' });
    }
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
      await this.cancelOrdersForPosition(positionId);

      TradingLogger.logTrade('POSITION_FORCE_CLOSED', {
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
          TradingLogger.logError(error as Error, { 
            context: 'TradingEngine.cancelAllOpenOrders',
            orderId: order.orderId
          });
        }
      }
    } catch (error) {
      TradingLogger.logError(error as Error, { context: 'TradingEngine.cancelAllOpenOrders' });
    }
  }

  private async cancelOrdersForPosition(positionId: string): Promise<void> {
    // This is a simplified implementation
    // In a production system, you'd track which orders belong to which positions
    const openOrders = await this.binanceService.getOpenOrders(this.config.symbol);
    
    for (const order of openOrders) {
      try {
        await this.binanceService.cancelOrder(this.config.symbol, order.orderId);
        this.openOrderIds.delete(order.orderId);
      } catch (error) {
        // Continue canceling other orders even if one fails
      }
    }
  }

  // Getters for monitoring
  isEngineRunning(): boolean {
    return this.isRunning && !this.emergencyStop;
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
    return this.strategy.getStrategyState();
  }

  isInEmergencyMode(): boolean {
    return this.emergencyStop;
  }
}
import { EventEmitter } from 'events';
import { Position, RiskMetrics, TradingConfig } from '../../interfaces/trading';
import { logger, TradingLogger } from '../../utils/logger';

export class RiskManager extends EventEmitter {
  private config: TradingConfig;
  private positions: Map<string, Position> = new Map();
  private dailyPnL: number = 0;
  private totalPnL: number = 0;
  private dailyTradeCount: number = 0;
  private maxDailyTrades: number = 20;
  private lastResetDate: string = new Date().toDateString();

  constructor(config: TradingConfig) {
    super();
    this.config = config;
    this.resetDailyMetrics();
  }

  private resetDailyMetrics(): void {
    const today = new Date().toDateString();
    if (this.lastResetDate !== today) {
      this.dailyPnL = 0;
      this.dailyTradeCount = 0;
      this.lastResetDate = today;
      logger.info('Daily metrics reset');
    }
  }

  validateTrade(
    side: 'BUY' | 'SELL',
    quantity: number,
    price: number,
    currentBalance: number
  ): { isValid: boolean; reason?: string } {
    this.resetDailyMetrics();

    const tradeValue = quantity * price;
    const positionSize = (tradeValue / currentBalance) * 100;

    if (this.dailyPnL <= -this.config.maxDailyLoss) {
      TradingLogger.logRisk('Daily loss limit reached', {
        dailyPnL: this.dailyPnL,
        maxDailyLoss: this.config.maxDailyLoss
      });
      return { isValid: false, reason: 'Daily loss limit reached' };
    }

    if (this.dailyPnL >= this.config.dailyProfitTarget) {
      TradingLogger.logRisk('Daily profit target achieved - consider stopping', {
        dailyPnL: this.dailyPnL,
        dailyProfitTarget: this.config.dailyProfitTarget
      });
    }

    if (this.positions.size >= this.config.maxOpenPositions) {
      TradingLogger.logRisk('Maximum open positions reached', {
        currentPositions: this.positions.size,
        maxPositions: this.config.maxOpenPositions
      });
      return { isValid: false, reason: 'Maximum open positions reached' };
    }

    if (positionSize > this.config.positionSizePercentage) {
      TradingLogger.logRisk('Position size too large', {
        requestedSize: positionSize.toFixed(2),
        maxSize: this.config.positionSizePercentage,
        quantity: quantity,
        price: price,
        currentBalance: currentBalance,
        tradeValue: tradeValue.toFixed(2),
        calculation: `(${quantity} × ${price} / ${currentBalance}) × 100 = ${positionSize.toFixed(2)}%`
      });
      return { isValid: false, reason: 'Position size exceeds maximum allowed' };
    }

    if (this.dailyTradeCount >= this.maxDailyTrades) {
      TradingLogger.logRisk('Daily trade limit reached', {
        dailyTradeCount: this.dailyTradeCount,
        maxDailyTrades: this.maxDailyTrades
      });
      return { isValid: false, reason: 'Daily trade limit reached' };
    }

    if (tradeValue > currentBalance * 0.90) {
      TradingLogger.logRisk('Insufficient balance for trade', {
        tradeValue,
        availableBalance: currentBalance,
        maxAllowed: currentBalance * 0.90
      });
      return { isValid: false, reason: 'Insufficient balance' };
    }

    return { isValid: true };
  }

  calculateStopLoss(entryPrice: number, side: 'BUY' | 'SELL'): number {
    const stopLossMultiplier = this.config.stopLossPercentage / 100;
    
    if (side === 'BUY') {
      return entryPrice * (1 - stopLossMultiplier);
    } else {
      return entryPrice * (1 + stopLossMultiplier);
    }
  }

  calculateTakeProfit(entryPrice: number, side: 'BUY' | 'SELL'): number {
    const takeProfitMultiplier = this.config.takeProfitPercentage / 100;
    
    if (side === 'BUY') {
      return entryPrice * (1 + takeProfitMultiplier);
    } else {
      return entryPrice * (1 - takeProfitMultiplier);
    }
  }

  calculateTrailingStop(currentPrice: number, entryPrice: number, side: 'BUY' | 'SELL'): number {
    const trailingStopMultiplier = this.config.trailingStopPercentage / 100;
    
    if (side === 'BUY') {
      return currentPrice * (1 - trailingStopMultiplier);
    } else {
      return currentPrice * (1 + trailingStopMultiplier);
    }
  }

  addPosition(position: Position): void {
    this.positions.set(position.id, position);
    this.dailyTradeCount++;
    
    TradingLogger.logTrade('POSITION_OPENED', {
      positionId: position.id,
      symbol: position.symbol,
      side: position.side,
      quantity: position.quantity,
      entryPrice: position.entryPrice,
      stopLoss: position.stopLossPrice,
      takeProfit: position.takeProfitPrice
    });

    this.emit('positionAdded', position);
  }

  updatePosition(positionId: string, currentPrice: number): void {
    const position = this.positions.get(positionId);
    if (!position) return;

    const previousPnL = position.unrealizedPnL;
    
    if (position.side === 'BUY') {
      position.unrealizedPnL = (currentPrice - position.entryPrice) * position.quantity;
    } else {
      position.unrealizedPnL = (position.entryPrice - currentPrice) * position.quantity;
    }

    position.currentPrice = currentPrice;

    const newTrailingStop = this.calculateTrailingStop(currentPrice, position.entryPrice, position.side);
    if (position.side === 'BUY' && newTrailingStop > position.trailingStopPrice) {
      position.trailingStopPrice = newTrailingStop;
    } else if (position.side === 'SELL' && newTrailingStop < position.trailingStopPrice) {
      position.trailingStopPrice = newTrailingStop;
    }

    this.checkStopConditions(position);
    this.emit('positionUpdated', position);
  }

  private checkStopConditions(position: Position): void {
    const { currentPrice, stopLossPrice, takeProfitPrice, trailingStopPrice, side } = position;

    if (side === 'BUY') {
      if (currentPrice <= stopLossPrice) {
        this.triggerStopLoss(position);
      } else if (currentPrice >= takeProfitPrice) {
        this.triggerTakeProfit(position);
      } else if (currentPrice <= trailingStopPrice) {
        this.triggerTrailingStop(position);
      }
    } else {
      if (currentPrice >= stopLossPrice) {
        this.triggerStopLoss(position);
      } else if (currentPrice <= takeProfitPrice) {
        this.triggerTakeProfit(position);
      } else if (currentPrice >= trailingStopPrice) {
        this.triggerTrailingStop(position);
      }
    }
  }

  private triggerStopLoss(position: Position): void {
    TradingLogger.logRisk('Stop loss triggered', {
      positionId: position.id,
      currentPrice: position.currentPrice,
      stopLossPrice: position.stopLossPrice,
      unrealizedPnL: position.unrealizedPnL
    });
    
    this.closePosition(position.id, 'STOP_LOSS');
  }

  private triggerTakeProfit(position: Position): void {
    TradingLogger.logTrade('Take profit triggered', {
      positionId: position.id,
      currentPrice: position.currentPrice,
      takeProfitPrice: position.takeProfitPrice,
      unrealizedPnL: position.unrealizedPnL
    });
    
    this.closePosition(position.id, 'TAKE_PROFIT');
  }

  private triggerTrailingStop(position: Position): void {
    TradingLogger.logTrade('Trailing stop triggered', {
      positionId: position.id,
      currentPrice: position.currentPrice,
      trailingStopPrice: position.trailingStopPrice,
      unrealizedPnL: position.unrealizedPnL
    });
    
    this.closePosition(position.id, 'TRAILING_STOP');
  }

  closePosition(positionId: string, reason: string): void {
    const position = this.positions.get(positionId);
    if (!position) return;

    position.status = 'CLOSED';
    this.dailyPnL += position.unrealizedPnL;
    this.totalPnL += position.unrealizedPnL;

    TradingLogger.logTrade('POSITION_CLOSED', {
      positionId,
      reason,
      realizedPnL: position.unrealizedPnL,
      dailyPnL: this.dailyPnL,
      totalPnL: this.totalPnL
    });

    this.positions.delete(positionId);
    this.emit('positionClosed', position, reason);

    if (this.dailyPnL <= -this.config.maxDailyLoss) {
      this.emit('dailyLossLimitReached', this.dailyPnL);
    }

    if (this.dailyPnL >= this.config.dailyProfitTarget) {
      this.emit('dailyProfitTargetReached', this.dailyPnL);
    }
  }

  getRiskMetrics(): RiskMetrics {
    const openPositions = Array.from(this.positions.values());
    const totalExposure = openPositions.reduce((sum, pos) => 
      sum + (pos.quantity * pos.currentPrice), 0);

    const closedTrades = this.dailyTradeCount - this.positions.size;
    const winningTrades = closedTrades > 0 ? Math.floor(closedTrades * 0.6) : 0; // Estimate
    const winRate = closedTrades > 0 ? (winningTrades / closedTrades) * 100 : 0;

    return {
      dailyPnL: this.dailyPnL,
      totalPnL: this.totalPnL,
      winRate,
      sharpeRatio: this.calculateSharpeRatio(),
      maxDrawdown: this.calculateMaxDrawdown(),
      currentExposure: totalExposure,
      positionsCount: this.positions.size,
      riskScore: this.calculateRiskScore()
    };
  }

  private calculateSharpeRatio(): number {
    // Simplified Sharpe ratio calculation
    if (this.dailyTradeCount < 10) return 0;
    
    const avgReturn = this.totalPnL / this.dailyTradeCount;
    const riskFreeRate = 0.02 / 365; // 2% annual risk-free rate
    
    return avgReturn > 0 ? (avgReturn - riskFreeRate) / Math.abs(avgReturn) : 0;
  }

  private calculateMaxDrawdown(): number {
    // Simplified drawdown calculation
    return Math.min(0, this.dailyPnL);
  }

  private calculateRiskScore(): number {
    let score = 0;
    
    // Position concentration risk
    if (this.positions.size >= this.config.maxOpenPositions * 0.8) score += 20;
    
    // Daily loss risk
    const lossPercentage = Math.abs(this.dailyPnL) / this.config.maxDailyLoss * 100;
    score += Math.min(lossPercentage * 0.3, 30);
    
    // Trade frequency risk
    const tradeFrequencyRisk = (this.dailyTradeCount / this.maxDailyTrades) * 20;
    score += tradeFrequencyRisk;
    
    return Math.min(score, 100);
  }

  getOpenPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  getDailyPnL(): number {
    return this.dailyPnL;
  }

  getTotalPnL(): number {
    return this.totalPnL;
  }

  getDailyTradeCount(): number {
    return this.dailyTradeCount;
  }

  shouldStopTrading(): boolean {
    return this.dailyPnL <= -this.config.maxDailyLoss || 
           this.dailyTradeCount >= this.maxDailyTrades;
  }
}
import { EventEmitter } from 'events';
import { TradingSignal, MarketData, TradingConfig } from '../../interfaces/trading';
import { logger, TradingLogger } from '../../utils/logger';

interface GridLevel {
  price: number;
  quantity: number;
  type: 'BUY' | 'SELL';
  isActive: boolean;
  orderId?: string;
}

interface GridState {
  basePrice: number;
  gridLevels: GridLevel[];
  totalInvested: number;
  totalProfit: number;
  activeOrders: number;
}

export class GridTradingStrategy extends EventEmitter {
  private config: TradingConfig;
  private gridState: GridState;
  private priceHistory: number[] = [];
  private lastSignalTime: number = 0;
  private signalCooldown: number = 30000; // 30 second cooldown for grid
  private gridInitialized: boolean = false;

  constructor(config: TradingConfig) {
    super();
    this.config = config;
    this.gridState = {
      basePrice: 0,
      gridLevels: [],
      totalInvested: 0,
      totalProfit: 0,
      activeOrders: 0
    };
  }

  analyzeMarket(marketData: MarketData): TradingSignal | null {
    this.updateHistory(marketData);

    if (!this.gridInitialized) {
      this.initializeGrid(marketData.price);
      return null;
    }

    const signal = this.checkGridTriggers(marketData);

    if (signal) {
      TradingLogger.logSignal(signal);
      this.emit('signal', signal);
    }

    return signal;
  }

  async analyzeMarketAsync(marketData: MarketData): Promise<TradingSignal | null> {
    return this.analyzeMarket(marketData);
  }

  private updateHistory(marketData: MarketData): void {
    this.priceHistory.push(marketData.price);
    if (this.priceHistory.length > 100) {
      this.priceHistory.shift();
    }
  }

  private initializeGrid(currentPrice: number): void {
    this.gridState.basePrice = currentPrice;
    this.gridState.gridLevels = [];
    
    const spacing = this.config.gridSpacingPercentage / 100;
    const levels = this.config.gridLevels;
    const quantityPerLevel = this.calculateGridQuantity(currentPrice);

    // Create buy levels below current price
    for (let i = 1; i <= Math.floor(levels / 2); i++) {
      const buyPrice = currentPrice * (1 - spacing * i);
      this.gridState.gridLevels.push({
        price: buyPrice,
        quantity: quantityPerLevel,
        type: 'BUY',
        isActive: true
      });
    }

    // Create sell levels above current price
    for (let i = 1; i <= Math.floor(levels / 2); i++) {
      const sellPrice = currentPrice * (1 + spacing * i);
      this.gridState.gridLevels.push({
        price: sellPrice,
        quantity: quantityPerLevel,
        type: 'SELL',
        isActive: true
      });
    }

    this.gridInitialized = true;
    logger.info('Grid initialized', {
      basePrice: currentPrice,
      levels: this.gridState.gridLevels.length,
      spacing: this.config.gridSpacingPercentage + '%',
      quantityPerLevel
    });
  }

  private checkGridTriggers(marketData: MarketData): TradingSignal | null {
    const currentTime = Date.now();
    
    if (currentTime - this.lastSignalTime < this.signalCooldown) {
      return null;
    }

    const currentPrice = marketData.price;
    let triggeredLevel: GridLevel | null = null;

    // Check for triggered grid levels
    for (const level of this.gridState.gridLevels) {
      if (!level.isActive) continue;

      if (level.type === 'BUY' && currentPrice <= level.price) {
        triggeredLevel = level;
        break;
      } else if (level.type === 'SELL' && currentPrice >= level.price) {
        triggeredLevel = level;
        break;
      }
    }

    if (!triggeredLevel) return null;

    // Calculate stop loss and take profit for grid trade
    const stopLossDistance = this.config.stopLossPercentage / 100;
    const takeProfitDistance = this.config.takeProfitPercentage / 100;

    const signal: TradingSignal = {
      action: triggeredLevel.type,
      confidence: this.calculateGridConfidence(triggeredLevel, currentPrice),
      price: currentPrice,
      quantity: triggeredLevel.quantity,
      reason: this.generateGridReason(triggeredLevel, currentPrice),
      timestamp: currentTime,
      stopLoss: triggeredLevel.type === 'BUY' 
        ? currentPrice * (1 - stopLossDistance)
        : currentPrice * (1 + stopLossDistance),
      takeProfit: triggeredLevel.type === 'BUY'
        ? currentPrice * (1 + takeProfitDistance)
        : currentPrice * (1 - takeProfitDistance)
    };

    // Mark level as inactive and create opposite level
    triggeredLevel.isActive = false;
    this.createOppositeGridLevel(triggeredLevel, currentPrice);
    this.lastSignalTime = currentTime;

    return signal;
  }

  private createOppositeGridLevel(triggeredLevel: GridLevel, currentPrice: number): void {
    const spacing = this.config.gridSpacingPercentage / 100;
    const oppositeType = triggeredLevel.type === 'BUY' ? 'SELL' : 'BUY';
    
    let oppositePrice: number;
    if (oppositeType === 'SELL') {
      oppositePrice = currentPrice * (1 + spacing);
    } else {
      oppositePrice = currentPrice * (1 - spacing);
    }

    const newLevel: GridLevel = {
      price: oppositePrice,
      quantity: triggeredLevel.quantity,
      type: oppositeType,
      isActive: true
    };

    this.gridState.gridLevels.push(newLevel);
    
    logger.debug('Created opposite grid level', {
      originalLevel: `${triggeredLevel.type} at ${triggeredLevel.price}`,
      newLevel: `${newLevel.type} at ${newLevel.price}`,
      currentPrice
    });
  }

  private calculateGridQuantity(currentPrice: number): number {
    const positionSize = this.config.positionSizePercentage / 100;
    const capital = this.config.initialCapital;
    const levels = this.config.gridLevels;
    
    // Divide capital across grid levels
    const capitalPerLevel = (capital * positionSize) / levels;
    const quantity = capitalPerLevel / currentPrice;
    
    // Ensure minimum order value (Binance requires ~$10 minimum)
    const minOrderValue = 10;
    const minQuantity = minOrderValue / currentPrice;
    
    return Math.max(quantity, minQuantity);
  }

  private calculateGridConfidence(level: GridLevel, currentPrice: number): number {
    let confidence = 75; // Base confidence for grid strategy
    
    // Distance from triggered price increases confidence
    const priceDistance = Math.abs(currentPrice - level.price) / level.price * 100;
    confidence += Math.min(priceDistance * 5, 15);
    
    // More confidence if price has moved significantly from base
    const baseDistance = Math.abs(currentPrice - this.gridState.basePrice) / this.gridState.basePrice * 100;
    confidence += Math.min(baseDistance * 2, 10);
    
    // Reduce confidence if too many active orders
    if (this.gridState.activeOrders > this.config.maxOpenPositions) {
      confidence -= 20;
    }
    
    return Math.max(60, Math.min(95, confidence));
  }

  private generateGridReason(level: GridLevel, currentPrice: number): string {
    return `Grid ${level.type}: Price ${currentPrice.toFixed(2)} triggered level ${level.price.toFixed(2)} (${this.config.gridSpacingPercentage}% spacing)`;
  }

  getStrategyState() {
    return {
      gridInitialized: this.gridInitialized,
      gridState: this.gridState,
      activeLevels: this.gridState.gridLevels.filter(l => l.isActive).length,
      priceHistoryLength: this.priceHistory.length,
      lastPrice: this.priceHistory[this.priceHistory.length - 1]
    };
  }

  reset(): void {
    this.gridState = {
      basePrice: 0,
      gridLevels: [],
      totalInvested: 0,
      totalProfit: 0,
      activeOrders: 0
    };
    this.priceHistory = [];
    this.lastSignalTime = 0;
    this.gridInitialized = false;
    logger.info('Grid trading strategy reset');
  }

  // Grid-specific methods
  updateGridLevel(orderId: string, filled: boolean): void {
    const level = this.gridState.gridLevels.find(l => l.orderId === orderId);
    if (level && filled) {
      level.isActive = false;
      this.gridState.activeOrders--;
    }
  }

  getActiveGridLevels(): GridLevel[] {
    return this.gridState.gridLevels.filter(l => l.isActive);
  }

  getTotalGridInvestment(): number {
    return this.gridState.totalInvested;
  }

  getTotalGridProfit(): number {
    return this.gridState.totalProfit;
  }
}
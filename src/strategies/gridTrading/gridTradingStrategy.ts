import { EventEmitter } from 'events';
import { TradingSignal, MarketData, TradingConfig } from '../../interfaces/trading';
import { logger, TradingLogger } from '../../utils/logger';
import { AnalyticsLogger } from '../../utils/analyticsLogger';

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
  private signalCooldown: number = 5000; // 5 second cooldown for scalping
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
      // Generate initial signal to place first grid order
      return this.generateInitialGridSignal(marketData);
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

  private generateInitialGridSignal(marketData: MarketData): TradingSignal | null {
    const currentPrice = marketData.price;
    const currentTime = Date.now();
    
    // Find the closest buy level below current price for initial order
    const buyLevels = this.gridState.gridLevels.filter(l => l.type === 'BUY' && l.isActive);
    if (buyLevels.length === 0) return null;
    
    // Get the highest buy level (closest to current price)
    const initialBuyLevel = buyLevels.reduce((highest, level) => 
      level.price > highest.price ? level : highest
    );
    
    const stopLossDistance = this.config.stopLossPercentage / 100;
    const takeProfitDistance = this.config.takeProfitPercentage / 100;
    
    // Log decision analysis for initial grid signal
    AnalyticsLogger.logDecisionMatrix(
      this.config.symbol,
      'grid-trading',
      currentPrice,
      [
        {
          name: 'Grid Initialization',
          current: 'First order placement',
          required: 'Grid levels configured',
          met: true,
          importance: 'CRITICAL',
          description: 'Initialize grid trading with first order'
        },
        {
          name: 'Target Level Available',
          current: `${buyLevels.length} buy levels available`,
          required: 'At least 1 buy level',
          met: buyLevels.length > 0,
          importance: 'CRITICAL',
          description: 'Must have available grid levels to trigger'
        },
        {
          name: 'Price Position',
          current: `Price $${currentPrice.toFixed(2)} vs target $${initialBuyLevel.price.toFixed(2)}`,
          required: 'Current price appropriate for grid entry',
          met: true,
          importance: 'MEDIUM',
          description: 'Price positioning for grid strategy entry'
        }
      ],
      'BUY',
      85
    );
    
    const signal: TradingSignal = {
      action: 'BUY',
      confidence: 85, // High confidence for grid strategy
      price: currentPrice, // Execute at market price
      quantity: initialBuyLevel.quantity,
      reason: `Grid initialization: Placing initial BUY order (${this.config.gridSpacingPercentage}% spacing)`,
      timestamp: currentTime,
      stopLoss: currentPrice * (1 - stopLossDistance),
      takeProfit: currentPrice * (1 + takeProfitDistance)
    };
    
    // Log indicator snapshot for grid initialization
    AnalyticsLogger.logIndicatorSnapshot({
      timestamp: currentTime,
      price: currentPrice,
      symbol: this.config.symbol,
      strategy: 'grid-trading',
      indicators: {
        gridSpacing: this.config.gridSpacingPercentage,
        gridLevels: this.config.gridLevels,
        activeGridLevels: this.gridState.gridLevels.filter(l => l.isActive).length,
        totalGridLevels: this.gridState.gridLevels.length,
        basePrice: this.gridState.basePrice,
        quantityPerLevel: initialBuyLevel.quantity
      },
      marketData,
      decisionPoints: {
        gridInitialized: this.gridInitialized,
        availableBuyLevels: buyLevels.length,
        targetLevelPrice: initialBuyLevel.price,
        gridSpacing: this.config.gridSpacingPercentage,
        totalInvested: this.gridState.totalInvested,
        totalProfit: this.gridState.totalProfit
      },
      signalGenerated: true,
      signalReason: signal.reason,
      confidence: signal.confidence
    });
    
    // Mark this level as used and create sell level above
    initialBuyLevel.isActive = false;
    this.createOppositeGridLevel(initialBuyLevel, currentPrice);
    this.lastSignalTime = currentTime;
    
    logger.info('Generated initial grid signal', {
      action: signal.action,
      price: signal.price,
      quantity: signal.quantity,
      targetLevel: initialBuyLevel.price
    });
    
    return signal;
  }

  private checkGridTriggers(marketData: MarketData): TradingSignal | null {
    const currentTime = Date.now();
    
    if (currentTime - this.lastSignalTime < this.signalCooldown) {
      // Log cooldown blocking
      AnalyticsLogger.logDecisionMatrix(
        this.config.symbol,
        'grid-trading',
        marketData.price,
        [{
          name: 'Signal Cooldown',
          current: `${Math.round((currentTime - this.lastSignalTime) / 1000)}s ago`,
          required: `${this.signalCooldown / 1000}s`,
          met: false,
          importance: 'CRITICAL',
          description: 'Must wait between signals to avoid overtrading'
        }],
        'HOLD',
        0
      );
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

    if (!triggeredLevel) {
      // Log no triggers
      const activeLevels = this.gridState.gridLevels.filter(l => l.isActive);
      const buyLevels = activeLevels.filter(l => l.type === 'BUY');
      const sellLevels = activeLevels.filter(l => l.type === 'SELL');
      
      AnalyticsLogger.logDecisionMatrix(
        this.config.symbol,
        'grid-trading',
        currentPrice,
        [
          {
            name: 'Grid Level Triggered',
            current: `No levels triggered at $${currentPrice.toFixed(2)}`,
            required: `Price hits buy level (<= ${buyLevels.length > 0 ? Math.max(...buyLevels.map(l => l.price)).toFixed(2) : 'N/A'}) or sell level (>= ${sellLevels.length > 0 ? Math.min(...sellLevels.map(l => l.price)).toFixed(2) : 'N/A'})`,
            met: false,
            importance: 'CRITICAL',
            description: 'Grid level must be triggered to generate signal'
          },
          {
            name: 'Active Grid Levels',
            current: `${activeLevels.length} active (${buyLevels.length} buy, ${sellLevels.length} sell)`,
            required: 'At least 1 active level',
            met: activeLevels.length > 0,
            importance: 'CRITICAL',
            description: 'Must have active grid levels'
          }
        ],
        'HOLD',
        0
      );
      return null;
    }

    // Calculate stop loss and take profit for grid trade
    const stopLossDistance = this.config.stopLossPercentage / 100;
    const takeProfitDistance = this.config.takeProfitPercentage / 100;
    const confidence = this.calculateGridConfidence(triggeredLevel, currentPrice);

    // Log grid trigger analysis
    AnalyticsLogger.logDecisionMatrix(
      this.config.symbol,
      'grid-trading',
      currentPrice,
      [
        {
          name: 'Grid Level Triggered',
          current: `${triggeredLevel.type} level at $${triggeredLevel.price.toFixed(2)}`,
          required: `Price ${triggeredLevel.type === 'BUY' ? '<=' : '>='} target level`,
          met: true,
          importance: 'CRITICAL',
          description: 'Grid level successfully triggered'
        },
        {
          name: 'Price Distance',
          current: `${Math.abs((currentPrice - triggeredLevel.price) / triggeredLevel.price * 100).toFixed(2)}%`,
          required: 'Price close to target level',
          met: Math.abs(currentPrice - triggeredLevel.price) / triggeredLevel.price <= 0.002, // Within 0.2%
          importance: 'HIGH',
          description: 'Price should be close to target for optimal execution'
        },
        {
          name: 'Grid Confidence',
          current: `${confidence.toFixed(1)}%`,
          required: '>= 60%',
          met: confidence >= 60,
          importance: 'MEDIUM',
          description: 'Grid strategy confidence level'
        },
        {
          name: 'Active Orders Limit',
          current: `${this.gridState.activeOrders} active`,
          required: `<= ${this.config.maxOpenPositions}`,
          met: this.gridState.activeOrders <= this.config.maxOpenPositions,
          importance: 'HIGH',
          description: 'Must not exceed maximum active orders'
        }
      ],
      triggeredLevel.type,
      confidence
    );

    const signal: TradingSignal = {
      action: triggeredLevel.type,
      confidence,
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

    // Log detailed grid state snapshot
    AnalyticsLogger.logIndicatorSnapshot({
      timestamp: currentTime,
      price: currentPrice,
      symbol: this.config.symbol,
      strategy: 'grid-trading',
      indicators: {
        gridSpacing: this.config.gridSpacingPercentage,
        gridLevels: this.config.gridLevels,
        activeGridLevels: this.gridState.gridLevels.filter(l => l.isActive).length,
        totalGridLevels: this.gridState.gridLevels.length,
        basePrice: this.gridState.basePrice,
        triggeredLevelPrice: triggeredLevel.price,
        triggeredLevelType: triggeredLevel.type,
        priceDistanceFromBase: Math.abs(currentPrice - this.gridState.basePrice) / this.gridState.basePrice * 100,
        quantityPerLevel: triggeredLevel.quantity
      },
      marketData,
      decisionPoints: {
        gridInitialized: this.gridInitialized,
        triggeredLevelPrice: triggeredLevel.price,
        triggeredLevelType: triggeredLevel.type,
        priceDistance: Math.abs(currentPrice - triggeredLevel.price) / triggeredLevel.price * 100,
        gridSpacing: this.config.gridSpacingPercentage,
        totalInvested: this.gridState.totalInvested,
        totalProfit: this.gridState.totalProfit,
        activeOrders: this.gridState.activeOrders,
        maxOpenPositions: this.config.maxOpenPositions
      },
      signalGenerated: true,
      signalReason: signal.reason,
      confidence: signal.confidence
    });

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
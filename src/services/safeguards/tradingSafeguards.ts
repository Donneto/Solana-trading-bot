import { EventEmitter } from 'events';
import { TradingConfig, Position, MarketData } from '../../interfaces/trading';
import { logger, TradingLogger } from '../../utils/logger';

interface SafeguardMetrics {
  consecutiveLosses: number;
  maxConsecutiveLosses: number;
  rapidTradeCount: number;
  lastTradeTime: number;
  minTimeBetweenTrades: number;
  dailyTradeCount: number;
  lastResetDate: string;
  emergencyStopTriggered: boolean;
  marketVolatilityScore: number;
  priceDeviationThreshold: number;
}

export class TradingSafeguards extends EventEmitter {
  private config: TradingConfig;
  private metrics: SafeguardMetrics;
  private priceHistory: number[] = [];
  private maxPriceHistory: number = 100;

  constructor(config: TradingConfig) {
    super();
    this.config = config;
    this.metrics = {
      consecutiveLosses: 0,
      maxConsecutiveLosses: 5,
      rapidTradeCount: 0,
      lastTradeTime: 0,
      minTimeBetweenTrades: 30000, // 30 seconds
      dailyTradeCount: 0,
      lastResetDate: new Date().toDateString(),
      emergencyStopTriggered: false,
      marketVolatilityScore: 0,
      priceDeviationThreshold: 5 // 5% rapid price change threshold
    };
  }

  validateTradeExecution(
    signal: any,
    currentPrice: number,
    marketData: MarketData
  ): { isValid: boolean; reason?: string; riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' } {
    
    this.resetDailyMetricsIfNeeded();
    this.updateMarketVolatility(marketData);

    // Check emergency stop
    if (this.metrics.emergencyStopTriggered) {
      return { 
        isValid: false, 
        reason: 'Emergency stop is active',
        riskLevel: 'HIGH'
      };
    }

    // Check consecutive losses
    if (this.metrics.consecutiveLosses >= this.metrics.maxConsecutiveLosses) {
      TradingLogger.logRisk('Too many consecutive losses', {
        consecutiveLosses: this.metrics.consecutiveLosses,
        maxAllowed: this.metrics.maxConsecutiveLosses
      });
      
      return { 
        isValid: false, 
        reason: 'Maximum consecutive losses reached',
        riskLevel: 'HIGH'
      };
    }

    // Check rapid trading
    const now = Date.now();
    const timeSinceLastTrade = now - this.metrics.lastTradeTime;
    
    if (timeSinceLastTrade < this.metrics.minTimeBetweenTrades) {
      return { 
        isValid: false, 
        reason: 'Minimum time between trades not met',
        riskLevel: 'MEDIUM'
      };
    }

    // Check market volatility
    if (this.metrics.marketVolatilityScore > 80) {
      TradingLogger.logRisk('High market volatility detected', {
        volatilityScore: this.metrics.marketVolatilityScore
      });
      
      return { 
        isValid: false, 
        reason: 'Market volatility too high',
        riskLevel: 'HIGH'
      };
    }

    // Check price deviation
    const priceDeviation = this.calculatePriceDeviation(currentPrice);
    if (priceDeviation > this.metrics.priceDeviationThreshold) {
      TradingLogger.logRisk('Rapid price movement detected', {
        priceDeviation: priceDeviation,
        threshold: this.metrics.priceDeviationThreshold
      });
      
      return { 
        isValid: false, 
        reason: 'Rapid price movement detected',
        riskLevel: 'HIGH'
      };
    }

    // Check signal confidence
    if (signal.confidence < 70) {
      return { 
        isValid: false, 
        reason: 'Signal confidence too low',
        riskLevel: 'LOW'
      };
    }

    // Check position size sanity
    const positionValue = signal.quantity * currentPrice;
    if (positionValue < 10 || positionValue > 1000) {
      return { 
        isValid: false, 
        reason: 'Position size outside acceptable range',
        riskLevel: 'MEDIUM'
      };
    }

    // All checks passed
    this.metrics.lastTradeTime = now;
    this.metrics.dailyTradeCount++;

    const riskLevel = this.calculateOverallRiskLevel();
    return { isValid: true, riskLevel };
  }

  validateOrderPlacement(
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    price: number
  ): { isValid: boolean; reason?: string } {
    
    // Validate order parameters
    if (quantity <= 0) {
      return { isValid: false, reason: 'Invalid quantity' };
    }

    if (price <= 0) {
      return { isValid: false, reason: 'Invalid price' };
    }

    if (symbol !== this.config.symbol) {
      return { isValid: false, reason: 'Invalid trading symbol' };
    }

    // Check minimum order value (Binance minimum)
    const orderValue = quantity * price;
    if (orderValue < 10) {
      return { isValid: false, reason: 'Order value below minimum' };
    }

    // Check maximum order value (safety check)
    if (orderValue > this.config.initialCapital * 0.2) {
      return { isValid: false, reason: 'Order value too large' };
    }

    return { isValid: true };
  }

  onTradeResult(position: Position, isProfit: boolean): void {
    if (isProfit) {
      this.metrics.consecutiveLosses = 0;
      logger.info('Consecutive loss streak reset');
    } else {
      this.metrics.consecutiveLosses++;
      
      if (this.metrics.consecutiveLosses >= this.metrics.maxConsecutiveLosses) {
        TradingLogger.logRisk('Maximum consecutive losses reached - triggering safety stop', {
          consecutiveLosses: this.metrics.consecutiveLosses
        });
        
        this.triggerEmergencyStop('MAX_CONSECUTIVE_LOSSES');
      }
    }
  }

  checkPositionSafety(position: Position, currentPrice: number): {
    requiresAction: boolean;
    action?: 'CLOSE' | 'ADJUST_STOP' | 'MONITOR';
    reason?: string;
  } {
    
    // Check if position is underwater by too much
    const unrealizedPnLPercentage = (position.unrealizedPnL / (position.quantity * position.entryPrice)) * 100;
    
    if (unrealizedPnLPercentage < -10) {
      TradingLogger.logRisk('Position showing large unrealized loss', {
        positionId: position.id,
        unrealizedPnLPercentage: unrealizedPnLPercentage
      });
      
      return {
        requiresAction: true,
        action: 'CLOSE',
        reason: 'Excessive unrealized loss'
      };
    }

    // Check if stop loss is too far from current price
    const stopLossDistance = position.side === 'BUY' 
      ? ((currentPrice - position.stopLossPrice) / currentPrice) * 100
      : ((position.stopLossPrice - currentPrice) / currentPrice) * 100;

    if (stopLossDistance > 5) {
      return {
        requiresAction: true,
        action: 'ADJUST_STOP',
        reason: 'Stop loss too far from current price'
      };
    }

    // Check position age
    const positionAge = Date.now() - position.timestamp;
    const maxPositionAge = 24 * 60 * 60 * 1000; // 24 hours

    if (positionAge > maxPositionAge) {
      TradingLogger.logRisk('Position held too long', {
        positionId: position.id,
        ageHours: positionAge / (60 * 60 * 1000)
      });
      
      return {
        requiresAction: true,
        action: 'CLOSE',
        reason: 'Position held too long'
      };
    }

    return { requiresAction: false };
  }

  triggerEmergencyStop(reason: string): void {
    this.metrics.emergencyStopTriggered = true;
    
    TradingLogger.logRisk('EMERGENCY STOP TRIGGERED', { reason });
    
    this.emit('emergencyStop', reason);
  }

  resetEmergencyStop(): void {
    this.metrics.emergencyStopTriggered = false;
    this.metrics.consecutiveLosses = 0;
    logger.info('Emergency stop reset');
  }

  private resetDailyMetricsIfNeeded(): void {
    const today = new Date().toDateString();
    if (this.metrics.lastResetDate !== today) {
      this.metrics.dailyTradeCount = 0;
      this.metrics.consecutiveLosses = 0;
      this.metrics.lastResetDate = today;
      logger.info('Daily safeguard metrics reset');
    }
  }

  private updateMarketVolatility(marketData: MarketData): void {
    this.priceHistory.push(marketData.price);
    
    if (this.priceHistory.length > this.maxPriceHistory) {
      this.priceHistory.shift();
    }

    // Calculate volatility score based on recent price movements
    if (this.priceHistory.length >= 10) {
      const recentPrices = this.priceHistory.slice(-10);
      const avgPrice = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;
      
      const variance = recentPrices.reduce((sum, price) => sum + Math.pow(price - avgPrice, 2), 0) / recentPrices.length;
      const stdDev = Math.sqrt(variance);
      
      // Normalize volatility score (0-100)
      this.metrics.marketVolatilityScore = Math.min(100, (stdDev / avgPrice) * 1000);
    }
  }

  private calculatePriceDeviation(currentPrice: number): number {
    if (this.priceHistory.length < 5) return 0;
    
    const recentPrices = this.priceHistory.slice(-5);
    const oldestRecentPrice = recentPrices[0];
    
    if (!oldestRecentPrice) return 0;
    
    return Math.abs((currentPrice - oldestRecentPrice) / oldestRecentPrice) * 100;
  }

  private calculateOverallRiskLevel(): 'LOW' | 'MEDIUM' | 'HIGH' {
    let riskScore = 0;
    
    // Factor in consecutive losses
    riskScore += (this.metrics.consecutiveLosses / this.metrics.maxConsecutiveLosses) * 30;
    
    // Factor in market volatility
    riskScore += (this.metrics.marketVolatilityScore / 100) * 40;
    
    // Factor in trading frequency
    const tradingFrequencyRisk = Math.min(30, (this.metrics.dailyTradeCount / 20) * 30);
    riskScore += tradingFrequencyRisk;
    
    if (riskScore >= 70) return 'HIGH';
    if (riskScore >= 40) return 'MEDIUM';
    return 'LOW';
  }

  // Circuit breaker for rapid losses
  checkCircuitBreaker(totalLossPercentage: number): boolean {
    const circuitBreakerThreshold = 15; // 15% total loss triggers circuit breaker
    
    if (totalLossPercentage >= circuitBreakerThreshold) {
      TradingLogger.logRisk('Circuit breaker triggered', {
        totalLossPercentage,
        threshold: circuitBreakerThreshold
      });
      
      this.triggerEmergencyStop('CIRCUIT_BREAKER');
      return true;
    }
    
    return false;
  }

  // Health check for system integrity
  performHealthCheck(): {
    status: 'HEALTHY' | 'WARNING' | 'CRITICAL';
    issues: string[];
  } {
    const issues: string[] = [];
    
    if (this.metrics.emergencyStopTriggered) {
      issues.push('Emergency stop is active');
    }
    
    if (this.metrics.consecutiveLosses >= 3) {
      issues.push(`High consecutive losses: ${this.metrics.consecutiveLosses}`);
    }
    
    if (this.metrics.marketVolatilityScore > 60) {
      issues.push(`High market volatility: ${this.metrics.marketVolatilityScore.toFixed(1)}`);
    }
    
    if (this.metrics.dailyTradeCount > 15) {
      issues.push(`High daily trade count: ${this.metrics.dailyTradeCount}`);
    }
    
    let status: 'HEALTHY' | 'WARNING' | 'CRITICAL' = 'HEALTHY';
    
    if (issues.length > 0) {
      status = this.metrics.emergencyStopTriggered ? 'CRITICAL' : 'WARNING';
    }
    
    return { status, issues };
  }

  getSafeguardMetrics(): SafeguardMetrics {
    return { ...this.metrics };
  }

  isEmergencyStopActive(): boolean {
    return this.metrics.emergencyStopTriggered;
  }
}
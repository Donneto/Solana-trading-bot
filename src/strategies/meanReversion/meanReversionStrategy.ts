import { EventEmitter } from 'events';
import { TradingSignal, MarketData, TradingConfig, FearGreedData } from '../../interfaces/trading';
import { logger, TradingLogger } from '../../utils/logger';
import { fearGreedService } from '../../services/fearGreed/fearGreedService';
import { AnalyticsLogger } from '../../utils/analyticsLogger';

interface TechnicalIndicators {
  sma: number;
  bollinger: {
    upper: number;
    middle: number;
    lower: number;
  };
  rsi: number;
  standardDeviation: number;
}

export class MeanReversionStrategy extends EventEmitter {
  private config: TradingConfig;
  private priceHistory: number[] = [];
  private volumeHistory: number[] = [];
  private maxHistoryLength: number;
  private lastSignalTime: number = 0;
  private signalCooldown: number = 15000; // 15 second cooldown for scalping
  private lastLoggedFearGreedValue: number | null = null;

  constructor(config: TradingConfig) {
    super();
    this.config = config;
    this.maxHistoryLength = Math.max(config.meanReversionPeriod * 2, 50);
  }

  analyzeMarket(marketData: MarketData): TradingSignal | null {
    this.updateHistory(marketData);

    if (this.priceHistory.length < this.config.meanReversionPeriod) {
      return null;
    }

    const indicators = this.calculateTechnicalIndicators();
    const signal = this.generateSignal(marketData, indicators);

    if (signal) {
      TradingLogger.logSignal(signal);
      this.emit('signal', signal);
    }

    return signal;
  }

  async analyzeMarketAsync(marketData: MarketData): Promise<TradingSignal | null> {
    await this.enrichMarketDataWithFearGreed(marketData);
    return this.analyzeMarket(marketData);
  }

  private async enrichMarketDataWithFearGreed(marketData: MarketData): Promise<void> {
    if (!this.config.fearGreedIndexEnabled) {
      return;
    }

    try {
      const fearGreedData = await fearGreedService.getFearGreedIndex();
      if (fearGreedData) {
        marketData.fearGreedIndex = fearGreedData;
        
        // Only log when the value changes to reduce spam
        if (this.lastLoggedFearGreedValue !== fearGreedData.value) {
          logger.debug('Market data enriched with Fear and Greed Index', {
            value: fearGreedData.value,
            classification: fearGreedData.valueClassification,
            source: fearGreedData.source
          });
          this.lastLoggedFearGreedValue = fearGreedData.value;
        }
      }
    } catch (error) {
      logger.warn('Failed to fetch Fear and Greed Index', { error: (error as Error).message });
    }
  }

  private updateHistory(marketData: MarketData): void {
    this.priceHistory.push(marketData.price);
    this.volumeHistory.push(marketData.volume);

    if (this.priceHistory.length > this.maxHistoryLength) {
      this.priceHistory.shift();
      this.volumeHistory.shift();
    }
  }

  private calculateTechnicalIndicators(): TechnicalIndicators {
    const period = this.config.meanReversionPeriod;
    const recentPrices = this.priceHistory.slice(-period);
    
    // Simple Moving Average
    const sma = recentPrices.reduce((sum, price) => sum + price, 0) / recentPrices.length;
    
    // Standard Deviation
    const variance = recentPrices.reduce((sum, price) => sum + Math.pow(price - sma, 2), 0) / recentPrices.length;
    const standardDeviation = Math.sqrt(variance);
    
    // Bollinger Bands
    const bollinger = {
      upper: sma + (standardDeviation * this.config.deviationThreshold),
      middle: sma,
      lower: sma - (standardDeviation * this.config.deviationThreshold)
    };
    
    // RSI (Relative Strength Index)
    const rsi = this.calculateRSI(recentPrices);
    
    return {
      sma,
      bollinger,
      rsi,
      standardDeviation
    };
  }

  private calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50; // Neutral RSI
    
    let gains = 0;
    let losses = 0;
    
    for (let i = prices.length - period; i < prices.length; i++) {
      const currentPrice = prices[i];
      const previousPrice = prices[i - 1];
      
      if (!currentPrice || !previousPrice) continue;
      
      const change = currentPrice - previousPrice;
      if (change > 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }
    
    const avgGain = gains / period;
    const avgLoss = losses / period;
    
    if (avgLoss === 0) return 100;
    
    const rs = avgGain / avgLoss;
    return 100 - (100 / (1 + rs));
  }

  private generateSignal(marketData: MarketData, indicators: TechnicalIndicators): TradingSignal | null {
    const currentTime = Date.now();
    
    // Enforce signal cooldown to prevent overtrading
    if (currentTime - this.lastSignalTime < this.signalCooldown) {
      AnalyticsLogger.logDecisionMatrix(
        this.config.symbol,
        'mean-reversion',
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
    const { bollinger, rsi, sma } = indicators;
    
    // Calculate position size based on volatility
    const volatility = indicators.standardDeviation / sma;
    const baseQuantity = this.calculatePositionSize(currentPrice, volatility);
    
    // Volume analysis
    const avgVolume = this.volumeHistory.length >= 10 
      ? this.volumeHistory.slice(-10).reduce((sum, vol) => sum + vol, 0) / 10
      : marketData.volume;
    const volumeConfirmation = marketData.volume > avgVolume * 1.00;

    // Recent momentum analysis
    const recentPrices = this.priceHistory.slice(-5);
    const firstPrice = recentPrices[0];
    const lastPrice = recentPrices[recentPrices.length - 1];
    const downwardMomentum = recentPrices.length >= 3 && 
      firstPrice && lastPrice && lastPrice < firstPrice;
    const upwardMomentum = recentPrices.length >= 3 && 
      firstPrice && lastPrice && lastPrice > firstPrice;

    // Fear and Greed analysis
    const fearGreedBuyConfirmation = this.getFearGreedConfirmation(marketData.fearGreedIndex, 'BUY');
    const fearGreedSellConfirmation = this.getFearGreedConfirmation(marketData.fearGreedIndex, 'SELL');

    let signal: TradingSignal | null = null;
    let finalDecision = 'HOLD';
    let confidence = 0;

    // BUY Analysis
    const buyConditions = [
      {
        name: 'Below Lower Bollinger Band',
        current: `Price $${currentPrice.toFixed(2)} vs Lower Band $${bollinger.lower.toFixed(2)}`,
        required: 'Price <= Lower Band',
        met: currentPrice <= bollinger.lower,
        importance: 'CRITICAL' as const,
        description: 'Price touching or below lower Bollinger Band indicates oversold'
      },
      {
        name: 'RSI Oversold',
        current: rsi.toFixed(1),
        required: '<= 30 (oversold)',
        met: rsi <= 30,
        importance: 'HIGH' as const,
        description: 'RSI indicates oversold condition'
      },
      {
        name: 'Below SMA',
        current: `Price $${currentPrice.toFixed(2)} vs SMA $${bollinger.middle.toFixed(2)}`,
        required: 'Price < SMA',
        met: currentPrice < bollinger.middle,
        importance: 'MEDIUM' as const,
        description: 'Price below simple moving average'
      },
      {
        name: 'Volume Confirmation',
        current: `${marketData.volume.toFixed(0)} vs ${avgVolume.toFixed(0)} avg`,
        required: '> 100% of average',
        met: volumeConfirmation,
        importance: 'MEDIUM' as const,
        description: 'Sufficient volume to support the move'
      },
      {
        name: 'Downward Momentum',
        current: downwardMomentum ? 'Present' : 'Absent',
        required: 'Recent downward price movement',
        met: !!downwardMomentum,
        importance: 'HIGH' as const,
        description: 'Recent downward momentum for mean reversion'
      },
      {
        name: 'Fear & Greed Confirmation',
        current: marketData.fearGreedIndex ? `${marketData.fearGreedIndex.value} (${marketData.fearGreedIndex.valueClassification})` : 'N/A',
        required: 'Supports bearish sentiment for mean reversion',
        met: fearGreedBuyConfirmation,
        importance: 'LOW' as const,
        description: 'Market sentiment alignment for contrarian strategy'
      }
    ];

    // SELL Analysis
    const sellConditions = [
      {
        name: 'Above Upper Bollinger Band',
        current: `Price $${currentPrice.toFixed(2)} vs Upper Band $${bollinger.upper.toFixed(2)}`,
        required: 'Price >= Upper Band',
        met: currentPrice >= bollinger.upper,
        importance: 'CRITICAL' as const,
        description: 'Price touching or above upper Bollinger Band indicates overbought'
      },
      {
        name: 'RSI Overbought',
        current: rsi.toFixed(1),
        required: '>= 70 (overbought)',
        met: rsi >= 70,
        importance: 'HIGH' as const,
        description: 'RSI indicates overbought condition'
      },
      {
        name: 'Above SMA',
        current: `Price $${currentPrice.toFixed(2)} vs SMA $${bollinger.middle.toFixed(2)}`,
        required: 'Price > SMA',
        met: currentPrice > bollinger.middle,
        importance: 'MEDIUM' as const,
        description: 'Price above simple moving average'
      },
      {
        name: 'Volume Confirmation',
        current: `${marketData.volume.toFixed(0)} vs ${avgVolume.toFixed(0)} avg`,
        required: '> 100% of average',
        met: volumeConfirmation,
        importance: 'MEDIUM' as const,
        description: 'Sufficient volume to support the move'
      },
      {
        name: 'Upward Momentum',
        current: upwardMomentum ? 'Present' : 'Absent',
        required: 'Recent upward price movement',
        met: !!upwardMomentum,
        importance: 'HIGH' as const,
        description: 'Recent upward momentum for mean reversion'
      },
      {
        name: 'Fear & Greed Confirmation',
        current: marketData.fearGreedIndex ? `${marketData.fearGreedIndex.value} (${marketData.fearGreedIndex.valueClassification})` : 'N/A',
        required: 'Supports bullish sentiment for mean reversion',
        met: fearGreedSellConfirmation,
        importance: 'LOW' as const,
        description: 'Market sentiment alignment for contrarian strategy'
      }
    ];

    // Check BUY conditions
    const criticalBuyMet = buyConditions.filter(c => c.importance === 'CRITICAL').every(c => c.met);
    const buyScore = buyConditions.filter(c => c.met).length / buyConditions.length * 100;
    
    if (criticalBuyMet && buyScore >= 60) {
      confidence = this.calculateConfidence(currentPrice, bollinger, rsi, 'BUY', marketData.fearGreedIndex);
      
      if (confidence >= 60) {
        signal = {
          action: 'BUY',
          confidence,
          price: currentPrice,
          quantity: baseQuantity,
          reason: this.generateReason(currentPrice, bollinger, rsi, 'BUY', marketData.fearGreedIndex),
          timestamp: currentTime,
          stopLoss: currentPrice * (1 - this.config.stopLossPercentage / 100),
          takeProfit: currentPrice * (1 + this.config.takeProfitPercentage / 100)
        };
        finalDecision = 'BUY';
      }
    }
    
    // Check SELL conditions if no BUY signal
    if (!signal) {
      const criticalSellMet = sellConditions.filter(c => c.importance === 'CRITICAL').every(c => c.met);
      const sellScore = sellConditions.filter(c => c.met).length / sellConditions.length * 100;
      
      if (criticalSellMet && sellScore >= 60) {
        confidence = this.calculateConfidence(currentPrice, bollinger, rsi, 'SELL', marketData.fearGreedIndex);
        
        if (confidence >= 60) {
          signal = {
            action: 'SELL',
            confidence,
            price: currentPrice,
            quantity: baseQuantity,
            reason: this.generateReason(currentPrice, bollinger, rsi, 'SELL', marketData.fearGreedIndex),
            timestamp: currentTime,
            stopLoss: currentPrice * (1 + this.config.stopLossPercentage / 100),
            takeProfit: currentPrice * (1 - this.config.takeProfitPercentage / 100)
          };
          finalDecision = 'SELL';
        }
      }
      
      // Log SELL analysis
      AnalyticsLogger.logDecisionMatrix(
        this.config.symbol,
        'mean-reversion',
        currentPrice,
        sellConditions,
        finalDecision,
        confidence
      );
    } else {
      // Log BUY analysis
      AnalyticsLogger.logDecisionMatrix(
        this.config.symbol,
        'mean-reversion',
        currentPrice,
        buyConditions,
        finalDecision,
        confidence
      );
    }

    // Log comprehensive indicator snapshot
    AnalyticsLogger.logIndicatorSnapshot({
      timestamp: currentTime,
      price: currentPrice,
      symbol: this.config.symbol,
      strategy: 'mean-reversion',
      indicators: {
        sma: indicators.sma,
        bollingerUpper: bollinger.upper,
        bollingerMiddle: bollinger.middle,
        bollingerLower: bollinger.lower,
        rsi: indicators.rsi,
        standardDeviation: indicators.standardDeviation,
        volatility: volatility,
        meanReversionPeriod: this.config.meanReversionPeriod,
        deviationThreshold: this.config.deviationThreshold
      },
      marketData,
      decisionPoints: {
        belowLowerBand: currentPrice <= bollinger.lower,
        aboveUpperBand: currentPrice >= bollinger.upper,
        belowSMA: currentPrice < bollinger.middle,
        aboveSMA: currentPrice > bollinger.middle,
        rsiOversold: rsi <= 30,
        rsiOverbought: rsi >= 70,
        volumeConfirmation,
        downwardMomentum: !!downwardMomentum,
        upwardMomentum: !!upwardMomentum,
        fearGreedBuyConfirmation,
        fearGreedSellConfirmation,
        priceDistanceFromSMA: Math.abs(currentPrice - bollinger.middle) / bollinger.middle * 100,
        bandWidth: (bollinger.upper - bollinger.lower) / bollinger.middle * 100,
        buyScore,
        sellScore: sellConditions.filter(c => c.met).length / sellConditions.length * 100
      },
      signalGenerated: signal !== null,
      signalReason: signal?.reason || '',
      confidence: signal?.confidence || 0,
      blockingFactors: signal ? [] : [
        ...buyConditions.filter(c => !c.met && c.importance === 'CRITICAL').map(c => `BUY: ${c.name}`),
        ...sellConditions.filter(c => !c.met && c.importance === 'CRITICAL').map(c => `SELL: ${c.name}`)
      ]
    });

    if (signal) {
      this.lastSignalTime = currentTime;
      logger.info(`🎯 MEAN REVERSION SIGNAL GENERATED: ${signal.action} at $${currentPrice} (${confidence}% confidence)`);
    }

    return signal;
  }

  private getFearGreedConfirmation(fearGreedData: FearGreedData | undefined, action: 'BUY' | 'SELL'): boolean {
    if (!fearGreedData) return true; // No data means no filter

    const { value, valueClassification } = fearGreedData;

    if (action === 'BUY') {
      // Buy signals are stronger during fear periods (mean reversion opportunity)
      // Extreme Fear (0-25): Strong buy confirmation
      // Fear (25-45): Good buy confirmation
      // Neutral (45-55): Moderate confirmation
      // Greed (55-75): Weak confirmation
      // Extreme Greed (75-100): No confirmation (avoid buying during extreme greed)
      
      if (valueClassification === 'Extreme Fear') return true;
      if (valueClassification === 'Fear') return true;
      if (valueClassification === 'Neutral') return value <= 50; // Lower neutral range
      if (valueClassification === 'Greed') return false; // Avoid buying during greed
      if (valueClassification === 'Extreme Greed') return false; // Definitely avoid

    } else if (action === 'SELL') {
      // Sell signals are stronger during greed periods (mean reversion opportunity)
      // Extreme Greed (75-100): Strong sell confirmation
      // Greed (55-75): Good sell confirmation
      // Neutral (45-55): Moderate confirmation
      // Fear (25-45): Weak confirmation
      // Extreme Fear (0-25): No confirmation (avoid selling during extreme fear)
      
      if (valueClassification === 'Extreme Greed') return true;
      if (valueClassification === 'Greed') return true;
      if (valueClassification === 'Neutral') return value >= 50; // Upper neutral range
      if (valueClassification === 'Fear') return false; // Avoid selling during fear
      if (valueClassification === 'Extreme Fear') return false; // Definitely avoid
    }

    return true; // Default to allowing signal
  }

  private calculateConfidence(price: number, bollinger: any, rsi: number, action: 'BUY' | 'SELL', fearGreedData?: FearGreedData): number {
    let confidence = 0;
    
    if (action === 'BUY') {
      // Distance below lower band increases confidence
      const bandDistance = (bollinger.lower - price) / bollinger.lower * 100;
      confidence += Math.min(bandDistance * 10, 30);
      
      // Oversold RSI increases confidence
      if (rsi <= 30) confidence += 25;
      else if (rsi <= 40) confidence += 15;
      
      // Distance below SMA
      const smaDistance = (bollinger.middle - price) / bollinger.middle * 100;
      confidence += Math.min(smaDistance * 5, 20);
      
    } else {
      // Distance above upper band increases confidence
      const bandDistance = (price - bollinger.upper) / bollinger.upper * 100;
      confidence += Math.min(bandDistance * 10, 30);
      
      // Overbought RSI increases confidence
      if (rsi >= 70) confidence += 25;
      else if (rsi >= 60) confidence += 15;
      
      // Distance above SMA
      const smaDistance = (price - bollinger.middle) / bollinger.middle * 100;
      confidence += Math.min(smaDistance * 5, 20);
    }
    
    // Recent volatility (higher volatility = lower confidence)
    const volatility = bollinger.upper - bollinger.lower;
    const volatilityPenalty = Math.min(volatility / bollinger.middle * 50, 15);
    confidence -= volatilityPenalty;
    
    // Fear and Greed Index confidence boost/penalty
    if (fearGreedData) {
      const fearGreedBoost = this.calculateFearGreedConfidenceAdjustment(fearGreedData, action);
      confidence += fearGreedBoost;
      
      logger.debug('Fear and Greed Index confidence adjustment', {
        action,
        fearGreedValue: fearGreedData.value,
        fearGreedClassification: fearGreedData.valueClassification,
        confidenceAdjustment: fearGreedBoost,
        source: fearGreedData.source
      });
    }
    
    return Math.max(0, Math.min(100, confidence + 25)); // Base confidence of 25
  }

  private calculateFearGreedConfidenceAdjustment(fearGreedData: FearGreedData, action: 'BUY' | 'SELL'): number {
    const { value, valueClassification } = fearGreedData;
    
    if (action === 'BUY') {
      // More fear = higher confidence for buy signals (mean reversion)
      switch (valueClassification) {
        case 'Extreme Fear':
          return 20; // Strong boost for buying during extreme fear
        case 'Fear':
          return 15; // Good boost for buying during fear
        case 'Neutral':
          return value <= 45 ? 5 : -5; // Small boost/penalty based on neutral range
        case 'Greed':
          return -10; // Penalty for buying during greed
        case 'Extreme Greed':
          return -20; // Strong penalty for buying during extreme greed
        default:
          return 0;
      }
    } else {
      // More greed = higher confidence for sell signals (mean reversion)
      switch (valueClassification) {
        case 'Extreme Greed':
          return 20; // Strong boost for selling during extreme greed
        case 'Greed':
          return 15; // Good boost for selling during greed
        case 'Neutral':
          return value >= 55 ? 5 : -5; // Small boost/penalty based on neutral range
        case 'Fear':
          return -10; // Penalty for selling during fear
        case 'Extreme Fear':
          return -20; // Strong penalty for selling during extreme fear
        default:
          return 0;
      }
    }
  }

  private generateReason(price: number, bollinger: any, rsi: number, action: 'BUY' | 'SELL', fearGreedData?: FearGreedData): string {
    const baseReason = action === 'BUY' 
      ? `Mean reversion BUY: Price ${price.toFixed(2)} below lower band ${bollinger.lower.toFixed(2)}, RSI: ${rsi.toFixed(1)}`
      : `Mean reversion SELL: Price ${price.toFixed(2)} above upper band ${bollinger.upper.toFixed(2)}, RSI: ${rsi.toFixed(1)}`;

    if (fearGreedData) {
      const fearGreedSuffix = `, Fear & Greed: ${fearGreedData.value} (${fearGreedData.valueClassification})`;
      return baseReason + fearGreedSuffix;
    }

    return baseReason;
  }

  private calculatePositionSize(price: number, volatility: number): number {
    // Base position size from config
    const baseSize = this.config.positionSizePercentage / 100;
    
    // Adjust for volatility (lower size for higher volatility)
    const volatilityAdjustment = Math.max(0.5, 1 - (volatility * 2));
    
    // Calculate quantity based on current price and adjusted size
    const adjustedSize = baseSize * volatilityAdjustment;
    
    // Use initial capital as baseline (current balance should be passed from trading engine)
    const capital = this.config.initialCapital;
    const positionValue = capital * adjustedSize;
    
    // Ensure minimum order value (Binance requires ~$10 minimum)
    const minOrderValue = 10;
    const calculatedValue = Math.max(minOrderValue, positionValue);
    
    return parseFloat((calculatedValue / price).toFixed(6));
  }

  getStrategyState() {
    return {
      priceHistoryLength: this.priceHistory.length,
      lastPrice: this.priceHistory[this.priceHistory.length - 1],
      lastSignalTime: this.lastSignalTime,
      indicators: this.priceHistory.length >= this.config.meanReversionPeriod 
        ? this.calculateTechnicalIndicators() 
        : null
    };
  }

  reset(): void {
    this.priceHistory = [];
    this.volumeHistory = [];
    this.lastSignalTime = 0;
    logger.info('Mean reversion strategy reset');
  }
}
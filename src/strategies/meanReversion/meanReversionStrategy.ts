import { EventEmitter } from 'events';
import { TradingSignal, MarketData, TradingConfig, FearGreedData } from '../../interfaces/trading';
import { logger, TradingLogger } from '../../utils/logger';
import { fearGreedService } from '../../services/fearGreed/fearGreedService';

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
  private signalCooldown: number = 60000; // 1 minute cooldown
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
      return null;
    }

    const currentPrice = marketData.price;
    const { bollinger, rsi, sma } = indicators;
    
    // Calculate position size based on volatility
    const volatility = indicators.standardDeviation / sma;
    const baseQuantity = this.calculatePositionSize(currentPrice, volatility);
    
    let signal: TradingSignal | null = null;

    // Mean Reversion Logic
    if (this.shouldBuy(currentPrice, bollinger, rsi, marketData)) {
      signal = {
        action: 'BUY',
        confidence: this.calculateConfidence(currentPrice, bollinger, rsi, 'BUY', marketData.fearGreedIndex),
        price: currentPrice,
        quantity: baseQuantity,
        reason: this.generateReason(currentPrice, bollinger, rsi, 'BUY', marketData.fearGreedIndex),
        timestamp: currentTime,
        stopLoss: currentPrice * (1 - this.config.stopLossPercentage / 100),
        takeProfit: currentPrice * (1 + this.config.takeProfitPercentage / 100)
      };
    } else if (this.shouldSell(currentPrice, bollinger, rsi, marketData)) {
      signal = {
        action: 'SELL',
        confidence: this.calculateConfidence(currentPrice, bollinger, rsi, 'SELL', marketData.fearGreedIndex),
        price: currentPrice,
        quantity: baseQuantity,
        reason: this.generateReason(currentPrice, bollinger, rsi, 'SELL', marketData.fearGreedIndex),
        timestamp: currentTime,
        stopLoss: currentPrice * (1 + this.config.stopLossPercentage / 100),
        takeProfit: currentPrice * (1 - this.config.takeProfitPercentage / 100)
      };
    }

    if (signal && signal.confidence >= 70) {
      this.lastSignalTime = currentTime;
      return signal;
    }

    return null;
  }

  private shouldBuy(price: number, bollinger: any, rsi: number, marketData: MarketData): boolean {
    // Buy when price touches or breaks below lower Bollinger Band
    const belowLowerBand = price <= bollinger.lower;
    
    // RSI indicates oversold condition
    const oversold = rsi <= 30;
    
    // Price is below SMA (mean reversion opportunity)
    const belowMean = price < bollinger.middle;
    
    // Volume confirmation (higher than average)
    const avgVolume = this.volumeHistory.length >= 10 
      ? this.volumeHistory.slice(-10).reduce((sum, vol) => sum + vol, 0) / 10
      : marketData.volume;
    const volumeConfirmation = marketData.volume > avgVolume * 1.2;
    
    // Recent downward momentum (for mean reversion)
    const recentPrices = this.priceHistory.slice(-5);
    const firstPrice = recentPrices[0];
    const lastPrice = recentPrices[recentPrices.length - 1];
    const downwardMomentum = recentPrices.length >= 3 && 
      firstPrice && lastPrice && lastPrice < firstPrice;

    // Fear and Greed Index sentiment check
    const fearGreedConfirmation = this.getFearGreedConfirmation(marketData.fearGreedIndex, 'BUY');

    const technicalSignal = belowLowerBand && (oversold || belowMean) && volumeConfirmation && !!downwardMomentum;
    
    // If Fear and Greed Index is available, use it to filter signals
    if (marketData.fearGreedIndex) {
      return technicalSignal && fearGreedConfirmation;
    }

    return technicalSignal;
  }

  private shouldSell(price: number, bollinger: any, rsi: number, marketData: MarketData): boolean {
    // Sell when price touches or breaks above upper Bollinger Band
    const aboveUpperBand = price >= bollinger.upper;
    
    // RSI indicates overbought condition
    const overbought = rsi >= 70;
    
    // Price is above SMA (mean reversion opportunity)
    const aboveMean = price > bollinger.middle;
    
    // Volume confirmation
    const avgVolume = this.volumeHistory.length >= 10 
      ? this.volumeHistory.slice(-10).reduce((sum, vol) => sum + vol, 0) / 10
      : marketData.volume;
    const volumeConfirmation = marketData.volume > avgVolume * 1.2;
    
    // Recent upward momentum (for mean reversion)
    const recentPrices = this.priceHistory.slice(-5);
    const firstPrice = recentPrices[0];
    const lastPrice = recentPrices[recentPrices.length - 1];
    const upwardMomentum = recentPrices.length >= 3 && 
      firstPrice && lastPrice && lastPrice > firstPrice;

    // Fear and Greed Index sentiment check
    const fearGreedConfirmation = this.getFearGreedConfirmation(marketData.fearGreedIndex, 'SELL');

    const technicalSignal = aboveUpperBand && (overbought || aboveMean) && volumeConfirmation && !!upwardMomentum;
    
    // If Fear and Greed Index is available, use it to filter signals
    if (marketData.fearGreedIndex) {
      return technicalSignal && fearGreedConfirmation;
    }

    return technicalSignal;
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
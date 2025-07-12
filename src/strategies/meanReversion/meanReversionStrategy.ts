import { EventEmitter } from 'events';
import { TradingSignal, MarketData, TradingConfig } from '../../interfaces/trading';
import { logger, TradingLogger } from '../../utils/logger';

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
        confidence: this.calculateConfidence(currentPrice, bollinger, rsi, 'BUY'),
        price: currentPrice,
        quantity: baseQuantity,
        reason: this.generateReason(currentPrice, bollinger, rsi, 'BUY'),
        timestamp: currentTime,
        stopLoss: currentPrice * (1 - this.config.stopLossPercentage / 100),
        takeProfit: currentPrice * (1 + this.config.takeProfitPercentage / 100)
      };
    } else if (this.shouldSell(currentPrice, bollinger, rsi, marketData)) {
      signal = {
        action: 'SELL',
        confidence: this.calculateConfidence(currentPrice, bollinger, rsi, 'SELL'),
        price: currentPrice,
        quantity: baseQuantity,
        reason: this.generateReason(currentPrice, bollinger, rsi, 'SELL'),
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

    return belowLowerBand && (oversold || belowMean) && volumeConfirmation && !!downwardMomentum;
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

    return aboveUpperBand && (overbought || aboveMean) && volumeConfirmation && !!upwardMomentum;
  }

  private calculateConfidence(price: number, bollinger: any, rsi: number, action: 'BUY' | 'SELL'): number {
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
    
    return Math.max(0, Math.min(100, confidence + 25)); // Base confidence of 25
  }

  private generateReason(price: number, bollinger: any, rsi: number, action: 'BUY' | 'SELL'): string {
    if (action === 'BUY') {
      return `Mean reversion BUY: Price ${price.toFixed(2)} below lower band ${bollinger.lower.toFixed(2)}, RSI: ${rsi.toFixed(1)}`;
    } else {
      return `Mean reversion SELL: Price ${price.toFixed(2)} above upper band ${bollinger.upper.toFixed(2)}, RSI: ${rsi.toFixed(1)}`;
    }
  }

  private calculatePositionSize(price: number, volatility: number): number {
    // Base position size from config
    const baseSize = this.config.positionSizePercentage / 100;
    
    // Adjust for volatility (lower size for higher volatility)
    const volatilityAdjustment = Math.max(0.5, 1 - (volatility * 2));
    
    // Calculate quantity based on current price and adjusted size
    const adjustedSize = baseSize * volatilityAdjustment;
    
    // Assuming $300 initial capital from config
    const capital = this.config.initialCapital;
    const positionValue = capital * adjustedSize;
    
    return parseFloat((positionValue / price).toFixed(6));
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
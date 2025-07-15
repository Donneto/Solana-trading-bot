import { EventEmitter } from 'events';
import { TradingSignal, MarketData, TradingConfig, FearGreedData } from '../../interfaces/trading';
import { logger, TradingLogger } from '../../utils/logger';
import { fearGreedService } from '../../services/fearGreed/fearGreedService';
import { AnalyticsLogger } from '../../utils/analyticsLogger';

interface MomentumIndicators {
  ema12: number;
  ema26: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  rsi: number;
  adx: number;
  trendStrength: 'STRONG_UP' | 'WEAK_UP' | 'NEUTRAL' | 'WEAK_DOWN' | 'STRONG_DOWN';
}

interface TrendState {
  direction: 'UP' | 'DOWN' | 'SIDEWAYS';
  strength: number;
  duration: number;
  lastTrendChange: number;
}

export class MomentumStrategy extends EventEmitter {
  private config: TradingConfig;
  private priceHistory: number[] = [];
  private volumeHistory: number[] = [];
  private emaCache: { [period: number]: number[] } = {};
  private lastSignalTime: number = 0;
  private signalCooldown: number = 300000; // 5 minute cooldown - prevent overtrading
  private trendState: TrendState;
  private lastLoggedFearGreedValue: number | null = null;
  private riskManager: any; // Will be injected by TradingEngine

  constructor(config: TradingConfig) {
    super();
    this.config = config;
    this.trendState = {
      direction: 'SIDEWAYS',
      strength: 0,
      duration: 0,
      lastTrendChange: Date.now()
    };
  }

  setRiskManager(riskManager: any): void {
    this.riskManager = riskManager;
  }

  analyzeMarket(marketData: MarketData): TradingSignal | null {
    this.updateHistory(marketData);

    if (this.priceHistory.length < 26) {
      return null;
    }

    const indicators = this.calculateMomentumIndicators();
    this.updateTrendState(indicators);
    const signal = this.generateMomentumSignal(marketData, indicators);

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

    const maxLength = 200; // Keep enough for indicators
    if (this.priceHistory.length > maxLength) {
      this.priceHistory.shift();
      this.volumeHistory.shift();
      
      // Clean EMA cache
      Object.keys(this.emaCache).forEach(period => {
        const periodKey = parseInt(period);
        if (this.emaCache[periodKey] && this.emaCache[periodKey].length > maxLength) {
          this.emaCache[periodKey].shift();
        }
      });
    }
  }

  private calculateMomentumIndicators(): MomentumIndicators {
    const ema12 = this.calculateEMA(12);
    const ema26 = this.calculateEMA(26);
    const macd = ema12 - ema26;
    const macdSignal = this.calculateEMAFromValues(this.getMACDHistory(), 9);
    const macdHistogram = macd - macdSignal;
    const rsi = this.calculateRSI();
    const adx = this.calculateADX();
    const trendStrength = this.determineTrendStrength(ema12, ema26, adx, rsi);

    return {
      ema12,
      ema26,
      macd,
      macdSignal,
      macdHistogram,
      rsi,
      adx,
      trendStrength
    };
  }

  private calculateEMA(period: number): number {
    if (!this.emaCache[period]) {
      this.emaCache[period] = [];
    }

    const prices = this.priceHistory;
    const emaValues = this.emaCache[period];
    
    if (emaValues.length === 0) {
      // Initialize with SMA
      if (prices.length >= period) {
        const sma = prices.slice(-period).reduce((sum, price) => sum + price, 0) / period;
        emaValues.push(sma);
        return sma;
      }
      return prices[prices.length - 1] || 0;
    }

    const multiplier = 2 / (period + 1);
    const currentPrice = prices[prices.length - 1] || 0;
    const previousEMA = emaValues[emaValues.length - 1] || 0;
    const newEMA = (currentPrice * multiplier) + (previousEMA * (1 - multiplier));
    
    emaValues.push(newEMA);
    return newEMA;
  }

  private calculateEMAFromValues(values: number[], period: number): number {
    if (values.length === 0) return 0;
    if (values.length === 1) return values[0] || 0;

    const multiplier = 2 / (period + 1);
    let ema = values[0] || 0;

    for (let i = 1; i < values.length; i++) {
      const currentValue = values[i] || 0;
      ema = (currentValue * multiplier) + (ema * (1 - multiplier));
    }

    return ema;
  }

  private getMACDHistory(): number[] {
    const macdHistory: number[] = [];
    const ema12Cache = this.emaCache[12] || [];
    const ema26Cache = this.emaCache[26] || [];
    const minLength = Math.min(ema12Cache.length, ema26Cache.length);
    
    for (let i = 0; i < minLength; i++) {
      const ema12 = ema12Cache[i] || 0;
      const ema26 = ema26Cache[i] || 0;
      macdHistory.push(ema12 - ema26);
    }
    
    return macdHistory;
  }

  private calculateRSI(period: number = 14): number {
    if (this.priceHistory.length < period + 1) return 50;
    
    const prices = this.priceHistory.slice(-period - 1);
    let gains = 0;
    let losses = 0;
    
    for (let i = 1; i < prices.length; i++) {
      const currentPrice = prices[i] || 0;
      const previousPrice = prices[i - 1] || 0;
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

  private calculateADX(period: number = 14): number {
    if (this.priceHistory.length < period + 1) return 0;
    
    const prices = this.priceHistory.slice(-period);
    let positiveMovement = 0;
    let negativeMovement = 0;
    
    for (let i = 1; i < prices.length; i++) {
      const currentPrice = prices[i] || 0;
      const previousPrice = prices[i - 1] || 0;
      const upMove = currentPrice - previousPrice;
      const downMove = previousPrice - currentPrice;
      
      if (upMove > downMove && upMove > 0) {
        positiveMovement += upMove;
      }
      if (downMove > upMove && downMove > 0) {
        negativeMovement += downMove;
      }
    }
    
    const totalMovement = positiveMovement + negativeMovement;
    if (totalMovement === 0) return 0;
    
    const dx = Math.abs(positiveMovement - negativeMovement) / totalMovement * 100;
    return dx;
  }

  private determineTrendStrength(ema12: number, ema26: number, adx: number, rsi: number): MomentumIndicators['trendStrength'] {
    const emaDiff = (ema12 - ema26) / ema26 * 100;
    
    if (adx > 40 && emaDiff > 0.5 && rsi > 60) return 'STRONG_UP';
    if (adx > 40 && emaDiff < -0.5 && rsi < 40) return 'STRONG_DOWN';
    if (emaDiff > 0.2 && rsi > 50) return 'WEAK_UP';
    if (emaDiff < -0.2 && rsi < 50) return 'WEAK_DOWN';
    
    return 'NEUTRAL';
  }

  private updateTrendState(indicators: MomentumIndicators): void {
    const { ema12, ema26, adx } = indicators;
    const currentTime = Date.now();
    
    let newDirection: TrendState['direction'] = 'SIDEWAYS';
    if (ema12 > ema26 && adx > 20) newDirection = 'UP';
    else if (ema12 < ema26 && adx > 20) newDirection = 'DOWN';
    
    if (newDirection !== this.trendState.direction) {
      this.trendState.lastTrendChange = currentTime;
      this.trendState.duration = 0;
    } else {
      this.trendState.duration = currentTime - this.trendState.lastTrendChange;
    }
    
    this.trendState.direction = newDirection;
    this.trendState.strength = adx;
  }

  private generateMomentumSignal(marketData: MarketData, indicators: MomentumIndicators): TradingSignal | null {
    const currentTime = Date.now();
    const currentPrice = marketData.price;
    const { macd, macdSignal, macdHistogram, rsi, ema12, ema26, trendStrength } = indicators;
    
    // Cooldown check
    if (currentTime - this.lastSignalTime < this.signalCooldown) {
      AnalyticsLogger.logDecisionMatrix(
        this.config.symbol,
        'momentum',
        currentPrice,
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

    // Calculate conditions
    const bullishCrossover = macd > macdSignal && macdHistogram > 0;
    const bullishTrend = ema12 > ema26;
    const oversoldRecovery = rsi > 25 && rsi < 75;
    const strongMomentum = trendStrength === 'STRONG_UP' || trendStrength === 'WEAK_UP';

    const bearishCrossover = macd < macdSignal && macdHistogram < 0;
    const bearishTrend = ema12 < ema26;
    const overboughtCorrection = rsi > 25 && rsi < 75;
    const weakMomentum = trendStrength === 'STRONG_DOWN' || trendStrength === 'WEAK_DOWN';

    // Volume analysis
    const avgVolume = this.volumeHistory.length >= 10 
      ? this.volumeHistory.slice(-10).reduce((sum, vol) => sum + vol, 0) / 10
      : marketData.volume;
    const volumeConfirmation = marketData.volume > avgVolume * 1.05;

    // Fear & Greed analysis
    const fearGreedBuyConfirmation = this.getFearGreedMomentumConfirmation(marketData.fearGreedIndex, 'BUY');
    const fearGreedSellConfirmation = this.getFearGreedMomentumConfirmation(marketData.fearGreedIndex, 'SELL');

    // BUY Analysis
    const buyConditions = [
      {
        name: 'MACD Bullish Crossover',
        current: `MACD: ${macd.toFixed(4)}, Signal: ${macdSignal.toFixed(4)}, Histogram: ${macdHistogram.toFixed(4)}`,
        required: 'MACD > Signal AND Histogram > 0',
        met: bullishCrossover,
        importance: 'HIGH' as const,
        description: 'MACD indicates bullish momentum'
      },
      {
        name: 'Bullish Trend',
        current: `EMA12: ${ema12.toFixed(2)}, EMA26: ${ema26.toFixed(2)}`,
        required: 'EMA12 > EMA26',
        met: bullishTrend,
        importance: 'CRITICAL' as const,
        description: 'Short-term average above long-term average'
      },
      {
        name: 'RSI Range',
        current: rsi.toFixed(1),
        required: '25-75 range',
        met: oversoldRecovery,
        importance: 'MEDIUM' as const,
        description: 'RSI not in extreme territory'
      },
      {
        name: 'Momentum Strength',
        current: trendStrength,
        required: 'STRONG_UP or WEAK_UP',
        met: strongMomentum,
        importance: 'HIGH' as const,
        description: 'Trend analysis confirms upward momentum'
      },
      {
        name: 'Volume Confirmation',
        current: `${marketData.volume.toFixed(0)} vs ${avgVolume.toFixed(0)} avg`,
        required: '> 105% of average',
        met: volumeConfirmation,
        importance: 'MEDIUM' as const,
        description: 'Sufficient volume to support the move'
      },
      {
        name: 'Fear & Greed',
        current: marketData.fearGreedIndex ? `${marketData.fearGreedIndex.value} (${marketData.fearGreedIndex.valueClassification})` : 'N/A',
        required: 'Supports bullish sentiment',
        met: fearGreedBuyConfirmation,
        importance: 'LOW' as const,
        description: 'Market sentiment alignment'
      }
    ];

    // SELL Analysis
    const sellConditions = [
      {
        name: 'MACD Bearish Crossover',
        current: `MACD: ${macd.toFixed(4)}, Signal: ${macdSignal.toFixed(4)}, Histogram: ${macdHistogram.toFixed(4)}`,
        required: 'MACD < Signal AND Histogram < 0',
        met: bearishCrossover,
        importance: 'HIGH' as const,
        description: 'MACD indicates bearish momentum'
      },
      {
        name: 'Bearish Trend',
        current: `EMA12: ${ema12.toFixed(2)}, EMA26: ${ema26.toFixed(2)}`,
        required: 'EMA12 < EMA26',
        met: bearishTrend,
        importance: 'CRITICAL' as const,
        description: 'Short-term average below long-term average'
      },
      {
        name: 'RSI Range',
        current: rsi.toFixed(1),
        required: '25-75 range',
        met: overboughtCorrection,
        importance: 'MEDIUM' as const,
        description: 'RSI not in extreme territory'
      },
      {
        name: 'Momentum Weakness',
        current: trendStrength,
        required: 'STRONG_DOWN or WEAK_DOWN',
        met: weakMomentum,
        importance: 'HIGH' as const,
        description: 'Trend analysis confirms downward momentum'
      },
      {
        name: 'Volume Confirmation',
        current: `${marketData.volume.toFixed(0)} vs ${avgVolume.toFixed(0)} avg`,
        required: '> 105% of average',
        met: volumeConfirmation,
        importance: 'MEDIUM' as const,
        description: 'Sufficient volume to support the move'
      },
      {
        name: 'Fear & Greed',
        current: marketData.fearGreedIndex ? `${marketData.fearGreedIndex.value} (${marketData.fearGreedIndex.valueClassification})` : 'N/A',
        required: 'Supports bearish sentiment',
        met: fearGreedSellConfirmation,
        importance: 'LOW' as const,
        description: 'Market sentiment alignment'
      }
    ];

    let signal: TradingSignal | null = null;
    let finalDecision = 'HOLD';
    let confidence = 0;

    // Check BUY conditions
    const criticalBuyMet = buyConditions.filter(c => c.importance === 'CRITICAL').every(c => c.met);
    const buyScore = buyConditions.filter(c => c.met).length / buyConditions.length * 100;
    
    if (criticalBuyMet && buyScore >= 75) {
      confidence = this.calculateMomentumConfidence('BUY', indicators, marketData.fearGreedIndex);
      
        if (confidence >= 75) {        signal = {
          action: 'BUY',
          confidence,
          price: currentPrice,
          quantity: this.calculatePositionSize(currentPrice),
          reason: this.generateMomentumReason('BUY', indicators, marketData.fearGreedIndex),
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
      
      if (criticalSellMet && sellScore >= 75) {
        confidence = this.calculateMomentumConfidence('SELL', indicators, marketData.fearGreedIndex);
        
        if (confidence >= 75) {
          signal = {
            action: 'SELL',
            confidence,
            price: currentPrice,
            quantity: this.calculatePositionSize(currentPrice),
            reason: this.generateMomentumReason('SELL', indicators, marketData.fearGreedIndex),
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
        'momentum',
        currentPrice,
        sellConditions,
        finalDecision,
        confidence
      );
    } else {
      // Log BUY analysis
      AnalyticsLogger.logDecisionMatrix(
        this.config.symbol,
        'momentum',
        currentPrice,
        buyConditions,
        finalDecision,
        confidence
      );
    }

    // Log indicator snapshot
    AnalyticsLogger.logIndicatorSnapshot({
      timestamp: currentTime,
      price: currentPrice,
      symbol: this.config.symbol,
      strategy: 'momentum',
      indicators,
      marketData,
      decisionPoints: {
        bullishCrossover,
        bullishTrend,
        oversoldRecovery,
        strongMomentum,
        bearishCrossover,
        bearishTrend,
        overboughtCorrection,
        weakMomentum,
        volumeConfirmation,
        fearGreedBuyConfirmation,
        fearGreedSellConfirmation,
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
      logger.info(`🎯 MOMENTUM SIGNAL GENERATED: ${signal.action} at $${currentPrice} (${confidence}% confidence)`);
    }

    return signal;
  }

  private getFearGreedMomentumConfirmation(fearGreedData: FearGreedData | undefined, action: 'BUY' | 'SELL'): boolean {
    if (!fearGreedData) return true;

    const { valueClassification } = fearGreedData;

    if (action === 'BUY') {
      // For momentum, buy during neutral to greed periods (trend following)
      return ['Neutral', 'Greed'].includes(valueClassification);
    } else {
      // For momentum, sell during neutral to fear periods (trend following)
      return ['Neutral', 'Fear'].includes(valueClassification);
    }
  }

  private calculateMomentumConfidence(action: 'BUY' | 'SELL', indicators: MomentumIndicators, fearGreedData?: FearGreedData): number {
    let confidence = 0;

    const { macdHistogram, rsi, adx, trendStrength } = indicators;

    // MACD strength
    confidence += Math.min(Math.abs(macdHistogram) * 100, 25);

    // RSI positioning
    if (action === 'BUY') {
      confidence += rsi > 50 ? 20 : 10;
    } else {
      confidence += rsi < 50 ? 20 : 10;
    }

    // Trend strength (ADX)
    confidence += Math.min(adx, 25);

    // Trend direction alignment
    if ((action === 'BUY' && ['STRONG_UP', 'WEAK_UP'].includes(trendStrength)) ||
        (action === 'SELL' && ['STRONG_DOWN', 'WEAK_DOWN'].includes(trendStrength))) {
      confidence += 20;
    }

    // Fear and Greed momentum alignment
    if (fearGreedData) {
      const fearGreedBoost = this.calculateFearGreedMomentumAdjustment(fearGreedData, action);
      confidence += fearGreedBoost;
    }

    return Math.max(75, Math.min(95, confidence));
  }

  private calculateFearGreedMomentumAdjustment(fearGreedData: FearGreedData, action: 'BUY' | 'SELL'): number {
    const { valueClassification } = fearGreedData;
    
    if (action === 'BUY') {
      // Momentum strategy: buy during greed (trend continuation)
      switch (valueClassification) {
        case 'Extreme Greed': return 15;
        case 'Greed': return 10;
        case 'Neutral': return 5;
        case 'Fear': return -5;
        case 'Extreme Fear': return -10;
        default: return 0;
      }
    } else {
      // Momentum strategy: sell during fear (trend continuation)
      switch (valueClassification) {
        case 'Extreme Fear': return 15;
        case 'Fear': return 10;
        case 'Neutral': return 5;
        case 'Greed': return -5;
        case 'Extreme Greed': return -10;
        default: return 0;
      }
    }
  }

  private generateMomentumReason(action: 'BUY' | 'SELL', indicators: MomentumIndicators, fearGreedData?: FearGreedData): string {
    const { macd, macdSignal, rsi, trendStrength } = indicators;
    
    let baseReason = `Momentum ${action}: MACD ${macd > macdSignal ? 'bullish' : 'bearish'} crossover, RSI: ${rsi.toFixed(1)}, Trend: ${trendStrength}`;

    if (fearGreedData) {
      baseReason += `, Fear & Greed: ${fearGreedData.value} (${fearGreedData.valueClassification})`;
    }

    return baseReason;
  }

  private calculatePositionSize(price: number): number {
    const baseSize = this.config.positionSizePercentage / 100;
    const capital = this.config.initialCapital;
    
    // Get current exposure for this symbol if risk manager is available
    let currentExposure = 0;
    if (this.riskManager) {
      const openPositions = this.riskManager.getOpenPositions();
      const symbolPositions = openPositions.filter((p: any) => p.symbol === this.config.symbol);
      currentExposure = symbolPositions.reduce((total: number, pos: any) => {
        return total + (pos.quantity * pos.currentPrice);
      }, 0);
    }
    
    // Calculate remaining capacity for this symbol (max 20% total exposure per symbol)
    const maxSymbolExposure = capital * 0.20; // 20% max per symbol
    const remainingCapacity = Math.max(0, maxSymbolExposure - currentExposure);
    
    // Calculate base position value
    const basePositionValue = capital * baseSize;
    
    // Use the smaller of base size or remaining capacity
    const adjustedPositionValue = Math.min(basePositionValue, remainingCapacity);
    
    // Ensure minimum order value
    const minOrderValue = 10;
    const finalPositionValue = Math.max(minOrderValue, adjustedPositionValue);
    
    // If we can't even place minimum order, return 0
    if (finalPositionValue < minOrderValue || remainingCapacity <= 0) {
      logger.info(`Position sizing blocked: Current exposure $${currentExposure.toFixed(2)}, Max allowed $${maxSymbolExposure.toFixed(2)}`);
      return 0;
    }
    
    const quantity = parseFloat((finalPositionValue / price).toFixed(6));
    
    logger.debug(`Position sizing: Base=$${basePositionValue.toFixed(2)}, Current exposure=$${currentExposure.toFixed(2)}, Adjusted=$${finalPositionValue.toFixed(2)}, Qty=${quantity}`);
    
    return quantity;
  }

  getStrategyState() {
    return {
      priceHistoryLength: this.priceHistory.length,
      lastPrice: this.priceHistory[this.priceHistory.length - 1],
      trendState: this.trendState,
      indicators: this.priceHistory.length >= 26 ? this.calculateMomentumIndicators() : null,
      lastSignalTime: this.lastSignalTime
    };
  }

  reset(): void {
    this.priceHistory = [];
    this.volumeHistory = [];
    this.emaCache = {};
    this.lastSignalTime = 0;
    this.trendState = {
      direction: 'SIDEWAYS',
      strength: 0,
      duration: 0,
      lastTrendChange: Date.now()
    };
    logger.info('Momentum strategy reset');
  }
}
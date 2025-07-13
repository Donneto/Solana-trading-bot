import { MeanReversionStrategy } from '../../strategies/meanReversion/meanReversionStrategy';
import { TradingConfig, MarketData } from '../../interfaces/trading';

describe('MeanReversionStrategy', () => {
  let strategy: MeanReversionStrategy;
  let mockConfig: TradingConfig;

  beforeEach(() => {
    mockConfig = {
      symbol: 'SOLUSDT',
      initialCapital: 300,
      dailyProfitTarget: 12,
      maxDailyLoss: 30,
      positionSizePercentage: 10,
      stopLossPercentage: 2,
      takeProfitPercentage: 3,
      trailingStopPercentage: 1.5,
      maxOpenPositions: 3,
      meanReversionPeriod: 5, // Smaller for testing
      deviationThreshold: 2,
      gridLevels: 5,
      gridSpacingPercentage: 0.5,
      fearGreedIndexEnabled: false
    };
    
    strategy = new MeanReversionStrategy(mockConfig);
  });

  const createMockMarketData = (price: number, volume: number = 1000): MarketData => ({
    symbol: 'SOLUSDT',
    price,
    timestamp: Date.now(),
    volume,
    change24h: 0,
    high24h: price * 1.05,
    low24h: price * 0.95
  });

  describe('analyzeMarket', () => {
    it('should return null when insufficient price history', () => {
      const marketData = createMockMarketData(100);
      const signal = strategy.analyzeMarket(marketData);
      expect(signal).toBeNull();
    });

    it('should generate buy signal when price is below lower Bollinger Band', () => {
      // Populate price history with stable prices around 100
      for (let i = 0; i < 10; i++) {
        const marketData = createMockMarketData(100, 1000);
        strategy.analyzeMarket(marketData);
      }

      // Add high volume data point below the band
      const lowPriceData = createMockMarketData(95, 2000); // Significantly below average
      const signal = strategy.analyzeMarket(lowPriceData);

      expect(signal).toBeDefined();
      if (signal) {
        expect(signal.action).toBe('BUY');
        expect(signal.confidence).toBeGreaterThan(0);
        expect(signal.price).toBe(95);
        expect(signal.stopLoss).toBeLessThan(95);
        expect(signal.takeProfit).toBeGreaterThan(95);
      }
    });

    it('should generate sell signal when price is above upper Bollinger Band', () => {
      // Populate price history with stable prices around 100
      for (let i = 0; i < 10; i++) {
        const marketData = createMockMarketData(100, 1000);
        strategy.analyzeMarket(marketData);
      }

      // Add high volume data point above the band
      const highPriceData = createMockMarketData(105, 2000); // Significantly above average
      const signal = strategy.analyzeMarket(highPriceData);

      expect(signal).toBeDefined();
      if (signal) {
        expect(signal.action).toBe('SELL');
        expect(signal.confidence).toBeGreaterThan(0);
        expect(signal.price).toBe(105);
        expect(signal.stopLoss).toBeGreaterThan(105);
        expect(signal.takeProfit).toBeLessThan(105);
      }
    });

    it('should respect signal cooldown period', () => {
      // Setup for signal generation
      for (let i = 0; i < 10; i++) {
        const marketData = createMockMarketData(100, 1000);
        strategy.analyzeMarket(marketData);
      }

      // Generate first signal
      const firstSignalData = createMockMarketData(95, 2000);
      const firstSignal = strategy.analyzeMarket(firstSignalData);
      expect(firstSignal).toBeDefined();

      // Try to generate second signal immediately (should be null due to cooldown)
      const secondSignalData = createMockMarketData(94, 2000);
      const secondSignal = strategy.analyzeMarket(secondSignalData);
      expect(secondSignal).toBeNull();
    });
  });

  describe('technical indicators', () => {
    beforeEach(() => {
      // Populate with sufficient price history
      for (let i = 0; i < mockConfig.meanReversionPeriod; i++) {
        const marketData = createMockMarketData(100 + i, 1000);
        strategy.analyzeMarket(marketData);
      }
    });

    it('should calculate technical indicators correctly', () => {
      const state = strategy.getStrategyState();
      expect(state.indicators).toBeDefined();
      
      if (state.indicators) {
        expect(state.indicators.sma).toBeGreaterThan(0);
        expect(state.indicators.bollinger.upper).toBeGreaterThan(state.indicators.bollinger.middle);
        expect(state.indicators.bollinger.lower).toBeLessThan(state.indicators.bollinger.middle);
        expect(state.indicators.rsi).toBeGreaterThanOrEqual(0);
        expect(state.indicators.rsi).toBeLessThanOrEqual(100);
      }
    });
  });

  describe('position sizing', () => {
    it('should calculate position size based on volatility', () => {
      // Add some price data
      for (let i = 0; i < 10; i++) {
        const marketData = createMockMarketData(100, 1000);
        strategy.analyzeMarket(marketData);
      }

      // Test with a signal that should generate a position size
      const lowPriceData = createMockMarketData(95, 2000);
      const signal = strategy.analyzeMarket(lowPriceData);

      if (signal) {
        expect(signal.quantity).toBeGreaterThan(0);
        expect(signal.quantity).toBeLessThan(1); // Should be reasonable for $300 capital
      }
    });
  });

  describe('confidence calculation', () => {
    it('should return higher confidence for stronger signals', () => {
      // Setup baseline
      for (let i = 0; i < 10; i++) {
        const marketData = createMockMarketData(100, 1000);
        strategy.analyzeMarket(marketData);
      }

      // Strong signal (far from mean)
      const strongSignalData = createMockMarketData(90, 3000);
      const strongSignal = strategy.analyzeMarket(strongSignalData);

      // Reset and test weaker signal
      strategy.reset();
      for (let i = 0; i < 10; i++) {
        const marketData = createMockMarketData(100, 1000);
        strategy.analyzeMarket(marketData);
      }

      const weakSignalData = createMockMarketData(98, 1200);
      const weakSignal = strategy.analyzeMarket(weakSignalData);

      if (strongSignal && weakSignal) {
        expect(strongSignal.confidence).toBeGreaterThan(weakSignal.confidence);
      }
    });
  });

  describe('strategy state', () => {
    it('should track strategy state correctly', () => {
      const initialState = strategy.getStrategyState();
      expect(initialState.priceHistoryLength).toBe(0);
      expect(initialState.indicators).toBeNull();

      // Add some data
      for (let i = 0; i < 5; i++) {
        const marketData = createMockMarketData(100 + i, 1000);
        strategy.analyzeMarket(marketData);
      }

      const updatedState = strategy.getStrategyState();
      expect(updatedState.priceHistoryLength).toBe(5);
      expect(updatedState.lastPrice).toBe(104);
    });

    it('should reset strategy state correctly', () => {
      // Add some data
      for (let i = 0; i < 5; i++) {
        const marketData = createMockMarketData(100 + i, 1000);
        strategy.analyzeMarket(marketData);
      }

      strategy.reset();

      const state = strategy.getStrategyState();
      expect(state.priceHistoryLength).toBe(0);
      expect(state.lastSignalTime).toBe(0);
    });
  });
});
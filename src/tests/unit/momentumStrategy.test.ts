import { MomentumStrategy } from '../../strategies/momentum/momentumStrategy';
import { TradingConfig } from '../../interfaces/trading';

describe('MomentumStrategy', () => {
  let strategy: MomentumStrategy;
  let config: TradingConfig;

  beforeEach(() => {
    config = {
      symbol: 'BTCUSDT',
      initialCapital: 10000,
      dailyProfitTarget: 100,
      maxDailyLoss: 200,
      strategy: 'momentum',
      positionSizePercentage: 15,
      stopLossPercentage: 2.5,
      takeProfitPercentage: 4,
      trailingStopPercentage: 2,
      maxOpenPositions: 3,
      meanReversionPeriod: 20,
      deviationThreshold: 2,
      gridLevels: 8,
      gridSpacingPercentage: 2,
      fearGreedIndexEnabled: false
    };

    strategy = new MomentumStrategy(config);
  });

  it('should not generate signals with insufficient data', () => {
    const marketData = {
      symbol: 'BTCUSDT',
      price: 50000,
      timestamp: Date.now(),
      volume: 100,
      change24h: 2.5,
      high24h: 51000,
      low24h: 49000
    };

    const signal = strategy.analyzeMarket(marketData);
    expect(signal).toBeNull();
  });

  it('should calculate technical indicators after sufficient data', () => {
    // Feed enough data points
    for (let i = 0; i < 30; i++) {
      const marketData = {
        symbol: 'BTCUSDT',
        price: 50000 + (i * 10), // Trending up
        timestamp: Date.now() + (i * 60000),
        volume: 100 + (i * 5),
        change24h: 2.5,
        high24h: 51000,
        low24h: 49000
      };
      strategy.analyzeMarket(marketData);
    }

    const state = strategy.getStrategyState();
    expect(state.indicators).toBeTruthy();
    expect(state.indicators?.ema12).toBeGreaterThan(0);
    expect(state.indicators?.ema26).toBeGreaterThan(0);
    expect(state.trendState.direction).toBeDefined();
  });

  it('should reset all state properly', () => {
    const marketData = {
      symbol: 'BTCUSDT',
      price: 50000,
      timestamp: Date.now(),
      volume: 100,
      change24h: 2.5,
      high24h: 51000,
      low24h: 49000
    };

    strategy.analyzeMarket(marketData);
    strategy.reset();

    const state = strategy.getStrategyState();
    expect(state.priceHistoryLength).toBe(0);
    expect(state.trendState.direction).toBe('SIDEWAYS');
  });
});
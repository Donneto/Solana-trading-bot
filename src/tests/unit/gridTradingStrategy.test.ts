import { GridTradingStrategy } from '../../strategies/gridTrading/gridTradingStrategy';
import { TradingConfig } from '../../interfaces/trading';

describe('GridTradingStrategy', () => {
  let strategy: GridTradingStrategy;
  let config: TradingConfig;

  beforeEach(() => {
    config = {
      symbol: 'BTCUSDT',
      initialCapital: 10000,
      dailyProfitTarget: 100,
      maxDailyLoss: 200,
      strategy: 'gridTrading',
      positionSizePercentage: 20,
      stopLossPercentage: 2,
      takeProfitPercentage: 3,
      trailingStopPercentage: 1.5,
      maxOpenPositions: 5,
      meanReversionPeriod: 20,
      deviationThreshold: 2,
      gridLevels: 10,
      gridSpacingPercentage: 1.5,
      fearGreedIndexEnabled: false
    };

    strategy = new GridTradingStrategy(config);
  });

  it('should initialize grid when first analyzing market', () => {
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
    expect(signal).toBeNull(); // No signal on initialization

    const state = strategy.getStrategyState();
    expect(state.gridInitialized).toBe(true);
    expect(state.activeLevels).toBeGreaterThan(0);
  });

  it('should generate buy signal when price hits grid level', () => {
    const marketData = {
      symbol: 'BTCUSDT',
      price: 50000,
      timestamp: Date.now(),
      volume: 100,
      change24h: 2.5,
      high24h: 51000,
      low24h: 49000
    };

    // Initialize grid
    strategy.analyzeMarket(marketData);

    // Trigger buy level
    const buyData = { ...marketData, price: 49250 }; // 1.5% below base
    const signal = strategy.analyzeMarket(buyData);

    expect(signal).toBeTruthy();
    expect(signal?.action).toBe('BUY');
    expect(signal?.confidence).toBeGreaterThanOrEqual(60);
  });

  it('should reset properly', () => {
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
    expect(state.gridInitialized).toBe(false);
    expect(state.priceHistoryLength).toBe(0);
  });
});
import { MeanReversionStrategy } from '../../../src/strategies/meanReversion/meanReversionStrategy';
import { TradingConfig, MarketData, FearGreedData } from '../../../src/interfaces/trading';
import { fearGreedService } from '../../../src/services/fearGreed/fearGreedService';

jest.mock('../../../src/services/fearGreed/fearGreedService');
const mockFearGreedService = fearGreedService as jest.Mocked<typeof fearGreedService>;

describe('MeanReversionStrategy with Fear and Greed Index', () => {
  let strategy: MeanReversionStrategy;
  let mockConfig: TradingConfig;

  beforeEach(() => {
    mockConfig = {
      symbol: 'BTCUSDT',
      initialCapital: 1000,
      dailyProfitTarget: 50,
      maxDailyLoss: 100,
      strategy: 'meanReversion',
      positionSizePercentage: 10,
      stopLossPercentage: 2,
      takeProfitPercentage: 3,
      trailingStopPercentage: 1,
      maxOpenPositions: 2,
      meanReversionPeriod: 10,
      deviationThreshold: 2,
      gridLevels: 5,
      gridSpacingPercentage: 1,
      fearGreedIndexEnabled: true
    };

    strategy = new MeanReversionStrategy(mockConfig);
    jest.clearAllMocks();
  });

  describe('Fear and Greed Index Integration', () => {
    const createMarketData = (price: number, fearGreedData?: FearGreedData): MarketData => ({
      symbol: 'BTCUSDT',
      price,
      timestamp: Date.now(),
      volume: 1000,
      change24h: 0,
      high24h: price * 1.05,
      low24h: price * 0.95,
      ...(fearGreedData && { fearGreedIndex: fearGreedData })
    });

    const createFearGreedData = (value: number, classification: FearGreedData['valueClassification']): FearGreedData => ({
      value,
      valueClassification: classification,
      timestamp: Date.now(),
      nextUpdate: Date.now() + 12 * 60 * 60 * 1000,
      source: 'api'
    });

    beforeEach(() => {
      // Fill price history with enough data
      for (let i = 0; i < 15; i++) {
        const price = 50000 + (i * 100);
        strategy.analyzeMarket(createMarketData(price));
      }
    });

    describe('Buy Signal Generation', () => {
      it('should generate buy signal during extreme fear with oversold conditions', async () => {
        const fearGreedData = createFearGreedData(15, 'Extreme Fear');
        mockFearGreedService.getFearGreedIndex.mockResolvedValue(fearGreedData);

        // Price significantly below lower Bollinger Band with high volume
        const marketData = createMarketData(49000);
        marketData.volume = 2000; // Higher volume

        const signal = await strategy.analyzeMarketAsync(marketData);

        expect(signal).toBeDefined();
        expect(signal?.action).toBe('BUY');
        expect(signal?.confidence).toBeGreaterThan(70);
        expect(signal?.reason).toContain('Fear & Greed: 15 (Extreme Fear)');
      });

      it('should not generate buy signal during extreme greed even with oversold conditions', async () => {
        const fearGreedData = createFearGreedData(85, 'Extreme Greed');
        mockFearGreedService.getFearGreedIndex.mockResolvedValue(fearGreedData);

        const marketData = createMarketData(49000);
        marketData.volume = 2000;

        const signal = await strategy.analyzeMarketAsync(marketData);

        expect(signal).toBeNull();
      });

      it('should have higher confidence during fear periods', async () => {
        const extremeFearData = createFearGreedData(20, 'Extreme Fear');
        const neutralData = createFearGreedData(50, 'Neutral');

        // Test with extreme fear
        mockFearGreedService.getFearGreedIndex.mockResolvedValue(extremeFearData);
        let marketData = createMarketData(49000);
        marketData.volume = 2000;
        let signal = await strategy.analyzeMarketAsync(marketData);
        const fearConfidence = signal?.confidence || 0;

        // Reset strategy for second test
        strategy.reset();
        for (let i = 0; i < 15; i++) {
          const price = 50000 + (i * 100);
          strategy.analyzeMarket(createMarketData(price));
        }

        // Test with neutral
        mockFearGreedService.getFearGreedIndex.mockResolvedValue(neutralData);
        marketData = createMarketData(49000);
        marketData.volume = 2000;
        signal = await strategy.analyzeMarketAsync(marketData);
        const neutralConfidence = signal?.confidence || 0;

        expect(fearConfidence).toBeGreaterThan(neutralConfidence);
      });
    });

    describe('Sell Signal Generation', () => {
      it('should generate sell signal during extreme greed with overbought conditions', async () => {
        const fearGreedData = createFearGreedData(90, 'Extreme Greed');
        mockFearGreedService.getFearGreedIndex.mockResolvedValue(fearGreedData);

        const marketData = createMarketData(52000);
        marketData.volume = 2000;

        const signal = await strategy.analyzeMarketAsync(marketData);

        expect(signal).toBeDefined();
        expect(signal?.action).toBe('SELL');
        expect(signal?.confidence).toBeGreaterThan(70);
        expect(signal?.reason).toContain('Fear & Greed: 90 (Extreme Greed)');
      });

      it('should not generate sell signal during extreme fear even with overbought conditions', async () => {
        const fearGreedData = createFearGreedData(10, 'Extreme Fear');
        mockFearGreedService.getFearGreedIndex.mockResolvedValue(fearGreedData);

        const marketData = createMarketData(52000);
        marketData.volume = 2000;

        const signal = await strategy.analyzeMarketAsync(marketData);

        expect(signal).toBeNull();
      });

      it('should have higher confidence during greed periods', async () => {
        const extremeGreedData = createFearGreedData(85, 'Extreme Greed');
        const neutralData = createFearGreedData(50, 'Neutral');

        // Test with extreme greed
        mockFearGreedService.getFearGreedIndex.mockResolvedValue(extremeGreedData);
        let marketData = createMarketData(52000);
        marketData.volume = 2000;
        let signal = await strategy.analyzeMarketAsync(marketData);
        const greedConfidence = signal?.confidence || 0;

        // Reset strategy for second test
        strategy.reset();
        for (let i = 0; i < 15; i++) {
          const price = 50000 + (i * 100);
          strategy.analyzeMarket(createMarketData(price));
        }

        // Test with neutral
        mockFearGreedService.getFearGreedIndex.mockResolvedValue(neutralData);
        marketData = createMarketData(52000);
        marketData.volume = 2000;
        signal = await strategy.analyzeMarketAsync(marketData);
        const neutralConfidence = signal?.confidence || 0;

        expect(greedConfidence).toBeGreaterThan(neutralConfidence);
      });
    });

    describe('Neutral Market Conditions', () => {
      it('should apply moderate filtering during neutral periods', async () => {
        const neutralData = createFearGreedData(50, 'Neutral');
        mockFearGreedService.getFearGreedIndex.mockResolvedValue(neutralData);

        // Test buy signal in lower neutral range
        let marketData = createMarketData(49000);
        marketData.volume = 2000;
        let signal = await strategy.analyzeMarketAsync(marketData);
        const buyAllowed = signal !== null;

        // Reset and test sell signal in upper neutral range
        strategy.reset();
        for (let i = 0; i < 15; i++) {
          const price = 50000 + (i * 100);
          strategy.analyzeMarket(createMarketData(price));
        }

        const upperNeutralData = createFearGreedData(55, 'Neutral');
        mockFearGreedService.getFearGreedIndex.mockResolvedValue(upperNeutralData);
        
        marketData = createMarketData(52000);
        marketData.volume = 2000;
        signal = await strategy.analyzeMarketAsync(marketData);
        const sellAllowed = signal !== null;

        expect(buyAllowed || sellAllowed).toBe(true); // At least one should be allowed
      });
    });

    describe('Fallback Behavior', () => {
      it('should work normally when Fear and Greed Index is disabled', async () => {
        const disabledConfig = { ...mockConfig, fearGreedIndexEnabled: false };
        const disabledStrategy = new MeanReversionStrategy(disabledConfig);

        // Fill price history
        for (let i = 0; i < 15; i++) {
          const price = 50000 + (i * 100);
          disabledStrategy.analyzeMarket(createMarketData(price));
        }

        const marketData = createMarketData(49000);
        marketData.volume = 2000;

        const signal = await disabledStrategy.analyzeMarketAsync(marketData);

        expect(signal).toBeDefined();
        expect(signal?.reason).not.toContain('Fear & Greed');
      });

      it('should work normally when Fear and Greed Index service fails', async () => {
        mockFearGreedService.getFearGreedIndex.mockRejectedValue(new Error('Service unavailable'));

        const marketData = createMarketData(49000);
        marketData.volume = 2000;

        const signal = await strategy.analyzeMarketAsync(marketData);

        expect(signal).toBeDefined();
        expect(signal?.reason).not.toContain('Fear & Greed');
      });

      it('should work normally when Fear and Greed Index returns null', async () => {
        mockFearGreedService.getFearGreedIndex.mockResolvedValue(null);

        const marketData = createMarketData(49000);
        marketData.volume = 2000;

        const signal = await strategy.analyzeMarketAsync(marketData);

        expect(signal).toBeDefined();
        expect(signal?.reason).not.toContain('Fear & Greed');
      });
    });

    describe('Signal Reasoning', () => {
      it('should include Fear and Greed Index in signal reason when available', async () => {
        const fearGreedData = createFearGreedData(25, 'Extreme Fear');
        mockFearGreedService.getFearGreedIndex.mockResolvedValue(fearGreedData);

        const marketData = createMarketData(49000);
        marketData.volume = 2000;

        const signal = await strategy.analyzeMarketAsync(marketData);

        expect(signal?.reason).toContain('Fear & Greed: 25 (Extreme Fear)');
      });

      it('should not include Fear and Greed Index when not available', async () => {
        mockFearGreedService.getFearGreedIndex.mockResolvedValue(null);

        const marketData = createMarketData(49000);
        marketData.volume = 2000;

        const signal = await strategy.analyzeMarketAsync(marketData);

        expect(signal?.reason).not.toContain('Fear & Greed');
      });
    });

    describe('Confidence Adjustment Algorithm', () => {
      const testCases = [
        { value: 10, classification: 'Extreme Fear' as const, action: 'BUY' as const, expectedBoost: 20 },
        { value: 35, classification: 'Fear' as const, action: 'BUY' as const, expectedBoost: 15 },
        { value: 48, classification: 'Neutral' as const, action: 'BUY' as const, expectedBoost: 5 },
        { value: 52, classification: 'Neutral' as const, action: 'BUY' as const, expectedBoost: -5 },
        { value: 65, classification: 'Greed' as const, action: 'BUY' as const, expectedBoost: -10 },
        { value: 85, classification: 'Extreme Greed' as const, action: 'BUY' as const, expectedBoost: -20 },
        
        { value: 90, classification: 'Extreme Greed' as const, action: 'SELL' as const, expectedBoost: 20 },
        { value: 65, classification: 'Greed' as const, action: 'SELL' as const, expectedBoost: 15 },
        { value: 58, classification: 'Neutral' as const, action: 'SELL' as const, expectedBoost: 5 },
        { value: 42, classification: 'Neutral' as const, action: 'SELL' as const, expectedBoost: -5 },
        { value: 35, classification: 'Fear' as const, action: 'SELL' as const, expectedBoost: -10 },
        { value: 15, classification: 'Extreme Fear' as const, action: 'SELL' as const, expectedBoost: -20 }
      ];

      testCases.forEach(({ value, classification, action, expectedBoost }) => {
        it(`should apply ${expectedBoost > 0 ? '+' : ''}${expectedBoost} confidence for ${action} during ${classification} (${value})`, async () => {
          const fearGreedData = createFearGreedData(value, classification);
          mockFearGreedService.getFearGreedIndex.mockResolvedValue(fearGreedData);

          const price = action === 'BUY' ? 49000 : 52000;
          const marketData = createMarketData(price);
          marketData.volume = 2000;

          // Get signal with Fear and Greed
          const signalWithFG = await strategy.analyzeMarketAsync(marketData);

          // Reset and get signal without Fear and Greed for comparison
          strategy.reset();
          for (let i = 0; i < 15; i++) {
            const historyPrice = 50000 + (i * 100);
            strategy.analyzeMarket(createMarketData(historyPrice));
          }

          mockFearGreedService.getFearGreedIndex.mockResolvedValue(null);
          const signalWithoutFG = await strategy.analyzeMarketAsync(marketData);

          if (signalWithFG && signalWithoutFG) {
            const actualBoost = signalWithFG.confidence - signalWithoutFG.confidence;
            expect(Math.abs(actualBoost - expectedBoost)).toBeLessThanOrEqual(2); // Allow small variance
          }
        });
      });
    });
  });

  describe('Backward Compatibility', () => {
    it('should maintain existing behavior when synchronous analyzeMarket is used', () => {
      const marketData: MarketData = {
        symbol: 'BTCUSDT',
        price: 49000,
        timestamp: Date.now(),
        volume: 2000,
        change24h: 0,
        high24h: 51450,
        low24h: 47550
      };

      const signal = strategy.analyzeMarket(marketData);

      // Should work without Fear and Greed data
      expect(signal).toBeDefined();
      if (signal) {
        expect(signal.reason).not.toContain('Fear & Greed');
      }
    });

    it('should not break existing code that expects synchronous behavior', () => {
      expect(() => {
        for (let i = 0; i < 20; i++) {
          const marketData: MarketData = {
            symbol: 'BTCUSDT',
            price: 50000 + (i * 100),
            timestamp: Date.now(),
            volume: 1000,
            change24h: 0,
            high24h: 52500,
            low24h: 47500
          };
          strategy.analyzeMarket(marketData);
        }
      }).not.toThrow();
    });
  });
});
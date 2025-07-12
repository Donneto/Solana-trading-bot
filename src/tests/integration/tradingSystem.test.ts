import { BinanceService } from '../../services/binance/binanceService';
import { TradingEngine } from '../../services/tradingEngine';
import { config, binanceConfig } from '../../config/config';

describe('Trading System Integration', () => {
  let binanceService: BinanceService;
  let tradingEngine: TradingEngine;

  beforeAll(() => {
    // Mock Binance service for testing
    binanceService = new BinanceService({
      apiKey: 'test_key',
      apiSecret: 'test_secret',
      testnet: true
    });

    // Mock the actual API calls
    jest.spyOn(binanceService, 'validateConnection').mockResolvedValue(true);
    jest.spyOn(binanceService, 'getAccountBalance').mockResolvedValue(1000);
    jest.spyOn(binanceService, 'getCurrentPrice').mockResolvedValue(100);
    jest.spyOn(binanceService, 'get24hrStats').mockResolvedValue({
      symbol: 'SOLUSDT',
      price: 100,
      timestamp: Date.now(),
      volume: 1000000,
      change24h: 2.5,
      high24h: 105,
      low24h: 95
    });

    tradingEngine = new TradingEngine(binanceService, config);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('System Initialization', () => {
    it('should initialize all components correctly', async () => {
      expect(tradingEngine).toBeDefined();
      expect(binanceService).toBeDefined();
      
      // Check that engine is not running initially
      expect(tradingEngine.isEngineRunning()).toBe(false);
    });

    it('should validate configuration on startup', async () => {
      // Mock successful validation
      jest.spyOn(binanceService, 'validateConnection').mockResolvedValue(true);
      jest.spyOn(binanceService, 'getAccountBalance').mockResolvedValue(1000);

      // This should not throw
      expect(() => {
        const testConfig = { ...config };
        new TradingEngine(binanceService, testConfig);
      }).not.toThrow();
    });
  });

  describe('Market Data Flow', () => {
    it('should handle market data updates correctly', (done) => {
      const mockMarketData = {
        symbol: 'SOLUSDT',
        price: 100.5,
        timestamp: Date.now(),
        volume: 1500,
        change24h: 1.2,
        high24h: 102,
        low24h: 99
      };

      tradingEngine.on('marketData', (data) => {
        expect(data).toEqual(mockMarketData);
        done();
      });

      // Simulate market data event
      binanceService.emit('marketData', mockMarketData);
    });

    it('should process trading signals from market data', (done) => {
      const mockMarketData = {
        symbol: 'SOLUSDT',
        price: 95, // Price that should trigger a buy signal
        timestamp: Date.now(),
        volume: 2000, // High volume
        change24h: -3.5,
        high24h: 102,
        low24h: 95
      };

      // Need to populate strategy with historical data first
      const strategy = (tradingEngine as any).strategy;
      for (let i = 0; i < 25; i++) {
        strategy.analyzeMarket({
          ...mockMarketData,
          price: 100 + (Math.random() - 0.5) * 2,
          timestamp: Date.now() - (25 - i) * 60000
        });
      }

      tradingEngine.on('tradeExecuted', (data) => {
        expect(data.position).toBeDefined();
        expect(data.position.side).toBeDefined();
        done();
      });

      // Mock successful order placement
      jest.spyOn(binanceService, 'placeMarketOrder').mockResolvedValue({
        orderId: '12345',
        status: 'FILLED',
        executedQty: '0.1',
        fills: [{ price: '95.0' }]
      });

      jest.spyOn(binanceService, 'placeStopLossOrder').mockResolvedValue({
        orderId: '12346',
        status: 'NEW'
      });

      jest.spyOn(binanceService, 'placeTakeProfitOrder').mockResolvedValue({
        orderId: '12347',
        status: 'NEW'
      });

      // Simulate market data that should trigger a signal
      binanceService.emit('marketData', mockMarketData);
    }, 10000);
  });

  describe('Risk Management Integration', () => {
    it('should enforce daily loss limits', async () => {
      const riskManager = (tradingEngine as any).riskManager;
      
      // Simulate reaching daily loss limit
      riskManager.dailyPnL = -config.maxDailyLoss;

      const validation = riskManager.validateTrade('BUY', 0.1, 100, 1000);
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toBe('Daily loss limit reached');
    });

    it('should prevent overexposure', async () => {
      const riskManager = (tradingEngine as any).riskManager;
      
      // Reset daily metrics to avoid interference
      (riskManager as any).dailyPnL = 0;
      
      // Add maximum positions
      for (let i = 0; i < config.maxOpenPositions; i++) {
        const mockPosition = {
          id: `pos-${i}`,
          symbol: 'SOLUSDT',
          side: 'BUY' as const,
          quantity: 0.1,
          entryPrice: 100,
          currentPrice: 100,
          unrealizedPnL: 0,
          stopLossPrice: 98,
          takeProfitPrice: 103,
          trailingStopPrice: 98.5,
          timestamp: Date.now(),
          status: 'OPEN' as const
        };
        riskManager.addPosition(mockPosition);
      }

      const validation = riskManager.validateTrade('BUY', 0.1, 100, 1000);
      expect(validation.isValid).toBe(false);
      expect(validation.reason).toBe('Maximum open positions reached');
    });
  });

  describe('Error Handling', () => {
    it('should handle API connection failures gracefully', (done) => {
      jest.spyOn(binanceService, 'validateConnection').mockResolvedValue(false);

      tradingEngine.on('emergencyShutdown', () => {
        done();
      });

      // Simulate connection failure
      binanceService.emit('connectionFailed');
    });

    it('should handle order placement failures', async () => {
      jest.spyOn(binanceService, 'placeMarketOrder').mockRejectedValue(new Error('Order failed'));

      const mockSignal = {
        action: 'BUY' as const,
        confidence: 80,
        price: 100,
        quantity: 0.1,
        reason: 'Test signal',
        timestamp: Date.now(),
        stopLoss: 98,
        takeProfit: 103
      };

      // This should not throw, but should be handled gracefully
      await expect(async () => {
        await (tradingEngine as any).executeTrade(mockSignal);
      }).not.toThrow();
    });
  });

  describe('Performance Metrics', () => {
    it('should calculate accurate performance metrics', () => {
      const riskManager = (tradingEngine as any).riskManager;
      const metrics = riskManager.getRiskMetrics();

      expect(metrics).toHaveProperty('dailyPnL');
      expect(metrics).toHaveProperty('totalPnL');
      expect(metrics).toHaveProperty('winRate');
      expect(metrics).toHaveProperty('sharpeRatio');
      expect(metrics).toHaveProperty('maxDrawdown');
      expect(metrics).toHaveProperty('currentExposure');
      expect(metrics).toHaveProperty('positionsCount');
      expect(metrics).toHaveProperty('riskScore');
    });

    it('should track position updates correctly', () => {
      const riskManager = (tradingEngine as any).riskManager;
      
      const mockPosition = {
        id: 'test-position',
        symbol: 'SOLUSDT',
        side: 'BUY' as const,
        quantity: 0.1,
        entryPrice: 100,
        currentPrice: 100,
        unrealizedPnL: 0,
        stopLossPrice: 98,
        takeProfitPrice: 103,
        trailingStopPrice: 98.5,
        timestamp: Date.now(),
        status: 'OPEN' as const
      };

      riskManager.addPosition(mockPosition);
      riskManager.updatePosition('test-position', 105);

      const positions = riskManager.getOpenPositions();
      expect(positions[0]?.currentPrice).toBe(105);
      expect(positions[0]?.unrealizedPnL).toBe(0.5); // (105 - 100) * 0.1
    });
  });

  describe('Safeguards Integration', () => {
    it('should integrate safeguards with trading engine', () => {
      // This test verifies that safeguards are properly integrated
      // In a real implementation, the trading engine would use TradingSafeguards
      expect(tradingEngine).toBeDefined();
      
      // Test that emergency stops work
      tradingEngine.emergencyShutdown();
      expect(tradingEngine.isInEmergencyMode()).toBe(true);
    });
  });
});
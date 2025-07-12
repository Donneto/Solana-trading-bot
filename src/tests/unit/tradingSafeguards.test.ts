import { TradingSafeguards } from '../../services/safeguards/tradingSafeguards';
import { TradingConfig, MarketData } from '../../interfaces/trading';

describe('TradingSafeguards', () => {
  let safeguards: TradingSafeguards;
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
      meanReversionPeriod: 20,
      deviationThreshold: 2,
      gridLevels: 5,
      gridSpacingPercentage: 0.5
    };
    
    safeguards = new TradingSafeguards(mockConfig);
  });

  const createMockSignal = (confidence: number = 80) => ({
    action: 'BUY' as const,
    confidence,
    price: 100,
    quantity: 0.1,
    reason: 'Test signal',
    timestamp: Date.now(),
    stopLoss: 98,
    takeProfit: 103
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

  describe('validateTradeExecution', () => {
    it('should approve valid trade under normal conditions', () => {
      const signal = createMockSignal(80);
      const marketData = createMockMarketData(100);
      
      const result = safeguards.validateTradeExecution(signal, 100, marketData);
      
      expect(result.isValid).toBe(true);
      expect(result.riskLevel).toBeDefined();
    });

    it('should reject trade when emergency stop is active', () => {
      safeguards.triggerEmergencyStop('TEST');
      
      const signal = createMockSignal(80);
      const marketData = createMockMarketData(100);
      
      const result = safeguards.validateTradeExecution(signal, 100, marketData);
      
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Emergency stop is active');
      expect(result.riskLevel).toBe('HIGH');
    });

    it('should reject trade with low confidence signal', () => {
      const signal = createMockSignal(50); // Low confidence
      const marketData = createMockMarketData(100);
      
      const result = safeguards.validateTradeExecution(signal, 100, marketData);
      
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Signal confidence too low');
    });

    it('should reject trade when position size is outside acceptable range', () => {
      const signal = {
        ...createMockSignal(80),
        quantity: 0.001 // Too small
      };
      const marketData = createMockMarketData(100);
      
      const result = safeguards.validateTradeExecution(signal, 100, marketData);
      
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Position size outside acceptable range');
    });

    it('should enforce minimum time between trades', () => {
      const signal = createMockSignal(80);
      const marketData = createMockMarketData(100);
      
      // First trade should be accepted
      const firstResult = safeguards.validateTradeExecution(signal, 100, marketData);
      expect(firstResult.isValid).toBe(true);
      
      // Second trade immediately should be rejected
      const secondResult = safeguards.validateTradeExecution(signal, 100, marketData);
      expect(secondResult.isValid).toBe(false);
      expect(secondResult.reason).toBe('Minimum time between trades not met');
    });
  });

  describe('validateOrderPlacement', () => {
    it('should approve valid order parameters', () => {
      const result = safeguards.validateOrderPlacement('SOLUSDT', 'BUY', 0.1, 100);
      expect(result.isValid).toBe(true);
    });

    it('should reject order with invalid quantity', () => {
      const result = safeguards.validateOrderPlacement('SOLUSDT', 'BUY', 0, 100);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Invalid quantity');
    });

    it('should reject order with invalid price', () => {
      const result = safeguards.validateOrderPlacement('SOLUSDT', 'BUY', 0.1, 0);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Invalid price');
    });

    it('should reject order with invalid symbol', () => {
      const result = safeguards.validateOrderPlacement('BTCUSDT', 'BUY', 0.1, 100);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Invalid trading symbol');
    });

    it('should reject order below minimum value', () => {
      const result = safeguards.validateOrderPlacement('SOLUSDT', 'BUY', 0.01, 100);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Order value below minimum');
    });

    it('should reject order above maximum value', () => {
      const result = safeguards.validateOrderPlacement('SOLUSDT', 'BUY', 10, 100);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Order value too large');
    });
  });

  describe('consecutive losses tracking', () => {
    it('should track consecutive losses correctly', () => {
      const mockPosition = {
        id: 'test',
        symbol: 'SOLUSDT',
        side: 'BUY' as const,
        quantity: 0.1,
        entryPrice: 100,
        currentPrice: 95,
        unrealizedPnL: -5,
        stopLossPrice: 98,
        takeProfitPrice: 103,
        trailingStopPrice: 98.5,
        timestamp: Date.now(),
        status: 'CLOSED' as const
      };

      // Add consecutive losses
      for (let i = 0; i < 3; i++) {
        safeguards.onTradeResult(mockPosition, false);
      }

      const metrics = safeguards.getSafeguardMetrics();
      expect(metrics.consecutiveLosses).toBe(3);
    });

    it('should reset consecutive losses on profit', () => {
      const mockPosition = {
        id: 'test',
        symbol: 'SOLUSDT',
        side: 'BUY' as const,
        quantity: 0.1,
        entryPrice: 100,
        currentPrice: 105,
        unrealizedPnL: 5,
        stopLossPrice: 98,
        takeProfitPrice: 103,
        trailingStopPrice: 98.5,
        timestamp: Date.now(),
        status: 'CLOSED' as const
      };

      // Add losses first
      for (let i = 0; i < 3; i++) {
        safeguards.onTradeResult(mockPosition, false);
      }

      // Add profit
      safeguards.onTradeResult(mockPosition, true);

      const metrics = safeguards.getSafeguardMetrics();
      expect(metrics.consecutiveLosses).toBe(0);
    });

    it('should trigger emergency stop on max consecutive losses', () => {
      const mockEmergencyCallback = jest.fn();
      safeguards.on('emergencyStop', mockEmergencyCallback);

      const mockPosition = {
        id: 'test',
        symbol: 'SOLUSDT',
        side: 'BUY' as const,
        quantity: 0.1,
        entryPrice: 100,
        currentPrice: 95,
        unrealizedPnL: -5,
        stopLossPrice: 98,
        takeProfitPrice: 103,
        trailingStopPrice: 98.5,
        timestamp: Date.now(),
        status: 'CLOSED' as const
      };

      // Add max consecutive losses
      for (let i = 0; i < 5; i++) {
        safeguards.onTradeResult(mockPosition, false);
      }

      expect(mockEmergencyCallback).toHaveBeenCalledWith('MAX_CONSECUTIVE_LOSSES');
      expect(safeguards.isEmergencyStopActive()).toBe(true);
    });
  });

  describe('position safety checks', () => {
    const mockPosition = {
      id: 'test',
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

    it('should require action for excessive unrealized loss', () => {
      const position = {
        ...mockPosition,
        currentPrice: 85,
        unrealizedPnL: -15
      };

      const result = safeguards.checkPositionSafety(position, 85);
      
      expect(result.requiresAction).toBe(true);
      expect(result.action).toBe('CLOSE');
      expect(result.reason).toBe('Excessive unrealized loss');
    });

    it('should require stop adjustment when too far from current price', () => {
      const position = {
        ...mockPosition,
        currentPrice: 110,
        stopLossPrice: 95 // Too far from current price
      };

      const result = safeguards.checkPositionSafety(position, 110);
      
      expect(result.requiresAction).toBe(true);
      expect(result.action).toBe('ADJUST_STOP');
      expect(result.reason).toBe('Stop loss too far from current price');
    });

    it('should require closure for positions held too long', () => {
      const position = {
        ...mockPosition,
        timestamp: Date.now() - (25 * 60 * 60 * 1000) // 25 hours ago
      };

      const result = safeguards.checkPositionSafety(position, 100);
      
      expect(result.requiresAction).toBe(true);
      expect(result.action).toBe('CLOSE');
      expect(result.reason).toBe('Position held too long');
    });

    it('should not require action for healthy positions', () => {
      const result = safeguards.checkPositionSafety(mockPosition, 100);
      
      expect(result.requiresAction).toBe(false);
    });
  });

  describe('circuit breaker', () => {
    it('should trigger circuit breaker on excessive total loss', () => {
      const mockEmergencyCallback = jest.fn();
      safeguards.on('emergencyStop', mockEmergencyCallback);

      const result = safeguards.checkCircuitBreaker(20); // 20% loss
      
      expect(result).toBe(true);
      expect(mockEmergencyCallback).toHaveBeenCalledWith('CIRCUIT_BREAKER');
    });

    it('should not trigger circuit breaker for acceptable losses', () => {
      const mockEmergencyCallback = jest.fn();
      safeguards.on('emergencyStop', mockEmergencyCallback);

      const result = safeguards.checkCircuitBreaker(10); // 10% loss
      
      expect(result).toBe(false);
      expect(mockEmergencyCallback).not.toHaveBeenCalled();
    });
  });

  describe('health check', () => {
    it('should report healthy status under normal conditions', () => {
      const health = safeguards.performHealthCheck();
      
      expect(health.status).toBe('HEALTHY');
      expect(health.issues).toHaveLength(0);
    });

    it('should report critical status when emergency stop is active', () => {
      safeguards.triggerEmergencyStop('TEST');
      
      const health = safeguards.performHealthCheck();
      
      expect(health.status).toBe('CRITICAL');
      expect(health.issues).toContain('Emergency stop is active');
    });

    it('should report warning status for concerning conditions', () => {
      // Simulate consecutive losses
      const mockPosition = {
        id: 'test',
        symbol: 'SOLUSDT',
        side: 'BUY' as const,
        quantity: 0.1,
        entryPrice: 100,
        currentPrice: 95,
        unrealizedPnL: -5,
        stopLossPrice: 98,
        takeProfitPrice: 103,
        trailingStopPrice: 98.5,
        timestamp: Date.now(),
        status: 'CLOSED' as const
      };

      for (let i = 0; i < 3; i++) {
        safeguards.onTradeResult(mockPosition, false);
      }

      const health = safeguards.performHealthCheck();
      
      expect(health.status).toBe('WARNING');
      expect(health.issues.length).toBeGreaterThan(0);
    });
  });

  describe('emergency stop management', () => {
    it('should activate emergency stop correctly', () => {
      expect(safeguards.isEmergencyStopActive()).toBe(false);
      
      safeguards.triggerEmergencyStop('TEST');
      
      expect(safeguards.isEmergencyStopActive()).toBe(true);
    });

    it('should reset emergency stop correctly', () => {
      safeguards.triggerEmergencyStop('TEST');
      expect(safeguards.isEmergencyStopActive()).toBe(true);
      
      safeguards.resetEmergencyStop();
      
      expect(safeguards.isEmergencyStopActive()).toBe(false);
    });
  });
});
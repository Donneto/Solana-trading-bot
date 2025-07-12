import { RiskManager } from '../../services/risk/riskManager';
import { TradingConfig, Position } from '../../interfaces/trading';

describe('RiskManager', () => {
  let riskManager: RiskManager;
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
    
    riskManager = new RiskManager(mockConfig);
  });

  describe('validateTrade', () => {
    it('should approve valid trade', () => {
      const result = riskManager.validateTrade('BUY', 0.1, 100, 1000);
      expect(result.isValid).toBe(true);
    });

    it('should reject trade when daily loss limit reached', () => {
      // Simulate daily loss
      (riskManager as any).dailyPnL = -30;
      
      const result = riskManager.validateTrade('BUY', 0.1, 100, 1000);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Daily loss limit reached');
    });

    it('should reject trade when max positions reached', () => {
      // Add maximum number of positions
      for (let i = 0; i < mockConfig.maxOpenPositions; i++) {
        const position: Position = {
          id: `pos-${i}`,
          symbol: 'SOLUSDT',
          side: 'BUY',
          quantity: 0.1,
          entryPrice: 100,
          currentPrice: 100,
          unrealizedPnL: 0,
          stopLossPrice: 98,
          takeProfitPrice: 103,
          trailingStopPrice: 98.5,
          timestamp: Date.now(),
          status: 'OPEN'
        };
        riskManager.addPosition(position);
      }
      
      const result = riskManager.validateTrade('BUY', 0.1, 100, 1000);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Maximum open positions reached');
    });

    it('should reject trade with insufficient balance', () => {
      const result = riskManager.validateTrade('BUY', 10, 100, 50);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Insufficient balance');
    });

    it('should reject trade with excessive position size', () => {
      const result = riskManager.validateTrade('BUY', 5, 100, 1000);
      expect(result.isValid).toBe(false);
      expect(result.reason).toBe('Position size exceeds maximum allowed');
    });
  });

  describe('calculateStopLoss', () => {
    it('should calculate correct stop loss for BUY position', () => {
      const stopLoss = riskManager.calculateStopLoss(100, 'BUY');
      expect(stopLoss).toBe(98); // 100 * (1 - 0.02)
    });

    it('should calculate correct stop loss for SELL position', () => {
      const stopLoss = riskManager.calculateStopLoss(100, 'SELL');
      expect(stopLoss).toBe(102); // 100 * (1 + 0.02)
    });
  });

  describe('calculateTakeProfit', () => {
    it('should calculate correct take profit for BUY position', () => {
      const takeProfit = riskManager.calculateTakeProfit(100, 'BUY');
      expect(takeProfit).toBe(103); // 100 * (1 + 0.03)
    });

    it('should calculate correct take profit for SELL position', () => {
      const takeProfit = riskManager.calculateTakeProfit(100, 'SELL');
      expect(takeProfit).toBe(97); // 100 * (1 - 0.03)
    });
  });

  describe('position management', () => {
    let position: Position;

    beforeEach(() => {
      position = {
        id: 'test-position',
        symbol: 'SOLUSDT',
        side: 'BUY',
        quantity: 0.1,
        entryPrice: 100,
        currentPrice: 100,
        unrealizedPnL: 0,
        stopLossPrice: 98,
        takeProfitPrice: 103,
        trailingStopPrice: 98.5,
        timestamp: Date.now(),
        status: 'OPEN'
      };
    });

    it('should add position successfully', () => {
      riskManager.addPosition(position);
      const openPositions = riskManager.getOpenPositions();
      expect(openPositions).toHaveLength(1);
      expect(openPositions[0]?.id).toBe('test-position');
    });

    it('should update position PnL correctly', () => {
      riskManager.addPosition(position);
      riskManager.updatePosition('test-position', 105);
      
      const openPositions = riskManager.getOpenPositions();
      expect(openPositions[0]?.unrealizedPnL).toBe(0.5); // (105 - 100) * 0.1
      expect(openPositions[0]?.currentPrice).toBe(105);
    });

    it('should trigger stop loss when price hits stop level', () => {
      const mockCloseCallback = jest.fn();
      riskManager.on('positionClosed', mockCloseCallback);
      
      riskManager.addPosition(position);
      riskManager.updatePosition('test-position', 97); // Below stop loss
      
      expect(mockCloseCallback).toHaveBeenCalled();
    });

    it('should trigger take profit when price hits target', () => {
      const mockCloseCallback = jest.fn();
      riskManager.on('positionClosed', mockCloseCallback);
      
      riskManager.addPosition(position);
      riskManager.updatePosition('test-position', 104); // Above take profit
      
      expect(mockCloseCallback).toHaveBeenCalled();
    });
  });

  describe('risk metrics', () => {
    it('should calculate risk metrics correctly', () => {
      const metrics = riskManager.getRiskMetrics();
      
      expect(metrics.dailyPnL).toBe(0);
      expect(metrics.totalPnL).toBe(0);
      expect(metrics.positionsCount).toBe(0);
      expect(metrics.winRate).toBe(0);
      expect(typeof metrics.riskScore).toBe('number');
    });

    it('should update daily PnL when position is closed', () => {
      const position: Position = {
        id: 'test-position',
        symbol: 'SOLUSDT',
        side: 'BUY',
        quantity: 0.1,
        entryPrice: 100,
        currentPrice: 105,
        unrealizedPnL: 0.5,
        stopLossPrice: 98,
        takeProfitPrice: 103,
        trailingStopPrice: 98.5,
        timestamp: Date.now(),
        status: 'OPEN'
      };
      
      riskManager.addPosition(position);
      riskManager.closePosition('test-position', 'MANUAL');
      
      const metrics = riskManager.getRiskMetrics();
      expect(metrics.dailyPnL).toBe(0.5);
      expect(metrics.totalPnL).toBe(0.5);
    });
  });

  describe('shouldStopTrading', () => {
    it('should return true when daily loss limit reached', () => {
      (riskManager as any).dailyPnL = -30;
      expect(riskManager.shouldStopTrading()).toBe(true);
    });

    it('should return true when daily trade limit reached', () => {
      (riskManager as any).dailyTradeCount = 20;
      expect(riskManager.shouldStopTrading()).toBe(true);
    });

    it('should return false under normal conditions', () => {
      expect(riskManager.shouldStopTrading()).toBe(false);
    });
  });
});
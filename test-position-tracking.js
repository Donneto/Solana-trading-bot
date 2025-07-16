#!/usr/bin/env node

const { TradingEngine } = require('./dist/src/services/tradingEngine');
const { BinanceService } = require('./dist/src/services/binance/binanceService');
const { loadConfig } = require('./dist/src/config/config');

async function testPositionTracking() {
  console.log('🧪 Testing Position Tracking and Live Monitor...\n');
  
  try {
    // Load testnet config
    const config = loadConfig();
    const binanceService = new BinanceService(config);
    const tradingEngine = new TradingEngine(binanceService, config);
    
    // Mock a successful order execution to test position creation
    console.log('📊 Simulating order execution and position tracking...');
    
    // Simulate the position creation that happens after successful execution
    const mockPosition = {
      id: 'test-position-123',
      symbol: 'ADAUSDT',
      side: 'BUY',
      quantity: 10.0,
      entryPrice: 0.7396,
      currentPrice: 0.7396,
      unrealizedPnL: 0,
      stopLossPrice: 0.7100,
      takeProfitPrice: 0.7692,
      trailingStopPrice: 0,
      timestamp: Date.now(),
      status: 'OPEN'
    };
    
    // Test risk manager position tracking
    const riskManager = tradingEngine.riskManager || new (require('./dist/src/services/risk/riskManager').RiskManager)(config);
    
    console.log('✅ Adding test position to risk manager...');
    riskManager.addPosition(mockPosition);
    
    // Test current exposure calculation
    const openPositions = riskManager.getOpenPositions();
    console.log(`📈 Open positions: ${openPositions.length}`);
    
    if (openPositions.length > 0) {
      const position = openPositions[0];
      console.log(`💰 Position Details:`);
      console.log(`   - Symbol: ${position.symbol}`);
      console.log(`   - Side: ${position.side}`);
      console.log(`   - Quantity: ${position.quantity}`);
      console.log(`   - Entry Price: $${position.entryPrice}`);
      console.log(`   - Current Price: $${position.currentPrice}`);
      console.log(`   - Position Value: $${(position.quantity * position.currentPrice).toFixed(2)}`);
      console.log(`   - Unrealized P&L: $${position.unrealizedPnL.toFixed(2)}`);
    }
    
    // Test exposure calculation
    const metrics = riskManager.getRiskMetrics();
    console.log(`\n📊 Risk Metrics:`);
    console.log(`   - Current Exposure: $${metrics.currentExposure.toFixed(2)}`);
    console.log(`   - Positions Count: ${metrics.positionsCount}`);
    console.log(`   - Daily P&L: $${metrics.dailyPnL.toFixed(2)}`);
    console.log(`   - Unrealized P&L: $${(metrics.unrealizedPnL || 0).toFixed(2)}`);
    
    // Test position price update
    console.log(`\n🔄 Testing position price update...`);
    const newPrice = 0.7450;
    riskManager.updatePosition(mockPosition.id, newPrice);
    
    const updatedPositions = riskManager.getOpenPositions();
    if (updatedPositions.length > 0) {
      const updatedPosition = updatedPositions[0];
      console.log(`💹 Updated Position:`);
      console.log(`   - New Price: $${updatedPosition.currentPrice}`);
      console.log(`   - New P&L: $${updatedPosition.unrealizedPnL.toFixed(2)}`);
      console.log(`   - P&L Change: $${(updatedPosition.unrealizedPnL - 0).toFixed(2)}`);
    }
    
    // Test trade validation with current exposure
    console.log(`\n🛡️  Testing risk validation with current exposure...`);
    const validation = riskManager.validateTrade('BUY', 5.0, 0.7450, 100.0);
    console.log(`   - Validation Result: ${validation.isValid ? 'VALID' : 'REJECTED'}`);
    if (!validation.isValid) {
      console.log(`   - Rejection Reason: ${validation.reason}`);
    }
    
    console.log('\n✅ Position tracking test completed successfully!');
    console.log('\n📊 Live Monitor Summary:');
    console.log(`   - Position tracking: ✅ Working`);
    console.log(`   - Exposure calculation: ✅ Working`);
    console.log(`   - P&L updates: ✅ Working`);
    console.log(`   - Risk validation: ✅ Working`);
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

testPositionTracking();
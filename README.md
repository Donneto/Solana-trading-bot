# Enterprise Solana Trading Bot

A professional-grade cryptocurrency trading bot specifically designed for SOL/USDT trading on Binance, featuring advanced risk management, real-time market analysis, and enterprise-level safeguards.

## 🎯 Key Features

### Trading Strategy
- **Mean Reversion Algorithm**: Capitalizes on price oscillations around statistical averages
- **Technical Indicators**: Bollinger Bands, RSI, Simple Moving Average
- **Signal Confidence Scoring**: Multi-factor analysis for trade validation
- **Grid Elements**: Micro-grid positioning for optimal entry/exit points

### Risk Management
- **Mandatory Stop Loss**: Every trade includes automatic stop loss orders
- **Take Profit Orders**: Automated profit-taking at predetermined levels
- **Trailing Stops**: Dynamic stop loss adjustment to protect profits
- **Position Sizing**: Volatility-adjusted position sizing (max 10% per trade)
- **Daily Loss Limits**: Hard cap at $30 daily loss to protect capital
- **Maximum Positions**: Limited to 3 concurrent open positions

### Enterprise Safeguards
- **Circuit Breakers**: Automatic shutdown on excessive losses (15% threshold)
- **Consecutive Loss Protection**: Emergency stop after 5 consecutive losses
- **Market Volatility Filters**: Prevents trading in extreme market conditions
- **Rate Limiting**: Minimum 30-second intervals between trades
- **Order Validation**: Comprehensive pre-trade validation checks

### Real-time Monitoring
- **Live Market Data**: WebSocket connection to Binance for real-time prices
- **Terminal Interface**: Professional command-line monitoring dashboard
- **Performance Metrics**: Real-time P&L, win rate, Sharpe ratio tracking
- **Health Monitoring**: System status and risk score assessment

## 💰 Financial Objectives

- **Target Capital**: $300 initial investment
- **Daily Profit Goal**: $8-15 (2.7-5% daily return)
- **Risk Profile**: Conservative with strict loss controls
- **Maximum Daily Loss**: $30 (10% of capital)
- **Strategy Focus**: Consistent small wins over high-risk large gains

## 📊 Strategy Validation

Based on SOL's historical volatility and mean reversion characteristics:

- **Expected Win Rate**: 60-70% (conservative estimate)
- **Average Win**: $5-8 per trade
- **Average Loss**: $2-3 per trade (stop loss protection)
- **Daily Trade Frequency**: 3-8 trades depending on market conditions
- **Risk-Reward Ratio**: 1.5:1 minimum

### Realistic Profit Scenarios

**Conservative Scenario (60% win rate):**
- 5 trades/day: 3 wins ($18) + 2 losses (-$6) = $12 daily profit ✅

**Moderate Scenario (65% win rate):**
- 6 trades/day: 4 wins ($24) + 2 losses (-$6) = $18 daily profit ⚠️ (above target)

**Defensive Scenario (55% win rate):**
- 4 trades/day: 2 wins ($12) + 2 losses (-$6) = $6 daily profit ⚠️ (below target)

## 🚀 Getting Started

### Prerequisites
- Node.js 18+
- TypeScript 5+
- Active Binance account with API access
- Minimum $300 USDT balance

### Installation

1. **Clone and install dependencies:**
```bash
git clone <repository-url>
cd enterprise-solana-trading-bot
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your Binance API credentials
```

3. **Build the project:**
```bash
npm run build
```

4. **Run tests:**
```bash
npm test
```

### Configuration

Edit `.env` file with your settings:

```env
# Environment Selection
TRADING_ENV=testnet  # Set to 'production' for live trading

# Binance API (REQUIRED)
BINANCE_API_KEY=your_api_key_here
BINANCE_API_SECRET=your_secret_here

# Trading Parameters
TRADING_SYMBOL=SOLUSDT
INITIAL_CAPITAL=300
DAILY_PROFIT_TARGET=12
MAX_DAILY_LOSS=30
POSITION_SIZE_PERCENTAGE=10

# Risk Management
STOP_LOSS_PERCENTAGE=2
TAKE_PROFIT_PERCENTAGE=3
TRAILING_STOP_PERCENTAGE=1.5
MAX_OPEN_POSITIONS=3

# Algorithm Tuning
MEAN_REVERSION_PERIOD=20
DEVIATION_THRESHOLD=2
GRID_LEVELS=5
GRID_SPACING_PERCENTAGE=0.5
```

### Running the Bot

```bash
# Development mode with hot reload
npm run dev

# Production mode
npm start
```

## 🖥️ Terminal Interface

The bot features a professional terminal interface with the following screens:

### Main Menu
- Start Trading
- View Configuration
- View Account Status  
- Run Backtest (Coming Soon)
- Live Monitor
- Emergency Stop
- Exit

### Live Monitor Dashboard
Real-time display showing:
- Engine status and balance
- Current SOL price and 24h change
- Risk metrics (daily P&L, total P&L, win rate, risk score)
- Open positions with entry/exit prices
- Strategy indicators (SMA, Bollinger Bands, RSI)

### Account Status
- USDT and SOL balances
- Total portfolio value
- Current market data for SOL
- 24-hour trading statistics

## 🛡️ Risk Management Details

### Mandatory Safeguards

1. **Stop Loss Orders**: Every trade automatically includes stop loss at 2% below entry
2. **Take Profit Orders**: Automated profit capture at 3% above entry
3. **Trailing Stops**: Dynamic adjustment to lock in profits (1.5% trailing distance)
4. **Position Limits**: Maximum 3 concurrent positions to limit exposure
5. **Daily Loss Cap**: Hard stop at $30 daily loss
6. **Circuit Breaker**: Emergency shutdown at 15% total capital loss

### Advanced Protection

1. **Consecutive Loss Tracking**: Emergency stop after 5 consecutive losses
2. **Market Volatility Filters**: Prevents trading during extreme price movements
3. **Signal Confidence Thresholds**: Minimum 70% confidence required for trade execution
4. **Order Validation**: Pre-trade checks for position size, balance, and market conditions
5. **Health Monitoring**: Continuous system health assessment with warning alerts

## 📈 Algorithm Details

### Mean Reversion Strategy

The bot uses a sophisticated mean reversion approach:

1. **Bollinger Bands**: Identifies overbought/oversold conditions
2. **RSI Integration**: Confirms momentum exhaustion signals
3. **Volume Analysis**: Validates signals with volume confirmation
4. **Trend Detection**: Ensures counter-trend positioning for mean reversion

### Signal Generation

**Buy Signals Triggered When:**
- Price touches/breaks below lower Bollinger Band
- RSI indicates oversold conditions (≤30)
- Price below Simple Moving Average
- Volume exceeds 20% of average
- Recent downward momentum present

**Sell Signals Triggered When:**
- Price touches/breaks above upper Bollinger Band  
- RSI indicates overbought conditions (≥70)
- Price above Simple Moving Average
- Volume exceeds 20% of average
- Recent upward momentum present

### Position Sizing

Dynamic position sizing based on:
- Volatility adjustment (lower size for higher volatility)
- Account balance percentage (maximum 10%)
- Market conditions assessment
- Risk score evaluation

## 🧪 Testing

Comprehensive test suite covering:

### Unit Tests
- Risk Manager validation logic
- Mean Reversion strategy signals
- Trading Safeguards functionality
- Technical indicator calculations

### Integration Tests
- Complete trading system workflow
- Market data processing pipeline
- Error handling and recovery
- Performance metrics accuracy

Run tests:
```bash
# All tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Type checking
npm run typecheck

# Linting
npm run lint
```

## 📝 Logging and Monitoring

### Log Levels
- **INFO**: General operational information
- **WARN**: Risk warnings and concerning conditions  
- **ERROR**: System errors and failures

### Log Categories
- **TRADE**: All trading activity (entries, exits, orders)
- **SIGNAL**: Strategy signals and analysis
- **RISK**: Risk management decisions and warnings
- **PERFORMANCE**: P&L and performance metrics
- **ERROR**: System errors and exceptions

### Log Files
- **Ticker-Specific Logs** (NEW):
  - `logs/trading-{SYMBOL}.log`: Trading activity for specific ticker (e.g., `trading-BTCUSDT.log`)
  - `logs/error-{SYMBOL}.log`: Errors for specific ticker (e.g., `error-BTCUSDT.log`)
- **Test Logs**:
  - `logs/trading-test.log`: All test-related logs
  - `logs/error-test.log`: Test error logs
- **Legacy** (backwards compatibility):
  - `logs/trading.log`: General trading activity
  - `logs/error.log`: General error log

## 🚨 Emergency Procedures

### Manual Emergency Stop
Use the terminal interface "Emergency Stop" option or press Ctrl+C during live monitoring.

### Automatic Emergency Triggers
1. Daily loss limit reached ($30)
2. Total portfolio loss exceeds 15%
3. 5 consecutive losing trades
4. Binance API connection failure
5. System health check failures

### Recovery Process
1. Review logs for failure cause
2. Assess account balance and open positions
3. Manually close any remaining positions if needed
4. Reset emergency stop flag
5. Restart bot after issue resolution

## 📊 Performance Tracking

### Real-time Metrics
- Daily P&L and total P&L
- Win rate percentage
- Sharpe ratio calculation
- Maximum drawdown tracking
- Risk score (0-100 scale)
- Position count and exposure

### Historical Analysis
- Trade history with entry/exit details
- Performance attribution by strategy signals
- Risk-adjusted returns calculation
- Drawdown analysis and recovery time

## 🔧 Maintenance

### Daily Tasks
- Monitor daily P&L vs targets
- Review risk metrics and health status
- Check log files for warnings or errors
- Verify account balance and open positions

### Weekly Tasks
- Analyze trading performance vs benchmark
- Review and adjust risk parameters if needed
- Update strategy parameters based on market conditions
- Backup trading logs and performance data

### Monthly Tasks
- Comprehensive performance review
- Strategy optimization and backtesting
- Risk model validation
- System security updates

## ⚠️ Disclaimers

### Financial Risk Warning
- Cryptocurrency trading involves substantial risk of loss
- Past performance does not guarantee future results
- Only trade with capital you can afford to lose
- This bot is for educational and research purposes

### Technical Disclaimers
- No warranty on software functionality or trading results
- Users responsible for API key security and account management
- Binance API limitations may affect bot performance
- Internet connectivity required for real-time operation

### Regulatory Compliance
- Users responsible for compliance with local financial regulations
- Tax reporting obligations vary by jurisdiction
- Consult financial advisors before automated trading
- Some jurisdictions may restrict algorithmic trading

## 📞 Support

For issues, questions, or contributions:
- Review logs in `logs/` directory
- Check configuration in `.env` file
- Verify Binance API permissions and balance
- Test with small amounts on testnet first

## 🔄 Version History

### v1.0.0 (Current)
- Initial release with mean reversion strategy
- Comprehensive risk management system
- Terminal-based monitoring interface
- Full test suite and documentation

### Planned Features
- Multiple strategy support (Grid, DCA, Momentum)
- Web-based dashboard interface
- Historical backtesting engine
- Performance optimization tools
- Machine learning signal enhancement

---

**Remember**: Start with testnet mode and small amounts. The goal is consistent small profits, not high-risk large gains. "We can make big money with one trade but at a high risk or we can make small wins consistently and safely over time."
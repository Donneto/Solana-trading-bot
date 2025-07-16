# 🔄 **COIN PROFILES GUIDE**

## **🎯 Available Trading Profiles**

### **🟠 Bitcoin (BTC) - Grid Trading** ⭐ *Optimized*
```bash
cp profiles/btc.env .env
# Edit API keys and run: npm run dev
```
**Characteristics:**
- ✅ **Low volatility, institutional trading patterns**
- ✅ **Grid trading strategy for automated levels**
- ✅ **Conservative settings (1.5% deviation)**
- ✅ **Tight grid spacing for low volatility**
- ✅ **Fewer concurrent trades (2 max production)**

---

### **🟣 Solana (SOL) - Mean Reversion** ⭐ *Optimized*
```bash
cp profiles/sol.env .env
# Edit API keys and run: npm run dev
```
**Characteristics:**
- ✅ **Medium volatility, excellent Bollinger Band patterns**
- ✅ **Mean reversion strategy for oscillations**
- ✅ **Balanced Bollinger settings (2.0 deviation)**
- ✅ **Standard risk management (2% stop)**
- ✅ **Moderate position sizes (8-10%)**

---

### **🔵 Cardano (ADA) - Momentum** ⭐ *Optimized*
```bash
cp profiles/ada.env .env
# Edit API keys and run: npm run dev
```
**Characteristics:**
- ✅ **High volatility, strong trend movements**
- ✅ **Momentum strategy for trend following**
- ✅ **MACD/EMA crossover signals**
- ✅ **Higher profit targets (3.5-6%)**
- ✅ **Smaller position sizes for volatility**

---

### **💙 XRP - Momentum** ⭐ *Optimized*
```bash
cp profiles/xrp.env .env
# Edit API keys and run: npm run dev
```
**Characteristics:**
- ✅ **News-driven volatility patterns**
- ✅ **Momentum strategy for quick trend changes**
- ✅ **Responsive to regulatory news**
- ✅ **Adaptive risk management**
- ✅ **Quick entry/exit signals**

---

## **📊 Strategy Assignment Table**

| Coin | Strategy | Rationale | Volatility | Key Indicators |
|------|----------|-----------|------------|----------------|
| **BTC** | **Grid Trading** | Low volatility, predictable ranges | Low | Grid levels, institutional patterns |
| **SOL** | **Mean Reversion** | Balanced oscillations around SMA | Medium | Bollinger Bands, RSI oversold/overbought |
| **ADA** | **Momentum** | Strong trend movements | High | MACD crossovers, EMA alignment |
| **XRP** | **Momentum** | News-driven quick trends | High | MACD signals, volume confirmation |

---

## **🧠 Strategy Explanations**

### **Grid Trading (BTC)**
- **Why**: Bitcoin's institutional adoption creates predictable support/resistance levels
- **How**: Places buy/sell orders at predetermined intervals above/below current price
- **Best For**: Range-bound markets, low volatility periods
- **Risk**: Trending markets can exhaust grid levels

### **Mean Reversion (SOL)**
- **Why**: Solana shows excellent oscillation patterns around moving averages
- **How**: Buys when price hits lower Bollinger Band, sells at upper band
- **Best For**: Markets that return to average after extreme moves
- **Risk**: Strong trending markets can cause extended losses

### **Momentum (ADA/XRP)**
- **Why**: High volatility coins show strong directional moves
- **How**: Follows trends using MACD crossovers and EMA alignment
- **Best For**: Trending markets, news-driven volatility
- **Risk**: Whipsaw markets with false breakouts

---

## **🚀 Quick Switching**

### **Automatic Strategy Selection**
```bash
# The bot automatically selects the optimal strategy:
npm run dev BTCUSDT    # Loads Grid Trading strategy
npm run dev SOLUSDT    # Loads Mean Reversion strategy  
npm run dev ADAUSDT    # Loads Momentum strategy
npm run dev XRPUSDT    # Loads Momentum strategy
```

### **Manual Override** (Advanced)
```bash
# Override strategy in your .env file:
STRATEGY_OVERRIDE=momentum    # Force momentum for any coin
STRATEGY_OVERRIDE=meanReversion    # Force mean reversion
STRATEGY_OVERRIDE=gridTrading    # Force grid trading
```

---

## **🎯 Profile Auto-Detection**

**The bot automatically detects your coin and loads optimized settings:**

```
🎯 Loading BTCUSDT profile: Grid trading for low volatility institutional patterns
⚙️  Strategy: gridTrading | Bollinger(14, 1.5) | Stop: 1.5% | Take: 2.5%
```

```
🎯 Loading SOLUSDT profile: Mean reversion for balanced volatility oscillations  
⚙️  Strategy: meanReversion | Bollinger(20, 2.0) | Stop: 2.0% | Take: 3.0%
```

```
🎯 Loading ADAUSDT profile: Momentum strategy for high volatility trend movements
⚙️  Strategy: momentum | MACD/EMA | Stop: 2.0% | Take: 3.5%
```

**You can still override any setting in your .env file if needed!**

---

## **💡 Strategy Recommendations**

### **For Beginners:**
1. **Start with SOL** (mean reversion - easier to understand)
2. **Try BTC** (grid trading - more predictable)
3. **Advanced: ADA/XRP** (momentum - requires trend analysis)

### **Market Conditions:**
- **Sideways Markets**: BTC (Grid), SOL (Mean Reversion)
- **Trending Markets**: ADA/XRP (Momentum)
- **High Volatility**: All strategies work with proper risk management
- **Low Volatility**: BTC Grid Trading excels

### **Risk Tolerance:**
- **Conservative**: BTC Grid Trading (lower volatility)
- **Balanced**: SOL Mean Reversion (predictable patterns)
- **Aggressive**: ADA/XRP Momentum (higher returns, higher risk)

**Each profile uses the scientifically optimal strategy for that coin's specific trading characteristics!**
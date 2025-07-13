# 🔄 **COIN PROFILES GUIDE**

## **🎯 Available Trading Profiles**

### **🟠 Bitcoin (BTC) - Conservative**
```bash
cp profiles/btc.env .env
# Edit API keys and run: npm run dev
```
**Characteristics:**
- ✅ **Low volatility, institutional trading**
- ✅ **Tighter Bollinger Bands (1.5 deviation)**
- ✅ **Conservative stop losses (1.5%)**
- ✅ **Larger position sizes (15%)**
- ✅ **Fewer concurrent trades (2 max)**

---

### **🟣 Solana (SOL) - Balanced** ⭐ *Original*
```bash
cp profiles/sol.env .env
# Edit API keys and run: npm run dev
```
**Characteristics:**
- ✅ **Medium volatility, good mean reversion**
- ✅ **Balanced settings (2.0 deviation)**
- ✅ **Standard risk management (2% stop)**
- ✅ **Moderate position sizes (10%)**
- ✅ **Balanced diversification (3 max)**

---

### **🔵 Cardano (ADA) - Aggressive**
```bash
cp profiles/ada.env .env
# Edit API keys and run: npm run dev
```
**Characteristics:**
- ✅ **High volatility, strong reversions**
- ✅ **Wider Bollinger Bands (2.5 deviation)**
- ✅ **Higher profit targets (4%)**
- ✅ **Smaller position sizes (8%)**
- ✅ **More diversification (4 max)**

---

### **💙 XRP - News-Driven**
```bash
cp profiles/xrp.env .env
# Edit API keys and run: npm run dev
```
**Characteristics:**
- ✅ **Regulatory news volatility**
- ✅ **Quick reversal patterns**
- ✅ **Responsive bands (2.3 deviation)**
- ✅ **Adaptive risk management**
- ✅ **Multiple positions (4 max)**

---

## **📊 Profile Comparison Table**

| Coin | Volatility | Stop Loss | Take Profit | Position Size | Max Positions |
|------|------------|-----------|-------------|---------------|---------------|
| **BTC** | Low | 1.5% | 2.5% | 15% | 2 |
| **SOL** | Medium | 2.0% | 3.0% | 10% | 3 |
| **ADA** | High | 2.5% | 4.0% | 8% | 4 |
| **XRP** | High | 2.2% | 3.5% | 9% | 4 |

---

## **🚀 Quick Switching**

### **Method 1: Use Profile Templates**
```bash
# Switch to Bitcoin
cp profiles/btc.env .env

# Switch to Cardano  
cp profiles/ada.env .env

# Switch to XRP
cp profiles/xrp.env .env
```

### **Method 2: Just Change Symbol** (Auto-detection)
```bash
# Edit your current .env file:
TRADING_SYMBOL=BTCUSDT   # Automatically loads BTC profile
TRADING_SYMBOL=ADAUSDT   # Automatically loads ADA profile
TRADING_SYMBOL=XRPUSDT   # Automatically loads XRP profile
```

---

## **🎯 Profile Auto-Detection**

**The bot automatically detects your coin and loads optimized settings:**

```
🎯 Loading BTCUSDT profile: Conservative settings for Bitcoin - lower volatility, institutional trading
⚙️  Profile: Bollinger(14, 1.5) | Stop: 1.5% | Take: 2.5%
```

**You can still override any setting in your .env file if needed!**

---

## **💡 Recommendations**

### **For Beginners:**
1. **Start with SOL** (balanced, well-tested)
2. **Test with BTC** (conservative, safer)
3. **Try ADA/XRP** (more advanced, higher volatility)

### **For Advanced Users:**
- **BTC**: During low volatility periods
- **ADA/XRP**: During high volatility periods  
- **SOL**: General purpose, all market conditions

**Each profile is optimized for that coin's specific trading characteristics and volatility patterns!**
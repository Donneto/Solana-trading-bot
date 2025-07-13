# 🚀 **QUICK START - Coin Profile Testing**

## **✅ Ready to Use - Just Change the Symbol!**

### **Current Setup Works With Any Coin:**
```bash
# Edit your .env file and change just one line:
TRADING_SYMBOL=BTCUSDT   # Bitcoin profile loads automatically
TRADING_SYMBOL=ADAUSDT   # Cardano profile loads automatically  
TRADING_SYMBOL=XRPUSDT   # XRP profile loads automatically
TRADING_SYMBOL=SOLUSDT   # Back to Solana (original)
```

### **What Happens Automatically:**
```
🎯 Loading BTCUSDT profile: Conservative settings for Bitcoin
⚙️  Profile: Bollinger(14, 1.5) | Stop: 1.5% | Take: 2.5%

🎯 Loading ADAUSDT profile: Higher volatility settings for Cardano  
⚙️  Profile: Bollinger(25, 2.5) | Stop: 2.5% | Take: 4%
```

---

## **📊 Profile Summary**

| Change TRADING_SYMBOL to: | Auto-Loads: | Best For: |
|---------------------------|-------------|-----------|
| `BTCUSDT` | Conservative BTC profile | Low volatility periods |
| `SOLUSDT` | Balanced SOL profile | General purpose |
| `ADAUSDT` | Aggressive ADA profile | High volatility periods |
| `XRPUSDT` | News-driven XRP profile | Regulatory events |

---

## **🔄 Super Easy Switching:**

### **Test Bitcoin Trading:**
1. Stop current bot (Ctrl+C)
2. Edit `.env`: Change `TRADING_SYMBOL=BTCUSDT`
3. Run `npm run dev`
4. Bot automatically loads BTC settings!

### **Test Cardano Trading:**
1. Stop current bot (Ctrl+C)  
2. Edit `.env`: Change `TRADING_SYMBOL=ADAUSDT`
3. Run `npm run dev`
4. Bot automatically loads ADA settings!

**No other configuration needed - profiles handle everything automatically!**

---

## **💡 Pro Tip:**
You can still override any profile setting in your .env:
```bash
TRADING_SYMBOL=BTCUSDT
POSITION_SIZE_PERCENTAGE=20  # Override BTC's default 15%
STOP_LOSS_PERCENTAGE=1.0     # Override BTC's default 1.5%
```

**Your coin profiles are ready to use! 🎯**
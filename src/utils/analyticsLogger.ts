import fs from 'fs';
import path from 'path';
import { config } from '../config/config';

interface IndicatorSnapshot {
  timestamp: number;
  price: number;
  symbol: string;
  strategy: string;
  indicators: any;
  marketData: any;
  decisionPoints: {
    [key: string]: boolean | number | string;
  };
  signalGenerated: boolean;
  signalReason?: string;
  confidence?: number;
  blockingFactors?: string[];
  executionMetrics?: {
    processingTimeMs?: number;
    dataQuality?: 'HIGH' | 'MEDIUM' | 'LOW';
    historicalDataPoints?: number;
    volatilityLevel?: 'HIGH' | 'MEDIUM' | 'LOW';
  };
}

interface SignalAnalysis {
  timestamp: number;
  symbol: string;
  strategy: string;
  price: number;
  conditions: {
    [key: string]: {
      value: any;
      required: any;
      met: boolean;
      weight: number;
    };
  };
  overallScore: number;
  minRequiredScore: number;
  finalDecision: 'BUY' | 'SELL' | 'HOLD';
  blockingReasons: string[];
}

export class AnalyticsLogger {
  private static logsDir = path.join(process.cwd(), 'analytics');
  private static symbol = config.symbol;

  static initialize(): void {
    // Create analytics directory if it doesn't exist
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  static logIndicatorSnapshot(snapshot: IndicatorSnapshot): void {
    this.initialize();
    
    const filename = `indicators-${this.symbol}.jsonl`;
    const filepath = path.join(this.logsDir, filename);
    
    const logEntry = {
      ...snapshot,
      timestamp: Date.now(),
      iso_timestamp: new Date().toISOString()
    };
    
    fs.appendFileSync(filepath, JSON.stringify(logEntry) + '\n');
  }

  static logSignalAnalysis(analysis: SignalAnalysis): void {
    this.initialize();
    
    const filename = `signal-analysis-${this.symbol}.jsonl`;
    const filepath = path.join(this.logsDir, filename);
    
    const logEntry = {
      ...analysis,
      timestamp: Date.now(),
      iso_timestamp: new Date().toISOString()
    };
    
    fs.appendFileSync(filepath, JSON.stringify(logEntry) + '\n');
  }

  static logDecisionMatrix(
    symbol: string,
    strategy: string,
    price: number,
    conditions: Array<{
      name: string;
      current: any;
      required: any;
      met: boolean;
      importance: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
      description: string;
    }>,
    finalDecision: string,
    confidence: number
  ): void {
    this.initialize();
    
    const filename = `decisions-${symbol}.jsonl`;
    const filepath = path.join(this.logsDir, filename);
    
    const logEntry = {
      timestamp: Date.now(),
      iso_timestamp: new Date().toISOString(),
      symbol,
      strategy,
      price,
      conditions,
      finalDecision,
      confidence,
      criticalConditionsMet: conditions.filter(c => c.importance === 'CRITICAL').every(c => c.met),
      highConditionsMet: conditions.filter(c => c.importance === 'HIGH').filter(c => c.met).length,
      totalHighConditions: conditions.filter(c => c.importance === 'HIGH').length
    };
    
    fs.appendFileSync(filepath, JSON.stringify(logEntry) + '\n');
  }

  static logStrategyPerformance(
    symbol: string,
    strategy: string,
    metrics: {
      signalsGenerated: number;
      ordersPlaced: number;
      successRate: number;
      avgConfidence: number;
      topBlockingReasons: string[];
      timespan: string;
      profitLoss?: number;
      totalVolume?: number;
      avgExecutionTime?: number;
      dataQualityScore?: number;
    }
  ): void {
    this.initialize();
    
    const filename = `performance-${symbol}.json`;
    const filepath = path.join(this.logsDir, filename);
    
    const logEntry = {
      timestamp: Date.now(),
      iso_timestamp: new Date().toISOString(),
      symbol,
      strategy,
      ...metrics
    };
    
    fs.writeFileSync(filepath, JSON.stringify(logEntry, null, 2));
  }

  static logMarketConditions(
    symbol: string,
    conditions: {
      volatility: number;
      volume: number;
      priceChange24h: number;
      marketTrend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
      fearGreedIndex?: number;
      supportResistance?: {
        support: number;
        resistance: number;
        currentPosition: 'NEAR_SUPPORT' | 'NEAR_RESISTANCE' | 'MIDDLE';
      };
    }
  ): void {
    this.initialize();
    
    const filename = `market-conditions-${symbol}.jsonl`;
    const filepath = path.join(this.logsDir, filename);
    
    const logEntry = {
      timestamp: Date.now(),
      iso_timestamp: new Date().toISOString(),
      symbol,
      ...conditions
    };
    
    fs.appendFileSync(filepath, JSON.stringify(logEntry) + '\n');
  }

  static logRiskMetrics(
    symbol: string,
    strategy: string,
    riskData: {
      positionSize: number;
      exposurePercentage: number;
      stopLossDistance: number;
      takeProfitDistance: number;
      riskRewardRatio: number;
      volatilityAdjustment: number;
      maxDrawdown?: number;
      correlationRisk?: number;
    }
  ): void {
    this.initialize();
    
    const filename = `risk-metrics-${symbol}.jsonl`;
    const filepath = path.join(this.logsDir, filename);
    
    const logEntry = {
      timestamp: Date.now(),
      iso_timestamp: new Date().toISOString(),
      symbol,
      strategy,
      ...riskData
    };
    
    fs.appendFileSync(filepath, JSON.stringify(logEntry) + '\n');
  }

  static logBacktestResults(
    symbol: string,
    strategy: string,
    results: {
      period: string;
      totalTrades: number;
      winRate: number;
      avgProfit: number;
      avgLoss: number;
      maxDrawdown: number;
      sharpeRatio: number;
      profitFactor: number;
      bestTrade: number;
      worstTrade: number;
    }
  ): void {
    this.initialize();
    
    const filename = `backtest-${strategy}-${symbol}.json`;
    const filepath = path.join(this.logsDir, filename);
    
    const logEntry = {
      timestamp: Date.now(),
      iso_timestamp: new Date().toISOString(),
      symbol,
      strategy,
      ...results
    };
    
    fs.writeFileSync(filepath, JSON.stringify(logEntry, null, 2));
  }

  static logOrderExecution(
    symbol: string,
    strategy: string,
    execution: {
      orderId: string;
      side: 'BUY' | 'SELL';
      quantity: number;
      price: number;
      executedPrice?: number;
      slippage?: number;
      executionTime?: number;
      status: 'FILLED' | 'PARTIAL' | 'CANCELLED' | 'REJECTED';
      reason?: string;
    }
  ): void {
    this.initialize();
    
    const filename = `executions-${symbol}.jsonl`;
    const filepath = path.join(this.logsDir, filename);
    
    const logEntry = {
      timestamp: Date.now(),
      iso_timestamp: new Date().toISOString(),
      symbol,
      strategy,
      ...execution
    };
    
    fs.appendFileSync(filepath, JSON.stringify(logEntry) + '\n');
  }

  static getAnalyticsFilePath(type: 'indicators' | 'decisions' | 'signal-analysis', symbol: string): string {
    return path.join(this.logsDir, `${type}-${symbol}.jsonl`);
  }

  static async generateReport(symbol: string): Promise<string> {
    const indicatorsFile = this.getAnalyticsFilePath('indicators', symbol);
    const decisionsFile = this.getAnalyticsFilePath('decisions', symbol);
    
    let report = `\n=== TRADING ANALYSIS REPORT FOR ${symbol} ===\n\n`;
    
    try {
      // Read recent indicators
      if (fs.existsSync(indicatorsFile)) {
        const indicators = fs.readFileSync(indicatorsFile, 'utf-8')
          .split('\n')
          .filter(line => line.trim())
          .slice(-10)
          .map(line => JSON.parse(line));
        
        report += `📊 Recent Indicator Values (last 10):\n`;
        indicators.forEach(ind => {
          report += `  ${new Date(ind.timestamp).toLocaleTimeString()}: Price=$${ind.price.toFixed(2)}`;
          if (ind.indicators) {
            if (ind.indicators.sma) report += `, SMA=$${ind.indicators.sma.toFixed(2)}`;
            if (ind.indicators.rsi) report += `, RSI=${ind.indicators.rsi.toFixed(1)}`;
            if (ind.indicators.macd) report += `, MACD=${ind.indicators.macd.toFixed(4)}`;
          }
          report += `\n`;
        });
      }
      
      // Read recent decisions
      if (fs.existsSync(decisionsFile)) {
        const decisions = fs.readFileSync(decisionsFile, 'utf-8')
          .split('\n')
          .filter(line => line.trim())
          .slice(-5)
          .map(line => JSON.parse(line));
        
        report += `\n🎯 Recent Decisions (last 5):\n`;
        decisions.forEach(dec => {
          report += `  ${new Date(dec.timestamp).toLocaleTimeString()}: ${dec.finalDecision} (${dec.confidence}% confidence)\n`;
          const failedCritical = dec.conditions.filter((c: any) => c.importance === 'CRITICAL' && !c.met);
          if (failedCritical.length > 0) {
            report += `    ❌ Failed Critical: ${failedCritical.map((c: any) => c.name).join(', ')}\n`;
          }
        });
      }
      
    } catch (error) {
      report += `Error generating report: ${error}\n`;
    }
    
    return report;
  }
}
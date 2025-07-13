import chalk from 'chalk';
import { fearGreedService } from '../services/fearGreed/fearGreedService';
import { fearGreedConfig } from '../config/config';

async function testFearGreedIndex() {
  console.log(chalk.blue('🧪 Testing Fear and Greed Index Integration\n'));

  // Test service health
  const health = fearGreedService.getHealthStatus();
  console.log(chalk.yellow('Service Health:'));
  console.log(`  Enabled: ${health.enabled}`);
  console.log(`  Has Valid Cache: ${health.hasValidCache}`);
  console.log(`  Consecutive Failures: ${health.consecutiveFailures}`);
  console.log(`  Is Updating: ${health.isUpdating}\n`);

  // Test configuration
  console.log(chalk.yellow('Configuration:'));
  console.log(`  API Key Set: ${fearGreedConfig.apiKey ? 'Yes' : 'No'}`);
  console.log(`  Cache Expiry: ${fearGreedConfig.cacheExpiryHours} hours`);
  console.log(`  Retry Attempts: ${fearGreedConfig.retryAttempts}`);
  console.log(`  Fallback Scraper: ${fearGreedConfig.fallbackToScraper}\n`);

  if (fearGreedConfig.enabled && fearGreedConfig.apiKey) {
    try {
      console.log(chalk.yellow('Fetching Fear and Greed Index...'));
      const data = await fearGreedService.getFearGreedIndex();
      
      if (data) {
        const getColor = (value: number) => {
          if (value <= 25) return chalk.red.bold;
          if (value <= 45) return chalk.red;
          if (value <= 55) return chalk.yellow;
          if (value <= 75) return chalk.green;
          return chalk.green.bold;
        };

        console.log(chalk.green('✓ Success!'));
        console.log(`  Value: ${getColor(data.value)(data.value)}`);
        console.log(`  Classification: ${getColor(data.value)(data.valueClassification)}`);
        console.log(`  Source: ${data.source}`);
        console.log(`  Timestamp: ${new Date(data.timestamp).toLocaleString()}`);
        console.log(`  Next Update: ${new Date(data.nextUpdate).toLocaleString()}`);

        // Test signal impact
        console.log(chalk.yellow('\nSignal Impact Analysis:'));
        if (data.valueClassification === 'Extreme Fear') {
          console.log(chalk.green('  Buy signals: +20 confidence boost'));
          console.log(chalk.red('  Sell signals: Blocked'));
        } else if (data.valueClassification === 'Fear') {
          console.log(chalk.green('  Buy signals: +15 confidence boost'));
          console.log(chalk.red('  Sell signals: Blocked'));
        } else if (data.valueClassification === 'Extreme Greed') {
          console.log(chalk.red('  Buy signals: Blocked'));
          console.log(chalk.green('  Sell signals: +20 confidence boost'));
        } else if (data.valueClassification === 'Greed') {
          console.log(chalk.red('  Buy signals: Blocked'));
          console.log(chalk.green('  Sell signals: +15 confidence boost'));
        } else {
          console.log(chalk.yellow('  Buy signals: ±5 confidence adjustment'));
          console.log(chalk.yellow('  Sell signals: ±5 confidence adjustment'));
        }

      } else {
        console.log(chalk.red('✗ No data returned'));
      }
    } catch (error) {
      console.log(chalk.red(`✗ Error: ${(error as Error).message}`));
    }
  } else {
    console.log(chalk.gray('Fear and Greed Index is disabled or API key not set'));
    console.log(chalk.gray('To enable:'));
    console.log(chalk.gray('  1. Set FEAR_GREED_INDEX_ENABLED=true in .env'));
    console.log(chalk.gray('  2. Set COINMARKETCAP_API_KEY=your_api_key in .env'));
  }

  console.log(chalk.blue('\n🎯 Integration Test Complete'));
}

// Run the test
testFearGreedIndex().catch(console.error);
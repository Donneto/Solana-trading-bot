import axios, { AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { EventEmitter } from 'events';
import { FearGreedData, FearGreedCacheEntry, FearGreedConfig } from '../../interfaces/trading';
import { logger } from '../../utils/logger';
import { fearGreedConfig } from '../../config/config';
import fs from 'fs/promises';
import path from 'path';

interface CoinMarketCapFGIResponse {
  status: {
    timestamp: string;
    error_code: string;
    error_message: string | null;
    credit_count: number;
  };
  data: {
    value: number;
    value_classification: string;
    update_time: string;
  };
}

export class FearGreedService extends EventEmitter {
  private config: FearGreedConfig;
  private cache: FearGreedCacheEntry | null = null;
  private cacheFilePath: string;
  private isUpdating: boolean = false;
  private lastUpdateAttempt: number = 0;
  private consecutiveFailures: number = 0;

  constructor(config: FearGreedConfig = fearGreedConfig) {
    super();
    this.config = config;
    this.cacheFilePath = path.join(process.cwd(), '.cache', 'fear-greed-index.json');
    this.initializeCache();
  }

  private async initializeCache(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.cacheFilePath), { recursive: true });
      await this.loadCacheFromFile();
    } catch (error) {
      logger.warn('Failed to initialize Fear and Greed Index cache', { error });
    }
  }

  private async loadCacheFromFile(): Promise<void> {
    try {
      const cacheData = await fs.readFile(this.cacheFilePath, 'utf-8');
      const parsed = JSON.parse(cacheData);
      
      if (this.isValidCacheEntry(parsed)) {
        this.cache = parsed;
        logger.info('Fear and Greed Index cache loaded from file', {
          value: this.cache.data.value,
          classification: this.cache.data.valueClassification,
          age: Date.now() - this.cache.cachedAt
        });
      }
    } catch (error) {
      logger.debug('No existing cache file found or invalid cache data');
    }
  }

  private async saveCacheToFile(): Promise<void> {
    if (!this.cache) return;
    
    try {
      await fs.writeFile(this.cacheFilePath, JSON.stringify(this.cache, null, 2));
    } catch (error) {
      logger.warn('Failed to save Fear and Greed Index cache to file', { error });
    }
  }

  private isValidCacheEntry(entry: any): entry is FearGreedCacheEntry {
    return entry &&
           typeof entry.cachedAt === 'number' &&
           typeof entry.expiresAt === 'number' &&
           entry.data &&
           typeof entry.data.value === 'number' &&
           typeof entry.data.valueClassification === 'string' &&
           typeof entry.data.timestamp === 'number';
  }

  private isCacheValid(): boolean {
    if (!this.cache) return false;
    return Date.now() < this.cache.expiresAt;
  }

  private classifyFearGreedValue(value: number): FearGreedData['valueClassification'] {
    if (value <= 25) return 'Extreme Fear';
    if (value <= 45) return 'Fear';
    if (value <= 55) return 'Neutral';
    if (value <= 75) return 'Greed';
    return 'Extreme Greed';
  }

  private async fetchFromAPI(): Promise<FearGreedData> {
    if (!this.config.apiKey) {
      throw new Error('CoinMarketCap API key not configured');
    }

    const url = 'https://pro-api.coinmarketcap.com/v3/fear-and-greed/latest';
    const headers = {
      'X-CMC_PRO_API_KEY': this.config.apiKey,
      'Accept': 'application/json'
    };

    let lastError: Error;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        logger.debug(`Fetching Fear and Greed Index from API (attempt ${attempt}/${this.config.retryAttempts})`);
        
        const response: AxiosResponse<CoinMarketCapFGIResponse> = await axios.get(url, {
          headers,
          timeout: 10000,
          validateStatus: (status) => status < 500
        });

        if (response.status !== 200) {
          throw new Error(`API returned status ${response.status}: ${response.data?.status?.error_message || 'Unknown error'}`);
        }

        if (!response.data?.data) {
          throw new Error('Invalid response format from CoinMarketCap API');
        }

        const fgiData = response.data.data;
        const timestamp = new Date(fgiData.update_time).getTime();
        // Assume next update is in 12 hours if time_until_update is not provided
        const nextUpdateMs = 12 * 60 * 60 * 1000;

        const result: FearGreedData = {
          value: Math.round(fgiData.value),
          valueClassification: fgiData.value_classification as FearGreedData['valueClassification'] || this.classifyFearGreedValue(fgiData.value),
          timestamp,
          nextUpdate: timestamp + nextUpdateMs,
          source: 'api'
        };

        logger.info('Successfully fetched Fear and Greed Index from API', {
          value: result.value,
          classification: result.valueClassification,
          nextUpdate: new Date(result.nextUpdate).toISOString()
        });

        this.consecutiveFailures = 0;
        return result;

      } catch (error) {
        lastError = error as Error;
        logger.warn(`API fetch attempt ${attempt} failed`, {
          error: lastError.message,
          attempt,
          maxAttempts: this.config.retryAttempts,
          url,
          statusCode: (error as any)?.response?.status,
          statusText: (error as any)?.response?.statusText,
          responseData: (error as any)?.response?.data,
          requestConfig: {
            url,
            headers: { ...headers, 'X-CMC_PRO_API_KEY': '[REDACTED]' }
          }
        });

        if (attempt < this.config.retryAttempts) {
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs));
        }
      }
    }

    this.consecutiveFailures++;
    throw new Error(`Failed to fetch from API after ${this.config.retryAttempts} attempts: ${lastError!.message}`);
  }

  private async fetchFromScraper(): Promise<FearGreedData> {
    if (!this.config.fallbackToScraper) {
      throw new Error('Web scraping fallback is disabled');
    }

    let lastError: Error;

    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        logger.debug(`Scraping Fear and Greed Index from website (attempt ${attempt}/${this.config.retryAttempts})`);
        
        const response = await axios.get(this.config.scrapingUrl, {
          timeout: 15000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
          }
        });

        const $ = cheerio.load(response.data);
        
        const fgiValueElement = $('.fear-greed-index-value, .fgi-value, [data-testid="fgi-value"]').first();
        const fgiTextElement = $('.fear-greed-index-text, .fgi-text, [data-testid="fgi-text"]').first();
        
        let fgiValue: number;
        
        if (fgiValueElement.length > 0) {
          const valueText = fgiValueElement.text().trim();
          fgiValue = parseInt(valueText.match(/\d+/)?.[0] || '0');
        } else {
          const scriptTags = $('script').toArray();
          let scriptMatch: string | null = null;
          
          for (const script of scriptTags) {
            const scriptContent = $(script).html() || '';
            const match = scriptContent.match(/(?:fear[_\-]?greed|fgi).*?(\d{1,2})/i);
            if (match && match[1]) {
              scriptMatch = match[1];
              break;
            }
          }
          
          if (!scriptMatch) {
            throw new Error('Could not find Fear and Greed Index value on webpage');
          }
          
          fgiValue = parseInt(scriptMatch);
        }

        if (isNaN(fgiValue) || fgiValue < 0 || fgiValue > 100) {
          throw new Error(`Invalid Fear and Greed Index value: ${fgiValue}`);
        }

        let classification = this.classifyFearGreedValue(fgiValue);
        
        if (fgiTextElement.length > 0) {
          const textClassification = fgiTextElement.text().trim().toLowerCase();
          if (textClassification.includes('extreme fear')) classification = 'Extreme Fear';
          else if (textClassification.includes('fear')) classification = 'Fear';
          else if (textClassification.includes('neutral')) classification = 'Neutral';
          else if (textClassification.includes('extreme greed')) classification = 'Extreme Greed';
          else if (textClassification.includes('greed')) classification = 'Greed';
        }

        const timestamp = Date.now();
        const result: FearGreedData = {
          value: fgiValue,
          valueClassification: classification,
          timestamp,
          nextUpdate: timestamp + (12 * 60 * 60 * 1000),
          source: 'scraper'
        };

        logger.info('Successfully scraped Fear and Greed Index from website', {
          value: result.value,
          classification: result.valueClassification,
          url: this.config.scrapingUrl
        });

        this.consecutiveFailures = 0;
        return result;

      } catch (error) {
        lastError = error as Error;
        logger.warn(`Scraping attempt ${attempt} failed`, {
          error: lastError.message,
          attempt,
          maxAttempts: this.config.retryAttempts,
          url: this.config.scrapingUrl
        });

        if (attempt < this.config.retryAttempts) {
          await new Promise(resolve => setTimeout(resolve, this.config.retryDelayMs));
        }
      }
    }

    this.consecutiveFailures++;
    throw new Error(`Failed to scrape after ${this.config.retryAttempts} attempts: ${lastError!.message}`);
  }

  private async updateCache(): Promise<void> {
    if (this.isUpdating) {
      logger.debug('Cache update already in progress, skipping');
      return;
    }

    this.isUpdating = true;
    this.lastUpdateAttempt = Date.now();

    try {
      let fearGreedData: FearGreedData;

      try {
        fearGreedData = await this.fetchFromAPI();
      } catch (apiError) {
        logger.warn('API fetch failed, attempting fallback to scraper', { error: (apiError as Error).message });
        
        if (this.config.fallbackToScraper) {
          fearGreedData = await this.fetchFromScraper();
        } else {
          throw apiError;
        }
      }

      const expiresAt = Date.now() + (this.config.cacheExpiryHours * 60 * 60 * 1000);
      
      this.cache = {
        data: fearGreedData,
        cachedAt: Date.now(),
        expiresAt
      };

      await this.saveCacheToFile();
      this.emit('updated', fearGreedData);

      logger.info('Fear and Greed Index cache updated successfully', {
        value: fearGreedData.value,
        classification: fearGreedData.valueClassification,
        source: fearGreedData.source,
        expiresAt: new Date(expiresAt).toISOString()
      });

    } catch (error) {
      logger.error('Failed to update Fear and Greed Index cache', {
        error: (error as Error).message,
        consecutiveFailures: this.consecutiveFailures
      });
      
      this.emit('error', error);
      throw error;
    } finally {
      this.isUpdating = false;
    }
  }

  public async getFearGreedIndex(forceRefresh: boolean = false): Promise<FearGreedData | null> {
    if (!this.config.enabled) {
      logger.debug('Fear and Greed Index is disabled');
      return null;
    }

    const shouldUpdate = forceRefresh || 
                        !this.isCacheValid() || 
                        (Date.now() - this.lastUpdateAttempt > 60000 && this.consecutiveFailures > 0);

    if (shouldUpdate) {
      try {
        await this.updateCache();
      } catch (error) {
        if (!this.cache) {
          logger.error('No cached data available and update failed');
          return null;
        }
        
        logger.warn('Using stale cached data due to update failure', {
          cacheAge: Date.now() - this.cache.cachedAt,
          error: (error as Error).message
        });
      }
    }

    if (this.cache) {
      return {
        ...this.cache.data,
        source: this.isCacheValid() ? this.cache.data.source : 'cached'
      };
    }

    return null;
  }

  public getCacheInfo(): { hasCache: boolean; isValid: boolean; age?: number; expiresIn?: number } {
    if (!this.cache) {
      return { hasCache: false, isValid: false };
    }

    const now = Date.now();
    const age = now - this.cache.cachedAt;
    const expiresIn = this.cache.expiresAt - now;
    const isValid = this.isCacheValid();

    return {
      hasCache: true,
      isValid,
      age,
      expiresIn: expiresIn > 0 ? expiresIn : 0
    };
  }

  public async invalidateCache(): Promise<void> {
    this.cache = null;
    try {
      await fs.unlink(this.cacheFilePath);
      logger.info('Fear and Greed Index cache invalidated');
    } catch (error) {
      logger.debug('Cache file not found during invalidation');
    }
  }

  public getHealthStatus() {
    const cacheInfo = this.getCacheInfo();
    return {
      enabled: this.config.enabled,
      hasValidCache: cacheInfo.isValid,
      consecutiveFailures: this.consecutiveFailures,
      isUpdating: this.isUpdating,
      lastUpdateAttempt: this.lastUpdateAttempt,
      cacheAge: cacheInfo.age,
      cacheExpiresIn: cacheInfo.expiresIn
    };
  }
}

export const fearGreedService = new FearGreedService();
import { FearGreedService } from '../../../src/services/fearGreed/fearGreedService';
import { FearGreedConfig, FearGreedData } from '../../../src/interfaces/trading';
import nock from 'nock';
import fs from 'fs/promises';
import path from 'path';

describe('FearGreedService', () => {
  let service: FearGreedService;
  let mockConfig: FearGreedConfig;
  const cacheDir = path.join(process.cwd(), '.cache');
  const cacheFile = path.join(cacheDir, 'fear-greed-index.json');

  beforeEach(async () => {
    mockConfig = {
      enabled: true,
      apiKey: 'test-api-key',
      cacheExpiryHours: 12,
      retryAttempts: 3,
      retryDelayMs: 100,
      fallbackToScraper: true,
      scrapingUrl: 'https://coinmarketcap.com/fear-and-greed/'
    };

    service = new FearGreedService(mockConfig);
    
    // Clean up cache before each test
    try {
      await fs.unlink(cacheFile);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  });

  afterEach(async () => {
    nock.cleanAll();
    
    // Clean up cache after each test
    try {
      await fs.unlink(cacheFile);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  });

  describe('Configuration', () => {
    it('should be disabled when config.enabled is false', async () => {
      const disabledConfig = { ...mockConfig, enabled: false };
      const disabledService = new FearGreedService(disabledConfig);
      
      const result = await disabledService.getFearGreedIndex();
      expect(result).toBeNull();
    });

    it('should provide correct health status', () => {
      const health = service.getHealthStatus();
      
      expect(health).toHaveProperty('enabled', true);
      expect(health).toHaveProperty('hasValidCache', false);
      expect(health).toHaveProperty('consecutiveFailures', 0);
      expect(health).toHaveProperty('isUpdating', false);
    });
  });

  describe('API Integration', () => {
    it('should successfully fetch data from CoinMarketCap API', async () => {
      const mockApiResponse = {
        status: {
          timestamp: '2024-01-01T12:00:00.000Z',
          error_code: 0,
          error_message: null,
          credit_count: 1
        },
        data: [{
          value: 25,
          value_classification: 'Extreme Fear',
          timestamp: '2024-01-01T12:00:00.000Z',
          time_until_update: '43200'
        }]
      };

      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .reply(200, mockApiResponse);

      const result = await service.getFearGreedIndex();

      expect(result).toBeDefined();
      expect(result?.value).toBe(25);
      expect(result?.valueClassification).toBe('Extreme Fear');
      expect(result?.source).toBe('api');
    });

    it('should handle API errors gracefully', async () => {
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .reply(500, { error: 'Internal Server Error' });

      // Mock scraper fallback
      nock('https://coinmarketcap.com')
        .get('/fear-and-greed/')
        .reply(200, `
          <html>
            <body>
              <div class="fear-greed-index-value">75</div>
              <div class="fear-greed-index-text">Greed</div>
            </body>
          </html>
        `);

      const result = await service.getFearGreedIndex();

      expect(result).toBeDefined();
      expect(result?.value).toBe(75);
      expect(result?.source).toBe('scraper');
    });

    it('should retry API calls on failure', async () => {
      let callCount = 0;
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .times(3)
        .reply(() => {
          callCount++;
          return callCount < 3 ? [500, { error: 'Server Error' }] : [200, {
            status: { timestamp: '2024-01-01T12:00:00.000Z', error_code: 0, error_message: null, credit_count: 1 },
            data: [{ value: 50, value_classification: 'Neutral', timestamp: '2024-01-01T12:00:00.000Z', time_until_update: '43200' }]
          }];
        });

      const result = await service.getFearGreedIndex();

      expect(result).toBeDefined();
      expect(result?.value).toBe(50);
      expect(callCount).toBe(3);
    });

    it('should validate API response format', async () => {
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .reply(200, { invalid: 'response' });

      nock('https://coinmarketcap.com')
        .get('/fear-and-greed/')
        .reply(200, '<div class="fear-greed-index-value">30</div>');

      const result = await service.getFearGreedIndex();

      expect(result?.source).toBe('scraper');
    });
  });

  describe('Web Scraping Fallback', () => {
    beforeEach(() => {
      // Mock API failure
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .reply(500, { error: 'API Error' });
    });

    it('should successfully scrape data from website', async () => {
      nock('https://coinmarketcap.com')
        .get('/fear-and-greed/')
        .reply(200, `
          <html>
            <body>
              <div class="fear-greed-index-value">82</div>
              <div class="fear-greed-index-text">Extreme Greed</div>
            </body>
          </html>
        `);

      const result = await service.getFearGreedIndex();

      expect(result).toBeDefined();
      expect(result?.value).toBe(82);
      expect(result?.valueClassification).toBe('Extreme Greed');
      expect(result?.source).toBe('scraper');
    });

    it('should handle different HTML structures', async () => {
      nock('https://coinmarketcap.com')
        .get('/fear-and-greed/')
        .reply(200, `
          <html>
            <body>
              <div class="fgi-value">45</div>
              <script>var fearGreedIndex = 45;</script>
            </body>
          </html>
        `);

      const result = await service.getFearGreedIndex();

      expect(result?.value).toBe(45);
      expect(result?.valueClassification).toBe('Fear');
    });

    it('should extract value from JavaScript when DOM elements not found', async () => {
      nock('https://coinmarketcap.com')
        .get('/fear-and-greed/')
        .reply(200, `
          <html>
            <body>
              <script>
                window.fearGreedData = { value: 67 };
              </script>
            </body>
          </html>
        `);

      const result = await service.getFearGreedIndex();

      expect(result?.value).toBe(67);
    });

    it('should be disabled when fallbackToScraper is false', async () => {
      const noFallbackConfig = { ...mockConfig, fallbackToScraper: false };
      const noFallbackService = new FearGreedService(noFallbackConfig);

      const result = await noFallbackService.getFearGreedIndex();
      expect(result).toBeNull();
    });

    it('should validate scraped values', async () => {
      nock('https://coinmarketcap.com')
        .get('/fear-and-greed/')
        .reply(200, '<div class="fear-greed-index-value">invalid</div>');

      const result = await service.getFearGreedIndex();
      expect(result).toBeNull();
    });
  });

  describe('Caching System', () => {
    it('should cache successful responses', async () => {
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .reply(200, {
          status: { timestamp: '2024-01-01T12:00:00.000Z', error_code: 0, error_message: null, credit_count: 1 },
          data: [{ value: 35, value_classification: 'Fear', timestamp: '2024-01-01T12:00:00.000Z', time_until_update: '43200' }]
        });

      const result1 = await service.getFearGreedIndex();
      const result2 = await service.getFearGreedIndex(); // Should use cache

      expect(result1?.value).toBe(35);
      expect(result2?.value).toBe(35);
      expect(result2?.source).toBe('api'); // Still shows original source

      const cacheInfo = service.getCacheInfo();
      expect(cacheInfo.hasCache).toBe(true);
      expect(cacheInfo.isValid).toBe(true);
    });

    it('should persist cache to file system', async () => {
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .reply(200, {
          status: { timestamp: '2024-01-01T12:00:00.000Z', error_code: 0, error_message: null, credit_count: 1 },
          data: [{ value: 60, value_classification: 'Greed', timestamp: '2024-01-01T12:00:00.000Z', time_until_update: '43200' }]
        });

      await service.getFearGreedIndex();

      // Create new service instance to test file persistence
      const newService = new FearGreedService(mockConfig);
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for file operations

      const cacheInfo = newService.getCacheInfo();
      expect(cacheInfo.hasCache).toBe(true);
    });

    it('should handle cache expiration', async () => {
      const expiredConfig = { ...mockConfig, cacheExpiryHours: 0.001 }; // Very short expiry
      const expiredService = new FearGreedService(expiredConfig);

      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .times(2)
        .reply(200, {
          status: { timestamp: '2024-01-01T12:00:00.000Z', error_code: 0, error_message: null, credit_count: 1 },
          data: [{ value: 40, value_classification: 'Fear', timestamp: '2024-01-01T12:00:00.000Z', time_until_update: '43200' }]
        });

      await expiredService.getFearGreedIndex();
      
      // Wait for cache to expire
      await new Promise(resolve => setTimeout(resolve, 100));
      
      await expiredService.getFearGreedIndex(); // Should fetch fresh data

      expect(nock.isDone()).toBe(true);
    });

    it('should invalidate cache manually', async () => {
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .reply(200, {
          status: { timestamp: '2024-01-01T12:00:00.000Z', error_code: 0, error_message: null, credit_count: 1 },
          data: [{ value: 55, value_classification: 'Neutral', timestamp: '2024-01-01T12:00:00.000Z', time_until_update: '43200' }]
        });

      await service.getFearGreedIndex();
      
      let cacheInfo = service.getCacheInfo();
      expect(cacheInfo.hasCache).toBe(true);

      await service.invalidateCache();
      
      cacheInfo = service.getCacheInfo();
      expect(cacheInfo.hasCache).toBe(false);
    });

    it('should use stale cache when update fails', async () => {
      // First successful request
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .reply(200, {
          status: { timestamp: '2024-01-01T12:00:00.000Z', error_code: 0, error_message: null, credit_count: 1 },
          data: [{ value: 70, value_classification: 'Greed', timestamp: '2024-01-01T12:00:00.000Z', time_until_update: '43200' }]
        });

      await service.getFearGreedIndex();

      // Subsequent requests fail
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .reply(500, { error: 'Server Error' });

      nock('https://coinmarketcap.com')
        .get('/fear-and-greed/')
        .reply(500, 'Website Error');

      const result = await service.getFearGreedIndex(true); // Force refresh

      expect(result?.value).toBe(70); // Should return stale cache
      expect(result?.source).toBe('cached');
    });
  });

  describe('Fear and Greed Classification', () => {
    const testCases: Array<{ value: number; expected: FearGreedData['valueClassification'] }> = [
      { value: 10, expected: 'Extreme Fear' },
      { value: 25, expected: 'Extreme Fear' },
      { value: 35, expected: 'Fear' },
      { value: 45, expected: 'Fear' },
      { value: 50, expected: 'Neutral' },
      { value: 55, expected: 'Neutral' },
      { value: 65, expected: 'Greed' },
      { value: 75, expected: 'Greed' },
      { value: 85, expected: 'Extreme Greed' },
      { value: 100, expected: 'Extreme Greed' }
    ];

    testCases.forEach(({ value, expected }) => {
      it(`should classify ${value} as ${expected}`, async () => {
        nock('https://pro-api.coinmarketcap.com')
          .get('/v3/fear-and-greed/latest')
          .reply(200, {
            status: { timestamp: '2024-01-01T12:00:00.000Z', error_code: 0, error_message: null, credit_count: 1 },
            data: [{ value, value_classification: 'Test', timestamp: '2024-01-01T12:00:00.000Z', time_until_update: '43200' }]
          });

        const result = await service.getFearGreedIndex();
        expect(result?.valueClassification).toBe(expected);
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle network timeouts', async () => {
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .delay(15000) // Longer than timeout
        .reply(200, {});

      nock('https://coinmarketcap.com')
        .get('/fear-and-greed/')
        .reply(200, '<div class="fear-greed-index-value">45</div>');

      const result = await service.getFearGreedIndex();
      expect(result?.source).toBe('scraper');
    });

    it('should handle malformed HTML in scraper', async () => {
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .reply(500, {});

      nock('https://coinmarketcap.com')
        .get('/fear-and-greed/')
        .reply(200, 'invalid html without proper tags');

      const result = await service.getFearGreedIndex();
      expect(result).toBeNull();
    });

    it('should track consecutive failures', async () => {
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .times(2)
        .reply(500, {});

      nock('https://coinmarketcap.com')
        .get('/fear-and-greed/')
        .times(2)
        .reply(500, {});

      await service.getFearGreedIndex().catch(() => {});
      await service.getFearGreedIndex().catch(() => {});

      const health = service.getHealthStatus();
      expect(health.consecutiveFailures).toBe(2);
    });

    it('should emit events on updates and errors', (done) => {
      let eventCount = 0;

      service.on('updated', (data: FearGreedData) => {
        expect(data.value).toBeDefined();
        eventCount++;
        if (eventCount === 2) done();
      });

      service.on('error', (error: Error) => {
        expect(error).toBeInstanceOf(Error);
        eventCount++;
        if (eventCount === 2) done();
      });

      // Trigger success
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .reply(200, {
          status: { timestamp: '2024-01-01T12:00:00.000Z', error_code: 0, error_message: null, credit_count: 1 },
          data: [{ value: 50, value_classification: 'Neutral', timestamp: '2024-01-01T12:00:00.000Z', time_until_update: '43200' }]
        });

      service.getFearGreedIndex();

      // Trigger error
      const failService = new FearGreedService({ ...mockConfig, fallbackToScraper: false });
      
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .reply(500, {});

      failService.getFearGreedIndex().catch(() => {});
    });
  });

  describe('Force Refresh', () => {
    it('should force refresh when requested', async () => {
      let callCount = 0;
      
      nock('https://pro-api.coinmarketcap.com')
        .get('/v3/fear-and-greed/latest')
        .times(2)
        .reply(() => {
          callCount++;
          return [200, {
            status: { timestamp: '2024-01-01T12:00:00.000Z', error_code: 0, error_message: null, credit_count: 1 },
            data: [{ value: callCount * 10, value_classification: 'Test', timestamp: '2024-01-01T12:00:00.000Z', time_until_update: '43200' }]
          }];
        });

      const result1 = await service.getFearGreedIndex();
      const result2 = await service.getFearGreedIndex(true); // Force refresh

      expect(result1?.value).toBe(10);
      expect(result2?.value).toBe(20);
      expect(callCount).toBe(2);
    });
  });
});
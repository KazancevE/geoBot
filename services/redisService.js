const { createClient } = require('redis');

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.ttl = parseInt(process.env.REDIS_TTL) || 86400;
  }

  async connect() {
    try {
      this.client = createClient({
        socket: {
          host: process.env.REDIS_HOST || 'redis',
          port: process.env.REDIS_PORT || 6379,
          reconnectStrategy: (retries) => {
            return Math.min(retries * 100, 3000);
          }
        },
        password: process.env.REDIS_PASSWORD || undefined
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('✅ Redis подключен');
        this.isConnected = true;
      });

      await this.client.connect();
      return true;
    } catch (error) {
      console.error('❌ Ошибка подключения к Redis:', error.message);
      this.isConnected = false;
      return false;
    }
  }

  async saveUserSession(chatId, sessionData) {
    if (!this.isConnected) return null;
    
    try {
      const key = `user:${chatId}`;
      await this.client.set(key, JSON.stringify(sessionData), {
        EX: this.ttl
      });
      return true;
    } catch (error) {
      console.error('Ошибка сохранения сессии:', error);
      return false;
    }
  }

  async getUserSession(chatId) {
    if (!this.isConnected) return null;
    
    try {
      const key = `user:${chatId}`;
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Ошибка получения сессии:', error);
      return null;
    }
  }

  async deleteUserSession(chatId) {
    if (!this.isConnected) return false;
    
    try {
      const key = `user:${chatId}`;
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error('Ошибка удаления сессии:', error);
      return false;
    }
  }

  async cacheGeocode(address, geocodeResult) {
    if (!this.isConnected) return false;
    
    try {
      const key = `geocode:${address.toLowerCase().trim()}`;
      await this.client.set(key, JSON.stringify(geocodeResult), {
        EX: 604800
      });
      return true;
    } catch (error) {
      console.error('Ошибка кэширования геокода:', error);
      return false;
    }
  }

  async getCachedGeocode(address) {
    if (!this.isConnected) return null;
    
    try {
      const key = `geocode:${address.toLowerCase().trim()}`;
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Ошибка получения кэша геокода:', error);
      return null;
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.quit();
      this.isConnected = false;
      console.log('Redis отключен');
    }
  }
}

module.exports = new RedisService();
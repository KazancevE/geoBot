const { createClient } = require('redis');

class RedisService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.ttl = parseInt(process.env.REDIS_TTL) || 86400; // 24 часа по умолчанию
  }

  async connect() {
    try {
      this.client = createClient({
        socket: {
          host: process.env.REDIS_HOST || 'localhost',
          port: process.env.REDIS_PORT || 6379,
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.log('Too many retries on Redis. Connection terminated');
              return new Error('Too many retries');
            }
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

  // Сохранение сессии пользователя
  async saveUserSession(chatId, sessionData) {
    if (!this.isConnected) return null;
    
    try {
      const key = `user:${chatId}`;
      await this.client.set(key, JSON.stringify(sessionData), {
        EX: this.ttl // Время жизни в секундах
      });
      return true;
    } catch (error) {
      console.error('Ошибка сохранения сессии:', error);
      return false;
    }
  }

  // Получение сессии пользователя
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

  // Удаление сессии
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

  // Кэширование геокодированных адресов
  async cacheGeocode(address, geocodeResult) {
    if (!this.isConnected) return false;
    
    try {
      const key = `geocode:${address.toLowerCase().trim()}`;
      await this.client.set(key, JSON.stringify(geocodeResult), {
        EX: 604800 // 7 дней для кэша адресов
      });
      return true;
    } catch (error) {
      console.error('Ошибка кэширования геокода:', error);
      return false;
    }
  }

  // Получение из кэша
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

  // Статистика
  async getStats() {
    if (!this.isConnected) return null;
    
    try {
      const keys = await this.client.keys('*');
      const stats = {
        totalKeys: keys.length,
        userSessions: keys.filter(k => k.startsWith('user:')).length,
        geocodeCache: keys.filter(k => k.startsWith('geocode:')).length,
        memoryInfo: await this.client.info('memory')
      };
      return stats;
    } catch (error) {
      console.error('Ошибка получения статистики:', error);
      return null;
    }
  }

  // Очистка старых данных
  async cleanupOldSessions(maxAgeHours = 24) {
    if (!this.isConnected) return 0;
    
    try {
      const keys = await this.client.keys('user:*');
      let deleted = 0;
      
      for (const key of keys) {
        const ttl = await this.client.ttl(key);
        if (ttl < 0 || ttl > maxAgeHours * 3600) {
          await this.client.del(key);
          deleted++;
        }
      }
      
      console.log(`Очищено ${deleted} старых сессий`);
      return deleted;
    } catch (error) {
      console.error('Ошибка очистки:', error);
      return 0;
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

// Singleton экземпляр
module.exports = new RedisService();
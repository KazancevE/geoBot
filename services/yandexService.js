const axios = require('axios');

class YandexService {
  constructor() {
    // Используем разные ключи для разных сервисов
    this.apiKey = process.env.YANDEX_API_KEY || 'your_yandex_api_key_here';
    this.geocodeUrl = 'https://geocode-maps.yandex.ru/1.x/';
  }

  // Геокодирование адреса - исправленная версия
  async geocodeAddress(address) {
    try {
      console.log(`Геокодирование адреса: ${address}`);
      
      // Параметры запроса для геокодера
      const params = {
        apikey: this.apiKey,
        geocode: address,
        format: 'json',
        results: 1,
        lang: 'ru_RU'  // Язык ответа
      };
      
      console.log('Параметры запроса:', { ...params, apikey: '***' + this.apiKey.slice(-4) });

      const response = await axios.get(this.geocodeUrl, {
        params: params,
        timeout: 10000,
        headers: {
          'Accept': 'application/json',
          'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7'
        }
      });

      console.log('Статус ответа:', response.status);
      
      const data = response.data;
      
      // Проверка структуры ответа
      if (!data.response || 
          !data.response.GeoObjectCollection || 
          !data.response.GeoObjectCollection.metaData || 
          !data.response.GeoObjectCollection.metaData.GeocoderResponseMetaData) {
        console.log('Неожиданная структура ответа:', JSON.stringify(data).substring(0, 500));
        throw new Error('Неожиданный формат ответа от Яндекс API');
      }

      const found = data.response.GeoObjectCollection.metaData.GeocoderResponseMetaData.found;
      
      if (found === 0 || !data.response.GeoObjectCollection.featureMember || 
          data.response.GeoObjectCollection.featureMember.length === 0) {
        console.log('Адрес не найден, found:', found);
        throw new Error('Адрес не найден. Проверьте правильность написания.');
      }

      const feature = data.response.GeoObjectCollection.featureMember[0];
      const [lon, lat] = feature.GeoObject.Point.pos.split(' ');
      
      const result = { 
        lat: parseFloat(lat), 
        lon: parseFloat(lon),
        address: feature.GeoObject.name,
        fullAddress: feature.GeoObject.description || address,
        precision: feature.GeoObject.metaDataProperty?.GeocoderMetaData?.precision || 'unknown'
      };
      
      console.log(`✅ Геокодирование успешно: ${address} -> ${result.lat.toFixed(6)}, ${result.lon.toFixed(6)}`);
      console.log('Точность:', result.precision);
      
      return result;
      
    } catch (error) {
      console.error('❌ Ошибка геокодирования:', error.message);
      
      if (error.response) {
        console.error('Статус ошибки:', error.response.status);
        console.error('Данные ошибки:', error.response.data);
        
        // Анализ конкретных ошибок
        if (error.response.status === 403) {
          throw new Error('Неверный API ключ Яндекс. Получите новый ключ на https://developer.tech.yandex.ru/');
        } else if (error.response.status === 429) {
          throw new Error('Превышен лимит запросов к Яндекс API. Попробуйте позже.');
        } else if (error.response.status === 400) {
          throw new Error('Некорректный запрос. Проверьте формат адреса.');
        }
      }
      
      // Для разработки - тестовые координаты
      if (process.env.NODE_ENV === 'development' || !process.env.YANDEX_API_KEY) {
        console.log('⚠️  Используем тестовые координаты (Москва)');
        return this.getTestCoordinates(address);
      }
      
      throw new Error(`Не удалось геокодировать адрес: ${error.message}`);
    }
  }

  // Генерация тестовых координат для разработки
  getTestCoordinates(address) {
    // Базовая точка - Москва, Кремль
    const baseLat = 55.752023;
    const baseLon = 37.617499;
    
    // Добавляем случайное смещение для разных адресов
    const randomOffset = () => (Math.random() - 0.5) * 0.05; // ±0.05 градуса (~5.5 км)
    
    return {
      lat: baseLat + randomOffset(),
      lon: baseLon + randomOffset(),
      address: address,
      fullAddress: address + ' (тестовые координаты)',
      precision: 'test'
    };
  }

  // Альтернативный метод геокодирования через OpenStreetMap (бесплатно)
  async geocodeWithOSM(address) {
    try {
      console.log(`Пробуем геокодировать через OpenStreetMap: ${address}`);
      
      const response = await axios.get('https://nominatim.openstreetmap.org/search', {
        params: {
          q: address,
          format: 'json',
          limit: 1,
          countrycodes: 'ru', // ограничение Россией
          'accept-language': 'ru'
        },
        timeout: 10000,
        headers: {
          'User-Agent': 'CourierRouteBot/1.0 (contact@example.com)',
          'Accept': 'application/json'
        }
      });
      
      if (response.data && response.data.length > 0) {
        const result = response.data[0];
        return {
          lat: parseFloat(result.lat),
          lon: parseFloat(result.lon),
          address: result.display_name.split(',')[0],
          fullAddress: result.display_name,
          precision: 'osm'
        };
      }
      
      throw new Error('Адрес не найден в OpenStreetMap');
      
    } catch (error) {
      console.error('Ошибка геокодирования OSM:', error.message);
      throw error;
    }
  }

  // Универсальный метод геокодирования (пробует разные сервисы)
  async geocodeUniversal(address) {
    try {
      // Сначала пробуем Яндекс
      return await this.geocodeAddress(address);
    } catch (yandexError) {
      console.log('Яндекс не сработал, пробуем OpenStreetMap...');
      try {
        return await this.geocodeWithOSM(address);
      } catch (osmError) {
        console.log('OpenStreetMap не сработал, используем тестовые координаты...');
        return this.getTestCoordinates(address);
      }
    }
  }
}

module.exports = new YandexService();
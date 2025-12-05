const axios = require('axios');
const redisService = require('./redisService');

class GeocoderService {
  constructor() {
    this.yandexApiKey = process.env.YANDEX_API_KEY;
    this.yandexUrl = 'https://geocode-maps.yandex.ru/1.x/';
    this.osmUrl = 'https://nominatim.openstreetmap.org/search';
  }

  // Умный геокодер с Redis кэшированием
  async geocode(address) {
    // 1. Проверяем кэш Redis
    const cached = await redisService.getCachedGeocode(address);
    if (cached) {
      console.log(`📦 Геокод из Redis кэша: ${address}`);
      return cached;
    }

    // 2. Пробуем Яндекс API
    let result;
    if (this.yandexApiKey) {
      try {
        result = await this.geocodeYandex(address);
        result.source = 'yandex';
      } catch (yandexError) {
        console.log('Яндекс не сработал, пробуем OSM...');
        try {
          result = await this.geocodeOSM(address);
          result.source = 'osm';
        } catch (osmError) {
          result = this.getFallbackCoordinates(address);
          result.source = 'fallback';
        }
      }
    } else {
      // 3. Яндекс API нет, пробуем OSM
      try {
        result = await this.geocodeOSM(address);
        result.source = 'osm';
      } catch (error) {
        result = this.getFallbackCoordinates(address);
        result.source = 'fallback';
      }
    }

    // 4. Сохраняем в Redis кэш
    if (redisService.isConnected) {
      await redisService.cacheGeocode(address, result);
    }

    return result;
  }

  async geocodeYandex(address) {
    const response = await axios.get(this.yandexUrl, {
      params: {
        apikey: this.yandexApiKey,
        geocode: address,
        format: 'json',
        results: 1,
        lang: 'ru_RU'
      },
      timeout: 10000
    });

    const data = response.data;
    if (!data.response?.GeoObjectCollection?.featureMember?.length) {
      throw new Error('Адрес не найден');
    }

    const feature = data.response.GeoObjectCollection.featureMember[0];
    const [lon, lat] = feature.GeoObject.Point.pos.split(' ');

    return {
      lat: parseFloat(lat),
      lon: parseFloat(lon),
      address: feature.GeoObject.name,
      fullAddress: feature.GeoObject.description || address
    };
  }

  async geocodeOSM(address) {
    const response = await axios.get(this.osmUrl, {
      params: {
        q: address + ', Россия',
        format: 'json',
        limit: 1,
        addressdetails: 1,
        'accept-language': 'ru'
      },
      timeout: 10000,
      headers: {
        'User-Agent': 'CourierRouteBot/1.0'
      }
    });

    if (!response.data || response.data.length === 0) {
      throw new Error('Адрес не найден');
    }

    const result = response.data[0];
    return {
      lat: parseFloat(result.lat),
      lon: parseFloat(result.lon),
      address: result.display_name.split(',')[0],
      fullAddress: result.display_name
    };
  }

  getFallbackCoordinates(address) {
    const hash = address.split('').reduce((acc, char) => {
      return acc + char.charCodeAt(0);
    }, 0);

    const baseLat = 55.7558;
    const baseLon = 37.6173;
    const latOffset = (hash % 1000) / 10000 - 0.05;
    const lonOffset = ((hash * 7) % 1000) / 10000 - 0.05;

    return {
      lat: baseLat + latOffset,
      lon: baseLon + lonOffset,
      address: address,
      fullAddress: `${address} (примерные координаты)`
    };
  }

  // Генерация URL для Яндекс.Карт
  generateYandexMapsUrl(points, route = false) {
    if (!points || points.length === 0) return null;

    if (route && points.length > 1) {
      const waypoints = points.map(p => `${p.lon},${p.lat}`).join('~');
      return `https://yandex.ru/maps/?rtext=${waypoints}&rtt=auto`;
    } else {
      const pointsParam = points.map(p => `${p.lon},${p.lat}`).join('~');
      return `https://yandex.ru/maps/?pt=${pointsParam}&z=12&l=map`;
    }
  }
}

module.exports = new GeocoderService();
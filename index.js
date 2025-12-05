require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const redisService = require('./services/redisService');
const geocoder = require('./services/geocoderService');
const routeOptimizer = require('./services/routeOptimizer');

// Инициализация бота
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, {
  polling: true,
  request: {
    timeout: 60000
  }
});

const app = express();
app.use(express.json());

// Модель сессии
class UserSession {
  constructor(chatId) {
    this.chatId = chatId;
    this.addresses = [];
    this.couriers = [];
    this.waitingForAddress = false;
    this.waitingForCourier = false;
    this.createdAt = new Date();
    this.updatedAt = new Date();
  }
}

// Получение сессии из Redis
async function getUserSession(chatId) {
  let session = await redisService.getUserSession(chatId);
  
  if (!session) {
    session = new UserSession(chatId);
    await redisService.saveUserSession(chatId, session);
    console.log(`Создана новая сессия для ${chatId}`);
  }
  
  return session;
}

// Сохранение сессии
async function saveUserSession(chatId, session) {
  session.updatedAt = new Date();
  return await redisService.saveUserSession(chatId, session);
}

// Команды бота
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  
  const welcomeMessage = `🚚 ОПТИМИЗАТОР МАРШРУТОВ КУРЬЕРОВ

📊 Хранилище: Redis (порт 6380)
📍 Геокодирование: Яндекс API + OpenStreetMap

КОМАНДЫ:
/add_address - Добавить адрес
/add_courier - Добавить курьера  
/optimize - Построить маршруты
/status - Текущий статус
/clear - Очистить данные
/help - Справка

Данные сохраняются 24 часа.`;
  
  await bot.sendMessage(chatId, welcomeMessage);
});

bot.onText(/\/add_address/, async (msg) => {
  const chatId = msg.chat.id;
  const session = await getUserSession(chatId);
  
  session.waitingForAddress = true;
  session.waitingForCourier = false;
  await saveUserSession(chatId, session);
  
  await bot.sendMessage(chatId, 
    '📍 Введите адрес для добавления:\n\n' +
    'Примеры:\n' +
    '- Москва, Тверская улица, 10\n' +
    '- Санкт-Петербург, Невский проспект, 28\n' +
    '- ул. Ленина, 15, Екатеринбург'
  );
});

bot.onText(/\/add_courier/, async (msg) => {
  const chatId = msg.chat.id;
  const session = await getUserSession(chatId);
  
  session.waitingForCourier = true;
  session.waitingForAddress = false;
  await saveUserSession(chatId, session);
  
  await bot.sendMessage(chatId,
    '👤 Введите данные курьера:\n\n' +
    'Формат: Имя, вместимость\n\n' +
    'Примеры:\n' +
    '- Иван Петров, 50\n' +
    '- Анна Сидорова, 75\n' +
    '- Алексей, 100'
  );
});

bot.onText(/\/optimize/, async (msg) => {
  const chatId = msg.chat.id;
  const session = await getUserSession(chatId);
  
  if (session.addresses.length === 0) {
    await bot.sendMessage(chatId, '❌ Нет добавленных адресов. Используйте /add_address');
    return;
  }
  
  if (session.couriers.length === 0) {
    await bot.sendMessage(chatId, '❌ Нет добавленных курьеров. Используйте /add_courier');
    return;
  }
  
  await bot.sendMessage(chatId, '🔄 Оптимизирую маршруты...');
  
  try {
    const optimalCount = routeOptimizer.calculateOptimalCourierCount(
      session.addresses,
      session.couriers
    );
    
    const assignments = routeOptimizer.optimizeWithCapacities(
      session.addresses,
      session.couriers.slice(0, optimalCount)
    );
    
    let resultMessage = `📊 РЕЗУЛЬТАТЫ ОПТИМИЗАЦИИ\n\n`;
    resultMessage += `• Адресов: ${session.addresses.length}\n`;
    resultMessage += `• Курьеров доступно: ${session.couriers.length}\n`;
    resultMessage += `• Оптимальное количество: ${optimalCount}\n\n`;
    
    if (optimalCount < session.couriers.length) {
      resultMessage += `💡 Экономия: ${session.couriers.length - optimalCount} курьеров не нужны\n\n`;
    }
    
    const courierNames = Object.keys(assignments);
    
    for (const courierName of courierNames) {
      const addresses = assignments[courierName];
      
      if (addresses.length > 0) {
        const courier = session.couriers.find(c => c.name === courierName);
        const totalWeight = addresses.reduce((sum, a) => sum + a.weight, 0);
        
        resultMessage += `${courierName}\n`;
        resultMessage += `Заказов: ${addresses.length} | Нагрузка: ${totalWeight}/${courier?.capacity || 100}\n\n`;
        
        const route = routeOptimizer.nearestNeighborRoute(addresses);
        
        route.forEach((addr, idx) => {
          const shortAddr = addr.address.length > 30 ? addr.address.substring(0, 30) + '...' : addr.address;
          resultMessage += `${idx + 1}. ${shortAddr}\n`;
        });
        
        let totalDistance = 0;
        for (let i = 0; i < route.length - 1; i++) {
          totalDistance += routeOptimizer.calculateDistance(route[i], route[i + 1]);
        }
        
        resultMessage += `\n📏 Расстояние: ${(totalDistance / 1000).toFixed(1)} км\n`;
        resultMessage += `⏱ Время: ~${Math.round(totalDistance / 1000 * 3)} мин\n`;
        
        const mapUrl = geocoder.generateYandexMapsUrl(route, true);
        if (mapUrl) {
          resultMessage += `🗺 Маршрут: ${mapUrl}\n\n`;
        }
        
        resultMessage += `────\n\n`;
      }
    }
    
    const allPoints = session.addresses.map(a => ({ lat: a.lat, lon: a.lon }));
    const allPointsMapUrl = geocoder.generateYandexMapsUrl(allPoints);
    if (allPointsMapUrl) {
      resultMessage += `📍 Все точки: ${allPointsMapUrl}`;
    }
    
    await bot.sendMessage(chatId, resultMessage, {
      disable_web_page_preview: false
    });
    
  } catch (error) {
    console.error('Ошибка оптимизации:', error);
    await bot.sendMessage(chatId, '❌ Ошибка при оптимизации маршрутов.');
  }
});

bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const session = await getUserSession(chatId);
  
  let statusMessage = `📊 ВАШ СТАТУС\n\n`;
  statusMessage += `📍 Адресов: ${session.addresses.length}\n`;
  statusMessage += `👤 Курьеров: ${session.couriers.length}\n`;
  statusMessage += `🕐 Создано: ${session.createdAt.toLocaleString('ru-RU')}\n\n`;
  
  if (session.addresses.length > 0) {
    statusMessage += `Последние адреса:\n`;
    session.addresses.slice(-3).forEach((addr, idx) => {
      const shortAddr = addr.address.length > 25 ? addr.address.substring(0, 25) + '...' : addr.address;
      statusMessage += `${idx + 1}. ${shortAddr}\n`;
    });
  }
  
  if (session.couriers.length > 0) {
    statusMessage += `\nКурьеры:\n`;
    session.couriers.forEach((courier, idx) => {
      statusMessage += `${idx + 1}. ${courier.name} (${courier.capacity})\n`;
    });
  }
  
  statusMessage += `\n💾 Хранилище: Redis:6380`;
  
  await bot.sendMessage(chatId, statusMessage);
});

bot.onText(/\/clear/, async (msg) => {
  const chatId = msg.chat.id;
  
  await redisService.deleteUserSession(chatId);
  
  await bot.sendMessage(chatId,
    '✅ ВСЕ ДАННЫЕ ОЧИЩЕНЫ\n\n' +
    'Сессия удалена из Redis.\n' +
    'Можете начать заново с /add_address'
  );
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  
  const helpMessage = `📖 СПРАВКА ПО КОМАНДАМ

ОСНОВНЫЕ КОМАНДЫ:
/add_address - Добавить адрес доставки
/add_courier - Добавить курьера
/optimize - Построить оптимальные маршруты
/status - Показать текущие данные
/clear - Удалить все ваши данные

КАК ИСПОЛЬЗОВАТЬ:
1. Добавьте несколько адресов через /add_address
2. Добавьте курьеров через /add_courier
3. Постройте маршруты через /optimize

ОСОБЕННОСТИ:
• Данные хранятся в Redis 24 часа
• Используется кэширование адресов
• Автоматический расчет оптимального количества курьеров
• Ссылки на Яндекс.Карты для маршрутов`;
  
  await bot.sendMessage(chatId, helpMessage);
});

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
  if (msg.text?.startsWith('/')) return;
  
  const chatId = msg.chat.id;
  const text = msg.text?.trim();
  
  if (!text) return;
  
  const session = await getUserSession(chatId);
  
  // Добавление адреса
  if (session.waitingForAddress) {
    session.waitingForAddress = false;
    
    try {
      await bot.sendMessage(chatId, '📍 Определяю координаты...');
      
      const geocodeResult = await geocoder.geocode(text);
      
      session.addresses.push({
        address: text,
        lat: geocodeResult.lat,
        lon: geocodeResult.lon,
        weight: Math.floor(Math.random() * 10) + 1,
        geocodeSource: geocodeResult.source,
        addedAt: new Date()
      });
      
      await saveUserSession(chatId, session);
      
      let response = `✅ АДРЕС ДОБАВЛЕН\n\n`;
      response += `📌 Адрес: ${text}\n`;
      response += `📍 Координаты: ${geocodeResult.lat.toFixed(6)}, ${geocodeResult.lon.toFixed(6)}\n`;
      response += `⚖️ Вес: ${session.addresses[session.addresses.length - 1].weight}\n`;
      response += `🗺 Источник: ${geocodeResult.source}\n\n`;
      response += `📊 Всего адресов: ${session.addresses.length}`;
      
      await bot.sendMessage(chatId, response);
      
    } catch (error) {
      console.error('Ошибка добавления адреса:', error);
      await bot.sendMessage(chatId,
        '❌ Не удалось определить координаты.\n' +
        'Проверьте правильность адреса.\n\n' +
        'Пример: "Москва, Красная площадь, 1"'
      );
      session.waitingForAddress = true;
      await saveUserSession(chatId, session);
    }
  }
  
  // Добавление курьера
  else if (session.waitingForCourier) {
    session.waitingForCourier = false;
    
    try {
      const [name, capacity] = text.split(',').map(s => s.trim());
      
      if (!name || !capacity) {
        throw new Error('Неверный формат');
      }
      
      const capacityNum = parseInt(capacity) || 50;
      
      session.couriers.push({
        name: name,
        capacity: capacityNum,
        startLocation: { lat: 55.7558, lon: 37.6173 },
        workHours: { start: 480, end: 1020 },
        addedAt: new Date()
      });
      
      await saveUserSession(chatId, session);
      
      await bot.sendMessage(chatId,
        `✅ КУРЬЕР ДОБАВЛЕН\n\n` +
        `👤 Имя: ${name}\n` +
        `📦 Вместимость: ${capacityNum}\n\n` +
        `📊 Всего курьеров: ${session.couriers.length}`
      );
      
    } catch (error) {
      console.error('Ошибка добавления курьера:', error);
      await bot.sendMessage(chatId,
        '❌ Неверный формат. Используйте: "Имя, вместимость"\n\n' +
        'Примеры:\n' +
        '- Иван Петров, 50\n' +
        '- Анна, 75'
      );
      session.waitingForCourier = true;
      await saveUserSession(chatId, session);
    }
  }
});

// Веб-сервер для мониторинга
app.get('/health', async (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date(),
    redis: redisService.isConnected ? 'connected' : 'disconnected',
    bot: 'running',
    version: '1.0.0'
  });
});

// Инициализация
async function init() {
  console.log('🚀 Инициализация Courier Bot...');
  
  // Подключаем Redis
  const redisConnected = await redisService.connect();
  
  if (!redisConnected) {
    console.error('❌ Критическая ошибка: Redis недоступен');
    process.exit(1);
  }
  
  const PORT = process.env.PORT || 3030;
  app.listen(PORT, () => {
    console.log(`🌐 Веб-сервер запущен на порту ${PORT}`);
    console.log(`📡 Health check: http://localhost:${PORT}/health`);
  });
  
  console.log('🤖 Бот запущен и готов к работе!');
  console.log('📱 Используйте /start в Telegram');
}

init();

// Обработка завершения
process.on('SIGINT', async () => {
  console.log('\n🛑 Завершение работы...');
  await redisService.disconnect();
  process.exit(0);
});
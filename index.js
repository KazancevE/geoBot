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
  
  const welcomeMessage = `
🚚 *Оптимизатор маршрутов курьеров*

📊 *Хранилище:* Redis
📍 *Геокодирование:* ${process.env.YANDEX_API_KEY ? 'Яндекс API' : 'OpenStreetMap'}

*Команды:*
/add_address - Добавить адрес
/add_courier - Добавить курьера  
/optimize - Построить маршруты
/status - Текущий статус
/clear - Очистить данные
/stats - Статистика Redis
/help - Справка

Данные сохраняются 24 часа.
  `;
  
  await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
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
    '• Москва, Тверская улица, 10\n' +
    '• Санкт-Петербург, Невский проспект, 28\n' +
    '• ул. Ленина, 15, Екатеринбург'
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
    'Формат: *Имя, вместимость*\n\n' +
    'Примеры:\n' +
    '• Иван Петров, 50\n' +
    '• Анна Сидорова, 75\n' +
    '• Алексей, 100'
  , { parse_mode: 'Markdown' });
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
    
    let resultMessage = `📊 *Результаты оптимизации*\n\n`;
    resultMessage += `• Адресов: ${session.addresses.length}\n`;
    resultMessage += `• Курьеров: ${session.couriers.length}\n`;
    resultMessage += `• Используется: ${optimalCount}\n\n`;
    
    if (optimalCount < session.couriers.length) {
      resultMessage += `💡 *Экономия:* ${session.couriers.length - optimalCount} курьеров не нужны\n\n`;
    }
    
    const courierNames = Object.keys(assignments);
    
    for (const courierName of courierNames) {
      const addresses = assignments[courierName];
      
      if (addresses.length > 0) {
        const courier = session.couriers.find(c => c.name === courierName);
        const totalWeight = addresses.reduce((sum, a) => sum + a.weight, 0);
        
        resultMessage += `*${courierName}*\n`;
        resultMessage += `Заказов: ${addresses.length} | Нагрузка: ${totalWeight}/${courier?.capacity || 100}\n\n`;
        
        const route = routeOptimizer.nearestNeighborRoute(addresses);
        
        route.forEach((addr, idx) => {
          resultMessage += `${idx + 1}. ${addr.address.substring(0, 30)}${addr.address.length > 30 ? '...' : ''}\n`;
        });
        
        let totalDistance = 0;
        for (let i = 0; i < route.length - 1; i++) {
          totalDistance += routeOptimizer.calculateDistance(route[i], route[i + 1]);
        }
        
        resultMessage += `\n📏 *Расстояние:* ${(totalDistance / 1000).toFixed(1)} км\n`;
        resultMessage += `⏱ *Время:* ~${Math.round(totalDistance / 1000 * 3)} мин\n`;
        
        const mapUrl = geocoder.generateYandexMapsUrl(route, true);
        if (mapUrl) {
          resultMessage += `[🗺 Маршрут на карте](${mapUrl})\n\n`;
        }
        
        resultMessage += `────\n\n`;
      }
    }
    
    const allPoints = session.addresses.map(a => ({ lat: a.lat, lon: a.lon }));
    const allPointsMapUrl = geocoder.generateYandexMapsUrl(allPoints);
    if (allPointsMapUrl) {
      resultMessage += `[📍 Все точки на карте](${allPointsMapUrl})`;
    }
    
    await bot.sendMessage(chatId, resultMessage, {
      parse_mode: 'Markdown',
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
  
  let statusMessage = `📊 *Ваш статус*\n\n`;
  statusMessage += `📍 Адресов: ${session.addresses.length}\n`;
  statusMessage += `👤 Курьеров: ${session.couriers.length}\n`;
  statusMessage += `🕐 Создано: ${session.createdAt.toLocaleString('ru-RU')}\n`;
  statusMessage += `✏️ Обновлено: ${session.updatedAt.toLocaleString('ru-RU')}\n\n`;
  
  if (session.addresses.length > 0) {
    statusMessage += `*Последние адреса:*\n`;
    session.addresses.slice(-3).forEach((addr, idx) => {
      statusMessage += `${idx + 1}. ${addr.address.substring(0, 25)}${addr.address.length > 25 ? '...' : ''}\n`;
    });
  }
  
  if (session.couriers.length > 0) {
    statusMessage += `\n*Курьеры:*\n`;
    session.couriers.forEach((courier, idx) => {
      statusMessage += `${idx + 1}. ${courier.name} (${courier.capacity})\n`;
    });
  }
  
  statusMessage += `\n💾 *Хранилище:* Redis`;
  
  await bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
});

bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  
  if (!redisService.isConnected) {
    await bot.sendMessage(chatId, '❌ Redis не подключен');
    return;
  }
  
  try {
    const stats = await redisService.getStats();
    
    let statsMessage = `📈 *Статистика Redis*\n\n`;
    statsMessage += `🔑 Всего ключей: ${stats?.totalKeys || 0}\n`;
    statsMessage += `👤 Сессий пользователей: ${stats?.userSessions || 0}\n`;
    statsMessage += `📍 Кэш адресов: ${stats?.geocodeCache || 0}\n`;
    
    if (stats?.memoryInfo) {
      const memory = stats.memoryInfo.split('\n').find(l => l.startsWith('used_memory_human'));
      if (memory) {
        statsMessage += `💾 Используемая память: ${memory.split(':')[1].trim()}\n`;
      }
    }
    
    statsMessage += `\n⏱ TTL сессий: ${process.env.REDIS_TTL || 86400} сек\n`;
    statsMessage += `✅ Статус: Подключен`;
    
    await bot.sendMessage(chatId, statsMessage, { parse_mode: 'Markdown' });
    
  } catch (error) {
    console.error('Ошибка получения статистики:', error);
    await bot.sendMessage(chatId, '❌ Ошибка получения статистики');
  }
});

bot.onText(/\/clear/, async (msg) => {
  const chatId = msg.chat.id;
  
  await redisService.deleteUserSession(chatId);
  
  await bot.sendMessage(chatId,
    '✅ *Все данные очищены!*\n\n' +
    'Сессия удалена из Redis.\n' +
    'Можете начать заново с /add_address'
  , { parse_mode: 'Markdown' });
});

bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  
  const helpMessage = `
📖 *Справка по командам*

*Основные команды:*
/add_address - Добавить адрес доставки
/add_courier - Добавить курьера
/optimize - Построить оптимальные маршруты
/status - Показать текущие данные
/clear - Удалить все ваши данные
/stats - Статистика Redis

*Как использовать:*
1. Добавьте несколько адресов через /add_address
2. Добавьте курьеров через /add_courier
3. Постройте маршруты через /optimize

*Особенности:*
• Данные хранятся в Redis 24 часа
• Используется кэширование адресов
• Автоматический расчет оптимального количества курьеров
• Ссылки на Яндекс.Карты для маршрутов
  `;
  
  await bot.sendMessage(chatId, helpMessage, { parse_mode: 'Markdown' });
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
      
      let response = `✅ *Адрес добавлен!*\n\n`;
      response += `📌 *Адрес:* ${text}\n`;
      response += `📍 *Координаты:* ${geocodeResult.lat.toFixed(6)}, ${geocodeResult.lon.toFixed(6)}\n`;
      response += `⚖️ *Вес:* ${session.addresses[session.addresses.length - 1].weight}\n`;
      response += `🗺 *Источник:* ${geocodeResult.source}\n\n`;
      response += `📊 *Всего адресов:* ${session.addresses.length}`;
      
      await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
      
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
        `✅ *Курьер добавлен!*\n\n` +
        `👤 *Имя:* ${name}\n` +
        `📦 *Вместимость:* ${capacityNum}\n\n` +
        `📊 *Всего курьеров:* ${session.couriers.length}`
      , { parse_mode: 'Markdown' });
      
    } catch (error) {
      console.error('Ошибка добавления курьера:', error);
      await bot.sendMessage(chatId,
        '❌ Неверный формат. Используйте: "Имя, вместимость"\n\n' +
        'Примеры:\n' +
        '• Иван Петров, 50\n' +
        '• Анна, 75'
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
    sessions: (await redisService.getStats())?.userSessions || 0,
    bot: 'running'
  });
});

app.get('/admin/stats', async (req, res) => {
  if (req.query.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  
  const stats = await redisService.getStats();
  res.json(stats);
});

// Очистка при запуске
setInterval(async () => {
  if (redisService.isConnected) {
    await redisService.cleanupOldSessions(24); // Очистка сессий старше 24 часов
  }
}, 3600000); // Каждый час

// Инициализация
async function init() {
  console.log('🚀 Инициализация бота...');
  
  // Подключаем Redis
  const redisConnected = await redisService.connect();
  
  if (!redisConnected) {
    console.warn('⚠️ Redis не подключен, используем память');
    // Можно добавить fallback на память
  }
  
  const PORT = process.env.PORT || 3000;
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
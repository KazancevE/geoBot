require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const mongoose = require('mongoose');
const yandexService = require('./services/yandexService');
const routeOptimizer = require('./services/routeOptimizer');
const {
  handleStart,
  handleAddAddress,
  handleAddCourier,
  handleOptimize,
  handleClear,
  handleShowStatus
} = require('./handlers/commandHandlers');

// Инициализация бота
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
const app = express();
app.use(express.json());

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/courier_bot', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

// Модели данных
const UserSession = mongoose.model('UserSession', {
  chatId: Number,
  addresses: [{
    address: String,
    lat: Number,
    lon: Number,
    orderId: String,
    timeWindow: { start: Number, end: Number },
    weight: Number,
    createdAt: { type: Date, default: Date.now }
  }],
  couriers: [{
    name: String,
    capacity: Number,
    startLocation: { lat: Number, lon: Number },
    endLocation: { lat: Number, lon: Number },
    workHours: { start: Number, end: Number }
  }],
  createdAt: { type: Date, default: Date.now }
});

// Хранилище сессий пользователей (в продакшене лучше использовать Redis)
const userSessions = new Map();

// Получение или создание сессии пользователя
async function getUserSession(chatId) {
  let session = userSessions.get(chatId);
  if (!session) {
    session = await UserSession.findOne({ chatId }) || new UserSession({ chatId, addresses: [], couriers: [] });
    userSessions.set(chatId, session);
  }
  return session;
}

// Сохранение сессии
async function saveUserSession(chatId) {
  const session = userSessions.get(chatId);
  if (session) {
    await session.save();
  }
}

// Команды бота
bot.onText(/\/start/, async (msg) => {
  await handleStart(bot, msg, getUserSession);
});

bot.onText(/\/add_address/, async (msg) => {
  await handleAddAddress(bot, msg, getUserSession, saveUserSession);
});

bot.onText(/\/add_courier/, async (msg) => {
  await handleAddCourier(bot, msg, getUserSession, saveUserSession);
});

bot.onText(/\/optimize/, async (msg) => {
  await handleOptimize(bot, msg, getUserSession, yandexService, routeOptimizer);
});

bot.onText(/\/clear/, async (msg) => {
  await handleClear(bot, msg, getUserSession, saveUserSession);
});

bot.onText(/\/status/, async (msg) => {
  await handleShowStatus(bot, msg, getUserSession);
});

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const session = await getUserSession(chatId);
  
  // Если пользователь в процессе добавления адреса
  if (session.waitingForAddress) {
    session.waitingForAddress = false;
    
    try {
      // Геокодирование адреса через Яндекс API
      const coords = await yandexService.geocodeAddress(msg.text);
      
      session.addresses.push({
        address: msg.text,
        lat: coords.lat,
        lon: coords.lon,
        orderId: `order_${Date.now()}`,
        timeWindow: { start: 480, end: 1020 }, // 8:00-17:00 по умолчанию
        weight: 5 // вес по умолчанию
      });
      
      await saveUserSession(chatId);
      bot.sendMessage(chatId, `✅ Адрес добавлен:\n${msg.text}\nКоординаты: ${coords.lat}, ${coords.lon}`);
    } catch (error) {
      bot.sendMessage(chatId, '❌ Ошибка при геокодировании адреса. Проверьте правильность адреса.');
    }
  }
  
  // Если пользователь в процессе добавления курьера
  else if (session.waitingForCourier) {
    session.waitingForCourier = false;
    
    try {
      const [name, capacity] = msg.text.split(',');
      session.couriers.push({
        name: name.trim(),
        capacity: parseInt(capacity.trim()) || 100,
        startLocation: { lat: 55.7558, lon: 37.6173 }, // Москва по умолчанию
        endLocation: { lat: 55.7558, lon: 37.6173 },
        workHours: { start: 480, end: 1020 } // 8:00-17:00
      });
      
      await saveUserSession(chatId);
      bot.sendMessage(chatId, `✅ Курьер добавлен:\nИмя: ${name.trim()}\nВместимость: ${capacity.trim()}`);
    } catch (error) {
      bot.sendMessage(chatId, '❌ Ошибка при добавлении курьера. Формат: "Имя, вместимость"');
    }
  }
});

// Веб-сервер для проверки работоспособности
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date() });
});

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
});

console.log('🤖 Бот запущен...');
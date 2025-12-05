// Обработчик команды /start
async function handleStart(bot, msg, getUserSession) {
  const chatId = msg.chat.id;
  
  const welcomeMessage = `
🚚 *Оптимизатор маршрутов курьеров*

*Доступные команды:*
/add_address - Добавить адрес доставки
/add_courier - Добавить курьера
/optimize - Построить оптимальные маршруты
/status - Показать текущий статус
/clear - Очистить все данные

*Пример использования:*
1. Добавьте адреса через /add_address
2. Добавьте курьеров через /add_courier
3. Постройте маршруты через /optimize

Бот использует Яндекс API для построения оптимальных маршрутов!
  `;
  
  await bot.sendMessage(chatId, welcomeMessage, { parse_mode: 'Markdown' });
}

// Обработчик команды /add_address
async function handleAddAddress(bot, msg, getUserSession, saveUserSession) {
  const chatId = msg.chat.id;
  const session = await getUserSession(chatId);
  
  session.waitingForAddress = true;
  await saveUserSession(chatId);
  
  bot.sendMessage(chatId, 'Введите адрес для добавления (например: "Москва, Тверская 10"):');
}

// Обработчик команды /add_courier
async function handleAddCourier(bot, msg, getUserSession, saveUserSession) {
  const chatId = msg.chat.id;
  const session = await getUserSession(chatId);
  
  session.waitingForCourier = true;
  await saveUserSession(chatId);
  
  bot.sendMessage(chatId, 'Введите данные курьера в формате: "Имя, вместимость"\nПример: "Иван, 50" (вместимость в условных единицах)');
}

// Обработчик команды /optimize
async function handleOptimize(bot, msg, getUserSession, yandexService, routeOptimizer) {
  const chatId = msg.chat.id;
  const session = await getUserSession(chatId);
  
  if (session.addresses.length === 0) {
    bot.sendMessage(chatId, '❌ Нет добавленных адресов. Используйте /add_address');
    return;
  }
  
  if (session.couriers.length === 0) {
    bot.sendMessage(chatId, '❌ Нет добавленных курьеров. Используйте /add_courier');
    return;
  }
  
  bot.sendMessage(chatId, '🔄 Рассчитываю оптимальные маршруты...');
  
  try {
    // Определяем оптимальное количество курьеров
    const optimalCount = routeOptimizer.calculateOptimalCourierCount(
      session.addresses,
      session.couriers
    );
    
    // Распределяем адреса между курьерами
    const assignments = routeOptimizer.optimizeWithCapacities(
      session.addresses,
      session.couriers.slice(0, optimalCount)
    );
    
    let resultMessage = `📊 *Результаты оптимизации*\n\n`;
    resultMessage += `Всего адресов: ${session.addresses.length}\n`;
    resultMessage += `Курьеров доступно: ${session.couriers.length}\n`;
    resultMessage += `Оптимальное количество курьеров: ${optimalCount}\n\n`;
    
    // Строим маршруты для каждого курьера
    const courierNames = Object.keys(assignments);
    
    for (const courierName of courierNames) {
      const addresses = assignments[courierName];
      
      if (addresses.length > 0) {
        resultMessage += `*${courierName}* (${addresses.length} адресов):\n`;
        
        // Для каждого курьера строим оптимальный маршрут
        const route = routeOptimizer.nearestNeighborRoute(addresses);
        
        route.forEach((addr, index) => {
          resultMessage += `${index + 1}. ${addr.address}\n`;
        });
        
        // Рассчитываем общее расстояние
        let totalDistance = 0;
        for (let i = 0; i < route.length - 1; i++) {
          totalDistance += routeOptimizer.calculateDistance(route[i], route[i + 1]);
        }
        
        resultMessage += `📏 Примерное расстояние: ${(totalDistance / 1000).toFixed(2)} км\n`;
        resultMessage += `⏱ Примерное время: ${Math.round(totalDistance / 1000 * 3)} мин\n\n`;
      }
    }
    
    // Рекомендации по оптимизации
    if (optimalCount < session.couriers.length) {
      resultMessage += `💡 *Рекомендация:* Можно использовать только ${optimalCount} курьеров из ${session.couriers.length} для экономии ресурсов.\n`;
    }
    
    // Добавляем ссылку на Яндекс.Карты
    const yandexMapsUrl = await generateYandexMapsUrl(assignments);
    if (yandexMapsUrl) {
      resultMessage += `\n🗺 [Открыть маршруты в Яндекс.Картах](${yandexMapsUrl})`;
    }
    
    bot.sendMessage(chatId, resultMessage, { 
      parse_mode: 'Markdown',
      disable_web_page_preview: true 
    });
    
  } catch (error) {
    console.error('Ошибка оптимизации:', error);
    bot.sendMessage(chatId, '❌ Произошла ошибка при оптимизации маршрутов.');
  }
}

// Генерация URL для Яндекс.Карт
async function generateYandexMapsUrl(assignments) {
  try {
    const points = [];
    Object.values(assignments).forEach(addresses => {
      addresses.forEach(addr => {
        points.push(`${addr.lat},${addr.lon}`);
      });
    });
    
    if (points.length === 0) return null;
    
    return `https://yandex.ru/maps/?pt=${points.join('~')}&z=12&l=map`;
  } catch (error) {
    return null;
  }
}

// Обработчик команды /clear
async function handleClear(bot, msg, getUserSession, saveUserSession) {
  const chatId = msg.chat.id;
  const session = await getUserSession(chatId);
  
  session.addresses = [];
  session.couriers = [];
  session.waitingForAddress = false;
  session.waitingForCourier = false;
  
  await saveUserSession(chatId);
  
  bot.sendMessage(chatId, '✅ Все данные очищены. Можно начать заново!');
}

// Обработчик команды /status
async function handleShowStatus(bot, msg, getUserSession) {
  const chatId = msg.chat.id;
  const session = await getUserSession(chatId);
  
  let statusMessage = `📊 *Текущий статус*\n\n`;
  statusMessage += `📍 Адресов: ${session.addresses.length}\n`;
  statusMessage += `🚴 Курьеров: ${session.couriers.length}\n\n`;
  
  if (session.addresses.length > 0) {
    statusMessage += `*Последние адреса:*\n`;
    session.addresses.slice(-5).forEach(addr => {
      statusMessage += `• ${addr.address}\n`;
    });
  }
  
  if (session.couriers.length > 0) {
    statusMessage += `\n*Курьеры:*\n`;
    session.couriers.forEach(courier => {
      statusMessage += `• ${courier.name} (вместимость: ${courier.capacity})\n`;
    });
  }
  
  bot.sendMessage(chatId, statusMessage, { parse_mode: 'Markdown' });
}

module.exports = {
  handleStart,
  handleAddAddress,
  handleAddCourier,
  handleOptimize,
  handleClear,
  handleShowStatus
};
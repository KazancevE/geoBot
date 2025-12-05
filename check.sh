#!/bin/bash

echo "🔍 ПРОВЕРКА РАБОТЫ"

# Проверка Redis
echo "1. Проверка Redis..."
docker exec courier-bot-redis redis-cli -a $REDIS_PASSWORD ping

# Проверка бота
echo ""
echo "2. Проверка бота..."
curl -s http://localhost:3000/health

# Статистика
echo ""
echo "3. Статистика Redis..."
docker exec courier-bot-redis redis-cli -a $REDIS_PASSWORD info memory | grep -E "used_memory|maxmemory"

echo ""
echo "4. Контейнеры..."
docker ps --filter "name=courier"
#!/bin/bash

echo "🚀 ЗАПУСК COURIER BOT"

# Создаем папки если их нет
mkdir -p logs data

# Проверяем порт 6380
if lsof -Pi :6380 -sTCP:LISTEN -t >/dev/null ; then
    echo "❌ Порт 6380 уже занят"
    exit 1
fi

# Генерация пароля если не указан
if [ -z "$REDIS_PASSWORD" ]; then
    export REDIS_PASSWORD=$(openssl rand -base64 32)
    echo "🔐 Сгенерирован пароль Redis: $REDIS_PASSWORD"
    echo "REDIS_PASSWORD=$REDIS_PASSWORD" >> .env
fi

# Запуск
echo "📦 Сборка и запуск контейнеров..."
docker compose up -d --build

echo ""
echo "✅ ЗАПУЩЕНО УСПЕШНО!"
echo "📊 Redis: localhost:6380 (пароль: $REDIS_PASSWORD)"
echo "🤖 Бот: http://localhost:3030/health"
echo "📝 Логи: docker logs courier-bot -f"
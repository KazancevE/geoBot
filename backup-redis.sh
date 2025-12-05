#!/bin/bash

BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/redis_backup_$DATE.rdb"

mkdir -p $BACKUP_DIR

echo "💾 БЭКАП REDIS..."
docker exec courier-bot-redis redis-cli -a $REDIS_PASSWORD save

docker cp courier-bot-redis:/data/dump.rdb $BACKUP_FILE

echo "✅ Бэкап создан: $BACKUP_FILE"
echo "📦 Размер: $(du -h $BACKUP_FILE | cut -f1)"
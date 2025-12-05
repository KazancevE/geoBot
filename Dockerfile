FROM node:18-alpine AS builder

WORKDIR /app

# Копируем package.json
COPY package*.json ./

# Устанавливаем зависимости
RUN npm ci --only=production

FROM node:18-alpine

WORKDIR /app

# Копируем зависимости
COPY --from=builder /app/node_modules ./node_modules

# Копируем исходный код
COPY . .

# Создаем пользователя без привилегий
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001 && \
    chown -R nodejs:nodejs /app

USER nodejs

# Открываем порт
EXPOSE 3000

# Запускаем бота
CMD ["node", "index.js"]
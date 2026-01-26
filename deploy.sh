#!/bin/bash

set -e  # 에러 발생 시 스크립트 중단

APP_NAME="cistory"
PORT=3000

echo "🚀 Starting deployment..."

# 1. Git pull
echo "📥 Pulling latest changes..."
git pull origin main

# 2. Install dependencies
echo "📦 Installing dependencies..."
yarn install

# 3. Run database migrations
echo "🛠️  Running database migrations..."
mkdir -p data
yarn db:migrate

# 4. Build the application
echo "🔨 Building application..."
yarn build

# 5. Restart PM2
echo "♻️  Restarting PM2 process..."
if pm2 describe $APP_NAME > /dev/null 2>&1; then
    pm2 restart $APP_NAME
else
    pm2 start yarn --name $APP_NAME -- start --hostname 0.0.0.0 --port $PORT
fi

# 6. Save PM2 process list
pm2 save

# 7. Check status
echo "✅ Deployment complete!"
pm2 status $APP_NAME

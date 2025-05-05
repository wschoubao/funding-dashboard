# Stage 1: build the TypeScript app
FROM node:18-alpine AS builder

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 lockfile，安装依赖
COPY package.json package-lock.json* tsconfig.json ./
RUN npm ci

# 复制源码、静态文件和数据目录（如果已有初始数据）
COPY src ./src
COPY public ./public
COPY data ./data

# 编译 TypeScript
RUN npm run build


# Stage 2: 运行时环境
FROM node:18-alpine
WORKDIR /app

# 只复制最小运行时文件
COPY package.json package-lock.json* ./
ENV NODE_ENV=production
RUN npm ci --production

# 从 builder 中拿到编译输出、静态资源和数据目录
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY --from=builder /app/data ./data

# 设置时区为上海（可选）
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone

EXPOSE 3000

# 启动服务（会自动触发 fetchFunding 定时任务）
CMD ["node", "dist/index.js"]

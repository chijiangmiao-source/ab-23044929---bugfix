# syntax=docker/dockerfile:1

# ---------- 构建阶段：安装全部依赖并产出静态文件 ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# ---------- 运行阶段：仅 Node + 静态文件 + 极简静态服务器 ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0
COPY package.json ./
COPY server ./server
COPY --from=build /app/dist ./dist
EXPOSE 8080
# 容器级 HTTP 健康检查（与 Compose 中的 healthcheck 等价声明）
HEALTHCHECK --interval=5s --timeout=3s --start-period=3s --retries=12 \
  CMD node server/healthcheck.mjs
CMD ["node", "server/server.mjs"]

# ---------- 验证阶段：测试 + 类型检查/构建 + 需求核查 + HTTP 冒烟 ----------
# 由 Compose 中的一次性服务 verify 使用；运行时镜像本身不含开发依赖。
FROM node:20-alpine AS verify
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
COPY scripts ./scripts
# 实际命令（含对 web 服务的 HTTP 冒烟）由 docker-compose.yml 注入。
CMD ["npm", "test"]

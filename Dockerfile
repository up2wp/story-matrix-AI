FROM node:24-alpine AS deps
WORKDIR /app

COPY package*.json ./
COPY server/package*.json ./server/
RUN npm ci && cd server && npm ci

FROM node:24-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/server/node_modules ./server/node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3001

COPY package*.json ./
COPY server/package*.json ./server/
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server/dist ./server/dist
RUN cd server && npm ci --omit=dev && npm cache clean --force

EXPOSE 3001
VOLUME ["/app/server/data"]
CMD ["node", "server/dist/index.js"]

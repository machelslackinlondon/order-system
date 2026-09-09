FROM node:24-alpine AS dependencies

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/concurrency/package.json packages/concurrency/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/events/package.json packages/events/package.json
COPY packages/locks/package.json packages/locks/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/retries/package.json packages/retries/package.json

RUN npm ci --omit=dev --workspace @order-system/api

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/api/src apps/api/src
COPY packages/database/package.json packages/database/package.json
COPY packages/database/migrations packages/database/migrations
COPY packages/database/scripts packages/database/scripts
COPY packages/database/src packages/database/src
COPY packages/events/package.json packages/events/package.json
COPY packages/events/src packages/events/src
COPY packages/queue/package.json packages/queue/package.json
COPY packages/queue/src packages/queue/src

USER node
EXPOSE 3000

CMD ["node", "apps/api/src/server.js"]

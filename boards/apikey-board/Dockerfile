FROM node:20-alpine AS base

RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app

ARG BOARD_BASE_PATH=/boards/apikey
ARG REFRESH_DEFAULT_SECONDS=30

ENV NODE_ENV=production
ENV BOARD_BASE_PATH=${BOARD_BASE_PATH}
ENV REFRESH_DEFAULT_SECONDS=${REFRESH_DEFAULT_SECONDS}

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

CMD ["node", "server.js"]

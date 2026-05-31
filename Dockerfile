# syntax=docker/dockerfile:1

FROM node:lts-bookworm-slim AS deps
WORKDIR /app

ENV NODE_OPTIONS="--max_old_space_size=4096"
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

FROM node:lts-bookworm-slim AS build
WORKDIR /app

ARG GIT_COMMIT=unknown
ARG GIT_VERSION=unknown

ENV NODE_OPTIONS="--max_old_space_size=4096"
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:lts-bookworm-slim AS run

ARG GIT_COMMIT=unknown
ARG GIT_VERSION=unknown

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV SERVER_BE=/be
ENV SERVER_STATIC=/static
ENV SERVER_INTERNAL_BE=http://sparkle-api:1323
ENV SERVER_INTERNAL_STATIC=http://sparkle-api:1323/static
ENV PUBLIC_DISCORD_CLIENT_ID=

WORKDIR /app

LABEL org.opencontainers.image.title="Sparkle Next" \
	org.opencontainers.image.revision=$GIT_COMMIT \
	org.opencontainers.image.version=$GIT_VERSION

RUN groupadd --system --gid 1001 nodejs \
	&& useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/package.json ./package.json

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]

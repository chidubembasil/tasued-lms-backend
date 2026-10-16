# syntax=docker/dockerfile:1
# ---------- Base ----------
FROM node:22-bookworm-slim AS base

RUN corepack enable
WORKDIR /app


# ---------- Development (hot reload, used by docker-compose.dev.yml) ----------
FROM base AS development

ENV NODE_ENV=development

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile

COPY . .

# placeholder so prisma.config.ts can load; no database is contacted by generate
ENV DATABASE_URL="postgresql://user:password@localhost:5432/placeholder"
RUN pnpm exec prisma generate

EXPOSE 3000

CMD ["pnpm", "start:dev"]


# ---------- Build ----------
FROM base AS build

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN pnpm install --frozen-lockfile

COPY . .

# placeholder so prisma.config.ts can load; no database is contacted by generate
ENV DATABASE_URL="postgresql://user:password@localhost:5432/placeholder"

# Generate Prisma Client using your Prisma 7 configuration
RUN pnpm exec prisma generate

# Compile NestJS
RUN pnpm build


# ---------- Production dependencies ----------
FROM base AS production-deps

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN pnpm install --prod --frozen-lockfile


# ---------- Production runtime (keep this the LAST stage so it is the default build) ----------
FROM node:22-bookworm-slim AS production

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Production dependencies
COPY --from=production-deps /app/node_modules ./node_modules

# Application output (the Prisma client is generated into src/generated and compiled into dist)
COPY --from=build /app/dist ./dist

# Package metadata
COPY package.json ./

# Run as a non-root user
USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]
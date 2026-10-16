
# syntax=docker/dockerfile:1

# ---------- Dependencies and build ----------
FROM node:22-bookworm-slim AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Generate Prisma Client using your Prisma 7 configuration
RUN pnpm exec prisma generate

# Compile NestJS
RUN pnpm build


# ---------- Production dependencies ----------
FROM node:22-bookworm-slim AS production-deps

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile


# ---------- Runtime ----------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Production dependencies
COPY --from=production-deps /app/node_modules ./node_modules

# Generated Prisma Client
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma

# Application output
COPY --from=build /app/dist ./dist

# Package metadata
COPY package.json ./

# Run as a non-root user
USER node

EXPOSE 3000

CMD ["node", "dist/main.js"]

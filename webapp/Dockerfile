# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apk add --no-cache python3 make g++

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the application
RUN pnpm build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Install pnpm, python3 for scripts, and build tools for native modules
RUN corepack enable && corepack prepare pnpm@latest --activate \
    && apk add --no-cache python3 py3-pip make g++

ENV NODE_ENV=production

# Copy built application
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# Create public directory (Next.js requires it even if empty)
RUN mkdir -p ./public

# Copy package.json for better-sqlite3 installation
COPY --from=builder /app/package.json ./package.json

# Install better-sqlite3 with native rebuild for Alpine
RUN pnpm add better-sqlite3 --ignore-scripts=false

# Copy defaults
COPY --from=builder /app/defaults ./defaults

# Create directories for mounted volumes
RUN mkdir -p /app/storage /app/frozen /app/diff_archives /app/scripts /app/data /app/logs

EXPOSE 3000

CMD ["node", "server.js"]

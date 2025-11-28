# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

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

# Install pnpm and python3 for scripts
RUN corepack enable && corepack prepare pnpm@latest --activate \
    && apk add --no-cache python3 py3-pip

ENV NODE_ENV=production

# Copy built application
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Create directories for mounted volumes
RUN mkdir -p /app/storage /app/frozen /app/diff_archives /app/scripts /app/data /app/logs

EXPOSE 3000

CMD ["node", "server.js"]

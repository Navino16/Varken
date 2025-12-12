# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY tsconfig.json ./
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:22-alpine AS production

# Build arguments for versioning
ARG VERSION="2.0.0"
ARG BRANCH="develop"
ARG BUILD_DATE=""

# Environment variables
ENV NODE_ENV="production" \
    CONFIG_FOLDER="/config" \
    DATA_FOLDER="/data" \
    LOG_FOLDER="/logs" \
    LOG_LEVEL="info" \
    TZ="UTC" \
    HEALTH_PORT="9090" \
    HEALTH_ENABLED="true"

# Labels
LABEL maintainer="navino16" \
    org.opencontainers.image.created="${BUILD_DATE}" \
    org.opencontainers.image.url="https://github.com/Navino16/Varken" \
    org.opencontainers.image.source="https://github.com/Navino16/Varken" \
    org.opencontainers.image.version="${VERSION}" \
    org.opencontainers.image.vendor="navino16" \
    org.opencontainers.image.title="varken" \
    org.opencontainers.image.description="Standalone application to aggregate data from the Plex ecosystem into time-series databases" \
    org.opencontainers.image.licenses="MIT"

WORKDIR /app

# Install timezone data
RUN apk add --no-cache tzdata

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy example config
COPY config/varken.example.yaml /app/config/

# Create volumes directories
RUN mkdir -p /config /data /logs

# Use existing node user (uid 1000, gid 1000) for security
RUN chown -R node:node /app /config /data /logs

USER node

# Volumes for persistent data
VOLUME ["/config", "/data", "/logs"]

# Expose health check port
EXPOSE 9090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget -q -O /dev/null http://localhost:9090/health || exit 1

# Start application
CMD ["node", "dist/index.js"]

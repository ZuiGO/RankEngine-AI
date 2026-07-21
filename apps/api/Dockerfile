# Multi-stage production build for Node API
FROM node:20-alpine AS builder
WORKDIR /app

# bcrypt native addon requires build tools on Alpine
RUN apk add --no-cache python3 make g++

# Copy root configurations and workspace declarations for all packages in the monorepo
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install build dependencies
RUN npm ci --workspace=packages/shared-types --workspace=apps/api

# Copy source files
COPY packages/shared-types ./packages/shared-types
COPY apps/api ./apps/api

# Build shared-types first, then the API server
RUN npm run build --workspace=packages/shared-types
RUN npm run build --workspace=apps/api

# Production Runner
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# bcrypt is a native addon — needs python3 + make + g++ to compile from source on Alpine
RUN apk add --no-cache python3 make g++

# Copy root package files and workspace definitions
COPY package.json package-lock.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

# Install only production dependencies
RUN npm ci --omit=dev --workspace=packages/shared-types --workspace=apps/api

# Copy built code
COPY --from=builder /app/packages/shared-types/dist ./packages/shared-types/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

EXPOSE 3000

CMD ["node", "apps/api/dist/index.js"]

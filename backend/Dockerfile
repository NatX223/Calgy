# Build context = repo root (packages/ must be in it):
#   docker build -f backend/Dockerfile .
# deploy/docker-compose.yml does this for you.

# ——— Build: bundle src/ + packages/shared + packages/engine into dist/index.js ———
FROM node:22-slim AS build
WORKDIR /repo
# Every workspace's package.json, so npm ci can read the root lockfile; only the backend's deps install.
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY frontend/package.json frontend/
COPY firebase/package.json firebase/
RUN npm ci -w backend --include-workspace-root=false --ignore-scripts
COPY packages packages
COPY backend backend
RUN npm run typecheck -w backend && npm run build -w backend

# ——— Runtime: production deps + the bundle, non-root ———
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY frontend/package.json frontend/
COPY firebase/package.json firebase/
RUN npm ci -w backend --include-workspace-root=false --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /repo/backend/dist backend/dist
WORKDIR /app/backend
USER node
EXPOSE 8080
CMD ["node", "--enable-source-maps", "dist/index.js"]

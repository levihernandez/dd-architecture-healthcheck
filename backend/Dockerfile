# Build context is the repo root (npm workspaces hoist deps to the root
# node_modules), so this is invoked as:
#   docker build -f backend/Dockerfile .

FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
RUN npm ci
COPY backend/src ./backend/src
COPY backend/tsconfig.json ./backend/tsconfig.json
RUN npm run build --workspace=backend

# Separate deps stage (own copy of build tools) so the runtime image below
# doesn't ship a C++ toolchain just to get better-sqlite3's native binding.
FROM node:20-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
RUN npm ci --omit=dev

FROM node:20-slim AS runtime
WORKDIR /app/backend
ENV NODE_ENV=production
COPY --from=deps /app/node_modules /app/node_modules
COPY --from=builder /app/backend/dist ./dist
COPY backend/package.json ./package.json
# ./data is a volume mount (SQLite file lives on the host, not baked into
# the image), ./logs is stdout-collected by the Datadog Agent via container
# log autodiscovery, and ./prompts is a volume mount for the host-editable AI
# prompt files (see backend/src/ai/prompt-store.ts) — all three just need to
# exist; prompt-store seeds ./prompts from bundled defaults on boot if empty.
RUN mkdir -p data logs prompts
EXPOSE 3001
CMD ["node", "dist/server.js"]

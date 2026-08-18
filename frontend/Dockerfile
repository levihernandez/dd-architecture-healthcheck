# Build context is the repo root (npm workspaces hoist deps to the root
# node_modules), so this is invoked as:
#   docker build -f frontend/Dockerfile .

FROM node:20-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY frontend ./frontend

# VITE_* vars are compiled into the JS bundle at build time — Vite has no
# runtime env story for a static SPA. Passed as build args so a new commit's
# DD_VERSION shows up in RUM after the image is rebuilt (see root package.json
# docker:build/docker:up scripts, which recompute GIT_SHA on every invocation).
ARG VITE_DD_RUM_APP_ID
ARG VITE_DD_RUM_CLIENT_TOKEN
ARG VITE_DD_SERVICE
ARG VITE_DD_ENV
ARG VITE_DD_VERSION
ARG VITE_DD_SITE
ENV VITE_DD_RUM_APP_ID=$VITE_DD_RUM_APP_ID \
    VITE_DD_RUM_CLIENT_TOKEN=$VITE_DD_RUM_CLIENT_TOKEN \
    VITE_DD_SERVICE=$VITE_DD_SERVICE \
    VITE_DD_ENV=$VITE_DD_ENV \
    VITE_DD_VERSION=$VITE_DD_VERSION \
    VITE_DD_SITE=$VITE_DD_SITE

RUN npm run build --workspace=frontend

FROM nginx:1.27-alpine AS runtime
RUN apk add --no-cache openssl
COPY frontend/nginx.http.conf /etc/nginx/templates/nginx.http.conf
COPY frontend/nginx.https.conf /etc/nginx/templates/nginx.https.conf
COPY frontend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
COPY --from=builder /app/frontend/dist /usr/share/nginx/html
EXPOSE 80 443
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Build Caravan Coordinator from source
# This builds from the fork so the Umbrel UI changes are included.

FROM --platform=$BUILDPLATFORM node:20.19.3-bookworm-slim AS base

# Install OS dependencies
FROM base AS builder
ENV DEBIAN_FRONTEND noninteractive
RUN apt-get update --yes && \
    apt-get upgrade --yes && \
    apt-get install --yes --no-install-recommends \
    build-essential

WORKDIR /app
RUN npm install -g turbo
COPY caravan/ .
RUN turbo prune caravan-coordinator --docker

# Install dependencies and build
FROM base AS installer
WORKDIR /app

COPY --from=builder /app/out/json/ .
COPY --from=builder /app/scripts ./scripts
RUN npm ci

COPY --from=builder /app/out/full/ .
ENV NODE_OPTIONS=--max-old-space-size=32768
RUN npx turbo run build --filter=caravan-coordinator...

# Final image: nginx serving static files + RPC proxy to Umbrel Bitcoin Core
FROM nginx:1.23 AS runner
WORKDIR /app

# Copy the built Caravan static files
COPY --from=installer /app/apps/coordinator/build /usr/share/nginx/html/

# Remove the default nginx site config
RUN rm -f /etc/nginx/conf.d/default.conf

# Add the Umbrel RPC proxy nginx template and entrypoint
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]

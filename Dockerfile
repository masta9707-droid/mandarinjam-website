# mandarinjam.club web — production Linux container
# Runs server.js (mandarinjam-website), Node 22, better-sqlite3 native via prebuild/lockfile.
FROM node:22-bookworm-slim

# better-sqlite3 build may need python/make/g++ if no prebuild; keep slim + tools for safety.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# lockfile first for layer caching
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# app source
COPY server.js ./
COPY lib ./lib
COPY public ./public

# persistent writable data dir (SQLite WAL, orders, events, reconcile, mail-capture) — mount volume here
RUN mkdir -p /app/data /app/cache/img

ENV NODE_ENV=production
ENV MJ_BIND=0.0.0.0
ENV MJ_PORT=3200

EXPOSE 3200

CMD ["node", "server.js"]

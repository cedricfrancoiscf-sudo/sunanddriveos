# Image multi-stage — build TypeScript puis runtime minimal
FROM node:20-bookworm-slim AS builder

WORKDIR /app
RUN npm install -g pnpm
COPY package*.json pnpm-lock.yaml* ./
RUN pnpm install || npm install

ARG CACHEBUST=1
RUN echo "Cache bust: $CACHEBUST"
COPY . .
# Génération des clients Prisma
RUN npm run generate
# Compilation TypeScript
RUN npm run build

# ─── Image de production ───────────────────────────────────────
FROM node:20-bookworm-slim AS production

RUN apt-get update -y && apt-get install -y openssl libssl-dev && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

RUN npm install -g pnpm
COPY package*.json pnpm-lock.yaml* ./
RUN pnpm install --prod || npm install --only=production

# Copier le build et les fichiers Prisma
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/src/prisma ./src/prisma

# Copier le CLI Prisma depuis le builder
COPY --from=builder /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma

# Dossier uploads persistant via volume Docker
RUN mkdir -p uploads

EXPOSE 4000

# Init (migrate + seed) puis démarrage serveur
ENTRYPOINT ["/bin/sh", "-c"]
CMD ["node dist/init.js; node dist/server.js"]

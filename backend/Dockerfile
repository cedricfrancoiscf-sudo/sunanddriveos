# Image multi-stage — build TypeScript puis runtime minimal
FROM node:20-slim AS builder

WORKDIR /app
RUN npm install -g pnpm
COPY package*.json pnpm-lock.yaml* ./
RUN pnpm install || npm install

COPY . .
# Génération des clients Prisma
RUN npm run generate
# Compilation TypeScript
RUN npm run build

# ─── Image de production ───────────────────────────────────────
FROM node:20-slim AS production

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

# Dossier uploads persistant via volume Docker
RUN mkdir -p uploads

EXPOSE 4000

ENTRYPOINT ["/bin/sh", "-c"]
CMD ["node dist/server.js"]

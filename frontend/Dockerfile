# Image multi-stage — build Vite puis serveur nginx minimal
FROM node:20-alpine AS builder

WORKDIR /app
RUN npm install -g pnpm
COPY package*.json pnpm-lock.yaml* ./
RUN pnpm install || npm install

COPY . .
RUN pnpm build || npm run build

# ─── Image de production — nginx sert les fichiers statiques ──
FROM nginx:alpine AS production

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.frontend.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]

# ─── Image de développement — hot reload Vite ────────────────
FROM node:20-alpine AS dev

WORKDIR /app
RUN npm install -g pnpm
COPY package*.json ./
RUN pnpm install || npm install
COPY . .
EXPOSE 5173
CMD ["pnpm", "dev", "--host", "0.0.0.0"]

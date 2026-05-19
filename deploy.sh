#!/bin/bash
# Script de déploiement automatique sur NAS Synology DS224+
# Usage local (Windows) : ssh sunanddriveos@192.168.1.111 'bash -s' < deploy.sh
# Usage direct sur NAS   : ./deploy.sh

set -e

NAS_USER="sunanddriveos"
NAS_IP="192.168.1.111"
NAS_PATH="/volume1/docker/sunanddriveos"
REPO_URL="https://github.com/cedricfrancoiscf-sudo/sunanddriveos.git"

echo "═══════════════════════════════════════════"
echo "  SunanddriveOS — Déploiement NAS"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════"

# Vérifier que le dossier projet existe
if [ ! -d "$NAS_PATH" ]; then
  echo "[INIT] Premier déploiement — clonage du repo..."
  mkdir -p "$NAS_PATH"
  git clone "$REPO_URL" "$NAS_PATH"
fi

cd "$NAS_PATH"

echo "[GIT] Pull des dernières modifications..."
git fetch origin main
git reset --hard origin/main

echo "[ENV] Vérification du fichier .env..."
if [ ! -f ".env" ]; then
  echo "[WARN] Fichier .env absent — copie de .env.example"
  cp .env.example .env
  echo "[ACTION REQUISE] Remplir /volume1/docker/sunanddriveos/.env"
  exit 1
fi

echo "[DOCKER] Arrêt des conteneurs existants..."
docker-compose down --remove-orphans || true

echo "[DOCKER] Construction des images..."
docker-compose build --no-cache

echo "[DB] Démarrage de la base de données..."
docker-compose up -d db-master
echo "[DB] Attente démarrage PostgreSQL (15s)..."
sleep 15

echo "[DB] Exécution des migrations..."
docker-compose run --rm backend npm run migrate

echo "[DOCKER] Démarrage de tous les services..."
docker-compose up -d

echo "[HEALTH] Vérification santé des services..."
sleep 10
docker-compose ps

echo "═══════════════════════════════════════════"
echo "  Déploiement terminé !"
echo "  Frontend : http://$NAS_IP"
echo "  Backend  : http://$NAS_IP/api/v1/health"
echo "  Portainer: http://$NAS_IP:9000"
echo "═══════════════════════════════════════════"

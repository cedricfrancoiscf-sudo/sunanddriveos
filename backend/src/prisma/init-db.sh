#!/bin/bash
# Script d'initialisation PostgreSQL — crée la base tenant Sun and Drive
# Exécuté automatiquement au démarrage du conteneur db-master

set -e

TENANT_DB="sunanddriveos_tenant_sun_and_drive"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- Créer la base tenant si elle n'existe pas
  SELECT 'CREATE DATABASE $TENANT_DB'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$TENANT_DB')\gexec

  GRANT ALL PRIVILEGES ON DATABASE $TENANT_DB TO $POSTGRES_USER;
EOSQL

echo "[init-db] Base tenant créée : $TENANT_DB"

# Guide de Déploiement SunanddriveOS sur NAS Synology

## Prérequis
- NAS Synology DS224+ avec SSH activé
- Utilisateur: `sunanddriveos`
- Dossier de déploiement: `/volume1/docker/sunanddriveos`
- Docker et Docker Compose doivent être installés

## Étapes de Déploiement

### Étape 1 : Connexion SSH au NAS
```bash
ssh sunanddriveos@192.168.1.111
```

### Étape 2 : Mise à jour du code depuis GitHub
```bash
cd /volume1/docker/sunanddriveos
git pull origin main
```

### Étape 3 : Vérification des variables d'environnement
Vérifier que le fichier `.env` existe et contient toutes les variables requises :
```bash
cat .env | grep -E "DATABASE_MASTER_URL|JWT_SECRET|ANTHROPIC_API_KEY|FRONTEND_URL"
```

### Étape 4 : Reconstruction des images Docker
```bash
docker-compose build --no-cache
```

### Étape 5 : Démarrage des services
```bash
docker-compose up -d
```

### Étape 6 : Vérification du statut des conteneurs
```bash
docker-compose ps
```

Attendre 40 secondes pour que tous les services démarrent correctement.

### Étape 7 : Vérification de la santé de l'application
```bash
curl http://localhost:4000/api/v1/health
```

Vous devriez voir une réponse JSON :
```json
{
  "status": "ok",
  "service": "sunanddriveos-api",
  "version": "0.1.0",
  "timestamp": "2026-05-21T..."
}
```

### Étape 8 : Accès à l'application
L'application est accessible sur :
- **Frontend** : http://192.168.1.111
- **API** : http://192.168.1.111/api/v1
- **Health Check** : http://192.168.1.111/api/v1/health
- **Portainer** : http://192.168.1.111:9000

## Vérifications après déploiement

### Vérifier les logs des conteneurs
```bash
# Backend
docker logs sunanddriveos-backend | tail -20

# Frontend
docker logs sunanddriveos-frontend | tail -20

# Database
docker logs sunanddriveos-db | tail -20

# Nginx
docker logs sunanddriveos-nginx | tail -20
```

### Tester la connexion API
```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "password123",
    "companySlug": "test-company"
  }'
```

### Vérifier les migrations Prisma
Le backend applique les migrations automatiquement au démarrage.
```bash
docker logs sunanddriveos-backend | grep -i migration
```

## Dépannage

### Le backend ne démarre pas
1. Vérifier les logs : `docker logs sunanddriveos-backend`
2. Vérifier la base de données : `docker logs sunanddriveos-db`
3. Vérifier les variables d'environnement dans `.env`

### La base de données ne se connecte pas
1. Vérifier que le conteneur db-master est en cours d'exécution
2. Vérifier les identifiants dans `.env`
3. Vérifier que le port 5432 n'est pas bloqué

### Nginx ne proxy pas correctement
1. Vérifier les logs nginx : `docker logs sunanddriveos-nginx`
2. S'assurer que le backend et frontend sont disponibles
3. Vérifier la configuration nginx.conf

## Mise à jour après modification

```bash
cd /volume1/docker/sunanddriveos
git pull origin main
docker-compose build --no-cache
docker-compose up -d
```

## Sauvegarde de la base de données

```bash
# Dump la base de données master
docker exec sunanddriveos-db pg_dump -U sunanddriveos -d sunanddriveos_master > backup_master.sql

# Restauration
docker exec -i sunanddriveos-db psql -U sunanddriveos -d sunanddriveos_master < backup_master.sql
```

-- Suppression de la table technical_controls (obsolète)
-- Les CT sont désormais gérés via maintenance_tasks (type = 'ct')
DROP TABLE IF EXISTS "technical_controls";

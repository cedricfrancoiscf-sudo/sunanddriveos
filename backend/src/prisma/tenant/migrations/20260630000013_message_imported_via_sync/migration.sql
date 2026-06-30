-- Migration: ajout champ importedViaSync sur messages
-- Permet d'identifier les messages créés lors d'une synchronisation batch
-- (vs messages reçus en temps réel via webhook) et de bloquer toute
-- action automatique (IA, urgence, siège auto) sur l'historique importé.

ALTER TABLE "messages" ADD COLUMN "importedViaSync" BOOLEAN NOT NULL DEFAULT false;

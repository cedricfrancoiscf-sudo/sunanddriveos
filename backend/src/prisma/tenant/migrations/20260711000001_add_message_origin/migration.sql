-- Migration: ajout du champ origin sur messages
-- Corrige isThreadAnswered qui comptait toute réponse sortante sent/approved
-- comme une vraie réponse — y compris les séquences auto et les injections
-- système Getaround. origin distingue désormais la provenance réelle du
-- message afin que seules manual/ai_approved comptent comme une réponse.

DO $$ BEGIN
  CREATE TYPE "MessageOrigin" AS ENUM ('manual', 'ai_approved', 'sequence', 'getaround_system', 'inbound');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "origin" "MessageOrigin";

-- Back-fill heuristique des lignes existantes (idempotent : ne touche que origin IS NULL)

-- 1. Messages entrants (locataire)
UPDATE "messages" SET "origin" = 'inbound' WHERE "direction" = 'inbound' AND "origin" IS NULL;

-- 2. Envois de séquence auto (référencés par sequence_executions.messageId)
UPDATE "messages" m SET "origin" = 'sequence'
FROM "sequence_executions" se
WHERE se."messageId" = m."id" AND m."origin" IS NULL;

-- 3. Messages système Getaround injectés (patterns "Où trouver/rendre la/votre voiture ou véhicule")
UPDATE "messages" SET "origin" = 'getaround_system'
WHERE "origin" IS NULL AND "direction" = 'outbound' AND (
  "content" ILIKE '%où trouver%voiture%' OR
  "content" ILIKE '%où trouver%véhicule%' OR
  "content" ILIKE '%où rendre%voiture%' OR
  "content" ILIKE '%où rendre%véhicule%' OR
  "content" ILIKE '%where to find%car%' OR
  "content" ILIKE '%where to return%car%'
);

-- 4. Réponses IA (aiSuggestion rattachée = brouillon ou envoi généré par l'IA)
UPDATE "messages" SET "origin" = 'ai_approved' WHERE "origin" IS NULL AND "aiSuggestion" IS NOT NULL;

-- 5. Reste des sortants : réponses tapées manuellement dans le composer
UPDATE "messages" SET "origin" = 'manual' WHERE "origin" IS NULL AND "direction" = 'outbound';

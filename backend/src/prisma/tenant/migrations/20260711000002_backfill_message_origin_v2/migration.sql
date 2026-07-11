-- Hotfix: le back-fill de la migration 20260711000001 n'a jamais été exécuté
-- en prod (origin=NULL sur tous les messages existants) — regression totale
-- sur isThreadAnswered ("À traiter" 42→138, "Traités" vide). Cette migration
-- répète le back-fill (idempotent, ne touche que origin IS NULL) et élargit
-- les patterns de détection. NB : importedViaSync n'est jamais utilisé comme
-- discriminant (sa sémantique a changé dans le temps).

-- 1. Messages entrants (locataire)
UPDATE "messages" SET "origin" = 'inbound' WHERE "direction" = 'inbound' AND "origin" IS NULL;

-- 2. Envois de séquence auto (référencés par sequence_executions.messageId)
UPDATE "messages" m SET "origin" = 'sequence'
FROM "sequence_executions" se
WHERE se."messageId" = m."id" AND m."origin" IS NULL;

-- 2b. Envois de séquence identifiés par contenu (templates connus) — filet de
-- sécurité pour l'historique sans lien sequence_executions.messageId fiable
UPDATE "messages" SET "origin" = 'sequence'
WHERE "origin" IS NULL AND "direction" = 'outbound' AND (
  "content" ILIKE '%je vous remercie pour%demande de location%' OR
  "content" ILIKE '%nous vous remercions pour votre location%' OR
  "content" ILIKE '%bonjour et merci pour votre demande de location%'
);

-- 3. Messages système Getaround injectés (multilingue)
UPDATE "messages" SET "origin" = 'getaround_system'
WHERE "origin" IS NULL AND "direction" = 'outbound' AND (
  "content" ILIKE '%où trouver%voiture%' OR
  "content" ILIKE '%où trouver%véhicule%' OR
  "content" ILIKE '%où rendre%voiture%' OR
  "content" ILIKE '%où rendre%véhicule%' OR
  "content" ILIKE '%where to find%car%' OR
  "content" ILIKE '%where to return%car%' OR
  "content" ILIKE '%returning the car%' OR
  "content" ILIKE '%devolver el coche%' OR
  "content" ILIKE '%auto finden%'
);

-- 4. Réponses IA (aiSuggestion rattachée = brouillon ou envoi généré par l'IA)
UPDATE "messages" SET "origin" = 'ai_approved' WHERE "origin" IS NULL AND "aiSuggestion" IS NOT NULL;

-- 5. Reste des sortants : réponses tapées manuellement dans le composer
-- (garantit qu'aucun message n'a plus origin=NULL après cette migration)
UPDATE "messages" SET "origin" = 'manual' WHERE "origin" IS NULL AND "direction" = 'outbound';

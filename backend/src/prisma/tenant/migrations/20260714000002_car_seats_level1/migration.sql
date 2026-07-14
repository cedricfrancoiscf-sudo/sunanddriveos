-- Sièges auto — descente au niveau 1 (14/07/2026). Le workflow CarSeatRequest
-- (demande -> confirmée -> retournée) pilotant le stock est abandonné : il
-- était cassé (35 requêtes en base, 34 coquilles orphelines) et sur-dimensionné
-- pour une réalité de 4 sièges basculés manuellement. availableStock devient
-- une valeur dérivée de isAvailable (jamais incrémentée/décrémentée). Aucune
-- suppression physique — uniquement des ADD COLUMN et UPDATE idempotents.

ALTER TABLE "car_seats" ADD COLUMN IF NOT EXISTS "isAvailable" BOOLEAN NOT NULL DEFAULT true;

-- Neutralisation des demandes orphelines (résidus de test : ni location, ni
-- siège rattachés) — statut terminal, conservées pour audit.
UPDATE "car_seat_requests"
SET "status" = 'cancelled'
WHERE "rentalId" IS NULL AND "carSeatId" IS NULL AND "status" <> 'cancelled';

-- Siège fantôme "Groupe 0+" (exemple resté en base depuis la maquette initiale,
-- jamais possédé réellement) — désactivé, ligne conservée.
UPDATE "car_seats"
SET "isActive" = false
WHERE "name" ILIKE 'Groupe 0+%' AND "isActive" = true;

-- État réel au 14/07/2026 (inventaire Cédric)
UPDATE "car_seats"
SET "isAvailable" = true, "availableStock" = GREATEST("totalStock" - "outOfService", 0)
WHERE "name" IN ('Siege gris 1/2/3', 'Rehausseur noir', 'Rehausseur gris');

UPDATE "car_seats"
SET "isAvailable" = false, "availableStock" = 0
WHERE "name" = 'siege coccinelle 1/2/3';

-- Filet de sécurité : tout siège actif non listé ci-dessus (nom différent de
-- ce qui était attendu, ou siège futur) garde availableStock cohérent avec
-- la formule dérivée plutôt qu'une valeur potentiellement périmée de l'ancien
-- système de comptage — il n'existe plus de bouton "Recalculer" pour corriger
-- ça après coup.
UPDATE "car_seats"
SET "availableStock" = CASE WHEN "isAvailable" THEN GREATEST("totalStock" - "outOfService", 0) ELSE 0 END
WHERE "isActive" = true;

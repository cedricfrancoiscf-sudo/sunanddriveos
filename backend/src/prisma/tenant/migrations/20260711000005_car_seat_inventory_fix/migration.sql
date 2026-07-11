-- Correction inventaire sièges auto (11/07/2026) — aucune suppression physique,
-- uniquement des mises à jour de quantités/noms. Idempotent : chaque UPDATE
-- fixe des valeurs absolues, ré-exécuter ce fichier produit le même résultat.

-- Cosy 0/0+ : donnée de test, Cédric n'en possède aucun (24 total / 1 dispo
-- avant correction, dont 1 unité ajoutée par erreur le 11/07 — la remise à 0
-- annule aussi cette erreur). Ligne conservée, seuls les compteurs sont zérotés.
UPDATE "car_seats"
SET "totalStock" = 0, "availableStock" = 0
WHERE "name" = 'Cosy 0/0+';

-- Siege gris 1/2/3 : 1 unité possédée, disponible
UPDATE "car_seats"
SET "totalStock" = 1, "availableStock" = 1
WHERE "name" = 'Siege gris 1/2/3';

-- siege coccinelle 1/2/3 : 1 unité possédée, actuellement en location
UPDATE "car_seats"
SET "totalStock" = 1, "availableStock" = 0
WHERE "name" = 'siege coccinelle 1/2/3';

-- Les deux "Rehausseur" étaient indistinguables dans l'UI (un espace final
-- les différenciait techniquement) — renommage + quantités réelles.
UPDATE "car_seats"
SET "name" = 'Rehausseur noir', "totalStock" = 1, "availableStock" = 1
WHERE "name" = 'Rehausseur ';

UPDATE "car_seats"
SET "name" = 'Rehausseur gris', "totalStock" = 1, "availableStock" = 1
WHERE "name" = 'Rehausseur';

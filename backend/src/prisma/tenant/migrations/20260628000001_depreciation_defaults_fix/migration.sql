-- Mise à jour des taux de décote par défaut pour flotte d'occasion
-- Années 4-6 : 0.08 → 0.10, Après 6 ans : 0.05 → 0.08
ALTER TABLE "company_settings"
  ALTER COLUMN "depreciationRateYears4to6" SET DEFAULT 0.10,
  ALTER COLUMN "depreciationRateAfter6" SET DEFAULT 0.08;

-- Mise à jour des tenants existants encore au taux neuf (0.08 / 0.05)
UPDATE "company_settings"
  SET "depreciationRateYears4to6" = 0.10
  WHERE "depreciationRateYears4to6" = 0.08;

UPDATE "company_settings"
  SET "depreciationRateAfter6" = 0.08
  WHERE "depreciationRateAfter6" = 0.05;

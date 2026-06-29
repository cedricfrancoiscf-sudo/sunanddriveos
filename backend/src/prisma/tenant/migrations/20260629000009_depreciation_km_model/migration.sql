-- BLOC 1 — Refonte modèle dépréciation ROI : champs km + pente €/mois
ALTER TABLE "vehicles"
  ADD COLUMN IF NOT EXISTS "marketValueJ0"    FLOAT,
  ADD COLUMN IF NOT EXISTS "depreciationRate" FLOAT;

ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "kmDeclinCA"              INTEGER DEFAULT 160000,
  ADD COLUMN IF NOT EXISTS "kmStopGA"                INTEGER DEFAULT 200000,
  ADD COLUMN IF NOT EXISTS "defaultDepreciationRate" FLOAT   DEFAULT 100;

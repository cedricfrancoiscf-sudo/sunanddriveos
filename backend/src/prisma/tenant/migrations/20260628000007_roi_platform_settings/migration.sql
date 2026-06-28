-- Ajoute les champs ROI configurables + nom plateforme + taux commission
ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "roiHorizonMonths" INTEGER NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS "roiCoeffSaison" JSONB,
  ADD COLUMN IF NOT EXISTS "platformName" TEXT,
  ADD COLUMN IF NOT EXISTS "platformCommissionRate" DOUBLE PRECISION;

-- Add intelligence alert settings to company_settings
ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "ratingDropThreshold"       DOUBLE PRECISION NOT NULL DEFAULT 0.0,
  ADD COLUMN IF NOT EXISTS "underutilizationThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.30,
  ADD COLUMN IF NOT EXISTS "underutilizationWeeks"     INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS "riskScoreAlertThreshold"   INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "riskWeightScore"           INTEGER NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS "riskWeightFlags"           INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "riskWeightCancelled"       INTEGER NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS "riskWeightDelay"           INTEGER NOT NULL DEFAULT 10;

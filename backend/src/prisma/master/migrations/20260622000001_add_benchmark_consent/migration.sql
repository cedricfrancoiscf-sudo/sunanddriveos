-- Add benchmarkConsent to companies for anonymized benchmark feature
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "benchmarkConsent" BOOLEAN NOT NULL DEFAULT false;

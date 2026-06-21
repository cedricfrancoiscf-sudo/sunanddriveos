-- Migration: ajoute minMessageInterval dans company_settings
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "minMessageInterval" INTEGER NOT NULL DEFAULT 60;

-- Migration: fontFamily on company_settings
ALTER TABLE "company_settings" ADD COLUMN "fontFamily" TEXT NOT NULL DEFAULT 'Montserrat';

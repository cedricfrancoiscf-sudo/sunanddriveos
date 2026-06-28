-- AddColumn CompanySettings.roiCaMoyenMois
ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "roiCaMoyenMois" INTEGER NOT NULL DEFAULT 5;

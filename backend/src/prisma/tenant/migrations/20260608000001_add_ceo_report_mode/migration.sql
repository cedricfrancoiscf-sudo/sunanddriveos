-- Add mode column to ceo_reports with default 'annual'
ALTER TABLE "ceo_reports" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'annual';

-- Drop old unique index
DROP INDEX "ceo_reports_companyId_month_key";

-- Create new unique index including mode
CREATE UNIQUE INDEX "ceo_reports_companyId_month_mode_key" ON "ceo_reports"("companyId", "month", "mode");

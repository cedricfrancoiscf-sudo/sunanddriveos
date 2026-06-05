-- CreateTable: ceo_reports
CREATE TABLE "ceo_reports" (
  "id"          TEXT NOT NULL,
  "companyId"   TEXT NOT NULL,
  "month"       TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'generating',
  "content"     JSONB,
  "generatedAt" TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ceo_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ceo_reports_companyId_month_key" ON "ceo_reports"("companyId", "month");

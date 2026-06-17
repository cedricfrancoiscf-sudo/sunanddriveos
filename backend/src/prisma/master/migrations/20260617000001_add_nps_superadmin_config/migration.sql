-- Migration: NPS responses + lastNpsAt + superadmin_configs

ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "lastNpsAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "nps_responses" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "score" INTEGER NOT NULL,
  "comment" TEXT,
  "respondedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nps_responses_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "nps_responses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "nps_responses_companyId_createdAt_idx" ON "nps_responses"("companyId", "createdAt");

CREATE TABLE IF NOT EXISTS "superadmin_configs" (
  "key" TEXT NOT NULL,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "superadmin_configs_pkey" PRIMARY KEY ("key")
);

-- Valeur par défaut de l'intervalle NPS (90 jours)
INSERT INTO "superadmin_configs" ("key", "value", "updatedAt")
VALUES ('nps_interval_days', '90', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

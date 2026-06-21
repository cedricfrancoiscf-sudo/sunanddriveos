-- Add critAir and purchasePrice to vehicles
ALTER TABLE "vehicles"
  ADD COLUMN IF NOT EXISTS "critAir" TEXT,
  ADD COLUMN IF NOT EXISTS "purchasePrice" DOUBLE PRECISION;

-- Create vehicle_valuations table
CREATE TABLE IF NOT EXISTS "vehicle_valuations" (
  "id"             TEXT NOT NULL,
  "vehicleId"      TEXT NOT NULL,
  "estimatedValue" DOUBLE PRECISION NOT NULL,
  "source"         TEXT NOT NULL DEFAULT 'autobiz',
  "evaluatedAt"    TIMESTAMP(3) NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_valuations_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "vehicle_valuations"
  ADD CONSTRAINT "vehicle_valuations_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "vehicle_valuations_vehicleId_idx" ON "vehicle_valuations"("vehicleId");
CREATE INDEX IF NOT EXISTS "vehicle_valuations_evaluatedAt_idx" ON "vehicle_valuations"("evaluatedAt");

-- Create vehicle_warranties table
CREATE TABLE IF NOT EXISTS "vehicle_warranties" (
  "id"                    TEXT NOT NULL,
  "vehicleId"             TEXT NOT NULL,
  "warrantyStartDate"     TIMESTAMP(3),
  "warrantyMonths"        INTEGER,
  "warrantyExtension"     BOOLEAN NOT NULL DEFAULT false,
  "warrantyExtensionEnd"  TIMESTAMP(3),
  "warrantyTires"         BOOLEAN NOT NULL DEFAULT false,
  "warrantyTiresEnd"      TIMESTAMP(3),
  "notes"                 TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_warranties_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_warranties_vehicleId_key" ON "vehicle_warranties"("vehicleId");

ALTER TABLE "vehicle_warranties"
  ADD CONSTRAINT "vehicle_warranties_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Add vehicle and autobiz settings to company_settings
ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "autobizApiKey"        TEXT,
  ADD COLUMN IF NOT EXISTS "depreciationThreshold" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
  ADD COLUMN IF NOT EXISTS "warrantyAlertDays"    INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "co2FactorEssence"     DOUBLE PRECISION NOT NULL DEFAULT 120,
  ADD COLUMN IF NOT EXISTS "co2FactorHybride"     DOUBLE PRECISION NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "co2FactorElectrique"  DOUBLE PRECISION NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "co2EquivalentArbre"   DOUBLE PRECISION NOT NULL DEFAULT 10;

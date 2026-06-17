-- Add accounting fields to company_settings
ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "journalCode"                TEXT NOT NULL DEFAULT 'VT',
  ADD COLUMN IF NOT EXISTS "compteLocationsProduit"     TEXT NOT NULL DEFAULT '706100',
  ADD COLUMN IF NOT EXISTS "compteCompensationsProduit" TEXT NOT NULL DEFAULT '706200',
  ADD COLUMN IF NOT EXISTS "compteEntretienCharge"      TEXT NOT NULL DEFAULT '615000',
  ADD COLUMN IF NOT EXISTS "compteAssuranceCharge"      TEXT NOT NULL DEFAULT '616000',
  ADD COLUMN IF NOT EXISTS "compteParkingCharge"        TEXT NOT NULL DEFAULT '613000',
  ADD COLUMN IF NOT EXISTS "formatExportPreference"     TEXT NOT NULL DEFAULT 'fec',
  ADD COLUMN IF NOT EXISTS "objectifSeuilAlerte"        INTEGER NOT NULL DEFAULT 80;

-- Create vehicle_objectives table
CREATE TABLE IF NOT EXISTS "vehicle_objectives" (
  "id"        TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "month"     TEXT NOT NULL,
  "targetCA"  DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vehicle_objectives_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "vehicle_objectives_vehicleId_month_key" UNIQUE ("vehicleId", "month"),
  CONSTRAINT "vehicle_objectives_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

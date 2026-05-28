CREATE TABLE "vehicle_costs" (
  "id"        TEXT NOT NULL,
  "vehicleId" TEXT NOT NULL,
  "label"     TEXT NOT NULL,
  "amount"    DOUBLE PRECISION NOT NULL,
  "type"      TEXT NOT NULL DEFAULT 'fixed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vehicle_costs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "vehicle_costs"
  ADD CONSTRAINT "vehicle_costs_vehicleId_fkey"
  FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable VehicleCarkeeper
CREATE TABLE IF NOT EXISTS "vehicle_carkeepers" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_carkeepers_pkey" PRIMARY KEY ("id")
);

-- UniqueIndex
CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_carkeepers_vehicleId_userId_key" ON "vehicle_carkeepers"("vehicleId", "userId");

-- ForeignKeys
ALTER TABLE "vehicle_carkeepers" ADD CONSTRAINT "vehicle_carkeepers_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "vehicle_carkeepers" ADD CONSTRAINT "vehicle_carkeepers_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable Accessory: add carekeeperUserId
ALTER TABLE "accessories" ADD COLUMN IF NOT EXISTS "carekeeperUserId" TEXT;

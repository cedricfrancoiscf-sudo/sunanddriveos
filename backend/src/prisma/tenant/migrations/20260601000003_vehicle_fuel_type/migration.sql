-- Migration: add fuelType to vehicles
ALTER TABLE "vehicles" ADD COLUMN "fuelType" TEXT;

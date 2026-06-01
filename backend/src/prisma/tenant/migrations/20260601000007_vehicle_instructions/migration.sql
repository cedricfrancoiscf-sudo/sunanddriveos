-- Migration: pickup/return instructions on vehicles
ALTER TABLE "vehicles" ADD COLUMN "pickupInstructions" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "returnInstructions" TEXT;

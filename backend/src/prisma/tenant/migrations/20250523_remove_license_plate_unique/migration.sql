-- Migration: remove unique constraint on license_plate
-- getaroundId is the authoritative unique key for synced vehicles
DROP INDEX IF EXISTS "vehicles_license_plate_key";

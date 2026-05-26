-- AlterTable: add professional fields to companies
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "siret"        TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "managerName"  TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "phone"        TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "contactEmail" TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "address"      TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "city"         TEXT;
ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "postalCode"   TEXT;

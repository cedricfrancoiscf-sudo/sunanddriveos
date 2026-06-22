-- AlterTable: add isDemo flag for demo tenant management
ALTER TABLE "companies" ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false;

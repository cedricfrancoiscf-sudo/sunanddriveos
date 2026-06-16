-- Migration: add cancellationReason to rentals
ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "cancellationReason" TEXT;

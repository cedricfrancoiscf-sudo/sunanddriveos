-- Migration: charge breakdown fields on rentals
ALTER TABLE "rentals" ADD COLUMN "basePrice" DOUBLE PRECISION;
ALTER TABLE "rentals" ADD COLUMN "extraDistanceFee" DOUBLE PRECISION;
ALTER TABLE "rentals" ADD COLUMN "insuranceFee" DOUBLE PRECISION;
ALTER TABLE "rentals" ADD COLUMN "assistanceFee" DOUBLE PRECISION;
ALTER TABLE "rentals" ADD COLUMN "deliveryFee" DOUBLE PRECISION;

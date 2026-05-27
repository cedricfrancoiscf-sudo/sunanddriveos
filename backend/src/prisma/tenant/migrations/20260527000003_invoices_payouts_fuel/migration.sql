-- Niveau carburant sur les locations
ALTER TABLE "rentals" ADD COLUMN "fuelLevelCheckin" DOUBLE PRECISION;
ALTER TABLE "rentals" ADD COLUMN "fuelLevelCheckout" DOUBLE PRECISION;

-- Niveau carburant et kilométrage sur les fiches contrôle
ALTER TABLE "vehicle_checks" ADD COLUMN "fuelLevel" INTEGER;
ALTER TABLE "vehicle_checks" ADD COLUMN "mileage" INTEGER;

-- Factures Getaround
CREATE TABLE "getaround_invoices" (
    "id" TEXT NOT NULL,
    "getaroundId" INTEGER NOT NULL,
    "pdfUrl" TEXT,
    "totalPrice" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "emittedAt" TIMESTAMP(3),
    "rentalId" TEXT,
    CONSTRAINT "getaround_invoices_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "getaround_invoices_getaroundId_key" ON "getaround_invoices"("getaroundId");
ALTER TABLE "getaround_invoices" ADD CONSTRAINT "getaround_invoices_rentalId_fkey"
    FOREIGN KEY ("rentalId") REFERENCES "rentals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Virements Getaround
CREATE TABLE "getaround_payouts" (
    "id" TEXT NOT NULL,
    "getaroundId" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "getaround_payouts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "getaround_payouts_getaroundId_key" ON "getaround_payouts"("getaroundId");

-- Add invoice sync fields to rentals
ALTER TABLE "rentals"
  ADD COLUMN IF NOT EXISTS "invoicesSyncedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "evaluationFlag" TEXT,
  ADD COLUMN IF NOT EXISTS "evaluationFlagAmount" INTEGER,
  ADD COLUMN IF NOT EXISTS "evaluationFlagUnblockedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "evaluationFlagUnblockedById" TEXT;

-- Create rental_invoices table
CREATE TABLE IF NOT EXISTS "rental_invoices" (
  "id" TEXT NOT NULL,
  "rentalId" TEXT NOT NULL,
  "getaroundInvoiceId" INTEGER NOT NULL,
  "chargeType" TEXT NOT NULL,
  "amountCentimes" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "emittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "rental_invoices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rental_invoices_rentalId_getaroundInvoiceId_chargeType_key" UNIQUE ("rentalId", "getaroundInvoiceId", "chargeType"),
  CONSTRAINT "rental_invoices_rentalId_fkey" FOREIGN KEY ("rentalId") REFERENCES "rentals"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- Add extra charges settings to company_settings
ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "invoiceSyncWindowDays" INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS "invoiceActiveTypes" TEXT[] NOT NULL DEFAULT ARRAY['blocked_cleaning','blocked_damage','blocked_claim','blocked_late','blocked_infraction','blocked_gas']::TEXT[],
  ADD COLUMN IF NOT EXISTS "invoiceMalusConfig" JSONB NOT NULL DEFAULT '{}';

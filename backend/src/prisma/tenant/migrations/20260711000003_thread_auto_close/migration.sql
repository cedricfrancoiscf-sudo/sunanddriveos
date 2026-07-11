-- Auto-clôture différée des fils non répondus (7 jours après fin de location,
-- configurable via CompanySettings.threadAutoCloseDays). Aucune suppression :
-- réutilise threadDismissedAt, ajoute dismissedReason pour distinguer une
-- clôture manuelle (opérateur) d'une clôture automatique (cron).

DO $$ BEGIN
  CREATE TYPE "DismissedReason" AS ENUM ('manual', 'auto_rental_ended');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "dismissedReason" "DismissedReason";
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "threadAutoCloseDays" INTEGER;

-- Back-fill : tous les fils déjà clôturés à ce jour l'ont été manuellement
-- (l'auto-clôture n'existait pas avant cette migration)
UPDATE "rentals" SET "dismissedReason" = 'manual'
WHERE "threadDismissedAt" IS NOT NULL AND "dismissedReason" IS NULL;

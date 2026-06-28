-- AddColumn Vehicle.loanDeposit
ALTER TABLE "vehicles"
  ADD COLUMN IF NOT EXISTS "loanDeposit" DOUBLE PRECISION;

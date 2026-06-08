ALTER TABLE "vehicles" ADD COLUMN "carekeeperUserId" TEXT;
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_carekeeperUserId_fkey" FOREIGN KEY ("carekeeperUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

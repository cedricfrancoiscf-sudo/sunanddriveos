-- CreateTable RenterBlacklist
CREATE TABLE IF NOT EXISTS "renter_blacklists" (
    "id" TEXT NOT NULL,
    "driverGetaroundId" TEXT NOT NULL,
    "driverName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "blacklistedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "renter_blacklists_pkey" PRIMARY KEY ("id")
);

-- UniqueIndex
CREATE UNIQUE INDEX IF NOT EXISTS "renter_blacklists_driverGetaroundId_key" ON "renter_blacklists"("driverGetaroundId");

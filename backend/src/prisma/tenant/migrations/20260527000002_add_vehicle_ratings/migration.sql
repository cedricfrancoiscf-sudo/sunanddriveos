-- CreateTable
CREATE TABLE "vehicle_ratings" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "period" TEXT NOT NULL,
    "keywords" TEXT[] NOT NULL DEFAULT '{}',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_ratings_vehicleId_period_key" ON "vehicle_ratings"("vehicleId", "period");

-- AddForeignKey
ALTER TABLE "vehicle_ratings" ADD CONSTRAINT "vehicle_ratings_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

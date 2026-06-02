-- AlterTable: add carkeeperId to accessories and car_seats
ALTER TABLE "accessories" ADD COLUMN "carkeeperId" TEXT;
ALTER TABLE "car_seats"   ADD COLUMN "carkeeperId" TEXT;

ALTER TABLE "accessories" ADD CONSTRAINT "accessories_carkeeperId_fkey"
  FOREIGN KEY ("carkeeperId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "car_seats" ADD CONSTRAINT "car_seats_carkeeperId_fkey"
  FOREIGN KEY ("carkeeperId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

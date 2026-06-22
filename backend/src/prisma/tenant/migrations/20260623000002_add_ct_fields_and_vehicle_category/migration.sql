-- AddColumns: résultat CT et deadline contre-visite sur maintenance_tasks
ALTER TABLE "maintenance_tasks" ADD COLUMN "ctResult" TEXT;
ALTER TABLE "maintenance_tasks" ADD COLUMN "ctCounterVisitDeadline" TIMESTAMP(3);

-- AddColumn: catégorie véhicule (tourisme/utilitaire/camionnette) — détermine l'intervalle CT
ALTER TABLE "vehicles" ADD COLUMN "vehicleCategory" TEXT NOT NULL DEFAULT 'tourisme';

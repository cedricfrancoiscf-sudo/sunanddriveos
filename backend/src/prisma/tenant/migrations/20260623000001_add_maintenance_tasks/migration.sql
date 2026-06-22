-- CreateTable: maintenance_tasks (tâches récurrentes CT + révision, une par véhicule+type)
CREATE TABLE "maintenance_tasks" (
    "id"              TEXT NOT NULL,
    "vehicleId"       TEXT NOT NULL,
    "type"            TEXT NOT NULL,
    "lastPerformedAt" TIMESTAMP(3),
    "lastMileage"     INTEGER,
    "lastCost"        DOUBLE PRECISION,
    "lastProvider"    TEXT,
    "lastNotes"       TEXT,
    "nextDueDate"     TIMESTAMP(3),
    "nextDueMileage"  INTEGER,
    "intervalKm"      INTEGER,
    "intervalMonths"  INTEGER,
    "totalCost"       DOUBLE PRECISION NOT NULL DEFAULT 0,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "maintenance_tasks_pkey" PRIMARY KEY ("id")
);

-- UniqueIndex: un seul CT et une seule révision par véhicule
CREATE UNIQUE INDEX "maintenance_tasks_vehicleId_type_key"
    ON "maintenance_tasks"("vehicleId", "type");

-- ForeignKey: maintenance_tasks → vehicles
ALTER TABLE "maintenance_tasks"
    ADD CONSTRAINT "maintenance_tasks_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddColumn: lien optionnel entre un entretien historique et sa tâche parente
ALTER TABLE "maintenances" ADD COLUMN "maintenanceTaskId" TEXT;

-- ForeignKey: maintenances → maintenance_tasks (nullable, SET NULL si tâche supprimée)
ALTER TABLE "maintenances"
    ADD CONSTRAINT "maintenances_maintenanceTaskId_fkey"
    FOREIGN KEY ("maintenanceTaskId") REFERENCES "maintenance_tasks"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

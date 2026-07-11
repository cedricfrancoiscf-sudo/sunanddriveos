-- AlterTable: ajouter ctResult aux entrées historique de maintenance (CT uniquement)
ALTER TABLE "maintenances" ADD COLUMN "ctResult" TEXT;

-- Seuil "CT à prévoir" configurable (14/07/2026). Jusqu'ici la fenêtre était
-- codée en dur et divergente selon l'écran (30j si contre-visite / 60j sinon
-- dans maintenance.service.ts, 30j sans condition dans intelligence.routes.ts,
-- requête ad hoc dans le cron matinal) — un CT à 33 jours (contre-visite C3
-- FC275PK, échéance 16/08/2026) pouvait ainsi n'apparaître sur aucun écran.
-- Fenêtre désormais unique, contre-visite et CT normal confondus (une
-- contre-visite doit alerter PLUS TÔT, pas plus tard — travail à planifier).

ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "ctAlertWindowDays" INTEGER;

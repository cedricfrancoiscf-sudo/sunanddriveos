-- Durée du cache des suggestions IA, configurable par tenant (défaut 1h)
ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "suggestionsCacheTtlHours" INTEGER NOT NULL DEFAULT 1;

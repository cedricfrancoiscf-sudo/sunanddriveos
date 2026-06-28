-- Notes Getaround juin 2026 — Sun and Drive
-- Idempotent via ON CONFLICT DO UPDATE
INSERT INTO "vehicle_ratings" ("id", "vehicleId", "period", "rating", "reviewCount", "keywords", "notes", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  v.id,
  r.period,
  r.rating,
  r.review_count,
  '{}',
  NULL,
  NOW(),
  NOW()
FROM (VALUES
  ('EZ480LT', '2026-06', 4.82, 77),
  ('FZ375EZ', '2026-06', 4.91, 69),
  ('FZ671YT', '2026-06', 4.71, 56),
  ('EL113HY', '2026-06', 4.76, 117),
  ('ET672TZ', '2026-06', 4.59, 62),
  ('FC275PK', '2026-06', 4.55, 64),
  ('FY542RR', '2026-06', 4.78, 69)
) AS r(license_plate, period, rating, review_count)
JOIN vehicles v ON v."licensePlate" = r.license_plate
ON CONFLICT ("vehicleId", "period") DO UPDATE SET
  "rating"      = EXCLUDED."rating",
  "reviewCount" = EXCLUDED."reviewCount",
  "updatedAt"   = NOW();

-- Rétrodater startDate des coûts fixes à la date d'achat du véhicule (idempotent)
UPDATE vehicle_costs vc
SET "startDate" = v."purchaseDate"
FROM vehicles v
WHERE vc."vehicleId" = v.id
  AND vc.type = 'fixed'
  AND v."purchaseDate" IS NOT NULL
  AND vc."startDate" > v."purchaseDate";

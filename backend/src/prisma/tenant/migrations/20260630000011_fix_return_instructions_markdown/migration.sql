-- Migration one-shot : nettoyer les astérisques markdown dans pickup/returnInstructions
-- Remplace "* item" par "• item" et supprime les doubles astérisques gras

UPDATE vehicles
SET "returnInstructions" = regexp_replace(
  regexp_replace(
    regexp_replace("returnInstructions", '\*\*(.*?)\*\*', '\1', 'g'),
    '(^|\n)\s*\*\s+', '\1• ', 'g'
  ),
  '\*(.*?)\*', '\1', 'g'
)
WHERE "returnInstructions" LIKE '%*%';

UPDATE vehicles
SET "pickupInstructions" = regexp_replace(
  regexp_replace(
    regexp_replace("pickupInstructions", '\*\*(.*?)\*\*', '\1', 'g'),
    '(^|\n)\s*\*\s+', '\1• ', 'g'
  ),
  '\*(.*?)\*', '\1', 'g'
)
WHERE "pickupInstructions" LIKE '%*%';

-- Migration : email admin sunanddrive.fr → sunanddrive.com
-- Idempotent : si l'email .com existe déjà ou si .fr n'existe pas, la mise à jour ne fait rien.
UPDATE "User"
SET email = 'admin@sunanddrive.com'
WHERE email = 'admin@sunanddrive.fr'
  AND NOT EXISTS (
    SELECT 1 FROM "User" WHERE email = 'admin@sunanddrive.com'
  );

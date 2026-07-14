-- Base de connaissances "Règles Getaround" — règles plateforme valables pour
-- toute la flotte (identiques quel que soit le véhicule), injectées dans le
-- prompt IA en plus de la fiche véhicule spécifique. Idempotent : le
-- pré-remplissage ne touche que les lignes où getaroundRules est encore NULL,
-- donc ne jamais écraser une édition faite depuis Paramètres.

ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "getaroundRules" TEXT;

UPDATE "company_settings"
SET "getaroundRules" = '# Règles Getaround (plateforme) — valables pour toute la flotte

## Localisation du véhicule
- Le locataire accède à l''emplacement exact du véhicule 1 HEURE avant le début de
  sa location, pas avant.
- Côté locataire : Mes Locations > sa location > un bouton "Localiser le véhicule"
  apparaît à H-1.
- Le véhicule est repérable grâce au sticker Getaround.
- Avant H-1, aucune position précise n''est communiquée : c''est normal. Si un
  locataire s''en inquiète, LE RASSURER en lui expliquant ce mécanisme. Ne jamais
  escalader sur cette question.

## Si le locataire ne trouve pas la voiture
- Si la localisation échoue dans l''app : il doit contacter le propriétaire, qui
  dispose de la position.
- Si l''app indique que la location précédente est encore en cours : vérifier que
  le locataire précédent rentrera à temps.

## Démarrage de la location
- Impossible de déverrouiller avant l''heure exacte de la réservation.
- Le locataire fait l''état des lieux photo complet dans l''app (10 photos
  extérieures + intérieur) AVANT de pouvoir déverrouiller.
- Les clés se trouvent DANS LA VOITURE (boîte à gants).
- Le locataire renseigne le niveau de carburant au départ.

## Fin de location
- Le locataire regare la voiture à son emplacement initial, laisse les clés à
  l''intérieur et verrouille via l''application.

## Assurance
- Assurance tous risques AXA, incluse, active dès le début de la location.

## Panne / accident / urgence
- Assistance Getaround 24h/24 et 7j/7, dépannage et remorquage inclus.
- Service client Getaround joignable tous les jours de 5h à 22h.
- TOUTE urgence (panne, accident, véhicule immobilisé) → rediriger IMMÉDIATEMENT
  vers l''assistance Getaround. Ne jamais tenter de gérer soi-même.

## Annulation
- Annulation gratuite jusqu''à 48h avant le début de la location.

## Frais
- Les kilomètres supplémentaires et le surplus de carburant sont facturés
  AUTOMATIQUEMENT par Getaround.
- Sun and Drive ne gère NI les remboursements NI les litiges de facturation :
  toujours rediriger vers le service client Getaround.'
WHERE "getaroundRules" IS NULL;

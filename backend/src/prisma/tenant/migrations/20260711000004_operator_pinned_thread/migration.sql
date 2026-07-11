-- Correction : l'auto-clôture ne doit jamais annuler une décision explicite
-- d'opérateur. Un fil réouvert manuellement (bouton "Réouvrir le fil") SANS
-- nouvel inbound est désormais épinglé (operatorPinned=true) et exclu de
-- autoCloseStaleThreads, quel que soit l'âge de la location. Une réouverture
-- déclenchée par un nouvel inbound reste distincte (operatorPinned=false) et
-- peut être re-clôturée normalement. Aucune suppression.

ALTER TABLE "rentals" ADD COLUMN IF NOT EXISTS "operatorPinned" BOOLEAN NOT NULL DEFAULT false;

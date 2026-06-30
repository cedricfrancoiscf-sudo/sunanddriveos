# Changelog — SunanddriveOS

Carnet de bord produit. Toutes les modifications significatives sont documentées ici.
Format : [Keep a Changelog](https://keepachangelog.com/fr/1.0.0/).

---

## [Session 30/06/2026]

### Fixed
- Crash rapport CEO sur `.toFixed()` appelé sur des valeurs null dans les données patrimoniales
- Dates fantômes dans "Interventions à venir" du rapport CEO — le calcul lisait le mauvais modèle (`Maintenance.nextServiceDate` au lieu de `MaintenanceTask.nextDueDate`)
- Incohérence du CA mensuel affiché entre les routes `/rentals/stats` et `/rentals` (filtres de date différents)
- Markdown brut (astérisques) présent dans les instructions véhicule et envoyé tel quel dans les messages clients
- Double envoi du message de bienvenue automatique
- Bouton "+ Coût" débordant dans le tableau Rentabilité

### Added
- Garde-fou `isRentalActionable()` : aucune action automatique (messagerie, urgence, sièges auto) sur une location terminée ou annulée
- Flag `importedViaSync` sur le modèle Message : protection contre le traitement de messages historiques lors d'une synchronisation initiale de nouveau tenant
- Fenêtre de fraîcheur 24h sur la génération de réponse automatique
- Onglet "IA & Instructions" sur la fiche véhicule : catalogue d'équipements (GPS, Android Auto/CarPlay, climatisation, régulateur, radars/caméras de recul, boîte de vitesse, Bluetooth) + instructions structurées de prise en charge/restitution, gating Pro/Enterprise
- Détection d'urgence messagerie (panne, accident, alerte sécurité) avec réponse automatique immédiate redirigeant vers l'assistance Getaround + alerte email à l'opérateur
- Changement de mot de passe en self-service (Admin tenant + SuperAdmin)
- Toggle Mensuel/Annuel sur le tableau Rentabilité
- Plaque d'immatriculation visible en permanence dans le fil d'Ariane de la fiche véhicule
- Endpoint de nettoyage markdown préventif pour les futurs tenants (`POST /api/v1/settings/clean-vehicle-instructions`)

### Changed
- Libellés du signal de revente harmonisés sur "À vendre" / "À surveiller" / "À conserver" (identiques sur Rentabilité et Rapport CEO)
- Tableau Rentabilité : hauteur de ligne réduite de ~35%, badge "rentable" remplacé par un point coloré discret, 6 colonnes affichées par défaut au lieu de 10
- Feedback visuel après sauvegarde dans la Fiche IA & Instructions (état de chargement + confirmation "Enregistré ✓")
- Fiche IA véhicule injectée dans le prompt de génération de réponse automatique (équipements + instructions + règle de non-affirmation si valeur null)

### Known issues / à surveiller
- La fiabilité de la synchronisation des messages entrants Getaround reste à surveiller (cas historiques identifiés où des messages clients n'ont jamais été synchronisés)
- Le mécanisme "Mot de passe oublié" doit être testé de bout en bout (envoi email réel)
- Le catalogue d'équipements (Fiche IA) doit être complété manuellement par Cédric pour chaque véhicule — les champs sont créés mais vides à la création d'un véhicule

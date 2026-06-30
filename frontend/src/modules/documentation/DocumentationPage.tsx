import React, { useState } from 'react';

const PRIMARY = '#01696e';

type TabId = 'brochure' | 'quickstart' | 'manual' | 'technical';

const TABS: { id: TabId; label: string; num: string }[] = [
  { id: 'brochure', label: 'Brochure commerciale', num: '01' },
  { id: 'quickstart', label: 'Prise en main rapide', num: '02' },
  { id: 'manual', label: 'Manuel utilisateur', num: '03' },
  { id: 'technical', label: 'Dossier technique', num: '04' },
];

function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="mb-2 text-3xl font-bold" style={{ color: PRIMARY, fontFamily: "'Montserrat', sans-serif" }}>{children}</h1>;
}
function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 mt-8 text-xl font-bold text-gray-900 border-b-2 pb-1" style={{ borderColor: PRIMARY }}>{children}</h2>;
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-5 text-base font-semibold" style={{ color: PRIMARY }}>{children}</h3>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="mb-3 text-sm leading-relaxed text-gray-700">{children}</p>;
}
function Ul({ children }: { children: React.ReactNode }) {
  return <ul className="mb-3 space-y-1 text-sm text-gray-700">{children}</ul>;
}
function Li({ children }: { children: React.ReactNode }) {
  return <li className="flex gap-2"><span style={{ color: PRIMARY }} className="mt-0.5 shrink-0">▸</span><span>{children}</span></li>;
}
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 flex gap-4">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ backgroundColor: PRIMARY }}>{n}</div>
      <div className="flex-1">
        <p className="mb-1 font-semibold text-gray-900">{title}</p>
        <div className="text-sm text-gray-600">{children}</div>
      </div>
    </div>
  );
}
function InfoBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-4 rounded-xl border p-4 text-sm" style={{ borderColor: PRIMARY + '40', backgroundColor: PRIMARY + '08' }}>
      {children}
    </div>
  );
}
function CodeBlock({ children }: { children: React.ReactNode }) {
  return <pre className="my-3 overflow-x-auto rounded-lg bg-gray-900 px-4 py-3 text-xs text-green-300 font-mono leading-relaxed">{children}</pre>;
}
function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="my-4 overflow-x-auto rounded-xl border border-gray-200">
      <table className="w-full text-xs">
        <thead className="text-white" style={{ backgroundColor: PRIMARY }}>
          <tr>{headers.map(h => <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              {row.map((cell, j) => <td key={j} className="px-3 py-2 text-gray-700">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── DOCUMENT 1 — Brochure ───────────────────────────────────────────────────

function DocBrochure() {
  return (
    <div className="mx-auto max-w-3xl">
      {/* En-tête visible uniquement à l'impression */}
      <div className="print-only mb-6 pb-4 border-b-2" style={{ borderColor: PRIMARY }}>
        <p className="text-sm font-bold" style={{ color: PRIMARY, fontFamily: "'Montserrat', sans-serif" }}>SunanddriveOS — Logiciel de gestion de flotte Getaround</p>
        <p className="text-xs text-gray-400 mt-0.5">Brochure commerciale · appli.sunanddrive.com</p>
      </div>

      {/* Accroche */}
      <div className="mb-8 rounded-2xl p-8 text-white" style={{ background: `linear-gradient(135deg, ${PRIMARY} 0%, #014a4e 100%)` }}>
        <p className="text-xs font-semibold uppercase tracking-widest opacity-80">SunanddriveOS · Logiciel de gestion de flotte</p>
        <H1><span className="text-white">Gérez votre flotte Getaround comme un pro</span></H1>
        <p className="mt-3 text-lg opacity-90 font-medium">La plateforme tout-en-un pour les loueurs Getaround sérieux.</p>
        <p className="mt-2 text-sm opacity-75">Automatisation · Rentabilité · Intelligence · Comptabilité</p>
      </div>

      {/* Le problème */}
      <H2>Le quotidien sans SunanddriveOS</H2>
      <P>Vous gérez votre flotte avec des onglets Excel, des notes vocales et Getaround ouvert en permanence. Chaque mois, vous perdez des heures à :</P>
      <Ul>
        <Li>Recopier les locations dans un tableau pour calculer votre rentabilité</Li>
        <Li>Répondre manuellement aux mêmes questions locataires (clés, carburant, retours)</Li>
        <Li>Oublier les contrôles techniques et les entretiens à planifier</Li>
        <Li>Ne jamais savoir avec certitude si chaque véhicule est rentable</Li>
        <Li>Jongler entre plusieurs comptes Getaround sans vue consolidée</Li>
        <Li>Produire les données comptables à la main en fin de mois</Li>
      </Ul>
      <InfoBox><strong>Résultat :</strong> 3 à 6 heures perdues par semaine, des opportunités manquées, et une gestion opaque qui bloque votre croissance.</InfoBox>

      {/* Ce que fait SunanddriveOS */}
      <H2>Ce que fait SunanddriveOS — 10 bénéfices concrets</H2>
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { icon: '⚡', title: '−80% de temps de réponse', desc: 'L\'IA rédige les réponses locataires en 2 secondes.' },
          { icon: '📊', title: 'Rentabilité instantanée', desc: 'Marge nette par véhicule calculée en temps réel.' },
          { icon: '📅', title: 'Planning centralisé', desc: 'Vue Gantt 7/14/28 jours sur toute la flotte.' },
          { icon: '🔔', title: 'Zéro oubli', desc: 'Alertes CT, entretien, garantie, stocks sièges.' },
          { icon: '🤖', title: 'Séquences automatiques', desc: 'Messages pré-départ/post-retour sans intervention.' },
          { icon: '📈', title: 'Intelligence prédictive', desc: 'Benchmarks, corrélations, score de risque locataire.' },
          { icon: '📝', title: 'Export FEC clé en main', desc: 'Comptabilité conforme prête pour votre expert-comptable.' },
          { icon: '🌍', title: 'Multi-comptes Getaround', desc: 'Tous vos comptes synchronisés dans une seule app.' },
          { icon: '📱', title: 'Rôle Carkeeper mobile', desc: 'Vos gestionnaires sur le terrain avec périmètre limité.' },
          { icon: '🏢', title: 'Rapport CEO mensuel', desc: 'Synthèse exécutive avec IA et données météo corrélées.' },
        ].map(b => (
          <div key={b.title} className="flex gap-3 rounded-xl border border-gray-200 bg-white p-4 print-avoid-break">
            <span className="text-2xl">{b.icon}</span>
            <div>
              <p className="font-semibold text-gray-900 text-sm">{b.title}</p>
              <p className="text-xs text-gray-500 mt-0.5">{b.desc}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Modules */}
      <H2>Les modules de la plateforme</H2>
      <Table
        headers={['Module', 'Ce que vous gagnez']}
        rows={[
          ['Planning', 'Vue Gantt multi-véhicule, blocages synchronisés Getaround, indisponibilités bidirectionnelles'],
          ['Messages IA', 'Suggestions contextuelles Claude, approbation 1 clic, ton personnalisable (vouvoiement/tutoiement)'],
          ['Rentabilité', 'Coûts fixes/variables, marge nette, simulateur, objectifs par véhicule'],
          ['Intelligence', 'Alertes automatiques, corrélation météo-revenus, benchmark flotte, forecast 8 semaines'],
          ['Séquences', 'Automatisation messages par trigger (réservation, départ, retour, annulation)'],
          ['Export comptable', 'FEC norme française, CSV personnalisé, rapport mensuel PDF, export propriétaires tiers'],
        ]}
      />

      {/* Pour qui */}
      <H2>Pour qui ?</H2>
      <Ul>
        <Li><strong>Loueurs Getaround professionnels</strong> avec 1 à 30+ véhicules</Li>
        <Li><strong>Multi-sites</strong> : Marseille, Aix, Lyon, Paris, Bordeaux…</Li>
        <Li><strong>Structures avec plusieurs rôles</strong> : admin, exploitant, carkeeper, comptable</Li>
        <Li><strong>Gestionnaires</strong> de propriétaires tiers (reverse facturation)</Li>
      </Ul>

      {/* Plans */}
      <H2>Plans & Tarifs</H2>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { plan: 'Starter', price: 'Sur devis', features: ['Flotte jusqu\'à 5 véhicules', 'Planning + Locations', 'Messages IA basiques', 'Export CSV'] },
          { plan: 'Pro', price: 'Sur devis', hot: true, features: ['Flotte illimitée', 'Intelligence + Forecast', 'Séquences automatiques', 'Export FEC', 'Rapport CEO', 'Score de risque'] },
          { plan: 'Enterprise', price: 'Sur devis', features: ['Tout Pro inclus', 'SLA prioritaire', 'Onboarding dédié', 'API accès', 'Multi-tenants'] },
        ].map(p => (
          <div key={p.plan} className={`rounded-2xl border p-5 print-avoid-break ${p.hot ? 'text-white shadow-lg' : 'bg-white border-gray-200'}`}
            style={p.hot ? { backgroundColor: PRIMARY, borderColor: PRIMARY } : {}}>
            <p className={`text-xs font-bold uppercase tracking-widest ${p.hot ? 'text-white/70' : 'text-gray-400'}`}>{p.plan}</p>
            <p className={`mt-1 text-2xl font-bold ${p.hot ? 'text-white' : 'text-gray-900'}`}>{p.price}</p>
            <ul className={`mt-3 space-y-1.5 text-xs ${p.hot ? 'text-white/90' : 'text-gray-600'}`}>
              {p.features.map(f => <li key={f} className="flex gap-1.5"><span>✓</span>{f}</li>)}
            </ul>
          </div>
        ))}
      </div>

      {/* Témoignage */}
      <H2>Témoignage — Sun and Drive, Marseille/Aix</H2>
      <blockquote className="my-5 rounded-2xl border-l-4 bg-gray-50 p-5 print-avoid-break" style={{ borderColor: PRIMARY }}>
        <p className="text-sm italic text-gray-700 leading-relaxed">
          "Avant SunanddriveOS, on gérait 7 véhicules avec Excel et 3 onglets Getaround ouverts en permanence.
          On perdait 5 heures par semaine rien qu'à suivre les locations et répondre aux messages.
          Aujourd'hui, les séquences gèrent 90% des messages automatiquement, on voit en temps réel
          quelle voiture est rentable, et l'export FEC nous a fait gagner 2 jours par mois côté comptabilité.
          Le Rapport CEO chaque mois, c'est devenu notre outil de pilotage principal."
        </p>
        <p className="mt-3 text-xs font-semibold" style={{ color: PRIMARY }}>— Gérant, Sun and Drive · 7 véhicules · Marseille &amp; Aix-en-Provence</p>
      </blockquote>

      {/* FAQ */}
      <H2>Questions fréquentes</H2>
      {[
        { q: 'Mes données Getaround sont-elles sécurisées ?', a: 'Oui. Chaque tenant a sa propre base de données PostgreSQL isolée. Vos données ne sont jamais mélangées avec d\'autres clients. Les communications sont chiffrées HTTPS via Cloudflare.' },
        { q: 'Faut-il abandonner Getaround ?', a: 'Non. SunanddriveOS se connecte à votre compte Getaround existant via l\'API officielle et synchronise automatiquement toutes vos données. Vous continuez à utiliser Getaround normalement.' },
        { q: 'C\'est complexe à mettre en place ?', a: 'La prise en main est guidée : un assistant en 6 étapes vous configure l\'application en moins de 30 minutes. Aucune compétence technique requise.' },
        { q: 'Quel est le prix exact ?', a: 'Le tarif dépend de votre nombre de véhicules et de vos besoins. Contactez-nous pour un devis personnalisé adapté à votre flotte.' },
      ].map(f => (
        <div key={f.q} className="mb-3 rounded-xl border border-gray-200 bg-white p-4 print-avoid-break">
          <p className="text-sm font-semibold text-gray-900">❓ {f.q}</p>
          <p className="mt-1 text-sm text-gray-600">{f.a}</p>
        </div>
      ))}

      {/* CTA */}
      <div className="mt-8 rounded-2xl p-8 text-center text-white print-avoid-break" style={{ backgroundColor: PRIMARY }}>
        <p className="text-2xl font-bold">Démarrez votre essai gratuit 15 jours</p>
        <p className="mt-2 text-sm opacity-80">Sans engagement · Configuration en 30 minutes · Support inclus</p>
        <a href="mailto:contact@sunanddrive.com"
          className="mt-4 inline-block rounded-xl bg-white/20 px-6 py-3 text-sm font-semibold hover:bg-white/30 print:hidden">
          Nous contacter →
        </a>
        <p className="print-only mt-3 text-sm opacity-75">Contactez-nous via votre tableau de bord</p>
      </div>
    </div>
  );
}

// ─── DOCUMENT 2 — Prise en main rapide ───────────────────────────────────────

function DocQuickStart() {
  return (
    <div className="mx-auto max-w-3xl">
      <H1>Guide de prise en main rapide</H1>
      <P>Ce guide vous permet d'être opérationnel en moins d'une heure. Suivez les étapes dans l'ordre.</P>

      <InfoBox>
        <strong>Avant de commencer :</strong> Assurez-vous d'avoir votre clé API Getaround (disponible dans votre espace pro Getaround → Paramètres → API).
      </InfoBox>

      <H2>1. Connexion et première navigation</H2>
      <Step n={1} title="Accéder à l'application">
        Ouvrez <code className="rounded bg-gray-100 px-1 text-xs">https://appli.sunanddrive.com</code> dans votre navigateur. L'application fonctionne sur mobile et desktop.
      </Step>
      <Step n={2} title="Se connecter">
        Saisissez votre email et mot de passe fournis par votre administrateur. Le jeton est valide 7 jours — vous resterez connecté automatiquement.
      </Step>
      <Step n={3} title="Découvrir la navigation">
        La barre latérale (sidebar) regroupe tous les modules. Sur mobile, elle s'ouvre via l'icône menu ☰ en haut à gauche.
      </Step>

      <H2>2. Connecter votre compte Getaround</H2>
      <Step n={1} title="Aller dans Paramètres">
        Dans la sidebar, cliquez sur <strong>Paramètres</strong> → onglet <strong>Comptes Getaround</strong>.
      </Step>
      <Step n={2} title="Ajouter votre clé API">
        Cliquez sur <strong>+ Ajouter un compte</strong>, entrez votre clé API Getaround et un nom descriptif (ex : "Compte principal").
      </Step>
      <Step n={3} title="Lancer la synchronisation">
        Cliquez sur <strong>Synchroniser</strong>. La première synchronisation importe vos véhicules, locations et messages. Elle peut prendre 2 à 5 minutes selon le volume.
      </Step>
      <InfoBox>La synchronisation tourne ensuite automatiquement toutes les heures en arrière-plan.</InfoBox>

      <H2>3. Comprendre le tableau de bord</H2>
      <P>Le tableau de bord affiche les KPIs essentiels de votre flotte :</P>
      <Ul>
        <Li><strong>CA du mois</strong> : revenus encaissés + prévisionnels</Li>
        <Li><strong>Locations actives</strong> : nombre de véhicules en cours de location</Li>
        <Li><strong>Taux d'occupation</strong> : pourcentage de disponibilité utilisé</Li>
        <Li><strong>Messages en attente</strong> : conversations nécessitant votre attention</Li>
        <Li><strong>Alertes</strong> : CT à renouveler, stocks sièges bas, véhicules bloqués</Li>
        <Li><strong>Copilote IA</strong> : posez des questions en langage naturel sur votre flotte</Li>
      </Ul>

      <H2>4. Le planning : lire et naviguer</H2>
      <Step n={1} title="Accéder au Planning">
        Cliquez sur <strong>Planning</strong> dans la sidebar. La vue Gantt s'affiche avec vos véhicules en lignes et le temps en colonnes.
      </Step>
      <Step n={2} title="Changer la période">
        Utilisez les boutons <strong>7j / 14j / 28j</strong> pour ajuster le zoom. Les boutons ← → naviguent dans le temps. "← 6 mois" revient 6 mois en arrière.
      </Step>
      <Step n={3} title="Lire les barres">
        Chaque barre colorée représente une location. Passez la souris dessus pour voir le locataire, les dates et le montant. Les zones grisées sont des blocages.
      </Step>

      <H2>5. Les messages : approuver une suggestion IA</H2>
      <Step n={1} title="Ouvrir Messages">
        Cliquez sur <strong>Messages</strong>. Les conversations sont listées par date, avec un badge rouge indiquant les messages non lus.
      </Step>
      <Step n={2} title="Voir la suggestion IA">
        Ouvrez une conversation. L'IA propose automatiquement une réponse pré-rédigée dans la zone de texte, adaptée au contexte (siège auto, carburant, retard, etc.).
      </Step>
      <Step n={3} title="Approuver ou modifier">
        Lisez la suggestion. Si elle convient, cliquez <strong>Envoyer</strong>. Sinon, modifiez le texte avant d'envoyer.
      </Step>

      <H2>6. Ajouter vos coûts fixes (rentabilité)</H2>
      <Step n={1} title="Aller dans Rentabilité">
        Cliquez sur <strong>Rentabilité</strong> dans la sidebar.
      </Step>
      <Step n={2} title="Ouvrir un véhicule">
        Cliquez sur un véhicule dans la liste. La fiche affiche les revenus et les coûts.
      </Step>
      <Step n={3} title="Ajouter des coûts">
        Cliquez sur <strong>+ Ajouter un coût</strong>. Entrez le libellé (ex : "Assurance AON"), le montant mensuel et le type (fixe ou variable). Le système calcule automatiquement la marge nette.
      </Step>

      <H2>7. Paramétrer vos séquences de messages</H2>
      <Step n={1} title="Aller dans Séquences">
        Cliquez sur <strong>Séquences</strong> dans la sidebar.
      </Step>
      <Step n={2} title="Créer une séquence">
        Cliquez sur <strong>+ Nouvelle séquence</strong>. Choisissez le trigger (ex : "Réservation confirmée") et la condition (délai avant/après événement).
      </Step>
      <Step n={3} title="Rédiger le message">
        Rédigez le message en utilisant les variables disponibles : <code className="bg-gray-100 px-1 text-xs rounded">{`{{prenom}}`}</code>, <code className="bg-gray-100 px-1 text-xs rounded">{`{{vehicule}}`}</code>, <code className="bg-gray-100 px-1 text-xs rounded">{`{{date_depart}}`}</code>, etc.
      </Step>
      <Step n={4} title="Tester avant d'activer">
        Cliquez sur <strong>Tester</strong> pour voir un aperçu interpolé avec de vraies données. Puis activez la séquence.
      </Step>

      <H2>8. Lancer votre premier export comptable</H2>
      <Step n={1} title="Aller dans Exports">
        Cliquez sur <strong>Exports</strong> dans la sidebar.
      </Step>
      <Step n={2} title="Choisir la période">
        Sélectionnez le mois à exporter. Vous pouvez aussi choisir une année entière pour l'export FEC annuel.
      </Step>
      <Step n={3} title="Exporter">
        Cliquez sur <strong>Export FEC</strong> (norme française) ou <strong>Export CSV</strong> pour votre tableau de bord. Le fichier se télécharge instantanément.
      </Step>

      <H2>9. Prochaines étapes</H2>
      <Ul>
        <Li><strong>Intelligence</strong> : activez les alertes automatiques (sous-utilisation, chute de note, risque)</Li>
        <Li><strong>Rapport CEO</strong> : générez votre premier rapport mensuel IA (menu Intelligence → Rapport)</Li>
        <Li><strong>Prévisions</strong> : consultez les projections de revenus sur 8 semaines (Intelligence → Prévisions)</Li>
        <Li><strong>Propriétaires tiers</strong> : si vous gérez des véhicules de tiers, configurez les contrats de partage</Li>
        <Li><strong>Carekeepers</strong> : créez des accès Carkeeper pour vos gestionnaires terrain</Li>
      </Ul>
    </div>
  );
}

// ─── DOCUMENT 3 — Manuel utilisateur ─────────────────────────────────────────

function DocManual() {
  return (
    <div className="mx-auto max-w-3xl">
      <H1>Manuel utilisateur complet</H1>
      <P>Référence complète de tous les modules SunanddriveOS. Les sections marquées 🔒 sont réservées aux rôles admin ou Pro/Enterprise.</P>

      <H2>1. Introduction et navigation générale</H2>
      <H3>Rôles utilisateur</H3>
      <Table
        headers={['Rôle', 'Accès', 'Restrictions']}
        rows={[
          ['admin', 'Tous les modules', 'Aucune'],
          ['exploitation', 'Planning, Messages, Locations, Flotte', 'Pas de Paramètres, pas d\'Exports'],
          ['carkeeper', 'Planning (lecture), Alertes, Carburant', 'Accès très limité'],
          ['comptable', 'Exports, Rentabilité', 'Lecture seule sur les autres modules'],
        ]}
      />
      <H3>Navigation</H3>
      <Ul>
        <Li>La sidebar est rétractable (bouton ← en bas) pour gagner de l'espace sur les petits écrans</Li>
        <Li>Sur mobile, la sidebar s'ouvre/ferme via l'icône ☰ dans le header</Li>
        <Li>Le header affiche la cloche 🔔 des notifications et le profil utilisateur</Li>
        <Li>Les routes protégées redirigent automatiquement vers /dashboard si non authentifié</Li>
      </Ul>

      <H2>2. Tableau de bord</H2>
      <H3>KPIs principaux</H3>
      <Ul>
        <Li><strong>CA encaissé</strong> : virements Getaround reçus sur le mois en cours</Li>
        <Li><strong>CA prévisionnel</strong> : revenus attendus des locations en cours et futures</Li>
        <Li><strong>Taux d'occupation</strong> : jours loués / jours disponibles × 100</Li>
        <Li><strong>Messages en attente</strong> : conversations sans réponse depuis plus de 2h</Li>
      </Ul>
      <H3>Copilote IA</H3>
      <P>Le copilote IA répond à des questions en langage naturel sur votre flotte. Exemples : "Quel est mon véhicule le plus rentable ce mois ?" ou "Quelles sont mes locations annulées cette semaine ?"</P>
      <H3>Alertes actives</H3>
      <P>Le dashboard liste les alertes en cours : CT à moins de 30 jours, stock sièges auto bas, notes Getaround en chute, véhicules sous-utilisés, locataires à risque élevé.</P>

      <H2>3. Planning</H2>
      <H3>Vues disponibles</H3>
      <Ul>
        <Li><strong>7 jours</strong> : vue détaillée avec heures, idéale pour le suivi quotidien</Li>
        <Li><strong>14 jours</strong> : équilibre entre détail et vue d'ensemble</Li>
        <Li><strong>28 jours</strong> : vue mensuelle pour la planification</Li>
      </Ul>
      <H3>Navigation temporelle</H3>
      <Ul>
        <Li>Boutons ← / → : déplacer la période d'un intervalle</Li>
        <Li>Bouton "Auj." : revenir à la semaine courante</Li>
        <Li>Bouton "← 6 mois" : revenir 6 mois en arrière pour consulter l'historique</Li>
      </Ul>
      <H3>Blocages véhicule</H3>
      <P>Un blocage représente une indisponibilité manuelle (entretien, réservation privée, panne). Lors de la création, l'option <strong>Bloquer sur Getaround</strong> synchronise l'indisponibilité directement sur votre compte Getaround.</P>
      <H3>Codes couleur</H3>
      <Ul>
        <Li>Vert foncé : location confirmée</Li>
        <Li>Bleu : location en cours</Li>
        <Li>Gris : blocage manuel</Li>
        <Li>Orange : location annulée (archivée)</Li>
      </Ul>

      <H2>4. Locations</H2>
      <H3>Liste mensuelle</H3>
      <P>Les locations sont affichées par mois avec navigation mois par mois. Le header de chaque groupe affiche le nombre de locations et le CA total du mois. Des filtres permettent de filtrer par statut (réservée, en cours, terminée, annulée).</P>
      <H3>Fiche location</H3>
      <Ul>
        <Li>Informations locataire, véhicule, dates, durée</Li>
        <Li>Montant brut Getaround, revenus nets, statut paiement</Li>
        <Li>Historique des messages liés à cette location</Li>
        <Li>Évaluation du locataire (notes Getaround)</Li>
        <Li>Factures et charges associées</Li>
      </Ul>
      <H3>Statuts financiers</H3>
      <Table
        headers={['Statut', 'Signification']}
        rows={[
          ['Encaissé ✓', 'Virement Getaround reçu et rapproché'],
          ['À encaisser', 'Paiement prévu mais pas encore reçu'],
          ['Prévisionnel', 'Location future, revenus estimés'],
          ['Annulé', 'Location annulée — montant nul ou compensation éventuelle'],
        ]}
      />

      <H2>5. Messages</H2>
      <H3>Liste des conversations</H3>
      <P>Chaque conversation correspond à une location Getaround. Les conversations non lues sont marquées d'un badge rouge. Le filtre permet de voir uniquement les messages nécessitant une action.</P>
      <H3>Suggestion IA</H3>
      <Ul>
        <Li>L'IA analyse le contexte de la conversation (type de demande, historique locataire, données véhicule)</Li>
        <Li>Elle génère une réponse adaptée au ton configuré (vouvoiement ou tutoiement)</Li>
        <Li>Vous pouvez modifier la suggestion avant envoi</Li>
        <Li>L'IA apprend du contexte : sièges auto, carburant manquant, retard, incident…</Li>
      </Ul>
      <H3>Séquences automatiques</H3>
      <P>Les séquences envoient des messages automatiquement sans intervention. Elles fonctionnent par triggers (événement) et délais configurables. Voir la section 13 pour la configuration détaillée.</P>

      <H2>6. Flotte</H2>
      <H3>Liste véhicules</H3>
      <P>Les véhicules sont groupés par point de livraison. La vue liste et la vue grille sont disponibles. Chaque vignette affiche la plaque, la note Getaround, le Crit'Air et le statut.</P>
      <H3>Fiche véhicule</H3>
      <Ul>
        <Li><strong>Onglet Général</strong> : informations techniques, Crit'Air, date d'achat, prix d'achat</Li>
        <Li><strong>Blocages</strong> : créer et gérer les indisponibilités du véhicule</Li>
        <Li><strong>Coûts</strong> : charges fixes et variables associées (depuis ici ou depuis Rentabilité)</Li>
        <Li><strong>Notes Getaround</strong> : historique et tendance des évaluations locataires</Li>
        <Li><strong>Carekeepers</strong> : assigner des responsables terrain pour ce véhicule</Li>
        <Li><strong>Estimation Autobiz</strong> : valeur marché actuelle via l'API Autobiz (si configuré)</Li>
        <Li><strong>QR Code</strong> : générer un QR code pointant vers la fiche publique du véhicule</Li>
      </Ul>

      <H2>7. Vie du véhicule</H2>
      <H3>Contrôles techniques (CT)</H3>
      <P>Enregistrez les CT avec date de passage et date d'expiration. L'application génère une alerte automatique avant l'expiration (délai configurable dans Paramètres, par défaut 30 jours).</P>
      <H3>Entretiens</H3>
      <P>Listez les entretiens avec type (vidange, pneus, freins…), kilométrage et date. Les entretiens planifiés génèrent des rappels.</P>
      <H3>Documents</H3>
      <P>Stockez les documents liés au véhicule : carte grise, assurance, contrats. Accès rapide depuis la fiche véhicule.</P>

      <H2>8. Locataires</H2>
      <H3>Profil locataire</H3>
      <Ul>
        <Li>Historique complet des locations chez vous</Li>
        <Li>Score de risque calculé : 4 niveaux (faible / modéré / élevé / critique)</Li>
        <Li>Indicateurs : taux d'annulation, retards, incidents signalés, note moyenne</Li>
      </Ul>
      <H3>Listes VIP et Blacklist</H3>
      <P>Marquez un locataire comme VIP (traitement prioritaire) ou Blacklist (refus automatique suggéré). Ces statuts s'affichent dans les conversations et la fiche location.</P>
      <H3>Score de risque 🔒</H3>
      <P>Le score est calculé sur 0-100 selon : historique locations (50%), annulations (20%), incidents (15%), retards (15%). Seuil d'alerte configurable dans Paramètres → Intelligence.</P>

      <H2>9. Accessoires</H2>
      <H3>Stock sièges auto</H3>
      <P>Gérez votre stock de sièges enfant par tranche de poids (0-9kg, 9-18kg, 15-36kg). Les demandes locataires génèrent une réservation liée à la location.</P>
      <H3>Flux approbation</H3>
      <Ul>
        <Li><strong>Mode Auto</strong> : l'IA valide et répond directement au locataire</Li>
        <Li><strong>Mode Approbation</strong> : l'IA propose une réponse que vous validez</Li>
        <Li><strong>Mode Manuel</strong> : vous gérez entièrement</Li>
      </Ul>
      <H3>Alerte rupture</H3>
      <P>Une alerte est déclenchée quand le stock d'une tranche tombe à 0. Elle apparaît dans le tableau de bord et dans les notifications.</P>
      <H3>Autres accessoires</H3>
      <P>Gérez les équipements optionnels (chargeurs, GPS, etc.) avec un système de réservation par date.</P>

      <H2>10. Rentabilité</H2>
      <H3>Marge nette par véhicule</H3>
      <P>La marge nette = revenus Getaround nets − coûts fixes mensuels − coûts variables. Le tableau de bord rentabilité classe vos véhicules par performance.</P>
      <H3>Coûts fixes</H3>
      <P>Exemples : Assurance AON (mensuel), Boîtier Connect (montant configurable dans Paramètres), Parking. Ces coûts sont récurrents chaque mois.</P>
      <H3>Coûts variables</H3>
      <P>Exemples : Entretien ponctuel, réparation, amende. Saisis à la date de l'événement.</P>
      <H3>Objectif et simulateur</H3>
      <P>Définissez un objectif mensuel par véhicule. Le simulateur vous montre combien de jours de location supplémentaires sont nécessaires pour l'atteindre.</P>

      <H2>11. Intelligence 🔒</H2>
      <H3>Alertes automatiques</H3>
      <Ul>
        <Li>Véhicule sous-utilisé : taux d'occupation sous le seuil sur N semaines</Li>
        <Li>Chute de note Getaround : note inférieure au seuil configuré</Li>
        <Li>Locataire à risque : score risque au-dessus du seuil</Li>
        <Li>Benchmark : véhicule sous-performant vs la moyenne de la flotte</Li>
      </Ul>
      <H3>Corrélation météo-revenus</H3>
      <P>Analyse la corrélation entre les données météorologiques et vos revenus par véhicule sur les derniers mois. Utile pour anticiper les périodes creuses.</P>
      <H3>Benchmark flotte</H3>
      <P>Compare chaque véhicule à la moyenne de votre flotte sur : CA, taux d'occupation, note, incidents. Identifie les sous-performants et les meilleurs.</P>
      <H3>Prévisions (Forecast)</H3>
      <P>Projections de revenus sur 8 semaines glissantes, avec distinction encaissé / prévisionnel. Graphique AreaChart et tableau détaillé.</P>

      <H2>12. Rapport CEO 🔒</H2>
      <P>Le Rapport CEO est une synthèse exécutive mensuelle ou annuelle générée par l'IA. Il inclut : performance flotte, tendances, incidents, recommandations IA, données météo corrélées.</P>
      <Ul>
        <Li>Navigation mois par mois (boutons ← →)</Li>
        <Li>Mode annuel disponible pour la synthèse annuelle</Li>
        <Li>Impression/export PDF via le bouton Imprimer</Li>
        <Li>Régénération possible à tout moment</Li>
      </Ul>

      <H2>13. Séquences 🔒</H2>
      <H3>Triggers disponibles</H3>
      <Table
        headers={['Trigger', 'Moment d\'envoi']}
        rows={[
          ['Réservation confirmée', 'À la confirmation de la réservation'],
          ['Avant départ', 'X heures avant le début de la location'],
          ['Après retour', 'X heures après la fin de la location'],
          ['Annulation', 'Dès la détection d\'une annulation'],
        ]}
      />
      <H3>Variables disponibles</H3>
      <Ul>
        <Li><code className="bg-gray-100 px-1 text-xs rounded">{`{{prenom}}`}</code> — prénom du locataire</Li>
        <Li><code className="bg-gray-100 px-1 text-xs rounded">{`{{vehicule}}`}</code> — marque et modèle</Li>
        <Li><code className="bg-gray-100 px-1 text-xs rounded">{`{{date_depart}}`}</code> et <code className="bg-gray-100 px-1 text-xs rounded">{`{{date_retour}}`}</code></Li>
        <Li><code className="bg-gray-100 px-1 text-xs rounded">{`{{adresse}}`}</code> — point de livraison</Li>
      </Ul>
      <H3>Historique</H3>
      <P>L'historique affiche chaque envoi avec statut (envoyé, échec, ignoré), horodatage et aperçu du message interpolé.</P>

      <H2>14. Exports 🔒</H2>
      <Ul>
        <Li><strong>FEC</strong> : Fichier des Écritures Comptables au format norme française. Exigé par l'administration fiscale si contrôlé.</Li>
        <Li><strong>CSV</strong> : export tabulaire des locations avec tous les champs financiers. Compatible Excel et Google Sheets.</Li>
        <Li><strong>Rapport mensuel</strong> : synthèse PDF des locations, revenus et coûts du mois.</Li>
        <Li><strong>Relevé propriétaires tiers</strong> : tableau de partage des revenus selon le % contractuel défini.</Li>
      </Ul>

      <H2>15. Paramètres</H2>
      <H3>Comptes Getaround</H3>
      <P>Ajoutez plusieurs comptes Getaround avec leurs clés API. Chaque compte est synchronisé indépendamment. La dernière synchronisation est affichée avec son statut.</P>
      <H3>Équipe et rôles</H3>
      <P>Invitez des utilisateurs par email et assignez leur rôle. Les rôles multiples sont supportés (ex : admin + carkeeper).</P>
      <H3>Notifications</H3>
      <P>Configurez les adresses email de destination pour les alertes automatiques. Jusqu'à 10 adresses.</P>
      <H3>Comptabilité</H3>
      <P>Paramétrez les codes journaux et comptes comptables pour l'export FEC. Valeurs par défaut conformes au plan comptable général.</P>
      <H3>Thème</H3>
      <P>Personnalisez les couleurs primaire, secondaire et accent, le logo et la police. Chaque modification est appliquée immédiatement.</P>

      <H2>16. Rôle Carkeeper</H2>
      <P>Le Carkeeper est un gestionnaire terrain avec accès limité. Il peut :</P>
      <Ul>
        <Li>Consulter le planning (lecture seule)</Li>
        <Li>Voir les alertes assignées à ses véhicules</Li>
        <Li>Signaler un niveau de carburant</Li>
        <Li>Accéder aux fiches véhicule de son périmètre</Li>
        <Li>Gérer les sièges auto hors service</Li>
      </Ul>
      <P>Le Carkeeper n'a pas accès à : Rentabilité, Intelligence, Exports, Paramètres, Messages, Séquences.</P>

      <H2>17. SuperAdmin (accès restreint)</H2>
      <P>L'interface SuperAdmin est accessible via <code className="bg-gray-100 px-1 text-xs rounded">/superadmin</code> avec des identifiants séparés. Elle permet de gérer les tenants SaaS, les plans, les facturations Stripe et les migrations de données.</P>
    </div>
  );
}

// ─── DOCUMENT 4 — Dossier technique ──────────────────────────────────────────

function DocTechnical() {
  return (
    <div className="mx-auto max-w-3xl">
      <H1>Dossier technique développeur</H1>
      <P>Documentation technique pour tout développeur indépendant reprenant le projet SunanddriveOS.</P>

      <H2>1. Architecture générale</H2>
      <H3>Stack frontend</H3>
      <Ul>
        <Li>React 18 + TypeScript + Vite (PWA-ready)</Li>
        <Li>Tailwind CSS (design system), Biome (lint/format — pas ESLint/Prettier)</Li>
        <Li>TanStack Query v5 (data fetching, cache), React Router v6 (routing SPA)</Li>
        <Li>Recharts (graphiques), date-fns (dates), Lucide React (icônes)</Li>
        <Li>JWT stocké en <code className="bg-gray-100 px-1 text-xs rounded">localStorage</code> sous la clé <code className="bg-gray-100 px-1 text-xs rounded">auth_token</code> (tenant) et <code className="bg-gray-100 px-1 text-xs rounded">superadmin_token</code></Li>
      </Ul>
      <H3>Stack backend</H3>
      <Ul>
        <Li>Node.js + Express + TypeScript (tsup pour le build)</Li>
        <Li>Prisma ORM — deux schémas : master et tenant</Li>
        <Li>PostgreSQL — une DB master + une DB par tenant</Li>
        <Li>Zod (validation entrées), tsx (dev watch), tsup (build production)</Li>
        <Li>Claude Sonnet via SDK Anthropic (IA), Nodemailer (emails)</Li>
      </Ul>
      <H3>Infrastructure</H3>
      <Ul>
        <Li>NAS Synology DS224+ (auto-hébergé)</Li>
        <Li>Docker Compose (frontend Nginx + backend Node + PostgreSQL)</Li>
        <Li>Cloudflare Tunnel — expose le NAS sans IP publique</Li>
        <Li>Nginx — reverse proxy interne, sert le frontend et proxifie /api vers backend</Li>
        <Li>GitHub : <code className="bg-gray-100 px-1 text-xs rounded">cedricfrancoiscf-sudo/sunanddriveos</code></Li>
      </Ul>

      <H2>2. Multi-tenancy</H2>
      <P>Chaque tenant (client SaaS) a sa propre base de données PostgreSQL. La base master contient uniquement la liste des tenants et leurs métadonnées.</P>
      <Table
        headers={['Base', 'Contenu', 'Schéma Prisma']}
        rows={[
          ['master', 'Company, Plan, SuperAdmin, StripePayment', 'src/prisma/master/schema.prisma'],
          ['tenant_{slug}', 'Vehicle, Rental, Message, User, CompanySettings…', 'src/prisma/tenant/schema.prisma'],
        ]}
      />
      <H3>Résolution du tenant</H3>
      <P>Le middleware <code className="bg-gray-100 px-1 text-xs rounded">requireAuth</code> décode le JWT, récupère le slug du tenant depuis le payload, interroge la base master pour obtenir le <code className="bg-gray-100 px-1 text-xs rounded">tenantDbUrl</code>, et injecte le client Prisma tenant dans <code className="bg-gray-100 px-1 text-xs rounded">req.tenantDbUrl</code>.</P>

      <H2>3. Authentification</H2>
      <H3>Flow tenant</H3>
      <Ul>
        <Li>POST <code className="bg-gray-100 px-1 text-xs rounded">/api/v1/auth/login</code> — body : email, password, slug</Li>
        <Li>Réponse : JWT signé HS256, expiration 7 jours, payload : userId, tenantSlug, role, roles[]</Li>
        <Li>Stockage client : localStorage <code className="bg-gray-100 px-1 text-xs rounded">auth_token</code></Li>
        <Li>Header API : <code className="bg-gray-100 px-1 text-xs rounded">Authorization: Bearer &lt;token&gt;</code></Li>
      </Ul>
      <H3>Rôles</H3>
      <Ul>
        <Li><code className="bg-gray-100 px-1 text-xs rounded">admin</code> : accès total</Li>
        <Li><code className="bg-gray-100 px-1 text-xs rounded">exploitation</code> : opérationnel sans admin</Li>
        <Li><code className="bg-gray-100 px-1 text-xs rounded">carkeeper</code> : terrain uniquement</Li>
        <Li><code className="bg-gray-100 px-1 text-xs rounded">comptable</code> : exports et rentabilité</Li>
        <Li>Multi-rôles : champ <code className="bg-gray-100 px-1 text-xs rounded">roles JSON[]</code> sur le modèle User</Li>
      </Ul>
      <H3>SuperAdmin</H3>
      <P>Flow séparé : POST <code className="bg-gray-100 px-1 text-xs rounded">/api/v1/auth/superadmin/login</code>. Token stocké dans <code className="bg-gray-100 px-1 text-xs rounded">superadmin_token</code>. Routes protégées par <code className="bg-gray-100 px-1 text-xs rounded">requireSuperAdmin</code> middleware. Interface à <code className="bg-gray-100 px-1 text-xs rounded">/superadmin</code>.</P>

      <H2>4. API Getaround</H2>
      <H3>Contraintes connues</H3>
      <Ul>
        <Li>Base URL : <code className="bg-gray-100 px-1 text-xs rounded">https://api-eu.getaround.com/owner/v1</code></Li>
        <Li>Fenêtre max par requête : 30 jours (<code className="bg-gray-100 px-1 text-xs rounded">from</code> / <code className="bg-gray-100 px-1 text-xs rounded">to</code> obligatoires)</Li>
        <Li>Payouts : pas de paramètre <code className="bg-gray-100 px-1 text-xs rounded">per_page</code> supporté — pagination manuelle</Li>
        <Li>Détection annulation : la location retourne 404 sur l'endpoint checkin → statut "cancelled"</Li>
        <Li>Rate limiting : respecter les délais inter-requêtes (sleep de 200ms entre appels)</Li>
      </Ul>
      <H3>Cron de synchronisation</H3>
      <Table
        headers={['Fréquence', 'Action']}
        rows={[
          ['Toutes les heures', 'syncAllAccounts — véhicules, locations, messages, payouts'],
          ['Toutes les 6h', 'syncAccountInvoicesPayouts — rapprochement factures'],
          ['Quotidien', 'analyzeExistingMessages — relance IA sur messages non traités'],
        ]}
      />

      <H2>5. Modules backend</H2>
      <P>Tous les modules sont montés sous <code className="bg-gray-100 px-1 text-xs rounded">/api/v1/</code> dans <code className="bg-gray-100 px-1 text-xs rounded">app.ts</code>.</P>
      <Table
        headers={['Préfixe', 'Module', 'Auth requise']}
        rows={[
          ['/auth', 'Authentification', 'Publique'],
          ['/vehicles', 'Flotte', 'requireAuth'],
          ['/rentals', 'Locations', 'requireAuth'],
          ['/messages', 'Messages', 'requireAuth'],
          ['/planning', 'Planning + indisponibilités', 'requireAuth'],
          ['/intelligence', 'KPIs, alertes, corrélation, forecast', 'requireAuth + requirePlan(pro)'],
          ['/sequences', 'Séquences automatiques', 'requireAuth + requirePlan(pro)'],
          ['/export', 'FEC, CSV, PDF', 'requireAuth + requirePlan(pro)'],
          ['/settings', 'CompanySettings', 'requireRole(admin)'],
          ['/accessories', 'Sièges, accessoires', 'requireAuth'],
          ['/scoring', 'Score conducteurs', 'requireAuth + requirePlan(pro)'],
          ['/superadmin', 'Gestion tenants', 'requireSuperAdmin'],
        ]}
      />

      <H2>6. Base de données</H2>
      <H3>Tables principales (schema tenant)</H3>
      <Table
        headers={['Table', 'Description', 'Relations clés']}
        rows={[
          ['Vehicle', 'Véhicule de la flotte', 'GetaroundAccount, VehicleCost, Rental'],
          ['Rental', 'Location Getaround', 'Vehicle, Message[]'],
          ['Message', 'Message locataire', 'Rental, ConversationSuggestion'],
          ['VehicleCost', 'Coût associé à un véhicule', 'Vehicle'],
          ['BlockedPeriod', 'Blocage manuel', 'Vehicle'],
          ['CompanySettings', 'Configuration tenant (1 ligne par tenant)', '—'],
          ['GetaroundAccount', 'Compte API Getaround', 'Vehicle[]'],
          ['SequenceTemplate', 'Modèle de séquence', 'SequenceLog[]'],
          ['CarSeatRequest', 'Demande siège auto', 'Rental'],
          ['ThirdPartyOwner', 'Propriétaire tiers', 'Vehicle[]'],
        ]}
      />
      <H3>Migrations</H3>
      <P>Répertoire : <code className="bg-gray-100 px-1 text-xs rounded">backend/src/prisma/tenant/migrations/</code>. Chaque migration est un dossier horodaté avec <code className="bg-gray-100 px-1 text-xs rounded">migration.sql</code>. Commande d'application : <code className="bg-gray-100 px-1 text-xs rounded">prisma migrate deploy</code>.</P>

      <H2>7. Intelligence IA</H2>
      <H3>Modèle</H3>
      <P>Claude Sonnet (claude-sonnet-4-6) via le SDK Anthropic officiel. Variable d'env : <code className="bg-gray-100 px-1 text-xs rounded">ANTHROPIC_API_KEY</code>.</P>
      <H3>Usages</H3>
      <Ul>
        <Li><strong>Suggestions messages</strong> : analyse du contexte conversation + location + véhicule</Li>
        <Li><strong>Copilote dashboard</strong> : questions en langage naturel avec accès aux KPIs</Li>
        <Li><strong>Rapport CEO</strong> : synthèse avec tool <code className="bg-gray-100 px-1 text-xs rounded">web_search</code> pour données de marché</Li>
        <Li><strong>Analyse location</strong> : post-retour pour détection incidents et score locataire</Li>
      </Ul>

      <H2>8. Déploiement</H2>
      <H3>Commande de mise en production</H3>
      <CodeBlock>{`# Sur le NAS (SSH)
cd /volume1/docker/sunanddriveos
sudo git fetch origin main
sudo git reset --hard origin/main
sudo docker-compose up --build -d
# Vérification
./scripts/post-build-check.sh`}</CodeBlock>
      <H3>Variables d'environnement requises</H3>
      <Table
        headers={['Variable', 'Description']}
        rows={[
          ['DATABASE_MASTER_URL', 'URL PostgreSQL de la base master'],
          ['JWT_SECRET', 'Secret de signature JWT (min 32 chars)'],
          ['ANTHROPIC_API_KEY', 'Clé API Anthropic pour Claude'],
          ['STRIPE_SECRET_KEY', 'Clé secrète Stripe (billing)'],
          ['STRIPE_WEBHOOK_SECRET', 'Secret de signature webhook Stripe'],
          ['SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS', 'Configuration SMTP emails'],
          ['ENCRYPTION_KEY', 'Clé AES-256 pour chiffrement clés API Getaround (32 bytes hex)'],
          ['VITE_API_BASE_URL', 'URL de l\'API (frontend build, ex : https://appli.sunanddrive.com)'],
        ]}
      />

      <H2>9. Tests Playwright</H2>
      <H3>Configuration</H3>
      <Ul>
        <Li>Config : <code className="bg-gray-100 px-1 text-xs rounded">frontend/playwright.config.ts</code></Li>
        <Li>Auth : <code className="bg-gray-100 px-1 text-xs rounded">tests/e2e/.auth/user.json</code> (tenant) et <code className="bg-gray-100 px-1 text-xs rounded">superadmin.json</code></Li>
        <Li>Setup script : <code className="bg-gray-100 px-1 text-xs rounded">tests/e2e/00-setup.spec.ts</code> — génère les tokens via API login</Li>
        <Li>Base URL : <code className="bg-gray-100 px-1 text-xs rounded">https://appli.sunanddrive.com</code></Li>
        <Li>Tenant slug de test : <code className="bg-gray-100 px-1 text-xs rounded">sun-and-drive</code></Li>
      </Ul>
      <H3>Lancement</H3>
      <CodeBlock>{`# Depuis frontend/
npx playwright test --headed --reporter=list
# Un spec spécifique :
npx playwright test tests/e2e/28-monkey-admin.spec.ts
# Mode UI interactif :
pnpm test:e2e:ui`}</CodeBlock>
      <H3>Convention specs</H3>
      <P>Numérotation stricte : <code className="bg-gray-100 px-1 text-xs rounded">00-setup</code> → <code className="bg-gray-100 px-1 text-xs rounded">28-monkey-admin</code> → <code className="bg-gray-100 px-1 text-xs rounded">32..40</code>. Le spec 28 est le test "monkey" exhaustif qui navigue dans toute l'application. Les specs 32-40 testent des flux spécifiques (finances, intelligence, séquences, etc.).</P>

      <H2>10. Migration Hetzner</H2>
      <P>Un guide de migration depuis le NAS Synology vers un serveur Hetzner (Cloud VPS) est disponible dans <code className="bg-gray-100 px-1 text-xs rounded">scripts/migration-hetzner.md</code>. Il couvre : export PostgreSQL, transfer Docker Compose, DNS Cloudflare, et validation post-migration.</P>

      <H2>11. Comprendre les écarts avec Getaround</H2>

      <H3>Écart CA : Performance vs Paiements Getaround</H3>
      <P>
        Getaround expose deux vues du CA qui ne coïncident jamais :
      </P>
      <Ul>
        <Li>
          <strong>Onglet Performance GA</strong> : CA estimé basé
          sur le basePrice des locations, attribué au mois de la
          location. GA clôture son compteur vers le 28 du mois et
          bascule les locations en cours sur le mois suivant.
          Vue indicative/prévisionnelle.
        </Li>
        <Li>
          <strong>Onglet Paiements GA</strong> : vrais virements
          reçus le 4 de chaque mois, couvrant les locations dont
          endAt se situe entre ~28/M-1 et ~28/M. Inclut
          dédommagements et autres revenus. Déduit l'abonnement
          Getaround Connect (montant configurable dans Paramètres).
        </Li>
        <Li>
          <strong>SunanddriveOS</strong> : utilise ownerPayout
          synchronisé depuis l'API GA — c'est la référence
          comptable réelle, alignée sur l'onglet Paiements.
          Pour les locations futures (statut booked), ownerPayout
          est null ; c'est grossRevenue (fourni par l'API GA dès
          la réservation, non estimé) qui est utilisé comme
          valeur prévisionnelle. La méthode de répartition du CA
          sur les mois (prorata jours) a été choisie
          délibérément pour sa justesse comptable — elle peut
          donc différer des deux vues Getaround.
        </Li>
      </Ul>

      <H3>Écart taux d'occupation</H3>
      <Ul>
        <Li>
          <strong>Getaround</strong> : joursLoués / joursDisponibles
          (exclut les jours bloqués/indisponibles du dénominateur).
        </Li>
        <Li>
          <strong>SunanddriveOS taux brut</strong> :
          joursLoués / joursCalendaires — méthode conservative,
          performance absolue.
        </Li>
        <Li>
          <strong>SunanddriveOS taux corrigé</strong> :
          joursLoués / (joursCalendaires - joursIndisponibles) —
          comparable à la méthode Getaround, affiché dans
          l'onglet Intelligence.
        </Li>
        <Li>
          L'écart constaté est de 10 à 20 points selon les mois.
          Les deux méthodes sont justes selon leur objectif.
        </Li>
      </Ul>

      <H3>Fenêtre de revente optimale</H3>
      <Ul>
        <Li>
          La valeur marchande est saisie manuellement par
          l'opérateur (source recommandée : vendezvotrevoiture.fr).
        </Li>
        <Li>
          Les taux de décote sont configurables dans Paramètres
          et calculés depuis l'âge réel du véhicule (vehicle.year),
          pas depuis la date d'achat — adapté à une flotte
          achetée d'occasion à 6-8 ans d'ancienneté.
        </Li>
        <Li>
          Le ROI intègre : plus-value nette (valeurMarchande -
          capitalRestant), CA cumulé (grossRevenue pour les
          locations futures), coûts fixes et variables mensuels.
        </Li>
      </Ul>

      <InfoBox>
        <strong>Point d'entrée recommandé pour un nouveau développeur :</strong><br/>
        1. Cloner le repo — 2. Copier <code className="bg-gray-100 px-1 text-xs rounded">.env.example</code> en <code className="bg-gray-100 px-1 text-xs rounded">.env</code> — 3. <code className="bg-gray-100 px-1 text-xs rounded">pnpm generate</code> dans backend/ — 4. <code className="bg-gray-100 px-1 text-xs rounded">pnpm dev</code> dans les deux dossiers — 5. Lire CLAUDE.md à la racine.
      </InfoBox>
    </div>
  );
}

// ─── PAGE PRINCIPALE ──────────────────────────────────────────────────────────

export default function DocumentationPage(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>('brochure');

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 bg-white px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-gray-900" style={{ fontFamily: "'Montserrat', sans-serif" }}>Documentation</h1>
            <p className="text-xs text-gray-500 mt-0.5">Ressources SunanddriveOS — Accès administrateur</p>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 print:hidden"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Imprimer / PDF
          </button>
        </div>

        {/* Onglets */}
        <div className="mt-4 flex gap-1 overflow-x-auto print:hidden" data-testid="doc-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              type="button"
              data-testid={`doc-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              style={activeTab === tab.id ? { backgroundColor: PRIMARY } : {}}
            >
              <span className={`text-xs font-bold ${activeTab === tab.id ? 'text-white/70' : 'text-gray-400'}`}>{tab.num}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Contenu */}
      <div className="flex-1 overflow-y-auto p-6 print:overflow-visible">
        <div className="print:block">
          {activeTab === 'brochure' && <DocBrochure />}
          {activeTab === 'quickstart' && <DocQuickStart />}
          {activeTab === 'manual' && <DocManual />}
          {activeTab === 'technical' && <DocTechnical />}
        </div>
      </div>

      <style>{`
        @page {
          margin: 2cm 2cm 2.5cm 2cm;
        }

        *, *::before, *::after {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        .print-only {
          display: none !important;
        }

        @media print {
          body * { visibility: hidden; }
          .print\\:block, .print\\:block * { visibility: visible; }
          .print\\:hidden { display: none !important; }
          .print\\:overflow-visible { overflow: visible !important; }

          .print-only {
            display: block !important;
            visibility: visible !important;
          }

          .print-avoid-break {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }

          table {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          h2 {
            break-after: avoid;
            page-break-after: avoid;
          }
        }
      `}</style>
    </div>
  );
}

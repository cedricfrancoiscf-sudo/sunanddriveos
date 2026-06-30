import { Router, type Request, type Response } from 'express';
import PDFDocument from 'pdfkit';
import { requireAuth } from '../../middleware/auth';
import { resolveTenant } from '../../middleware/tenant';
import { getTenantClient } from '../../prisma/client';

const router = Router();
router.use(requireAuth, resolveTenant);

// ── Constants PDF ─────────────────────────────────────────────────────────────

const A4_W = 595.28;
const M = 40;
const CW = A4_W - 2 * M; // 515.28
const PRIMARY = '#01696e';
const DARK = '#014a4e';
const DARK_TEXT = '#111827';
const GRAY = '#4b5563';
const LIGHT_TEAL = '#f0fdf4';

// ── Types ─────────────────────────────────────────────────────────────────────

interface BrochureStats {
  caNetAnnuel: number;
  tauxOccupation: number;
  nbLocations: number;
  nbVehicules: number;
}

// ── Stats computation ─────────────────────────────────────────────────────────

async function computeStats(db: ReturnType<typeof getTenantClient>): Promise<BrochureStats> {
  const oneYearAgo = new Date(Date.now() - 365 * 86_400_000);

  const [rentals, nbVehicules] = await Promise.all([
    db.rental.findMany({
      where: { startAt: { gte: oneYearAgo }, status: { notIn: ['cancelled'] } },
      select: { ownerPayout: true, grossRevenue: true, startAt: true, endAt: true },
    }),
    db.vehicle.count({ where: { isActive: true } }),
  ]);

  const caNetAnnuel = Math.round(
    rentals.reduce((s, r) => s + (r.ownerPayout ?? r.grossRevenue ?? 0), 0),
  );
  const nbLocations = rentals.length;

  let totalRentalDays = 0;
  for (const r of rentals) {
    if (r.endAt) {
      const days =
        (new Date(r.endAt).getTime() - new Date(r.startAt).getTime()) / 86_400_000;
      totalRentalDays += Math.max(0, Math.min(days, 31));
    }
  }
  const tauxOccupation =
    nbVehicules > 0
      ? Math.min(100, Math.round((totalRentalDays / (nbVehicules * 365)) * 100))
      : 0;

  return { caNetAnnuel, tauxOccupation, nbLocations, nbVehicules };
}

// ── PDF draw helpers ──────────────────────────────────────────────────────────

function band(doc: PDFKit.PDFDocument, y: number, h: number, color: string): void {
  doc.save().rect(0, y, A4_W, h).fill(color).restore();
}

function fillRect(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  color: string,
): void {
  doc.save().rect(x, y, w, h).fill(color).restore();
}

function strokeRect(
  doc: PDFKit.PDFDocument,
  x: number, y: number, w: number, h: number,
  color: string,
): void {
  doc.save().rect(x, y, w, h).strokeColor(color).lineWidth(0.5).stroke().restore();
}

function hLine(doc: PDFKit.PDFDocument, x: number, y: number, w: number, color: string): void {
  doc.save().moveTo(x, y).lineTo(x + w, y).strokeColor(color).lineWidth(0.5).stroke().restore();
}

function vLine(doc: PDFKit.PDFDocument, x: number, y1: number, y2: number, color: string): void {
  doc.save().moveTo(x, y1).lineTo(x, y2).strokeColor(color).lineWidth(0.5).stroke().restore();
}

function t(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number, y: number,
  opts: {
    w?: number; sz?: number; bold?: boolean; italic?: boolean;
    color?: string; align?: 'left' | 'center' | 'right'; wrap?: boolean;
  } = {},
): void {
  const {
    w = CW, sz = 9, bold = false, italic = false,
    color = DARK_TEXT, align = 'left', wrap = true,
  } = opts;
  const font =
    bold && italic ? 'Helvetica-BoldOblique'
    : bold         ? 'Helvetica-Bold'
    : italic       ? 'Helvetica-Oblique'
    :                'Helvetica';
  doc.font(font).fontSize(sz).fillColor(color)
     .text(text, x, y, { width: w, align, lineBreak: wrap });
}

function fmtCA(n: number): string {
  if (n >= 100_000) return `${Math.round(n / 1_000)}k €`;
  if (n >= 10_000)  return `${(n / 1_000).toFixed(1)}k €`;
  return `${n.toLocaleString('fr-FR')} €`;
}

// ── Page 1 : Hero + Complémentarité + Tableau comparatif ─────────────────────

function drawPage1(doc: PDFKit.PDFDocument): void {
  const today = new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  // ── En-tête ────────────────────────────────────────────────────────────────
  band(doc, 0, 45, PRIMARY);
  t(doc, 'SunanddriveOS — Brochure commerciale', M, 15,
    { sz: 12, bold: true, color: 'white', align: 'center' });
  t(doc, today, A4_W - M - 95, 18,
    { sz: 8, color: '#a7f3d0', w: 90, align: 'right', wrap: false });

  // ── Hero ───────────────────────────────────────────────────────────────────
  const hY = 55;
  const hH = 173;
  band(doc, hY, hH, PRIMARY);

  t(doc, 'LE LOGICIEL QUI MANQUAIT AUX LOUEURS GETAROUND', M, hY + 16,
    { sz: 8, color: '#a7f3d0' });
  t(doc, 'Getaround gère vos locations.', M, hY + 32,
    { sz: 13, italic: true, color: '#e0f2f1' });
  t(doc, 'SunanddriveOS gère votre activité.', M, hY + 50,
    { sz: 20, bold: true, color: 'white' });
  t(doc,
    "Connectez votre compte Getaround existant. Gardez tout ce qu'il fait déjà très bien. " +
    "Ajoutez le pilotage business qui manque : rentabilité réelle, planning consolidé, " +
    "IA fiable, et un vrai rapport de direction chaque mois.",
    M, hY + 78, { sz: 9.5, color: '#d1fae5' });
  t(doc, 'Rentabilité · IA fiable · Planning · Comptabilité · Rapport CEO',
    M, hY + 148, { sz: 8, color: '#a7f3d0', align: 'center' });

  // ── Bandeau complémentarité ────────────────────────────────────────────────
  const cY = hY + hH + 10;
  const cH = 58;
  band(doc, cY, cH, DARK);

  t(doc, "SunanddriveOS ne remplace pas Getaround.", M, cY + 10,
    { sz: 9.5, bold: true, color: 'white' });
  t(doc,
    "On se branche sur votre compte existant via l'API officielle et on synchronise " +
    "automatiquement toutes vos données. Vous continuez à utiliser Getaround exactement comme avant.",
    M, cY + 25, { sz: 8.5, color: '#d1fae5' });

  // ── En-tête section tableau ────────────────────────────────────────────────
  const sY = cY + cH + 14;
  t(doc,
    'Getaround vous connecte au locataire. Nous vous connectons à votre activité.',
    M, sY, { sz: 12, bold: true, color: PRIMARY });

  // ── Tableau comparatif ─────────────────────────────────────────────────────
  const tY = sY + 34;
  const c1X = M;       const c1W = 80;
  const c2X = M + 85;  const c2W = 196;
  const c3X = M + 286; const c3W = 229;
  const ROW_H = 44;

  // Header ligne
  band(doc, tY, 23, PRIMARY);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('white');
  doc.text('Besoin',              c1X, tY + 7, { width: c1W, lineBreak: false });
  doc.text('Sur Getaround natif', c2X, tY + 7, { width: c2W, lineBreak: false });
  doc.text('Avec SunanddriveOS', c3X, tY + 7, { width: c3W, lineBreak: false });

  const ROWS: [string, string, string][] = [
    ['Vue flotte',
     'Un calendrier par véhicule, à consulter un par un',
     'Planning Gantt de toute la flotte sur une seule ligne de temps'],
    ['Messagerie',
     'Fil de discussion brut, aucune suggestion',
     "IA qui rédige des brouillons depuis les données réelles — jamais d'invention"],
    ['Performance',
     "Revenus et taux d'occupation, vue globale uniquement",
     'Marge nette par véhicule, coûts fixes/variables, cashflow réel'],
    ['Entretien',
     'Aucun suivi CT ni révision visible',
     'Alertes automatiques CT, révisions, historique complet par véhicule'],
    ['Patrimoine',
     'Aucune donnée de valeur ou de revente',
     'Signal de revente par véhicule, position patrimoniale nette, DSCR'],
    ['Comptabilité',
     'Relevés de paiement bruts',
     'Export FEC prêt pour votre expert-comptable'],
    ['Équipe',
     'Un seul accès propriétaire',
     'Rôles séparés : carkeeper, comptable, multi-comptes Getaround'],
  ];

  let rowY = tY + 23;
  ROWS.forEach((row, i) => {
    band(doc, rowY, ROW_H, i % 2 === 0 ? 'white' : LIGHT_TEAL);
    hLine(doc, M, rowY, CW, '#d1d5db');

    doc.font('Helvetica-Bold').fontSize(8).fillColor(PRIMARY)
       .text(row[0], c1X, rowY + 5, { width: c1W, lineBreak: true });
    doc.font('Helvetica').fontSize(8).fillColor(GRAY)
       .text(row[1], c2X, rowY + 5, { width: c2W, lineBreak: true });
    doc.font('Helvetica').fontSize(8).fillColor(DARK_TEXT)
       .text(row[2], c3X, rowY + 5, { width: c3W, lineBreak: true });

    rowY += ROW_H;
  });
  hLine(doc, M, rowY, CW, '#d1d5db');

  // Pied de page P1
  t(doc, 'appli.sunanddrive.com · Document confidentiel',
    M, rowY + 16, { sz: 8, color: GRAY, align: 'center' });
}

// ── Page 2 : Stats + Modules + Plans + CTA ───────────────────────────────────

function drawPage2(doc: PDFKit.PDFDocument, stats: BrochureStats): void {
  // ── En-tête ────────────────────────────────────────────────────────────────
  band(doc, 0, 40, PRIMARY);
  t(doc, 'Modules, Performances & Tarifs', M, 13,
    { sz: 12, bold: true, color: 'white', align: 'center' });

  // ── Bandeau statistiques ───────────────────────────────────────────────────
  const stY = 48;
  const stH = 76;
  band(doc, stY, stH, DARK);

  const statW = CW / 4;
  const STATS = [
    { label: 'CA net annuel',     value: fmtCA(stats.caNetAnnuel) },
    { label: "Taux d'occupation", value: `${stats.tauxOccupation}%` },
    { label: 'Locations / an',    value: String(stats.nbLocations) },
    { label: 'Véhicules actifs',  value: String(stats.nbVehicules) },
  ];
  STATS.forEach((s, i) => {
    const sx = M + i * statW;
    if (i > 0) vLine(doc, sx, stY + 14, stY + stH - 14, '#4dd0e1');
    t(doc, s.value, sx, stY + 16, { sz: 18, bold: true, color: 'white', w: statW, align: 'center' });
    t(doc, s.label, sx, stY + 40, { sz: 8, color: '#a7f3d0', w: statW, align: 'center' });
  });

  // ── Section 8 modules ──────────────────────────────────────────────────────
  const msY = stY + stH + 12;
  t(doc, '8 MODULES, UN SEUL OUTIL', M, msY, { sz: 9, bold: true, color: PRIMARY });

  const modW = (CW - 10) / 2;
  const modH = 80;
  const modGap = 5;
  const modStartY = msY + 16;

  const MODULES = [
    { title: 'Dashboard quotidien',
      accroche: "Chaque matin, l'app vous dit ce qui compte",
      desc: "Résumé IA en français — départs, retours, alertes, occupation. Plus besoin de chercher." },
    { title: 'Planning centralisé',
      accroche: 'Toute votre flotte sur une seule ligne de temps',
      desc: "Vue Gantt multi-véhicule avec retours imminents. Ce que Getaround ne propose pas nativement." },
    { title: 'Messagerie IA fiable',
      accroche: 'Une IA qui répond vite, mais qui ne ment jamais',
      desc: "Brouillons fondés sur les données réelles du véhicule. Si une info manque, l'IA le dit." },
    { title: 'Séquences automatiques',
      accroche: 'Le pilote automatique de votre quotidien',
      desc: "Messages déclenchés par événement (réservation, départ, retour). Historique vérifiable." },
    { title: 'Rentabilité par véhicule',
      accroche: 'Vous saurez enfin quelle voiture rapporte vraiment',
      desc: "Marge nette réelle, coûts fixes/variables, signal de revente par les vrais chiffres." },
    { title: 'Fiche IA & Instructions',
      accroche: "La mémoire que Getaround n'a pas",
      desc: "Équipements, procédures d'accès, consignes par véhicule. L'IA ne s'appuie que sur du vérifié." },
    { title: 'Rapport CEO mensuel',
      accroche: 'Un document que votre banquier prendrait au sérieux',
      desc: "Position patrimoniale, DSCR, SWOT, veille locale, plan d'action chiffré en euros." },
    { title: 'Multi-rôles & Croissance',
      accroche: 'Conçu pour 5 voitures comme pour 50',
      desc: "Rôles séparés (carkeeper, comptable), multi-comptes Getaround, architecture multi-tenant." },
  ];

  MODULES.forEach((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const mx = M + col * (modW + 10);
    const my = modStartY + row * (modH + modGap);

    fillRect(doc, mx, my, modW, modH, LIGHT_TEAL);
    fillRect(doc, mx, my, 3, modH, PRIMARY);

    doc.font('Helvetica-Bold').fontSize(9).fillColor(DARK_TEXT)
       .text(m.title, mx + 8, my + 8, { width: modW - 14, lineBreak: false });
    doc.font('Helvetica-Oblique').fontSize(8).fillColor(PRIMARY)
       .text(m.accroche, mx + 8, my + 21, { width: modW - 14, lineBreak: true });
    doc.font('Helvetica').fontSize(7.5).fillColor(GRAY)
       .text(m.desc, mx + 8, my + 47, { width: modW - 14, lineBreak: true });
  });

  // ── Plans & Tarifs ─────────────────────────────────────────────────────────
  const plSecY = modStartY + 4 * (modH + modGap) + 12;
  t(doc, 'PLANS & TARIFS', M, plSecY, { sz: 9, bold: true, color: PRIMARY });

  const PLANS = [
    { name: 'Starter', features: ["Jusqu'à 5 véhicules", 'Planning + Locations', 'Messages IA', 'Export CSV'], hot: false },
    { name: 'Pro',     features: ['Flotte illimitée', 'Intelligence + Forecast', 'Séquences + Export FEC', 'Rapport CEO'], hot: true },
    { name: 'Enterprise', features: ['Tout Pro inclus', 'SLA prioritaire', 'Onboarding dédié', 'API + Multi-tenants'], hot: false },
  ];

  const plW = (CW - 16) / 3;
  const plH = 82;
  const plY = plSecY + 16;

  PLANS.forEach((p, i) => {
    const px = M + i * (plW + 8);
    const bgC  = p.hot ? PRIMARY : 'white';
    const txtC = p.hot ? 'white' : DARK_TEXT;
    const subC = p.hot ? '#a7f3d0' : GRAY;
    const ftC  = p.hot ? '#d1fae5' : '#374151';

    fillRect(doc, px, plY, plW, plH, bgC);
    if (!p.hot) strokeRect(doc, px, plY, plW, plH, '#d1d5db');

    doc.font('Helvetica-Bold').fontSize(9).fillColor(txtC)
       .text(p.name, px + 8, plY + 8, { width: plW - 16 });
    doc.font('Helvetica').fontSize(7.5).fillColor(subC)
       .text('Sur devis', px + 8, plY + 20, { width: plW - 16 });

    p.features.forEach((f, fi) => {
      doc.font('Helvetica').fontSize(7.5).fillColor(ftC)
         .text(`✓ ${f}`, px + 8, plY + 33 + fi * 11, { width: plW - 16, lineBreak: false });
    });
  });

  // ── CTA ────────────────────────────────────────────────────────────────────
  const ctaY = plY + plH + 12;
  const ctaH = 60;
  band(doc, ctaY, ctaH, PRIMARY);
  t(doc, 'Démarrez votre essai gratuit 15 jours', M, ctaY + 11,
    { sz: 14, bold: true, color: 'white', align: 'center' });
  t(doc, 'Sans engagement · Configuration en 30 minutes · Support inclus',
    M, ctaY + 31, { sz: 9, color: '#d1fae5', align: 'center' });
  t(doc, 'Contactez-nous via votre tableau de bord sur appli.sunanddrive.com',
    M, ctaY + 45, { sz: 8, color: '#a7f3d0', align: 'center' });

  // ── Pied de page P2 ────────────────────────────────────────────────────────
  const footY = ctaY + ctaH + 14;
  t(doc,
    `SunanddriveOS · appli.sunanddrive.com · ${new Date().getFullYear()} · Document confidentiel`,
    M, footY, { sz: 7.5, color: GRAY, align: 'center' });
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/brochure/stats', async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const stats = await computeStats(db);
    res.json(stats);
  } catch {
    res.status(500).json({ error: 'Erreur calcul statistiques' });
  }
});

router.get('/brochure/pdf', async (req: Request, res: Response): Promise<void> => {
  try {
    const db = getTenantClient(req.tenantDbUrl!);
    const stats = await computeStats(db);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="SunanddriveOS-Brochure-Commerciale.pdf"',
    );

    const doc = new PDFDocument({ size: 'A4', margin: 0 });
    doc.pipe(res);
    drawPage1(doc);
    doc.addPage();
    drawPage2(doc, stats);
    doc.end();
  } catch {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur génération PDF' });
    }
  }
});

export default router;

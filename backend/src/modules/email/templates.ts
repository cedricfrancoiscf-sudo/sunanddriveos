const APP_URL = 'https://appli.sunanddrive.com';
const PRIMARY = '#01696e';

function emailBase(content: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:40px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
<tr><td style="background:${PRIMARY};padding:24px 32px">
  <span style="color:#fff;font-size:20px;font-weight:bold;letter-spacing:-0.5px">SunanddriveOS</span>
</td></tr>
<tr><td style="padding:32px;font-size:14px;color:#374151;line-height:1.7">
${content}
</td></tr>
<tr><td style="background:#f1f5f9;padding:16px 32px;font-size:11px;color:#94a3b8;text-align:center">
  SunanddriveOS — Propulsé par Sun and Drive
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function btn(label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;padding:12px 28px;background:${PRIMARY};color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">${label}</a>`;
}

// EMAIL 1 — Bienvenue (déclenché à l'activation du premier compte admin)
export function welcomeEmailHtml(firstName: string, companyName: string): string {
  return emailBase(`
<p style="font-size:16px;color:#1e293b;margin:0 0 16px">Bonjour ${firstName},</p>
<p style="margin:0 0 24px">Votre espace <strong>${companyName}</strong> est prêt.</p>
<p style="font-weight:600;color:#1e293b;margin:0 0 12px">3 premières étapes :</p>
<ol style="padding-left:20px;margin:0 0 32px">
  <li style="margin:0 0 8px">Connecter votre compte Getaround</li>
  <li style="margin:0 0 8px">Synchroniser votre flotte</li>
  <li style="margin:0 0 8px">Configurer la messagerie automatique</li>
</ol>
<p style="margin:0">${btn('Accéder à mon espace', APP_URL)}</p>
`);
}

// EMAIL 2 — Invitation utilisateur
export function invitationEmailHtml(inviterName: string, companyName: string, activationUrl: string): string {
  return emailBase(`
<p style="font-size:16px;color:#1e293b;margin:0 0 16px">Bonjour,</p>
<p style="margin:0 0 16px">Vous avez été invité(e) à rejoindre l'espace de gestion de flotte <strong>SunanddriveOS</strong> par <strong>${inviterName !== companyName ? inviterName : companyName}</strong>.</p>
<p style="margin:0 0 24px">Cliquez sur le bouton ci-dessous pour créer votre compte :</p>
<p style="margin:0 0 32px">${btn('Créer mon compte', activationUrl)}</p>
<p style="font-size:12px;color:#94a3b8;margin:0 0 16px">Ou copiez ce lien dans votre navigateur :<br><span style="color:#64748b">${activationUrl}</span></p>
<p style="font-size:12px;color:#94a3b8;margin:0">Ce lien est valable 48h.</p>
`);
}

// EMAIL 4 — Compte désactivé
export function deactivationEmailHtml(userName: string, companyName: string): string {
  return emailBase(`
<p style="font-size:16px;color:#1e293b;margin:0 0 16px">Bonjour ${userName},</p>
<p style="margin:0 0 16px">Votre compte <strong>${companyName}</strong> sur SunanddriveOS a été désactivé par un administrateur.</p>
<p style="margin:0 0 32px">Si vous pensez qu'il s'agit d'une erreur, contactez votre administrateur.</p>
<p style="font-size:12px;color:#94a3b8;margin:0">Cordialement,<br>L'équipe SunanddriveOS</p>
`);
}

// EMAIL 3 — Fin de trial J-3
export function trialExpiryEmailHtml(companyName: string, expiryDate: string): string {
  return emailBase(`
<p style="font-size:16px;color:#1e293b;margin:0 0 16px">Bonjour,</p>
<p style="margin:0 0 24px">Votre accès complet à <strong>${companyName}</strong> expire le <strong>${expiryDate}</strong>.</p>
<p style="font-weight:600;color:#1e293b;margin:0 0 12px">Fonctionnalités incluses dans votre plan :</p>
<ul style="padding-left:20px;margin:0 0 32px">
  <li style="margin:0 0 6px">Synchronisation Getaround illimitée</li>
  <li style="margin:0 0 6px">Messagerie automatique IA</li>
  <li style="margin:0 0 6px">Rapports et analytics avancés</li>
  <li style="margin:0 0 6px">Gestion multi-utilisateurs</li>
  <li style="margin:0 0 6px">Alertes CT / entretiens</li>
</ul>
<p style="margin:0">${btn('Choisir mon plan', APP_URL + '/pricing')}</p>
`);
}

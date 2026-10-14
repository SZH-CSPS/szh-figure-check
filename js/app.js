// Interface : quatre étapes en accordéon (figure, paramètres, écran, analyse) ; l'analyse
// montre une vue à la fois (aperçu à taille réelle, textes, couleurs).

import { FORMATS, zoneContenu, tailleFigure, versPoints, TAILLE_MIN_PT, SEUILS_LC, MM_PAR_PX } from './formats.js';
import { niveauTaille, niveauContraste, pireNiveau, agrandissement, couleurConforme, regrouper, diagnosticEnsemble, RATIO_X } from './analyse.js';
import { versHex } from './apca.js';
import { ouvrir } from './sources.js';
import { lire } from './lecture.js';
import { filtreBasseVision } from './vision.js';
import { SALLES, DIAPO, CM_PAR_PT, cadreFigure, largeurApparenteCm, minusculeMinCm } from './projection.js';
import { T, langueInitiale, nombre } from './i18n.js';

const PX_PAR_MM_NOMINAL = 96 / 25.4;
const CLE_CALIBRATION = 'szh-figure-check.pxParMm';
const CARTE_MM = 85.6;
const EXEMPLES = { png: 'exemples/figure-exemple.png', svg: 'exemples/figure-exemple.svg' };

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const etat = {
  langue: langueInitiale(params.get('langue'), navigator.language),
  format: FORMATS[params.get('format')] ? params.get('format') : 'revue',
  proportion: null,
  seuil: SEUILS_LC.includes(Number(params.get('lc'))) ? Number(params.get('lc')) : SEUILS_LC[0],
  etape: 1,
  onglet: 'vue-page',
  salle: 'petite',
  ecranCm: SALLES.petite.largeurCm,
  distanceCm: SALLES.petite.distanceCm,
  vue: 'reelle',
  pxParMm: lireCalibration(),
  source: null,
  lecture: null,
  jeton: 0,
};

const t = (cle, valeurs) => T(etat.langue, cle, valeurs);

function lireCalibration() {
  try {
    const v = parseFloat(localStorage.getItem(CLE_CALIBRATION));
    return v > 1 ? v : null;
  } catch { return null; }
}

function ecrireCalibration(v) {
  try {
    if (v) localStorage.setItem(CLE_CALIBRATION, String(v));
    else localStorage.removeItem(CLE_CALIBRATION);
  } catch { /* stockage indisponible : réglage gardé pour la session */ }
}

function element(nom, attributs = {}, ...enfants) {
  const el = document.createElement(nom);
  for (const [k, v] of Object.entries(attributs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else el.setAttribute(k, v);
  }
  el.append(...enfants.filter((e) => e != null));
  return el;
}

// ── Textes de l'interface ───────────────────────────────────────────────────────

function appliquerLangue() {
  document.documentElement.lang = etat.langue;
  document.title = t('titre');
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  if (!BASSE_VISION) {
    for (const el of document.querySelectorAll('[data-t="basseVisionAide"]')) el.hidden = true;
    for (const el of document.querySelectorAll('[data-t="descVision"]')) el.textContent = t('descVisionAVenir');
  }
  for (const el of document.querySelectorAll('[data-t-aria]')) el.setAttribute('aria-label', t(el.dataset.tAria));
  rendreResumes();
  $('langue').textContent = t('autreLangue');
  $('langue').lang = etat.langue === 'fr' ? 'de' : 'fr';
  if (etat.source) { rendrePage(); rendreAnalyse(); rendreCouleurs(); }
}

// ── Page simulée ────────────────────────────────────────────────────────────────

function figureSurPage() {
  const s = etat.source;
  return tailleFigure(FORMATS[etat.format], s.ratio, s.naturel, etat.proportion);
}

function rendrePage() {
  const f = FORMATS[etat.format];
  const s = etat.source;
  const fig = figureSurPage();
  const page = $('page');
  Object.assign(page.style, {
    width: `${f.page.l}mm`, height: `${f.page.h}mm`,
    padding: `${f.marges.haut}mm ${f.marges.droite}mm ${f.marges.bas}mm ${f.marges.gauche}mm`,
    fontSize: `${f.corpsPt}pt`, lineHeight: String(f.interligne),
  });
  const paragraphes = t('texteCourant');
  const legende = element('figcaption', { style: { fontSize: `${f.legendePt}pt`, fontStyle: f.legendeItalique ? 'italic' : 'normal' } },
    element('b', {}, t('legendeNumero')), ' ', t('legendeTexte'));
  const image = element('img', { src: s.url, alt: '', style: { width: `${fig.l}mm`, height: `${fig.h}mm` } });
  page.replaceChildren(
    element('p', {}, paragraphes[0]),
    element('figure', {}, legende, image),
    ...paragraphes.slice(1).map((p) => element('p', {}, p)),
    ...paragraphes.map((p) => element('p', {}, p)),
  );
  document.querySelector('#style-impression').textContent =
    `@page { size: ${f.page.l}mm ${f.page.h}mm; margin: 0; }`;

  $('dimensions').textContent = t('imprimee', { l: Math.round(fig.l), h: Math.round(fig.h) });
  $('calibration').textContent = t(etat.pxParMm ? 'calibrationOui' : 'calibrationNon');

  const alertes = [];
  const zone = zoneContenu(f);
  if (fig.h >= zone.h * f.plafond - 0.01) alertes.push(t('plafonnee'));
  if (!etat.proportion && s.type === 'bitmap' && s.naturel.l * MM_PAR_PX < zone.l - 1) {
    alertes.push(t('petiteNaturelle', { px: s.naturel.l }));
  }
  if (s.pixels) {
    const ppp = s.pixels.l / (fig.l / 25.4);
    if (ppp < 150) alertes.push(t('resolutionFaible', { ppp: Math.round(ppp) }));
  }
  $('alertes-page').replaceChildren(...alertes.map((a) => element('li', {}, a)));
  zoomer();
}

function zoomer() {
  const page = $('page');
  const f = FORMATS[etat.format];
  let k = (etat.pxParMm || PX_PAR_MM_NOMINAL) / PX_PAR_MM_NOMINAL;
  if (etat.vue === 'page') {
    const cadre = $('cadre-page');
    const dispoL = cadre.clientWidth - 32, dispoH = window.innerHeight * 0.85;
    k = Math.min(dispoL / (f.page.l * PX_PAR_MM_NOMINAL), dispoH / (f.page.h * PX_PAR_MM_NOMINAL));
  }
  page.style.zoom = String(k);
}

// ── Textes de la figure ─────────────────────────────────────────────────────────

const SYMBOLES = { corriger: '✕', ameliorer: '!', ok: '✓' };
const ROUGE = '#d0021b';

function statut(cle, valeurs) {
  $('statut').textContent = cle ? t(cle, valeurs) : '';
}

async function analyser() {
  const jeton = ++etat.jeton;
  etat.lecture = null;
  etat.endroits = null;
  rendreAnalyse();
  try {
    const lecture = await lire(etat.source, (etape, p) => {
      if (jeton !== etat.jeton) return;
      if (etape === 'rendu') statut('preparation');
      else if (etape === 'chargement') statut('chargementOcr');
      else if (etape === 'ocr') statut('lectureOcr', { p: Math.round(p * 100) });
    });
    if (jeton !== etat.jeton) return;
    etat.lecture = lecture;
    statut(null);
    rendreAnalyse();
  } catch (e) {
    if (jeton !== etat.jeton) return;
    statut(null);
    montrerErreur(e.message === 'cdn' ? 'erreurCdn' : 'erreurFichier', e);
  }
  document.body.dataset.etat = 'fini';
}

function mesures() {
  const { canevas, lignes } = etat.lecture;
  const fig = figureSurPage();
  return lignes.map((l, id) => {
    const pt = l.corpsPx ? versPoints(l.corpsPx, canevas.width, fig.l) : null;
    const lcv = l.contraste ? l.contraste.lc : null;
    // Le degré se décide sur la valeur affichée, arrondie comme elle s'écrit.
    const nt = niveauTaille(pt == null ? null : Math.round(pt * 10) / 10);
    const nc = niveauContraste(lcv == null ? null : Math.round(lcv), etat.seuil);
    return { ...l, id, pt, lc: lcv, nt, nc, niveau: pireNiveau(nt, nc) };
  });
}

// Extrait de la figure autour d'une zone, la zone entourée de rouge.
function extrait(canevas, bbox) {
  const lb = bbox.x1 - bbox.x0, hb = bbox.y1 - bbox.y0;
  const marge = Math.max(30, Math.min(lb, hb) * 1.5);
  const sx = Math.max(0, bbox.x0 - marge * 1.6), sy = Math.max(0, bbox.y0 - marge);
  const sl = Math.min(canevas.width, bbox.x1 + marge * 1.6) - sx;
  const sh = Math.min(canevas.height, bbox.y1 + marge) - sy;
  const e = Math.min(2, 560 / sl, 240 / sh);
  const c = document.createElement('canvas');
  c.width = Math.round(sl * e);
  c.height = Math.round(sh * e);
  const ctx = c.getContext('2d');
  ctx.drawImage(canevas, sx, sy, sl, sh, 0, 0, c.width, c.height);
  const p = 6;
  ctx.strokeStyle = ROUGE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect((bbox.x0 - sx) * e - p, (bbox.y0 - sy) * e - p, lb * e + 2 * p, hb * e + 2 * p, 8);
  ctx.stroke();
  return c.toDataURL('image/png');
}

function badge(niveau) {
  return element('span', { class: `badge ${niveau}` },
    element('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES[niveau]), ' ', t(`niveau_${niveau}`));
}

function nuancier(...couleurs) {
  return element('span', { class: 'nuancier', title: couleurs.map(versHex).join(' / ') },
    ...couleurs.map((c) => element('span', { style: { background: versHex(c) } })));
}

function texteTaille(l) {
  return l.pt == null ? t('nonMesure') : `${l.exact ? '' : '≈ '}${nombre(l.pt)} pt`;
}

function texteContraste(l) {
  return l.lc == null ? t('nonMesure') : `Lc ${Math.round(Math.abs(l.lc))}`;
}

function conseils(l, plusieurs) {
  const liste = [];
  if (l.nt && l.nt !== 'ok') liste.push(element('li', {}, t(plusieurs ? 'conseilTailles' : 'conseilTaille', { p: agrandissement(l.pt) })));
  if (l.nc && l.nc !== 'ok') {
    // Avec 10 de marge si possible, sinon juste au seuil.
    const proposition = couleurConforme(l.contraste.texte, l.contraste.fond, etat.seuil + 10)
      || couleurConforme(l.contraste.texte, l.contraste.fond, etat.seuil);
    if (!proposition) {
      liste.push(element('li', {}, t('conseilFond')));
    } else {
      const hex = versHex(proposition.couleur);
      const [avant, apres] = t(proposition.sens === 'foncer' ? 'conseilFoncer' : 'conseilEclaircir', { hex: '\u0000' }).split('\u0000');
      liste.push(element('li', {}, avant, element('b', {}, hex), ' ', nuancier(proposition.couleur), apres));
    }
  }
  return liste;
}

const TEXTES_PAR_CARTE = 6;
const CARTES_MAX = 8;
const CONFORMES_MAX = 6;

// « 3,0 pt » ou « 3,0 à 4,2 pt » selon l'étendue des valeurs.
function plage(valeurs, formater) {
  const a = Math.min(...valeurs), b = Math.max(...valeurs);
  const fa = formater(a), fb = formater(b);
  return fa === fb ? fa : t('plage', { a: fa, b: fb });
}

// Ce qu'un groupe montre : les pires valeurs et la plage de ses membres.
function resumeGroupe(groupe) {
  const m = groupe.membres;
  const tailles = m.filter((l) => l.pt != null);
  const contrastes = m.filter((l) => l.lc != null);
  const approx = tailles.some((l) => !l.exact) ? '≈ ' : '';
  const pireContraste = contrastes.reduce((a, b) => (Math.abs(b.lc) < Math.abs(a.lc) ? b : a), contrastes[0]);
  return {
    taille: tailles.length ? `${approx}${plage(tailles.map((l) => l.pt), (v) => nombre(v))} pt` : t('nonMesure'),
    contraste: contrastes.length ? `Lc ${plage(contrastes.map((l) => Math.abs(l.lc)), (v) => String(Math.round(v)))}` : t('nonMesure'),
    pour: {
      nt: pireNiveau(...m.map((l) => l.nt)),
      pt: tailles.length ? Math.min(...tailles.map((l) => l.pt)) : null,
      nc: pireNiveau(...m.map((l) => l.nc)),
      contraste: pireContraste ? pireContraste.contraste : null,
    },
  };
}

function carteZone(groupe, numero, canevas) {
  const l = groupe.representant;
  const r = resumeGroupe(groupe);
  const n = groupe.membres.length;
  const montres = n > TEXTES_PAR_CARTE + 1 ? TEXTES_PAR_CARTE : n;
  const cites = groupe.membres.slice(0, montres).map((m) => `« ${m.texte} »`).join(', ')
    + (n > montres ? ` ${t('etAutres', { n: n - montres })}` : '');
  const ligneMesure = (cle, valeur, niveau, minimum, extra) => element('div', { class: 'mesure' },
    element('dt', {}, t(cle)),
    element('dd', { class: niveau || 'inconnu' }, element('b', {}, valeur), ` (${minimum}) `, extra,
      niveau && niveau !== 'ok' ? badge(niveau) : null));
  const carte = element('li', { class: `zone ${groupe.niveau}`, id: `zone-${numero}` },
    element('div', { class: 'zone-tete' }, element('span', { class: 'numero' }, String(numero)), badge(groupe.niveau),
      n > 1 ? element('span', { class: 'discret' }, t('memeStyle', { n })) : null),
    element('img', { src: extrait(canevas, l.bbox), alt: t('extraitAlt', { texte: l.texte }) }),
    element('dl', {},
      element('div', { class: 'mesure' }, element('dt', {}, t(n > 1 ? 'zoneTextesLus' : 'zoneTexteLu')), element('dd', {}, cites)),
      ligneMesure('zoneTaille', r.taille, r.pour.nt, t('minimumTaille', { min: TAILLE_MIN_PT })),
      ligneMesure('zoneContraste', r.contraste, r.pour.nc, t('minimumContraste', { lc: etat.seuil }),
        r.pour.contraste ? nuancier(r.pour.contraste.texte, r.pour.contraste.fond) : null)),
    ...(groupe.niveau === 'ok'
      ? [element('p', { class: 'que-faire' }, t('conformeRien'))]
      : [element('p', { class: 'que-faire' }, element('b', {}, t('queFaire'))),
        element('ul', {}, ...conseils(r.pour, n > 1))]));
  return carte;
}

// Encadré « la figure entière est trop petite », avec ce que donneraient la pleine
// largeur de colonne et une page entière en paysage.
function carteEnsemble(diag) {
  const f = FORMATS[etat.format];
  const zone = zoneContenu(f);
  const fig = figureSurPage();
  const ratio = etat.source.ratio;
  const phrases = [
    t('ensembleTexte', { n: diag.petits, total: diag.total, min: TAILLE_MIN_PT, bas: nombre(diag.bas), haut: nombre(diag.haut) }),
    t('ensembleFacteur', { min: TAILLE_MIN_PT, f: nombre(diag.facteur) }),
  ];
  const pleine = Math.min(zone.l, zone.h * f.plafond / ratio);
  if (pleine > fig.l * 1.05) phrases.push(t('ensemblePleineLargeur', { pt: nombre(diag.mediane * pleine / fig.l) }));
  const paysage = Math.min(zone.h, zone.l / ratio);
  if (paysage > Math.max(fig.l, pleine) * 1.05) phrases.push(t('ensemblePaysage', { pt: nombre(diag.mediane * paysage / fig.l) }));
  return element('div', { class: 'bilan corriger ensemble' },
    element('p', { class: 'bilan-titre' }, element('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES.corriger), ' ', t('ensembleTitre')),
    element('p', {}, phrases.join(' ')),
    element('p', {}, element('b', {}, t('queFaireDeuxPoints')), ' ', t('ensembleConseil')));
}

function rendreAnalyse() {
  const cadre = $('analyse-figure');
  const tbody = document.querySelector('#table-textes tbody');
  const f = FORMATS[etat.format];
  $('rapport-fichier').textContent = t('rapportFichier', {
    nom: etat.source.nom, format: t(etat.format === 'revue' ? 'formatRevue' : 'formatLivre'),
  });
  if (!etat.lecture) {
    cadre.replaceChildren(element('img', { src: etat.source.url, alt: '' }));
    for (const id of ['bilan', 'niveaux', 'zones-titre', 'details-textes', 'imprimer-rapport']) $(id).hidden = true;
    $('zones').replaceChildren();
    $('puces').replaceChildren();
    $('panneau').replaceChildren();
    $('ensemble').replaceChildren();
    $('zones-reste').textContent = '';
    tbody.replaceChildren();
    $('note-mesure').textContent = '';
    return;
  }
  const { canevas } = etat.lecture;
  const lignes = mesures();
  // Quand la figure entière est trop petite, un encadré le dit une fois pour toutes ; les
  // cartes ne portent alors plus que sur le contraste, par style de texte.
  const diag = diagnosticEnsemble(lignes);
  const fautifs = diag
    ? lignes.filter((l) => l.nc && l.nc !== 'ok').map((l) => ({ ...l, niveau: l.nc }))
    : lignes.filter((l) => l.niveau && l.niveau !== 'ok');
  let groupes = regrouper(fautifs);
  const souple = Boolean(diag) || groupes.length > CARTES_MAX;
  if (souple) groupes = regrouper(fautifs, { souple: true });
  const affiches = groupes.slice(0, CARTES_MAX);
  // Les textes conformes forment eux aussi des groupes, par style, pour pouvoir les montrer.
  const conformes = regrouper(lignes.filter((l) => l.niveau === 'ok'), { souple: true }).slice(0, CONFORMES_MAX);
  const explorables = [...affiches, ...conformes];
  etat.endroits = groupes.length;
  rendreResumes();

  // Figure annotée : rien n'y est dessiné par défaut, et on n'agit pas sur elle. Les puces
  // numérotées choisissent le groupe mis en évidence, un seul à la fois : le survol
  // l'affiche, le clic le rend actif ; sortir de la rangée de puces revient au groupe actif.
  // Le groupe 1 est actif au départ. Sa carte s'affiche dans le panneau. La puce active est
  // pleine et soulignée, celle qu'on survole n'est que teintée, et le panneau dit s'il
  // montre l'endroit actif ou un aperçu. Les groupes conformes s'encadrent en vert.
  const ns = 'http://www.w3.org/2000/svg';
  const svgEl = (nom, attributs = {}) => {
    const el = document.createElementNS(ns, nom);
    for (const [k, v] of Object.entries(attributs)) el.setAttribute(k, v);
    return el;
  };
  const W = canevas.width, H = canevas.height;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const voile = svgEl('path', { class: 'voile', 'fill-rule': 'evenodd' });
  svg.append(voile);
  const m = 4;
  const boite = (l) => ({ x: l.bbox.x0 - m, y: l.bbox.y0 - m, w: l.bbox.x1 - l.bbox.x0 + 2 * m, h: l.bbox.y1 - l.bbox.y0 + 2 * m });

  // Cadres des textes sans carte : invisibles, montrés un par un depuis la liste des textes.
  const rectDe = new Map();
  const groupeDe = new Map();
  explorables.forEach((g, i) => g.membres.forEach((l) => groupeDe.set(l.id, i)));
  const neutres = svgEl('g', { class: 'neutres' });
  for (const l of lignes) {
    if (groupeDe.has(l.id)) continue;
    const b = boite(l);
    const r = svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: l.niveau || 'inconnu' });
    neutres.append(r);
    rectDe.set(l.id, r);
  }
  svg.append(neutres);

  // Tous les textes d'un groupe prennent la couleur du groupe, celle de sa boîte et de sa
  // carte, même si l'un d'eux, pris seul, est d'un degré moins grave.
  const calques = explorables.map((g) => {
    const calque = svgEl('g', { class: `groupe ${g.niveau}` });
    for (const l of g.membres) {
      const b = boite(l);
      const r = svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: `cadre ${g.niveau}` });
      calque.append(r);
      rectDe.set(l.id, r);
    }
    svg.append(calque);
    return calque;
  });

  // Trois boîtes identiques, une par degré, chacune avec ses numéros.
  const puces = $('puces');
  const boutons = explorables.map((g, i) => element('button', {
    type: 'button', 'aria-pressed': 'false', 'aria-controls': 'panneau', class: `puce ${g.niveau}`,
    'aria-label': t('puceAria', { n: i + 1, niveau: t(`niveau_${g.niveau}`) }),
  }, String(i + 1)));
  const rangee = element('div', { class: 'boites-niveaux' }, ...['corriger', 'ameliorer', 'ok'].map((niveau) => {
    const ici = boutons.filter((b, i) => explorables[i].niveau === niveau);
    return element('section', { class: `boite-niveau ${niveau}`, 'aria-label': t(`niveau_${niveau}`) },
      element('p', { class: 'boite-titre' },
        element('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES[niveau]), ' ',
        element('b', {}, t(`niveau_${niveau}`)), ' ',
        element('span', { class: 'discret' }, t('nEndroits', { n: ici.length }))),
      element('p', { class: 'boite-legende discret' }, t(`legende_${niveau}`)),
      element('div', { class: 'boite-puces' }, ...(ici.length ? ici : [element('span', { class: 'discret' }, t('aucunEndroit'))])));
  }));
  puces.replaceChildren(rangee);

  const cartes = new Map();
  const carteDe = (i) => {
    if (!cartes.has(i)) cartes.set(i, carteZone(explorables[i], i + 1, canevas));
    return cartes.get(i);
  };
  const choix = { epingle: explorables.length ? 0 : null };
  let hauteurPanneau = 0;
  $('panneau').style.minHeight = '';
  const montrer = (i) => {
    svg.classList.toggle('focus', i != null);
    calques.forEach((c, k) => c.classList.toggle('choisi', k === i));
    boutons.forEach((b, k) => {
      const actif = k === choix.epingle;
      b.setAttribute('aria-pressed', String(actif));
      b.tabIndex = actif ? 0 : -1;
      b.classList.toggle('apercu', k === i && !actif);
    });
    if (i == null) {
      voile.setAttribute('d', '');
      $('panneau').replaceChildren(element('p', { class: 'discret' }, t(explorables.length ? 'panneauAide' : 'panneauVide')));
      return;
    }
    const trous = explorables[i].membres.map((l) => { const b = boite(l); return `M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z`; }).join('');
    voile.setAttribute('d', `M0 0H${W}V${H}H0Z${trous}`);
    const apercu = i !== choix.epingle;
    const etatPanneau = element('p', { class: `panneau-etat${apercu ? ' apercu' : ''}` },
      apercu ? t('panneauApercu', { n: i + 1, actif: choix.epingle + 1 }) : t('panneauActif', { n: i + 1, total: explorables.length }));
    $('panneau').classList.toggle('apercu', apercu);
    $('panneau').replaceChildren(etatPanneau, carteDe(i));
    // Le panneau ne rapetisse jamais pendant qu'on passe d'un numéro à l'autre : en bas de
    // page, un panneau plus court ferait remonter la page, le numéro sortirait de sous la
    // souris et l'affichage clignoterait.
    hauteurPanneau = Math.max(hauteurPanneau, $('panneau').offsetHeight);
    $('panneau').style.minHeight = `${hauteurPanneau}px`;
  };
  const survoler = (i) => montrer(i);
  const epingler = (i) => { choix.epingle = i; montrer(i); };
  rangee.addEventListener('mouseleave', () => montrer(choix.epingle));
  boutons.forEach((b, i) => {
    b.addEventListener('mouseenter', () => survoler(i));
    b.addEventListener('focus', () => epingler(i));
    b.addEventListener('click', () => epingler(i));
    b.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      boutons[(i + d + boutons.length) % boutons.length].focus();
    });
  });
  montrer(choix.epingle);
  cadre.replaceChildren(element('img', { src: etat.source.url, alt: '' }), svg);

  // Bilan
  const nCorriger = lignes.filter((l) => l.niveau === 'corriger').length;
  const nAmeliorer = lignes.filter((l) => l.niveau === 'ameliorer').length;
  const global = nCorriger ? 'corriger' : nAmeliorer ? 'ameliorer' : 'ok';
  const tailles = lignes.map((l) => l.pt).filter((v) => v != null);
  const bilan = $('bilan');
  bilan.className = `bilan ${lignes.length ? global : 'inconnu'}`;
  bilan.replaceChildren(...(lignes.length ? [
    element('p', { class: 'bilan-titre' }, element('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES[global]), ' ', t(`bilan_${global}`)),
    element('p', {}, [
      t('textesLus', { n: lignes.length }),
      nCorriger ? t('compte_corriger', { n: nCorriger }) + '.' : null,
      nAmeliorer ? t('compte_ameliorer', { n: nAmeliorer }) + '.' : null,
      tailles.length ? t('plusPetitTexte', { pt: nombre(Math.min(...tailles)), min: TAILLE_MIN_PT }) : null,
    ].filter(Boolean).join(' ')),
  ] : [element('p', { class: 'bilan-titre' }, t('aucunTexte'))]));
  bilan.hidden = false;
  $('niveaux').hidden = !lignes.length;

  // Diagnostic d'ensemble et endroits à revoir
  $('ensemble').replaceChildren(...(diag ? [carteEnsemble(diag)] : []));
  $('zones-titre').hidden = !groupes.length;
  $('zones-titre').textContent = t(diag ? 'contrastesTitre' : souple ? 'stylesTitre' : 'zonesTitre', { n: groupes.length });
  $('zones').replaceChildren(...affiches.map((g, i) => carteZone(g, i + 1, canevas)));
  $('zones-reste').textContent = groupes.length > affiches.length ? t('autresGroupes', { n: groupes.length - affiches.length }) : '';

  // Tous les textes
  tbody.replaceChildren(...lignes.map((l) => {
    const cellule = (valeur, niveau) => element('td', { class: niveau || 'inconnu' }, valeur,
      niveau && niveau !== 'ok' ? element('span', { class: 'etiquette' }, t(`niveau_${niveau}`)) : null);
    const tr = element('tr', {},
      element('td', { class: 'texte-lu' }, l.texte, l.vertical ? element('span', { class: 'etiquette discret' }, t('vertical')) : null),
      cellule(texteTaille(l), l.nt),
      cellule(texteContraste(l), l.nc),
      element('td', {}, l.contraste ? nuancier(l.contraste.texte, l.contraste.fond) : null));
    const activer = (oui) => {
      tr.classList.toggle('actif', oui);
      if (groupeDe.has(l.id)) montrer(oui ? groupeDe.get(l.id) : choix.epingle);
      rectDe.get(l.id).classList.toggle('actif', oui);
    };
    tr.addEventListener('mouseenter', () => activer(true));
    tr.addEventListener('mouseleave', () => activer(false));
    return tr;
  }));
  $('details-textes').hidden = !lignes.length;
  $('details-titre').textContent = t('tousTextes', { n: lignes.length });
  $('imprimer-rapport').hidden = !lignes.length;
  rendreProjection();

  const exact = lignes.length && lignes.every((l) => l.exact);
  $('note-mesure').textContent = `${t('seuils', { min: TAILLE_MIN_PT, lc: etat.seuil, corps: nombre(f.corpsPt) })} ${lignes.length ? t(exact ? 'noteExacte' : 'noteEstimation') : ''}`;
}

function imprimerRapport() {
  document.body.dataset.impression = 'rapport';
  $('style-impression').textContent = '@page { size: A4; margin: 15mm; }';
  $('details-textes').open = true;
  window.print();
}

window.addEventListener('afterprint', () => {
  if (document.body.dataset.impression !== 'rapport') return;
  delete document.body.dataset.impression;
  if (etat.source) rendrePage();
});

// ── Couleurs ────────────────────────────────────────────────────────────────────

// Daltonismes : filtres SVG appliqués à l'image d'origine. Basse vision : images calculées
// sur un canevas, à l'échelle de la figure imprimée (le flou dépend de sa largeur).
const VUES_DALTONISME = [
  ['vueOriginale', ''], ['vueDeuteranopie', 'f-deuteranopie'], ['vueProtanopie', 'f-protanopie'],
  ['vueTritanopie', 'f-tritanopie'], ['vueGris', 'f-gris'],
];
const VUES_BASSE_VISION = [['vueAcuite5', 'acuite5'], ['vueAcuite3', 'acuite3'], ['vueContraste', 'contraste'], ['vueCataracte', 'cataracte']];
const LARGEUR_SIMULATION = 1600;
// Basse vision en révision : masquée, sauf avec ?basseVision=1 pour la relire.
const BASSE_VISION = params.get('basseVision') === '1';
let simulations = { cle: null, urls: {} };
let vuesVision = [];

async function calculerBasseVision() {
  const s = etat.source;
  const largeurMm = figureSurPage().l;
  const cle = `${s.url}|${largeurMm.toFixed(1)}`;
  if (simulations.cle === cle) return true;
  Object.values(simulations.urls).forEach((u) => URL.revokeObjectURL(u));
  simulations = { cle, urls: {} };
  const base = await s.dessiner(LARGEUR_SIMULATION);
  for (const [, vue] of VUES_BASSE_VISION) {
    const c = document.createElement('canvas');
    c.width = base.width;
    c.height = base.height;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.filter = filtreBasseVision(vue, base.width, largeurMm);
    ctx.drawImage(base, 0, 0);
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    if (simulations.cle !== cle) return false;
    simulations.urls[vue] = URL.createObjectURL(blob);
  }
  return simulations.cle === cle;
}

// vues : éléments de vuesVision ; chaque vignette ouvre la fenêtre agrandie sur sa vue.
function vignettes(vues) {
  return vues.map((v) => {
    const bouton = element('button', { type: 'button', class: 'vignette', 'aria-label': t('agrandirVue', { vue: t(v.cle) }) },
      element('img', { src: v.src, alt: '', class: v.classe }),
      element('span', { class: 'vignette-titre' }, t(v.cle)));
    bouton.addEventListener('click', () => ouvrirVue(vuesVision.indexOf(v)));
    return element('li', {}, bouton);
  });
}

// Vignettes ; un clic ouvre la vue en grand, où l'on passe d'une simulation à l'autre
// par les boutons ou les flèches du clavier.
async function rendreCouleurs() {
  if (!etat.source) return;
  // Fenêtre agrandie : l'original, puis la basse vision, puis les daltonismes.
  const daltonisme = VUES_DALTONISME.map(([cle, classe]) => ({ cle, classe, src: etat.source.url }));
  const [originale, ...autres] = daltonisme;
  vuesVision = daltonisme;
  $('couleurs').replaceChildren(...vignettes(daltonisme));
  if (!BASSE_VISION) {
    $('basse-vision').replaceChildren(element('li', { class: 'a-venir' }, t('basseVisionAVenir')));
    return;
  }
  $('basse-vision').replaceChildren(element('li', { class: 'discret' }, t('preparation')));
  const source = etat.source;
  if (!(await calculerBasseVision()) || source !== etat.source) return;
  const basse = VUES_BASSE_VISION.map(([cle, vue]) => ({ cle, classe: '', src: simulations.urls[vue] }));
  vuesVision = [originale, ...basse, ...autres];
  $('basse-vision').replaceChildren(...vignettes(basse));
}

function ouvrirVue(depart) {
  const d = $('dialogue-couleurs');
  const image = $('vue-grande');
  const vues = vuesVision;
  const boutons = vues.map((v, i) => {
    const b = element('button', { type: 'button', role: 'tab', 'aria-controls': 'vue-grande' }, t(v.cle));
    b.addEventListener('click', () => choisir(i));
    return b;
  });
  const choisir = (i) => {
    image.src = vues[i].src;
    image.className = vues[i].classe;
    boutons.forEach((b, k) => { b.setAttribute('aria-selected', String(k === i)); b.tabIndex = k === i ? 0 : -1; });
    d.dataset.vue = i;
  };
  $('vues-onglets').replaceChildren(...boutons);
  d.onkeydown = (e) => {
    const sens = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!sens) return;
    e.preventDefault();
    const i = (Number(d.dataset.vue) + sens + vues.length) % vues.length;
    choisir(i);
    boutons[i].focus();
  };
  choisir(depart);
  d.showModal();
  boutons[depart].focus();
}

// ── Chargement d'une figure ─────────────────────────────────────────────────────

function montrerErreur(cle, e) {
  if (e) console.error(e);
  $('erreur').textContent = t(cle);
  $('erreur').hidden = false;
}

async function charger(fichier) {
  $('erreur').hidden = true;
  delete document.body.dataset.etat;
  let source;
  try {
    source = await ouvrir(fichier);
  } catch (e) {
    montrerErreur('erreurFichier', e);
    return;
  }
  if (etat.source) URL.revokeObjectURL(etat.source.url);
  etat.source = source;
  $('choix-figure').hidden = true;
  $('figure-choisie').hidden = false;
  $('figure-miniature').src = source.url;
  $('figure-nom').textContent = source.nom;
  $('figure-taille').textContent = source.pixels ? t('figureTaille', { l: source.pixels.l, h: source.pixels.h }) : '';
  for (const b of document.querySelectorAll('.etape-bouton')) b.disabled = false;
  rendrePage();
  rendreCouleurs();
  analyser();
  const demandee = Number(params.get('etape'));
  ouvrirEtape(demandee >= 2 && demandee <= 4 ? demandee : 2);
}

// Retour à l'étape 1 : la figure est oubliée, les réglages sont gardés.
function autreFigure() {
  etat.jeton++;
  if (etat.source) URL.revokeObjectURL(etat.source.url);
  etat.source = null;
  etat.lecture = null;
  etat.endroits = null;
  $('fichier').value = '';
  $('choix-figure').hidden = false;
  $('figure-choisie').hidden = true;
  $('erreur').hidden = true;
  statut(null);
  rendreResumes();
  ouvrirEtape(1);
  $('depot').focus();
}

// Charge une figure servie à côté de la page : un exemple, ou `?figure=chemin` en
// développement (fichiers du dossier tmp/, non suivi).
async function chargerUrl(chemin) {
  const blob = await (await fetch(chemin)).blob();
  await charger(new File([blob], chemin.split('/').pop(), { type: blob.type }));
}

function chargerExemple(type) {
  return chargerUrl(EXEMPLES[type] || EXEMPLES.png);
}

// ── Calibration ─────────────────────────────────────────────────────────────────

function montrerCarte() {
  $('carte').style.width = `${$('carte-curseur').value * CARTE_MM}px`;
}

function preparerCalibration() {
  $('carte-curseur').value = etat.pxParMm || PX_PAR_MM_NOMINAL;
  montrerCarte();
}

function validerCalibration() {
  const v = parseFloat($('carte-curseur').value);
  etat.pxParMm = Math.abs(v - PX_PAR_MM_NOMINAL) < 0.005 ? null : v;
  ecrireCalibration(etat.pxParMm);
  if (etat.source) { rendrePage(); rendreProjection(); }
  ouvrirEtape(4);
}

// ── Étapes et vues ──────────────────────────────────────────────────────────────

const RESUMES = {
  1: () => (etat.source ? etat.source.nom : ''),
  2: () => (etat.source ? `${t(etat.format === 'revue' ? 'formatRevue' : 'formatLivre')} · Lc\u00a0${etat.seuil}` : ''),
  3: () => (etat.source ? t(etat.pxParMm ? 'resumeEcranOui' : 'resumeEcranNon') : ''),
  4: () => {
    if (!etat.source) return '';
    if (etat.endroits == null) return t('resumeAnalyseEnCours');
    return etat.endroits ? t('resumeAnalyse', { n: etat.endroits }) : t('resumeAnalyseOk');
  },
};

function rendreResumes() {
  for (const n of [1, 2, 3, 4]) $(`resume-${n}`).textContent = RESUMES[n]();
}

// Une seule étape ouverte. Les étapes passées portent une coche.
function ouvrirEtape(n) {
  etat.etape = n;
  for (const k of [1, 2, 3, 4]) {
    const ouverte = k === n;
    $(`etape-${k}-corps`).hidden = !ouverte;
    const bouton = document.querySelector(`.etape-bouton[data-etape="${k}"]`);
    bouton.setAttribute('aria-expanded', String(ouverte));
    $(`etape-${k}`).classList.toggle('ouverte', ouverte);
    const faite = Boolean(etat.source) && !ouverte && k < 4;
    $(`etape-${k}`).classList.toggle('faite', faite);
    bouton.querySelector('.etape-num').textContent = faite ? '✓' : String(k);
  }
  if (n === 3) preparerCalibration();
  if (n === 4 && etat.source) montrerVue(etat.onglet);
  rendreResumes();
  const li = $(`etape-${n}`);
  if (li.getBoundingClientRect().top < 0) li.scrollIntoView({ block: 'start' });
}

// Une seule vue de l'analyse à la fois.
function montrerVue(id) {
  etat.onglet = id;
  for (const b of document.querySelectorAll('.onglets-analyse [role="tab"]')) {
    const actif = b.dataset.vue === id;
    b.setAttribute('aria-selected', String(actif));
    b.tabIndex = actif ? 0 : -1;
    $(b.dataset.vue).hidden = !actif;
  }
  if (id === 'vue-page' && etat.source) zoomer();
  if (id === 'vue-projection') rendreProjection();
}

// ── Projection ──────────────────────────────────────────────────────────────────

// La diapositive est affichée à la taille apparente qu'elle aurait au dernier rang. Le
// bilan compare la hauteur des minuscules de chaque texte, sur l'écran de la salle, au
// minimum de la norme DISCAS.
function rendreProjection() {
  $('salle-largeur').value = String(Math.round(etat.ecranCm) / 100);
  $('salle-distance').value = String(Math.round(etat.distanceCm) / 100);
  for (const r of document.querySelectorAll('input[name="salle"]')) r.checked = r.value === etat.salle;
  if (!etat.source) return;
  const apparenteCm = largeurApparenteCm(etat.ecranCm, etat.distanceCm);
  const lPx = apparenteCm * (etat.pxParMm || PX_PAR_MM_NOMINAL) * 10;
  const cadre = cadreFigure(etat.source.ratio);
  const diapo = $('diapo');
  Object.assign(diapo.style, { width: `${lPx}px`, height: `${lPx * DIAPO.hauteur}px` });
  diapo.replaceChildren(
    element('div', { class: 'diapo-titre', style: {
      fontSize: `${32 * CM_PAR_PT / DIAPO.largeurCm * lPx}px`,
      height: `${DIAPO.titre * DIAPO.hauteur * lPx}px`,
      padding: `0 ${DIAPO.marge * lPx}px`,
    } }, t('diapoTitre')),
    element('img', { src: etat.source.url, alt: '', style: { width: `${cadre.l * lPx}px`, height: `${cadre.h * lPx}px` } }),
    element('div', { class: 'diapo-voile', style: { opacity: String(SALLES[etat.salle].voile) } }),
  );
  $('projection-consigne').textContent = `${t('projectionConsigne', {
    l: nombre(etat.ecranCm / 100, 2).replace(/,?0+$/, ''), d: nombre(etat.distanceCm / 100).replace(/,0$/, ''),
  })} ${etat.pxParMm ? '' : t('calibrationNon')}`;

  const bilan = $('projection-bilan');
  if (!etat.lecture) {
    bilan.className = 'bilan';
    bilan.replaceChildren(element('p', {}, t('projectionAttente')));
    return;
  }
  const { canevas, lignes } = etat.lecture;
  const figureCm = cadre.l * etat.ecranCm;
  // Hauteur d'x estimée depuis le corps, aussi pour les textes en capitales.
  const hauteurs = lignes.filter((l) => l.corpsPx).map((l) => l.corpsPx / canevas.width * figureCm * RATIO_X);
  if (!hauteurs.length) {
    bilan.className = 'bilan';
    bilan.replaceChildren(element('p', {}, t('aucunTexte')));
    return;
  }
  const minimum = minusculeMinCm(etat.distanceCm);
  const arrondi = (v) => Math.round(v * 10) / 10;
  const petits = hauteurs.filter((h) => arrondi(h) < arrondi(minimum)).length;
  const plusPetite = Math.min(...hauteurs);
  const valeurs = { d: nombre(etat.distanceCm / 100).replace(/,0$/, ''), min: nombre(minimum), x: nombre(plusPetite), n: petits, total: hauteurs.length,
    p: Math.ceil((minimum / plusPetite - 1) * 20) * 5 };
  bilan.className = `bilan ${petits ? 'corriger' : 'ok'}`;
  bilan.replaceChildren(element('p', {}, t(petits ? 'projectionPetit' : 'projectionOk', valeurs)));
}

function synchroniserReglages() {
  for (const r of document.querySelectorAll('input[name="format"]')) r.checked = r.value === etat.format;
  for (const r of document.querySelectorAll('input[name="seuil"]')) r.checked = Number(r.value) === etat.seuil;
  $('proportion').value = etat.proportion ? String(etat.proportion) : '';
}

function reglagesChanges() {
  rendreResumes();
  if (!etat.source) return;
  rendrePage();
  rendreCouleurs();
  if (etat.lecture) rendreAnalyse();
}

// ── Branchements ────────────────────────────────────────────────────────────────

function brancher() {
  const depot = $('depot');
  $('fichier').addEventListener('change', (e) => e.target.files[0] && charger(e.target.files[0]));
  depot.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fichier').click(); }
  });
  for (const type of ['dragenter', 'dragover']) {
    depot.addEventListener(type, (e) => { e.preventDefault(); depot.classList.add('survol'); });
  }
  for (const type of ['dragleave', 'drop']) depot.addEventListener(type, () => depot.classList.remove('survol'));
  depot.addEventListener('drop', (e) => {
    e.preventDefault();
    const fichier = e.dataTransfer.files[0];
    if (fichier) charger(fichier);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('exemple').addEventListener('click', () => chargerExemple('png'));
  $('autre-figure').addEventListener('click', autreFigure);
  $('langue').addEventListener('click', () => { etat.langue = etat.langue === 'fr' ? 'de' : 'fr'; appliquerLangue(); });

  // Étapes
  for (const b of document.querySelectorAll('.etape-bouton')) {
    b.disabled = b.dataset.etape !== '1';
    b.addEventListener('click', () => ouvrirEtape(Number(b.dataset.etape)));
  }
  for (const b of document.querySelectorAll('[data-aller]')) b.addEventListener('click', () => ouvrirEtape(Number(b.dataset.aller)));

  // Paramètres
  synchroniserReglages();
  for (const r of document.querySelectorAll('input[name="format"]')) {
    r.addEventListener('change', () => { etat.format = r.value; reglagesChanges(); });
  }
  for (const r of document.querySelectorAll('input[name="seuil"]')) {
    r.addEventListener('change', () => { etat.seuil = Number(r.value); reglagesChanges(); });
  }
  $('proportion').addEventListener('change', (e) => { etat.proportion = parseFloat(e.target.value) || null; reglagesChanges(); });

  // Info-bulle : un clic l'ouvre ou la ferme, Échap ou un clic ailleurs la ferme.
  const bulle = $('info-seuil'), boutonInfo = $('info-seuil-bouton');
  const basculer = (ouvrir) => { bulle.hidden = !ouvrir; boutonInfo.setAttribute('aria-expanded', String(ouvrir)); };
  boutonInfo.addEventListener('click', (e) => { e.preventDefault(); basculer(bulle.hidden); });
  document.addEventListener('click', (e) => { if (!bulle.hidden && !e.target.closest('.info')) basculer(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !bulle.hidden) { basculer(false); boutonInfo.focus(); } });

  // Écran
  $('carte-curseur').addEventListener('input', montrerCarte);
  $('carte-moins').addEventListener('click', () => { $('carte-curseur').value = parseFloat($('carte-curseur').value) - 0.02; montrerCarte(); });
  $('carte-plus').addEventListener('click', () => { $('carte-curseur').value = parseFloat($('carte-curseur').value) + 0.02; montrerCarte(); });
  $('carte-reinitialiser').addEventListener('click', () => { $('carte-curseur').value = PX_PAR_MM_NOMINAL; montrerCarte(); });
  $('carte-valider').addEventListener('click', validerCalibration);
  $('carte-passer').addEventListener('click', () => ouvrirEtape(4));
  $('calibrer').addEventListener('click', () => ouvrirEtape(3));

  // Projection : une salle type remplit la largeur et la distance, modifiables ensuite.
  for (const r of document.querySelectorAll('input[name="salle"]')) {
    r.addEventListener('change', () => {
      etat.salle = r.value;
      etat.ecranCm = SALLES[r.value].largeurCm;
      etat.distanceCm = SALLES[r.value].distanceCm;
      rendreProjection();
    });
  }
  const metres = (id, cle, min) => $(id).addEventListener('input', (e) => {
    const v = parseFloat(String(e.target.value).replace(',', '.'));
    if (v >= min) { etat[cle] = v * 100; rendreProjection(); }
  });
  metres('salle-largeur', 'ecranCm', 0.5);
  metres('salle-distance', 'distanceCm', 1);

  // Vues de l'analyse, onglets au clavier compris
  const onglets = [...document.querySelectorAll('.onglets-analyse [role="tab"]')];
  onglets.forEach((b, i) => {
    b.addEventListener('click', () => montrerVue(b.dataset.vue));
    b.addEventListener('keydown', (e) => {
      const sens = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!sens) return;
      e.preventDefault();
      const suivant = onglets[(i + sens + onglets.length) % onglets.length];
      montrerVue(suivant.dataset.vue);
      suivant.focus();
    });
  });
  for (const r of document.querySelectorAll('input[name="vue"]')) {
    r.addEventListener('change', () => { etat.vue = r.value; zoomer(); });
  }
  $('vue-fermer').addEventListener('click', () => $('dialogue-couleurs').close());
  $('dialogue-couleurs').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('imprimer').addEventListener('click', () => window.print());
  $('imprimer-rapport').addEventListener('click', imprimerRapport);
  window.addEventListener('resize', () => etat.source && etat.vue === 'page' && zoomer());
}

brancher();
appliquerLangue();
ouvrirEtape(1);
const vueDemandee = { page: 'vue-page', textes: 'rapport', couleurs: 'vue-couleurs', projection: 'vue-projection' }[params.get('vue')];
if (vueDemandee) etat.onglet = vueDemandee;
if (params.get('exemple')) chargerExemple(params.get('exemple'));
else if (/^tmp\/[\w.-]+$/.test(params.get('figure') || '')) chargerUrl(params.get('figure'));

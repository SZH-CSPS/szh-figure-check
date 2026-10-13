// Interface : dépôt, page simulée, tableau des textes, aperçus des couleurs.

import { FORMATS, zoneContenu, tailleFigure, versPoints, TAILLE_MIN_PT, LC_MIN, MM_PAR_PX } from './formats.js';
import { niveauTaille, niveauContraste, pireNiveau, agrandissement, couleurConforme, regrouper } from './analyse.js';
import { versHex } from './apca.js';
import { ouvrir } from './sources.js';
import { lire } from './lecture.js';
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
  return lignes.map((l) => {
    const pt = l.corpsPx ? versPoints(l.corpsPx, canevas.width, fig.l) : null;
    const lcv = l.contraste ? l.contraste.lc : null;
    // Le degré se décide sur la valeur affichée, arrondie comme elle s'écrit.
    const nt = niveauTaille(pt == null ? null : Math.round(pt * 10) / 10);
    const nc = niveauContraste(lcv == null ? null : Math.round(lcv));
    return { ...l, pt, lc: lcv, nt, nc, niveau: pireNiveau(nt, nc) };
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
    const proposition = couleurConforme(l.contraste.texte, l.contraste.fond);
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

function carteZone(groupe, numero, canevas) {
  const l = groupe.representant;
  const textes = groupe.membres.map((m) => `« ${m.texte} »`).join(', ');
  const ligneMesure = (cle, valeur, niveau, minimum, extra) => element('div', { class: 'mesure' },
    element('dt', {}, t(cle)),
    element('dd', { class: niveau || 'inconnu' }, element('b', {}, valeur), ` (${minimum}) `, extra,
      niveau && niveau !== 'ok' ? badge(niveau) : null));
  return element('li', { class: `zone ${l.niveau}`, id: `zone-${numero}` },
    element('div', { class: 'zone-tete' }, element('span', { class: 'numero' }, String(numero)), badge(l.niveau)),
    element('img', { src: extrait(canevas, l.bbox), alt: t('extraitAlt', { texte: l.texte }) }),
    element('dl', {},
      element('div', { class: 'mesure' }, element('dt', {}, t('zoneTexteLu')), element('dd', {}, textes)),
      ligneMesure('zoneTaille', texteTaille(l), l.nt, t('minimumTaille', { min: TAILLE_MIN_PT })),
      ligneMesure('zoneContraste', texteContraste(l), l.nc, t('minimumContraste', { lc: LC_MIN }),
        l.contraste ? nuancier(l.contraste.texte, l.contraste.fond) : null)),
    element('p', { class: 'que-faire' }, element('b', {}, t('queFaire'))),
    element('ul', {}, ...conseils(l, groupe.membres.length > 1)));
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
    tbody.replaceChildren();
    $('note-mesure').textContent = '';
    return;
  }
  const { canevas } = etat.lecture;
  const lignes = mesures();
  const aRevoir = regrouper(lignes.filter((l) => l.niveau && l.niveau !== 'ok'))
    .sort((a, b) => (a.representant.niveau === b.representant.niveau ? 0 : a.representant.niveau === 'corriger' ? -1 : 1));
  const numeros = new Map(aRevoir.flatMap((g, i) => g.membres.map((l) => [l, i + 1])));

  // Figure annotée : un cadre par texte lu, un numéro sur ceux à revoir.
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${canevas.width} ${canevas.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const corpsNumero = Math.max(28, canevas.width / 45);
  const rects = lignes.map((l) => {
    const m = 4;
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', l.bbox.x0 - m); r.setAttribute('y', l.bbox.y0 - m);
    r.setAttribute('width', l.bbox.x1 - l.bbox.x0 + 2 * m); r.setAttribute('height', l.bbox.y1 - l.bbox.y0 + 2 * m);
    r.setAttribute('class', l.niveau || 'inconnu');
    svg.append(r);
    if (numeros.has(l)) {
      const n = document.createElementNS(ns, 'text');
      n.setAttribute('x', l.bbox.x0 - m);
      n.setAttribute('y', l.bbox.y0 - m - corpsNumero * 0.2);
      n.setAttribute('font-size', corpsNumero);
      n.setAttribute('class', 'numero-zone');
      n.textContent = numeros.get(l);
      svg.append(n);
    }
    return r;
  });
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

  // Endroits à revoir
  $('zones-titre').hidden = !aRevoir.length;
  $('zones-titre').textContent = t('zonesTitre', { n: aRevoir.length });
  $('zones').replaceChildren(...aRevoir.map((g, i) => carteZone(g, i + 1, canevas)));

  // Tous les textes
  tbody.replaceChildren(...lignes.map((l, i) => {
    const cellule = (valeur, niveau) => element('td', { class: niveau || 'inconnu' }, valeur,
      niveau && niveau !== 'ok' ? element('span', { class: 'etiquette' }, t(`niveau_${niveau}`)) : null);
    const tr = element('tr', {},
      element('td', { class: 'texte-lu' }, l.texte, l.vertical ? element('span', { class: 'etiquette discret' }, t('vertical')) : null),
      cellule(texteTaille(l), l.nt),
      cellule(texteContraste(l), l.nc),
      element('td', {}, l.contraste ? nuancier(l.contraste.texte, l.contraste.fond) : null));
    const activer = (oui) => { tr.classList.toggle('actif', oui); rects[i].classList.toggle('actif', oui); };
    tr.addEventListener('mouseenter', () => activer(true));
    tr.addEventListener('mouseleave', () => activer(false));
    return tr;
  }));
  $('details-textes').hidden = !lignes.length;
  $('details-titre').textContent = t('tousTextes', { n: lignes.length });
  $('imprimer-rapport').hidden = !lignes.length;

  const exact = lignes.length && lignes.every((l) => l.exact);
  $('note-mesure').textContent = `${t('seuils', { min: TAILLE_MIN_PT, lc: LC_MIN, corps: nombre(f.corpsPt) })} ${lignes.length ? t(exact ? 'noteExacte' : 'noteEstimation') : ''}`;
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

function rendreCouleurs() {
  const vues = [
    ['vueOriginale', ''], ['vueDeuteranopie', 'f-deuteranopie'], ['vueProtanopie', 'f-protanopie'],
    ['vueTritanopie', 'f-tritanopie'], ['vueGris', 'f-gris'],
  ];
  $('couleurs').replaceChildren(...vues.map(([cle, classe]) =>
    element('figure', {}, element('img', { src: etat.source.url, alt: '', class: classe }), element('figcaption', {}, t(cle)))));
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
  $('resultats').hidden = false;
  rendrePage();
  rendreCouleurs();
  analyser();
}

async function chargerExemple(type) {
  const reponse = await fetch(EXEMPLES[type] || EXEMPLES.png);
  const blob = await reponse.blob();
  const nom = (EXEMPLES[type] || EXEMPLES.png).split('/').pop();
  await charger(new File([blob], nom, { type: blob.type }));
}

// ── Calibration ─────────────────────────────────────────────────────────────────

function ouvrirCalibration() {
  const d = $('dialogue-calibration');
  const curseur = $('carte-curseur');
  curseur.value = etat.pxParMm || PX_PAR_MM_NOMINAL;
  const montrer = () => { $('carte').style.width = `${curseur.value * CARTE_MM}px`; };
  curseur.oninput = montrer;
  $('carte-moins').onclick = () => { curseur.value = parseFloat(curseur.value) - 0.02; montrer(); };
  $('carte-plus').onclick = () => { curseur.value = parseFloat(curseur.value) + 0.02; montrer(); };
  $('carte-annuler').onclick = () => d.close();
  $('carte-reinitialiser').onclick = () => { curseur.value = PX_PAR_MM_NOMINAL; montrer(); };
  $('carte-valider').onclick = () => {
    const v = parseFloat(curseur.value);
    etat.pxParMm = Math.abs(v - PX_PAR_MM_NOMINAL) < 0.005 ? null : v;
    ecrireCalibration(etat.pxParMm);
    d.close();
    if (etat.source) rendrePage();
  };
  montrer();
  d.showModal();
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
  $('langue').addEventListener('click', () => { etat.langue = etat.langue === 'fr' ? 'de' : 'fr'; appliquerLangue(); });
  for (const r of document.querySelectorAll('input[name="format"]')) {
    r.checked = r.value === etat.format;
    r.addEventListener('change', () => { etat.format = r.value; rendrePage(); if (etat.lecture) rendreAnalyse(); });
  }
  for (const r of document.querySelectorAll('input[name="vue"]')) {
    r.addEventListener('change', () => { etat.vue = r.value; zoomer(); });
  }
  $('proportion').addEventListener('change', (e) => {
    etat.proportion = parseFloat(e.target.value) || null;
    rendrePage();
    if (etat.lecture) rendreAnalyse();
  });
  $('calibrer').addEventListener('click', ouvrirCalibration);
  $('imprimer').addEventListener('click', () => window.print());
  $('imprimer-rapport').addEventListener('click', imprimerRapport);
  window.addEventListener('resize', () => etat.source && etat.vue === 'page' && zoomer());
}

brancher();
appliquerLangue();
if (params.get('exemple')) chargerExemple(params.get('exemple'));

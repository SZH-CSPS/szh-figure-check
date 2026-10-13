// Interface : dépôt, page simulée, tableau des textes, aperçus des couleurs.

import { FORMATS, zoneContenu, tailleFigure, versPoints, TAILLE_MIN_PT, LC_MIN, MM_PAR_PX } from './formats.js';
import { verdictTaille, verdictContraste } from './analyse.js';
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
    const vt = verdictTaille(pt), vc = verdictContraste(lcv);
    const pire = vt === 'echec' || vc === 'echec' ? 'echec' : vt === 'inconnu' && vc === 'inconnu' ? 'inconnu' : 'ok';
    return { ...l, pt, lc: lcv, vt, vc, pire };
  });
}

function rendreAnalyse() {
  const cadre = $('analyse-figure');
  const tbody = document.querySelector('#table-textes tbody');
  if (!etat.lecture) {
    cadre.replaceChildren(element('img', { src: etat.source.url, alt: '' }));
    tbody.replaceChildren();
    $('table-textes').hidden = true;
    $('resume').replaceChildren();
    $('note-mesure').textContent = '';
    return;
  }
  const { canevas } = etat.lecture;
  const lignes = mesures();
  const f = FORMATS[etat.format];

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${canevas.width} ${canevas.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const rects = lignes.map((l) => {
    const r = document.createElementNS(svg.namespaceURI, 'rect');
    const m = 3;
    r.setAttribute('x', l.bbox.x0 - m); r.setAttribute('y', l.bbox.y0 - m);
    r.setAttribute('width', l.bbox.x1 - l.bbox.x0 + 2 * m); r.setAttribute('height', l.bbox.y1 - l.bbox.y0 + 2 * m);
    r.setAttribute('class', l.pire);
    svg.append(r);
    return r;
  });
  cadre.replaceChildren(element('img', { src: etat.source.url, alt: '' }), svg);

  const lignesTable = lignes.map((l, i) => {
    const approx = l.exact ? '' : '≈ ';
    const taille = l.pt == null ? t('nonMesure') : `${approx}${nombre(l.pt)} pt`;
    const contraste = l.lc == null ? t('nonMesure') : `Lc ${Math.round(Math.abs(l.lc))}`;
    const nuancier = l.contraste
      ? element('span', { class: 'nuancier', title: `${versHex(l.contraste.texte)} / ${versHex(l.contraste.fond)}` },
        element('span', { style: { background: versHex(l.contraste.texte) } }),
        element('span', { style: { background: versHex(l.contraste.fond) } }))
      : null;
    const tr = element('tr', {},
      element('td', { class: 'texte-lu' }, l.texte, l.vertical ? element('span', { class: 'etiquette discret' }, t('vertical')) : null),
      element('td', { class: l.vt }, taille, l.vt === 'echec' ? element('span', { class: 'etiquette' }, t('verdictPetit')) : null),
      element('td', { class: l.vc }, contraste, l.vc === 'echec' ? element('span', { class: 'etiquette' }, t('verdictContraste')) : null),
      element('td', {}, nuancier),
    );
    const activer = (oui) => { tr.classList.toggle('actif', oui); rects[i].classList.toggle('actif', oui); };
    tr.addEventListener('mouseenter', () => activer(true));
    tr.addEventListener('mouseleave', () => activer(false));
    return tr;
  });
  tbody.replaceChildren(...lignesTable);
  $('table-textes').hidden = !lignes.length;

  const resume = [];
  if (!lignes.length) {
    resume.push(element('p', {}, t('aucunTexte')));
  } else {
    const tailles = lignes.map((l) => l.pt).filter((v) => v != null);
    const petits = lignes.filter((l) => l.vt === 'echec').length;
    const faibles = lignes.filter((l) => l.vc === 'echec').length;
    resume.push(element('span', {}, t('textesLus', { n: lignes.length })));
    if (tailles.length) {
      resume.push(element('span', {}, t('plusPetitTexte', { pt: nombre(Math.min(...tailles)), min: TAILLE_MIN_PT })));
    }
    if (petits) resume.push(element('span', { class: 'pastille echec' }, t('tropPetits', { n: petits })));
    if (faibles) resume.push(element('span', { class: 'pastille echec' }, t('contrasteFaible', { n: faibles })));
    if (!petits && !faibles) resume.push(element('span', { class: 'pastille ok' }, t('toutLisible')));
  }
  $('resume').replaceChildren(...resume);
  const exact = lignes.length && lignes.every((l) => l.exact);
  $('note-mesure').textContent = `${t('seuils', { min: TAILLE_MIN_PT, lc: LC_MIN, corps: nombre(f.corpsPt) })} ${lignes.length ? t(exact ? 'noteExacte' : 'noteEstimation') : ''}`;
}

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
  window.addEventListener('resize', () => etat.source && etat.vue === 'page' && zoomer());
}

brancher();
appliquerLangue();
if (params.get('exemple')) chargerExemple(params.get('exemple'));

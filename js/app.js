// Interface : dépôt, page simulée, tableau des textes, aperçus des couleurs.

import { FORMATS, zoneContenu, tailleFigure, versPoints, TAILLE_MIN_PT, LC_MIN, MM_PAR_PX } from './formats.js';
import { niveauTaille, niveauContraste, pireNiveau, agrandissement, couleurConforme, regrouper, diagnosticEnsemble } from './analyse.js';
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
  return lignes.map((l, id) => {
    const pt = l.corpsPx ? versPoints(l.corpsPx, canevas.width, fig.l) : null;
    const lcv = l.contraste ? l.contraste.lc : null;
    // Le degré se décide sur la valeur affichée, arrondie comme elle s'écrit.
    const nt = niveauTaille(pt == null ? null : Math.round(pt * 10) / 10);
    const nc = niveauContraste(lcv == null ? null : Math.round(lcv));
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

const TEXTES_PAR_CARTE = 6;
const CARTES_MAX = 8;

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

// `sansTaille` : la taille est traitée par le diagnostic d'ensemble, la carte ne conseille
// que sur le contraste.
function carteZone(groupe, numero, canevas, survol, sansTaille = false) {
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
      ligneMesure('zoneContraste', r.contraste, r.pour.nc, t('minimumContraste', { lc: LC_MIN }),
        r.pour.contraste ? nuancier(r.pour.contraste.texte, r.pour.contraste.fond) : null)),
    element('p', { class: 'que-faire' }, element('b', {}, t('queFaire'))),
    element('ul', {}, ...conseils(sansTaille ? { ...r.pour, nt: null } : r.pour, n > 1)));
  carte.addEventListener('mouseenter', () => survol(groupe, true));
  carte.addEventListener('mouseleave', () => survol(groupe, false));
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
  const numeros = new Map(affiches.map((g, i) => [g.representant.id, i + 1]));

  // Figure annotée : un cadre par texte lu, le numéro de sa carte sur le représentant.
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${canevas.width} ${canevas.height}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const corpsNumero = Math.max(28, canevas.width / 45);
  const rectDe = new Map();
  lignes.forEach((l) => {
    const m = 4;
    const r = document.createElementNS(ns, 'rect');
    r.setAttribute('x', l.bbox.x0 - m); r.setAttribute('y', l.bbox.y0 - m);
    r.setAttribute('width', l.bbox.x1 - l.bbox.x0 + 2 * m); r.setAttribute('height', l.bbox.y1 - l.bbox.y0 + 2 * m);
    r.setAttribute('class', l.niveau || 'inconnu');
    svg.append(r);
    rectDe.set(l.id, r);
    if (numeros.has(l.id)) {
      const n = document.createElementNS(ns, 'text');
      n.setAttribute('x', l.bbox.x0 - m);
      n.setAttribute('y', l.bbox.y0 - m - corpsNumero * 0.2);
      n.setAttribute('font-size', corpsNumero);
      n.setAttribute('class', 'numero-zone');
      n.textContent = numeros.get(l.id);
      svg.append(n);
    }
  });
  const survol = (groupe, oui) => groupe.membres.forEach((l) => rectDe.get(l.id).classList.toggle('actif', oui));
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
  $('zones').replaceChildren(...affiches.map((g, i) => carteZone(g, i + 1, canevas, survol, Boolean(diag))));
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
    const activer = (oui) => { tr.classList.toggle('actif', oui); rectDe.get(l.id).classList.toggle('actif', oui); };
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
else if (/^tmp\/[\w.-]+$/.test(params.get('figure') || '')) chargerUrl(params.get('figure'));

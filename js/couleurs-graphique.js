// Couleurs des éléments graphiques d'une figure (barres, secteurs, aplats, courbes épaisses) :
// repérage des couleurs dominantes, contraste de chacune avec le fond, et écart entre deux
// couleurs en vision normale, pour trois daltonismes et en niveaux de gris.
// Les fonctions de calcul n'ont pas besoin du DOM ; rendreCouleursGraphique() dessine le bloc
// du rapport.

import { lc, luminanceApca, rapportWcag, versHex } from './apca.js?v=25c40bd6e2';
import { T, nombre } from './i18n.js?v=25c40bd6e2';

// ── Seuils ──────────────────────────────────────────────────────────────────────

// Une couleur compte si elle couvre au moins 0,5 % de l'image ; au plus 8 couleurs.
export const PART_MIN = 0.005;
export const COULEURS_MAX = 8;
// Deux nuances à moins de 12 unités Lab (CIE76) l'une de l'autre sont une seule couleur :
// le bruit d'une image compressée reste en deçà, deux teintes d'une même gamme au-delà.
export const RAYON_REGROUPEMENT = 12;
// Pixels à moins de 10 unités Lab du fond : le fond.
export const RAYON_FOND = 10;
// Un pixel dont un voisin direct diffère de plus de 16 sur un canal (0 à 255) est un bord
// lissé ou une texture, pas un aplat.
export const ECART_VOISINS = 16;
// Un aplat a presque tous ses pixels de la même couleur : au moins les trois quarts des pixels
// d'une couleur retenue sont à moins de 4 unités Lab de sa nuance la plus fréquente. Les
// dégradés d'une photo s'étalent sur tout le rayon de regroupement et n'y arrivent pas.
export const RAYON_NUANCE = 4;
export const CONCENTRATION_MIN = 0.75;
// Dans un graphique, presque tous les pixels unis hors fond appartiennent à un aplat retenu
// (plus de 90 % sur la figure d'exemple, même enregistrée en JPEG de qualité 40). Dans une
// photo ou un dégradé, ils s'étalent sur des dizaines de nuances voisines (moins de 20 %) :
// sous 60 %, la figure n'a pas d'aplats et aucune couleur n'est retenue.
export const COUVERTURE_MIN = 0.6;
const ECHANTILLONS_MAX = 1.5e6;

// Contraste avec le fond. WCAG 2.2, critère 1.4.11 (contraste du non-textuel) : 3:1 pour
// un élément graphique nécessaire à la compréhension. APCA : Lc 30, plancher des éléments
// non textuels, la valeur que retient Pronto. « À corriger » commence sous 2:1 ou sous
// Lc 15, la moitié de ces planchers : l'élément se perd alors dans le fond.
export const WCAG_GRAPHIQUE = 3;
export const WCAG_GRAVE = 2;
export const LC_GRAPHIQUE = 30;
export const LC_GRAVE = 15;
const TOLERANCE_LC = 0.5;                // comme pour les textes : décidé sur la valeur arrondie

// Écart entre deux couleurs, en CIEDE2000. Deux grandes pastilles côte à côte se
// distinguent dès ΔE00 ≈ 1 (écart juste perceptible). Une série de graphique doit se
// reconnaître d'après une légende placée ailleurs, sur des marques plus petites : il faut
// bien davantage (Stone, Szafir et Setlur, 2014 ; Szafir, 2018). Sous 5, deux couleurs se
// confondent. Sous 12, elles se distinguent mal : CIEDE2000 compte peu un écart de
// saturation seule, et deux couleurs de même teinte et de même clarté (un olive vif et un
// olive terne) restent sous ce seuil.
export const DELTA_E_DISTINCT = 12;
export const DELTA_E_CONFONDU = 5;

// ── Espaces de couleur ──────────────────────────────────────────────────────────

function versLineaire(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function depuisLineaire(v) {
  v = Math.min(1, Math.max(0, v));
  return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
}

// CIELAB, blanc D65.
const BLANC = [0.95047, 1, 1.08883];
export function versLab(rgb) {
  const [r, g, b] = rgb.map(versLineaire);
  const xyz = [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
    0.0193339 * r + 0.1191920 * g + 0.9503041 * b,
  ];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = xyz.map((v, i) => f(v / BLANC[i]));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function distanceLab(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const rad = (d) => (d * Math.PI) / 180;

// CIEDE2000 (Sharma, Wu et Dalal, 2005), kL = kC = kH = 1.
export function ciede2000(lab1, lab2) {
  const [L1, a1, b1] = lab1, [L2, a2, b2] = lab2;
  const C7 = ((Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(C7 / (C7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const teinte = (b, a) => {
    if (a === 0 && b === 0) return 0;
    const h = (Math.atan2(b, a) * 180) / Math.PI;
    return h < 0 ? h + 360 : h;
  };
  const h1p = teinte(b1, a1p), h2p = teinte(b2, a2p);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lm = (L1 + L2) / 2, Cm = (C1p + C2p) / 2;
  let hm = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hm /= 2;
    else hm = (hm < 360 ? hm + 360 : hm - 360) / 2;
  }
  const Tt = 1 - 0.17 * Math.cos(rad(hm - 30)) + 0.24 * Math.cos(rad(2 * hm))
    + 0.32 * Math.cos(rad(3 * hm + 6)) - 0.2 * Math.cos(rad(4 * hm - 63));
  const dTheta = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Cm7 = Cm ** 7;
  const RC = 2 * Math.sqrt(Cm7 / (Cm7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const SC = 1 + 0.045 * Cm;
  const SH = 1 + 0.015 * Cm * Tt;
  const RT = -Math.sin(rad(2 * dTheta)) * RC;
  const l = dLp / SL, c = dCp / SC, h = dHp / SH;
  return Math.sqrt(l * l + c * c + h * h + RT * c * h);
}

// ── Visions simulées ────────────────────────────────────────────────────────────

// Matrices de Machado, Oliveira et Fernandes (2009), sévérité 1, en RVB linéaire : les
// mêmes que les filtres SVG de index.html.
export const MATRICES = {
  deuteranopie: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  protanopie: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  tritanopie: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
export const VISIONS = ['normale', 'deuteranopie', 'protanopie', 'tritanopie', 'gris'];

// La couleur telle que la voit une vision ; « gris » garde la luminance relative.
export function simuler(rgb, vision) {
  if (vision === 'normale') return [...rgb];
  const lin = rgb.map(versLineaire);
  if (vision === 'gris') {
    const g = depuisLineaire(0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.0721750 * lin[2]);
    return [g, g, g];
  }
  return MATRICES[vision].map((ligne) => depuisLineaire(ligne[0] * lin[0] + ligne[1] * lin[1] + ligne[2] * lin[2]));
}

// ΔE00 entre deux couleurs pour chaque vision.
export function ecartsPaire(a, b) {
  const ecarts = {};
  for (const v of VISIONS) ecarts[v] = ciede2000(versLab(simuler(a, v)), versLab(simuler(b, v)));
  return ecarts;
}

// ── Verdicts ────────────────────────────────────────────────────────────────────

const RANG = { ok: 0, ameliorer: 1, corriger: 2 };
const pire = (...n) => n.reduce((a, b) => (RANG[b] > RANG[a] ? b : a), 'ok');

// Contraste d'une couleur avec le fond : rapport WCAG et |Lc| APCA, et le degré, le pire des
// deux critères. Le rapport WCAG ne s'arrondit pas : 2,99:1 n'atteint pas 3:1.
export function contrasteGraphique(couleur, fond) {
  const wcag = rapportWcag(couleur, fond);
  const lcv = Math.abs(lc(couleur, fond));
  const nw = wcag >= WCAG_GRAPHIQUE ? 'ok' : wcag >= WCAG_GRAVE ? 'ameliorer' : 'corriger';
  const l = Math.round(lcv) + TOLERANCE_LC;
  const nl = l >= LC_GRAPHIQUE ? 'ok' : l >= LC_GRAVE ? 'ameliorer' : 'corriger';
  return { wcag, lc: lcv, niveau: pire(nw, nl) };
}

// Degré d'une paire et visions où elle se distingue mal, de la plus difficile à la moins.
export function verdictPaire(ecarts) {
  const visions = VISIONS.filter((v) => ecarts[v] < DELTA_E_DISTINCT).sort((a, b) => ecarts[a] - ecarts[b]);
  const min = Math.min(...VISIONS.map((v) => ecarts[v]));
  const niveau = min < DELTA_E_CONFONDU ? 'corriger' : min < DELTA_E_DISTINCT ? 'ameliorer' : 'ok';
  return { niveau, visions, min };
}

function melange(a, b, t) {
  return a.map((c, i) => Math.round(c + (b[i] - c) * t));
}

// Nuance la plus proche de la couleur qui atteint 3:1 et Lc 40 sur ce fond (Lc 30 avec
// 10 de marge pour l'impression), à défaut juste les minimums : assombrie sur un fond
// clair, éclaircie sur un fond sombre, puis dans l'autre sens. null si aucune n'y arrive.
export function teinteConforme(couleur, fond) {
  const fondClair = luminanceApca(fond) > luminanceApca(couleur);
  const sens = fondClair ? [[0, 0, 0], [255, 255, 255]] : [[255, 255, 255], [0, 0, 0]];
  for (const marge of [10, 0]) {
    for (const extreme of sens) {
      for (let t = 0.02; t <= 1.0001; t += 0.02) {
        const c = melange(couleur, extreme, t);
        if (rapportWcag(c, fond) >= WCAG_GRAPHIQUE && Math.abs(lc(c, fond)) >= LC_GRAPHIQUE + marge) return c;
      }
    }
  }
  return null;
}

// ── Couleurs dominantes ─────────────────────────────────────────────────────────

// Couleur d'un pixel réduite à 5 bits par canal : 32 768 cases.
const caseDe = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

function moyenneCases(cases, indices) {
  let n = 0, r = 0, g = 0, b = 0;
  for (const i of indices) { n += cases.n[i]; r += cases.r[i]; g += cases.g[i]; b += cases.b[i]; }
  return n ? [r / n, g / n, b / n] : null;
}

// Fond : la couleur la plus fréquente sur le pourtour de l'image.
export function couleurFond(rgba, largeur, hauteur) {
  const bande = Math.max(1, Math.round(Math.min(largeur, hauteur) * 0.01));
  const n = new Uint32Array(32768), r = new Float64Array(32768), g = new Float64Array(32768), b = new Float64Array(32768);
  const compter = (x, y) => {
    const p = (y * largeur + x) * 4;
    const k = caseDe(rgba[p], rgba[p + 1], rgba[p + 2]);
    n[k]++; r[k] += rgba[p]; g[k] += rgba[p + 1]; b[k] += rgba[p + 2];
  };
  for (let y = 0; y < hauteur; y++) {
    if (y < bande || y >= hauteur - bande) for (let x = 0; x < largeur; x++) compter(x, y);
    else for (let d = 0; d < bande; d++) { compter(d, y); compter(largeur - 1 - d, y); }
  }
  let mode = 0;
  for (let k = 1; k < 32768; k++) if (n[k] > n[mode]) mode = k;
  return [r[mode] / n[mode], g[mode] / n[mode], b[mode] / n[mode]];
}

// Repère les couleurs dominantes d'une figure. `boites` : boîtes des textes lus, en pixels,
// écartées avec une marge. Rend { fond, couleurs: [{ rgb, part }], couverture, aplats } :
// `part` est la part de l'image couverte par une couleur, `couverture` la part des pixels
// unis hors fond qui tombent dans une couleur retenue, et `aplats` dit si la figure a des
// aplats de couleur.
export function couleursDominantes(rgba, largeur, hauteur, boites = []) {
  const fond = couleurFond(rgba, largeur, hauteur);
  const labFond = versLab(fond);

  const masque = new Uint8Array(largeur * hauteur);
  for (const b of boites) {
    const marge = 2 + 0.25 * (b.y1 - b.y0);
    const x0 = Math.max(0, Math.floor(b.x0 - marge)), x1 = Math.min(largeur, Math.ceil(b.x1 + marge));
    const y0 = Math.max(0, Math.floor(b.y0 - marge)), y1 = Math.min(hauteur, Math.ceil(b.y1 + marge));
    for (let y = y0; y < y1; y++) masque.fill(1, y * largeur + x0, y * largeur + x1);
  }

  // Les pixels d'aplat, ni texte ni bord, sur une grille régulière.
  const pas = Math.max(1, Math.ceil(Math.sqrt((largeur * hauteur) / ECHANTILLONS_MAX)));
  const cases = { n: new Uint32Array(32768), r: new Float64Array(32768), g: new Float64Array(32768), b: new Float64Array(32768) };
  let echantillons = 0;
  const voisinProche = (p, q) => Math.abs(rgba[p] - rgba[q]) <= ECART_VOISINS
    && Math.abs(rgba[p + 1] - rgba[q + 1]) <= ECART_VOISINS && Math.abs(rgba[p + 2] - rgba[q + 2]) <= ECART_VOISINS;
  for (let y = 1; y < hauteur - 1; y += pas) {
    for (let x = 1; x < largeur - 1; x += pas) {
      echantillons++;
      const i = y * largeur + x;
      if (masque[i]) continue;
      const p = i * 4;
      if (!(voisinProche(p, p - 4) && voisinProche(p, p + 4) && voisinProche(p, p - largeur * 4) && voisinProche(p, p + largeur * 4))) continue;
      const k = caseDe(rgba[p], rgba[p + 1], rgba[p + 2]);
      cases.n[k]++; cases.r[k] += rgba[p]; cases.g[k] += rgba[p + 1]; cases.b[k] += rgba[p + 2];
    }
  }

  // Cases hors fond, des plus remplies aux moins remplies, regroupées autour des premières.
  const liste = [];
  for (let k = 0; k < 32768; k++) {
    if (!cases.n[k]) continue;
    const lab = versLab(moyenneCases(cases, [k]));
    if (distanceLab(lab, labFond) >= RAYON_FOND) liste.push({ k, n: cases.n[k], lab });
  }
  liste.sort((a, b) => b.n - a.n);
  const groupes = [];
  for (const c of liste) {
    let meilleur = null, d = RAYON_REGROUPEMENT;
    for (const g of groupes) {
      const e = distanceLab(c.lab, g.lab);
      if (e < d) { d = e; meilleur = g; }
    }
    if (meilleur) {
      meilleur.n += c.n;
      if (distanceLab(c.lab, meilleur.lab) < RAYON_NUANCE) meilleur.coeur.push(c.k);
    } else {
      groupes.push({ lab: c.lab, n: c.n, coeur: [c.k] });
    }
  }

  const retenus = groupes.filter((g) => g.n / echantillons >= PART_MIN);
  const aplats = retenus.filter((g) => g.coeur.reduce((s, k) => s + cases.n[k], 0) / g.n >= CONCENTRATION_MIN);
  const horsFond = liste.reduce((s, c) => s + c.n, 0);
  const couverture = horsFond ? aplats.reduce((s, g) => s + g.n, 0) / horsFond : 0;
  const couleurs = couverture < COUVERTURE_MIN ? [] : aplats
    .sort((a, b) => b.n - a.n)
    .slice(0, COULEURS_MAX)
    .map((g) => ({ rgb: moyenneCases(cases, g.coeur).map(Math.round), part: g.n / echantillons }));
  return { fond: fond.map(Math.round), couleurs, couverture, aplats: couleurs.length > 0 };
}

// Analyse complète : contraste de chaque couleur et paires difficiles à distinguer.
export function analyserCouleurs(dominantes) {
  const { fond, couleurs } = dominantes;
  const mesurees = couleurs.map((c) => ({ ...c, contraste: contrasteGraphique(c.rgb, fond) }));
  const paires = [];
  for (let i = 0; i < mesurees.length; i++) {
    for (let j = i + 1; j < mesurees.length; j++) {
      const ecarts = ecartsPaire(mesurees[i].rgb, mesurees[j].rgb);
      const verdict = verdictPaire(ecarts);
      if (verdict.niveau !== 'ok') paires.push({ a: mesurees[i], b: mesurees[j], ecarts, ...verdict });
    }
  }
  paires.sort((p, q) => p.min - q.min);
  const niveau = pire(...mesurees.map((c) => c.contraste.niveau), ...paires.map((p) => p.niveau));
  return { fond, couleurs: mesurees, paires, niveau };
}

// ── Bloc du rapport ─────────────────────────────────────────────────────────────

const SYMBOLES = { corriger: '✕', ameliorer: '!', ok: '✓' };
const cache = new WeakMap();

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

function analyseDe(lecture) {
  if (!cache.has(lecture)) {
    const c = lecture.canevas;
    const rgba = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
    const boites = lecture.lignes.flatMap((l) => l.mots || [l.bbox]);
    cache.set(lecture, analyserCouleurs(couleursDominantes(rgba, c.width, c.height, boites)));
  }
  return cache.get(lecture);
}

// Remplit `conteneur` avec le bloc « Couleurs du graphique » ; le vide sans lecture.
export function rendreCouleursGraphique(conteneur, lecture, langue) {
  if (!lecture) {
    conteneur.replaceChildren();
    return;
  }
  const t = (cle, valeurs) => T(langue, cle, valeurs);
  const analyse = analyseDe(lecture);
  const badge = (niveau) => element('span', { class: `badge ${niveau}` },
    element('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES[niveau]), ' ', t(`niveau_${niveau}`));
  const pastille = (rgb, classe = '') => element('span', { class: `cg-pastille ${classe}`, style: { background: versHex(rgb) }, title: versHex(rgb) });
  const pourcent = (v) => (v < 0.1 ? nombre(v * 100) : String(Math.round(v * 100)));
  const wcag = (v) => nombre(Math.floor(v * 10) / 10);

  const titre = element('h4', {}, t('graphiqueTitre'));
  if (!analyse.couleurs.length) {
    conteneur.replaceChildren(element('section', { class: 'cg' }, titre, element('p', { class: 'discret' }, t('graphiqueAucune'))));
    return;
  }

  const bilan = element('div', { class: `bilan ${analyse.niveau}` },
    element('p', { class: 'bilan-titre' }, element('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES[analyse.niveau]), ' ',
      t(`graphiqueBilan_${analyse.niveau}`)),
    element('p', {}, t('graphiqueIntro', { n: analyse.couleurs.length })));

  const fond = element('p', { class: 'cg-fond' }, pastille(analyse.fond, 'petite'), ' ', t('graphiqueFond', { hex: versHex(analyse.fond) }));

  const couleurs = element('ul', { class: 'cg-couleurs' }, ...analyse.couleurs.map((c) => {
    const k = c.contraste;
    const contenu = [
      element('div', { class: 'cg-tete' }, pastille(c.rgb),
        element('span', {}, element('b', {}, versHex(c.rgb)), element('br'),
          element('span', { class: 'discret' }, t('graphiquePart', { p: pourcent(c.part) })))),
      element('p', { class: 'cg-mesure' }, t('graphiqueContraste', {
        wcag: wcag(k.wcag), min: WCAG_GRAPHIQUE, lc: Math.round(k.lc), lcmin: LC_GRAPHIQUE,
      })),
      badge(k.niveau),
    ];
    if (k.niveau !== 'ok') {
      const teinte = teinteConforme(c.rgb, analyse.fond);
      const conseil = teinte ? t('graphiqueConseilTeinte', { hex: '\u0000' }).split('\u0000') : [t('graphiqueConseilFond')];
      contenu.push(element('p', { class: 'que-faire' }, element('b', {}, t('queFaireDeuxPoints')), ' ',
        conseil[0], teinte ? element('b', {}, versHex(teinte)) : null, teinte ? ' ' : null, teinte ? pastille(teinte, 'petite') : null,
        conseil[1] ?? null, ' ', t('graphiqueConseilContour')));
    }
    return element('li', { class: `cg-couleur ${k.niveau}` }, ...contenu);
  }));

  const blocs = [titre, bilan, fond, couleurs];
  if (analyse.paires.length) {
    blocs.push(element('h5', {}, t('graphiquePairesTitre', { n: analyse.paires.length })));
    blocs.push(element('ul', { class: 'cg-paires' }, ...analyse.paires.map((p) => {
      const visions = p.visions.map((v) => element('li', {},
        element('span', { class: 'cg-duo' }, pastille(simuler(p.a.rgb, v)), pastille(simuler(p.b.rgb, v))),
        element('span', {}, element('b', {}, t(`graphiqueVision_${v}`)), ' ',
          t(p.ecarts[v] < DELTA_E_CONFONDU ? 'graphiqueConfondues' : 'graphiqueProches'),
          ' ', element('span', { class: 'discret' }, t('graphiqueEcart', { e: Math.round(p.ecarts[v]), min: DELTA_E_DISTINCT })))));
      const conseils = [];
      if (p.visions.includes('normale')) conseils.push(t('graphiqueConseilNormale'));
      if (p.visions.includes('gris')) conseils.push(t('graphiqueConseilClarte'));
      conseils.push(t('graphiqueConseilMotif'));
      return element('li', { class: `cg-paire ${p.niveau}` },
        element('div', { class: 'cg-tete' }, element('span', { class: 'cg-duo' }, pastille(p.a.rgb), pastille(p.b.rgb)),
          element('b', {}, `${versHex(p.a.rgb)} / ${versHex(p.b.rgb)}`), badge(p.niveau)),
        element('ul', { class: 'cg-visions' }, ...visions),
        element('p', { class: 'que-faire' }, element('b', {}, t('queFaire'))),
        element('ul', {}, ...conseils.map((c) => element('li', {}, c))));
    })));
  } else {
    blocs.push(element('p', {}, t('graphiquePairesOk')));
  }
  blocs.push(element('p', { class: 'discret' }, t('graphiqueNote', {
    min: WCAG_GRAPHIQUE, lc: LC_GRAPHIQUE, distinct: DELTA_E_DISTINCT, confondu: DELTA_E_CONFONDU,
  })));
  conteneur.replaceChildren(element('section', { class: 'cg' }, ...blocs));
}

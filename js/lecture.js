// Trouve les textes d'une figure, leur corps en pixels et leur contraste. Les textes d'un
// SVG ou d'un PDF se lisent tels quels. Ceux d'une image sont localisés par le détecteur de
// texte (detection.js), qui mesure leur corps et leur contraste, puis lus ligne à ligne par
// l'OCR (Tesseract.js) pour le libellé seulement. Si le détecteur ne se charge pas, ou avec
// ?moteur=tesseract, l'OCR lit toute l'image, une fois à l'endroit et une fois tournée d'un
// quart de tour, pour les axes verticaux.

import {
  corpsDepuisSymboles, hauteurGlyphe, contrasteZone, bruitFond, ligneCourteFiable, BRUIT_FOND_MAX,
  depuisRotation, recouvrement, unionBoites, mediane,
} from './analyse.js?v=91bcfa0342';
import { detecter, chargerScript, ErreurDetecteur } from './detection.js?v=91bcfa0342';

// Tesseract.js, son moteur et les données de langue sont servis depuis vendor/, à côté de
// la page : rien n'est demandé à un autre serveur. Les chemins sont absolus, parce que le
// travailleur les résout depuis sa propre adresse.
const VENDOR = new URL('../vendor/', import.meta.url);
const TESSERACT = new URL('tesseract/tesseract.min.js?v=91bcfa0342', VENDOR).href;
const OPTIONS_TESSERACT = {
  workerPath: new URL('tesseract/worker.min.js?v=91bcfa0342', VENDOR).href,
  workerBlobURL: false,
  corePath: new URL('tesseract-core/', VENDOR).href,
  langPath: new URL('tessdata/', VENDOR).href,
};
const LANGUES = 'fra+deu+eng';
const CONFIANCE_MIN = 55;
const CONFIANCE_MIN_TOURNEE = 70;        // à l'envers, l'OCR invente davantage
// Confiance moyenne exigée d'une ligne de trois caractères au plus (ligneCourteFiable).
// Les graduations des graphiques sont lues à 88 au moins, les faux textes des photos à 76
// et plus. Sur l'image tournée, qui ne porte guère que des titres d'axe de plusieurs mots,
// un faux texte court atteint 91 (« Il »).
const CONFIANCE_COURTE = 85;
const CONFIANCE_COURTE_TOURNEE = 95;
const PX_PAR_MM_OCR = 20;                // résolution de lecture, rapportée à la colonne de la Revue
const LARGEUR_COLONNE_MM = 172;
const PIXELS_MAX = 14e6;

let travailleur = null;
let modeCourant = null;
let suivre = () => {};

async function ocr() {
  if (!travailleur) {
    if (!window.Tesseract) await chargerScript(TESSERACT);
    travailleur = await window.Tesseract.createWorker(LANGUES, 1, { ...OPTIONS_TESSERACT, logger: (m) => suivre(m) });
  }
  return travailleur;
}

// Mode de segmentation de Tesseract : « texte épars » ('11') pour une image entière, où
// l'analyse de mise en page par défaut perd les graduations et les petites notes ; « une
// seule ligne » ('7') pour la découpe d'une ligne que le détecteur a déjà localisée.
async function mode(t, m) {
  if (modeCourant !== m) await t.setParameters({ tessedit_pageseg_mode: m });
  modeCourant = m;
}

// Libellé d'une ligne découpée : { texte, confiance }.
async function lireLigne(c) {
  const t = await ocr();
  await mode(t, '7');
  const { data } = await t.recognize(foncer(c));
  return { texte: (data.text || '').replace(/\s+/g, ' ').trim(), confiance: data.confidence };
}

// Largeur du canevas d'analyse : assez de pixels pour lire un texte de 6 pt, sans dépasser
// PIXELS_MAX.
export function largeurAnalyse(ratio) {
  const voulue = LARGEUR_COLONNE_MM * PX_PAR_MM_OCR;
  return Math.round(Math.min(voulue, Math.sqrt(PIXELS_MAX / ratio)));
}

// Copie en niveaux de gris, assombrie (gamma 3) : un texte gris clair sur blanc, que le
// seuillage de Tesseract confond avec le fond, devient lisible. Les mesures se font
// toujours sur l'image d'origine.
function foncer(c) {
  const f = document.createElement('canvas');
  f.width = c.width;
  f.height = c.height;
  const ctx = f.getContext('2d');
  const image = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
  const d = image.data;
  for (let p = 0; p < d.length; p += 4) {
    const v = 255 * ((0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255) ** 3;
    d[p] = d[p + 1] = d[p + 2] = v;
  }
  ctx.putImageData(image, 0, 0);
  return f;
}

function tourner(c) {
  const t = document.createElement('canvas');
  t.width = c.height;
  t.height = c.width;
  const ctx = t.getContext('2d');
  ctx.translate(c.height, 0);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(c, 0, 0);
  return t;
}

function pixels(c) {
  const rgba = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
  return {
    hauteur: (bbox) => hauteurGlyphe(rgba, c.width, c.height, bbox),
    bruit: (bbox) => bruitFond(rgba, c.width, c.height, bbox),
  };
}

// Garde les mots assez sûrs, qui portent une lettre ou un chiffre et dont le fond est uni
// (bruitFond), puis écarte les lignes trop courtes pour leur confiance (ligneCourteFiable).
function lignesOcr(data, { confiance, confianceCourte }, mesures) {
  const lignes = [];
  for (const ligne of data.lines || []) {
    const mots = ligne.words.filter((m) => m.confidence >= confiance && /[\p{L}\p{N}]/u.test(m.text)
      && !(mesures.bruit(m.bbox) > BRUIT_FOND_MAX));
    if (!mots.length || !ligneCourteFiable(mots, confianceCourte)) continue;
    const symboles = mots.flatMap((m) => m.symbols || []);
    lignes.push({
      texte: mots.map((m) => m.text).join(' '),
      mots: mots.map((m) => m.bbox),
      bbox: unionBoites(mots.map((m) => m.bbox)),
      corpsPx: corpsDepuisSymboles(symboles, mesures.hauteur),
      exact: false,
      vertical: false,
    });
  }
  return lignes;
}

async function lireOcr(c, progres) {
  const t = await ocr();
  await mode(t, '11');
  suivre = (m) => m.status === 'recognizing text' && progres('ocr', m.progress / 2);
  const fonce = foncer(c);
  const droit = lignesOcr((await t.recognize(fonce)).data,
    { confiance: CONFIANCE_MIN, confianceCourte: CONFIANCE_COURTE }, pixels(c));
  suivre = (m) => m.status === 'recognizing text' && progres('ocr', 0.5 + m.progress / 2);
  const ct = tourner(c);
  const tournees = lignesOcr((await t.recognize(tourner(fonce))).data,
    { confiance: CONFIANCE_MIN_TOURNEE, confianceCourte: CONFIANCE_COURTE_TOURNEE }, pixels(ct));
  suivre = () => {};
  for (const ligne of tournees) {
    ligne.mots = ligne.mots.map((b) => depuisRotation(b, c.height));
    ligne.bbox = depuisRotation(ligne.bbox, c.height);
    ligne.vertical = true;
    if (!droit.some((d) => recouvrement(d.bbox, ligne.bbox) > 0.3)) droit.push(ligne);
  }
  return droit;
}

// Moteur de localisation des textes d'une image : le détecteur par défaut, Tesseract seul
// avec ?moteur=tesseract.
function moteur() {
  return new URLSearchParams(location.search).get('moteur');
}

// `source` vient de sources.js. Rend { canevas, lignes }, les boîtes et les corps étant en
// pixels du canevas.
export async function lire(source, progres = () => {}) {
  const largeur = largeurAnalyse(source.ratio);
  progres('rendu', 0);
  const c = await source.dessiner(largeur);
  let lignes = [];
  if (source.textesExacts) {
    lignes = (await source.textesExacts(c.width)).map((t) => ({ ...t, mots: [t.bbox], exact: true, vertical: false }));
  }
  let lectureComplete = !lignes.length, repli = false;
  if (lectureComplete && source.type === 'bitmap' && moteur() !== 'tesseract') {
    try {
      lignes = await detecter(c, progres, async (decoupe) => {
        if (!travailleur) progres('chargement', 0);
        return lireLigne(decoupe);
      });
      lectureComplete = false;
    } catch (e) {
      if (!(e instanceof ErreurDetecteur)) throw e;
      repli = true;
    }
  }
  if (lectureComplete) {
    progres('chargement', 0);
    lignes = await lireOcr(c, progres);
  }
  const rgba = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  for (const ligne of lignes) {
    if (ligne.contraste !== undefined) continue;
    const mesures = ligne.mots.map((b) => contrasteZone(rgba, c.width, c.height, b)).filter(Boolean);
    if (!mesures.length) { ligne.contraste = null; continue; }
    const lcMedian = mediane(mesures.map((m) => Math.abs(m.lc)));
    ligne.contraste = mesures.reduce((a, b) => (Math.abs(Math.abs(b.lc) - lcMedian) < Math.abs(Math.abs(a.lc) - lcMedian) ? b : a));
  }
  lignes.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  progres('fini', 1);
  return { canevas: c, lignes, repli };
}

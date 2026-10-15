// Trouve les textes d'une figure, leur corps en pixels et leur contraste. Les textes d'un
// SVG ou d'un PDF se lisent tels quels. Ceux d'une image sont localisés par le détecteur de
// texte (detection.js), qui mesure leur corps et leur contraste, puis lus ligne à ligne par
// l'OCR (Tesseract.js) pour le libellé seulement. Si le détecteur ne se charge pas, ou avec
// ?moteur=tesseract, l'OCR lit toute l'image, une fois à l'endroit et une fois tournée d'un
// quart de tour, pour les axes verticaux.
// Chaque texte reçoit un statut (residu.js) ; les zones d'encre que la lecture n'a pas
// trouvées s'ajoutent en suggestions à vérifier.

import {
  corpsDepuisSymboles, hauteurGlyphe, contrasteZone, bruitFond, BRUIT_FOND_MAX,
  depuisRotation, recouvrement, unionBoites, mediane,
} from './analyse.js?v=8d304de540';
import { versPoints } from './formats.js?v=8d304de540';
import { detecter, chargerScript, ErreurDetecteur } from './detection.js?v=8d304de540';
import { statutInitial, visible, zonesEncre, mesurerZone } from './residu.js?v=8d304de540';

// Tesseract.js, son moteur et les données de langue sont servis depuis vendor/, à côté de
// la page : rien n'est demandé à un autre serveur. Les chemins sont absolus, parce que le
// travailleur les résout depuis sa propre adresse.
const VENDOR = new URL('../vendor/', import.meta.url);
const TESSERACT = new URL('tesseract/tesseract.min.js?v=8d304de540', VENDOR).href;
const OPTIONS_TESSERACT = {
  workerPath: new URL('tesseract/worker.min.js?v=8d304de540', VENDOR).href,
  workerBlobURL: false,
  corePath: new URL('tesseract-core/', VENDOR).href,
  langPath: new URL('tessdata/', VENDOR).href,
};
const LANGUES = 'fra+deu+eng';
// En dessous, un mot n'est même pas montré : la lecture n'a plus de sens.
const CONFIANCE_MIN = 55;
const CONFIANCE_MIN_TOURNEE = 70;        // à l'envers, l'OCR invente davantage
const PX_PAR_MM_OCR = 20;                // résolution de lecture, rapportée à la colonne de la Revue
const LARGEUR_COLONNE_MM = 172;
const PIXELS_MAX = 14e6;
// Les zones d'encre se cherchent sur une copie réduite : assez pour voir un signe de 4 pt.
const LARGEUR_SUGGESTIONS = 1200;
const SIGNE_MIN_MM = 0.6;                // hauteur d'x d'un texte d'environ 4 pt
const SIGNE_MAX_MM = 8;                  // capitale d'un texte d'environ 30 pt
// Une suggestion dont le fond est deux fois plus bruité que ce qu'un texte admet est une
// tache de photo : elle n'est pas demandée.
const BRUIT_SUGGESTION = 2 * BRUIT_FOND_MAX;
// Découpage envoyé à l'OCR pour lire une zone : agrandi jusqu'à cette hauteur d'encre.
const HAUTEUR_LECTURE_ZONE = 48;

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

function donnees(c) {
  return c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
}

function pixels(c) {
  const rgba = donnees(c);
  return {
    hauteur: (bbox) => hauteurGlyphe(rgba, c.width, c.height, bbox),
    bruit: (bbox) => bruitFond(rgba, c.width, c.height, bbox),
  };
}

// Garde les mots assez sûrs qui portent une lettre ou un chiffre. Le bruit du fond et la
// confiance ne décident plus de rien ici : ils sont gardés avec la ligne et font son statut.
function lignesOcr(data, confiance, mesures) {
  const lignes = [];
  for (const ligne of data.lines || []) {
    const mots = ligne.words.filter((m) => m.confidence >= confiance && /[\p{L}\p{N}]/u.test(m.text));
    if (!mots.length) continue;
    const symboles = mots.flatMap((m) => m.symbols || []);
    const bruits = mots.map((m) => mesures.bruit(m.bbox)).filter((b) => b != null);
    lignes.push({
      texte: mots.map((m) => m.text).join(' '),
      mots: mots.map((m) => m.bbox),
      bbox: unionBoites(mots.map((m) => m.bbox)),
      corpsPx: corpsDepuisSymboles(symboles, mesures.hauteur),
      confiance: mots.reduce((s, m) => s + m.confidence, 0) / mots.length,
      bruit: bruits.length ? Math.max(...bruits) : null,
      exact: false,
      vertical: false,
      origine: 'ocr',
    });
  }
  return lignes;
}

async function lireOcr(c, progres) {
  const t = await ocr();
  await mode(t, '11');
  suivre = (m) => m.status === 'recognizing text' && progres('ocr', m.progress / 2);
  const fonce = foncer(c);
  const droit = lignesOcr((await t.recognize(fonce)).data, CONFIANCE_MIN, pixels(c));
  suivre = (m) => m.status === 'recognizing text' && progres('ocr', 0.5 + m.progress / 2);
  const ct = tourner(c);
  const tournees = lignesOcr((await t.recognize(tourner(fonce))).data, CONFIANCE_MIN_TOURNEE, pixels(ct));
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

// Contraste d'une ligne : celui de ses mots le plus proche de la médiane.
function mesurerContraste(ligne, rgba, largeur, hauteur) {
  const mesures = ligne.mots.map((b) => contrasteZone(rgba, largeur, hauteur, b)).filter(Boolean);
  if (!mesures.length) return null;
  const lcMedian = mediane(mesures.map((m) => Math.abs(m.lc)));
  return mesures.reduce((a, b) => (Math.abs(Math.abs(b.lc) - lcMedian) < Math.abs(Math.abs(a.lc) - lcMedian) ? b : a));
}

// Zones d'encre que les textes connus laissent à découvert, mesurées sans être lues
// (residu.js). La copie réduite se dessine depuis la source, jamais plus large que ses
// pixels : agrandie, une photo serait lissée et passerait pour un aplat. `largeurMm` :
// largeur imprimée, qui fixe la taille plausible d'un signe.
export async function suggerer(source, canevas, lignes, largeurMm) {
  const petit = await source.dessiner(Math.min(LARGEUR_SUGGESTIONS, canevas.width, source.pixels ? source.pixels.l : Infinity));
  const k = petit.width / canevas.width;
  const pxParMm = petit.width / largeurMm;
  const boites = lignes.filter((l) => visible(l.statut)).flatMap((l) => l.mots || [l.bbox])
    .map((b) => ({ x0: b.x0 * k, y0: b.y0 * k, x1: b.x1 * k, y1: b.y1 * k }));
  const rgbaPetit = donnees(petit);
  const zones = zonesEncre(rgbaPetit, petit.width, petit.height, { boites, hMin: SIGNE_MIN_MM * pxParMm, hMax: SIGNE_MAX_MM * pxParMm });
  const rgba = donnees(canevas);
  const suggestions = [];
  for (const z of zones) {
    // Le bruit du fond se juge sur la copie à résolution native : sur le canevas d'analyse,
    // agrandi, le lissage l'efface et une tache de photo passe pour un texte sur un aplat.
    const bruit = bruitFond(rgbaPetit, petit.width, petit.height, z);
    if (bruit != null && bruit > BRUIT_SUGGESTION) continue;
    const marge = (z.y1 - z.y0) * 0.15 / k;
    const bbox = {
      x0: Math.max(0, z.x0 / k - marge), y0: Math.max(0, z.y0 / k - marge),
      x1: Math.min(canevas.width, z.x1 / k + marge), y1: Math.min(canevas.height, z.y1 / k + marge),
    };
    const ligne = mesurerAjout(canevas, bbox, rgba);
    if (!ligne) continue;
    suggestions.push({ ...ligne, bruit, origine: 'suggestion', statut: 'a-verifier' });
  }
  return suggestions;
}

// Mesure une zone posée sur le canevas sans la lire : corps par le profil d'encre,
// contraste et bruit sur les pixels. Rend une ligne sans statut ni id, ou null si la zone
// ne porte pas d'encre.
export function mesurerAjout(canevas, bbox, rgba = donnees(canevas)) {
  const mesure = mesurerZone(rgba, canevas.width, canevas.height, bbox);
  if (!mesure) return null;
  return {
    texte: '',
    mots: [bbox],
    bbox,
    corpsPx: mesure.corpsPx,
    hauteurX: mesure.hauteurX,
    hauteurCapitale: mesure.hauteurCapitale,
    contraste: contrasteZone(rgba, canevas.width, canevas.height, bbox),
    bruit: bruitFond(rgba, canevas.width, canevas.height, bbox),
    confiance: null,
    exact: false,
    vertical: mesure.vertical,
  };
}

// Tente de lire une zone pour lui donner un libellé : le découpage, agrandi, passe une fois
// à l'OCR. Rend le texte lu, ou null. La mesure ne dépend pas de ce résultat.
export async function lireZone(canevas, bbox, vertical = false) {
  const t = await ocr();
  const marge = Math.max(4, (bbox.y1 - bbox.y0) * 0.3);
  const sx = Math.max(0, bbox.x0 - marge), sy = Math.max(0, bbox.y0 - marge);
  const sl = Math.min(canevas.width, bbox.x1 + marge) - sx, sh = Math.min(canevas.height, bbox.y1 + marge) - sy;
  if (sl < 2 || sh < 2) return null;
  const e = Math.max(1, HAUTEUR_LECTURE_ZONE / (vertical ? sl : sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sl * e);
  c.height = Math.round(sh * e);
  c.getContext('2d').drawImage(canevas, sx, sy, sl, sh, 0, 0, c.width, c.height);
  const image = foncer(vertical ? tourner(c) : c);
  const data = (await t.recognize(image)).data;
  const mots = (data.words || []).filter((m) => m.confidence >= CONFIANCE_MIN && /[\p{L}\p{N}]/u.test(m.text));
  return mots.length ? mots.map((m) => m.text).join(' ') : null;
}

// `source` vient de sources.js. Rend { canevas, lignes }, les boîtes et les corps étant en
// pixels du canevas ; chaque ligne porte un id, un statut et une origine.
export async function lire(source, largeurMm, progres = () => {}) {
  const largeur = largeurAnalyse(source.ratio);
  progres('rendu', 0);
  const c = await source.dessiner(largeur);
  let lignes = [];
  if (source.textesExacts) {
    lignes = (await source.textesExacts(c.width)).map((t) => ({ ...t, mots: [t.bbox], exact: true, vertical: false, origine: 'fichier' }));
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
  const rgba = donnees(c);
  for (const ligne of lignes) {
    if (ligne.contraste === undefined) ligne.contraste = mesurerContraste(ligne, rgba, c.width, c.height);
    ligne.corpsPt = ligne.corpsPx ? versPoints(ligne.corpsPx, c.width, largeurMm) : null;
    ligne.statut = statutInitial(ligne);
  }
  progres('suggestions', 0);
  await new Promise((ok) => setTimeout(ok));   // laisse la page afficher l'étape
  lignes.push(...(await suggerer(source, c, lignes, largeurMm)));
  lignes.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  lignes.forEach((l, i) => { l.id = `t${i + 1}`; });
  progres('fini', 1);
  return { canevas: c, lignes, repli };
}

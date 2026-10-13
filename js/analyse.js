// Calculs sans DOM : taille d'un texte reconnu, contraste d'une zone de pixels, passage
// des coordonnées de l'image tournée à l'image d'origine, verdicts.

import { lc } from './apca.js';
import { TAILLE_MIN_PT, LC_MIN } from './formats.js';

// Rapport hauteur du glyphe / corps, moyen sur les sans-serif courantes (Arial, Open Sans,
// Calibri, Helvetica). Les minuscules sans hampe donnent la hauteur d'x, les capitales et
// les chiffres la hauteur de capitale.
const SANS_HAMPE = new Set('acemnorsuvwxz');
const CAPITALE = /^[A-HK-PR-Z0-9]$/;
const RATIO_X = 0.52;
const RATIO_CAPITALE = 0.71;

const TOLERANCE_LC = 0.5;                // comme apca.TOLERANCE_SEUIL de Pronto

export function mediane(valeurs) {
  if (!valeurs.length) return null;
  const v = [...valeurs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Corps estimé, en pixels de l'image, d'après les boîtes de glyphes d'un mot ou d'une ligne.
// `mesurer(bbox)` peut remplacer la hauteur de la boîte par une mesure sur les pixels.
export function corpsDepuisSymboles(symboles, mesurer = null) {
  const estimations = [];
  for (const s of symboles) {
    if (s.text.length !== 1 || !(SANS_HAMPE.has(s.text) || CAPITALE.test(s.text))) continue;
    const h = (mesurer && mesurer(s.bbox)) || s.bbox.y1 - s.bbox.y0;
    if (h <= 0) continue;
    if (SANS_HAMPE.has(s.text)) estimations.push(h / RATIO_X);
    else if (CAPITALE.test(s.text)) estimations.push(h / RATIO_CAPITALE);
  }
  return mediane(estimations);
}

function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Hauteur d'encre d'un glyphe, au dixième de pixel. La boîte de l'OCR déborde du lissage
// des bords, ce qui grossit surtout les petits textes. Chaque rangée compte pour la
// couverture de son pixel le plus encré (0 au fond, 1 à l'encre pleine) : un bord à demi
// couvert compte pour un demi-pixel.
export function hauteurGlyphe(rgba, largeur, hauteur, bbox, marge = 3) {
  const x0 = Math.max(0, Math.floor(bbox.x0)), x1 = Math.min(largeur, Math.ceil(bbox.x1));
  const y0 = Math.max(0, Math.floor(bbox.y0) - marge), y1 = Math.min(hauteur, Math.ceil(bbox.y1) + marge);
  if (x1 - x0 < 1 || y1 - y0 < 3) return null;
  const l = (x, y) => { const p = (y * largeur + x) * 4; return luma(rgba[p], rgba[p + 1], rgba[p + 2]); };
  const bord = [];
  for (let x = x0; x < x1; x++) bord.push(l(x, y0), l(x, y1 - 1));
  const fond = mediane(bord);
  let amplitude = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) amplitude = Math.max(amplitude, Math.abs(l(x, y) - fond));
  if (amplitude < 12) return null;
  let h = 0;
  for (let y = y0; y < y1; y++) {
    let couverture = 0;
    for (let x = x0; x < x1; x++) couverture = Math.max(couverture, Math.abs(l(x, y) - fond) / amplitude);
    if (couverture >= 0.1) h += couverture;
  }
  return h;
}

// Seuil d'Otsu sur un histogramme de 256 classes.
export function seuilOtsu(histogramme, total) {
  let somme = 0;
  for (let i = 0; i < 256; i++) somme += i * histogramme[i];
  let sommeFond = 0, poidsFond = 0, meilleur = 0, seuil = 127;
  for (let t = 0; t < 256; t++) {
    poidsFond += histogramme[t];
    if (!poidsFond) continue;
    const poidsAvant = total - poidsFond;
    if (!poidsAvant) break;
    sommeFond += t * histogramme[t];
    const mFond = sommeFond / poidsFond;
    const mAvant = (somme - sommeFond) / poidsAvant;
    const variance = poidsFond * poidsAvant * (mFond - mAvant) ** 2;
    if (variance > meilleur) { meilleur = variance; seuil = t; }
  }
  return seuil;
}

// Couleur du texte et du fond dans une boîte, et leur contraste APCA. Les pixels se
// partagent en deux groupes par Otsu ; le plus nombreux est le fond. Le lissage des bords
// tire le texte vers le fond : on ne garde que les 20 % de pixels du texte les plus
// éloignés du fond.
export function contrasteZone(rgba, largeur, hauteur, bbox, marge = 2) {
  const x0 = Math.max(0, Math.floor(bbox.x0) - marge), x1 = Math.min(largeur, Math.ceil(bbox.x1) + marge);
  const y0 = Math.max(0, Math.floor(bbox.y0) - marge), y1 = Math.min(hauteur, Math.ceil(bbox.y1) + marge);
  const n = (x1 - x0) * (y1 - y0);
  if (n < 16) return null;
  const lumas = new Float32Array(n), positions = new Uint32Array(n);
  const histogramme = new Uint32Array(256);
  let k = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const p = (y * largeur + x) * 4;
      const v = luma(rgba[p], rgba[p + 1], rgba[p + 2]);
      lumas[k] = v; positions[k] = p; k++;
      histogramme[Math.min(255, Math.round(v))]++;
    }
  }
  const seuil = seuilOtsu(histogramme, n);
  const sombres = [], clairs = [];
  for (let i = 0; i < n; i++) (Math.min(255, Math.round(lumas[i])) <= seuil ? sombres : clairs).push(i);
  if (Math.min(sombres.length, clairs.length) < 4) return null;
  const [fond, texte] = sombres.length >= clairs.length ? [sombres, clairs] : [clairs, sombres];

  const canal = (indices, c) => mediane(indices.map((i) => rgba[positions[i] + c]));
  const couleurFond = [0, 1, 2].map((c) => canal(fond, c));
  const lumaFond = luma(...couleurFond);
  const tries = [...texte].sort((a, b) => Math.abs(lumas[b] - lumaFond) - Math.abs(lumas[a] - lumaFond));
  const retenus = tries.slice(0, Math.max(1, Math.ceil(tries.length * 0.2)));
  const couleurTexte = [0, 1, 2].map((c) => retenus.reduce((s, i) => s + rgba[positions[i] + c], 0) / retenus.length);
  return { texte: couleurTexte, fond: couleurFond, lc: lc(couleurTexte, couleurFond) };
}

// L'image tournée d'un quart de tour horaire, de hauteur d'origine `hauteur`, ramène son
// point (x', y') au point (y', hauteur − x') de l'image d'origine.
export function depuisRotation(bbox, hauteur) {
  return { x0: bbox.y0, x1: bbox.y1, y0: hauteur - bbox.x1, y1: hauteur - bbox.x0 };
}

// Part de la plus petite boîte couverte par l'autre.
export function recouvrement(a, b) {
  const l = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  if (l <= 0 || h <= 0) return 0;
  const aire = (r) => (r.x1 - r.x0) * (r.y1 - r.y0);
  return (l * h) / Math.min(aire(a), aire(b));
}

export function unionBoites(boites) {
  return {
    x0: Math.min(...boites.map((b) => b.x0)), y0: Math.min(...boites.map((b) => b.y0)),
    x1: Math.max(...boites.map((b) => b.x1)), y1: Math.max(...boites.map((b) => b.y1)),
  };
}

export function verdictTaille(pt) {
  if (pt == null) return 'inconnu';
  return pt < TAILLE_MIN_PT ? 'echec' : 'ok';
}

export function verdictContraste(valeur) {
  if (valeur == null) return 'inconnu';
  return Math.abs(valeur) < LC_MIN - TOLERANCE_LC ? 'echec' : 'ok';
}

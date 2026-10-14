// Calculs sans DOM : taille d'un texte reconnu, contraste d'une zone de pixels, passage
// des coordonnées de l'image tournée à l'image d'origine, degré de non-conformité, couleur conforme.

import { lc, luminanceApca } from './apca.js?v=488abbcb2e';
import { TAILLE_MIN_PT, TAILLE_GRAVE_PT, LC_MIN, ECART_GRAVE_LC } from './formats.js?v=488abbcb2e';

// Rapport hauteur du glyphe / corps, moyen sur les sans-serif courantes (Arial, Open Sans,
// Calibri, Helvetica). Les minuscules sans hampe donnent la hauteur d'x, les capitales et
// les chiffres la hauteur de capitale.
const SANS_HAMPE = new Set('acemnorsuvwxz');
const CAPITALE = /^[A-HK-PR-Z0-9]$/;
export const RATIO_X = 0.52;
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

// Degré de non-conformité, en trois niveaux lisibles sans connaître les normes :
// « ok » atteint le minimum, « ameliorer » le manque de peu, « corriger » le manque nettement.
export const NIVEAUX = ['ok', 'ameliorer', 'corriger'];

export function niveauTaille(pt) {
  if (pt == null) return null;
  if (pt >= TAILLE_MIN_PT) return 'ok';
  return pt >= TAILLE_GRAVE_PT ? 'ameliorer' : 'corriger';
}

export function niveauContraste(valeur, seuil = LC_MIN) {
  if (valeur == null) return null;
  const v = Math.abs(valeur) + TOLERANCE_LC;
  if (v >= seuil) return 'ok';
  return v >= seuil - ECART_GRAVE_LC ? 'ameliorer' : 'corriger';
}

export function pireNiveau(...niveaux) {
  const connus = niveaux.filter(Boolean);
  if (!connus.length) return null;
  return connus.reduce((a, b) => (NIVEAUX.indexOf(b) > NIVEAUX.indexOf(a) ? b : a));
}

// Agrandissement qui amène un texte au minimum, en pour cent arrondis aux 5 supérieurs.
export function agrandissement(pt) {
  return Math.ceil((TAILLE_MIN_PT / pt - 1) * 20) * 5;
}

function melange(a, b, t) {
  return a.map((c, i) => Math.round(c + (b[i] - c) * t));
}

// Couleur de texte la plus proche de l'actuelle qui atteint `cible` sur ce fond : le texte
// est assombri sur un fond clair, éclairci sur un fond sombre, puis dans l'autre sens si le
// premier n'y arrive pas. La cible dépasse le minimum de 10 pour laisser de la marge à
// l'impression. Rend { couleur, sens } ou null si aucune teinte ne suffit.
export function couleurConforme(texte, fond, cible = LC_MIN + 10) {
  const fondClair = luminanceApca(fond) > luminanceApca(texte);
  const sens = fondClair ? ['foncer', 'eclaircir'] : ['eclaircir', 'foncer'];
  for (const s of sens) {
    const extreme = s === 'foncer' ? [0, 0, 0] : [255, 255, 255];
    for (let t = 0.02; t <= 1.0001; t += 0.02) {
      const c = melange(texte, extreme, t);
      if (Math.abs(lc(c, fond)) + TOLERANCE_LC >= cible) return { couleur: c, sens: s };
    }
  }
  return null;
}

const RANG = { ok: 0, ameliorer: 1, corriger: 2 };

function couleursVoisines(a, b, ecart) {
  return a.every((c, i) => Math.abs(c - b[i]) <= ecart);
}

// Regroupe les textes à revoir pour ne pas répéter la même carte.
// Strict : même défaut, au même degré, tailles à 0,5 pt près, contrastes à Lc 5 près,
// couleurs de texte voisines (les graduations d'un axe, par exemple).
// Souple, pour une figure qui a beaucoup de défauts : même style de texte, c'est-à-dire
// mêmes couleurs de texte et de fond et tailles à 20 % près, quel que soit le degré ;
// l'auteur corrige un style, pas chaque texte.
// Le représentant d'un groupe est son membre le plus grave, puis le plus petit.
export function regrouper(lignes, { souple = false } = {}) {
  const groupes = [];
  const proche = (a, b) => {
    if (souple) {
      const tailles = a.pt == null || b.pt == null ? a.pt == null && b.pt == null
        : Math.max(a.pt, b.pt) / Math.min(a.pt, b.pt) <= 1.2;
      const couleurs = !a.contraste || !b.contraste ? !a.contraste && !b.contraste
        : couleursVoisines(a.contraste.texte, b.contraste.texte, 40) && couleursVoisines(a.contraste.fond, b.contraste.fond, 40);
      return tailles && couleurs;
    }
    return a.nt === b.nt && a.nc === b.nc
      && ((a.pt == null && b.pt == null) || (a.pt != null && b.pt != null && Math.abs(a.pt - b.pt) <= 0.5))
      && ((a.lc == null && b.lc == null) || (a.lc != null && b.lc != null && Math.abs(Math.abs(a.lc) - Math.abs(b.lc)) <= 5))
      && (!a.contraste || !b.contraste || couleursVoisines(a.contraste.texte, b.contraste.texte, 30));
  };
  for (const l of lignes) {
    const g = groupes.find((x) => proche(x.membres[0], l));
    if (g) g.membres.push(l);
    else groupes.push({ membres: [l] });
  }
  for (const g of groupes) {
    g.representant = g.membres.reduce((a, b) => {
      const d = (RANG[b.niveau] ?? -1) - (RANG[a.niveau] ?? -1);
      if (d) return d > 0 ? b : a;
      return (b.pt ?? Infinity) < (a.pt ?? Infinity) ? b : a;
    });
    g.niveau = g.representant.niveau;
  }
  // Les plus graves d'abord, puis les plus nombreux.
  return groupes.sort((a, b) => (RANG[b.niveau] ?? -1) - (RANG[a.niveau] ?? -1) || b.membres.length - a.membres.length);
}

export function quantile(valeurs, q) {
  if (!valeurs.length) return null;
  const v = [...valeurs].sort((a, b) => a - b);
  const p = (v.length - 1) * q;
  const b = Math.floor(p);
  return b + 1 < v.length ? v[b] + (v[b + 1] - v[b]) * (p - b) : v[b];
}

// Diagnostic d'ensemble : quand la moitié au moins des textes mesurés (et au moins 5) sont
// sous le minimum, c'est la figure qui est trop petite pour la page, pas quelques textes.
// Rend null sinon.
export function diagnosticEnsemble(lignes) {
  const tailles = lignes.map((l) => l.pt).filter((v) => v != null);
  const petits = tailles.filter((v) => v < TAILLE_MIN_PT);
  if (petits.length < 5 || petits.length < tailles.length / 2) return null;
  const mediane = quantile(tailles, 0.5);
  return {
    total: tailles.length,
    petits: petits.length,
    bas: quantile(tailles, 0.25),
    haut: quantile(tailles, 0.75),
    mediane,
    facteur: TAILLE_MIN_PT / mediane,
  };
}

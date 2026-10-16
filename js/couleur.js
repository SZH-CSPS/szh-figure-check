// Couleur des éléments graphiques : espaces CIELAB et CIEDE2000, daltonismes simulés,
// contraste d'une couleur avec le fond et écart entre deux couleurs selon la vision. Aucune
// fonction n'a besoin du DOM ; objets.js s'en sert pour les séries d'un graphique.

import { lc, luminanceApca, rapportWcag } from './apca.js?v=4ca0c853e6';

// ── Seuils ──────────────────────────────────────────────────────────────────────

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

export function versLineaire(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function depuisLineaire(v) {
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

// Distance euclidienne dans CIELAB (CIE76).
export function distanceLab(a, b) {
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
export const pire = (...n) => n.reduce((a, b) => (RANG[b] > RANG[a] ? b : a), 'ok');

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

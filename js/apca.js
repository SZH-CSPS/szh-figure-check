// Contraste APCA-W3 0.1.9, mêmes constantes que pipeline/apca.py de Pronto, et rapport
// WCAG 2 pour mémoire. Les couleurs sont des triplets [r, g, b] de 0 à 255.
// lc() rend les mêmes valeurs que APCAcontrast(sRGBtoY(texte), sRGBtoY(fond)) du paquet
// officiel apca-w3 0.1.9 (test/apca-reference.test.mjs).

const EXP_CANAL = 2.4;
const COEFF = [0.2126729, 0.7151522, 0.0721750];
const SEUIL_NOIR = 0.022, EXP_NOIR = 1.414;
const N_FOND = 0.56, N_TEXTE = 0.57, N_ECHELLE = 1.14, N_CLIP = 0.1, N_OFFSET = 0.027;
const I_FOND = 0.65, I_TEXTE = 0.62, I_ECHELLE = 1.14, I_CLIP = -0.1, I_OFFSET = 0.027;
const DELTA_Y_MIN = 0.0005;

export function luminanceApca(rgb) {
  let y = 0;
  for (let i = 0; i < 3; i++) y += COEFF[i] * (rgb[i] / 255) ** EXP_CANAL;
  if (y < SEUIL_NOIR) y += (SEUIL_NOIR - y) ** EXP_NOIR;
  return y;
}

// Lc signé : positif pour un texte sombre sur fond clair, négatif à l'inverse.
export function lc(texte, fond) {
  const yt = luminanceApca(texte), yf = luminanceApca(fond);
  if (Math.abs(yf - yt) < DELTA_Y_MIN) return 0;
  if (yf > yt) {
    const s = (yf ** N_FOND - yt ** N_TEXTE) * N_ECHELLE;
    return s < N_CLIP ? 0 : (s - N_OFFSET) * 100;
  }
  const s = (yf ** I_FOND - yt ** I_TEXTE) * I_ECHELLE;
  return s > I_CLIP ? 0 : (s + I_OFFSET) * 100;
}

function lineaire(c) {
  c /= 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function rapportWcag(a, b) {
  const l = (rgb) => 0.2126 * lineaire(rgb[0]) + 0.7152 * lineaire(rgb[1]) + 0.0722 * lineaire(rgb[2]);
  const [h, s] = [l(a), l(b)].sort((x, y) => y - x);
  return (h + 0.05) / (s + 0.05);
}

export function versHex(rgb) {
  return '#' + rgb.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('').toUpperCase();
}

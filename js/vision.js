// Basse vision : approximations à but de sensibilisation, sur la figure à sa taille
// imprimée, lue à LECTURE_MM.
//
// - Acuité réduite : flou gaussien dont l'écart type vaut l'angle minimal de résolution
//   (1 / acuité, en minutes d'arc) à cette distance.
// - Sensibilité au contraste réduite et cataracte : méthode de Peli (contraste local par
//   bandes de fréquence, JOSA A 1990 et 1996). L'image est découpée en bandes d'une octave ;
//   dans chaque bande, le contraste local qui passe sous le seuil d'une courbe de
//   sensibilité au contraste (CSF) est supprimé, le reste est gardé tel quel.
// - Lecture : seuil de lecture d'une acuité donnée, hauteur d'x de 5 fois l'angle minimal
//   de résolution (unité M), et lecture confortable avec une réserve d'acuité de 2.

export const LECTURE_MM = 400;
export const MM_PAR_MINUTE = LECTURE_MM * Math.tan(Math.PI / 10800);
export const MM_PAR_DEGRE = LECTURE_MM * Math.tan(Math.PI / 180);
const MM_PAR_PT = 25.4 / 72;
const RATIO_X = 0.52;                    // hauteur d'x / corps, comme analyse.js
export const RESERVE_ACUITE = 2;

export function flouMm(acuite) {
  return MM_PAR_MINUTE / acuite;
}

// Écart type du flou en pixels d'une image large de largeurPx, imprimée sur largeurMm.
export function flouPx(acuite, largeurPx, largeurMm) {
  return flouMm(acuite) * largeurPx / largeurMm;
}

export function filtreFlou(acuite, largeurPx, largeurMm) {
  return `blur(${flouPx(acuite, largeurPx, largeurMm).toFixed(2)}px)`;
}

// Corps (pt) au seuil de lecture et pour une lecture confortable, pour une acuité donnée.
export function lectureAcuite(acuite) {
  const seuilXmm = 5 * MM_PAR_MINUTE / acuite;
  const seuil = seuilXmm / RATIO_X / MM_PAR_PT;
  return { seuil, confort: seuil * RESERVE_ACUITE };
}

// CSF en log-parabole : sensibilité maximale smax à la fréquence fmax (cycles par degré),
// moitié de smax à largeur / 2 octaves de part et d'autre ; plafonnée à smax en dessous de
// fmax (les basses fréquences ne comptent pas pour lire).
export function csf({ smax, fmax, largeur }) {
  return (f) => {
    if (f <= fmax) return smax;
    const octaves = Math.log2(f / fmax);
    return smax * 2 ** -((octaves / (largeur / 2)) ** 2);
  };
}

// Profils approchés. Vue normale : environ 200 au maximum (1,9 à 2 en log, Pelli-Robson
// normal). Contraste réduit : environ 1,3 en log, acuité encore proche de la normale.
// Cataracte : environ 1,5 en log, maximum décalé vers les basses fréquences (acuité ≈ 5/10).
export const PROFILS = {
  contraste: { smax: 20, fmax: 3, largeur: 3 },
  cataracte: { smax: 30, fmax: 1.6, largeur: 3 },
};

// Flou gaussien approché par trois flous en boîte (Kutskir), sur un canal en Float32.
function boites(sigma, n = 3) {
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let bas = Math.floor(ideal);
  if (bas % 2 === 0) bas--;
  const haut = bas + 2;
  const m = Math.round((12 * sigma * sigma - n * bas * bas - 4 * n * bas - 3 * n) / (-4 * bas - 4));
  return Array.from({ length: n }, (_, i) => (i < m ? bas : haut));
}

function boiteH(src, dst, l, h, r) {
  const k = 1 / (r + r + 1);
  for (let y = 0; y < h; y++) {
    const o = y * l;
    const premier = src[o];
    let somme = (r + 1) * premier;
    for (let j = 0; j < r; j++) somme += src[o + Math.min(j, l - 1)];
    for (let x = 0; x < l; x++) {
      somme += src[o + Math.min(x + r, l - 1)] - (x - r - 1 >= 0 ? src[o + x - r - 1] : premier);
      dst[o + x] = somme * k;
    }
  }
}

function boiteV(src, dst, l, h, r) {
  const k = 1 / (r + r + 1);
  for (let x = 0; x < l; x++) {
    const premier = src[x];
    let somme = (r + 1) * premier;
    for (let j = 0; j < r; j++) somme += src[Math.min(j, h - 1) * l + x];
    for (let y = 0; y < h; y++) {
      somme += src[Math.min(y + r, h - 1) * l + x] - (y - r - 1 >= 0 ? src[(y - r - 1) * l + x] : premier);
      dst[y * l + x] = somme * k;
    }
  }
}

export function flouGaussien(canal, l, h, sigma) {
  if (sigma < 0.3) return Float32Array.from(canal);
  let a = Float32Array.from(canal), b = new Float32Array(canal.length);
  for (const taille of boites(sigma)) {
    const r = (taille - 1) / 2;
    boiteH(a, b, l, h, r);
    boiteV(b, a, l, h, r);
  }
  return a;
}

// Les variations plus lentes que FREQUENCE_MIN (cycles par degré) ne comptent pas pour
// lire ; les garder telles quelles évite des marbrures sur les grands aplats.
export const FREQUENCE_MIN = 0.5;

// Contraste local par bandes (Peli) d'un canal en lumière linéaire (0 à 1). Les bandes sont
// des différences de flous gaussiens d'écart type σ et 2σ ; leur fréquence centrale vaut
// 0,153 / σ cycles par pixel.
export function seuillerContraste(canal, l, h, pxParDegre, sensibilite) {
  const sigmaMax = Math.max(l, h) / 4;
  let fin = Float32Array.from(canal);
  let sigma = 0.5;
  const garde = new Float32Array(canal.length);
  while (sigma <= sigmaMax) {
    const frequence = (0.153 / sigma) * pxParDegre;
    if (frequence < FREQUENCE_MIN) break;
    const grossier = flouGaussien(canal, l, h, sigma * 2);
    const seuil = 1 / sensibilite(frequence);
    // Le seuil s'applique à l'enveloppe du contraste (son amplitude locale), pas pixel par
    // pixel : un bord gardé garde aussi ses abords, sinon des halos clairs apparaissent.
    const bande = new Float32Array(canal.length);
    const amplitude = new Float32Array(canal.length);
    for (let i = 0; i < canal.length; i++) {
      bande[i] = fin[i] - grossier[i];
      amplitude[i] = Math.abs(bande[i]) / Math.max(grossier[i], 1e-3);
    }
    const enveloppe = flouGaussien(amplitude, l, h, sigma * 2);
    for (let i = 0; i < canal.length; i++) if (2 * enveloppe[i] >= seuil) garde[i] += bande[i];
    fin = grossier;
    sigma *= 2;
  }
  for (let i = 0; i < canal.length; i++) garde[i] += fin[i];
  return garde;
}

const versLineaire = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const versSrgb = (c) => {
  const v = Math.min(1, Math.max(0, c));
  return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
};

// Applique un profil à une image RGBA. Le seuillage porte sur la luminance ; l'écart
// obtenu est ajouté aux trois canaux, ce qui garde les teintes sans créer de franges de
// couleur. Pour la cataracte, le cristallin jauni absorbe une partie du bleu et un voile de
// lumière diffusée éclaircit l'ensemble.
export function simulerPerteContraste(rgba, l, h, pxParDegre, profil, { jaunissement = 0, voile = 0 } = {}) {
  const n = l * h;
  const attenuation = [1, 1 - jaunissement * 0.25, 1 - jaunissement];
  const lin = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) lin[c][i] = versLineaire(rgba[i * 4 + c]) * attenuation[c];
    lum[i] = 0.2126 * lin[0][i] + 0.7152 * lin[1][i] + 0.0722 * lin[2][i];
  }
  const traitee = seuillerContraste(lum, l, h, pxParDegre, csf(profil));
  const sortie = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < n; i++) {
    const ecart = traitee[i] - lum[i];
    for (let c = 0; c < 3; c++) sortie[i * 4 + c] = versSrgb((lin[c][i] + ecart) * (1 - voile) + voile);
    sortie[i * 4 + 3] = 255;
  }
  return sortie;
}

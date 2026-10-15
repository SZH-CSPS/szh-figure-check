// Détecteur de texte pour les images : un réseau de segmentation (DBNet, famille PaddleOCR)
// exécuté en WebAssembly par onnxruntime-web, servis depuis vendor/. Le réseau localise les
// lignes de texte ; leur corps se mesure sur le profil d'encre de chaque ligne, leur
// contraste sur les pixels, et un lecteur (Tesseract, en mode une seule ligne) n'en lit que
// le libellé. Les fonctions de calcul n'ont pas besoin du navigateur ; le reste commence à
// chargerDetecteur().

import {
  contrasteZone, bruitFond, BRUIT_FOND_MAX, RATIO_X, mediane,
} from './analyse.js?v=cc3cec3d62';
import { compteSignes, SIGNES_PEU, formeCompacte } from './residu.js?v=cc3cec3d62';

// ── Entrée du réseau ────────────────────────────────────────────────────────────

// Grand côté maximal de l'image donnée au réseau : le coût croît avec la surface, et un
// texte de 6 pt, sur une page de 172 mm, y garde plus de dix pixels de haut.
export const COTE_MAX = 1280;
// Le réseau divise l'image par 32 : ses deux côtés en sont des multiples.
export const PAS = 32;
// Normalisation de l'entraînement : canaux en ordre B, G, R, valeurs de 0 à 1 puis moyenne
// et écart type de chaque canal.
export const MOYENNE = [0.485, 0.456, 0.406];
export const ECART_TYPE = [0.229, 0.224, 0.225];

// Réduction à COTE_MAX (jamais d'agrandissement), l'image étant ensuite placée dans un
// rectangle de côtés multiples de PAS : un seul facteur sert aux deux axes, les angles sont
// conservés. Rend { echelle, l, h }.
export function dimensionsEntree(largeur, hauteur) {
  const echelle = Math.min(1, COTE_MAX / Math.max(largeur, hauteur));
  const multiple = (v) => Math.max(PAS, Math.ceil(v * echelle / PAS - 1e-9) * PAS);
  return { echelle, l: multiple(largeur), h: multiple(hauteur) };
}

// Tenseur NCHW (1 × 3 × h × l) d'un tampon RGBA de l × h pixels.
export function tenseurDepuisRgba(rgba, l, h) {
  const plan = l * h;
  const t = new Float32Array(3 * plan);
  for (let i = 0; i < plan; i++) {
    const p = i * 4;
    t[i] = (rgba[p + 2] / 255 - MOYENNE[0]) / ECART_TYPE[0];
    t[plan + i] = (rgba[p + 1] / 255 - MOYENNE[1]) / ECART_TYPE[1];
    t[2 * plan + i] = (rgba[p] / 255 - MOYENNE[2]) / ECART_TYPE[2];
  }
  return t;
}

// ── Post-traitement de la carte de probabilité (Differentiable Binarization) ───

// Un pixel de la carte est du texte au-dessus de ce seuil.
export const SEUIL_BINAIRE = 0.3;
// Une boîte se garde si la probabilité moyenne de la carte dans la boîte atteint ce seuil.
export const SEUIL_SCORE = 0.5;
// Le réseau apprend des noyaux de texte rétrécis ; la boîte est rendue à la taille du texte
// en l'élargissant de d = rapport × aire / périmètre.
export const RAPPORT_UNCLIP = 1.6;
// Plus petit côté admis d'un noyau (pixels de la carte), puis de la boîte élargie : en
// dessous, c'est du bruit de segmentation.
export const COTE_MIN_NOYAU = 3;
export const COTE_MIN_BOITE = 5;
// Une ligne est orientée si sa boîte est au moins deux fois plus longue que large (un
// angle n'a de sens que pour une forme allongée) et si son axe s'écarte d'au moins 2° de
// l'horizontale ou de la verticale ; sinon la boîte est droite, et un léger tremblé de la
// segmentation ne penche pas les lignes.
export const ELANCEMENT_ORIENTE = 2;
export const ANGLE_NET_DEG = 2;
export const CANDIDATS_MAX = 1000;

// Dilatation 2 × 2 de la carte seuillée : relie les caractères séparés d'un pixel.
export function binariser(prob, l, h, seuil = SEUIL_BINAIRE) {
  const brut = new Uint8Array(l * h);
  for (let i = 0; i < brut.length; i++) brut[i] = prob[i] > seuil ? 1 : 0;
  const bin = new Uint8Array(l * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const i = y * l + x;
      bin[i] = brut[i] | (x > 0 ? brut[i - 1] : 0) | (y > 0 ? brut[i - l] : 0) | (x > 0 && y > 0 ? brut[i - l - 1] : 0);
    }
  }
  return bin;
}

// Composantes connexes (8 voisins) d'une carte binaire. Chacune : { x0, y0, x1, y1 } (fin
// exclue), le nombre de pixels n et, pour chaque rangée de y0 à y1 − 1, le plus petit et le
// plus grand x : rangees[2 (y − y0)] et rangees[2 (y − y0) + 1].
export function composantes(bin, l, h) {
  const etiquette = new Int32Array(l * h);
  const parent = [0];
  const racine = (a) => {
    while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
    return a;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const i = y * l + x;
      if (!bin[i]) continue;
      const voisins = [];
      if (x > 0 && etiquette[i - 1]) voisins.push(etiquette[i - 1]);
      if (y > 0) {
        if (x > 0 && etiquette[i - l - 1]) voisins.push(etiquette[i - l - 1]);
        if (etiquette[i - l]) voisins.push(etiquette[i - l]);
        if (x < l - 1 && etiquette[i - l + 1]) voisins.push(etiquette[i - l + 1]);
      }
      if (!voisins.length) { parent.push(parent.length); etiquette[i] = parent.length - 1; continue; }
      const plus = Math.min(...voisins.map(racine));
      etiquette[i] = plus;
      for (const v of voisins) parent[racine(v)] = plus;
    }
  }
  // Étiquettes ramenées à un numéro de composante (1, 2, …), bornes et effectifs.
  const numero = new Map();
  const liste = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const i = y * l + x;
      if (!etiquette[i]) continue;
      const r = racine(etiquette[i]);
      let k = numero.get(r);
      if (!k) { liste.push({ x0: x, y0: y, x1: x + 1, y1: y + 1, n: 0 }); k = liste.length; numero.set(r, k); }
      const c = liste[k - 1];
      c.x0 = Math.min(c.x0, x); c.x1 = Math.max(c.x1, x + 1); c.y1 = y + 1; c.n++;
      etiquette[i] = k;
    }
  }
  // Rangées : une seconde passe, les bornes verticales étant connues.
  for (const c of liste) {
    c.rangees = new Int32Array(2 * (c.y1 - c.y0));
    for (let r = 0; r < c.rangees.length; r += 2) { c.rangees[r] = 0x7fffffff; c.rangees[r + 1] = -1; }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const k = etiquette[y * l + x];
      if (!k) continue;
      const c = liste[k - 1];
      const r = 2 * (y - c.y0);
      if (x < c.rangees[r]) c.rangees[r] = x;
      if (x > c.rangees[r + 1]) c.rangees[r + 1] = x;
    }
  }
  return liste;
}

// Enveloppe convexe (chaîne monotone) d'une liste de points [x, y].
export function enveloppeConvexe(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const croix = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const construire = (suite) => {
    const m = [];
    for (const q of suite) {
      while (m.length >= 2 && croix(m[m.length - 2], m[m.length - 1], q) <= 0) m.pop();
      m.push(q);
    }
    m.pop();
    return m;
  };
  return [...construire(p), ...construire([...p].reverse())];
}

// Rectangle d'aire minimale d'une enveloppe convexe : l'un de ses côtés est parallèle à un
// côté de l'enveloppe. Rend { cx, cy, ux, uy, a, b } : centre, axe unitaire u, longueur a
// le long de u et b le long de la perpendiculaire, a ≥ b.
export function rectangleMinimal(enveloppe) {
  let meilleur = null;
  for (let i = 0; i < enveloppe.length; i++) {
    const p = enveloppe[i], q = enveloppe[(i + 1) % enveloppe.length];
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (!d) continue;
    const ux = (q[0] - p[0]) / d, uy = (q[1] - p[1]) / d;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of enveloppe) {
      const u = x * ux + y * uy, v = -x * uy + y * ux;
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    const aire = (u1 - u0) * (v1 - v0);
    if (!meilleur || aire < meilleur.aire) meilleur = { aire, ux, uy, u0, u1, v0, v1 };
  }
  const { ux, uy, u0, u1, v0, v1 } = meilleur;
  const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
  const centre = { cx: um * ux - vm * uy, cy: um * uy + vm * ux };
  const a = u1 - u0, b = v1 - v0;
  return a >= b ? { ...centre, ux, uy, a, b } : { ...centre, ux: -uy, uy: ux, a: b, b: a };
}

// Angle de l'axe u à l'axe de coordonnées le plus proche, en degrés (0 à 45).
export function ecartAuxAxes(ux, uy) {
  const a = Math.abs(Math.atan2(uy, ux) * 180 / Math.PI) % 90;
  return Math.min(a, 90 - a);
}

// Boîte d'une composante : rectangle orienté si la ligne est allongée et franchement
// inclinée, sinon boîte droite ({ ux: 1, uy: 0 }, a la largeur, b la hauteur).
export function boiteDeComposante(c) {
  const points = [];
  for (let y = c.y0; y < c.y1; y++) {
    const r = 2 * (y - c.y0);
    if (c.rangees[r + 1] < 0) continue;
    points.push([c.rangees[r], y], [c.rangees[r], y + 1], [c.rangees[r + 1] + 1, y], [c.rangees[r + 1] + 1, y + 1]);
  }
  const rect = rectangleMinimal(enveloppeConvexe(points));
  if (rect.a / rect.b >= ELANCEMENT_ORIENTE && ecartAuxAxes(rect.ux, rect.uy) >= ANGLE_NET_DEG) return { ...rect, oriente: true };
  return { cx: (c.x0 + c.x1) / 2, cy: (c.y0 + c.y1) / 2, ux: 1, uy: 0, a: c.x1 - c.x0, b: c.y1 - c.y0, oriente: false };
}

// Élargit la boîte de d = rapport × aire / périmètre de chaque côté (un rectangle élargi à
// coins arrondis garde pour rectangle minimal ce rectangle agrandi de d).
export function elargir(boite, rapport = RAPPORT_UNCLIP) {
  const d = rapport * boite.a * boite.b / (2 * (boite.a + boite.b));
  return { ...boite, a: boite.a + 2 * d, b: boite.b + 2 * d };
}

// Côté de la boîte le long de la direction (dx, dy), et le long de sa perpendiculaire.
export function etendues(boite, dx, dy) {
  const vx = -boite.uy, vy = boite.ux;
  const le = (ex, ey) => Math.abs(ex * boite.ux + ey * boite.uy) * boite.a + Math.abs(ex * vx + ey * vy) * boite.b;
  return { long: le(dx, dy), large: le(-dy, dx) };
}

// Boîte droite qui contient la boîte orientée, bornée à [0, l] × [0, h].
export function englobante(boite, l = Infinity, h = Infinity) {
  const ex = etendues(boite, 1, 0).long / 2, ey = etendues(boite, 0, 1).long / 2;
  return {
    x0: Math.max(0, boite.cx - ex), y0: Math.max(0, boite.cy - ey),
    x1: Math.min(l, boite.cx + ex), y1: Math.min(h, boite.cy + ey),
  };
}

// Probabilité moyenne de la carte dans la boîte (pixels dont le centre est dedans).
export function scoreMoyen(prob, l, h, boite) {
  const { x0, y0, x1, y1 } = englobante(boite, l, h);
  const vx = -boite.uy, vy = boite.ux;
  let somme = 0, n = 0;
  for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
    for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
      const dx = x + 0.5 - boite.cx, dy = y + 0.5 - boite.cy;
      if (Math.abs(dx * boite.ux + dy * boite.uy) > boite.a / 2 || Math.abs(dx * vx + dy * vy) > boite.b / 2) continue;
      somme += prob[y * l + x]; n++;
    }
  }
  return n ? somme / n : 0;
}

// Boîtes de texte d'une carte de probabilité l × h, en pixels de la carte : { cx, cy, ux,
// uy, a, b, oriente, score }, la boîte déjà élargie.
export function boitesDepuisCarte(prob, l, h, options = {}) {
  const { seuil = SEUIL_BINAIRE, seuilScore = SEUIL_SCORE, rapport = RAPPORT_UNCLIP } = options;
  const comps = composantes(binariser(prob, l, h, seuil), l, h)
    .sort((p, q) => q.n - p.n).slice(0, CANDIDATS_MAX);
  const boites = [];
  for (const c of comps) {
    const noyau = boiteDeComposante(c);
    if (Math.min(noyau.a, noyau.b) < COTE_MIN_NOYAU) continue;
    const score = scoreMoyen(prob, l, h, noyau);
    if (score < seuilScore) continue;
    const boite = elargir(noyau, rapport);
    if (Math.min(boite.a, boite.b) < COTE_MIN_BOITE) continue;
    boites.push({ ...boite, score });
  }
  return boites;
}

// Boîte de la carte ramenée au canevas d'analyse (l'image du réseau en est la réduction
// d'un facteur `echelle`, posée en haut à gauche).
export function versCanevas(boite, echelle) {
  return { ...boite, cx: boite.cx / echelle, cy: boite.cy / echelle, a: boite.a / echelle, b: boite.b / echelle };
}

// ── Mesure du corps sur le profil d'encre ──────────────────────────────────────

const RATIO_CAPITALE = 0.71;
// Les rangées d'un palier ont au moins la moitié de la densité d'encre maximale : le trait
// d'une lettre y touche un pixel sur deux au plus.
export const PALIER = 0.5;
// Hampes et jambages : rangées voisines du palier dont la densité atteint ce rapport du
// maximum. Une ligne qui monte au-dessus de son palier d'au moins 20 % de sa hauteur a des
// hampes ou des capitales au-dessus d'une hauteur d'x : son palier est la hauteur d'x.
export const HAMPE = 0.12;
export const HAMPE_RAPPORT_MIN = 0.2;
// Sans texte lu, un palier qui couvre moins de la moitié de l'étendue de l'encre n'est pas
// une hauteur d'x (le palier d'une hauteur d'x vaut 0,52 / (0,52 + hampes et jambages) : au
// moins 0,6) : c'est une ligne de capitales ou de chiffres.
export const PALIER_PLEIN = 0.5;
// Étendue d'une ligne de capitales : rangées contiguës dont la densité atteint le quart du
// maximum. Plus bas, le flou des bords et les queues (virgule, « % ») allongent la ligne ;
// plus haut, les montants d'un L ou d'un U, moins denses que leurs barres, sortent.
export const ETENDUE = 0.25;
// Un texte d'un ou deux signes, tous des capitales ou des chiffres, n'a pas de ligne de base
// partagée entre plusieurs lettres : un 4 (pointe fine), un 7 ou un T (barre dense, montant
// mince), un F ou un 9 (paliers interrompus) ont un palier dense qui ne couvre qu'une partie
// de leur hauteur. Leur hauteur est alors l'étendue d'encre mesurée plus bas : rangées
// contiguës où la densité atteint ETENDUE_COURTE fois le maximum, ou PIXELS_ENCRE pixels
// d'encre si c'est moins (un montant de 3 pixels de large est de l'encre même devant une
// barre de 60). Le palier ne vaut que s'il couvre au moins PALIER_PLEIN_COURT de cette étendue.
export const ETENDUE_COURTE = 0.15;
export const PIXELS_ENCRE = 3;
export const PALIER_PLEIN_COURT = 0.8;

// Densité d'encre de chaque rangée d'un tampon RGBA de l × h pixels : part de la largeur
// couverte, chaque pixel comptant pour son écart au fond (médiane de la zone : l'encre en
// couvre moins de la moitié, alors que le pourtour peut mordre sur une forme voisine) rapporté à
// l'écart maximal de la zone. Rend null si la zone est unie.
export function profilEncre(rgba, l, h) {
  if (l < 2 || h < 3) return null;
  const luma = new Float32Array(l * h);
  for (let i = 0; i < luma.length; i++) luma[i] = 0.2126 * rgba[4 * i] + 0.7152 * rgba[4 * i + 1] + 0.0722 * rgba[4 * i + 2];
  const fond = mediane(Array.from(luma));
  let amplitude = 0;
  for (let i = 0; i < luma.length; i++) amplitude = Math.max(amplitude, Math.abs(luma[i] - fond));
  if (amplitude < 12) return null;
  const profil = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = 0; x < l; x++) s += Math.min(1, Math.abs(luma[y * l + x] - fond) / amplitude);
    profil[y] = s / l;
  }
  return profil;
}

// Bords [début, fin] (position des rangées, en pixels, interpolée entre les centres) de la
// zone où le profil atteint `seuil`, à partir de la rangée `depart` et sans interruption.
function bordsDepuis(profil, depart, seuil) {
  let i0 = depart, i1 = depart;
  while (i0 > 0 && profil[i0 - 1] >= seuil) i0--;
  while (i1 < profil.length - 1 && profil[i1 + 1] >= seuil) i1++;
  const haut = i0 > 0 ? i0 - 0.5 + (seuil - profil[i0 - 1]) / (profil[i0] - profil[i0 - 1]) : 0;
  const bas = i1 < profil.length - 1 ? i1 + 0.5 + (profil[i1] - seuil) / (profil[i1] - profil[i1 + 1]) : profil.length;
  return [haut, bas];
}

// Un trait d'une ou deux rangées qui traverse la boîte (contour d'une forme, filet) a une
// densité maximale sans être du texte : le profil est lissé par une médiane sur cinq
// rangées, qui efface ce qui est plus fin que trois rangées et laisse les paliers, dont la
// hauteur dépasse trois pixels pour tout texte mesurable.
export const FENETRE_LISSAGE = 5;

export function medianeGlissante(profil, fenetre) {
  const demi = fenetre >> 1;
  return Float64Array.from(profil, (_, i) => {
    const v = [];
    for (let k = Math.max(0, i - demi); k <= Math.min(profil.length - 1, i + demi); k++) v.push(profil[k]);
    return mediane(v);
  });
}

// Paliers du profil : le palier dense (hauteur d'x d'un texte en bas de casse, hauteur de
// capitale ou de chiffre d'un texte en capitales), ce qui monte au-dessus (hampes,
// capitales) et ce qui descend dessous (jambages). Hauteurs en pixels, au dixième près.
// Rend null si le profil est vide.
export function paliers(brut, largeur = null) {
  const profil = medianeGlissante(brut, FENETRE_LISSAGE);
  const max = Math.max(...profil);
  if (!(max > 0)) return null;
  // Première et dernière rangée du palier : il peut être interrompu en son milieu (la
  // barre d'un e, le creux d'un 0).
  let i0 = profil.length, i1 = -1;
  for (let i = 0; i < profil.length; i++) if (profil[i] >= PALIER * max) { i0 = Math.min(i0, i); i1 = i; }
  const [haut] = bordsDepuis(profil, i0, PALIER * max);
  const [, bas] = bordsDepuis(profil, i1, PALIER * max);
  const [e0] = bordsDepuis(profil, i0, HAMPE * max);
  const [, e1] = bordsDepuis(profil, i1, HAMPE * max);
  const [c0] = bordsDepuis(profil, i0, ETENDUE * max);
  const [, c1] = bordsDepuis(profil, i1, ETENDUE * max);
  const seuilFin = Math.min(ETENDUE_COURTE * max, largeur ? PIXELS_ENCRE / largeur : Infinity);
  const [f0] = bordsDepuis(profil, i0, seuilFin);
  const [, f1] = bordsDepuis(profil, i1, seuilFin);
  return { palier: bas - haut, dessus: Math.max(0, haut - e0), dessous: Math.max(0, e1 - bas), etendue: c1 - c0, etendueFine: f1 - f0 };
}

// Nature du palier dense d'après le texte lu : la hauteur d'x s'il porte plus de minuscules
// que de capitales et de chiffres, la hauteur de capitale sinon. null sans texte exploitable.
export function natureDuTexte(texte) {
  const bas = (texte.match(/\p{Ll}/gu) || []).length;
  const haut = (texte.match(/[\p{Lu}\p{Nd}]/gu) || []).length;
  if (!bas && !haut) return null;
  return bas > haut ? 'x' : 'capitale';
}

// Corps en pixels. Sans texte, un palier surmonté de hampes (dessus ≥ 20 % du palier) est
// une hauteur d'x, un palier nu une hauteur de capitale. Avec hampes, la hauteur d'x et
// celle de la capitale donnent deux estimations, dont on prend la moyenne. `court`
// ({ largeur } de la découpe) désigne un texte d'une ou deux capitales ou chiffres : voir
// ETENDUE_COURTE.
export function corpsDepuisProfil(profil, nature = null, court = null) {
  const p = paliers(profil, court ? court.largeur : null);
  if (!p || p.palier <= 0) return null;
  if (court && nature === 'capitale') {
    return (p.palier >= PALIER_PLEIN_COURT * p.etendueFine ? p.palier : p.etendueFine) / RATIO_CAPITALE;
  }
  const etendue = p.etendue;
  const avecHampes = p.dessus >= HAMPE_RAPPORT_MIN * p.palier;
  // Capitales, chiffres : le palier donne la hauteur quand il couvre l'essentiel de
  // l'étendue ; sinon (les barres d'un L ou d'un T, plus denses que leurs montants, ne
  // couvrent qu'une partie de la ligne) c'est l'étendue qui la donne.
  if (nature ? nature === 'capitale' : !avecHampes || p.palier < PALIER_PLEIN * etendue) {
    return (p.palier >= PALIER_PLEIN * etendue ? p.palier : etendue) / RATIO_CAPITALE;
  }
  const parX = p.palier / RATIO_X;
  return avecHampes ? (parX + (p.palier + p.dessus) / RATIO_CAPITALE) / 2 : parX;
}

// ── Orientation de lecture ──────────────────────────────────────────────────────

// Une boîte droite plus haute que large de ce rapport se lit aussi à la verticale ; au-delà
// de VERTICAL_SUR, seulement à la verticale. Entre les deux (un « 1 » élargi, par exemple),
// les deux lectures se font et la plus sûre l'emporte.
export const VERTICAL_POSSIBLE = 1.5;
export const VERTICAL_SUR = 4;

// Directions de lecture possibles, en radians (y vers le bas) : 0 pour un texte horizontal,
// −π/2 pour un texte vertical lu de bas en haut. Une boîte orientée se lit le long de son
// grand axe, tourné d'au plus un quart de tour.
export function directions(boite) {
  if (boite.oriente) {
    const phi = Math.atan2(boite.uy, boite.ux);
    if (Math.abs(phi) <= Math.PI / 4) return [phi];
    if (Math.abs(phi) >= 3 * Math.PI / 4) return [phi - Math.sign(phi) * Math.PI];
    return [phi < 0 ? phi : phi - Math.PI];
  }
  const rapport = boite.b / boite.a;
  if (rapport >= VERTICAL_SUR) return [-Math.PI / 2];
  if (rapport >= VERTICAL_POSSIBLE) return [0, -Math.PI / 2];
  return [0];
}

// ── Chargement et inférence (navigateur) ───────────────────────────────────────

const VENDOR = new URL('../vendor/', import.meta.url);
const ORT = new URL('onnxruntime/ort.wasm.min.js?v=cc3cec3d62', VENDOR).href;
const ORT_MJS = new URL('onnxruntime/ort-wasm-simd-threaded.mjs?v=cc3cec3d62', VENDOR).href;
const ORT_WASM = new URL('onnxruntime/ort-wasm-simd-threaded.wasm', VENDOR).href;
const MODELE = new URL('modele/ch_PP-OCRv3_det_infer.onnx', VENDOR).href;

// L'exécuteur ou le modèle n'a pas pu se charger, ou l'inférence a échoué : l'appelant
// retombe sur la lecture complète par Tesseract.
export class ErreurDetecteur extends Error {
  constructor(cause) {
    super(`detecteur : ${cause?.message || cause}`);
    this.cause = cause;
  }
}

// Ajoute une balise <script> qui charge un fichier de vendor/.
export function chargerScript(url) {
  return new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = ok;
    s.onerror = () => ko(new Error('cdn'));
    document.head.append(s);
  });
}

let session = null;

// Charge l'exécuteur et le modèle, une seule fois. Un seul fil, sans travailleur : les fils
// multiples demandent des en-têtes (COOP, COEP) que l'hébergement statique ne pose pas.
export async function chargerDetecteur() {
  if (!session) {
    session = (async () => {
      if (typeof WebAssembly !== 'object') throw new Error('WebAssembly absent');
      if (!window.ort) await chargerScript(ORT);
      const ort = window.ort;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = { mjs: ORT_MJS, wasm: ORT_WASM };
      const reponse = await fetch(MODELE);
      if (!reponse.ok) throw new Error(`modèle introuvable (${reponse.status})`);
      const modele = new Uint8Array(await reponse.arrayBuffer());
      return ort.InferenceSession.create(modele, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    })();
    session.catch(() => { session = null; });
  }
  return session;
}

const pause = () => new Promise((ok) => setTimeout(ok, 20));

function canevasVierge(l, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(l));
  c.height = Math.max(1, Math.round(h));
  return c;
}

// Carte de probabilité du texte pour un canevas : { prob, l, h, echelle }.
async function inferer(s, canevas) {
  const { echelle, l, h } = dimensionsEntree(canevas.width, canevas.height);
  const entree = canevasVierge(l, h);
  const ctx = entree.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, l, h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canevas, 0, 0, canevas.width * echelle, canevas.height * echelle);
  const tenseur = new window.ort.Tensor('float32', tenseurDepuisRgba(ctx.getImageData(0, 0, l, h).data, l, h), [1, 3, h, l]);
  await pause();
  const sortie = await s.run({ [s.inputNames[0]]: tenseur });
  return { prob: sortie[s.outputNames[0]].data, l, h, echelle };
}

// ── Découpe, mesure et lecture d'une ligne ─────────────────────────────────────

// Découpe de la boîte dans le canevas, tournée pour que la direction `phi` devienne
// horizontale, à l'échelle `s`. Rend le canevas de la découpe.
function decouper(source, boite, phi, s = 1) {
  const e = etendues(boite, Math.cos(phi), Math.sin(phi));
  const c = canevasVierge(Math.ceil(e.long * s), Math.ceil(e.large * s));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(-phi);
  ctx.scale(s, s);
  ctx.drawImage(source, -boite.cx, -boite.cy);
  return c;
}

// Hauteur visée de la découpe donnée au lecteur, plus une marge de fond : Tesseract lit
// mal les lignes très basses, et les ordinateurs n'y gagnent rien au-delà.
export const HAUTEUR_LECTURE = 56;
export const MARGE_LECTURE = 8;
export const AGRANDISSEMENT_MAX = 8;
// Confiance du lecteur sous laquelle une lecture est dite incertaine.
export const CONFIANCE_LECTURE_MIN = 40;

function pourLecture(decoupe) {
  const s = Math.min(AGRANDISSEMENT_MAX, HAUTEUR_LECTURE / decoupe.height);
  const l = Math.ceil(decoupe.width * s), h = Math.ceil(decoupe.height * s);
  const c = canevasVierge(l + 2 * MARGE_LECTURE, h + 2 * MARGE_LECTURE);
  const ctx = c.getContext('2d');
  const rgba = decoupe.getContext('2d').getImageData(0, 0, decoupe.width, decoupe.height).data;
  const bord = [[], [], []];
  const noter = (x, y) => { for (let k = 0; k < 3; k++) bord[k].push(rgba[(y * decoupe.width + x) * 4 + k]); };
  for (let x = 0; x < decoupe.width; x++) { noter(x, 0); noter(x, decoupe.height - 1); }
  for (let y = 0; y < decoupe.height; y++) { noter(0, y); noter(decoupe.width - 1, y); }
  ctx.fillStyle = `rgb(${bord.map((v) => Math.round(mediane(v))).join(',')})`;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(decoupe, MARGE_LECTURE, MARGE_LECTURE, l, h);
  return c;
}

const lectureUtile = (r) => r && /[\p{L}\p{N}]/u.test(r.texte);

// Détecte les lignes de texte d'un canevas d'analyse. `lecteur(canevas)` lit une ligne et
// rend { texte, confiance } ; sans lecteur, le libellé reste « ? ». Rend des lignes comme
// lire() de lecture.js : { texte, mots, bbox, corpsPx, contraste, exact: false, vertical,
// confiance, origine: 'detecteur', score, bruit }, plus lectureIncertaine quand la lecture est vide ou
// absurde. Une ErreurDetecteur signale un chargement ou une inférence impossible.
export async function detecter(canevas, progres = () => {}, lecteur = null) {
  let carte;
  try {
    progres('detecteur-chargement', 0);
    const s = await chargerDetecteur();
    progres('detection', 0);
    carte = await inferer(s, canevas);
  } catch (e) {
    throw new ErreurDetecteur(e);
  }
  const rgba = canevas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canevas.width, canevas.height).data;
  const boites = boitesDepuisCarte(carte.prob, carte.l, carte.h).map((b) => versCanevas(b, carte.echelle));
  const lignes = [];
  let fait = 0;
  for (const boite of boites) {
    progres('ocr', fait++ / boites.length);
    const bbox = englobante(boite, canevas.width, canevas.height);
    if (bbox.x1 - bbox.x0 < 2 || bbox.y1 - bbox.y0 < 2) continue;
    // Une tache de photo que le réseau prend pour du texte : fond qui varie presque
    // autant que l'écart entre texte et fond.
    const bruit = bruitFond(rgba, canevas.width, canevas.height, bbox);
    if (bruit > BRUIT_FOND_MAX) continue;
    let lu = null, phi = directions(boite)[0];
    if (lecteur) {
      for (const d of directions(boite)) {
        const r = await lecteur(pourLecture(decouper(canevas, boite, d, 1)));
        if (!lu || (r && r.confiance > lu.confiance)) { lu = r; phi = d; }
      }
    }
    const incertaine = !lectureUtile(lu) || lu.confiance < CONFIANCE_LECTURE_MIN;
    const nature = incertaine ? null : natureDuTexte(lu.texte);
    const court = nature === 'capitale' && compteSignes(lu.texte) <= SIGNES_PEU && !/\p{Ll}/u.test(lu.texte);
    const decoupe = decouper(canevas, boite, phi, 1);
    const profil = profilEncre(decoupe.getContext('2d').getImageData(0, 0, decoupe.width, decoupe.height).data, decoupe.width, decoupe.height);
    const contraste = contrasteZone(rgba, canevas.width, canevas.height, bbox);
    const ligne = {
      texte: incertaine ? '?' : lu.texte,
      mots: [bbox],
      bbox,
      corpsPx: profil ? corpsDepuisProfil(profil, nature, court ? { largeur: decoupe.width } : null) : null,
      contraste,
      exact: false,
      vertical: Math.abs(phi) > Math.PI / 4,
      confiance: lu ? lu.confiance : 0,
      origine: 'detecteur',
      score: boite.score,
      bruit,
      forme: compteSignes(incertaine ? '' : lu.texte) <= SIGNES_PEU && formeCompacte(rgba, canevas.width, canevas.height, bbox),
    };
    if (incertaine) ligne.lectureIncertaine = true;
    lignes.push(ligne);
  }
  return lignes;
}

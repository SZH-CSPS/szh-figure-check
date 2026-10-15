// Objets d'une figure : barres, courbes, flèches, cases, secteurs. Dans un SVG ou un PDF, ils
// sont lus tels quels (résultat exact) ; dans une image, ils sont cherchés sur le canevas
// d'analyse (résultat approché). Les objets de même couleur forment une série ; pour chaque
// série : contraste avec le fond et avec les séries qui la touchent, épaisseur des traits à
// l'impression, distinction d'avec les autres séries en vision normale, pour trois
// daltonismes et en niveaux de gris. objetsBitmap() et analyserObjets() n'ont pas besoin du
// DOM ; rendreObjets() dessine le bloc du rapport et exporterObjets() rend le dernier résultat.

import { versHex } from './apca.js?v=9055eac22a';
import { MM_PAR_PT } from './formats.js?v=9055eac22a';
import {
  versLab, distanceLab, ciede2000, simuler, ecartsPaire, contrasteGraphique, verdictPaire, teinteConforme, pire,
  WCAG_GRAPHIQUE, LC_GRAPHIQUE, DELTA_E_DISTINCT, DELTA_E_CONFONDU,
} from './couleur.js?v=9055eac22a';
import { T, nombre } from './i18n.js?v=9055eac22a';

// ── Constantes ──────────────────────────────────────────────────────────────────

// Au-delà de ce nombre de pixels, l'image d'analyse est lue un pixel sur deux (ou trois) :
// l'analyse tient en quelques secondes, et un trait de 0,25 pt, large de 1,8 px à 20 px/mm,
// garde au moins un pixel.
export const PIXELS_MAX = 10e6;
// Deux nuances à moins de 12 unités Lab (CIE76) l'une de l'autre sont une seule couleur :
// le bruit d'une image compressée reste en deçà, deux teintes d'une même gamme au-delà.
// La couleur la plus fréquente, en général le fond, ne réunit que les nuances à moins de
// 6 : une surface pâle sur fond blanc reste un objet, dont le contraste sera jugé.
export const RAYON_COULEUR = 12;
export const RAYON_FOND = 6;
// Couleurs retenues au plus ; les nuances plus rares rejoignent la plus proche.
const COULEURS_MAX = 64;
// Un objet couvre au moins 0,25 mm² à l'impression, un carré d'un demi-millimètre : le
// point d'une courbe passe, le grain d'une image compressée non.
export const SURFACE_MIN_MM2 = 0.25;
// Halo autour des textes lus, écarté de l'analyse : 2 px plus un quart de la hauteur du
// texte, le même que pour les couleurs des textes. Un texte dont le pourtour appartient
// à 90 % à une seule composante est posé sur elle.
const HALO_TEXTE = 0.25;
const ENTOURE_PART = 0.9;
// Frange lissée : un pixel dont les deux voisins opposés diffèrent de plus de 16 sur un
// canal (0 à 255) et dont la couleur est un mélange des leurs, à 8 près en RVB, sans être
// celle de l'un d'eux. Les bords adoucis d'une image sont écartés ; un trait d'un pixel, ou
// un filet gris entre une barre rouge et le blanc, ne l'est pas.
const ECART_VOISINS = 16;
const MARGE_FRANGE = 8;
// Un pixel de frange compte pour une demi-épaisseur de trait : sa couleur est à mi-chemin
// entre le trait et le fond.
const COUVERTURE_FRANGE = 0.5;
// Deux régions voisines se continuent l'une l'autre quand, sur 40 % au moins de leur
// frontière directe, les pixels de part et d'autre diffèrent de moins de 8 sur 255 par
// canal : c'est un dégradé que la réduction des couleurs a découpé, pas deux objets. Entre
// deux aplats distincts, le saut vaut au moins l'écart qui sépare deux couleurs retenues.
const SAUT_DEGRADE = 8;
const PART_DEGRADE = 0.4;
// Et cette frontière couvre au moins 20 % du pourtour de la plus grande des deux régions :
// une bande de dégradé touche sa voisine sur toute sa longueur.
const CONTINUITE_MIN = 0.2;
// Écart type des pixels d'un objet uni : sous 8 par canal, un aplat, même en JPEG de basse
// qualité ; au-dessus, une texture ou un dégradé.
const ECART_UNI = 8;
// Taux de remplissage de la boîte : un rectangle la remplit (0,9 au moins, la place laissée
// aux coins arrondis) ; une ellipse en couvre π/4 ≈ 0,785, de 0,72 à 0,85 une fois lissée.
export const TAUX_RECTANGLE = 0.9;
export const TAUX_ELLIPSE = [0.72, 0.85];
// Un cadre, rectangle vide, couvre au moins 90 % du pourtour de sa boîte.
const TAUX_CADRE = 0.9;
// Un trait est bien plus long qu'épais : sa longueur (surface / épaisseur) vaut au moins
// dix fois son épaisseur (un bout de courbe entre deux croisements passe, un losange non),
// et celle-ci reste sous 1,5 mm à l'impression (4,25 pt), plus qu'aucun trait de graphique,
// moins que la plus fine des barres. Un rectangle plein au moins deux fois plus long que
// large, et fin, est un filet ou un tiret tracé comme un rectangle.
export const FINESSE_TRAIT = 10;
export const EPAISSEUR_TRAIT_MAX_MM = 1.5;
const ALLONGEMENT_FILET = 2;
// Épaisseur d'un trait imprimé : sous 0,5 pt, il s'affaiblit à l'impression et sur une
// copie ; sous 0,25 pt, le filet le plus fin des imprimeurs, il peut disparaître.
export const EPAISSEUR_AMELIORER_PT = 0.5;
export const EPAISSEUR_CORRIGER_PT = 0.25;
// Deux objets se touchent quand leur frontière commune vaut au moins 5 % du pourtour du plus
// petit : une barre empilée sur une autre, deux secteurs voisins ; pas un quadrillage qui
// passe sous une barre.
const CONTACT_MIN = 0.05;
// Entre deux objets, une frange lissée d'au plus 3 px sépare encore des objets qui se touchent.
const FRANGE_MAX = 3;
// Objets d'une même série : ΔE00 sous 5, l'écart en deçà duquel deux couleurs se confondent.
export const DELTA_E_SERIE = DELTA_E_CONFONDU;
// Légende d'une série de surfaces : une case d'au plus un quart de la plus grande surface
// de sa série, pas plus allongée que 3 : 1, à côté d'un texte (écart d'au plus deux fois sa
// largeur) et haute comme lui, du tiers au triple.
const LEGENDE_PART = 0.25;
const LEGENDE_ALLONGEMENT = 3;
const LEGENDE_DISTANCE = 2;
const LEGENDE_HAUTEUR = 3;
// Quadrillage : au moins trois traits parallèles de même longueur (à 15 % près), longs d'au
// moins 40 % de la figure. Il est décoratif : son contraste n'est pas jugé.
const QUADRILLAGE_MIN = 3;
const QUADRILLAGE_LONGUEUR = 0.4;
const QUADRILLAGE_TOLERANCE = 0.15;
const QUADRILLAGE_PART = 0.9;
// Un trait est au moins quatre fois plus long que large pour avoir une orientation.
const ALLONGEMENT_TRAIT = 4;
// Un tronçon de trait plus court que le cinquième du plus long trait de sa série (un bout
// d'axe sous une barre, une graduation) ne décide pas de l'épaisseur minimale.
const TRONCON_MIN = 0.2;
// Fond d'un SVG ou d'un PDF : le plus grand rectangle, s'il couvre la moitié de la figure.
const FOND_COUVERTURE = 0.5;
// Un objet dont la boîte est aux quatre cinquièmes dans celle d'un texte est le texte.
const DANS_TEXTE = 0.8;
// La figure a des formes nettes quand leurs surfaces couvrent au moins 0,1 % de l'image et
// au moins la moitié de ce qui n'est pas le fond, dégradés et textures compris : une seule
// courbe fine y arrive, les taches d'une photo non. Une série plus petite que 0,1 % ne porte
// pas d'information par sa couleur seule : elle n'entre pas dans les paires.
const FORMES_PART_MIN = 0.001;
const COUVERTURE_NETTE = 0.5;
// Texture : au moins huit formes d'une même couleur, petites (moins de 4 mm²) et de tailles
// disparates (écart type au-dessus de la moitié de la moyenne), comme les taches d'une photo
// compressée ; des marques identiques d'un nuage de points n'y sont pas.
const TEXTURE_MIN = 8;
const TEXTURE_MM2 = 4;
const TEXTURE_DISPARITE = 0.5;
// Paires de séries montrées au plus, les plus proches d'abord.
const PAIRES_MAX = 12;
// Rastérisation d'un chemin pour mesurer son taux de remplissage.
const RASTER_PX = 128;
// Coins de la boîte, en retrait de 5 % : vides pour une ellipse, l'un d'eux plein pour un
// secteur ou un demi-disque.
const RETRAIT_COINS = 0.05;

export const TYPES = ['rectangle', 'ellipse', 'trait', 'forme', 'degrade'];

// ── Outils ──────────────────────────────────────────────────────────────────────

const aireBoite = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const perimetre = (b) => 2 * (b.x1 - b.x0 + b.y1 - b.y0);

function union(a, b) {
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}

function intersection(a, b) {
  const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0), x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1);
  return x1 > x0 && y1 > y0 ? (x1 - x0) * (y1 - y0) : 0;
}

function mediane(valeurs) {
  if (!valeurs.length) return null;
  const v = [...valeurs].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Type d'une surface d'après son taux de remplissage et ses coins.
function typeParTaux(taux, coinPlein) {
  if (taux >= TAUX_RECTANGLE) return 'rectangle';
  if (taux >= TAUX_ELLIPSE[0] && taux <= TAUX_ELLIPSE[1] && !coinPlein) return 'ellipse';
  return 'forme';
}

// Épaisseur d'un trait d'après la transformée de distance : deux fois la distance médiane
// au bord sur la crête (les pixels les plus éloignés du bord), le premier pixel valant 1 ;
// moins un demi-pixel, parce que la crête d'un trait d'épaisseur paire est à cheval sur deux
// pixels. L'erreur reste sous un demi-pixel.
function epaisseurDepuisCrete(medianeCrete) {
  return Math.max(1, 2 * medianeCrete - 0.5);
}

// ── Voie approchée : image bitmap ───────────────────────────────────────────────

// Cherche les objets d'une image. `rgba` : pixels du canevas d'analyse ; `boites` : boîtes
// des textes lus, en pixels, écartées avec un halo ; `mmParPx` : millimètres imprimés par
// pixel. Rend { fond, largeur, hauteur, pas, objets, contacts, carte }, les boîtes et
// surfaces en pixels du canevas : `objets[i].comps` sont les composantes de la `carte`
// (étiquettes par pixel, à l'échelle 1/pas) ; `contacts` les paires d'objets qui se
// touchent, avec la force du contact.
export function objetsBitmap(rgba, largeur, hauteur, { boites = [], mmParPx, pas = null } = {}) {
  pas ??= Math.max(1, Math.ceil(Math.sqrt((largeur * hauteur) / PIXELS_MAX)));
  const W = Math.floor(largeur / pas), H = Math.floor(hauteur / pas), N = W * H;
  const surfaceMin = SURFACE_MIN_MM2 / (mmParPx * mmParPx) / (pas * pas);

  // Image réduite, et case de couleur de chaque pixel (5 bits par canal).
  const rgb = new Uint8Array(N * 3);
  const cas = new Uint16Array(N);
  const n = new Uint32Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = (y * pas * largeur + x * pas) * 4, i = y * W + x;
      const r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
      const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      cas[i] = k; n[k]++; sr[k] += r; sg[k] += g; sb[k] += b;
    }
  }

  // Textes : masque avec halo, et sommes cumulées pour compter le texte dans une boîte.
  const masque = new Uint8Array(N);
  const cadres = [];
  for (const b of boites) {
    const marge = 2 + HALO_TEXTE * (b.y1 - b.y0);
    const x0 = Math.max(0, Math.floor((b.x0 - marge) / pas)), x1 = Math.min(W, Math.ceil((b.x1 + marge) / pas));
    const y0 = Math.max(0, Math.floor((b.y0 - marge) / pas)), y1 = Math.min(H, Math.ceil((b.y1 + marge) / pas));
    if (x1 <= x0 || y1 <= y0) continue;
    cadres.push({ x0, y0, x1, y1 });
    for (let y = y0; y < y1; y++) masque.fill(1, y * W + x0, y * W + x1);
  }
  let cumul = null;
  if (boites.length) {
    cumul = new Uint32Array((W + 1) * (H + 1));
    for (let y = 1; y <= H; y++) {
      let ligne = 0;
      for (let x = 1; x <= W; x++) {
        ligne += masque[(y - 1) * W + x - 1];
        cumul[y * (W + 1) + x] = cumul[(y - 1) * (W + 1) + x] + ligne;
      }
    }
  }
  const texteDans = (b) => (cumul ? cumul[b.y1 * (W + 1) + b.x1] - cumul[b.y0 * (W + 1) + b.x1] - cumul[b.y1 * (W + 1) + b.x0] + cumul[b.y0 * (W + 1) + b.x0] : 0);

  // Couleurs : les cases, des plus remplies aux moins remplies, regroupées autour des
  // premières ; une case trop loin de toute couleur retenue (frange lissée) reste sans groupe.
  const peuplees = [];
  for (let k = 0; k < 32768; k++) if (n[k]) peuplees.push(k);
  peuplees.sort((a, b) => n[b] - n[a]);
  const groupes = [];
  const groupeDeCase = new Int16Array(32768).fill(-1);
  for (const k of peuplees) {
    const lab = versLab([sr[k] / n[k], sg[k] / n[k], sb[k] / n[k]]);
    let meilleur = -1, d = RAYON_COULEUR;
    for (let g = 0; g < groupes.length; g++) {
      const e = distanceLab(lab, groupes[g]);
      if (e < d && (g > 0 || e < RAYON_FOND)) { d = e; meilleur = g; }
    }
    if (meilleur < 0 && groupes.length < COULEURS_MAX) { groupes.push(lab); meilleur = groupes.length - 1; }
    groupeDeCase[k] = meilleur;
  }
  const etiquette = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (!masque[i]) etiquette[i] = groupeDeCase[cas[i]] + 1;
  // Franges lissées, entre deux voisins opposés qui diffèrent.
  const entre = (p, a, b) => {
    let ecart = 0, ab2 = 0, pa2 = 0, pb2 = 0, scalaire = 0;
    for (let c = 0; c < 3; c++) {
      const va = rgb[a * 3 + c], vb = rgb[b * 3 + c], vp = rgb[p * 3 + c];
      ecart = Math.max(ecart, Math.abs(va - vb));
      ab2 += (vb - va) ** 2; pa2 += (vp - va) ** 2; pb2 += (vp - vb) ** 2; scalaire += (vp - va) * (vb - va);
    }
    if (ecart <= ECART_VOISINS || pa2 < MARGE_FRANGE ** 2 || pb2 < MARGE_FRANGE ** 2) return false;
    const t = scalaire / ab2;                          // position du mélange entre a (0) et b (1)
    if (t <= 0 || t >= 1) return false;
    return pa2 - scalaire * t <= MARGE_FRANGE ** 2;    // distance au segment, au carré
  };
  for (let y = 1; y < H - 1; y++) {
    for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (etiquette[p] && (entre(p, p - 1, p + 1) || entre(p, p - W, p + W))) etiquette[p] = 0;
    }
  }

  // Composantes connexes à 8 voisins : surface, boîte, sommes des couleurs.
  const comp = new Int32Array(N);
  const pile = new Int32Array(N);
  const aire = [0], bx0 = [0], by0 = [0], bx1 = [0], by1 = [0], grp = [0];
  const cr = [0], cg = [0], cb = [0], cr2 = [0], cg2 = [0], cb2 = [0];
  let nComp = 0;
  for (let depart = 0; depart < N; depart++) {
    if (!etiquette[depart] || comp[depart]) continue;
    const e = etiquette[depart], id = ++nComp;
    let a = 0, x0 = W, y0 = H, x1 = -1, y1 = -1, r = 0, g = 0, b = 0, r2 = 0, g2 = 0, b2 = 0;
    let haut = 0;
    pile[haut++] = depart; comp[depart] = id;
    const visiter = (q) => { if (!comp[q] && etiquette[q] === e) { comp[q] = id; pile[haut++] = q; } };
    while (haut) {
      const p = pile[--haut];
      const x = p % W, y = (p - x) / W;
      a++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      const pr = rgb[p * 3], pg = rgb[p * 3 + 1], pb = rgb[p * 3 + 2];
      r += pr; g += pg; b += pb; r2 += pr * pr; g2 += pg * pg; b2 += pb * pb;
      const gauche = x > 0, droite = x < W - 1, dessus = y > 0, dessous = y < H - 1;
      if (gauche) visiter(p - 1);
      if (droite) visiter(p + 1);
      if (dessus) { visiter(p - W); if (gauche) visiter(p - W - 1); if (droite) visiter(p - W + 1); }
      if (dessous) { visiter(p + W); if (gauche) visiter(p + W - 1); if (droite) visiter(p + W + 1); }
    }
    aire.push(a); bx0.push(x0); by0.push(y0); bx1.push(x1 + 1); by1.push(y1 + 1); grp.push(e);
    cr.push(r); cg.push(g); cb.push(b); cr2.push(r2); cg2.push(g2); cb2.push(b2);
  }

  // Un texte entouré d'une seule composante est posé sur elle : ses pixels lui reviennent,
  // sans compter dans sa couleur, et la case garde sa forme et son épaisseur.
  for (const c of cadres) {
    const compte = new Map();
    let total = 0;
    const voir = (x, y) => {
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      const k = comp[y * W + x];
      if (!k) return;
      total++; compte.set(k, (compte.get(k) || 0) + 1);
    };
    for (let x = c.x0 - 1; x <= c.x1; x++) { voir(x, c.y0 - 1); voir(x, c.y1); }
    for (let y = c.y0; y < c.y1; y++) { voir(c.x0 - 1, y); voir(c.x1, y); }
    let maitre = 0, n = 0;
    for (const [k, v] of compte) if (v > n) { maitre = k; n = v; }
    if (!maitre || n < ENTOURE_PART * total) continue;
    for (let y = c.y0; y < c.y1; y++) for (let x = c.x0; x < c.x1; x++) if (!comp[y * W + x]) comp[y * W + x] = maitre;
  }

  // Fond : la plus grande surface unie ; ce qui a sa couleur est aussi du fond.
  let fondComp = 1;
  for (let c = 2; c <= nComp; c++) if (aire[c] > aire[fondComp]) fondComp = c;
  const fond = nComp ? [cr[fondComp] / aire[fondComp], cg[fondComp] / aire[fondComp], cb[fondComp] / aire[fondComp]].map(Math.round) : [255, 255, 255];
  const grpFond = nComp ? grp[fondComp] : 0;
  // Rôle : 1 candidat objet, 2 fond, 0 trop petit.
  const role = new Uint8Array(nComp + 1);
  for (let c = 1; c <= nComp; c++) role[c] = grp[c] === grpFond ? 2 : aire[c] >= surfaceMin ? 1 : 0;

  // Contacts entre candidats, et entre un candidat et le fond : frontières directes, avec le
  // saut de couleur qui les traverse, et frontières à travers une frange sans groupe. Les
  // pixels de frange qui bordent chaque candidat sont comptés : ils épaississent ses traits.
  const contactsComp = new Map();
  const frange = new Float64Array(nComp + 1);
  const cle = (a, b) => (a < b ? a * (nComp + 1) + b : b * (nComp + 1) + a);
  const noter = (a, b, direct, saut) => {
    const k = cle(a, b);
    let c = contactsComp.get(k);
    if (!c) { c = { a: Math.min(a, b), b: Math.max(a, b), n: 0, direct: 0, petits: 0 }; contactsComp.set(k, c); }
    c.n++; c.direct += direct; c.petits += direct && saut <= SAUT_DEGRADE ? 1 : 0;
  };
  const saut = (p, q) => Math.max(Math.abs(rgb[p * 3] - rgb[q * 3]), Math.abs(rgb[p * 3 + 1] - rgb[q * 3 + 1]), Math.abs(rgb[p * 3 + 2] - rgb[q * 3 + 2]));
  const premier = (p, delta, limite, portee) => {
    for (let k = 1; k <= portee && k <= limite; k++) {
      const c = comp[p + k * delta];
      if (c) return role[c] ? c : 0;
    }
    return 0;
  };
  const bordure = (g, d) => {
    if (g === d) return;
    if (g && d && role[g] === 1 && role[d] === 1) noter(g, d, 0, 0);
    if (g && role[g] === 1) frange[g]++;
    if (d && role[d] === 1) frange[d]++;
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x, cp = comp[p];
      if (cp) {
        if (!role[cp]) continue;
        if (x < W - 1) { const cq = comp[p + 1]; if (cq && cq !== cp && role[cq] && (role[cp] === 1 || role[cq] === 1)) noter(cp, cq, 1, saut(p, p + 1)); }
        if (y < H - 1) { const cq = comp[p + W]; if (cq && cq !== cp && role[cq] && (role[cp] === 1 || role[cq] === 1)) noter(cp, cq, 1, saut(p, p + W)); }
      } else {
        bordure(premier(p, -1, x, FRANGE_MAX), premier(p, 1, W - 1 - x, FRANGE_MAX));
        bordure(premier(p, -W, y, FRANGE_MAX), premier(p, W, H - 1 - y, FRANGE_MAX));
      }
    }
  }

  // Dégradés : les régions qui se continuent fusionnent (union-find) ; une région qui se
  // fond dans le fond est un dégradé à elle seule. La frontière continue doit être une vraie
  // part du pourtour de la plus grande des deux régions : la pointe d'une flèche en dégradé
  // qui touche un cadre de sa couleur n'emporte pas le cadre.
  const parent = new Int32Array(nComp + 1);
  for (let c = 0; c <= nComp; c++) parent[c] = c;
  const racine = (c) => { while (parent[c] !== c) { parent[c] = parent[parent[c]]; c = parent[c]; } return c; };
  const fondu = new Uint8Array(nComp + 1);
  const pourtour = (c) => 2 * (bx1[c] - bx0[c] + by1[c] - by0[c]);
  for (const c of contactsComp.values()) {
    if (!c.direct || c.petits < PART_DEGRADE * c.direct) continue;
    if (role[c.a] === 1 && role[c.b] === 1) {
      if (c.n >= CONTINUITE_MIN * Math.max(pourtour(c.a), pourtour(c.b))) parent[racine(c.a)] = racine(c.b);
    } else {
      const candidat = role[c.a] === 1 ? c.a : c.b;
      if (c.n >= CONTINUITE_MIN * pourtour(candidat)) fondu[candidat] = 1;
    }
  }

  // Transformée de distance (chanfrein 3-4) à l'intérieur de chaque composante.
  const dist = new Uint16Array(N);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x, cp = comp[p];
      if (!cp) continue;
      let v = 65535;
      let w = y > 0 && comp[p - W] === cp ? dist[p - W] + 3 : 3; if (w < v) v = w;
      w = x > 0 && comp[p - 1] === cp ? dist[p - 1] + 3 : 3; if (w < v) v = w;
      w = x > 0 && y > 0 && comp[p - W - 1] === cp ? dist[p - W - 1] + 4 : 4; if (w < v) v = w;
      w = x < W - 1 && y > 0 && comp[p - W + 1] === cp ? dist[p - W + 1] + 4 : 4; if (w < v) v = w;
      dist[p] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const p = y * W + x, cp = comp[p];
      if (!cp) continue;
      let v = dist[p];
      let w = y < H - 1 && comp[p + W] === cp ? dist[p + W] + 3 : 3; if (w < v) v = w;
      w = x < W - 1 && comp[p + 1] === cp ? dist[p + 1] + 3 : 3; if (w < v) v = w;
      w = x < W - 1 && y < H - 1 && comp[p + W + 1] === cp ? dist[p + W + 1] + 4 : 4; if (w < v) v = w;
      w = x > 0 && y < H - 1 && comp[p + W - 1] === cp ? dist[p + W - 1] + 4 : 4; if (w < v) v = w;
      dist[p] = v;
    }
  }

  // Crête de chaque candidat : histogramme des distances (en pixels) des pixels dont aucun
  // voisin de la même composante n'est plus loin du bord.
  const indice = new Int32Array(nComp + 1).fill(-1);
  const candidats = [];
  for (let c = 1; c <= nComp; c++) if (role[c] === 1) { indice[c] = candidats.length; candidats.push(c); }
  const histos = new Uint32Array(candidats.length * 256);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const p = y * W + x, cp = comp[p], i = cp ? indice[cp] : -1;
      if (i < 0) continue;
      const d = dist[p];
      if ((x > 0 && comp[p - 1] === cp && dist[p - 1] > d) || (x < W - 1 && comp[p + 1] === cp && dist[p + 1] > d)
        || (y > 0 && comp[p - W] === cp && dist[p - W] > d) || (y < H - 1 && comp[p + W] === cp && dist[p + W] > d)) continue;
      histos[i * 256 + Math.min(255, Math.round(d / 3))]++;
    }
  }
  const medianeCrete = (i) => {
    let total = 0;
    for (let k = 0; k < 256; k++) total += histos[i * 256 + k];
    let cumul = 0;
    for (let k = 0; k < 256; k++) { cumul += histos[i * 256 + k]; if (cumul * 2 >= total) return k; }
    return 1;
  };

  // Objets : une composante, ou un groupe de composantes qui se continuent (dégradé).
  const parRacine = new Map();
  for (const c of candidats) {
    const r = racine(c);
    if (!parRacine.has(r)) parRacine.set(r, []);
    parRacine.get(r).push(c);
  }
  const objets = [];
  const objetDeComp = new Int32Array(nComp + 1).fill(-1);
  for (const comps of parRacine.values()) {
    let a = 0, boite = null, r = 0, g = 0, b = 0, r2 = 0, g2 = 0, b2 = 0;
    for (const c of comps) {
      a += aire[c]; r += cr[c]; g += cg[c]; b += cb[c]; r2 += cr2[c]; g2 += cg2[c]; b2 += cb2[c];
      const bc = { x0: bx0[c], y0: by0[c], x1: bx1[c], y1: by1[c] };
      boite = boite ? union(boite, bc) : bc;
    }
    const couleur = [r / a, g / a, b / a];
    const ecart = Math.sqrt(Math.max(r2 / a - couleur[0] ** 2, g2 / a - couleur[1] ** 2, b2 / a - couleur[2] ** 2, 0));
    const w = boite.x1 - boite.x0, h = boite.y1 - boite.y0;
    let type, epaisseurPx = null, taux = (a + texteDans(boite)) / (w * h);
    if (comps.length > 1 || ecart > ECART_UNI || comps.some((c) => fondu[c])) {
      type = 'degrade';
    } else {
      const c = comps[0];
      // Pourtour de la boîte occupé par la composante : un cadre.
      let bord = 0;
      for (let x = boite.x0; x < boite.x1; x++) bord += (comp[boite.y0 * W + x] === c) + (comp[(boite.y1 - 1) * W + x] === c);
      for (let y = boite.y0 + 1; y < boite.y1 - 1; y++) bord += (comp[y * W + boite.x0] === c) + (comp[y * W + boite.x1 - 1] === c);
      const cadre = bord / Math.max(1, 2 * (w + h) - 4) >= TAUX_CADRE && taux < TAUX_RECTANGLE;
      const coeur = epaisseurDepuisCrete(medianeCrete(indice[c]));
      // La frange lissée de part et d'autre d'un trait en fait partie, pour moitié.
      const ep = coeur + (COUVERTURE_FRANGE * frange[c]) / (a / coeur);
      const epMm = ep * pas * mmParPx;
      const fin = epMm <= EPAISSEUR_TRAIT_MAX_MM && a / (coeur * coeur) >= FINESSE_TRAIT;
      // Une case percée par le texte qu'elle porte reste une case : sa boîte est pleine,
      // texte compris, et ce n'est pas un trait.
      const casePercee = taux >= TAUX_RECTANGLE && texteDans(boite) > 0;
      if (cadre) {
        type = 'rectangle'; epaisseurPx = ep;
      } else if (fin && !casePercee) {
        type = 'trait'; epaisseurPx = ep;
      } else {
        const dx = Math.max(0, Math.round(w * RETRAIT_COINS)), dy = Math.max(0, Math.round(h * RETRAIT_COINS));
        const coin = (x, y) => comp[y * W + x] === c;
        const coinPlein = coin(boite.x0 + dx, boite.y0 + dy) || coin(boite.x1 - 1 - dx, boite.y0 + dy)
          || coin(boite.x0 + dx, boite.y1 - 1 - dy) || coin(boite.x1 - 1 - dx, boite.y1 - 1 - dy);
        type = typeParTaux(taux, coinPlein);
      }
    }
    for (const c of comps) objetDeComp[c] = objets.length;
    objets.push({
      type, couleur: couleur.map(Math.round), ecart, taux: Math.min(1, taux),
      boite: { x0: boite.x0 * pas, y0: boite.y0 * pas, x1: boite.x1 * pas, y1: boite.y1 * pas },
      aire: a * pas * pas, epaisseurPx: epaisseurPx == null ? null : epaisseurPx * pas, comps,
    });
  }

  // Contacts entre objets, en force : frontière commune rapportée au pourtour du plus petit.
  const contactsObjets = new Map();
  for (const c of contactsComp.values()) {
    const a = objetDeComp[c.a], b = objetDeComp[c.b];
    if (a < 0 || b < 0 || a === b) continue;
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    contactsObjets.set(k, (contactsObjets.get(k) || 0) + c.n);
  }
  const contacts = [];
  for (const [k, nPx] of contactsObjets) {
    const [a, b] = k.split(':').map(Number);
    contacts.push({ a, b, force: (nPx * pas) / Math.min(perimetre(objets[a].boite), perimetre(objets[b].boite)) });
  }

  return { fond, largeur, hauteur, pas, objets, contacts, carte: { comp, largeur: W, hauteur: H, nComp }, exact: false };
}

// ── Voie exacte : géométrie commune ─────────────────────────────────────────────

// Taux de remplissage d'un chemin (Path2D, dans l'espace de `boite`) et coins pleins,
// mesurés sur une rastérisation de 128 px de côté au plus.
function tauxChemin(chemin, boite, regle = 'nonzero') {
  const w = boite.x1 - boite.x0, h = boite.y1 - boite.y0;
  if (!(w > 0) || !(h > 0) || typeof document === 'undefined') return { taux: 1, coinPlein: true };
  const k = RASTER_PX / Math.max(w, h);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w * k)); c.height = Math.max(1, Math.ceil(h * k));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.setTransform(k, 0, 0, k, -boite.x0 * k, -boite.y0 * k);
  ctx.fillStyle = '#000';
  ctx.fill(chemin, regle);
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let pleins = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 127) pleins++;
  const dx = Math.round(c.width * RETRAIT_COINS), dy = Math.round(c.height * RETRAIT_COINS);
  const coin = (x, y) => d[(y * c.width + x) * 4 + 3] > 127;
  const coinPlein = coin(dx, dy) || coin(c.width - 1 - dx, dy) || coin(dx, c.height - 1 - dy) || coin(c.width - 1 - dx, c.height - 1 - dy);
  return { taux: pleins / (c.width * c.height), coinPlein };
}

// Points d'une ligne brisée fermée formant un rectangle droit : 4 sommets (le dernier peut
// répéter le premier), deux voisins partageant toujours un x ou un y.
function estRectangle(points) {
  const p = [...points];
  if (p.length === 5 && Math.abs(p[0][0] - p[4][0]) < 1e-6 && Math.abs(p[0][1] - p[4][1]) < 1e-6) p.pop();
  if (p.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4];
    if (Math.abs(a[0] - b[0]) > 1e-6 && Math.abs(a[1] - b[1]) > 1e-6) return false;
  }
  return true;
}

// Choisit le fond d'une source exacte : le plus grand rectangle couvrant la moitié de la
// figure ; sinon la page, blanche. Le rend et le retire des objets.
function fondExact(objets, largeur, hauteur) {
  let fond = [255, 255, 255];
  const i = objets.findIndex((o) => o.type === 'rectangle' && o.couleur && o.aire >= FOND_COUVERTURE * largeur * hauteur);
  if (i >= 0) { fond = objets[i].couleur; objets.splice(i, 1); }
  return fond;
}

function rognerBoite(b, largeur, hauteur) {
  const r = { x0: Math.max(0, b.x0), y0: Math.max(0, b.y0), x1: Math.min(largeur, b.x1), y1: Math.min(hauteur, b.y1) };
  return r.x1 > r.x0 && r.y1 > r.y0 ? r : null;
}

// ── Voie exacte : SVG ───────────────────────────────────────────────────────────

// Couleur d'une peinture calculée : [r, g, b], { degrade: true } pour un dégradé ou un
// motif, null si rien n'est peint.
function peinture(valeur, opacite) {
  if (!valeur || valeur === 'none' || parseFloat(opacite) < 0.1) return null;
  if (valeur.startsWith('url')) return { degrade: true };
  const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(valeur);
  if (!m) return null;
  if (m[4] !== undefined && parseFloat(m[4]) < 0.1) return null;
  return { rgb: [m[1], m[2], m[3]].map((v) => Math.round(parseFloat(v))) };
}

function cheminSvg(el) {
  const nom = el.nodeName.toLowerCase();
  if (nom === 'path') return new Path2D(el.getAttribute('d') || '');
  const points = (el.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
  const chemin = new Path2D();
  for (let i = 0; i + 1 < points.length; i += 2) (i ? chemin.lineTo(points[i], points[i + 1]) : chemin.moveTo(points[i], points[i + 1]));
  chemin.closePath();
  return chemin;
}

// Lit les formes d'un SVG, inséré caché à la taille du canevas d'analyse : rect, circle,
// ellipse, polygon, polyline, line et path, hors text et hors définitions. Rend la même
// structure qu'objetsBitmap, avec `images`, le nombre d'images incorporées non analysées.
export function objetsSvg(texteSvg, largeur, hauteur) {
  const hote = document.createElement('div');
  // Hors de l'écran, mais visible : les éléments gardent leur propre visibilité calculée.
  hote.style.cssText = 'position:absolute;left:-100000px;top:0;pointer-events:none';
  hote.innerHTML = texteSvg;
  const s = hote.firstElementChild;
  s.setAttribute('width', largeur);
  s.setAttribute('height', hauteur);
  document.body.append(hote);
  const cadre = s.getBoundingClientRect();
  const objets = [];
  let images = 0;
  for (const el of s.querySelectorAll('rect, circle, ellipse, polygon, polyline, line, path, image')) {
    if (el.closest('defs, clipPath, mask, marker, pattern, symbol')) continue;
    const nom = el.nodeName.toLowerCase();
    if (nom === 'image') { images++; continue; }
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.1) continue;
    // Une ligne n'a pas de surface : son remplissage, noir par défaut, ne peint rien.
    const plein = nom === 'line' ? null : peinture(cs.fill, cs.fillOpacity);
    const trait = peinture(cs.stroke, cs.strokeOpacity);
    if (!plein && !trait) continue;
    const m = el.getScreenCTM();
    const echelle = m ? Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) : 1;
    const r = el.getBoundingClientRect();
    let boite = { x0: r.left - cadre.left, y0: r.top - cadre.top, x1: r.right - cadre.left, y1: r.bottom - cadre.top };
    const largeurTrait = trait ? (parseFloat(cs.strokeWidth) || 0) * echelle : 0;
    if (!plein) {
      const demi = largeurTrait / 2;
      boite = { x0: boite.x0 - demi, y0: boite.y0 - demi, x1: boite.x1 + demi, y1: boite.y1 + demi };
    }
    boite = rognerBoite(boite, largeur, hauteur);
    if (!boite) continue;
    const w = boite.x1 - boite.x0, h = boite.y1 - boite.y0;
    let type, aire, couleur, epaisseurPx = null, taux = 1;
    if (!plein) {
      let longueur = 0;
      try { longueur = el.getTotalLength() * echelle; } catch { longueur = Math.hypot(w, h); }
      couleur = trait.degrade ? null : trait.rgb;
      epaisseurPx = largeurTrait;
      aire = Math.max(1, longueur * Math.max(largeurTrait, 1));
      type = nom === 'rect' ? 'rectangle' : nom === 'circle' || nom === 'ellipse' ? 'ellipse' : 'trait';
      taux = aire / (w * h);
    } else {
      couleur = plein.degrade ? null : plein.rgb;
      if (nom === 'rect') { type = 'rectangle'; aire = w * h; }
      else if (nom === 'circle' || nom === 'ellipse') { type = 'ellipse'; aire = (Math.PI / 4) * w * h; taux = Math.PI / 4; }
      else if (nom === 'line') { type = 'trait'; aire = Math.hypot(w, h) * Math.max(largeurTrait, 1); epaisseurPx = largeurTrait; }
      else {
        const bb = el.getBBox();
        const mesure = tauxChemin(cheminSvg(el), { x0: bb.x, y0: bb.y, x1: bb.x + bb.width, y1: bb.y + bb.height }, cs.fillRule === 'evenodd' ? 'evenodd' : 'nonzero');
        taux = mesure.taux;
        type = typeParTaux(mesure.taux, mesure.coinPlein);
        aire = Math.max(1, mesure.taux * w * h);
      }
      if (plein.degrade) type = 'degrade';
    }
    objets.push({ type, couleur, boite, aire, epaisseurPx, taux: Math.min(1, taux), ecart: 0, comps: [] });
  }
  hote.remove();
  const fond = fondExact(objets, largeur, hauteur);
  return { fond, largeur, hauteur, pas: 1, objets, contacts: null, carte: null, exact: true, images };
}

// ── Voie exacte : PDF ───────────────────────────────────────────────────────────

// Produit de deux matrices [a, b, c, d, e, f], m2 appliquée d'abord (comme pdf.js).
function produit(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1], m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3], m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4], m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}
const appliquer = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// Lit les tracés de la première page d'un PDF par la liste de ses opérateurs : tracés
// remplis ou tracés avec leur couleur, leur boîte dans le canevas d'analyse et l'épaisseur
// de leur trait ; les opérateurs de texte et les images sont ignorés, les images comptées.
export async function objetsPdf(page, OPS, largeur, hauteur) {
  const base = page.getViewport({ scale: 1 });
  const vue = page.getViewport({ scale: largeur / base.width });
  const liste = await page.getOperatorList();
  const objets = [];
  let images = 0;
  let etat = { ctm: [1, 0, 0, 1, 0, 0], plein: [0, 0, 0], trait: [0, 0, 0], largeurTrait: 1 };
  const pileEtats = [];
  let chemin = null;

  const nouveauChemin = () => ({ points: [], segments: [], boite: null, longueur: 0, courbes: 0, rectangles: 0, sousChemins: 0, dernier: null });
  const ajouterPoint = (x, y) => {
    const [px, py] = appliquer(produit(vue.transform, etat.ctm), x, y);
    chemin.boite = chemin.boite ? union(chemin.boite, { x0: px, y0: py, x1: px, y1: py }) : { x0: px, y0: py, x1: px, y1: py };
    return [px, py];
  };
  const construire = (ops, args) => {
    chemin ??= nouveauChemin();
    let j = 0, x = chemin.dernier?.[0] ?? 0, y = chemin.dernier?.[1] ?? 0;
    for (const op of ops) {
      switch (op) {
        case OPS.rectangle: {
          const rx = args[j++], ry = args[j++], rw = args[j++], rh = args[j++];
          const coins = [[rx, ry], [rx + rw, ry], [rx + rw, ry + rh], [rx, ry + rh]].map(([a, b]) => ajouterPoint(a, b));
          chemin.points.push(...coins, coins[0]);
          chemin.segments.push(['M', coins[0]], ['L', coins[1]], ['L', coins[2]], ['L', coins[3]], ['Z']);
          chemin.longueur += 2 * (Math.hypot(coins[1][0] - coins[0][0], coins[1][1] - coins[0][1]) + Math.hypot(coins[2][0] - coins[1][0], coins[2][1] - coins[1][1]));
          chemin.rectangles++; chemin.sousChemins++;
          x = rx; y = ry;
          break;
        }
        case OPS.moveTo: {
          x = args[j++]; y = args[j++];
          const p = ajouterPoint(x, y);
          chemin.points.push(p); chemin.segments.push(['M', p]); chemin.sousChemins++;
          break;
        }
        case OPS.lineTo: {
          const avant = chemin.points.at(-1);
          x = args[j++]; y = args[j++];
          const p = ajouterPoint(x, y);
          if (avant) chemin.longueur += Math.hypot(p[0] - avant[0], p[1] - avant[1]);
          chemin.points.push(p); chemin.segments.push(['L', p]);
          break;
        }
        case OPS.curveTo: case OPS.curveTo2: case OPS.curveTo3: {
          const avant = chemin.points.at(-1) || ajouterPoint(x, y);
          let c1, c2, fin;
          if (op === OPS.curveTo) { c1 = ajouterPoint(args[j], args[j + 1]); c2 = ajouterPoint(args[j + 2], args[j + 3]); fin = ajouterPoint(args[j + 4], args[j + 5]); x = args[j + 4]; y = args[j + 5]; j += 6; }
          else if (op === OPS.curveTo2) { c1 = avant; c2 = ajouterPoint(args[j], args[j + 1]); fin = ajouterPoint(args[j + 2], args[j + 3]); x = args[j + 2]; y = args[j + 3]; j += 4; }
          else { c1 = ajouterPoint(args[j], args[j + 1]); fin = ajouterPoint(args[j + 2], args[j + 3]); c2 = fin; x = args[j + 2]; y = args[j + 3]; j += 4; }
          // Longueur approchée : moyenne de la corde et du polygone de contrôle.
          const corde = Math.hypot(fin[0] - avant[0], fin[1] - avant[1]);
          const polygone = Math.hypot(c1[0] - avant[0], c1[1] - avant[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(fin[0] - c2[0], fin[1] - c2[1]);
          chemin.longueur += (corde + polygone) / 2;
          chemin.points.push(fin); chemin.segments.push(['C', c1, c2, fin]); chemin.courbes++;
          break;
        }
        case OPS.closePath:
          chemin.segments.push(['Z']);
          if (chemin.points.length > 1) {
            const premier = chemin.points[0], dernier = chemin.points.at(-1);
            chemin.longueur += Math.hypot(dernier[0] - premier[0], dernier[1] - premier[1]);
          }
          break;
        default:
          break;
      }
    }
    chemin.dernier = [x, y];
  };
  const peindre = (remplir) => {
    const c = chemin;
    chemin = null;
    if (!c || !c.boite) return;
    const echelle = Math.sqrt(Math.abs(etat.ctm[0] * etat.ctm[3] - etat.ctm[1] * etat.ctm[2])) * vue.scale;
    let boite = c.boite, couleur, type, aire, epaisseurPx = null, taux = 1;
    const droit = c.rectangles === 1 && c.sousChemins === 1 || (!c.courbes && c.sousChemins === 1 && estRectangle(c.points));
    if (remplir) {
      couleur = etat.plein;
      if (droit) { type = 'rectangle'; aire = aireBoite(boite); }
      else if (c.courbes && c.courbes <= 4 && c.sousChemins === 1 && c.segments.filter((s) => s[0] === 'L').length === 0) { type = 'ellipse'; taux = Math.PI / 4; aire = taux * aireBoite(boite); }
      else {
        const p = typeof Path2D === 'undefined' ? null : new Path2D();
        if (p) for (const s of c.segments) (s[0] === 'M' ? p.moveTo(...s[1]) : s[0] === 'L' ? p.lineTo(...s[1]) : s[0] === 'C' ? p.bezierCurveTo(...s[1], ...s[2], ...s[3]) : p.closePath());
        const mesure = p ? tauxChemin(p, boite, remplir === 'evenodd' ? 'evenodd' : 'nonzero') : { taux: 1, coinPlein: true };
        taux = mesure.taux; type = typeParTaux(mesure.taux, mesure.coinPlein); aire = Math.max(1, taux * aireBoite(boite));
      }
    } else {
      couleur = etat.trait;
      epaisseurPx = etat.largeurTrait * echelle;
      const demi = epaisseurPx / 2;
      boite = { x0: boite.x0 - demi, y0: boite.y0 - demi, x1: boite.x1 + demi, y1: boite.y1 + demi };
      type = droit ? 'rectangle' : c.courbes && !c.segments.some((s) => s[0] === 'L') && c.sousChemins === 1 && c.segments.at(-1)[0] === 'Z' ? 'ellipse' : 'trait';
      aire = Math.max(1, c.longueur * Math.max(epaisseurPx, 1));
      taux = Math.min(1, aire / Math.max(1, aireBoite(boite)));
    }
    boite = rognerBoite(boite, largeur, hauteur);
    if (!boite) return;
    if (couleur === 'motif') { type = 'degrade'; couleur = null; }
    // Le contour d'une surface remplie et tracée n'est pas un objet à part.
    objets.push({ type, couleur, boite, aire: Math.min(aire, aireBoite(boite) || aire), epaisseurPx, taux: Math.min(1, taux), ecart: 0, comps: [] });
  };

  for (let i = 0; i < liste.fnArray.length; i++) {
    const fn = liste.fnArray[i], args = liste.argsArray[i];
    switch (fn) {
      case OPS.save: pileEtats.push({ ...etat }); break;
      case OPS.restore: if (pileEtats.length) etat = pileEtats.pop(); break;
      case OPS.transform: etat.ctm = produit(etat.ctm, args); break;
      case OPS.paintFormXObjectBegin:
        pileEtats.push({ ...etat });
        if (args[0]) etat.ctm = produit(etat.ctm, args[0]);
        break;
      case OPS.paintFormXObjectEnd: if (pileEtats.length) etat = pileEtats.pop(); break;
      case OPS.setLineWidth: etat.largeurTrait = args[0]; break;
      case OPS.setFillRGBColor: etat.plein = [args[0], args[1], args[2]].map(Number); break;
      case OPS.setStrokeRGBColor: etat.trait = [args[0], args[1], args[2]].map(Number); break;
      case OPS.setFillColorN: etat.plein = 'motif'; break;
      case OPS.setStrokeColorN: etat.trait = 'motif'; break;
      case OPS.constructPath: construire(args[0], args[1]); break;
      case OPS.fill: case OPS.closeFillStroke: case OPS.fillStroke: peindre('nonzero'); break;
      case OPS.eoFill: case OPS.eoFillStroke: case OPS.closeEOFillStroke: peindre('evenodd'); break;
      case OPS.stroke: case OPS.closeStroke: peindre(null); break;
      case OPS.endPath: chemin = null; break;
      case OPS.shadingFill: break;
      case OPS.paintImageXObject: case OPS.paintInlineImageXObject: case OPS.paintImageMaskXObject:
      case OPS.paintImageXObjectRepeat: case OPS.paintImageMaskXObjectRepeat: case OPS.paintImageMaskXObjectGroup:
      case OPS.paintInlineImageXObjectGroup: case OPS.paintSolidColorImageMask:
        images++; break;
      default: break;
    }
  }
  const fond = fondExact(objets, largeur, hauteur);
  return { fond, largeur, hauteur, pas: 1, objets, contacts: null, carte: null, exact: true, images };
}

// ── Séries et verdicts ──────────────────────────────────────────────────────────

const groupeType = (type) => (type === 'trait' ? 'trait' : 'surface');

// Degré d'une épaisseur de trait, en points.
export function niveauEpaisseur(pt) {
  if (pt == null) return null;
  const v = Math.round(pt * 100) / 100;
  return v >= EPAISSEUR_AMELIORER_PT ? 'ok' : v >= EPAISSEUR_CORRIGER_PT ? 'ameliorer' : 'corriger';
}

// Rassemble les objets en séries et mesure chacune. `brut` vient d'objetsBitmap, objetsSvg
// ou objetsPdf ; `mmParPx` convertit les pixels du canevas en millimètres imprimés ;
// `boites` : boîtes des textes lus, pour reconnaître une légende et écarter ce qui est un
// texte. Rend { exact, fond, formes, objets, series, paires, niveau, degrades }.
export function analyserObjets(brut, { mmParPx, boites = [] } = {}) {
  const { fond, largeur, hauteur, exact } = brut;
  const aireFigure = largeur * hauteur;
  const surfaceMinPx = SURFACE_MIN_MM2 / (mmParPx * mmParPx);
  const objets = [];
  const indiceDe = new Map();      // indice dans brut.objets → objet retenu
  const labFond = versLab(fond);
  brut.objets.forEach((o, i) => {
    if (o.aire < surfaceMinPx) return;
    // Un objet de la couleur du fond en fait partie (panneau sous un graphique, intérieur
    // d'un cadre).
    if (o.couleur && ciede2000(versLab(o.couleur), labFond) < DELTA_E_SERIE) return;
    // Un objet logé dans un texte lu est le texte (glyphes vectorisés, soulignements).
    if (boites.some((b) => intersection(o.boite, b) >= DANS_TEXTE * aireBoite(o.boite))) return;
    const objet = { ...o, id: objets.length, serie: null, legende: false, surfacePct: (100 * o.aire) / aireFigure };
    indiceDe.set(i, objet);
    // Un rectangle fin et long est un trait : filet tracé comme un rectangle.
    const w = o.boite.x1 - o.boite.x0, h = o.boite.y1 - o.boite.y0;
    if (objet.type === 'rectangle' && objet.epaisseurPx == null && Math.min(w, h) * mmParPx <= EPAISSEUR_TRAIT_MAX_MM && Math.max(w, h) >= ALLONGEMENT_FILET * Math.min(w, h)) {
      objet.type = 'trait';
      objet.epaisseurPx = Math.min(w, h);
    }
    objet.epaisseurMm = objet.epaisseurPx == null ? null : objet.epaisseurPx * mmParPx;
    objet.epaisseurPt = objet.epaisseurMm == null ? null : objet.epaisseurMm / MM_PAR_PT;
    objet.contrasteFond = objet.couleur ? contrasteGraphique(objet.couleur, fond) : null;
    objets.push(objet);
  });

  // Séries : objets colorés, hors dégradés, de la même couleur, les plus grands d'abord.
  let series = [];
  for (const o of [...objets].filter((o) => o.type !== 'degrade' && o.couleur).sort((a, b) => b.aire - a.aire)) {
    const lab = versLab(o.couleur);
    let meilleure = null, d = DELTA_E_SERIE;
    for (const s of series) {
      const e = ciede2000(lab, s.lab);
      if (e < d) { d = e; meilleure = s; }
    }
    if (!meilleure) { meilleure = { lab, couleur: o.couleur, objets: [] }; series.push(meilleure); }
    meilleure.objets.push(o);
  }

  // Texture : les petites formes disparates d'une même couleur sont des taches, pas des objets.
  const textureMaxPx = TEXTURE_MM2 / (mmParPx * mmParPx);
  for (const s of series) {
    const petites = s.objets.filter((o) => o.type === 'forme' && o.aire < textureMaxPx);
    if (petites.length < TEXTURE_MIN) continue;
    const moyenne = petites.reduce((a, o) => a + o.aire, 0) / petites.length;
    const ecartType = Math.sqrt(petites.reduce((a, o) => a + (o.aire - moyenne) ** 2, 0) / petites.length);
    if (ecartType > TEXTURE_DISPARITE * moyenne) {
      for (const o of petites) o.type = 'degrade';
      s.objets = s.objets.filter((o) => o.type !== 'degrade');
    }
  }
  series = series.filter((s) => s.objets.length);

  for (const s of series) {
    // Légende d'une série de surfaces : une petite case, haute comme le texte à côté d'elle.
    const aireMax = Math.max(...s.objets.map((o) => o.aire));
    const surfaces = s.objets.filter((o) => o.type !== 'trait').length;
    if (s.objets.length >= 2 && surfaces > s.objets.length - surfaces) {
      for (const o of s.objets) {
        const w = o.boite.x1 - o.boite.x0, h = o.boite.y1 - o.boite.y0;
        if (!['rectangle', 'ellipse'].includes(o.type) || o.aire > LEGENDE_PART * aireMax || Math.max(w, h) > LEGENDE_ALLONGEMENT * Math.min(w, h)) continue;
        // Le texte suit la case, à sa droite.
        const texteProche = boites.some((b) => {
          const hb = b.y1 - b.y0;
          const recouvrement = Math.min(o.boite.y1, b.y1) - Math.max(o.boite.y0, b.y0);
          const ecart = b.x0 - o.boite.x1;
          return h >= hb / LEGENDE_HAUTEUR && h <= hb * LEGENDE_HAUTEUR && recouvrement >= 0.5 * Math.min(h, hb) && ecart >= 0 && ecart <= LEGENDE_DISTANCE * w;
        });
        if (texteProche) o.legende = true;
      }
      if (s.objets.every((o) => o.legende)) s.objets.forEach((o) => { o.legende = false; });
    }
    s.legende = s.objets.some((o) => o.legende);
    const comptes = s.objets.filter((o) => !o.legende);
    s.nObjets = comptes.length;
    s.aire = s.objets.reduce((a, o) => a + o.aire, 0);
    s.part = s.aire / aireFigure;
    const parType = {};
    for (const o of comptes) parType[o.type] = (parType[o.type] || 0) + 1;
    s.types = parType;
    s.typeDominant = Object.keys(parType).sort((a, b) => parType[b] - parType[a])[0];
    s.groupe = groupeType(s.typeDominant);

    // Quadrillage : traits parallèles réguliers et longs. Les tronçons d'une même ligne,
    // coupée par les barres qui la recouvrent, sont réunis par leur position.
    s.quadrillage = false;
    // Le cadre du graphique, rectangle vide de la même couleur, et les bouts de ligne coupés
    // par les barres font partie du quadrillage ; un dixième d'autres objets est toléré.
    const filets = comptes.filter((o) => o.type === 'trait' || (o.type === 'rectangle'
      && (o.epaisseurPx != null || Math.min(o.boite.x1 - o.boite.x0, o.boite.y1 - o.boite.y0) * mmParPx <= EPAISSEUR_TRAIT_MAX_MM)));
    if (s.typeDominant === 'trait' && filets.length >= QUADRILLAGE_PART * comptes.length && comptes.length >= QUADRILLAGE_MIN) {
      const traits = comptes.filter((o) => o.type === 'trait');
      const horizontaux = traits.filter((o) => o.boite.x1 - o.boite.x0 >= ALLONGEMENT_TRAIT * (o.boite.y1 - o.boite.y0));
      const verticaux = traits.filter((o) => o.boite.y1 - o.boite.y0 >= ALLONGEMENT_TRAIT * (o.boite.x1 - o.boite.x0));
      // Lignes : tronçons dont les positions se recouvrent en travers ; étendue de chacune.
      const lignes = (groupe, travers, long) => {
        const liste = [];
        for (const o of [...groupe].sort((a, b) => a.boite[travers[0]] - b.boite[travers[0]])) {
          const l = liste.at(-1);
          if (l && o.boite[travers[0]] <= l.fin) { l.fin = Math.max(l.fin, o.boite[travers[1]]); l.debut = Math.min(l.debut, o.boite[long[0]]); l.bout = Math.max(l.bout, o.boite[long[1]]); }
          else liste.push({ fin: o.boite[travers[1]], debut: o.boite[long[0]], bout: o.boite[long[1]] });
        }
        return liste.map((l) => l.bout - l.debut);
      };
      const regulier = (longueurs, etendue) => {
        if (!longueurs.length) return true;
        const m = mediane(longueurs);
        return m >= QUADRILLAGE_LONGUEUR * etendue && longueurs.every((l) => Math.abs(l - m) <= QUADRILLAGE_TOLERANCE * m);
      };
      const lh = lignes(horizontaux, ['y0', 'y1'], ['x0', 'x1']), lv = lignes(verticaux, ['x0', 'x1'], ['y0', 'y1']);
      s.quadrillage = horizontaux.length + verticaux.length >= QUADRILLAGE_PART * traits.length
        && Math.max(lh.length, lv.length) >= QUADRILLAGE_MIN && regulier(lh, largeur) && regulier(lv, hauteur);
    }

    s.contrasteFond = contrasteGraphique(s.couleur, fond);
    // Trait le plus fin : parmi les traits d'au moins un cinquième de la longueur du plus
    // long, pour ne pas juger un tronçon rogné par une barre ou une graduation.
    const traits = s.objets.filter((o) => o.epaisseurMm != null && o.epaisseurPx > 0);
    const longueurMax = Math.max(0, ...traits.map((o) => o.aire / o.epaisseurPx));
    const epaisseurs = s.objets.filter((o) => o.epaisseurMm != null && (o.epaisseurPx === 0 || o.aire / o.epaisseurPx >= TRONCON_MIN * longueurMax)).map((o) => o.epaisseurMm);
    s.epaisseurMinMm = epaisseurs.length ? Math.min(...epaisseurs) : null;
    s.epaisseurMinPt = s.epaisseurMinMm == null ? null : s.epaisseurMinMm / MM_PAR_PT;
    s.niveauEpaisseur = niveauEpaisseur(s.epaisseurMinPt);
    s.voisins = [];
  }

  // Les surfaces d'abord, les plus grandes en tête, puis les traits.
  series.sort((a, b) => (a.groupe === b.groupe ? b.aire - a.aire : a.groupe === 'surface' ? -1 : 1));
  series.forEach((s, i) => { s.id = i + 1; s.objets.forEach((o) => { o.serie = s.id; }); });

  // Contacts : mesurés sur les pixels, ou, pour une source exacte, boîtes de deux surfaces
  // qui se touchent.
  let contacts = brut.contacts;
  if (!contacts) {
    contacts = [];
    const surfaces = objets.filter((o) => o.serie != null && o.type !== 'trait');
    for (let i = 0; i < surfaces.length; i++) {
      for (let j = i + 1; j < surfaces.length; j++) {
        const a = surfaces[i].boite, b = surfaces[j].boite;
        if (a.x0 <= b.x1 + 1 && b.x0 <= a.x1 + 1 && a.y0 <= b.y1 + 1 && b.y0 <= a.y1 + 1) contacts.push({ a: surfaces[i].id, b: surfaces[j].id, force: 1 });
      }
    }
  } else {
    contacts = contacts.map((c) => ({ a: indiceDe.get(c.a)?.id, b: indiceDe.get(c.b)?.id, force: c.force })).filter((c) => c.a != null && c.b != null);
  }
  // Seules deux surfaces qui se touchent sont jugées l'une contre l'autre : un axe ou un
  // quadrillage qui passe sous une barre n'en est pas une couleur voisine.
  for (const c of contacts) {
    if (c.force < CONTACT_MIN || objets[c.a].type === 'trait' || objets[c.b].type === 'trait') continue;
    const sa = objets[c.a].serie, sb = objets[c.b].serie;
    if (sa == null || sb == null || sa === sb) continue;
    const A = series[sa - 1], B = series[sb - 1];
    const k = contrasteGraphique(A.couleur, B.couleur);
    for (const [de, vers] of [[A, B], [B, A]]) {
      if (!de.voisins.some((v) => v.serie === vers.id)) de.voisins.push({ serie: vers.id, ...k, force: c.force });
    }
  }

  // Un quadrillage est décoratif : ni son contraste ni son épaisseur ne sont jugés.
  for (const s of series) {
    s.voisins.sort((a, b) => a.lc - b.lc);
    s.niveau = s.quadrillage ? 'ok' : pire(s.contrasteFond.niveau, ...s.voisins.map((v) => v.niveau), s.niveauEpaisseur || 'ok');
    for (const o of s.objets) o.niveau = s.quadrillage ? 'ok' : pire(o.contrasteFond.niveau, niveauEpaisseur(o.epaisseurPt) || 'ok');
  }

  // Paires de séries de même nature, assez grandes pour compter, difficiles à distinguer.
  const paires = [];
  for (let i = 0; i < series.length; i++) {
    for (let j = i + 1; j < series.length; j++) {
      const A = series[i], B = series[j];
      if (A.groupe !== B.groupe || A.quadrillage || B.quadrillage || A.part < FORMES_PART_MIN || B.part < FORMES_PART_MIN) continue;
      const ecarts = ecartsPaire(A.couleur, B.couleur);
      const verdict = verdictPaire(ecarts);
      if (verdict.niveau !== 'ok') paires.push({ a: A, b: B, ecarts, ...verdict });
    }
  }
  paires.sort((p, q) => p.min - q.min);

  const degrades = objets.filter((o) => o.type === 'degrade').length;
  const aireSeries = series.reduce((a, s) => a + s.aire, 0);
  const aireDegrades = objets.filter((o) => o.type === 'degrade').reduce((a, o) => a + o.aire, 0);
  const formes = aireSeries >= FORMES_PART_MIN * aireFigure && aireSeries >= COUVERTURE_NETTE * (aireSeries + aireDegrades);
  const niveau = formes ? pire(...series.map((s) => s.niveau), ...paires.map((p) => p.niveau)) : 'ok';
  return { exact: Boolean(exact), fond, formes, objets, series, paires, niveau, degrades, images: brut.images || 0, largeur, hauteur };
}

// ── Bloc du rapport ─────────────────────────────────────────────────────────────

const SYMBOLES = { corriger: '✕', ameliorer: '!', ok: '✓' };
// Couleurs des contours superposés à la figure, une par série, répétées au-delà de huit.
export const PALETTE_CONTOURS = ['#0b5cad', '#e6007e', '#008b8b', '#ff7f00', '#6a0dad', '#2e8b57', '#b22222', '#8b5a2b'];

const cache = new WeakMap();   // lecture → { largeurMm, brut, promesse, erreur }
let appel = null;              // dernier appel à rendreObjets, rejoué quand la détection finit
let dernier = null;            // { analyse, echelle } du dernier bloc rendu

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

const boitesTextes = (lecture) => lecture.lignes.flatMap((l) => l.mots || [l.bbox]);

// Détecte les objets selon la source : SVG et PDF exacts, image approchée ; un SVG ou un
// PDF qui n'est qu'une image incorporée passe par la voie approchée. Une image est lue à sa
// résolution d'origine, sans le flou de son agrandissement sur le canevas d'analyse ; le
// résultat est ramené en pixels du canevas.
async function detecter(lecture, source, mmParPx) {
  const c = lecture.canevas;
  let brut = null;
  if (source.type === 'svg' && source.svgSource) brut = objetsSvg(source.svgSource, c.width, c.height);
  else if (source.type === 'pdf' && source.pdfPage) brut = await objetsPdf(source.pdfPage, source.pdfOps, c.width, c.height);
  if (brut && !brut.objets.length && brut.images) brut = null;
  if (!brut) {
    await new Promise((ok) => setTimeout(ok));     // laisse la page se dessiner
    const natif = source.type === 'bitmap' && source.pixels ? await source.dessiner(source.pixels.l) : c;
    const facteur = c.width / natif.width;
    const rgba = natif.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, natif.width, natif.height).data;
    const boites = boitesTextes(lecture).map((b) => ({ x0: b.x0 / facteur, y0: b.y0 / facteur, x1: b.x1 / facteur, y1: b.y1 / facteur }));
    brut = objetsBitmap(rgba, natif.width, natif.height, { boites, mmParPx: mmParPx * facteur });
    if (facteur !== 1) {
      brut.largeur = c.width; brut.hauteur = c.height;
      for (const o of brut.objets) {
        o.boite = { x0: o.boite.x0 * facteur, y0: o.boite.y0 * facteur, x1: o.boite.x1 * facteur, y1: o.boite.y1 * facteur };
        o.aire *= facteur * facteur;
        if (o.epaisseurPx != null) o.epaisseurPx *= facteur;
      }
    }
  }
  return brut;
}

// Calque des contours : pixels de bord des objets d'une série, à la couleur de la série,
// sur un halo blanc ; pour une source exacte, la boîte de chaque objet.
function calqueContours(analyse, brut) {
  const c = document.createElement('canvas');
  const couleurDe = (s) => PALETTE_CONTOURS[(s - 1) % PALETTE_CONTOURS.length];
  if (brut.carte) {
    const { comp, largeur: W, hauteur: H, nComp } = brut.carte;
    c.width = W; c.height = H;
    const serieDeComp = new Int16Array(nComp + 1).fill(-1);
    for (const o of analyse.objets) if (o.serie != null) for (const k of o.comps) serieDeComp[k] = o.serie;
    const contours = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const p = y * W + x, cp = comp[p];
        if (!cp || serieDeComp[cp] < 0) continue;
        if ((x > 0 && comp[p - 1] !== cp) || (x < W - 1 && comp[p + 1] !== cp) || (y > 0 && comp[p - W] !== cp) || (y < H - 1 && comp[p + W] !== cp)) contours.push(p);
      }
    }
    const image = new ImageData(W, H);
    const d = image.data;
    const rayon = Math.max(1, Math.round(W / 700));
    const peindre = (r, teinte) => {
      for (const p of contours) {
        const x = p % W, y = (p - x) / W;
        const [cr, cg, cb] = teinte(serieDeComp[comp[p]]);
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const q = (yy * W + xx) * 4;
            d[q] = cr; d[q + 1] = cg; d[q + 2] = cb; d[q + 3] = 255;
          }
        }
      }
    };
    peindre(rayon + 1, () => [255, 255, 255]);
    const rvb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    peindre(rayon, (s) => rvb(couleurDe(s)));
    c.getContext('2d').putImageData(image, 0, 0);
  } else {
    c.width = brut.largeur; c.height = brut.hauteur;
    const ctx = c.getContext('2d');
    const epaisseur = Math.max(2, Math.round(brut.largeur / 500));
    for (const o of analyse.objets) {
      if (o.serie == null) continue;
      const { x0, y0, x1, y1 } = o.boite;
      for (const [couleur, e] of [['#fff', epaisseur + 2], [couleurDe(o.serie), epaisseur]]) {
        ctx.strokeStyle = couleur; ctx.lineWidth = e;
        ctx.strokeRect(x0 - 1, y0 - 1, x1 - x0 + 2, y1 - y0 + 2);
      }
    }
  }
  c.className = 'ob-calque';
  return c;
}

// Remplit `conteneur` avec le bloc « Objets du graphique » ; le vide sans lecture.
// `largeurMm` est la largeur imprimée de la figure.
export function rendreObjets(conteneur, lecture, source, largeurMm, langue) {
  appel = { conteneur, lecture, source, largeurMm, langue };
  if (!lecture) {
    conteneur.replaceChildren();
    dernier = null;
    return;
  }
  const t = (cle, valeurs) => T(langue, cle, valeurs);
  const mmParPx = largeurMm / lecture.canevas.width;
  let entree = cache.get(lecture);
  if (!entree || Math.abs(entree.largeurMm - largeurMm) > 0.01 * largeurMm) {
    entree = { largeurMm, brut: null, erreur: null, duree: 0 };
    cache.set(lecture, entree);
    const debut = performance.now();
    entree.promesse = detecter(lecture, source, mmParPx)
      .then((brut) => { entree.brut = brut; entree.duree = performance.now() - debut; }, (e) => { entree.erreur = e; console.error(e); })
      .then(() => { if (appel && appel.lecture === lecture && cache.get(lecture) === entree) rendreObjets(appel.conteneur, appel.lecture, appel.source, appel.largeurMm, appel.langue); });
  }
  const titre = element('h4', {}, t('objetsTitre'));
  if (!entree.brut) {
    conteneur.replaceChildren(element('section', { class: 'ob' }, titre,
      element('p', { class: 'discret' }, t(entree.erreur ? 'objetsErreur' : 'objetsEnCours'))));
    return;
  }
  const analyse = analyserObjets(entree.brut, { mmParPx, boites: boitesTextes(lecture) });
  dernier = { analyse, echelle: (source.naturel ? source.naturel.l : lecture.canevas.width) / lecture.canevas.width, duree: entree.duree };

  const badge = (niveau) => element('span', { class: `badge ${niveau}` },
    element('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES[niveau]), ' ', t(`niveau_${niveau}`));
  const pastille = (rgb, classe = '') => element('span', { class: `ob-pastille ${classe}`, style: { background: versHex(rgb) }, title: versHex(rgb) });
  const contour = (serie) => element('span', { class: 'ob-contour', style: { borderColor: PALETTE_CONTOURS[(serie - 1) % PALETTE_CONTOURS.length] }, title: t('objetsContourTitre', { n: serie }) });
  const wcag = (v) => nombre(Math.floor(v * 10) / 10);
  const pt = (v) => nombre(Math.round(v * 100) / 100, 2);
  const mm = (v) => nombre(Math.round(v * 100) / 100, 2);
  const nomType = (type, n) => t(`objetsType_${type}`, { n });

  const methode = element('p', { class: 'discret' }, `${t(analyse.exact ? 'objetsExact' : 'objetsApproche')}${analyse.images ? ` ${t('objetsImages', { n: analyse.images })}` : ''}`);

  if (!analyse.formes) {
    conteneur.replaceChildren(element('section', { class: 'ob' }, titre,
      element('div', { class: 'bilan inconnu' }, element('p', { class: 'bilan-titre' }, t('objetsAucune')),
        element('p', {}, t(analyse.degrades ? 'objetsAucuneDegrade' : 'objetsAucuneExplication'))),
      methode));
    return;
  }

  const nSurfaces = analyse.series.filter((s) => s.groupe === 'surface').length;
  const nTraits = analyse.series.length - nSurfaces;
  const bilan = element('div', { class: `bilan ${analyse.niveau}` },
    element('p', { class: 'bilan-titre' }, element('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES[analyse.niveau]), ' ', t(`objetsBilan_${analyse.niveau}`)),
    element('p', {}, [t('objetsIntro', { n: analyse.objets.filter((o) => o.serie != null).length, surfaces: nSurfaces, traits: nTraits }),
      analyse.degrades ? t('objetsDegrades', { n: analyse.degrades }) : null].filter(Boolean).join(' ')));

  // Figure et calque des contours, avec son interrupteur.
  const calque = calqueContours(analyse, entree.brut);
  const interrupteur = element('input', { type: 'checkbox', checked: '' });
  interrupteur.addEventListener('change', () => { calque.hidden = !interrupteur.checked; });
  const figure = element('div', { class: 'ob-figure' },
    element('div', { class: 'ob-image' }, element('img', { src: source.url, alt: '' }), calque),
    element('label', { class: 'ob-interrupteur' }, interrupteur, ' ', t('objetsContours')));

  const fond = element('p', { class: 'ob-fond' }, pastille(analyse.fond, 'petite'), ' ', t('objetsFond', { hex: versHex(analyse.fond) }));

  const series = element('ul', { class: 'ob-series' }, ...analyse.series.map((s) => {
    const k = s.contrasteFond;
    const mesures = [];
    const ligne = (libelle, valeur, niveau) => element('div', { class: 'ob-mesure' }, element('dt', {}, libelle), element('dd', { class: niveau || '' }, valeur, niveau && niveau !== 'ok' ? badge(niveau) : null));
    mesures.push(ligne(t('objetsContrasteFond'), s.quadrillage
      ? `${wcag(k.wcag)} : 1, Lc ${Math.round(k.lc)}. ${t('objetsQuadrillage')}`
      : t('objetsContrasteValeurs', { wcag: wcag(k.wcag), min: WCAG_GRAPHIQUE, lc: Math.round(k.lc), lcmin: LC_GRAPHIQUE }), s.quadrillage ? null : k.niveau));
    for (const v of s.voisins) {
      mesures.push(ligne(t('objetsContrasteVoisin', { n: v.serie }), t('objetsContrasteValeurs', { wcag: wcag(v.wcag), min: WCAG_GRAPHIQUE, lc: Math.round(v.lc), lcmin: LC_GRAPHIQUE }), v.niveau));
    }
    if (s.epaisseurMinMm != null) {
      mesures.push(ligne(t('objetsEpaisseur'), t('objetsEpaisseurValeur', { pt: pt(s.epaisseurMinPt), mm: mm(s.epaisseurMinMm), min: nombre(EPAISSEUR_AMELIORER_PT) }), s.niveauEpaisseur));
    }
    const conseils = [];
    if (!s.quadrillage && k.niveau !== 'ok') {
      const teinte = teinteConforme(s.couleur, analyse.fond);
      if (s.groupe === 'trait') conseils.push(element('li', {}, t('objetsConseilTrait')));
      if (teinte) {
        const [avant, apres] = t('objetsConseilTeinte', { hex: '\u0000' }).split('\u0000');
        conseils.push(element('li', {}, avant, element('b', {}, versHex(teinte)), ' ', pastille(teinte, 'petite'), apres, s.groupe === 'surface' ? ` ${t('objetsConseilContour')}` : null));
      } else {
        conseils.push(element('li', {}, t('objetsConseilFond')));
      }
    }
    if (s.voisins.some((v) => v.niveau !== 'ok')) conseils.push(element('li', {}, t('objetsConseilVoisin')));
    if (s.niveauEpaisseur && s.niveauEpaisseur !== 'ok') conseils.push(element('li', {}, t('objetsConseilEpaisseur', { pt: nombre(EPAISSEUR_AMELIORER_PT) })));
    const types = Object.entries(s.types).sort((a, b) => b[1] - a[1]).map(([type, n]) => nomType(type, n)).join(', ');
    return element('li', { class: `ob-serie ${s.niveau}` },
      element('div', { class: 'ob-tete' }, pastille(s.couleur), contour(s.id),
        element('span', { class: 'ob-nom' }, element('b', {}, t('objetsSerie', { n: s.id })), ' ', element('span', { class: 'discret' }, versHex(s.couleur)), element('br'),
          `${types}${s.legende ? `, ${t('objetsLegende')}` : ''}`),
        badge(s.niveau)),
      element('dl', {}, ...mesures),
      ...(conseils.length ? [element('p', { class: 'que-faire' }, element('b', {}, t('queFaire'))), element('ul', {}, ...conseils)] : []));
  }));

  const blocs = [titre, methode, bilan, figure, fond, series];
  if (analyse.paires.length) {
    blocs.push(element('h5', {}, t('objetsPairesTitre', { n: analyse.paires.length })));
    blocs.push(element('ul', { class: 'ob-paires' }, ...analyse.paires.slice(0, PAIRES_MAX).map((p) => {
      const visions = p.visions.map((v) => element('li', {},
        element('span', { class: 'ob-duo' }, pastille(simuler(p.a.couleur, v)), pastille(simuler(p.b.couleur, v))),
        element('span', {}, element('b', {}, t(`objetsVision_${v}`)), ' ',
          t(p.ecarts[v] < DELTA_E_CONFONDU ? 'objetsConfondues' : 'objetsProches'),
          ' ', element('span', { class: 'discret' }, t('objetsEcart', { e: Math.round(p.ecarts[v]), min: DELTA_E_DISTINCT })))));
      const conseils = [];
      if (p.visions.includes('normale')) conseils.push(t('objetsConseilNormale'));
      if (p.visions.includes('gris')) conseils.push(t('objetsConseilClarte'));
      conseils.push(t(p.a.groupe === 'trait' ? 'objetsConseilMotifTrait' : 'objetsConseilMotif'));
      return element('li', { class: `ob-paire ${p.niveau}` },
        element('div', { class: 'ob-tete' }, element('span', { class: 'ob-duo' }, pastille(p.a.couleur), pastille(p.b.couleur)),
          element('b', {}, `${t('objetsSerie', { n: p.a.id })} / ${t('objetsSerie', { n: p.b.id })}`), badge(p.niveau)),
        element('ul', { class: 'ob-visions' }, ...visions),
        element('p', { class: 'que-faire' }, element('b', {}, t('queFaire'))),
        element('ul', {}, ...conseils.map((c) => element('li', {}, c))));
    })));
    if (analyse.paires.length > PAIRES_MAX) blocs.push(element('p', { class: 'discret' }, t('objetsPairesReste', { n: analyse.paires.length - PAIRES_MAX })));
  } else if (analyse.series.length > 1) {
    blocs.push(element('p', {}, t('objetsPairesOk')));
  }
  const decimal = (v) => String(v).replace('.', ',');
  blocs.push(element('p', { class: 'discret' }, t('objetsNote', {
    min: WCAG_GRAPHIQUE, lc: LC_GRAPHIQUE, distinct: DELTA_E_DISTINCT, confondu: DELTA_E_CONFONDU,
    ameliorer: decimal(EPAISSEUR_AMELIORER_PT), corriger: decimal(EPAISSEUR_CORRIGER_PT), surface: decimal(SURFACE_MIN_MM2),
  })));
  conteneur.replaceChildren(element('section', { class: 'ob' }, ...blocs));
}

// Dernier résultat rendu, prêt pour l'export : boîtes en pixels de l'image d'origine (px
// CSS de la page pour un SVG ou un PDF), surfaces en pour cent de la figure, épaisseurs en
// millimètres imprimés. null tant qu'aucune analyse n'est faite.
export function exporterObjets() {
  if (!dernier) return null;
  const { analyse, echelle, duree } = dernier;
  const arrondi = (v, d = 1) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
  const boite = (b) => ({ x0: Math.round(b.x0 * echelle), y0: Math.round(b.y0 * echelle), x1: Math.round(b.x1 * echelle), y1: Math.round(b.y1 * echelle) });
  return {
    exact: analyse.exact,
    formes: analyse.formes,
    fond: versHex(analyse.fond),
    dureeMs: Math.round(duree),
    objets: analyse.objets.map((o) => ({
      id: o.id, type: o.type, couleur: o.couleur ? versHex(o.couleur) : null, boite: boite(o.boite),
      surfacePct: arrondi(o.surfacePct, 2), epaisseurMm: arrondi(o.epaisseurMm, 3), serie: o.serie,
      lcFond: o.contrasteFond ? arrondi(o.contrasteFond.lc, 0) : null, wcagFond: o.contrasteFond ? arrondi(o.contrasteFond.wcag, 2) : null,
      niveau: o.niveau || null,
    })),
    series: analyse.series.map((s) => ({
      id: s.id, couleur: versHex(s.couleur), nObjets: s.nObjets, typeDominant: s.typeDominant,
      lcFond: arrondi(s.contrasteFond.lc, 0), wcagFond: arrondi(s.contrasteFond.wcag, 2),
      epaisseurMinMm: arrondi(s.epaisseurMinMm, 3), niveau: s.niveau, legende: s.legende,
    })),
  };
}

// Ce que l'outil montre plutôt que de deviner : statut de chaque texte lu, mesure d'une
// zone sans la lire (profil d'encre), zones d'encre qui restent une fois les textes connus
// masqués, passage aux coordonnées de l'image d'origine et export de la lecture.
// Rien ici ne touche au DOM.

import { seuilOtsu, mediane, RATIO_X, RATIO_CAPITALE, BRUIT_FOND_MAX, recouvrement } from './analyse.js?v=25c40bd6e2';

// ── Statut d'un texte ───────────────────────────────────────────────────────────

// confirme : lu avec assurance, compte dans le verdict. a-verifier : lu, mais douteux ;
// montré, demandé, jamais compté. ajoute : posé par l'humain, compte. retire : écarté par
// l'humain ; absent de la figure et des comptes, gardé dans l'export.
export const STATUTS = ['confirme', 'a-verifier', 'ajoute', 'retire'];
export const ORIGINES = ['ocr', 'fichier', 'suggestion', 'humain'];

// Un texte de l'OCR est à vérifier si sa confiance moyenne est sous CONFIANCE_SURE, s'il a
// SIGNES_PEU lettres ou chiffres au plus, si son fond est bruité (bruitFond au-delà de
// BRUIT_FOND_MAX, comme sur une photo) ou s'il n'a été trouvé que sur l'image tournée.
export const CONFIANCE_SURE = 80;
export const SIGNES_PEU = 2;

export function compteSignes(texte) {
  return (String(texte || '').match(/[\p{L}\p{N}]/gu) || []).length;
}

// `ligne` : { origine, texte, confiance, bruit, vertical }.
export function statutInitial(ligne) {
  if (ligne.origine === 'fichier') return 'confirme';
  if (ligne.origine === 'suggestion') return 'a-verifier';
  if (ligne.confiance != null && ligne.confiance < CONFIANCE_SURE) return 'a-verifier';
  if (compteSignes(ligne.texte) <= SIGNES_PEU) return 'a-verifier';
  if (ligne.bruit != null && ligne.bruit > BRUIT_FOND_MAX) return 'a-verifier';
  if (ligne.vertical) return 'a-verifier';
  return 'confirme';
}

// Seuls les textes confirmés et ajoutés décident du verdict.
export function compte(statut) {
  return statut === 'confirme' || statut === 'ajoute';
}

// Les statuts visibles sur la figure : tout sauf les textes retirés.
export function visible(statut) {
  return statut !== 'retire';
}

// ── Profil d'encre ──────────────────────────────────────────────────────────────

function luma(rgba, p) {
  return 0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2];
}

// Part de pixels d'encre de chaque rangée d'une boîte (ou de chaque colonne, pour un texte
// vertical), de 0 à 1. Otsu partage les pixels de la boîte en deux groupes ; le plus
// nombreux est le fond, l'autre l'encre. Rend null si la boîte est trop petite ou unie.
export function profilEncre(rgba, largeur, hauteur, bbox, { colonnes = false } = {}) {
  const x0 = Math.max(0, Math.floor(bbox.x0)), x1 = Math.min(largeur, Math.ceil(bbox.x1));
  const y0 = Math.max(0, Math.floor(bbox.y0)), y1 = Math.min(hauteur, Math.ceil(bbox.y1));
  const l = x1 - x0, h = y1 - y0;
  if (l < 2 || h < 2) return null;
  const n = l * h;
  const lumas = new Uint8Array(n);
  const histogramme = new Uint32Array(256);
  for (let y = y0, k = 0; y < y1; y++) {
    for (let x = x0; x < x1; x++, k++) {
      const v = Math.min(255, Math.round(luma(rgba, (y * largeur + x) * 4)));
      lumas[k] = v;
      histogramme[v]++;
    }
  }
  const seuil = seuilOtsu(histogramme, n);
  let sombres = 0;
  for (let k = 0; k < n; k++) if (lumas[k] <= seuil) sombres++;
  if (Math.min(sombres, n - sombres) < 4) return null;
  const encreSombre = sombres < n - sombres;
  const profil = new Float32Array(colonnes ? l : h);
  for (let y = 0, k = 0; y < h; y++) {
    for (let x = 0; x < l; x++, k++) {
      const encre = (lumas[k] <= seuil) === encreSombre;
      if (encre) profil[colonnes ? x : y] += 1 / (colonnes ? h : l);
    }
  }
  return profil;
}

// Deux paliers de densité. Une rangée est encrée si elle atteint PALIER_ENCRE fois la
// rangée la plus encrée ; les rangées encrées contiguës forment une bande, une par ligne de
// texte. Dans une bande, une rangée est dense si elle atteint PALIER_DENSE fois la médiane
// des rangées encrées : les hampes et les accents, qui n'ont que quelques traits, restent
// en dessous, les rangées de la hauteur d'x au-dessus. La bande dense donne la hauteur d'x ;
// du haut de la bande encrée au bas de la bande dense, la hauteur de capitale (les
// descendantes, sous la bande dense, n'y entrent pas). Si la bande dense couvre presque
// toute la bande encrée (CAPITALES_SEULES), le texte n'a que des capitales ou des chiffres.
export const PALIER_ENCRE = 0.05;
export const PALIER_DENSE = 0.6;
export const CAPITALES_SEULES = 0.85;
const BANDE_MIN = 3;                     // rangées : en dessous, un filet, pas un texte

// Mesure d'un profil : { hauteurX, hauteurCapitale, corpsPx }, en pixels, ou null.
// Plusieurs bandes (plusieurs lignes dans la zone) : la médiane de leurs mesures.
export function mesurerProfil(profil) {
  if (!profil || !profil.length) return null;
  let max = 0;
  for (const v of profil) max = Math.max(max, v);
  if (!max) return null;
  const seuilEncre = max * PALIER_ENCRE;
  const bandes = [];
  for (let y = 0; y < profil.length; y++) {
    if (profil[y] < seuilEncre) continue;
    const debut = y;
    while (y + 1 < profil.length && profil[y + 1] >= seuilEncre) y++;
    if (y - debut + 1 >= BANDE_MIN) bandes.push([debut, y]);
  }
  const mesures = [];
  for (const [debut, fin] of bandes) {
    const valeurs = [];
    for (let y = debut; y <= fin; y++) valeurs.push(profil[y]);
    const seuilDense = mediane(valeurs) * PALIER_DENSE;
    let premier = -1, dernier = -1;
    for (let y = debut; y <= fin; y++) {
      if (profil[y] < seuilDense) continue;
      if (premier < 0) premier = y;
      dernier = y;
    }
    if (premier < 0) continue;
    const hauteurEncre = fin - debut + 1;
    const hauteurX = dernier - premier + 1;
    const hauteurCapitale = dernier - debut + 1;
    const corpsPx = hauteurX / hauteurEncre >= CAPITALES_SEULES
      ? hauteurCapitale / RATIO_CAPITALE
      : (hauteurX / RATIO_X + hauteurCapitale / RATIO_CAPITALE) / 2;
    mesures.push({ hauteurX, hauteurCapitale, corpsPx });
  }
  if (!mesures.length) return null;
  return {
    hauteurX: mediane(mesures.map((m) => m.hauteurX)),
    hauteurCapitale: mediane(mesures.map((m) => m.hauteurCapitale)),
    corpsPx: mediane(mesures.map((m) => m.corpsPx)),
  };
}

// Une zone nettement plus haute que large porte un texte vertical : le profil se prend
// par colonnes.
export const VERTICAL_DES = 1.8;

export function mesurerZone(rgba, largeur, hauteur, bbox) {
  const vertical = (bbox.y1 - bbox.y0) > VERTICAL_DES * (bbox.x1 - bbox.x0);
  const mesure = mesurerProfil(profilEncre(rgba, largeur, hauteur, bbox, { colonnes: vertical }));
  return mesure ? { ...mesure, vertical } : null;
}

// ── Zones d'encre restantes ─────────────────────────────────────────────────────

// Carte d'encre : un pixel est de l'encre sombre (1) ou claire (2) s'il s'écarte de plus de
// ECART_ENCRE de la moyenne de son voisinage, un carré de 2 × `rayon` + 1 pixels de côté.
// Les deux signes se séparent pour qu'un texte blanc dans une barre sombre ne se soude pas
// à la barre.
export const ECART_ENCRE = 40;

export function carteEncre(rgba, largeur, hauteur, rayon) {
  const L = largeur + 1;
  const integrale = new Float64Array(L * (hauteur + 1));
  const lumas = new Float32Array(largeur * hauteur);
  for (let y = 0; y < hauteur; y++) {
    let ligne = 0;
    for (let x = 0; x < largeur; x++) {
      const v = luma(rgba, (y * largeur + x) * 4);
      lumas[y * largeur + x] = v;
      ligne += v;
      integrale[(y + 1) * L + x + 1] = integrale[y * L + x + 1] + ligne;
    }
  }
  const carte = new Uint8Array(largeur * hauteur);
  for (let y = 0; y < hauteur; y++) {
    const ya = Math.max(0, y - rayon), yb = Math.min(hauteur, y + rayon + 1);
    for (let x = 0; x < largeur; x++) {
      const xa = Math.max(0, x - rayon), xb = Math.min(largeur, x + rayon + 1);
      const somme = integrale[yb * L + xb] - integrale[ya * L + xb] - integrale[yb * L + xa] + integrale[ya * L + xa];
      const moyenne = somme / ((yb - ya) * (xb - xa));
      const d = lumas[y * largeur + x] - moyenne;
      if (d <= -ECART_ENCRE) carte[y * largeur + x] = 1;
      else if (d >= ECART_ENCRE) carte[y * largeur + x] = 2;
    }
  }
  return carte;
}

// Met à 0 la carte dans chaque boîte, élargie de `marge`.
export function masquer(carte, largeur, hauteur, boites, marge = 2) {
  for (const b of boites) {
    const x0 = Math.max(0, Math.floor(b.x0 - marge)), x1 = Math.min(largeur, Math.ceil(b.x1 + marge));
    const y0 = Math.max(0, Math.floor(b.y0 - marge)), y1 = Math.min(hauteur, Math.ceil(b.y1 + marge));
    for (let y = y0; y < y1; y++) carte.fill(0, y * largeur + x0, y * largeur + x1);
  }
  return carte;
}

// Composantes connexes (8 voisins) des pixels de même valeur non nulle :
// [{ x0, y0, x1, y1, n, valeur, luma }], les bornes hautes exclues ; `luma` est la
// clarté moyenne de la composante quand `lumas` est donné, sinon null.
export function composantes(carte, largeur, hauteur, lumas = null) {
  const vu = new Uint8Array(largeur * hauteur);
  const pile = new Int32Array(largeur * hauteur);
  const resultat = [];
  for (let depart = 0; depart < carte.length; depart++) {
    if (!carte[depart] || vu[depart]) continue;
    const valeur = carte[depart];
    let x0 = largeur, y0 = hauteur, x1 = -1, y1 = -1, n = 0, sommet = 0, somme = 0;
    pile[sommet++] = depart;
    vu[depart] = 1;
    while (sommet) {
      const i = pile[--sommet];
      const x = i % largeur, y = (i - x) / largeur;
      n++;
      if (lumas) somme += lumas[i];
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= hauteur) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= largeur) continue;
          const j = yy * largeur + xx;
          if (vu[j] || carte[j] !== valeur) continue;
          vu[j] = 1;
          pile[sommet++] = j;
        }
      }
    }
    resultat.push({ x0, y0, x1: x1 + 1, y1: y1 + 1, n, valeur, luma: lumas ? somme / n : null });
  }
  return resultat;
}

// Clarté de chaque pixel, et clarté du fond de la figure : la médiane de son pourtour.
export function lumasEtFond(rgba, largeur, hauteur) {
  const lumas = new Float32Array(largeur * hauteur);
  for (let i = 0; i < lumas.length; i++) lumas[i] = luma(rgba, i * 4);
  const bord = [];
  for (let x = 0; x < largeur; x++) bord.push(lumas[x], lumas[(hauteur - 1) * largeur + x]);
  for (let y = 1; y < hauteur - 1; y++) bord.push(lumas[y * largeur], lumas[y * largeur + largeur - 1]);
  return { lumas, fond: mediane(bord) };
}

// Forme d'un signe : une composante est un signe possible si sa hauteur est plausible pour
// un texte, si elle n'est pas trop allongée (RAPPORT_MAX : plusieurs lettres soudées, pas un
// filet) et si elle n'est pas pleine (une lettre laisse du fond dans sa boîte ; une barre,
// un carré de légende la remplissent). Seul un trait droit (l, I, 1 sans empattement) la
// remplit, et il reste mince : sa largeur ne dépasse pas TRAIT_MAX fois sa hauteur.
export const RAPPORT_MAX = 8;
export const ENCRE_PLEINE = 0.8;
export const TRAIT_MAX = 0.4;

export function signePossible(c, hMin, hMax) {
  const l = c.x1 - c.x0, h = c.y1 - c.y0;
  if (h < hMin || h > hMax || l < 1) return false;
  if (l / h > RAPPORT_MAX) return false;
  return c.n / (l * h) <= ENCRE_PLEINE || l / h <= TRAIT_MAX;
}

// Aligne les signes en lignes : deux signes de même encre (sombre ou claire) sont sur la
// même ligne si leurs hauteurs se recouvrent d'au moins la moitié de la plus petite, si
// leurs hauteurs sont du même ordre et si l'écart horizontal ne dépasse pas ECART_MOTS fois
// la plus grande. Une ligne compte si elle a deux signes au moins, ou un seul signe qui
// est déjà un mot (plus large que SIGNE_MOT fois sa hauteur).
export const ECART_MOTS = 2;
export const SIGNE_MOT = 1.5;
const HAUTEURS_PROCHES = 2.5;

export function alignerSignes(signes) {
  const tries = [...signes].sort((a, b) => a.x0 - b.x0);
  const lignes = [];
  for (const s of tries) {
    const h = s.y1 - s.y0;
    const ligne = lignes.find((L) => {
      const d = L.signes[L.signes.length - 1];
      if (d.valeur !== s.valeur) return false;
      const hd = d.y1 - d.y0;
      const recouvre = Math.min(d.y1, s.y1) - Math.max(d.y0, s.y0);
      return recouvre >= 0.5 * Math.min(h, hd)
        && Math.max(h, hd) / Math.min(h, hd) <= HAUTEURS_PROCHES
        && s.x0 - L.x1 <= ECART_MOTS * Math.max(h, hd);
    });
    if (ligne) {
      ligne.signes.push(s);
      ligne.x1 = Math.max(ligne.x1, s.x1);
      ligne.y0 = Math.min(ligne.y0, s.y0);
      ligne.y1 = Math.max(ligne.y1, s.y1);
    } else {
      lignes.push({ x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1, signes: [s] });
    }
  }
  return lignes
    .filter((L) => L.signes.length >= 2 || (L.x1 - L.x0) >= SIGNE_MOT * (L.y1 - L.y0))
    .map(({ x0, y0, x1, y1, signes: s }) => ({ x0, y0, x1, y1, signes: s.length }));
}

// Part des pixels qui bordent un changement : un voisin direct qui diffère de plus de
// ECART_BORD sur un canal. Sur une image à sa résolution native, un graphique en a de 4 à
// 15 %, un schéma dense jusqu'à 23 %, une photo ou une trame 30 % et plus : au-delà de
// BORDS_MAX, l'image n'a pas de fond où chercher des textes oubliés.
export const ECART_BORD = 16;
export const BORDS_MAX = 0.28;

export function partBords(rgba, largeur, hauteur) {
  if (largeur < 3 || hauteur < 3) return 0;
  const differe = (p, q) => Math.abs(rgba[p] - rgba[q]) > ECART_BORD
    || Math.abs(rgba[p + 1] - rgba[q + 1]) > ECART_BORD || Math.abs(rgba[p + 2] - rgba[q + 2]) > ECART_BORD;
  let bords = 0;
  const pas = largeur * 4;
  for (let y = 1; y < hauteur - 1; y++) {
    for (let x = 1, p = (y * largeur + 1) * 4; x < largeur - 1; x++, p += 4) {
      if (differe(p, p + 4) || differe(p, p - 4) || differe(p, p + pas) || differe(p, p - pas)) bords++;
    }
  }
  return bords / ((largeur - 2) * (hauteur - 2));
}

// Zones où il reste peut-être du texte, sur une image dont les textes connus (`boites`)
// sont masqués. hMin et hMax bornent la hauteur d'un signe. Le voisinage de la carte
// d'encre fait deux fois hMax de rayon. Une composante de la clarté du fond de la figure
// n'est pas de l'encre : c'est du fond qui jouxte une surface sombre ou claire. Au plus
// SUGGESTIONS_MAX zones, celles qui ont le plus de signes d'abord, rendues dans l'ordre
// de lecture ; aucune sur une photo ou une trame (partBords).
export const SUGGESTIONS_MAX = 30;

export function zonesEncre(rgba, largeur, hauteur, { boites = [], hMin, hMax }) {
  if (partBords(rgba, largeur, hauteur) > BORDS_MAX) return [];
  const carte = masquer(carteEncre(rgba, largeur, hauteur, Math.round(2 * hMax)), largeur, hauteur, boites, hMin);
  const { lumas, fond } = lumasEtFond(rgba, largeur, hauteur);
  const signes = composantes(carte, largeur, hauteur, lumas)
    .filter((c) => Math.abs(c.luma - fond) >= ECART_ENCRE && signePossible(c, hMin, hMax));
  const lignes = alignerSignes(signes).filter((L) => L.y1 - L.y0 <= hMax * 1.5);
  return lignes
    .sort((a, b) => b.signes - a.signes)
    .slice(0, SUGGESTIONS_MAX)
    .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
}

// ── Coordonnées ─────────────────────────────────────────────────────────────────

// Les boîtes se mesurent sur le canevas d'analyse ; l'export les donne en pixels de l'image
// d'origine. `echelle` : pixels d'origine par pixel du canevas.
export function versOrigine(bbox, echelle) {
  const r = (v) => Math.round(v * echelle * 10) / 10;
  return { x0: r(bbox.x0), y0: r(bbox.y0), x1: r(bbox.x1), y1: r(bbox.y1) };
}

export function versCanevas(boite, echelle) {
  return { x0: boite.x0 / echelle, y0: boite.y0 / echelle, x1: boite.x1 / echelle, y1: boite.y1 / echelle };
}

// Boîte d'un glisser, dans l'ordre, bornée au canevas.
export function boiteNormalisee(a, b, largeur, hauteur) {
  const borne = (v, max) => Math.min(max, Math.max(0, v));
  return {
    x0: borne(Math.min(a.x, b.x), largeur), y0: borne(Math.min(a.y, b.y), hauteur),
    x1: borne(Math.max(a.x, b.x), largeur), y1: borne(Math.max(a.y, b.y), hauteur),
  };
}

// Une zone ajoutée recouvre-t-elle un texte déjà visible ?
export function recouvreUnTexte(bbox, lignes) {
  return lignes.some((l) => visible(l.statut) && recouvrement(l.bbox, bbox) > 0.5);
}

// ── Export ──────────────────────────────────────────────────────────────────────

export const VERSION_EXPORT = 1;

const hex = (c) => (c ? `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}` : null);
const arrondi = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);

// La lecture telle qu'elle est, statuts compris, en pixels de l'image d'origine. `lignes`
// sont les textes mesurés (mesures() de l'interface : pt, lc, nt, nc, niveau). Les textes
// retirés y restent, avec leur statut. objets et series sont réservés.
export function exporterLecture({ figure, reglages, verdict, lignes, echelle, diagnosticEnsemble }) {
  return {
    version: VERSION_EXPORT,
    figure: { nom: figure.nom, type: figure.type, largeurPx: figure.largeurPx, hauteurPx: figure.hauteurPx },
    reglages: {
      format: reglages.format, proportion: reglages.proportion, seuilLc: reglages.seuilLc,
      largeurMm: arrondi(reglages.largeurMm, 2), hauteurMm: arrondi(reglages.hauteurMm, 2), pxParMm: arrondi(reglages.pxParMm, 3),
    },
    verdict,
    textes: lignes.map((l) => ({
      id: l.id,
      texte: l.texte || '',
      boite: versOrigine(l.bbox, echelle),
      exact: Boolean(l.exact),
      statut: l.statut,
      origine: l.origine,
      corpsPt: arrondi(l.pt, 2),
      lc: arrondi(l.lc, 1),
      couleurTexte: l.contraste ? hex(l.contraste.texte) : null,
      couleurFond: l.contraste ? hex(l.contraste.fond) : null,
      niveauTaille: l.nt ?? null,
      niveauContraste: l.nc ?? null,
      niveau: l.niveau ?? null,
    })),
    objets: [],
    series: [],
    diagnosticEnsemble: diagnosticEnsemble
      ? { total: diagnosticEnsemble.total, petits: diagnosticEnsemble.petits, bas: arrondi(diagnosticEnsemble.bas, 2),
        haut: arrondi(diagnosticEnsemble.haut, 2), mediane: arrondi(diagnosticEnsemble.mediane, 2), facteur: arrondi(diagnosticEnsemble.facteur, 2) }
      : null,
  };
}

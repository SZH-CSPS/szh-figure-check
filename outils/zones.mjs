// Évalue la détection des zones (objets du graphique) sur les figures de référence :
//   node outils/zones.mjs [--bruit n] [--echelle 2] [--svg] [--details] [--seulement nom]
//   node outils/zones.mjs --banc      totaux dans cinq conditions (nette, grain, réduite)
//
// Lit test/verite-zones.json (produit par outils/zones-reference.mjs), passe chaque PNG par
// la voie approchée (objetsBitmap puis analyserObjets, sans navigateur, les boîtes des textes
// données comme si l'OCR les avait lues), et, avec --svg, chaque SVG par la voie exacte dans
// Chromium. --bruit n ajoute un bruit uniforme de ±n sur chaque canal (une image compressée).
//
// Critères, pour chaque figure :
// - zone trouvée : une zone attendue est recouverte par un objet analysé (dans une série,
//   donc avec une couleur et des contrastes jugés), boîtes à IoU 0,5 au moins, couleur à
//   ΔE00 10 au plus de la couleur moyenne réelle ;
// - zone découpée : d'autres objets logés dans la zone (80 % de leur boîte) et de sa couleur
//   (ΔE00 sous 12) : un dégradé ou une surface coupée par un trait rendue en morceaux ;
// - intrus : un objet qui n'est ni une zone attendue, ni une zone tolérée (80 % de sa boîte
//   dans une zone tolérée), ni un morceau compté plus haut : une micro-zone, un reflet, une
//   ombre, une graduation. Un intrus dans une série est montré à la personne qui relit.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lirePng } from './png.mjs';
import { objetsBitmap, analyserObjets } from '../js/objets.js';
import { versLab, ciede2000 } from '../js/couleur.js';

export const IOU_ZONE = 0.5;
export const DELTA_E_ZONE = 10;
export const DELTA_E_MORCEAU = 12;
export const DEDANS = 0.8;

const racine = fileURLToPath(new URL('..', import.meta.url));
const aire = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
const inter = (a, b) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
const iou = (a, b) => { const i = inter(a, b); return i / (aire(a) + aire(b) - i || 1); };
const rvb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const ecart = (a, b) => (a && b ? ciede2000(versLab(typeof a === 'string' ? rvb(a) : a), versLab(typeof b === 'string' ? rvb(b) : b)) : Infinity);

// Compare les objets d'une analyse aux zones d'une figure de la vérité.
export function evaluerZones(figure, analyse, mmParPx) {
  const objets = analyse.objets;
  const pris = new Set();
  const zones = [];
  // Les grandes zones d'abord : la plus grande prend son objet.
  for (const z of [...figure.zones].sort((a, b) => b.aire - a.aire)) {
    let meilleur = null, m = 0;
    for (const o of objets) {
      if (pris.has(o)) continue;
      const v = iou(o.boite, z.boite);
      if (v > m) { m = v; meilleur = o; }
    }
    const trouvee = meilleur && m >= IOU_ZONE ? meilleur : null;
    if (trouvee) pris.add(trouvee);
    zones.push({ z, objet: trouvee, iou: m, de: trouvee ? ecart(trouvee.couleur, z.couleur) : null });
  }
  for (const r of zones) {
    r.morceaux = objets.filter((o) => !pris.has(o) && inter(o.boite, r.z.boite) >= DEDANS * aire(o.boite) && (o.couleur == null || ecart(o.couleur, r.z.couleur) < DELTA_E_MORCEAU));
    r.morceaux.forEach((o) => pris.add(o));
    r.analysee = Boolean(r.objet && r.objet.serie != null && r.de <= DELTA_E_ZONE);
  }
  const toleres = figure.zones.filter((z) => z.role === 'toleree');
  const intrus = objets.filter((o) => !pris.has(o) && !toleres.some((z) => inter(o.boite, z.boite) >= DEDANS * aire(o.boite)));
  const attendues = zones.filter((r) => r.z.role === 'attendue');
  const mm2 = (o) => o.aire * mmParPx * mmParPx;
  return {
    attendues: attendues.length,
    trouvees: attendues.filter((r) => r.analysee).length,
    decoupees: attendues.filter((r) => r.morceaux.length).length,
    morceaux: attendues.reduce((a, r) => a + r.morceaux.length, 0),
    intrus: intrus.length,
    intrusSeries: intrus.filter((o) => o.serie != null).length,
    microIntrus: intrus.filter((o) => mm2(o) < 4).length,
    series: analyse.series.length,
    objets: objets.length,
    formes: analyse.formes,
    detail: { zones, intrus },
  };
}

// Bruit uniforme reproductible (générateur congruentiel), ±n sur chaque canal.
export function bruiter(rgba, n, graine = 1) {
  let s = graine >>> 0;
  const hasard = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const sortie = new Uint8ClampedArray(rgba);
  for (let i = 0; i < sortie.length; i++) if ((i & 3) !== 3) sortie[i] = rgba[i] + Math.round((hasard() * 2 - 1) * n);
  return sortie;
}

// Réduit une image d'un facteur entier (moyenne des pixels) : une figure envoyée petite.
export function reduire(rgba, largeur, hauteur, f) {
  const L = Math.floor(largeur / f), H = Math.floor(hauteur / f), sortie = new Uint8ClampedArray(L * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < L; x++) for (let c = 0; c < 4; c++) {
    let s = 0;
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) s += rgba[((y * f + dy) * largeur + x * f + dx) * 4 + c];
    sortie[(y * L + x) * 4 + c] = Math.round(s / (f * f));
  }
  return { rgba: sortie, largeur: L, hauteur: H };
}

// Voie approchée sur le PNG d'une figure de la vérité ; `echelle` 2 la lit réduite de moitié,
// les boîtes et surfaces rendues ramenées aux pixels de la vérité.
export async function analyserPng(verite, figure, { bruit = 0, echelle = 1 } = {}) {
  let { largeur, hauteur, rgba } = lirePng(await readFile(join(racine, 'exemples/reference', figure.png)));
  if (echelle > 1) ({ rgba, largeur, hauteur } = reduire(rgba, largeur, hauteur, echelle));
  const mmParPx = verite.largeurMm / largeur;
  const pixels = bruit ? bruiter(rgba, bruit) : rgba;
  const textes = figure.textes.map((b) => ({ x0: b.x0 / echelle, y0: b.y0 / echelle, x1: b.x1 / echelle, y1: b.y1 / echelle }));
  const debut = performance.now();
  const brut = objetsBitmap(pixels, largeur, hauteur, { boites: textes, mmParPx });
  const analyse = analyserObjets(brut, { mmParPx, boites: textes });
  const ms = performance.now() - debut;
  if (echelle > 1) {
    for (const o of analyse.objets) {
      o.boite = { x0: o.boite.x0 * echelle, y0: o.boite.y0 * echelle, x1: o.boite.x1 * echelle, y1: o.boite.y1 * echelle };
      o.aire *= echelle * echelle;
    }
  }
  return { analyse, mmParPx: mmParPx / echelle, ms };
}

// Les conditions du banc : nette, grain ±4, grain ±8, réduite de moitié, réduite et grain ±4.
export const CONDITIONS = [
  { nom: 'nette', bruit: 0, echelle: 1 }, { nom: 'grain ±4', bruit: 4, echelle: 1 }, { nom: 'grain ±8', bruit: 8, echelle: 1 },
  { nom: 'réduite ½', bruit: 0, echelle: 2 }, { nom: 'réduite ½ + grain ±4', bruit: 4, echelle: 2 },
];

// Totaux de toutes les figures dans toutes les conditions.
export async function banc(verite) {
  const lignes = [];
  for (const c of CONDITIONS) {
    const t = { condition: c.nom, trouvees: 0, attendues: 0, decoupees: 0, intrus: 0, ms: 0 };
    for (const f of verite.figures) {
      const { analyse, mmParPx, ms } = await analyserPng(verite, f, c);
      const e = evaluerZones(f, analyse, mmParPx);
      t.trouvees += e.trouvees; t.attendues += e.attendues; t.decoupees += e.decoupees; t.intrus += e.intrus; t.ms += ms;
    }
    lignes.push(t);
  }
  return lignes;
}

const hex = (c) => (c ? '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase() : 'dégradé');
const boite = (b) => `${Math.round(b.x0)},${Math.round(b.y0)}–${Math.round(b.x1)},${Math.round(b.y1)}`;

export function rapport(nom, e, ms, details) {
  const lignes = [`${nom.padEnd(24)} zones ${e.trouvees}/${e.attendues}  découpées ${e.decoupees} (${e.morceaux} morceaux)  intrus ${e.intrus} (dont ${e.intrusSeries} en série, ${e.microIntrus} sous 4 mm²)  séries ${e.series}  objets ${e.objets}${ms != null ? `  ${Math.round(ms)} ms` : ''}`];
  if (details) {
    for (const r of e.detail.zones) {
      const etat = r.z.role === 'toleree' ? 'tolérée' : r.analysee ? 'ok' : r.objet ? (r.objet.serie == null ? 'non analysée' : `couleur ΔE ${r.de.toFixed(1)}`) : `absente (IoU ${r.iou.toFixed(2)})`;
      lignes.push(`    ${r.z.nom.padEnd(16)} ${etat.padEnd(22)} ${r.objet ? `${r.objet.type} ${hex(r.objet.couleur)} attendu ${r.z.couleur}` : ''}${r.morceaux.length ? `  + ${r.morceaux.length} morceaux` : ''}`);
    }
    for (const o of e.detail.intrus) lignes.push(`    intrus           ${o.type} ${hex(o.couleur)} ${boite(o.boite)} ${o.aire.toFixed(0)} px²${o.serie != null ? ` série ${o.serie}` : ''}`);
  }
  return lignes.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const valeur = (nom) => { const i = args.indexOf(nom); return i >= 0 ? args[i + 1] : null; };
  const bruit = Number(valeur('--bruit')) || 0;
  const echelle = Number(valeur('--echelle')) || 1;
  if (args.includes('--banc')) {
    const verite = JSON.parse(await readFile(join(racine, 'test/verite-zones.json'), 'utf8'));
    for (const t of await banc(verite)) console.log(`${t.condition.padEnd(22)} zones ${t.trouvees}/${t.attendues}  découpées ${t.decoupees}  intrus ${t.intrus}  ${Math.round(t.ms)} ms`);
    process.exit(0);
  }
  const seulement = valeur('--seulement');
  const verite = JSON.parse(await readFile(join(racine, 'test/verite-zones.json'), 'utf8'));
  const figures = verite.figures.filter((f) => !seulement || f.fichier.includes(seulement));
  console.log(`Voie approchée (PNG${bruit ? `, bruit ±${bruit}` : ''}${echelle > 1 ? `, réduite 1/${echelle}` : ''})`);
  for (const f of figures) {
    const { analyse, mmParPx, ms } = await analyserPng(verite, f, { bruit, echelle });
    console.log(rapport(f.png, evaluerZones(f, analyse, mmParPx), ms, args.includes('--details')));
  }
  if (args.includes('--svg')) {
    const { evaluerSvg } = await import('./zones-svg.mjs');
    console.log('Voie exacte (SVG)');
    for (const { f, analyse, mmParPx } of await evaluerSvg(verite, figures)) console.log(rapport(f.fichier, evaluerZones(f, analyse, mmParPx), null, args.includes('--details')));
  }
}

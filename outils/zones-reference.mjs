// Figures de référence des objets : rend chaque SVG de exemples/reference en PNG (Chromium de
// Playwright, 1 px par unité) et écrit la vérité de terrain test/verite-zones.json.
//   node outils/zones-reference.mjs
//
// Dans un SVG de référence, `data-zone="nom"` marque une zone attendue : l'outil doit la
// trouver d'un seul tenant, avec sa couleur ; `data-tolere="nom"` une zone permise (légende,
// quadrillage, axe, bord) ; tout le reste (graduations, reflets, pastilles, ombres douces,
// oiseaux…) ne doit pas sortir. La partie visible de chaque zone est mesurée sur les pixels :
// l'élément est masqué, la figure rendue à nouveau, et les pixels qui changent sont les siens
// (une colline cachée en partie par une autre n'a que sa partie visible). Sa couleur est la
// moyenne de ces pixels hors frange lissée, dégradé compris ; `etendue` dit de combien ils s'en écartent (écart
// Lab au 95e centile) : sous 15 environ, un léger dégradé.

import { createRequire } from 'node:module';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { lirePng } from './png.mjs';
import { versLab, distanceLab } from '../js/couleur.js';
import { versHex } from '../js/apca.js';

const DOSSIER = 'exemples/reference';
const SORTIE = 'test/verite-zones.json';
const LARGEUR_MM = 172;         // pleine largeur de la Revue
const SEUIL_DIFF = 3;           // écart sur un canal qui fait d'un pixel un pixel de la zone

const { chromium } = createRequire(import.meta.url)('playwright');
const navigateur = await chromium.launch();
const page = await navigateur.newPage({ viewport: { width: 1200, height: 800 }, deviceScaleFactor: 1 });

const figures = [];
for (const fichier of (await readdir(DOSSIER)).filter((f) => f.endsWith('.svg')).sort()) {
  const svg = await readFile(join(DOSSIER, fichier), 'utf8');
  const [, w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg).map(Number);
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${svg}</body></html>`);
  const capture = async () => lirePng(await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } }));
  const png = fichier.replace(/\.svg$/, '.png');
  await writeFile(join(DOSSIER, png), await page.screenshot({ clip: { x: 0, y: 0, width: w, height: h } }));
  const base = await capture();

  const textes = await page.$$eval('svg text', (els) => els.map((e) => {
    const r = e.getBoundingClientRect();
    return { x0: Math.floor(r.left), y0: Math.floor(r.top), x1: Math.ceil(r.right), y1: Math.ceil(r.bottom) };
  }));
  const marques = await page.$$eval('[data-zone], [data-tolere]', (els) => els.map((e) => ({
    nom: e.getAttribute('data-zone') || e.getAttribute('data-tolere'), role: e.hasAttribute('data-zone') ? 'attendue' : 'toleree',
  })));
  const zones = [];
  for (let i = 0; i < marques.length; i++) {
    // Rendu de comparaison repris à chaque zone : après un masquage, le navigateur ne
    // redessine pas toujours la figure au pixel près comme la première fois.
    const base = await capture();
    await page.$$eval('[data-zone], [data-tolere]', (els, i) => { els[i].style.visibility = 'hidden'; }, i);
    const cache = await capture();
    await page.$$eval('[data-zone], [data-tolere]', (els, i) => { els[i].style.visibility = ''; }, i);
    // Pixels qui changent ; le rendu d'un navigateur bouge d'un rendu à l'autre sur quelques
    // pixels au bord des formes voisines (lissage) : les îlots de moins de 15 px ou de moins
    // de 5 % du plus grand îlot de la zone sont écartés.
    const masque = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      const k = p * 4;
      if (Math.max(Math.abs(base.rgba[k] - cache.rgba[k]), Math.abs(base.rgba[k + 1] - cache.rgba[k + 1]), Math.abs(base.rgba[k + 2] - cache.rgba[k + 2])) > SEUIL_DIFF) masque[p] = 1;
    }
    const ilot = new Int32Array(w * h), tailles = [0], pile = [];
    for (let p = 0; p < w * h; p++) {
      if (!masque[p] || ilot[p]) continue;
      const id = tailles.length;
      let t = 0;
      ilot[p] = id; pile.push(p);
      while (pile.length) {
        const q = pile.pop(), x = q % w, y = (q - x) / w;
        t++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const v = yy * w + xx;
          if (masque[v] && !ilot[v]) { ilot[v] = id; pile.push(v); }
        }
      }
      tailles.push(t);
    }
    const plusGrand = Math.max(...tailles);
    const garder = tailles.map((t) => t >= Math.max(15, 0.05 * plusGrand));
    // Couleur : moyenne des pixels intérieurs (leurs quatre voisins sont de la zone), sans
    // la frange lissée du bord, qui mêle la zone à ce qui l'entoure ; tous à défaut.
    const dans = (p) => masque[p] && garder[ilot[p]];
    let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
    const somme = [[0, 0, 0, 0], [0, 0, 0, 0]];
    const pixels = [];
    for (let p = 0; p < w * h; p++) {
      if (!dans(p)) continue;
      const k = p * 4;
      const x = p % w, y = (p - x) / w;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      n++;
      const interieur = x > 0 && y > 0 && x < w - 1 && y < h - 1 && dans(p - 1) && dans(p + 1) && dans(p - w) && dans(p + w) ? 1 : 0;
      for (const s of interieur ? somme : [somme[0]]) { s[0] += base.rgba[k]; s[1] += base.rgba[k + 1]; s[2] += base.rgba[k + 2]; s[3]++; }
      if (interieur && n % 7 === 0) pixels.push([base.rgba[k], base.rgba[k + 1], base.rgba[k + 2]]);
    }
    if (!n) continue;
    const s = somme[1][3] ? somme[1] : somme[0];
    const moyenne = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
    const lab = versLab(moyenne);
    const ecarts = pixels.map((c) => distanceLab(versLab(c), lab)).sort((a, b) => a - b);
    zones.push({
      ...marques[i], boite: { x0, y0, x1: x1 + 1, y1: y1 + 1 }, aire: n,
      couleur: versHex(moyenne.map(Math.round)), etendue: Math.round(10 * (ecarts[Math.floor(0.95 * (ecarts.length - 1))] || 0)) / 10,
    });
  }
  const fond = /data-fond/.test(svg) ? null : '#' + [0, 1, 2].map((c) => base.rgba[c].toString(16).padStart(2, '0')).join('');
  figures.push({ fichier, png, largeurPx: w, hauteurPx: h, fond, textes, zones });
  console.log(`${fichier} : ${zones.filter((z) => z.role === 'attendue').length} zones attendues, ${zones.filter((z) => z.role === 'toleree').length} tolérées, ${textes.length} textes`);
}
await navigateur.close();
// Une zone ou un texte par ligne : le fichier se relit et se compare à l'œil.
const ligne = (o) => JSON.stringify(o);
const texte = [
  '{',
  ' "version": 1,',
  ` "notes": ${ligne(`Produit par outils/zones-reference.mjs à partir de ${DOSSIER}/*.svg. Boîtes en pixels du PNG (x1, y1 exclus), partie visible seulement ; aire en pixels ; couleur moyenne rendue ; etendue : écart Lab au 95e centile. Largeur imprimée : ${LARGEUR_MM} mm.`)},`,
  ` "largeurMm": ${LARGEUR_MM},`,
  ' "figures": [',
  figures.map((f) => [
    '  {',
    `   "fichier": ${ligne(f.fichier)}, "png": ${ligne(f.png)}, "largeurPx": ${f.largeurPx}, "hauteurPx": ${f.hauteurPx}, "fond": ${ligne(f.fond)},`,
    '   "textes": [',
    f.textes.map((t) => `    ${ligne(t)}`).join(',\n'),
    '   ],',
    '   "zones": [',
    f.zones.map((z) => `    ${ligne(z)}`).join(',\n'),
    '   ]',
    '  }',
  ].join('\n')).join(',\n'),
  ' ]',
  '}',
].join('\n');
JSON.parse(texte);
await writeFile(SORTIE, texte + '\n');
console.log(`→ ${SORTIE}`);

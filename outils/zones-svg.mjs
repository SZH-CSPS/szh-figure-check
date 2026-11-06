// Voie exacte des figures de référence : chaque SVG lu par objetsSvg() dans le Chromium de
// Playwright, puis analyserObjets(), les boîtes des textes de la vérité données comme si la
// lecture les avait trouvées. Utilisé par outils/zones.mjs --svg.

import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

export async function evaluerSvg(verite, figures) {
  const serveur = createServer(async (req, res) => {
    const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (chemin === '/') { res.writeHead(200, { 'content-type': TYPES['.html'] }).end('<!doctype html><meta charset="utf-8"><body></body>'); return; }
    const fichier = normalize(join(racine, chemin));
    if (!fichier.startsWith(racine)) { res.writeHead(403).end(); return; }
    try { res.writeHead(200, { 'content-type': TYPES[extname(fichier)] || 'application/octet-stream' }).end(await readFile(fichier)); } catch { res.writeHead(404).end(); }
  });
  await new Promise((ok) => serveur.listen(0, '127.0.0.1', ok));
  const { chromium } = createRequire(import.meta.url)('playwright');
  const navigateur = await chromium.launch();
  try {
    const page = await navigateur.newPage();
    await page.goto(`http://127.0.0.1:${serveur.address().port}/`);
    const resultats = [];
    for (const f of figures) {
      const svg = await readFile(join(racine, 'exemples/reference', f.fichier), 'utf8');
      const mmParPx = verite.largeurMm / f.largeurPx;
      const analyse = await page.evaluate(async ({ svg, w, h, mmParPx, boites }) => {
        const m = await import('/js/objets.js');
        const a = m.analyserObjets(m.objetsSvg(svg, w, h), { mmParPx, boites });
        return {
          formes: a.formes,
          series: a.series.map((s) => ({ id: s.id, couleur: s.couleur, nObjets: s.nObjets, niveau: s.niveau })),
          objets: a.objets.map((o) => ({ type: o.type, couleur: o.couleur, nuances: o.nuances, boite: o.boite, aire: o.aire, serie: o.serie })),
        };
      }, { svg, w: f.largeurPx, h: f.hauteurPx, mmParPx, boites: f.textes });
      resultats.push({ f, analyse, mmParPx });
    }
    return resultats;
  } finally {
    await navigateur.close();
    serveur.close();
  }
}

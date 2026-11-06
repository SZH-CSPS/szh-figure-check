// Zones des figures de référence (exemples/reference, vérité test/verite-zones.json) : la voie
// approchée trouve chaque zone utile d'un seul tenant, avec sa couleur, et rien d'autre. Les
// critères sont ceux d'outils/zones.mjs ; la voie exacte (SVG) demande un navigateur et se
// mesure à part : node outils/zones.mjs --svg.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyserPng, evaluerZones } from '../outils/zones.mjs';

const verite = JSON.parse(await readFile(new URL('./verite-zones.json', import.meta.url), 'utf8'));
// La colline lointaine du paysage est coupée en trois par le tronc et la maison posés
// dessus : trois morceaux de la même série, pas une zone d'un seul tenant (voir docs/ZONES.md).
const CACHEES = new Set(['colline-loin']);

for (const bruit of [0, 4]) {
  for (const f of verite.figures) {
    test(`zones de ${f.png}${bruit ? `, grain ±${bruit}` : ''} : toutes trouvées, aucune découpée, aucune micro-zone`, async () => {
      const { analyse, mmParPx } = await analyserPng(verite, f, { bruit });
      const e = evaluerZones(f, analyse, mmParPx);
      const manquees = e.detail.zones.filter((r) => r.z.role === 'attendue' && !r.analysee && !CACHEES.has(r.z.nom)).map((r) => r.z.nom);
      assert.deepEqual(manquees, []);
      const decoupees = e.detail.zones.filter((r) => r.z.role === 'attendue' && r.morceaux.length && !CACHEES.has(r.z.nom)).map((r) => r.z.nom);
      assert.deepEqual(decoupees, []);
      assert.deepEqual(e.detail.intrus.map((o) => `${o.type} ${o.boite.x0},${o.boite.y0}`), []);
      assert.equal(analyse.formes, true);
    });
  }
}

test('zones : la colline cachée en partie reste dans une seule série', async () => {
  const f = verite.figures.find((x) => x.png.includes('paysage'));
  const { analyse, mmParPx } = await analyserPng(verite, f);
  const r = evaluerZones(f, analyse, mmParPx).detail.zones.find((x) => x.z.nom === 'colline-loin');
  const series = new Set([r.objet, ...r.morceaux].filter(Boolean).map((o) => o.serie));
  assert.equal(series.size, 1);
  assert.ok(!series.has(null));
});

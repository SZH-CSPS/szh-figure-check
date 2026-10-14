// Toutes les références internes de la page portent la même version, et c'est celle du
// contenu actuel : sinon, lancer node outils/version.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { references, versionAttendue } from '../outils/version.mjs';

test('les références internes portent toutes la version du contenu', () => {
  const refs = references();
  const attendue = versionAttendue();
  assert.ok(refs.some((r) => r.fichier === 'index.html' && r.chemin === 'js/app.js'), 'js/app.js absent de index.html');
  assert.ok(refs.length >= 15, `${refs.length} références seulement`);
  const fausses = refs.filter((r) => r.version !== attendue).map((r) => `${r.fichier} : ${r.chemin}?v=${r.version}`);
  assert.deepEqual(fausses, [], `version attendue ${attendue} ; lancer node outils/version.mjs`);
});

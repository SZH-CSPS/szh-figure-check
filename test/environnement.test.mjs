// Vérification de l'environnement, préchargement et ordre des phrases du chargeur.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOTIF, motifIntact, lirePixelsPossible, verifierEnvironnement, sonderTravailleur } from '../js/environnement.js';
import { precharger, tailleAttendue, TABLE, TAILLE_TOTALE } from '../js/prechargement.js';
import { ordreAleatoire } from '../js/chargeur.js';
import { TEXTES } from '../js/i18n.js';

const motif = () => Uint8ClampedArray.from(MOTIF.flatMap((c) => [...c, 255]));

// Un faux canevas : dessine dans une grille de 2 × 2 et rend les pixels par `lecture`.
function faux(lecture = (d) => d) {
  const px = new Uint8ClampedArray(16);
  return () => ({
    getContext: () => ({
      fillStyle: '',
      fillRect(x, y) {
        const [r, g, b] = this.fillStyle.match(/\d+/g).map(Number);
        px.set([r, g, b, 255], (y * 2 + x) * 4);
      },
      getImageData: () => ({ data: lecture(px) }),
    }),
  });
}

test('motifIntact : exact seulement', () => {
  assert.equal(motifIntact(motif()), true);
  assert.equal(motifIntact(new Uint8ClampedArray(16)), false);
  const bruite = motif();
  bruite[1] ^= 1;
  assert.equal(motifIntact(bruite), false);
  assert.equal(motifIntact(null), false);
  assert.equal(motifIntact(new Uint8ClampedArray(4)), false);
});

test('lirePixelsPossible : lecture fidèle, vide, brouillée ou refusée', () => {
  assert.equal(lirePixelsPossible(faux()), true);
  assert.equal(lirePixelsPossible(faux(() => new Uint8ClampedArray(16))), false);
  assert.equal(lirePixelsPossible(faux((d) => d.map((v, i) => (i % 4 === 3 ? v : v ^ 1)))), false);
  assert.equal(lirePixelsPossible(() => { throw new Error('SecurityError'); }), false);
  assert.equal(lirePixelsPossible(() => ({ getContext: () => null })), false);
});

test('verifierEnvironnement : WebAssembly, Worker et pixels', () => {
  const bon = { WebAssembly: { instantiate() {} }, Worker() {} };
  assert.deepEqual(verifierEnvironnement(bon, faux()), { wasm: true, worker: true, canvas: true });
  assert.deepEqual(verifierEnvironnement({ Worker() {} }, faux()), { wasm: false, worker: true, canvas: true });
  assert.deepEqual(verifierEnvironnement({ WebAssembly: { instantiate() {} } }, faux(() => new Uint8ClampedArray(16))), { wasm: true, worker: false, canvas: false });
});

const reponse = (octets, entetes = {}) => new Response(new Uint8Array(octets), { headers: entetes });

test('precharger : octets reçus sur total, modèle gardé, taille donnée sans compression', async () => {
  const vues = [];
  const { modele } = await precharger((r, t) => vues.push([r, t]), async (url) => {
    const f = TABLE.find((x) => x.url === url);
    return reponse(f.url.endsWith('.onnx') ? 7 : 3);
  });
  const [recus, total] = vues.at(-1);
  assert.equal(recus, 3 * (TABLE.length - 1) + 7);
  assert.equal(modele.length, 7);
  assert.ok(total > 0);
  assert.equal(vues[0][1], TAILLE_TOTALE);
  assert.ok(vues.every(([r], i) => i === 0 || r >= vues[i - 1][0]));
  const f = TABLE[0];
  assert.equal(tailleAttendue(f, reponse(1, { 'content-length': '10' })), 10);
  assert.equal(tailleAttendue(f, reponse(1, { 'content-length': '10', 'content-encoding': 'gzip' })), f.taille);
  assert.equal(tailleAttendue(f, reponse(1)), f.taille);
});

test('precharger : une réponse en erreur ou un réseau coupé rejette', async () => {
  await assert.rejects(precharger(() => {}, async () => new Response('', { status: 404 })));
  await assert.rejects(precharger(() => {}, async () => { throw new TypeError('réseau'); }));
});

test('ordreAleatoire : tout est vu avant la moindre répétition, jamais deux fois de suite', () => {
  const tirer = ordreAleatoire(11);
  for (let tour = 0; tour < 5; tour++) {
    const vus = Array.from({ length: 11 }, tirer);
    assert.equal(new Set(vus).size, 11);
  }
  const t2 = ordreAleatoire(3, () => 0.999);
  const suite = Array.from({ length: 60 }, t2);
  assert.ok(suite.every((v, i) => i === 0 || v !== suite[i - 1]));
});

test('phrases du chargeur : onze en français et en allemand', () => {
  assert.equal(TEXTES.fr.chargeurPhrases.length, 11);
  assert.equal(TEXTES.de.chargeurPhrases.length, 11);
});

// Un faux Worker : répond, plante ou se tait.
const faussesReponses = (comportement) => class {
  constructor() {
    if (comportement === 'refuse') throw new Error('SecurityError');
    setTimeout(() => {
      if (comportement === 'plante') this.onerror?.({});
      else if (typeof comportement === 'boolean') this.onmessage?.({ data: comportement });
    }, 1);
  }

  terminate() { this.arrete = true; }
};

test('sonderTravailleur : WebAssembly vu depuis le travailleur', async () => {
  assert.deepEqual(await sonderTravailleur({ Travailleur: faussesReponses(true) }), { wasm: true, worker: true });
  assert.deepEqual(await sonderTravailleur({ Travailleur: faussesReponses(false) }), { wasm: false, worker: true });
  assert.deepEqual(await sonderTravailleur({ Travailleur: faussesReponses('plante') }), { wasm: true, worker: false });
  assert.deepEqual(await sonderTravailleur({ Travailleur: faussesReponses('refuse') }), { wasm: true, worker: false });
  assert.deepEqual(await sonderTravailleur({ Travailleur: faussesReponses('silence'), delaiMs: 20 }), { wasm: true, worker: true });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  versLab, ciede2000, simuler, ecartsPaire, contrasteGraphique, verdictPaire, teinteConforme,
  VISIONS, DELTA_E_DISTINCT, DELTA_E_CONFONDU, WCAG_GRAPHIQUE, LC_GRAPHIQUE,
} from '../js/couleur.js';
import { rapportWcag, lc } from '../js/apca.js';

const ROUGE = [0xd7, 0x30, 0x1f], VERT = [0x1a, 0x98, 0x50], JAUNE = [0xf2, 0xc5, 0x3d], BLANC = [255, 255, 255];

test('CIEDE2000 : paires de référence de Sharma, Wu et Dalal (2005)', () => {
  const paires = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[50, 2.5, 0], [56, -27, -3], 31.9030],
    [[50, 2.5, 0], [58, 24, 15], 19.4535],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  ];
  for (const [a, b, attendu] of paires) {
    assert.ok(Math.abs(ciede2000(a, b) - attendu) < 1e-4, `${a} / ${b} : ${ciede2000(a, b)}`);
    assert.ok(Math.abs(ciede2000(b, a) - attendu) < 1e-4);
  }
});

test('CIELAB : blanc, noir et gris moyen', () => {
  const proche = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 0.01);
  assert.ok(proche(versLab(BLANC), [100, 0, 0]), String(versLab(BLANC)));
  assert.ok(proche(versLab([0, 0, 0]), [0, 0, 0]));
  assert.ok(Math.abs(versLab([119, 119, 119])[0] - 50) < 0.5);
});

test('daltonismes simulés : les gris restent gris, le rouge et le vert se rapprochent', () => {
  for (const v of VISIONS) {
    for (const g of [BLANC, [128, 128, 128], [0, 0, 0]]) {
      const s = simuler(g, v);
      assert.ok(s.every((c, i) => Math.abs(c - g[i]) < 1), `${v} ${g} → ${s}`);
    }
  }
  // Machado et al. (2009), deutéranopie : le rouge pur devient un jaune olive sombre.
  const rouge = simuler([255, 0, 0], 'deuteranopie').map(Math.round);
  assert.ok(rouge[0] > rouge[2] && rouge[1] > rouge[2] && Math.abs(rouge[0] - rouge[1]) < 30, String(rouge));
  const e = ecartsPaire(ROUGE, VERT);
  assert.ok(e.normale > 50, String(e.normale));
  assert.ok(e.deuteranopie < DELTA_E_DISTINCT, String(e.deuteranopie));
  assert.ok(e.gris < DELTA_E_DISTINCT, String(e.gris));
  assert.ok(e.tritanopie > 50, String(e.tritanopie));
});

test('contraste avec le fond : WCAG 1.4.11 et plancher APCA non textuel', () => {
  assert.equal(contrasteGraphique(ROUGE, BLANC).niveau, 'ok');
  assert.equal(contrasteGraphique(VERT, BLANC).niveau, 'ok');
  const jaune = contrasteGraphique(JAUNE, BLANC);
  assert.equal(jaune.niveau, 'corriger');
  assert.ok(jaune.wcag < 2 && jaune.lc < 30);
  // 2,5:1 : sous 3:1, au-dessus de 2:1.
  const gris = [150, 150, 150];
  assert.ok(rapportWcag(gris, BLANC) > 2 && rapportWcag(gris, BLANC) < 3);
  assert.equal(contrasteGraphique(gris, BLANC).niveau, 'ameliorer');
  // Le rapport ne s'arrondit pas : juste sous 3:1 ne suffit pas.
  assert.equal(contrasteGraphique([148, 148, 148], BLANC).niveau, rapportWcag([148, 148, 148], BLANC) >= 3 ? 'ok' : 'ameliorer');
});

test('teinte proposée : atteint 3:1 et Lc 40, assombrie sur fond clair', () => {
  const t = teinteConforme(JAUNE, BLANC);
  assert.ok(rapportWcag(t, BLANC) >= WCAG_GRAPHIQUE);
  assert.ok(Math.abs(lc(t, BLANC)) >= LC_GRAPHIQUE + 10);
  assert.ok(t.every((c, i) => c <= JAUNE[i]));
  const sombre = teinteConforme([40, 40, 90], [20, 20, 30]);
  assert.ok(sombre.every((c, i) => c >= [40, 40, 90][i]));
});

test('verdict d’une paire : la vision la plus défavorable décide', () => {
  const base = { normale: 60, deuteranopie: 60, protanopie: 60, tritanopie: 60, gris: 60 };
  assert.deepEqual(verdictPaire(base).visions, []);
  assert.equal(verdictPaire(base).niveau, 'ok');
  const v = verdictPaire({ ...base, gris: 7, deuteranopie: DELTA_E_CONFONDU - 1 });
  assert.equal(v.niveau, 'corriger');
  assert.deepEqual(v.visions, ['deuteranopie', 'gris']);
  assert.equal(verdictPaire({ ...base, protanopie: DELTA_E_DISTINCT - 0.1 }).niveau, 'ameliorer');
});

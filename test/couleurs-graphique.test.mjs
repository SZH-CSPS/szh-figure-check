import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  versLab, ciede2000, simuler, ecartsPaire, contrasteGraphique, verdictPaire, teinteConforme,
  couleursDominantes, analyserCouleurs, VISIONS, DELTA_E_DISTINCT, DELTA_E_CONFONDU, WCAG_GRAPHIQUE, LC_GRAPHIQUE,
} from '../js/couleurs-graphique.js';
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

// Image synthétique : fond blanc, deux barres de couleur aux bords lissés, un texte noir.
function image(largeur, hauteur, peindre) {
  const rgba = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const c = peindre(x, y);
      rgba.set([...c, 255], (y * largeur + x) * 4);
    }
  }
  return rgba;
}

test('couleurs dominantes : barres retenues, fond, bords et texte écartés', () => {
  const L = 300, H = 200;
  const melange = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t));
  const rgba = image(L, H, (x, y) => {
    if (x >= 160 && x < 200 && y >= 20 && y < 30) return (x + y) % 3 ? [0, 0, 0] : BLANC;   // texte
    if (y >= 40 && y < 180) {
      if (x === 40 || x === 99) return melange(ROUGE, BLANC, 0.5);                      // bord lissé
      if (x > 40 && x < 99) return ROUGE;
      if (x === 120 || x === 179) return melange(VERT, BLANC, 0.5);
      if (x > 120 && x < 179) return VERT;
    }
    if (x >= 250 && x < 253 && y >= 100 && y < 103) return [0, 0, 255];                     // tache minuscule
    return BLANC;
  });
  const r = couleursDominantes(rgba, L, H, [{ x0: 160, y0: 20, x1: 200, y1: 30 }]);
  assert.deepEqual(r.fond, BLANC);
  assert.equal(r.aplats, true);
  // Les deux barres ont la même surface : l'ordre entre elles n'est pas fixé.
  assert.deepEqual(r.couleurs.map((c) => c.rgb).sort(), [ROUGE, VERT].sort());
  for (const c of r.couleurs) assert.ok(Math.abs(c.part - (58 * 140) / (L * H)) < 0.01, String(c.part));

  const a = analyserCouleurs(r);
  assert.equal(a.paires.length, 1);
  assert.ok(a.paires[0].visions.includes('gris') && a.paires[0].visions.includes('deuteranopie'));
  assert.equal(a.niveau, 'ameliorer');
});

test('couleurs dominantes : un dégradé n’a pas d’aplat', () => {
  const L = 300, H = 200;
  const rgba = image(L, H, (x, y) => [Math.round((x / L) * 200), Math.round((y / H) * 120), 90]);
  const r = couleursDominantes(rgba, L, H);
  assert.equal(r.aplats, false);
  assert.deepEqual(r.couleurs, []);
  assert.deepEqual(analyserCouleurs(r).paires, []);
});

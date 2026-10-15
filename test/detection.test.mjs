// Fonctions de calcul du détecteur de texte, sur des données fabriquées : entrée du réseau,
// post-traitement de la carte de probabilité, profil d'encre, coordonnées.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dimensionsEntree, tenseurDepuisRgba, binariser, composantes, enveloppeConvexe, rectangleMinimal,
  boiteDeComposante, elargir, boitesDepuisCarte, versCanevas, englobante, profilEncre, paliers,
  corpsDepuisProfil, natureDuTexte, directions, MOYENNE, ECART_TYPE, RAPPORT_UNCLIP,
} from '../js/detection.js';

const proche = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} ≠ ${b} (±${tol})`);

// Carte l × h à 0, avec un rectangle [x0, x1) × [y0, y1) à `valeur`.
function carte(l, h, rects) {
  const c = new Float32Array(l * h);
  for (const [x0, y0, x1, y1, v] of rects) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) c[y * l + x] = v;
  return c;
}

test('dimensions d’entrée : grand côté au plus 1280, multiples de 32, jamais d’agrandissement', () => {
  const g = dimensionsEntree(3440, 2290);
  assert.equal(g.l, 1280);
  assert.equal(g.h % 32, 0);
  proche(g.echelle, 1280 / 3440, 1e-9);
  assert.ok(g.h >= 2290 * g.echelle && g.h < 2290 * g.echelle + 32);
  const p = dimensionsEntree(100, 40);
  assert.equal(p.echelle, 1);
  assert.deepEqual([p.l, p.h], [128, 64]);
});

test('tenseur : ordre B, G, R, plans successifs, moyenne et écart type du canal', () => {
  const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
  const t = tenseurDepuisRgba(rgba, 2, 1);
  assert.equal(t.length, 6);
  proche(t[0], (0 - MOYENNE[0]) / ECART_TYPE[0], 1e-6);       // bleu du pixel rouge
  proche(t[1], (1 - MOYENNE[0]) / ECART_TYPE[0], 1e-6);       // bleu du pixel bleu
  proche(t[4], (1 - MOYENNE[2]) / ECART_TYPE[2], 1e-6);       // rouge du pixel rouge
});

test('binarisation : seuil strict et dilatation 2 × 2 vers le bas et la droite', () => {
  const b = binariser(carte(6, 6, [[2, 2, 3, 3, 0.9], [4, 4, 5, 5, 0.25]]), 6, 6);
  const actifs = [...b].reduce((n, v) => n + v, 0);
  assert.equal(actifs, 4);                                    // 0,25 n’est pas au-dessus du seuil
  assert.equal(b[2 * 6 + 2], 1);
  assert.equal(b[3 * 6 + 3], 1);
  assert.equal(b[1 * 6 + 1], 0);
});

test('composantes : deux blocs séparés, bornes et rangées', () => {
  const l = 20, h = 10;
  const bin = new Uint8Array(l * h);
  for (let y = 2; y < 5; y++) for (let x = 3; x < 9; x++) bin[y * l + x] = 1;
  for (let y = 6; y < 8; y++) for (let x = 12; x < 14; x++) bin[y * l + x] = 1;
  const c = composantes(bin, l, h).sort((p, q) => p.x0 - q.x0);
  assert.equal(c.length, 2);
  assert.deepEqual([c[0].x0, c[0].y0, c[0].x1, c[0].y1, c[0].n], [3, 2, 9, 5, 18]);
  assert.deepEqual([...c[0].rangees], [3, 8, 3, 8, 3, 8]);
  assert.equal(c[1].n, 4);
});

test('composantes : une diagonale est connexe (8 voisins)', () => {
  const bin = new Uint8Array(16);
  for (let i = 0; i < 4; i++) bin[i * 4 + i] = 1;
  assert.equal(composantes(bin, 4, 4).length, 1);
});

test('rectangle minimal d’un rectangle incliné', () => {
  const a = 30 * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const pts = [[0, 0], [40, 0], [40, 10], [0, 10]].map(([x, y]) => [x * c - y * s + 100, x * s + y * c + 50]);
  const r = rectangleMinimal(enveloppeConvexe([...pts, [pts[0][0] + 1e-3, pts[0][1]]]));
  proche(r.a, 40, 0.05);
  proche(r.b, 10, 0.05);
  proche(Math.abs(Math.atan2(r.uy, r.ux)) * 180 / Math.PI % 180, 30, 0.1);
});

test('boîte d’une composante : droite si la ligne est horizontale, orientée si elle est penchée', () => {
  const l = 200, h = 100;
  const droite = composantes(binariser(carte(l, h, [[20, 40, 120, 52, 0.9]]), l, h), l, h)[0];
  const bd = boiteDeComposante(droite);
  assert.equal(bd.oriente, false);
  assert.deepEqual([bd.ux, bd.uy], [1, 0]);
  const inclinee = new Float32Array(l * h);
  for (let x = 20; x < 160; x++) for (let k = 0; k < 10; k++) inclinee[(30 + Math.round((x - 20) * 0.3) + k) * l + x] = 0.9;
  const bo = boiteDeComposante(composantes(binariser(inclinee, l, h), l, h)[0]);
  assert.equal(bo.oriente, true);
  proche(Math.atan(bo.uy / bo.ux) * 180 / Math.PI, 16.7, 1.5);
});

test('un carré n’est jamais orienté, même de travers', () => {
  const l = 60, h = 60;
  const m = new Float32Array(l * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < l; x++) if (Math.abs(x - 30) + Math.abs(y - 30) <= 12) m[y * l + x] = 0.9;
  assert.equal(boiteDeComposante(composantes(binariser(m, l, h), l, h)[0]).oriente, false);
});

test('élargissement : d = rapport × aire / périmètre de chaque côté', () => {
  const b = elargir({ cx: 0, cy: 0, ux: 1, uy: 0, a: 100, b: 10 }, 1.6);
  const d = 1.6 * 1000 / 220;
  proche(b.a, 100 + 2 * d, 1e-9);
  proche(b.b, 10 + 2 * d, 1e-9);
  assert.equal(RAPPORT_UNCLIP >= 1.5 && RAPPORT_UNCLIP <= 2, true);
});

test('carte de probabilité : une ligne trouvée, une zone faible ou trop fine écartée', () => {
  const l = 320, h = 160;
  const prob = carte(l, h, [
    [40, 60, 200, 72, 0.9],       // ligne de texte
    [40, 110, 200, 122, 0.4],     // au-dessus du seuil de binarisation, sous le score
    [250, 20, 251, 120, 0.9],     // trait d’un pixel : bruit
  ]);
  const boites = boitesDepuisCarte(prob, l, h);
  assert.equal(boites.length, 1);
  const b = boites[0];
  assert.ok(b.score > 0.8 && b.score <= 0.9, `score ${b.score}`);
  const e = englobante(b, l, h);
  assert.ok(e.x0 < 40 && e.x1 > 200 && e.y0 < 60 && e.y1 > 72, 'la boîte élargie contient le noyau');
  assert.ok(e.x0 > 20 && e.x1 < 220 && e.y0 > 40 && e.y1 < 92, 'et reste proche de lui');
});

test('coordonnées : de la carte au canevas d’analyse', () => {
  const b = versCanevas({ cx: 320, cy: 160, ux: 1, uy: 0, a: 100, b: 20, oriente: false }, 0.5);
  assert.deepEqual([b.cx, b.cy, b.a, b.b], [640, 320, 200, 40]);
  const e = englobante(b, 1000, 1000);
  assert.deepEqual([e.x0, e.y0, e.x1, e.y1], [540, 300, 740, 340]);
  assert.equal(englobante(b, 600, 1000).x1, 600);
});

// Profil synthétique : densité d par rangée.
const rangees = (...tranches) => Float64Array.from(tranches.flatMap(([n, d]) => new Array(n).fill(d)));

test('profil d’encre : rangées d’un tampon RGBA, texte noir sur fond blanc', () => {
  const l = 20, h = 12, rgba = new Uint8ClampedArray(l * h * 4).fill(255);
  for (let y = 3; y < 9; y++) for (let x = 2; x < 12; x++) rgba.set([0, 0, 0, 255], (y * l + x) * 4);
  const p = profilEncre(rgba, l, h);
  proche(p[5], 10 / 20, 1e-9);
  assert.equal(p[0], 0);
  assert.equal(profilEncre(new Uint8ClampedArray(l * h * 4).fill(200), l, h), null);
});

test('paliers : capitales seules, un palier sans hampes', () => {
  const p = paliers(rangees([5, 0], [20, 0.6], [5, 0]));
  proche(p.palier, 20, 0.6);
  assert.ok(p.dessus < 1 && p.dessous < 1);
  // corps = hauteur de capitale / 0,71
  proche(corpsDepuisProfil(rangees([5, 0], [20, 0.6], [5, 0]), null), 20 / 0.71, 1.2);
});

test('paliers : hauteur d’x avec hampes, jambages en dessous', () => {
  const profil = rangees([4, 0], [6, 0.2], [14, 0.7], [5, 0.2], [4, 0]);
  const p = paliers(profil);
  proche(p.palier, 14, 0.6);
  proche(p.dessus, 6, 0.6);
  proche(p.dessous, 5, 0.6);
  // sans texte : palier surmonté de hampes = hauteur d'x ; deux estimations moyennées
  const attendu = (14 / 0.52 + 20 / 0.71) / 2;
  proche(corpsDepuisProfil(profil, null), attendu, 1.5);
});

test('un filet qui traverse la boîte n’est pas un palier', () => {
  const profil = rangees([3, 0], [1, 1], [3, 0], [14, 0.6], [4, 0]);
  proche(paliers(profil).palier, 14, 1);
});

test('le texte lu tranche entre hauteur d’x et hauteur de capitale', () => {
  assert.equal(natureDuTexte('une'), 'x');
  assert.equal(natureDuTexte('2024'), 'capitale');
  assert.equal(natureDuTexte('CH'), 'capitale');
  assert.equal(natureDuTexte('Année'), 'x');
  assert.equal(natureDuTexte('?'), null);
  const nu = rangees([5, 0], [10, 0.6], [5, 0]);
  proche(corpsDepuisProfil(nu, 'x'), 10 / 0.52, 0.8);
  proche(corpsDepuisProfil(nu, 'capitale'), 10 / 0.71, 1.5);
  assert.equal(corpsDepuisProfil(new Float64Array(10), null), null);
});

test('directions de lecture : horizontale, verticale, ambiguë, orientée', () => {
  const droite = (a, b) => ({ ux: 1, uy: 0, a, b, oriente: false });
  assert.deepEqual(directions(droite(100, 20)), [0]);
  assert.deepEqual(directions(droite(20, 100)), [-Math.PI / 2]);
  assert.deepEqual(directions(droite(20, 40)), [0, -Math.PI / 2]);
  const a = 20 * Math.PI / 180;
  proche(directions({ ux: Math.cos(a), uy: Math.sin(a), a: 100, b: 10, oriente: true })[0], a, 1e-9);
  // axe presque vertical, orienté vers le bas : on lit de bas en haut
  const v = 80 * Math.PI / 180;
  proche(directions({ ux: Math.cos(v), uy: Math.sin(v), a: 100, b: 10, oriente: true })[0], v - Math.PI, 1e-9);
});

test('capitales sans barre haute (« LU ») : l’étendue de l’encre donne la hauteur, pas la barre du pied', () => {
  const profil = rangees([5, 0], [30, 0.14], [3, 0.4], [5, 0]);
  proche(corpsDepuisProfil(profil, 'capitale'), 33 / 0.71, 2);
  proche(corpsDepuisProfil(profil, null), 33 / 0.71, 2);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lc, rapportWcag, versHex } from '../js/apca.js';
import { FORMATS, zoneContenu, tailleFigure, versPoints, MM_PAR_PX, proportionDepuis, PROPORTION_DEFAUT } from '../js/formats.js';
import {
  corpsDepuisSymboles, contrasteZone, bruitFond, BRUIT_FOND_MAX, depuisRotation, recouvrement, seuilOtsu,
  niveauTaille, niveauContraste, pireNiveau, agrandissement, couleurConforme, regrouper, diagnosticEnsemble, quantile,
} from '../js/analyse.js';
import { T, TEXTES, nombre, langueInitiale } from '../js/i18n.js';

test('APCA : valeurs de référence d’APCA-W3', () => {
  assert.equal(lc([0, 0, 0], [255, 255, 255]).toFixed(2), '106.04');
  assert.equal(lc([255, 255, 255], [0, 0, 0]).toFixed(2), '-107.88');
  assert.equal(lc([136, 136, 136], [136, 136, 136]), 0);
});

test('WCAG : noir sur blanc vaut 21', () => {
  assert.equal(rapportWcag([0, 0, 0], [255, 255, 255]).toFixed(1), '21.0');
  assert.equal(versHex([11, 92, 173]), '#0B5CAD');
});

test('zone de contenu des deux formats', () => {
  const r = zoneContenu(FORMATS.revue);
  assert.ok(Math.abs(r.l - (210 - 144 * MM_PAR_PX)) < 1e-9);
  const l = zoneContenu(FORMATS.livre);
  assert.equal(l.l, 115);
  assert.ok(Math.abs(l.h - 185.85) < 1e-9);
});

test('par défaut, toute figure prend toute la colonne ; « taille du fichier » garde une petite image petite', () => {
  const colonne = zoneContenu(FORMATS.revue).l;
  assert.equal(PROPORTION_DEFAUT, 1);
  assert.ok(Math.abs(tailleFigure(FORMATS.revue, 0.5, { l: 2000, h: 1000 }).l - colonne) < 1e-9);
  assert.ok(Math.abs(tailleFigure(FORMATS.revue, 0.5, { l: 400, h: 200 }).l - colonne) < 1e-9);
  assert.ok(Math.abs(tailleFigure(FORMATS.revue, 0.5, { l: 2000, h: 1000 }, null).l - colonne) < 1e-9);
  const petite = tailleFigure(FORMATS.revue, 0.5, { l: 400, h: 200 }, null);
  assert.ok(Math.abs(petite.l - 400 * MM_PAR_PX) < 1e-9);
  assert.ok(Math.abs(tailleFigure(FORMATS.livre, 0.5, null, 0.5).l - 57.5) < 1e-9);
});

test('?largeur= : fractions, pour cent, taille du fichier, défaut', () => {
  assert.equal(proportionDepuis('75'), 0.75);
  assert.equal(proportionDepuis('0.5'), 0.5);
  assert.equal(proportionDepuis('100'), 1);
  assert.equal(proportionDepuis('fichier'), null);
  assert.equal(proportionDepuis('abc'), 1);
  assert.equal(proportionDepuis(null), 1);
});

test('une figure haute est plafonnée à 80 % de la zone et garde ses proportions', () => {
  const zone = zoneContenu(FORMATS.livre);
  const fig = tailleFigure(FORMATS.livre, 3, { l: 2000, h: 6000 });
  assert.ok(Math.abs(fig.h - zone.h * 0.8) < 1e-9);
  assert.ok(Math.abs(fig.h / fig.l - 3) < 1e-9);
});

test('conversion en points', () => {
  // 20 px de corps dans une image de 1000 px imprimée sur 100 mm : 2 mm, soit 5,67 pt.
  assert.equal(versPoints(20, 1000, 100).toFixed(2), '5.67');
});

test('corps estimé depuis les glyphes', () => {
  const s = (text, h) => ({ text, bbox: { x0: 0, x1: 5, y0: 0, y1: h } });
  assert.equal(corpsDepuisSymboles([s('a', 52), s('o', 52), s('B', 71)]), 100);
  assert.equal(corpsDepuisSymboles([s('g', 30), s('l', 40)]), null);
});

function image(l, h, fond, texte, boite) {
  const px = new Uint8ClampedArray(l * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const dedans = x >= boite.x0 && x < boite.x1 && y >= boite.y0 && y < boite.y1;
      const c = dedans ? texte : fond;
      px.set([...c, 255], (y * l + x) * 4);
    }
  }
  return px;
}

test('contraste mesuré dans une zone : texte minoritaire, fond majoritaire', () => {
  const px = image(40, 20, [255, 255, 255], [166, 166, 166], { x0: 10, x1: 20, y0: 5, y1: 12 });
  const m = contrasteZone(px, 40, 20, { x0: 5, y0: 2, x1: 30, y1: 15 });
  assert.deepEqual(m.texte, [166, 166, 166]);
  assert.deepEqual(m.fond, [255, 255, 255]);
  assert.equal(Math.round(m.lc), Math.round(lc([166, 166, 166], [255, 255, 255])));
  assert.equal(niveauContraste(m.lc, 60), 'ameliorer');
});

test('texte clair sur fond sombre : Lc négatif', () => {
  const px = image(30, 30, [20, 40, 90], [255, 255, 255], { x0: 10, x1: 14, y0: 5, y1: 25 });
  const m = contrasteZone(px, 30, 30, { x0: 0, y0: 0, x1: 30, y1: 30 });
  assert.ok(m.lc < -60);
  assert.equal(niveauContraste(m.lc, 60), 'ok');
});

test('zone uniforme : pas de mesure', () => {
  const px = image(20, 20, [255, 255, 255], [255, 255, 255], { x0: 0, x1: 0, y0: 0, y1: 0 });
  assert.equal(contrasteZone(px, 20, 20, { x0: 0, y0: 0, x1: 20, y1: 20 }), null);
});

test('Otsu sépare deux pics', () => {
  const h = new Uint32Array(256);
  h[30] = 100; h[220] = 300;
  const s = seuilOtsu(h, 400);
  assert.ok(s >= 30 && s < 220);
});

// Fond texturé comme une photo : chaque pixel tiré au hasard autour de `moyenne`, avec un
// générateur fixe pour que le test rende toujours la même chose.
function imageTexturee(l, h, moyenne, amplitude, texte, boite) {
  let graine = 12345;
  const hasard = () => ((graine = (graine * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const px = new Uint8ClampedArray(l * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const dedans = x >= boite.x0 && x < boite.x1 && y >= boite.y0 && y < boite.y1;
      const v = Math.round(moyenne + (hasard() - 0.5) * 2 * amplitude);
      px.set([...(dedans ? texte : [v, v, v]), 255], (y * l + x) * 4);
    }
  }
  return px;
}

test('bruit du fond : nul sur un fond uni, grand sur un fond texturé', () => {
  const boite = { x0: 10, x1: 20, y0: 5, y1: 12 };
  const zone = { x0: 5, y0: 2, x1: 30, y1: 15 };
  assert.equal(bruitFond(image(40, 20, [255, 255, 255], [60, 60, 60], boite), 40, 20, zone), 0);
  // Tache sombre sur un fond qui varie de ± 40 autour de 160, comme dans une photo.
  assert.ok(bruitFond(imageTexturee(40, 20, 160, 40, [60, 60, 60], boite), 40, 20, zone) > BRUIT_FOND_MAX);
  // Texte noir sur un fond blanc à peine bruité, comme dans un graphique en JPEG.
  assert.ok(bruitFond(imageTexturee(40, 20, 245, 6, [0, 0, 0], boite), 40, 20, zone) < BRUIT_FOND_MAX);
});

test('bruit du fond : zone uniforme, pas de mesure', () => {
  const px = image(20, 20, [255, 255, 255], [255, 255, 255], { x0: 0, x1: 0, y0: 0, y1: 0 });
  assert.equal(bruitFond(px, 20, 20, { x0: 0, y0: 0, x1: 20, y1: 20 }), null);
});

test('rotation : retour aux coordonnées d’origine', () => {
  // Image d'origine 100 × 60 ; le point (10, 20) devient (60 − 20, 10) = (40, 10) une fois tourné.
  const b = depuisRotation({ x0: 40, x1: 40, y0: 10, y1: 10 }, 60);
  assert.deepEqual(b, { x0: 10, x1: 10, y0: 20, y1: 20 });
});

test('recouvrement', () => {
  assert.equal(recouvrement({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 0, y0: 0, x1: 5, y1: 5 }), 1);
  assert.equal(recouvrement({ x0: 0, y0: 0, x1: 10, y1: 10 }, { x0: 20, y0: 0, x1: 25, y1: 5 }), 0);
});

test('degré de non-conformité aux seuils', () => {
  assert.equal(niveauTaille(8), 'ok');
  assert.equal(niveauTaille(7.99), 'ameliorer');
  assert.equal(niveauTaille(6.5), 'ameliorer');
  assert.equal(niveauTaille(6.49), 'corriger');
  assert.equal(niveauTaille(null), null);
  assert.equal(niveauContraste(74.5), 'ok');                // Lc 75 par défaut
  assert.equal(niveauContraste(-74.4), 'ameliorer');
  assert.equal(niveauContraste(59.4), 'corriger');
  assert.equal(niveauContraste(89, 90), 'ameliorer');
  assert.equal(niveauContraste(74, 90), 'corriger');
  assert.equal(niveauContraste(74, 75), 'ameliorer');
  assert.equal(niveauContraste(74.5, 75), 'ok');
  assert.equal(niveauContraste(59, 75), 'corriger');
  assert.equal(pireNiveau('ok', null, 'corriger', 'ameliorer'), 'corriger');
  assert.equal(pireNiveau(null, null), null);
});

test('agrandissement nécessaire', () => {
  assert.equal(agrandissement(4), 100);
  assert.equal(agrandissement(6.1), 35);   // 8 / 6,1 = 1,31
});

test('couleur conforme : foncer sur fond clair, éclaircir sur fond sombre', () => {
  const blanc = [255, 255, 255];
  const r = couleurConforme([166, 166, 166], blanc, 70);
  assert.equal(r.sens, 'foncer');
  assert.ok(Math.abs(lc(r.couleur, blanc)) >= 69.5);                         // minimum + 10 de marge
  assert.ok(Math.abs(lc(r.couleur.map((c) => c + 6), blanc)) < 69.5);       // la plus proche, à un pas près
  const s = couleurConforme([90, 90, 120], [20, 30, 60], 70);
  assert.equal(s.sens, 'eclaircir');
  // Texte blanc sur jaune : le blanc ne peut plus s'éclaircir, la réponse est de foncer.
  assert.equal(couleurConforme(blanc, [242, 197, 61], 70).sens, 'foncer');
  // Fond gris moyen : ni le noir ni le blanc n'atteignent Lc 60.
  assert.equal(couleurConforme([150, 150, 150], [160, 160, 160], 70), null);
});

test('i18n : mêmes clés en fr et en de, valeurs remplacées', () => {
  assert.deepEqual(Object.keys(TEXTES.de).sort(), Object.keys(TEXTES.fr).sort());
  assert.equal(T('fr', 'textesLus', { n: 3 }), '3 textes lus.');
  assert.equal(nombre(6.14), '6,1');
  assert.equal(langueInitiale(null, 'de-CH'), 'de');
  assert.equal(langueInitiale(null, 'en-US'), 'fr');
  assert.equal(langueInitiale('de', 'fr-CH'), 'de');
});

test('i18n : ni cadratin ni espace ordinaire devant : ; ? ! en français', () => {
  for (const v of Object.values(TEXTES.fr).flat()) {
    assert.ok(!v.includes('—'), v);
    assert.ok(!/ [:;?!»]|« /.test(v), v);
  }
});

test('regroupement des textes au même défaut', () => {
  const gris = { texte: [166, 166, 166], fond: [255, 255, 255] };
  const l = (texte, pt, lcv, contraste = gris) => ({ texte, pt, lc: lcv, nt: niveauTaille(pt), nc: niveauContraste(lcv), contraste });
  const groupes = regrouper([l('100', 6.0, 42), l('Source', 5.3, 31), l('75', 5.7, 42), l('42', 8.6, -32, { texte: [255, 255, 255], fond: [242, 197, 61] })]);
  assert.deepEqual(groupes.map((g) => g.membres.map((m) => m.texte)), [['100', '75'], ['Source'], ['42']]);
  assert.equal(groupes[0].representant.texte, '75');
});

test('regroupement souple : par style de texte, quel que soit le degré', () => {
  const style = (texte, fond) => ({ texte, fond });
  const gris = style([140, 140, 140], [255, 255, 255]);
  const vert = style([30, 120, 90], [215, 235, 228]);
  const l = (texte, pt, lcv, contraste) => ({ texte, pt, lc: lcv, nt: niveauTaille(pt), nc: niveauContraste(lcv), niveau: pireNiveau(niveauTaille(pt), niveauContraste(lcv)), contraste });
  const groupes = regrouper([l('a', 3.0, 47, gris), l('b', 3.4, 52, gris), l('c', 4.2, 58, vert), l('d', 3.9, 44, vert), l('e', 2.0, 47, gris)], { souple: true });
  assert.deepEqual(groupes.map((g) => g.membres.map((m) => m.texte)), [['a', 'b'], ['c', 'd'], ['e']]);
  assert.equal(groupes[1].representant.texte, 'd');
});

test('diagnostic d’ensemble : seulement si la moitié des textes est trop petite', () => {
  const l = (pt) => ({ pt });
  assert.equal(diagnosticEnsemble([3, 3.5, 4, 9, 10].map(l)), null);            // moins de 5 petits
  const d = diagnosticEnsemble([3, 3.2, 3.4, 3.6, 4, 9, 10].map(l));
  assert.equal(d.petits, 5);
  assert.equal(d.mediane, 3.6);
  assert.equal(d.facteur.toFixed(2), '2.22');
  assert.equal(diagnosticEnsemble([3, 3, 3, 3, 3, 9, 9, 9, 9, 9, 9].map(l)), null); // moins de la moitié
  assert.equal(quantile([1, 2, 3, 4], 0.25), 1.75);
});

test('projection : taille apparente et équivalent papier', async () => {
  const { cadreFigure, largeurApparenteCm, minusculeMinCm, DIAPO, SALLES, CM_PAR_PT } = await import('../js/projection.js');
  const { RATIO_X } = await import('../js/analyse.js');
  // Un écran de 145 cm vu à 5 m paraît aussi large que 17,4 cm vus à 60 cm.
  assert.equal(largeurApparenteCm(145, 500).toFixed(1), '17.4');
  // DISCAS : à 5 m, une minuscule doit mesurer 2,5 cm. Un texte de 24 pt sur la
  // diapositive n'y arrive pas dans la petite salle (1,9 cm), 32 pt oui (2,5 cm).
  assert.equal(minusculeMinCm(500), 2.5);
  const x = (pt) => pt * CM_PAR_PT / DIAPO.largeurCm * SALLES.petite.largeurCm * RATIO_X;
  assert.ok(x(24) < minusculeMinCm(SALLES.petite.distanceCm));
  assert.ok(x(32) >= minusculeMinCm(SALLES.petite.distanceCm) - 0.05);
  // Une figure large est limitée par la largeur, une figure haute par la hauteur.
  assert.equal(cadreFigure(0.25).l.toFixed(2), '0.92');
  const haute = cadreFigure(1);
  assert.ok(Math.abs(haute.h - DIAPO.hauteur * (1 - DIAPO.titre - DIAPO.bas)) < 1e-9);
});

test('basse vision : flou à l’échelle de la figure imprimée', async () => {
  const { flouMm, flouPx, filtreFlou, MM_PAR_MINUTE } = await import('../js/vision.js');
  // 1 minute d'arc à 40 cm vaut 0,116 mm ; une acuité de 3/10 floute de 0,39 mm.
  assert.equal(MM_PAR_MINUTE.toFixed(3), '0.116');
  assert.equal(flouMm(0.3).toFixed(2), '0.39');
  // Image de 1600 px imprimée sur 172 mm : 9,3 px par mm.
  assert.equal(flouPx(0.3, 1600, 172).toFixed(1), '3.6');
  assert.equal(filtreFlou(0.5, 1600, 172), 'blur(2.16px)');
});

test('basse vision : seuil et confort de lecture à 40 cm', async () => {
  const { lectureAcuite } = await import('../js/vision.js');
  // 5/10 : hauteur d'x de 10 minutes d'arc, soit 1,16 mm, corps 6,3 pt ; confort 12,7 pt.
  assert.equal(lectureAcuite(0.5).seuil.toFixed(1), '6.3');
  assert.equal(lectureAcuite(0.5).confort.toFixed(1), '12.7');
  assert.equal(lectureAcuite(0.3).seuil.toFixed(1), '10.6');
});

test('basse vision : CSF en log-parabole', async () => {
  const { csf, PROFILS } = await import('../js/vision.js');
  const s = csf(PROFILS.contraste);
  assert.equal(s(1), 20);
  assert.equal(s(3), 20);
  assert.ok(Math.abs(s(3 * 2 ** 1.5) - 10) < 1e-9);  // moitié à largeur / 2 octaves
});

test('basse vision : un motif peu contrasté disparaît, un motif contrasté reste', async () => {
  const { seuillerContraste, flouGaussien, csf, PROFILS } = await import('../js/vision.js');
  const l = 128, h = 32;
  const rayures = (amplitude) => Float32Array.from({ length: l * h }, (_, i) => 0.5 * (1 + amplitude * Math.sign(Math.sin((2 * Math.PI * (i % l)) / 16))));
  const ecart = (c) => { let mn = 1, mx = 0; for (let x = 32; x < 96; x++) { mn = Math.min(mn, c[16 * l + x]); mx = Math.max(mx, c[16 * l + x]); } return (mx - mn) / (mx + mn); };
  // 16 px par période et 64 px par degré : 4 cycles par degré, seuil de 5 % pour ce profil.
  const sens = csf(PROFILS.contraste);
  assert.ok(ecart(seuillerContraste(rayures(0.02), l, h, 64, sens)) < 0.005);
  assert.ok(ecart(seuillerContraste(rayures(0.5), l, h, 64, sens)) > 0.4);
  // Le flou garde la moyenne d'une image uniforme.
  const uni = flouGaussien(new Float32Array(l * h).fill(0.3), l, h, 5);
  assert.ok(Math.abs(uni[16 * l + 64] - 0.3) < 1e-6);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  statutInitial, verdictProvisoire, SCORE_SUR, HAUTEUR_BOITE_MIN, RAPPORT_CORPS_MIN, PLANCHER_LECTURE_PT, formeCompacte, FORME_ASPECT_MIN, compte, visible, compteSignes, CONFIANCE_SURE, CONFIANCE_SURE_COURTE, CONFIANCE_SURE_TOURNEE, SIGNES_PEU,
  profilEncre, mesurerProfil, mesurerZone, PALIER_DENSE,
  carteEncre, composantes, signePossible, alignerSignes, zonesEncre, masquer, partBords, BORDS_MAX,
  versOrigine, versCanevas, boiteNormalisee, recouvreUnTexte,
  exporterLecture, VERSION_EXPORT, STATUTS, ORIGINES, trancherAVerifier,
} from '../js/residu.js';
import { BRUIT_FOND_MAX, RATIO_X, RATIO_CAPITALE } from '../js/analyse.js';

// ── Statut ──────────────────────────────────────────────────────────────────────

test('statut initial : lu dans le fichier, confirmé ; suggestion, à vérifier', () => {
  assert.equal(statutInitial({ origine: 'fichier', texte: 'A' }), 'confirme');
  assert.equal(statutInitial({ origine: 'suggestion', texte: '' }), 'a-verifier');
});

test('statut initial d’un texte OCR : les raisons d’être à vérifier', () => {
  const sur = { origine: 'ocr', texte: 'Effectif', confiance: 92, bruit: 0.05, vertical: false };
  assert.equal(statutInitial(sur), 'confirme');
  assert.equal(statutInitial({ ...sur, confiance: CONFIANCE_SURE - 1 }), 'a-verifier');
  assert.equal(statutInitial({ ...sur, confiance: CONFIANCE_SURE }), 'confirme');
  assert.equal(statutInitial({ ...sur, texte: '125' }), 'confirme');
  assert.equal(statutInitial({ ...sur, bruit: BRUIT_FOND_MAX + 0.01 }), 'a-verifier');
  assert.equal(statutInitial({ ...sur, origine: 'suggestion' }), 'a-verifier');
  assert.equal(SIGNES_PEU, 2);
  assert.equal(compteSignes('a-b 7'), 3);
});

test('statut initial : texte court, à vérifier seulement si l’OCR n’en est pas très sûr', () => {
  const court = { origine: 'ocr', texte: '50', confiance: 95, bruit: 0.05, vertical: false };
  assert.equal(statutInitial(court), 'confirme');                                  // court et sûr → confirme
  assert.equal(statutInitial({ ...court, texte: '0 %' }), 'confirme');
  assert.equal(statutInitial({ ...court, confiance: CONFIANCE_SURE_COURTE }), 'confirme');
  assert.equal(statutInitial({ ...court, confiance: CONFIANCE_SURE_COURTE - 1 }), 'a-verifier'); // court et peu sûr → a-verifier
  assert.equal(statutInitial({ ...court, confiance: null }), 'a-verifier');        // zone non lue
  assert.equal(statutInitial({ ...court, texte: '', confiance: null }), 'a-verifier');
  assert.equal(statutInitial({ ...court, texte: '12', confiance: CONFIANCE_SURE - 1 }), 'a-verifier');
});

test('statut initial : texte vertical, à vérifier s’il est peu sûr ou court', () => {
  const tourne = { origine: 'ocr', texte: 'Effectif', confiance: 92, bruit: 0.05, vertical: true };
  assert.equal(statutInitial(tourne), 'confirme');                                  // vertical sûr et long → confirme
  assert.equal(statutInitial({ ...tourne, confiance: CONFIANCE_SURE_TOURNEE }), 'confirme');
  assert.equal(statutInitial({ ...tourne, confiance: CONFIANCE_SURE_TOURNEE - 1 }), 'a-verifier'); // vertical peu sûr → a-verifier
  assert.equal(statutInitial({ ...tourne, texte: '50', confiance: 99 }), 'a-verifier');      // vertical court et sûr → a-verifier
  assert.equal(statutInitial({ ...tourne, confiance: null }), 'a-verifier');
  assert.equal(CONFIANCE_SURE_COURTE, 85);
  assert.equal(CONFIANCE_SURE_TOURNEE, 90);
});

test('seuls confirmé et ajouté comptent ; retiré n’est plus visible', () => {
  assert.deepEqual(STATUTS.filter(compte), ['confirme', 'ajoute']);
  assert.deepEqual(STATUTS.filter(visible), ['confirme', 'a-verifier', 'ajoute']);
  assert.equal(ORIGINES.length, 5);
});

// ── Profil d'encre ──────────────────────────────────────────────────────────────

// Image l × h à fond `fond` ; `traits` dessine des rectangles de couleur `encre`.
function image(l, h, fond, encre, traits) {
  const px = new Uint8ClampedArray(l * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < l; x++) {
      const dedans = traits.some((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1);
      px.set([...(dedans ? encre : fond), 255], (y * l + x) * 4);
    }
  }
  return px;
}

// Ligne de texte synthétique : hampes de y = 4 à 8, hauteur d'x de 8 à 18, descendante de
// 18 à 22. Les rangées de la hauteur d'x portent cinq traits, celles des hampes deux, la
// descendante un.
function ligneSynthetique(y = 0, x = 0) {
  const traits = [];
  for (let i = 0; i < 5; i++) traits.push({ x0: x + 4 + i * 10, x1: x + 6 + i * 10, y0: y + 8, y1: y + 18 });
  traits.push({ x0: x + 4, x1: x + 6, y0: y + 4, y1: y + 8 }, { x0: x + 34, x1: x + 36, y0: y + 4, y1: y + 8 });
  traits.push({ x0: x + 24, x1: x + 26, y0: y + 18, y1: y + 22 });
  return traits;
}

test('mesure d’un profil : hauteur d’x et de capitale par deux paliers', () => {
  // 4 rangées de hampes à 0,1, 10 rangées de hauteur d'x à 0,3 (une barre à 0,45), 4 de
  // descendante à 0,04.
  const profil = [0.1, 0.1, 0.1, 0.1, 0.3, 0.3, 0.45, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.04, 0.04, 0.04, 0.04];
  const m = mesurerProfil(profil);
  assert.equal(m.hauteurX, 10);
  assert.equal(m.hauteurCapitale, 14);
  assert.ok(Math.abs(m.corpsPx - (10 / RATIO_X + 14 / RATIO_CAPITALE) / 2) < 1e-9);
  assert.equal(PALIER_DENSE, 0.6);
});

test('mesure d’un profil : capitales ou chiffres seuls, plusieurs lignes, profil vide', () => {
  // Que des capitales : la bande dense couvre toute la bande encrée.
  const caps = mesurerProfil(new Array(14).fill(0.35));
  assert.equal(caps.hauteurX, 14);
  assert.ok(Math.abs(caps.corpsPx - 14 / RATIO_CAPITALE) < 1e-9);
  // Deux lignes séparées par des rangées vides : médiane des deux mesures (identiques ici).
  const une = [0.1, 0.1, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3];
  const deux = mesurerProfil([...une, 0, 0, 0, ...une]);
  assert.equal(deux.hauteurX, 6);
  assert.equal(deux.hauteurCapitale, 8);
  // Un filet d'une rangée n'est pas une ligne de texte.
  assert.equal(mesurerProfil([0, 0, 1, 0, 0]), null);
  assert.equal(mesurerProfil([0, 0, 0]), null);
  assert.equal(mesurerProfil(null), null);
});

test('profil d’encre sur une ligne synthétique, sombre sur clair et clair sur sombre', () => {
  const l = 60, h = 30;
  const boite = { x0: 0, y0: 0, x1: l, y1: h };
  for (const [fond, encre] of [[[255, 255, 255], [20, 20, 20]], [[30, 30, 60], [240, 240, 240]]]) {
    const px = image(l, h, fond, encre, ligneSynthetique());
    const profil = profilEncre(px, l, h, boite);
    assert.equal(profil.length, h);
    assert.ok(Math.abs(profil[10] - 10 / l) < 1e-6, 'rangée de hauteur d’x : cinq traits de 2 px');
    assert.ok(Math.abs(profil[5] - 4 / l) < 1e-6, 'rangée de hampe : deux traits');
    assert.equal(profil[0], 0);
    const m = mesurerProfil(profil);
    assert.equal(m.hauteurX, 10);
    assert.equal(m.hauteurCapitale, 14);
    const z = mesurerZone(px, l, h, boite);
    assert.equal(z.vertical, false);
    assert.ok(Math.abs(z.corpsPx - m.corpsPx) < 1e-9);
  }
  // Zone unie : rien à mesurer.
  assert.equal(profilEncre(image(l, h, [255, 255, 255], [0, 0, 0], []), l, h, boite), null);
});

test('zone haute et étroite : texte vertical, profil par colonnes', () => {
  // Le même texte tourné : les traits deviennent horizontaux, le profil se lit par colonnes.
  const l = 30, h = 60;
  const traits = ligneSynthetique().map((r) => ({ x0: r.y0, x1: r.y1, y0: r.x0, y1: r.x1 }));
  const px = image(l, h, [255, 255, 255], [0, 0, 0], traits);
  const z = mesurerZone(px, l, h, { x0: 0, y0: 0, x1: l, y1: h });
  assert.equal(z.vertical, true);
  assert.equal(z.hauteurX, 10);
  assert.equal(z.hauteurCapitale, 14);
});

// ── Zones d'encre ───────────────────────────────────────────────────────────────

test('carte d’encre : sombre et clair séparés ; masquage', () => {
  const l = 40, h = 20;
  // Barre sombre à gauche avec un trait clair dedans, trait sombre sur fond blanc à droite.
  const px = image(l, h, [255, 255, 255], [0, 0, 0], [{ x0: 0, x1: 18, y0: 0, y1: 20 }, { x0: 28, x1: 30, y0: 4, y1: 14 }]);
  for (let y = 6; y < 12; y++) px.set([255, 255, 255, 255], (y * l + 8) * 4);
  const carte = carteEncre(px, l, h, 6);
  assert.equal(carte[8 * l + 8], 2, 'trait clair dans la barre');
  assert.equal(carte[8 * l + 28], 1, 'trait sombre sur blanc');
  assert.equal(carte[2 * l + 38], 0, 'blanc loin de tout');
  masquer(carte, l, h, [{ x0: 27, y0: 3, x1: 31, y1: 15 }], 0);
  assert.equal(carte[8 * l + 28], 0);
});

test('composantes connexes et forme d’un signe', () => {
  const l = 20, h = 10;
  const carte = new Uint8Array(l * h);
  // Un carré plein 4 × 4, un trait 2 × 6 et un signe en L (deux traits qui se touchent).
  for (let y = 1; y < 5; y++) carte.fill(1, y * l + 1, y * l + 5);
  for (let y = 2; y < 8; y++) carte.fill(1, y * l + 8, y * l + 10);
  for (let y = 1; y < 7; y++) carte[y * l + 14] = 1;
  carte.fill(1, 6 * l + 14, 6 * l + 18);
  const c = composantes(carte, l, h).sort((a, b) => a.x0 - b.x0);
  assert.equal(c.length, 3);
  assert.deepEqual([c[0].x0, c[0].y0, c[0].x1, c[0].y1, c[0].n], [1, 1, 5, 5, 16]);
  assert.deepEqual([c[2].x0, c[2].y0, c[2].x1, c[2].y1, c[2].n], [14, 1, 18, 7, 9]);
  assert.equal(signePossible(c[0], 2, 10), false, 'carré plein');
  assert.equal(signePossible(c[1], 2, 10), true, 'trait plein mais mince');
  assert.equal(signePossible(c[2], 2, 10), true, 'L');
  assert.equal(signePossible(c[2], 8, 10), false, 'trop petit');
  assert.equal(signePossible({ x0: 0, y0: 0, x1: 12, y1: 6, n: 72 }, 2, 10), false, 'rectangle plein : un aplat');
});

test('alignement des signes en lignes', () => {
  const s = (x0, x1, y0, y1, valeur = 1) => ({ x0, x1, y0, y1, n: 4, valeur });
  // Trois signes alignés, un quatrième trop loin, un cinquième sur une autre rangée.
  const lignes = alignerSignes([s(0, 4, 0, 10), s(6, 10, 1, 10), s(13, 17, 0, 9), s(60, 64, 0, 10), s(0, 4, 30, 40)]);
  assert.equal(lignes.length, 1);
  assert.deepEqual([lignes[0].x0, lignes[0].x1, lignes[0].y0, lignes[0].y1, lignes[0].signes], [0, 17, 0, 10, 3]);
  // Un signe seul assez large est un mot soudé.
  assert.equal(alignerSignes([s(0, 20, 0, 10)]).length, 1);
  assert.equal(alignerSignes([s(0, 8, 0, 10)]).length, 0);
  // Encre sombre et claire ne se mêlent pas.
  assert.equal(alignerSignes([s(0, 4, 0, 10, 1), s(6, 10, 0, 10, 2)]).length, 0);
});

test('zones d’encre : une ligne oubliée est proposée, une ligne masquée et une barre pleine ne le sont pas', () => {
  const l = 160, h = 80;
  const traits = [...ligneSynthetique(10, 10), ...ligneSynthetique(50, 60), { x0: 100, x1: 150, y0: 5, y1: 30 }];
  const px = image(l, h, [255, 255, 255], [0, 0, 0], traits);
  const options = { hMin: 3, hMax: 30 };
  const toutes = zonesEncre(px, l, h, options);
  assert.equal(toutes.length, 2, JSON.stringify(toutes));
  // Ligne 1 : traits de x = 14 à 56, de y = 14 (hampes) à 32 (descendante), cinq signes.
  assert.ok(toutes[0].y0 >= 12 && toutes[0].y1 <= 34 && toutes[0].x0 >= 12 && toutes[0].x1 <= 58, JSON.stringify(toutes[0]));
  assert.equal(toutes[0].signes, 5);
  // La première ligne connue (masquée) : seule la seconde reste.
  const reste = zonesEncre(px, l, h, { ...options, boites: [{ x0: 10, y0: 12, x1: 50, y1: 34 }] });
  assert.equal(reste.length, 1);
  assert.ok(reste[0].y0 >= 52);
});

test('part de bords : une photo ou une trame en a beaucoup, un graphique peu', () => {
  const l = 60, h = 40;
  // Graphique : fond blanc, une ligne de texte, une barre.
  const graphique = image(l, h, [255, 255, 255], [0, 0, 0], [...ligneSynthetique(4, 4), { x0: 44, x1: 56, y0: 4, y1: 36 }]);
  assert.ok(partBords(graphique, l, h) < 0.2, String(partBords(graphique, l, h)));
  // Photo : chaque pixel tiré au hasard, avec un générateur fixe.
  let graine = 4242;
  const hasard = () => ((graine = (graine * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const photo = new Uint8ClampedArray(l * h * 4);
  for (let i = 0; i < l * h; i++) photo.set([120 + hasard() * 80, 100 + hasard() * 80, 90 + hasard() * 80, 255], i * 4);
  assert.ok(partBords(photo, l, h) > BORDS_MAX, String(partBords(photo, l, h)));
  // Sur une telle image, aucune zone n'est proposée.
  assert.deepEqual(zonesEncre(photo, l, h, { hMin: 2, hMax: 20 }), []);
});

// ── Coordonnées ─────────────────────────────────────────────────────────────────

test('coordonnées : canevas vers image d’origine et retour', () => {
  // Image de 800 px analysée sur un canevas de 3440 px.
  const echelle = 800 / 3440;
  const b = { x0: 344, y0: 86, x1: 1720, y1: 172 };
  assert.deepEqual(versOrigine(b, echelle), { x0: 80, y0: 20, x1: 400, y1: 40 });
  const retour = versCanevas(versOrigine(b, echelle), echelle);
  for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Math.abs(retour[k] - b[k]) < 0.5);
  // Arrondi au dixième.
  assert.deepEqual(versOrigine({ x0: 1, y0: 1, x1: 2, y1: 2 }, 1 / 3), { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7 });
});

test('boîte d’un glisser : ordonnée et bornée ; recouvrement d’un texte connu', () => {
  assert.deepEqual(boiteNormalisee({ x: 50, y: 40 }, { x: -5, y: 10 }, 100, 60), { x0: 0, y0: 10, x1: 50, y1: 40 });
  assert.deepEqual(boiteNormalisee({ x: 10, y: 10 }, { x: 200, y: 200 }, 100, 60), { x0: 10, y0: 10, x1: 100, y1: 60 });
  const lignes = [{ statut: 'confirme', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } }, { statut: 'retire', bbox: { x0: 50, y0: 50, x1: 60, y1: 60 } }];
  assert.equal(recouvreUnTexte({ x0: 2, y0: 2, x1: 8, y1: 8 }, lignes), true);
  assert.equal(recouvreUnTexte({ x0: 52, y0: 52, x1: 58, y1: 58 }, lignes), false, 'un texte retiré ne compte plus');
  assert.equal(recouvreUnTexte({ x0: 20, y0: 20, x1: 30, y1: 30 }, lignes), false);
});

// ── Export ──────────────────────────────────────────────────────────────────────

test('export : schéma complet et stable, coordonnées d’origine, textes retirés gardés', () => {
  const lignes = [
    { id: 't1', texte: 'Effectif', bbox: { x0: 344, y0: 86, x1: 1720, y1: 172 }, exact: false, statut: 'confirme', origine: 'ocr',
      pt: 7.246, lc: -62.44, contraste: { texte: [20, 20, 20], fond: [255, 255, 255] }, nt: 'ameliorer', nc: 'ameliorer', niveau: 'ameliorer' },
    { id: 't2', texte: '', bbox: { x0: 0, y0: 0, x1: 86, y1: 43 }, exact: false, statut: 'retire', origine: 'suggestion',
      pt: null, lc: null, contraste: null, nt: null, nc: null, niveau: null },
  ];
  const e = exporterLecture({
    figure: { nom: 'fig.png', type: 'bitmap', largeurPx: 800, hauteurPx: 400 },
    reglages: { format: 'revue', proportion: 1, seuilLc: 75, largeurMm: 171.9166, hauteurMm: 85.958, pxParMm: 4.6534 },
    verdict: 'ameliorer',
    lignes,
    echelle: 800 / 3440,
    diagnosticEnsemble: null,
  });
  assert.deepEqual(Object.keys(e), ['version', 'figure', 'reglages', 'verdict', 'verdictProvisoire', 'textesAVerifier', 'textes', 'objets', 'series', 'diagnosticEnsemble']);
  assert.equal(e.version, VERSION_EXPORT);
  assert.deepEqual(e.figure, { nom: 'fig.png', type: 'bitmap', largeurPx: 800, hauteurPx: 400 });
  assert.deepEqual(e.reglages, { format: 'revue', proportion: 1, seuilLc: 75, largeurMm: 171.92, hauteurMm: 85.96, pxParMm: 4.653 });
  assert.equal(e.verdict, 'ameliorer');
  assert.deepEqual(e.objets, []);
  assert.deepEqual(e.series, []);
  assert.equal(e.diagnosticEnsemble, null);
  assert.equal(e.textes.length, 2);
  assert.deepEqual(Object.keys(e.textes[0]), ['id', 'texte', 'boite', 'exact', 'statut', 'origine', 'confiance', 'score', 'corpsPt', 'lc', 'couleurTexte', 'couleurFond', 'niveauTaille', 'niveauContraste', 'niveau']);
  assert.deepEqual(e.textes[0], {
    id: 't1', texte: 'Effectif', boite: { x0: 80, y0: 20, x1: 400, y1: 40 }, exact: false, statut: 'confirme', origine: 'ocr', confiance: null, score: null,
    corpsPt: 7.25, lc: -62.4, couleurTexte: '#141414', couleurFond: '#FFFFFF', niveauTaille: 'ameliorer', niveauContraste: 'ameliorer', niveau: 'ameliorer',
  });
  assert.deepEqual(e.textes[1], {
    id: 't2', texte: '', boite: { x0: 0, y0: 0, x1: 20, y1: 10 }, exact: false, statut: 'retire', origine: 'suggestion', confiance: null, score: null,
    corpsPt: null, lc: null, couleurTexte: null, couleurFond: null, niveauTaille: null, niveauContraste: null, niveau: null,
  });
  // Stable : deux exports des mêmes données sont identiques, et l'objet passe par JSON tel quel.
  assert.equal(JSON.stringify(e), JSON.stringify(JSON.parse(JSON.stringify(e))));
});

test('export : diagnostic d’ensemble arrondi', () => {
  const e = exporterLecture({
    figure: { nom: 'f.svg', type: 'svg', largeurPx: 600, hauteurPx: 300 },
    reglages: { format: 'livre', proportion: 0.5, seuilLc: 90, largeurMm: 57.5, hauteurMm: 28.75, pxParMm: 10.4348 },
    verdict: 'corriger', lignes: [], echelle: 1,
    diagnosticEnsemble: { total: 12, petits: 9, bas: 3.123, haut: 4.456, mediane: 3.789, facteur: 2.1111 },
  });
  assert.deepEqual(e.diagnosticEnsemble, { total: 12, petits: 9, bas: 3.12, haut: 4.46, mediane: 3.79, facteur: 2.11 });
  assert.equal(e.reglages.proportion, 0.5);
});

// ── Boîtes du détecteur ─────────────────────────────────────────────────────────

test('statut initial d’une boîte du détecteur : le score confirme, même sans libellé lu', () => {
  const boite = { x0: 10, y0: 10, x1: 90, y1: 30 };
  const sure = { origine: 'detecteur', texte: '?', lectureIncertaine: true, confiance: 0, score: SCORE_SUR, bruit: 0.05, vertical: false, bbox: boite, corpsPx: 14 };
  assert.equal(statutInitial(sure), 'confirme');                                          // « ? » confirmé : le libellé n'entre pas
  assert.equal(statutInitial({ ...sure, texte: 'Effectif', confiance: 30 }), 'confirme');  // lecture peu sûre, boîte sûre
  assert.equal(statutInitial({ ...sure, texte: '5', vertical: true }), 'confirme');
  assert.equal(statutInitial({ ...sure, score: SCORE_SUR - 0.01 }), 'a-verifier');         // score trop bas, lecture vide
  assert.equal(statutInitial({ ...sure, bruit: BRUIT_FOND_MAX + 0.01 }), 'a-verifier');    // fond bruité
  assert.equal(statutInitial({ ...sure, bbox: { x0: 0, y0: 0, x1: 80, y1: HAUTEUR_BOITE_MIN - 1 } }), 'a-verifier'); // trait
  assert.equal(statutInitial({ ...sure, corpsPx: RAPPORT_CORPS_MIN * 20 - 1 }), 'a-verifier'); // corps incohérent avec la boîte
  assert.equal(statutInitial({ ...sure, corpsPx: RAPPORT_CORPS_MIN * 20 }), 'confirme');
  assert.equal(statutInitial({ ...sure, corpsPx: null }), 'confirme');                       // corps non mesuré
});

test('statut initial d’une boîte du détecteur : une mesure qui contredit la boîte ou la lecture ne confirme jamais', () => {
  const lue = { origine: 'detecteur', texte: 'Physiotherapie', confiance: 90, score: SCORE_SUR - 0.2, bruit: 0.05, vertical: false, bbox: { x0: 0, y0: 0, x1: 80, y1: 20 }, corpsPx: 14, corpsPt: 8 };
  assert.equal(statutInitial(lue), 'confirme');
  // corps incohérent avec la boîte : même chemin de lecture, même veto que pour le score
  assert.equal(statutInitial({ ...lue, corpsPx: RAPPORT_CORPS_MIN * 20 - 1 }), 'a-verifier');
  assert.equal(statutInitial({ ...lue, bbox: { x0: 0, y0: 0, x1: 80, y1: HAUTEUR_BOITE_MIN - 1 } }), 'a-verifier');
  // lecture sûre d'un texte mesuré sous le plancher physique
  assert.equal(statutInitial({ ...lue, corpsPt: PLANCHER_LECTURE_PT }), 'confirme');
  assert.equal(statutInitial({ ...lue, corpsPt: PLANCHER_LECTURE_PT - 0.1 }), 'a-verifier');
  assert.equal(statutInitial({ ...lue, confiance: CONFIANCE_SURE - 1, corpsPt: 1.34 }), 'a-verifier'); // peu sûr : la lecture décide déjà
  assert.equal(statutInitial({ ...lue, corpsPt: 1.34, score: SCORE_SUR }), 'a-verifier');   // sûr par le score, lecture sûre contredite
  assert.equal(statutInitial({ ...lue, confiance: 0, texte: '?', score: SCORE_SUR, corpsPt: 3 }), 'confirme'); // vrai texte minuscule, rien de lu : le score tient
  assert.equal(statutInitial({ ...lue, corpsPt: null }), 'confirme');
});

test('statut initial d’une boîte du détecteur sous le score sûr : la lecture décide, comme pour l’OCR', () => {
  const bas = { origine: 'detecteur', texte: 'Effectif', confiance: 92, score: SCORE_SUR - 0.1, bruit: 0.05, vertical: false, bbox: { x0: 0, y0: 0, x1: 80, y1: 20 }, corpsPx: 14 };
  assert.equal(statutInitial(bas), 'confirme');
  assert.equal(statutInitial({ ...bas, confiance: CONFIANCE_SURE - 1 }), 'a-verifier');
  assert.equal(statutInitial({ ...bas, texte: '?', confiance: 0 }), 'a-verifier');
  assert.equal(statutInitial({ ...bas, score: undefined, confiance: CONFIANCE_SURE - 1 }), 'a-verifier');
  // Une ligne de l'OCR ne passe pas par le score.
  assert.equal(statutInitial({ origine: 'ocr', texte: '?', confiance: 0, score: 0.99, bruit: 0.05 }), 'a-verifier');
});

// ── Verdict provisoire ──────────────────────────────────────────────────────────

test('verdict provisoire : « ok » seulement, et seulement s’il reste des textes à vérifier', () => {
  assert.equal(verdictProvisoire('ok', 0), false);
  assert.equal(verdictProvisoire('ok', 1), true);
  assert.equal(verdictProvisoire('ok', 40), true);
  assert.equal(verdictProvisoire('ameliorer', 3), false);   // le verdict tient, on ajoute « N texte(s) restent à vérifier. »
  assert.equal(verdictProvisoire('corriger', 3), false);
  assert.equal(verdictProvisoire('corriger', 0), false);
});

test('export : verdict provisoire et textes à vérifier, verdict inchangé', () => {
  const base = {
    figure: { nom: 'f.png', type: 'bitmap', largeurPx: 100, hauteurPx: 50 },
    reglages: { format: 'revue', proportion: 1, seuilLc: 75, largeurMm: 100, hauteurMm: 50, pxParMm: 1 },
    lignes: [{ id: 't1', texte: '?', bbox: { x0: 0, y0: 0, x1: 10, y1: 5 }, statut: 'confirme', origine: 'detecteur', confiance: 12.34, score: 0.8123 }],
    echelle: 1, diagnosticEnsemble: null,
  };
  const provisoire = exporterLecture({ ...base, verdict: 'ok', aVerifier: 4 });
  assert.equal(provisoire.verdict, 'ok');
  assert.equal(provisoire.verdictProvisoire, true);
  assert.equal(provisoire.textesAVerifier, 4);
  assert.equal(provisoire.textes[0].confiance, 12.3);
  assert.equal(provisoire.textes[0].score, 0.812);
  const net = exporterLecture({ ...base, verdict: 'ok', aVerifier: 0 });
  assert.deepEqual([net.verdictProvisoire, net.textesAVerifier], [false, 0]);
  const corriger = exporterLecture({ ...base, verdict: 'corriger', aVerifier: 4 });
  assert.deepEqual([corriger.verdict, corriger.verdictProvisoire, corriger.textesAVerifier], ['corriger', false, 4]);
});

// ── Formes lues comme des lettres ───────────────────────────────────────────────

// Tampon l × h, fond blanc, encre noire là où `dessin(x, y)` est vrai.
function tampon(l, h, dessin) {
  const rgba = new Uint8ClampedArray(l * h * 4).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < l; x++) if (dessin(x, y)) rgba.set([0, 0, 0, 255], (y * l + x) * 4);
  return rgba;
}
const tout = (l, h) => ({ x0: 0, y0: 0, x1: l, y1: h });

test('forme compacte : un cercle, un anneau et un carré sont des formes, un chiffre ou un mot ne le sont pas', () => {
  const disque = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  assert.equal(formeCompacte(tampon(40, 40, disque(20, 20, 14)), 40, 40, tout(40, 40)), true);
  const anneau = (x, y) => { const d = (x - 20) ** 2 + (y - 20) ** 2; return d <= 14 * 14 && d >= 10 * 10; };
  assert.equal(formeCompacte(tampon(40, 40, anneau), 40, 40, tout(40, 40)), true);
  assert.equal(formeCompacte(tampon(40, 40, (x, y) => x >= 8 && x < 32 && y >= 8 && y < 32), 40, 40, tout(40, 40)), true);
  // un zéro : anneau plus haut que large (0,6)
  const zero = (x, y) => { const d = ((x - 20) / 8) ** 2 + ((y - 20) / 14) ** 2; return d <= 1 && d >= 0.45; };
  assert.equal(formeCompacte(tampon(40, 40, zero), 40, 40, tout(40, 40)), false);
  // deux blocs de même taille : deux signes, pas une forme
  const deux = (x, y) => y >= 10 && y < 30 && ((x >= 6 && x < 16) || (x >= 24 && x < 34));
  assert.equal(formeCompacte(tampon(40, 40, deux), 40, 40, tout(40, 40)), false);
  // un mot soudé, deux fois plus large que haut
  assert.equal(formeCompacte(tampon(60, 30, (x, y) => x >= 6 && x < 54 && y >= 8 && y < 22), 60, 30, tout(60, 30)), false);
  // un point à côté d'un bloc compact ne change rien (moins de 10 % du plus gros)
  const avecPoint = (x, y) => (x >= 8 && x < 28 && y >= 10 && y < 30) || (x >= 32 && x < 34 && y >= 28 && y < 30);
  assert.equal(formeCompacte(tampon(40, 40, avecPoint), 40, 40, tout(40, 40)), true);
  assert.equal(formeCompacte(tampon(40, 40, () => false), 40, 40, tout(40, 40)), false);       // zone unie
  assert.ok(FORME_ASPECT_MIN < 1);
});

test('statut initial : une forme lue comme une lettre n’est jamais confirmée', () => {
  const lue = { origine: 'detecteur', texte: 'A', confiance: 91, score: 0.8, bruit: 0.05, vertical: false, bbox: { x0: 0, y0: 0, x1: 30, y1: 30 }, corpsPx: 20, corpsPt: 9 };
  assert.equal(statutInitial(lue), 'confirme');
  assert.equal(statutInitial({ ...lue, forme: false }), 'confirme');
  assert.equal(statutInitial({ ...lue, forme: true }), 'a-verifier');                          // par le score
  assert.equal(statutInitial({ ...lue, forme: true, score: 0.6 }), 'a-verifier');              // par la lecture
});

// ── Trancher les textes à vérifier d'un coup ────────────────────────────────────

test('trancher : seuls les textes à vérifier changent, les autres statuts restent', () => {
  const lignes = [
    { id: 't1', statut: 'a-verifier' },
    { id: 't2', statut: 'confirme' },
    { id: 't3', statut: 'a-verifier' },
    { id: 't4', statut: 'retire' },
    { id: 't5', statut: 'ajoute' },
  ];
  const changes = trancherAVerifier(lignes, 'retire');
  assert.deepEqual(changes.map((l) => l.id), ['t1', 't3']);
  assert.deepEqual(lignes.map((l) => l.statut), ['retire', 'confirme', 'retire', 'retire', 'ajoute']);
  assert.deepEqual(trancherAVerifier(lignes, 'confirme'), []);
});

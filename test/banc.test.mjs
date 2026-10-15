// Banc d'essai : appariement par position et métriques, sur des données synthétiques.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  iou, centreDans, aireUnion, apparierBoites, niveauAttendu, lcReference, normaliserExport, couleursDistinctes, parametreFigure,
  evaluerVerdict, evaluerTextes, evaluerObjets, evaluer, totaliser, tableau, details,
} from '../outils/banc.mjs';
import { convertir, verdictDe, hexUnique, typeDe } from '../outils/verite-v2.mjs';

const B = (x0, y0, x1, y1) => ({ x0, y0, x1, y1 });
const vt = (texte, boite, extra = {}) => ({ texte, boite, corpsPt: null, couleurTexte: null, couleurFond: null, dansAplat: false, problematique: false, ...extra });
const ot = (texte, boite, extra = {}) => ({ id: 0, texte, boite, exact: false, statut: 'confirme', origine: 'ocr', corpsPt: null, lc: null, niveau: 'ok', ...extra });
const figure = (extra = {}) => ({ fichier: 'f.png', provenance: null, type: 'bitmap', largeurPx: 1000, hauteurPx: 800, verdictAttendu: 'corriger', listeComplete: true, textes: [], objets: [], notes: '', ...extra });
const exporte = (extra = {}) => ({ version: 1, figure: { nom: 'f.png', type: 'bitmap', largeurPx: 1000, hauteurPx: 800 }, reglages: { seuilLc: 75 }, verdict: 'corriger', textes: [], objets: [], series: [], ...extra });

test('banc : géométrie des boîtes', () => {
  assert.equal(iou(B(0, 0, 10, 10), B(0, 0, 10, 10)), 1);
  assert.equal(iou(B(0, 0, 10, 10), B(20, 0, 30, 10)), 0);
  assert.ok(Math.abs(iou(B(0, 0, 10, 10), B(5, 0, 15, 10)) - 1 / 3) < 1e-9);
  assert.ok(centreDans(B(2, 2, 4, 4), B(0, 0, 10, 10)));
  assert.ok(!centreDans(B(0, 0, 10, 10), B(2, 2, 4, 4)));
  assert.equal(aireUnion([B(0, 0, 10, 10), B(5, 0, 15, 10)]), 150);
  assert.equal(aireUnion([B(0, 0, 10, 10), B(2, 2, 4, 4)]), 100);
  assert.equal(aireUnion([B(0, 0, 10, 10), B(20, 20, 30, 30)]), 200);
});

test('banc : un texte pour une boîte, une légende lue d’un trait, un texte lu mot à mot', () => {
  const un = apparierBoites([vt('a', B(0, 0, 100, 20))], [ot('a', B(2, 1, 98, 21))]);
  assert.deepEqual(un.paires, [{ v: 0, o: 0 }]);
  assert.deepEqual(un.manques, []);
  assert.deepEqual(un.orphelins, []);

  const legende = apparierBoites([vt('2024', B(0, 0, 140, 20)), vt('2025', B(160, 0, 300, 20))], [ot('2024 2025', B(0, 0, 300, 20))]);
  assert.deepEqual(legende.deO[0], [0, 1]);
  assert.deepEqual(legende.manques, []);
  assert.deepEqual(legende.orphelins, []);

  const mots = apparierBoites([vt('Part des élèves', B(0, 0, 300, 20))], [ot('Part', B(0, 0, 90, 20)), ot('des', B(100, 0, 190, 20)), ot('élèves', B(200, 0, 300, 20))]);
  assert.deepEqual(mots.deV[0], [0, 1, 2]);
  assert.ok(Math.abs(mots.couverture[0] - 280 / 300) < 1e-9);
  assert.deepEqual(mots.doublons, []);
});

test('banc : un fragment compte, une boîte géante non, un doublon est repéré', () => {
  const fragment = apparierBoites([vt('Source : enquête', B(0, 0, 300, 20))], [ot('Sou', B(10, 5, 30, 15))]);
  assert.deepEqual(fragment.paires, [{ v: 0, o: 0 }]);
  assert.ok(fragment.couverture[0] < 0.05);

  // Trois barres lues comme un « 111 » : la boîte contient le centre d'une annotation, mais
  // celle-ci ne la remplit pas.
  const geante = apparierBoites([vt('2014 CDPH', B(100, 100, 130, 110))], [ot('111', B(0, 0, 400, 400), { niveau: 'corriger' })]);
  assert.deepEqual(geante.manques, [0]);
  assert.deepEqual(geante.orphelins, [0]);

  const doublon = apparierBoites([vt('a', B(0, 0, 100, 20))], [ot('a', B(0, 0, 100, 20)), ot('a', B(2, 1, 98, 19))]);
  assert.deepEqual(doublon.deV[0], [0, 1]);
  assert.deepEqual(doublon.doublons, [1]);

  const sans = apparierBoites([vt('x', null)], [ot('y', null), ot('z', B(0, 0, 10, 10))]);
  assert.deepEqual(sans.manques, []);
  assert.deepEqual(sans.orphelins, [0, 1]);
});

test('banc : degré attendu d’après les références, arrondies comme l’outil', () => {
  assert.equal(niveauAttendu(vt('', null, { corpsPt: 6.09 })), 'corriger');
  assert.equal(niveauAttendu(vt('', null, { corpsPt: 6.47 })), 'ameliorer');
  assert.equal(niveauAttendu(vt('', null, { corpsPt: 6.44 })), 'corriger');
  assert.equal(niveauAttendu(vt('', null, { corpsPt: 8 })), 'ok');
  assert.equal(niveauAttendu(vt('', null)), null);
  const gris = vt('', null, { couleurTexte: '#A6A6A6', couleurFond: '#FFFFFF' });
  assert.ok(lcReference(gris) > 30 && lcReference(gris) < 60);
  assert.equal(niveauAttendu(gris), 'corriger');
  assert.equal(niveauAttendu(vt('', null, { corpsPt: 9, couleurTexte: '#FFFFFF', couleurFond: '#F2C53D' })), 'corriger');
  const noir = vt('', null, { corpsPt: 9, couleurTexte: '#000000', couleurFond: '#FFFFFF' });
  assert.equal(niveauAttendu(noir), 'ok');
  const moyen = vt('', null, { couleurTexte: '#767676', couleurFond: '#FFFFFF' });
  assert.ok(Math.round(lcReference(moyen)) >= 60 && Math.round(lcReference(moyen)) < 75);
  assert.equal(niveauAttendu(moyen, 75), 'ameliorer');
  assert.equal(niveauAttendu(moyen, 90), 'corriger');
});

test('banc : classes de verdict', () => {
  const classe = (attendu, obtenu) => evaluerVerdict({ verdictAttendu: attendu }, { verdict: obtenu }).classe;
  assert.equal(classe('corriger', 'corriger'), 'juste');
  assert.equal(classe('ok', 'corriger'), 'fausse-alerte-grave');
  assert.equal(classe('corriger', 'ok'), 'manque-grave');
  assert.equal(classe('ok', 'ameliorer'), 'trop-severe');
  assert.equal(classe('corriger', 'ameliorer'), 'trop-indulgent');
  assert.equal(classe(null, 'ok'), 'non-evaluable');
  assert.equal(classe('ok', undefined), 'non-evaluable');
});

// Une figure synthétique : cinq textes réels dont trois problématiques, lus avec un manqué,
// une alerte sur un texte conforme, une fausse alerte, un texte en trop, deux suggestions.
const figureSynthetique = () => figure({
  textes: [
    vt('Titre', B(0, 0, 300, 30)),
    vt('0 %', B(0, 100, 40, 115), { problematique: true, corpsPt: 6.09, couleurTexte: '#A6A6A6', couleurFond: '#FFFFFF' }),
    vt('25 %', B(0, 200, 40, 215), { problematique: true, corpsPt: 6.09 }),
    vt('Source', B(0, 300, 200, 312), { problematique: true, corpsPt: 5.3 }),
    vt('Berne', B(100, 400, 160, 420)),
  ],
});
const exportSynthetique = () => exporte({
  textes: [
    ot('Titre', B(0, 0, 300, 30)),
    ot('0 %', B(0, 100, 40, 115), { niveau: 'corriger', corpsPt: 6.0, lc: 40 }),
    ot('25 %', B(0, 200, 40, 215), { niveau: 'ameliorer', corpsPt: 6.2 }),
    ot('Berne', B(100, 400, 160, 420), { niveau: 'ameliorer' }),
    ot('lll', B(500, 500, 520, 560), { niveau: 'corriger', corpsPt: 26.7, lc: 36 }),
    ot('mm', B(600, 600, 610, 610)),
    ot('Source', B(0, 300, 200, 312), { statut: 'a-verifier', niveau: 'corriger' }),
    ot('zz', B(700, 700, 720, 720), { statut: 'a-verifier', niveau: 'corriger' }),
    ot('old', B(800, 800, 820, 820), { statut: 'retire', niveau: 'corriger' }),
  ],
});

test('banc : métriques des textes d’une figure', () => {
  const t = evaluerTextes(figureSynthetique(), normaliserExport(exportSynthetique(), figureSynthetique()));
  assert.equal(t.evaluable, true);
  assert.equal(t.actifs, 6);
  assert.equal(t.retires, 1);
  assert.deepEqual([t.problematiques.total, t.problematiques.trouves, t.problematiques.signales, t.problematiques.bonDegre], [3, 2, 2, 1]);
  assert.equal(t.problematiques.details.find((p) => p.texte === '25 %').attendu, 'corriger');
  assert.equal(t.faussesAlertes.n, 1);
  assert.equal(t.faussesAlertes.borne, false);
  assert.equal(t.faussesAlertes.liste[0].texte, 'lll');
  assert.deepEqual(t.alertesSurConformes.map((c) => c.texte), ['Berne']);
  assert.deepEqual(t.suggestions, { total: 2, vraies: 1 });
  assert.deepEqual([t.effort.ajouter, t.effort.dontSuggeres, t.effort.retirer, t.effort.dontDoublons], [1, 1, 2, 0]);
  assert.deepEqual(t.effort.listeAjouter, [{ texte: 'Source', problematique: true }]);
  assert.equal(t.mesures.pt.n, 2);
  assert.ok(Math.abs(t.mesures.pt.ecarts[0] - (6.0 / 6.09 - 1)) < 1e-9);
  assert.equal(t.mesures.lc.n, 1);
  assert.ok(Math.abs(t.mesures.lc.ecarts[0] - (40 - lcReference(figureSynthetique().textes[1]))) < 1e-9);
  assert.equal(t.couvertureMoyenne, 1);
});

test('banc : liste incomplète, vérité sans boîtes, figure sans texte', () => {
  const incomplete = evaluerTextes(figure({ listeComplete: false, textes: [vt('a', B(0, 0, 10, 10))] }), normaliserExport(exporte({ textes: [ot('b', B(50, 50, 60, 60), { niveau: 'corriger' })] }), figure()));
  assert.equal(incomplete.faussesAlertes.n, 1);
  assert.equal(incomplete.faussesAlertes.borne, true);

  const sansBoites = evaluerTextes(figure({ textes: [vt('a', null), vt('b', null)] }), normaliserExport(exporte({ textes: [ot('a', B(0, 0, 10, 10))] }), figure()));
  assert.equal(sansBoites.evaluable, false);
  assert.match(sansBoites.motif, /sans boîtes/);
  assert.equal(sansBoites.problematiques, null);

  const partiel = evaluerTextes(figure({ textes: [vt('a', B(0, 0, 10, 10), { problematique: true }), vt('b', null, { problematique: true })] }), normaliserExport(exporte({ textes: [ot('a', B(0, 0, 10, 10), { niveau: 'corriger' })] }), figure()));
  assert.equal(partiel.partiel, true);
  assert.equal(partiel.problematiques.total, 1);
  assert.equal(partiel.faussesAlertes.borne, true);

  const photo = evaluerTextes(figure({ verdictAttendu: 'ok', textes: [] }), normaliserExport(exporte({ textes: [ot('mi', B(10, 10, 20, 20), { niveau: 'corriger' }), ot('ha', B(30, 30, 40, 40))] }), figure()));
  assert.equal(photo.evaluable, true);
  assert.equal(photo.faussesAlertes.n, 1);
  assert.equal(photo.effort.retirer, 2);
});

test('banc : objets par IoU, type et couleur ; par couleur seule ; photo', () => {
  const fig = figure({ objets: [{ type: 'rectangle', couleur: '#D7301F', boite: B(190, 342, 280, 680) }, { type: 'rectangle', couleur: '#1A9850', boite: B(290, 420, 380, 680) }] });
  const exp = normaliserExport(exporte({
    objets: [{ id: 0, type: 'rectangle', couleur: '#D8301F', boite: B(190, 342, 280, 680) }, { id: 1, type: 'ellipse', couleur: '#1A9850', boite: B(292, 420, 380, 680) }, { id: 2, type: 'rectangle', couleur: '#123456', boite: B(900, 0, 950, 50) }],
    series: [{ id: 0, couleur: '#D7301F' }, { id: 1, couleur: '#1A9850' }, { id: 2, couleur: '#123456' }],
  }), fig);
  const o = evaluerObjets(fig, exp);
  assert.deepEqual([o.attendus, o.trouves, o.typeJuste, o.couleurProche], [2, 2, 1, 2]);
  assert.deepEqual(o.inventes, [{ type: 'rectangle', couleur: '#123456' }]);
  assert.deepEqual([o.series.attendues, o.series.trouvees, o.series.inventees], [2, 2, ['#123456']]);

  const sansBoites = evaluerObjets(figure({ objets: [{ type: null, couleur: '#E7A8A0', boite: null }, { type: null, couleur: '#FFFFFF', boite: null }] }),
    normaliserExport(exporte({ objets: [{ id: 0, type: 'rectangle', couleur: '#E7A8A1', boite: B(0, 0, 10, 10) }] }), figure()));
  assert.equal(sansBoites.parCouleur, true);
  assert.equal(sansBoites.trouves, 1);
  assert.equal(sansBoites.typeJuste, null);
  assert.deepEqual(sansBoites.manques, [{ type: null, couleur: '#FFFFFF' }]);

  const photo = evaluerObjets(figure({ objets: [] }), normaliserExport(exporte({ objets: [{ id: 0, type: 'forme', couleur: '#121212', boite: B(0, 0, 10, 10) }], series: [{ id: 0, couleur: '#121212' }] }), figure()));
  assert.equal(photo.sansObjets, true);
  assert.equal(photo.inventes.length, 1);
  assert.deepEqual(photo.series.inventees, ['#121212']);
  assert.deepEqual(couleursDistinctes(['#D7301F', '#D8301F', '#1A9850', null]), ['#D7301F', '#1A9850']);
});

test('banc : export ramené aux pixels de la vérité, version contrôlée', () => {
  const e = normaliserExport(exporte({ figure: { largeurPx: 500, hauteurPx: 400 }, textes: [ot('a', B(0, 0, 50, 10))], objets: [{ boite: B(10, 10, 20, 20) }] }), figure());
  assert.deepEqual(e.textes[0].boite, B(0, 0, 100, 20));
  assert.deepEqual(e.objets[0].boite, B(20, 20, 40, 40));
  assert.equal(e.avertissements.length, 1);
  assert.deepEqual(normaliserExport({ version: 0, textes: [] }, figure(), true).avertissements, []);
  assert.match(normaliserExport({ version: 0, textes: [] }, figure(), false).avertissements[0], /version/);
  assert.equal(parametreFigure('exemples/figure-exemple.png'), 'exemple=png');
  assert.equal(parametreFigure('tmp/lot/a b.png'), 'figure=tmp/lot/a%20b.png');
});

test('banc : totaux, tableau et détails', () => {
  const r1 = evaluer(figureSynthetique(), { export: exportSynthetique(), duree: 12.5 });
  const r2 = evaluer(figure({ fichier: 'photo.jpg', verdictAttendu: 'ok', textes: [], objets: [] }),
    { export: exporte({ verdict: 'corriger', textes: [ot('mi', B(10, 10, 20, 20), { niveau: 'corriger' })], objets: [{ id: 0, type: 'forme', couleur: '#121212', boite: B(0, 0, 10, 10) }] }), duree: 3 });
  const r3 = evaluer(figure({ fichier: 'v1.png', verdictAttendu: null, textes: [vt('a', null)] }), { export: exporte({ verdict: 'ameliorer' }), duree: 1, exportAbsent: true });
  const total = totaliser([r1, r2, r3]);
  assert.deepEqual([total.verdict.evaluables, total.verdict.justes, total.verdict.faussesAlertesGraves, total.verdict.manquesGraves], [2, 1, 1, 0]);
  assert.deepEqual([total.problematiques.total, total.problematiques.trouves, total.problematiques.bonDegre], [3, 2, 1]);
  assert.deepEqual([total.faussesAlertes.sures, total.faussesAlertes.bornees, total.faussesAlertes.alertesSurConformes], [2, 0, 1]);
  assert.deepEqual(total.suggestions, { total: 2, vraies: 1 });
  assert.deepEqual([total.effort.ajouter, total.effort.retirer], [1, 3]);
  assert.equal(total.mesures.pt.n, 2);
  assert.deepEqual([total.objets.figuresSansObjets, total.objets.figuresSansObjetsAvecInventions, total.objets.inventesSurSansObjets, total.objets.figuresNonComparees], [2, 1, 1, 1]);
  assert.equal(r3.objets.evaluable, false);
  assert.equal(total.temps.total, 16.5);
  assert.equal(total.exportsAbsents, 1);
  assert.deepEqual([total.verdict.provisoires, total.verdict.textesAVerifier], [0, 2]);
  const texte = tableau([r1, r2, r3], total);
  assert.match(texte, /^figure/);
  assert.match(texte, /\nTOTAL\s+1\/2\s+justes/);
  assert.match(texte, /Verdict : 1\/2 justes/);
  assert.match(texte, /Verdicts provisoires : 0\/3 figure\(s\)/);
  assert.match(texte, /Effort humain : 1 cadre\(s\) à ajouter/);
  assert.ok(details(r1).some((d) => d.startsWith('fausses alertes : « lll »')));
  assert.ok(details(r3).some((d) => /sans boîtes/.test(d)));
  assert.ok(details(r2).some((d) => /FAUSSE AL\./.test(d)));
});

test('vérité v2 : conversion d’une vérité v1, boîtes à compléter', () => {
  const v1 = {
    _lisez_moi: { objet: 'essai' },
    figures: [
      {
        n: 1, fichier: 'barres.png', provenance: 'essai', pixels: [1787, 1151], type: 'barres et courbe',
        fond_reel: '#EFF4F7',
        zones_reelles: [{ hex: '#EFF4F7', part: 65.2 }, { hex: '#E7A8A0', part: 21.2 }, { hex: '#D86B6A', part: 5.2 }],
        taille_mesuree_pt: { 'tous les textes': 8.25 },
        groupes_de_textes: [
          { textes: ['55 000', '0'], couleur: '#CD3146', fond: '#EFF4F7', dans_aplat: false, lc_reference: 67 },
          { textes: ['2004 LHand'], couleur: '#FFFFFF', fond: '#D86B6A ou #E7A8A0 (dans la barre)', dans_aplat: true, lc_reference: 66 },
        ],
        cantons: [['BS', '0,94 %']],
        nombre_textes_reels: 5, liste_complete: true,
        faux_textes_observes: [{ lu: '111', fois: 6, endroit: 'barres' }],
        verdict_attendu: 'Textes juste sous 8 pt : « à améliorer », pas « à corriger ».',
      },
      {
        n: 2, fichier: 'empile.pdf', textes_reels: 'même liste que la figure 1', zones_reelles: 'comme la figure 1', fond_reel: '#EFF4F7 (l’outil annonce #FFFFFF)',
        contrastes_reference: [{ texte: 'blanc sur #DD807B (55 000, 0)', lc: 59 }], liste_complete: true, nombre_textes_reels: 5,
      },
      { n: 3, fichier: 'photo.jpg', fond_reel: 'sans objet (photo)', zones_reelles: 'aucune', textes_reels: [], nombre_textes_reels: 0, liste_complete: true, verdict_attendu: 'rien à corriger côté texte' },
      { n: 4, fichier: 'tableau.jpg', exemples_textes_reels: ['emps', 'ends'], taille_typique_pt: 9, liste_complete: false },
    ],
  };
  const v2 = convertir(v1);
  assert.equal(v2.version, 2);
  assert.equal(v2.figures.length, 4);
  const [f1, f2, f3, f4] = v2.figures;
  assert.deepEqual([f1.type, f1.largeurPx, f1.hauteurPx, f1.verdictAttendu, f1.listeComplete, f1.fond], ['bitmap', 1787, 1151, 'ameliorer', true, '#EFF4F7']);
  assert.equal(f1.textes.length, 5);
  assert.ok(f1.textes.every((t) => t.boite === null));
  const t55 = f1.textes.find((t) => t.texte === '55 000');
  assert.deepEqual([t55.corpsPt, t55.couleurTexte, t55.couleurFond, t55.dansAplat, t55.problematique], [8.25, '#CD3146', '#EFF4F7', false, true]);
  const lhand = f1.textes.find((t) => t.texte === '2004 LHand');
  assert.deepEqual([lhand.couleurFond, lhand.dansAplat, lhand.problematique], [null, true, true]);
  assert.equal(f1.textes.find((t) => t.texte === 'BS').dansAplat, true);
  assert.deepEqual(f1.objets, [{ type: null, couleur: '#E7A8A0', boite: null, surfacePct: 21.2 }, { type: null, couleur: '#D86B6A', boite: null, surfacePct: 5.2 }]);
  assert.match(f1.notes, /faux textes observés/);
  assert.match(f1.notes, /boîtes à mesurer/);
  assert.equal(f2.type, 'pdf');
  assert.equal(f2.textes.length, 5);
  assert.deepEqual([f2.textes[0].couleurTexte, f2.textes[0].couleurFond], ['#FFFFFF', '#DD807B']);
  assert.equal(f2.objets.length, 2);
  assert.equal(f2.verdictAttendu, null);
  assert.match(f2.notes, /verdict à fixer : au moins « corriger »/);
  assert.deepEqual([f3.verdictAttendu, f3.listeComplete, f3.textes.length, f3.objets.length, f3.fond], ['ok', true, 0, 0, null]);
  assert.deepEqual([f4.listeComplete, f4.textes.length, f4.textes[0].corpsPt, f4.textes[0].problematique], [false, 2, 9, false]);
  assert.equal(verdictDe('Barres trop claires : à corriger'), 'corriger');
  assert.equal(verdictDe(undefined), null);
  assert.equal(hexUnique('#D86B6A ou #E7A8A0'), null);
  assert.equal(hexUnique('fond #eff4f7'), '#EFF4F7');
  assert.equal(typeDe('x.SVG'), 'svg');
});

test('banc : verdict provisoire lu dans l’export, classe du verdict inchangée', () => {
  const r = evaluer(figure({ fichier: 'p.png', verdictAttendu: 'ok', textes: [], objets: [] }),
    { export: exporte({ verdict: 'ok', verdictProvisoire: true, textesAVerifier: 7 }), duree: 1 });
  assert.equal(r.verdict.classe, 'juste');
  assert.deepEqual([r.verdict.provisoire, r.verdict.aVerifier], [true, 7]);
  const total = totaliser([r]);
  assert.deepEqual([total.verdict.provisoires, total.verdict.textesAVerifier], [1, 7]);
  assert.match(tableau([r], total), /Verdicts provisoires : 1\/1 figure\(s\).*textes à vérifier : 7/);
});

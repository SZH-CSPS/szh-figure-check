import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  objetsBitmap, analyserObjets, niveauEpaisseur,
  TAUX_RECTANGLE, TAUX_ELLIPSE, EPAISSEUR_AMELIORER_PT, EPAISSEUR_CORRIGER_PT, SURFACE_MIN_MM2,
} from '../js/objets.js';
import { MM_PAR_PT } from '../js/formats.js';

const ROUGE = [0xd7, 0x30, 0x1f], VERT = [0x1a, 0x98, 0x50], JAUNE = [0xf2, 0xc5, 0x3d], NOIR = [0, 0, 0], BLANC = [255, 255, 255];
// Un canevas de 600 px pour 60 mm : 10 px/mm, soit 0,1 mm par pixel.
const MM_PAR_PX = 0.1;

// Image synthétique : `peindre(x, y)` rend la couleur du pixel.
function image(largeur, hauteur, peindre) {
  const rgba = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let y = 0; y < hauteur; y++) {
    for (let x = 0; x < largeur; x++) {
      const c = peindre(x, y) || BLANC;
      rgba.set([c[0], c[1], c[2], 255], (y * largeur + x) * 4);
    }
  }
  return rgba;
}

const dans = (x, y, b) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
const melange = (a, b, t) => a.map((c, i) => Math.round(c + (b[i] - c) * t));

function detecter(largeur, hauteur, peindre, options = {}) {
  const rgba = image(largeur, hauteur, peindre);
  const brut = objetsBitmap(rgba, largeur, hauteur, { mmParPx: MM_PAR_PX, ...options });
  return { brut, analyse: analyserObjets(brut, { mmParPx: MM_PAR_PX, boites: options.boites || [] }) };
}

test('barres : rectangles, séries par couleur, fond blanc, bords lissés et texte écartés', () => {
  const L = 600, H = 400;
  const barres = [
    { x0: 60, y0: 100, x1: 120, y1: 350, c: ROUGE }, { x0: 130, y0: 150, x1: 190, y1: 350, c: VERT },
    { x0: 260, y0: 80, x1: 320, y1: 350, c: ROUGE }, { x0: 330, y0: 200, x1: 390, y1: 350, c: VERT },
    { x0: 460, y0: 180, x1: 520, y1: 350, c: JAUNE },
  ];
  const texte = { x0: 470, y0: 190, x1: 510, y1: 205 };
  const { brut, analyse } = detecter(L, H, (x, y) => {
    if (dans(x, y, texte)) return (x + y) % 3 ? BLANC : NOIR;                   // texte blanc sur la barre
    for (const b of barres) {
      if (dans(x, y, b)) return b.c;
      // Frange lissée d'un pixel autour de chaque barre.
      if (dans(x, y, { x0: b.x0 - 1, y0: b.y0 - 1, x1: b.x1 + 1, y1: b.y1 + 1 })) return melange(b.c, BLANC, 0.5);
    }
    return BLANC;
  }, { boites: [texte] });
  assert.deepEqual(brut.fond, BLANC);
  assert.equal(brut.pas, 1);
  assert.equal(analyse.formes, true);
  assert.equal(analyse.objets.length, 5);
  assert.ok(analyse.objets.every((o) => o.type === 'rectangle'), analyse.objets.map((o) => `${o.type} ${o.taux.toFixed(2)}`).join(', '));
  // La barre jaune garde son taux malgré le texte qu'elle porte.
  const jaune = analyse.objets.find((o) => o.couleur[0] > 200 && o.couleur[1] > 150);
  assert.ok(jaune.taux >= TAUX_RECTANGLE, String(jaune.taux));
  assert.deepEqual(jaune.boite, { x0: 460, y0: 180, x1: 520, y1: 350 });
  assert.equal(analyse.series.length, 3);
  assert.deepEqual(analyse.series.map((s) => s.nObjets), [2, 2, 1]);
  assert.ok(analyse.series.every((s) => s.typeDominant === 'rectangle'));
  // Le jaune se détache mal du blanc ; rouge et vert se distinguent mal en deutéranopie et en gris.
  const sJaune = analyse.series.find((s) => s.couleur[0] > 200 && s.couleur[1] > 150);
  assert.equal(sJaune.contrasteFond.niveau, 'corriger');
  assert.equal(analyse.paires.length, 1);
  assert.ok(analyse.paires[0].visions.includes('deuteranopie') && analyse.paires[0].visions.includes('gris'));
  assert.equal(analyse.niveau, 'corriger');
  // Aucune barre n'en touche une autre.
  assert.ok(analyse.series.every((s) => s.voisins.length === 0));
});

test('légende : une petite case de la couleur d’une série, près d’un texte', () => {
  const L = 600, H = 400;
  const barres = [{ x0: 60, y0: 100, x1: 160, y1: 350, c: ROUGE }, { x0: 260, y0: 80, x1: 360, y1: 350, c: ROUGE }];
  const case_ = { x0: 400, y0: 30, x1: 420, y1: 50 };
  const texte = { x0: 428, y0: 32, x1: 480, y1: 48 };
  const { analyse } = detecter(L, H, (x, y) => {
    if (dans(x, y, case_)) return ROUGE;
    if (dans(x, y, texte)) return (x * 7 + y) % 4 ? BLANC : NOIR;
    for (const b of barres) if (dans(x, y, b)) return b.c;
    return BLANC;
  }, { boites: [texte] });
  assert.equal(analyse.series.length, 1);
  assert.equal(analyse.series[0].legende, true);
  assert.equal(analyse.series[0].nObjets, 2);
  assert.equal(analyse.objets.filter((o) => o.legende).length, 1);
});

test('ellipse et secteur : le taux de remplissage et les coins les séparent', () => {
  const L = 400, H = 200;
  const { analyse } = detecter(L, H, (x, y) => {
    if (Math.hypot(x - 100, y - 100) <= 60) return VERT;                                   // disque
    if (x >= 250 && y <= 150 && Math.hypot(x - 250, y - 150) <= 90) return ROUGE;         // quart de disque
    return BLANC;
  });
  const disque = analyse.objets.find((o) => o.couleur[1] > 100);
  const quart = analyse.objets.find((o) => o.couleur[0] > 150);
  assert.equal(disque.type, 'ellipse', String(disque.taux));
  assert.ok(disque.taux > TAUX_ELLIPSE[0] && disque.taux < TAUX_ELLIPSE[1]);
  assert.equal(quart.type, 'forme', String(quart.taux));
});

test('traits : épaisseur mesurée à un demi-pixel près, convertie en points', () => {
  const L = 600, H = 300;
  const { analyse } = detecter(L, H, (x, y) => {
    if (x >= 50 && x < 550 && y >= 40 && y < 44) return NOIR;                             // trait de 4 px
    if (x >= 50 && x < 550 && y >= 100 && y < 101) return NOIR;                           // trait de 1 px
    const d = Math.abs((y - 150) - (x - 50) * 0.2);                                      // diagonale de 3 px environ
    if (x >= 50 && x < 550 && d <= 1.5) return ROUGE;
    return BLANC;
  });
  const noirs = analyse.objets.filter((o) => o.couleur[0] < 50).sort((a, b) => a.boite.y0 - b.boite.y0);
  assert.equal(noirs.length, 2);
  assert.ok(noirs.every((o) => o.type === 'trait'));
  assert.ok(Math.abs(noirs[0].epaisseurPx - 4) <= 0.5, String(noirs[0].epaisseurPx));
  assert.ok(Math.abs(noirs[1].epaisseurPx - 1) <= 0.5, String(noirs[1].epaisseurPx));
  // 1 px à 0,1 mm/px : 0,1 mm, soit 0,28 pt, à améliorer ; 4 px : 1,13 pt, conforme.
  assert.ok(Math.abs(noirs[1].epaisseurPt - 0.1 / MM_PAR_PT) < 0.15);
  const diagonale = analyse.objets.find((o) => o.couleur[0] > 150);
  assert.equal(diagonale.type, 'trait');
  assert.ok(diagonale.epaisseurPx >= 2 && diagonale.epaisseurPx <= 4, String(diagonale.epaisseurPx));
  const serieNoire = analyse.series.find((s) => s.couleur[0] < 50);
  assert.equal(serieNoire.typeDominant, 'trait');
  assert.equal(serieNoire.niveauEpaisseur, 'ameliorer');
  assert.ok(Math.abs(serieNoire.epaisseurMinMm - 0.1) < 0.06);
});

test('cadre vide : un rectangle avec une épaisseur', () => {
  const { analyse } = detecter(400, 300, (x, y) => {
    const dedans = x >= 50 && x < 350 && y >= 50 && y < 250;
    const coeur = x >= 56 && x < 344 && y >= 56 && y < 244;
    return dedans && !coeur ? NOIR : BLANC;
  });
  assert.equal(analyse.objets.length, 1);
  assert.equal(analyse.objets[0].type, 'rectangle');
  assert.ok(Math.abs(analyse.objets[0].epaisseurPx - 6) <= 0.5, String(analyse.objets[0].epaisseurPx));
});

test('dégradé : une seule région, pas une suite de rectangles, et aucune forme nette', () => {
  const L = 600, H = 300;
  const { brut, analyse } = detecter(L, H, (x, y) => {
    if (x >= 50 && x < 550 && y >= 50 && y < 250) return melange([20, 40, 160], [230, 240, 255], (x - 50) / 500);
    return BLANC;
  });
  const grands = brut.objets.filter((o) => o.aire > 500);
  assert.equal(grands.length, 1, grands.map((o) => `${o.type} ${o.aire}`).join(', '));
  assert.equal(grands[0].type, 'degrade');
  assert.equal(analyse.series.length, 0);
  assert.equal(analyse.formes, false);
  assert.ok(analyse.degrades >= 1);
});

test('deux séries qui se touchent : barres empilées, contraste entre voisines', () => {
  const L = 400, H = 400;
  const { brut, analyse } = detecter(L, H, (x, y) => {
    if (x >= 100 && x < 200 && y >= 50 && y < 200) return [0x4f, 0x81, 0xbd];           // bleu moyen
    if (x >= 100 && x < 200 && y >= 200 && y < 350) return [0x6f, 0x9f, 0xd0];           // bleu voisin
    if (x >= 250 && x < 350 && y >= 150 && y < 350) return ROUGE;                       // seule
    return BLANC;
  });
  assert.equal(analyse.series.length, 3);
  const contact = brut.contacts.find((c) => c.force > 0.05);
  assert.ok(contact, JSON.stringify(brut.contacts));
  const bleues = analyse.series.filter((s) => s.couleur[2] > 150);
  assert.equal(bleues.length, 2);
  assert.ok(bleues.every((s) => s.voisins.length === 1));
  assert.equal(bleues[0].voisins[0].niveau, 'corriger');
  assert.equal(analyse.series.find((s) => s.couleur[0] > 150).voisins.length, 0);
  assert.equal(analyse.niveau, 'corriger');
});

test('quadrillage : traits parallèles réguliers, contraste non jugé', () => {
  const L = 600, H = 400;
  const { analyse } = detecter(L, H, (x, y) => {
    if (x >= 50 && x < 550 && [100, 180, 260, 340].includes(y)) return [0xd9, 0xd9, 0xd9];
    if (x >= 100 && x < 160 && y >= 120 && y < 340) return ROUGE;
    return BLANC;
  });
  const grille = analyse.series.find((s) => s.couleur[1] > 200);
  assert.ok(grille, JSON.stringify(analyse.series.map((s) => s.couleur)));
  assert.equal(grille.typeDominant, 'trait');
  assert.equal(grille.quadrillage, true);
  assert.equal(grille.niveau, 'ok');
  assert.equal(grille.contrasteFond.niveau, 'corriger');
  assert.equal(analyse.niveau, 'ok');
  // Les surfaces d'abord, les traits ensuite.
  assert.equal(analyse.series[0].typeDominant, 'rectangle');
});

test('une image lue un pixel sur deux garde ses boîtes en pixels du canevas', () => {
  const L = 300, H = 200;
  const rgba = image(L, H, (x, y) => (x >= 100 && x < 200 && y >= 50 && y < 150 ? ROUGE : BLANC));
  const brut = objetsBitmap(rgba, L, H, { mmParPx: MM_PAR_PX, pas: 2 });
  assert.equal(brut.pas, 2);
  assert.equal(brut.objets.length, 1);
  const b = brut.objets[0].boite;
  assert.ok(Math.abs(b.x0 - 100) <= 2 && Math.abs(b.x1 - 200) <= 2 && Math.abs(b.y0 - 50) <= 2 && Math.abs(b.y1 - 150) <= 2, JSON.stringify(b));
  assert.ok(Math.abs(brut.objets[0].aire - 10000) <= 400);
});

test('source exacte : contacts par les boîtes, filets rectangulaires devenus traits', () => {
  const brut = {
    fond: BLANC, largeur: 1000, hauteur: 600, exact: true, contacts: null,
    objets: [
      { type: 'rectangle', couleur: ROUGE, boite: { x0: 100, y0: 100, x1: 200, y1: 300 }, aire: 20000, epaisseurPx: null, taux: 1, comps: [] },
      { type: 'rectangle', couleur: VERT, boite: { x0: 100, y0: 300, x1: 200, y1: 500 }, aire: 20000, epaisseurPx: null, taux: 1, comps: [] },
      { type: 'rectangle', couleur: [0xd9, 0xd9, 0xd9], boite: { x0: 50, y0: 150, x1: 950, y1: 152 }, aire: 1800, epaisseurPx: null, taux: 1, comps: [] },
      { type: 'trait', couleur: NOIR, boite: { x0: 50, y0: 500, x1: 950, y1: 503 }, aire: 2700, epaisseurPx: 3, taux: 1, comps: [] },
    ],
  };
  const analyse = analyserObjets(brut, { mmParPx: 0.172 });
  assert.equal(analyse.exact, true);
  const rouge = analyse.series.find((s) => s.couleur === ROUGE), vert = analyse.series.find((s) => s.couleur === VERT);
  assert.equal(rouge.voisins.length, 1);
  assert.equal(rouge.voisins[0].serie, vert.id);
  const filet = analyse.objets.find((o) => o.couleur[0] === 0xd9);
  assert.equal(filet.type, 'trait');
  assert.ok(Math.abs(filet.epaisseurMm - 2 * 0.172) < 1e-9);
  const axe = analyse.series.find((s) => s.couleur === NOIR);
  assert.equal(niveauEpaisseur(axe.epaisseurMinPt), 'ok');
  // Un trait de 0 pt, filet « hairline » d'un PDF, est à corriger.
  assert.equal(niveauEpaisseur(0), 'corriger');
});

test('degrés d’épaisseur : 0,5 pt et 0,25 pt', () => {
  assert.equal(niveauEpaisseur(1), 'ok');
  assert.equal(niveauEpaisseur(EPAISSEUR_AMELIORER_PT), 'ok');
  assert.equal(niveauEpaisseur(0.4), 'ameliorer');
  assert.equal(niveauEpaisseur(EPAISSEUR_CORRIGER_PT), 'ameliorer');
  assert.equal(niveauEpaisseur(0.2), 'corriger');
  assert.equal(niveauEpaisseur(null), null);
});

test('une surface pâle sur fond blanc reste un objet, et son contraste est jugé', () => {
  const PALE = [0xdc, 0xee, 0xe2];
  const { analyse } = detecter(400, 300, (x, y) => (x >= 50 && x < 350 && y >= 50 && y < 250 ? PALE : BLANC));
  assert.deepEqual(analyse.fond, BLANC);
  assert.equal(analyse.series.length, 1);
  assert.equal(analyse.series[0].typeDominant, 'rectangle');
  assert.equal(analyse.series[0].contrasteFond.niveau, 'corriger');
});

test('source exacte : un objet de la couleur du fond n’est pas un objet, une légende est haute comme son texte', () => {
  const PANNEAU = [0xef, 0xf4, 0xf7];
  const aireDe = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const objet = (couleur, boite) => ({ type: 'rectangle', couleur, boite, aire: aireDe(boite), epaisseurPx: null, taux: 1, comps: [] });
  const brut = {
    fond: PANNEAU, largeur: 1000, hauteur: 600, exact: true, contacts: null,
    objets: [
      objet([0xf0, 0xf4, 0xf6], { x0: 20, y0: 20, x1: 980, y1: 580 }),        // reste du panneau
      objet(ROUGE, { x0: 100, y0: 100, x1: 200, y1: 500 }),
      objet(ROUGE, { x0: 300, y0: 200, x1: 400, y1: 500 }),
      objet(ROUGE, { x0: 600, y0: 40, x1: 620, y1: 60 }),                      // case de légende
      objet(ROUGE, { x0: 700, y0: 40, x1: 704, y1: 44 }),                      // puce, plus petite que le tiers du texte
    ],
  };
  const boites = [{ x0: 628, y0: 42, x1: 700, y1: 58 }, { x0: 712, y0: 40, x1: 790, y1: 58 }];
  const analyse = analyserObjets(brut, { mmParPx: 0.172, boites });
  assert.equal(analyse.series.length, 1);
  assert.equal(analyse.series[0].legende, true);
  assert.equal(analyse.series[0].nObjets, 3);
  assert.deepEqual(analyse.objets.filter((o) => o.legende).map((o) => o.boite.x0), [600]);
});

test('une case percée par son texte reste un rectangle', () => {
  const texte = { x0: 70, y0: 90, x1: 230, y1: 110 };
  const { analyse } = detecter(300, 200, (x, y) => {
    if (dans(x, y, texte)) return (x + y) % 3 ? [0x12, 0x7a, 0x5e] : BLANC;   // texte blanc sur la case
    return x >= 60 && x < 240 && y >= 80 && y < 120 ? [0x12, 0x7a, 0x5e] : BLANC;
  }, { boites: [texte] });
  assert.equal(analyse.objets.length, 1);
  assert.equal(analyse.objets[0].type, 'rectangle', String(analyse.objets[0].epaisseurPx));
});

test('texture : des petites formes disparates de même couleur ne font pas une série', () => {
  let graine = 3;
  const alea = () => { graine = (graine * 1103515245 + 12345) & 0x7fffffff; return graine / 0x7fffffff; };
  // Douze losanges de tailles disparates : des formes, petites, aux surfaces inégales.
  // Rayons de 4 à 13 px : de 0,4 à 3,7 mm², toutes sous les 4 mm² d'une tache.
  const taches = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 13, 13].map((r, i) => ({ cx: 30 + (i % 4) * 70 + Math.round(5 * alea()), cy: 30 + Math.floor(i / 4) * 60, r }));
  const { analyse } = detecter(300, 200, (x, y) => {
    for (const t of taches) if (Math.abs(x - t.cx) + Math.abs(y - t.cy) <= t.r) return [0x58, 0x83, 0x54];
    return BLANC;
  });
  assert.equal(analyse.series.length, 0, JSON.stringify(analyse.series.map((s) => s.types)));
  assert.equal(analyse.formes, false);
});

test('surface minimale : un objet de moins de 0,25 mm² n’est pas retenu', () => {
  const cote = Math.floor(Math.sqrt(SURFACE_MIN_MM2) / MM_PAR_PX) - 1;   // 4 px à 0,1 mm/px
  const { analyse } = detecter(200, 200, (x, y) => (x >= 50 && x < 50 + cote && y >= 50 && y < 50 + cote ? ROUGE : BLANC));
  assert.equal(analyse.objets.length, 0);
  assert.equal(analyse.formes, false);
});

test('quadrillage coupé par des barres : les tronçons restent la même ligne, aucun contact jugé', () => {
  const L = 600, H = 400;
  const GRIS = [0xdb, 0xdb, 0xdb];
  const lignes = [100, 160, 220, 280];                       // 4 px d'épaisseur, espacées de 60 px
  const barres = [
    { x0: 90, y0: 90, x1: 150, y1: 340, c: ROUGE }, { x0: 150, y0: 130, x1: 210, y1: 340, c: VERT },
    { x0: 217, y0: 90, x1: 277, y1: 340, c: ROUGE }, { x0: 284, y0: 190, x1: 344, y1: 340, c: JAUNE },
  ];
  const { analyse } = detecter(L, H, (x, y) => {
    for (const b of barres) if (dans(x, y, b)) return b.c;
    if (x >= 50 && x < 550 && lignes.some((l) => y >= l && y < l + 4)) return GRIS;
    return BLANC;
  });
  const grille = analyse.series.find((s) => s.couleur[0] === GRIS[0] && s.couleur[1] === GRIS[1]);
  assert.ok(grille, JSON.stringify(analyse.series.map((s) => [s.couleur, s.types])));
  assert.equal(grille.quadrillage, true, JSON.stringify(grille.types));
  assert.equal(grille.niveau, 'ok');
  assert.equal(grille.voisins.length, 0);
  // Les barres ne touchent que le fond, hors la paire rouge et verte qui se jouxtent.
  for (const s of analyse.series.filter((s) => !s.quadrillage)) {
    assert.ok(s.voisins.every((v) => !analyse.series[v.serie - 1].quadrillage), `série ${s.id}`);
  }
  const rouge = analyse.series.find((s) => s.couleur[0] > 180 && s.couleur[1] < 100);
  assert.ok(rouge.voisins.length <= 1);
});

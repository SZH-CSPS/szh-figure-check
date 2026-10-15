// Banc d'essai : analyse un lot de figures dans Edge sans fenêtre, lit le résultat de
// l'outil et le compare à une vérité de terrain en appariant textes et objets par position.
//   node outils/banc.mjs <verite.json> <dossier des figures> [--json sortie.json] [--seulement a,b]
//     [--navigateur chemin]
//   node outils/banc.mjs <verite.json> --depuis resultats.json        réévalue un résultat enregistré
//   node outils/banc.mjs <verite.json> --sans-navigateur <dossier>    exports déjà enregistrés, un par figure
//
// La vérité de terrain (version 2), les métriques et leur lecture sont décrites dans
// docs/BANC.md. Les figures et la vérité d'un lot restent hors du dépôt (tmp/), sauf celles
// des figures d'exemple (test/verite-exemples.json).

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, extname, basename, normalize, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lc } from '../js/apca.js';
import { TAILLE_MIN_PT, TAILLE_GRAVE_PT, LC_MIN, ECART_GRAVE_LC } from '../js/formats.js';

export const IOU_MIN = 0.3;          // recouvrement qui apparie deux boîtes
export const REMPLISSAGE_MIN = 0.3;  // part d'une boîte de l'outil que les textes réels doivent remplir
export const IOU_DOUBLON = 0.5;      // deux boîtes de l'outil qui se recouvrent sur un même texte
export const RAYON_COULEUR = 6;      // écart Lab sous lequel deux couleurs sont la même

const NIVEAUX = ['ok', 'ameliorer', 'corriger'];
const ACTIFS = new Set(['confirme', 'ajoute']);
const EXEMPLES = { 'exemples/figure-exemple.png': 'png', 'exemples/figure-exemple.svg': 'svg' };

// ── Géométrie ───────────────────────────────────────────────────────────────────

export const boiteValide = (b) => Boolean(b) && [b.x0, b.y0, b.x1, b.y1].every(Number.isFinite) && b.x1 > b.x0 && b.y1 > b.y0;
export const aire = (b) => Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);

export function intersection(a, b) {
  const x0 = Math.max(a.x0, b.x0), y0 = Math.max(a.y0, b.y0), x1 = Math.min(a.x1, b.x1), y1 = Math.min(a.y1, b.y1);
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null;
}

export function iou(a, b) {
  const i = intersection(a, b);
  if (!i) return 0;
  const ai = aire(i);
  return ai / (aire(a) + aire(b) - ai);
}

// Le centre de `a` est dans `b`.
export function centreDans(a, b) {
  const cx = (a.x0 + a.x1) / 2, cy = (a.y0 + a.y1) / 2;
  return cx >= b.x0 && cx <= b.x1 && cy >= b.y0 && cy <= b.y1;
}

export const compatibles = (a, b) => iou(a, b) >= IOU_MIN || centreDans(a, b) || centreDans(b, a);

// Aire de l'union de boîtes, exacte, par la grille de leurs bords.
export function aireUnion(boites) {
  const xs = [...new Set(boites.flatMap((b) => [b.x0, b.x1]))].sort((p, q) => p - q);
  const ys = [...new Set(boites.flatMap((b) => [b.y0, b.y1]))].sort((p, q) => p - q);
  let total = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
      if (boites.some((b) => cx > b.x0 && cx < b.x1 && cy > b.y0 && cy < b.y1)) total += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
    }
  }
  return total;
}

// ── Appariement par position ────────────────────────────────────────────────────

// `verite` et `outil` : [{ boite }]. Deux boîtes vont ensemble si leur IoU atteint IOU_MIN
// ou si le centre de l'une est dans l'autre. Une boîte de l'outil peut couvrir plusieurs
// textes réels (une légende lue d'un trait) et un texte réel peut être lu en plusieurs
// boîtes (mot à mot) : toutes ces paires comptent. Une boîte de l'outil que les textes
// réels qu'elle touche remplissent à moins de REMPLISSAGE_MIN est trop grande pour eux
// (une barre lue comme un « 111 ») : elle ne garde que les paires au recouvrement suffisant.
// Les éléments sans boîte valide n'ont pas de paire ; l'appelant les compte.
// Rend { paires: [{ v, o }], deV, deO, couverture, manques, orphelins, doublons }.
export function apparierBoites(verite, outil) {
  const paires = [];
  const deO = outil.map(() => []);
  outil.forEach((o, j) => {
    if (!boiteValide(o.boite)) return;
    let voisins = verite.map((_, i) => i).filter((i) => boiteValide(verite[i].boite) && compatibles(verite[i].boite, o.boite));
    if (!voisins.length) return;
    const remplissage = aireUnion(voisins.map((i) => intersection(verite[i].boite, o.boite))) / aire(o.boite);
    if (remplissage < REMPLISSAGE_MIN) voisins = voisins.filter((i) => iou(verite[i].boite, o.boite) >= IOU_MIN);
    deO[j] = voisins;
    for (const i of voisins) paires.push({ v: i, o: j });
  });
  const deV = verite.map(() => []);
  for (const p of paires) deV[p.v].push(p.o);
  // Deux boîtes de l'outil qui se recouvrent sur un même texte : la plus large garde la
  // place, l'autre est un doublon.
  const doublons = new Set();
  deV.forEach((os, i) => {
    const part = (j) => aire(intersection(outil[j].boite, verite[i].boite));
    const gardes = [];
    for (const j of [...os].sort((a, b) => part(b) - part(a))) {
      if (gardes.some((k) => iou(outil[k].boite, outil[j].boite) >= IOU_DOUBLON)) doublons.add(j);
      else gardes.push(j);
    }
  });
  const couverture = deV.map((os, i) => (os.length ? aireUnion(os.map((j) => intersection(outil[j].boite, verite[i].boite))) / aire(verite[i].boite) : 0));
  return {
    paires, deV, deO, couverture,
    manques: verite.map((_, i) => i).filter((i) => boiteValide(verite[i].boite) && !deV[i].length),
    orphelins: outil.map((_, j) => j).filter((j) => !deO[j].length),
    doublons: [...doublons].sort((a, b) => a - b),
  };
}

// ── Degrés ──────────────────────────────────────────────────────────────────────

export function pire(...niveaux) {
  const connus = niveaux.filter((n) => NIVEAUX.includes(n));
  return connus.length ? connus.reduce((a, b) => (NIVEAUX.indexOf(b) > NIVEAUX.indexOf(a) ? b : a)) : null;
}

const rgb = (hex) => { const v = parseInt(String(hex).slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
const HEX = /^#[0-9A-Fa-f]{6}$/;

// Contraste de référence d'un texte de la vérité, d'après ses couleurs ; null sans elles.
export function lcReference(texte) {
  return HEX.test(texte.couleurTexte || '') && HEX.test(texte.couleurFond || '') ? Math.abs(lc(rgb(texte.couleurTexte), rgb(texte.couleurFond))) : null;
}

// Degré qu'un texte de la vérité devrait recevoir, selon les seuils de l'outil appliqués à
// ses références, arrondies comme l'outil les affiche ; null sans référence.
export function niveauAttendu(texte, seuilLc = LC_MIN) {
  let nt = null, nc = null;
  if (texte.corpsPt != null) {
    const pt = Math.round(texte.corpsPt * 10) / 10;
    nt = pt >= TAILLE_MIN_PT ? 'ok' : pt >= TAILLE_GRAVE_PT ? 'ameliorer' : 'corriger';
  }
  const ref = lcReference(texte);
  if (ref != null) {
    const v = Math.round(ref);
    nc = v >= seuilLc ? 'ok' : v >= seuilLc - ECART_GRAVE_LC ? 'ameliorer' : 'corriger';
  }
  return pire(nt, nc);
}

// ── Couleurs ────────────────────────────────────────────────────────────────────

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
export function versLab(hex) {
  const [r, g, b] = rgb(hex).map(lin);
  const xyz = [0.4124564 * r + 0.3575761 * g + 0.1804375 * b, 0.2126729 * r + 0.7151522 * g + 0.072175 * b, 0.0193339 * r + 0.119192 * g + 0.9503041 * b];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const [fx, fy, fz] = xyz.map((t, i) => f(t / [0.95047, 1, 1.08883][i]));
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
export const ecartLab = (a, b) => { const p = versLab(a), q = versLab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
const memeCouleur = (a, b) => HEX.test(a || '') && HEX.test(b || '') && ecartLab(a, b) <= RAYON_COULEUR;

// Couleurs distinctes d'une liste, à RAYON_COULEUR près.
export function couleursDistinctes(hexs) {
  const distinctes = [];
  for (const h of hexs) if (HEX.test(h || '') && !distinctes.some((d) => memeCouleur(d, h))) distinctes.push(h.toUpperCase());
  return distinctes;
}

// ── Évaluation d'une figure ─────────────────────────────────────────────────────

const moyenne = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : null);
export const mediane = (v) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const estAlerte = (niveau) => niveau === 'ameliorer' || niveau === 'corriger';

// Ramène les boîtes de l'export aux pixels de la vérité quand l'outil a travaillé sur une
// autre largeur ; signale une version d'export inconnue.
export function normaliserExport(exp, fig, exportAbsent = false) {
  const e = { ...exp, textes: exp.textes || [], objets: exp.objets || [], series: exp.series || [], avertissements: [] };
  if (!exportAbsent && exp.version !== 1) e.avertissements.push(`version d'export ${exp.version ?? 'absente'}, 1 attendue`);
  const lo = exp.figure?.largeurPx, lv = fig.largeurPx;
  if (Number.isFinite(lo) && Number.isFinite(lv) && lo > 0 && Math.abs(lo / lv - 1) > 0.005) {
    const k = lv / lo;
    const echelle = (b) => (boiteValide(b) ? { x0: b.x0 * k, y0: b.y0 * k, x1: b.x1 * k, y1: b.y1 * k } : b);
    e.textes = e.textes.map((t) => ({ ...t, boite: echelle(t.boite) }));
    e.objets = e.objets.map((o) => ({ ...o, boite: echelle(o.boite) }));
    e.avertissements.push(`boîtes ramenées de ${lo} à ${lv} px de large`);
  }
  return e;
}

export function evaluerVerdict(fig, exp) {
  const attendu = NIVEAUX.includes(fig.verdictAttendu) ? fig.verdictAttendu : null;
  const obtenu = NIVEAUX.includes(exp.verdict) ? exp.verdict : null;
  let classe;
  if (!attendu || !obtenu) classe = 'non-evaluable';
  else if (attendu === obtenu) classe = 'juste';
  else if (attendu === 'ok' && obtenu === 'corriger') classe = 'fausse-alerte-grave';
  else if (attendu === 'corriger' && obtenu === 'ok') classe = 'manque-grave';
  else classe = NIVEAUX.indexOf(obtenu) > NIVEAUX.indexOf(attendu) ? 'trop-severe' : 'trop-indulgent';
  return { attendu, obtenu, classe };
}

// Textes : problématiques retrouvés et signalés au bon degré, fausses alertes, suggestions,
// effort humain, écarts de mesure. Les textes de l'outil en statut a-verifier sont des
// suggestions, comptées à part ; ceux en statut retire sont ignorés.
export function evaluerTextes(fig, exp) {
  const seuil = Number.isFinite(exp.reglages?.seuilLc) ? exp.reglages.seuilLc : LC_MIN;
  const verite = fig.textes || [];
  const listeComplete = fig.listeComplete !== false;
  const sansBoite = verite.filter((t) => !boiteValide(t.boite)).length;
  const actifs = exp.textes.filter((t) => ACTIFS.has(t.statut ?? 'confirme'));
  const suggestions = exp.textes.filter((t) => t.statut === 'a-verifier');
  const r = {
    reels: verite.length, sansBoite, lus: exp.textes.length, actifs: actifs.length,
    retires: exp.textes.filter((t) => t.statut === 'retire').length,
    outilSansBoite: actifs.filter((t) => !boiteValide(t.boite)).length,
    listeComplete, partiel: sansBoite > 0 && sansBoite < verite.length,
    evaluable: true, motif: null,
    problematiques: null, faussesAlertes: null, alertesSurConformes: null, suggestions: null, effort: null, mesures: null, couvertureMoyenne: null,
  };
  if (verite.length && sansBoite === verite.length) {
    return { ...r, evaluable: false, motif: 'vérité sans boîtes : textes non comparables (verdict, temps et objets seulement)' };
  }
  if (verite.some((t) => boiteValide(t.boite)) && actifs.length && r.outilSansBoite === actifs.length) {
    return { ...r, evaluable: false, motif: 'export sans boîtes : textes non comparables' };
  }
  const a = apparierBoites(verite, actifs);
  const s = apparierBoites(verite, suggestions);
  const niveauDe = (os) => pire(...os.map((j) => actifs[j].niveau));
  const texteDe = (t) => t.texte ?? '';

  const problematiques = verite.map((t, i) => i).filter((i) => verite[i].problematique && boiteValide(verite[i].boite)).map((i) => {
    const obtenu = niveauDe(a.deV[i]);
    const attendu = niveauAttendu(verite[i], seuil);
    const signale = estAlerte(obtenu);
    return { texte: texteDe(verite[i]), trouve: a.deV[i].length > 0, signale, bonDegre: estAlerte(attendu) ? obtenu === attendu : signale, attendu, obtenu };
  });
  r.problematiques = {
    total: problematiques.length,
    trouves: problematiques.filter((p) => p.trouve).length,
    signales: problematiques.filter((p) => p.signale).length,
    bonDegre: problematiques.filter((p) => p.bonDegre).length,
    details: problematiques,
  };
  const faux = a.orphelins.filter((j) => estAlerte(actifs[j].niveau));
  r.faussesAlertes = {
    n: faux.length,
    borne: !listeComplete || sansBoite > 0,
    liste: faux.map((j) => ({ texte: texteDe(actifs[j]), niveau: actifs[j].niveau, corpsPt: actifs[j].corpsPt ?? null, lc: actifs[j].lc ?? null })),
  };
  r.alertesSurConformes = verite.map((t, i) => i).filter((i) => !verite[i].problematique && a.deV[i].length && estAlerte(niveauDe(a.deV[i])))
    .map((i) => ({ texte: texteDe(verite[i]), obtenu: niveauDe(a.deV[i]) }));
  r.suggestions = { total: suggestions.length, vraies: suggestions.filter((_, j) => s.deO[j].length).length };
  r.effort = {
    ajouter: a.manques.length,
    dontSuggeres: a.manques.filter((i) => s.deV[i].length).length,
    retirer: a.orphelins.length + a.doublons.length,
    dontDoublons: a.doublons.length,
    listeAjouter: a.manques.map((i) => ({ texte: texteDe(verite[i]), problematique: Boolean(verite[i].problematique) })),
    listeRetirer: [...a.orphelins.map((j) => ({ texte: texteDe(actifs[j]), niveau: actifs[j].niveau ?? null })), ...a.doublons.map((j) => ({ texte: texteDe(actifs[j]), doublon: true }))],
  };
  const ecartsPt = [], ecartsLc = [];
  verite.forEach((t, i) => {
    const os = a.deV[i];
    if (!os.length) return;
    if (t.corpsPt > 0) {
      const pts = os.map((j) => actifs[j].corpsPt).filter((v) => Number.isFinite(v));
      if (pts.length) ecartsPt.push(mediane(pts) / t.corpsPt - 1);
    }
    const ref = lcReference(t);
    if (ref != null) {
      const lcs = os.map((j) => actifs[j].lc).filter((v) => Number.isFinite(v)).map(Math.abs);
      if (lcs.length) ecartsLc.push(mediane(lcs) - ref);
    }
  });
  r.mesures = { pt: { n: ecartsPt.length, ecarts: ecartsPt }, lc: { n: ecartsLc.length, ecarts: ecartsLc } };
  const couvertures = a.couverture.filter((_, i) => a.deV[i].length);
  r.couvertureMoyenne = moyenne(couvertures);
  return r;
}

// Objets : appariement par IoU puis type et couleur ; par couleur seule quand la vérité
// n'a pas de boîtes ; tout objet de l'outil est inventé sur une figure qui n'en a aucun.
// Sans export, le DOM ne donne que les séries : les objets ne sont pas comparés.
export function evaluerObjets(fig, exp, exportAbsent = false) {
  const verite = fig.objets || [], outil = exp.objets, series = exp.series;
  const r = {
    evaluable: !exportAbsent, motif: exportAbsent ? 'export absent : objets non comparés, séries seulement' : null,
    attendus: verite.length, lus: outil.length, sansObjets: verite.length === 0, parCouleur: false,
    trouves: 0, typeJuste: 0, couleurProche: 0, manques: [], inventes: [],
    series: { attendues: 0, trouvees: 0, lues: series.length, inventees: [] },
  };
  const couleursVerite = couleursDistinctes(verite.map((v) => v.couleur));
  r.series.attendues = couleursVerite.length;
  r.series.trouvees = couleursVerite.filter((c) => series.some((s) => memeCouleur(c, s.couleur))).length;
  r.series.inventees = series.filter((s) => !couleursVerite.some((c) => memeCouleur(c, s.couleur))).map((s) => s.couleur ?? null);
  if (exportAbsent) return r;
  if (!verite.length) {
    r.inventes = outil.map((o) => ({ type: o.type ?? null, couleur: o.couleur ?? null }));
    return r;
  }
  const prisV = new Set(), prisO = new Set();
  if (verite.every((o) => boiteValide(o.boite))) {
    const candidats = [];
    verite.forEach((v, i) => outil.forEach((o, j) => {
      if (!boiteValide(o.boite)) return;
      const s = iou(v.boite, o.boite);
      if (s >= IOU_MIN) candidats.push({ i, j, s });
    }));
    candidats.sort((p, q) => q.s - p.s);
    for (const c of candidats) {
      if (prisV.has(c.i) || prisO.has(c.j)) continue;
      prisV.add(c.i); prisO.add(c.j);
      const v = verite[c.i], o = outil[c.j];
      if (!v.type || v.type === o.type) r.typeJuste++;
      if (memeCouleur(v.couleur, o.couleur)) r.couleurProche++;
    }
  } else {
    r.parCouleur = true;
    verite.forEach((v, i) => {
      const j = outil.findIndex((o, k) => !prisO.has(k) && memeCouleur(v.couleur, o.couleur));
      if (j >= 0) { prisV.add(i); prisO.add(j); r.couleurProche++; }
      else if (series.some((s) => memeCouleur(v.couleur, s.couleur))) { prisV.add(i); r.couleurProche++; }
    });
    r.typeJuste = null;
  }
  r.trouves = prisV.size;
  r.manques = verite.filter((_, i) => !prisV.has(i)).map((v) => ({ type: v.type ?? null, couleur: v.couleur ?? null }));
  r.inventes = outil.filter((_, j) => !prisO.has(j)).map((o) => ({ type: o.type ?? null, couleur: o.couleur ?? null }));
  return r;
}

// `sortie` : { export, exportAbsent, duree, erreur }.
export function evaluer(fig, sortie) {
  const exp = normaliserExport(sortie.export || {}, fig, Boolean(sortie.exportAbsent));
  return {
    fichier: fig.fichier,
    duree: sortie.duree ?? null,
    erreur: sortie.erreur ?? null,
    exportAbsent: Boolean(sortie.exportAbsent),
    avertissements: exp.avertissements,
    verdict: evaluerVerdict(fig, exp),
    textes: evaluerTextes(fig, exp),
    objets: evaluerObjets(fig, exp, Boolean(sortie.exportAbsent)),
  };
}

// ── Totaux et rapport ───────────────────────────────────────────────────────────

const somme = (liste, f) => liste.reduce((s, x) => s + (f(x) || 0), 0);

export function totaliser(resultats) {
  const verdicts = resultats.map((r) => r.verdict).filter((v) => v.classe !== 'non-evaluable');
  const matrice = {};
  for (const v of verdicts) matrice[`${v.attendu}>${v.obtenu}`] = (matrice[`${v.attendu}>${v.obtenu}`] || 0) + 1;
  const compter = (classe) => verdicts.filter((v) => v.classe === classe).length;
  // Métriques 2, 4 et 5 : figures à liste complète, sur les textes qui ont une boîte.
  const complets = resultats.filter((r) => r.textes.evaluable && r.textes.listeComplete).map((r) => r.textes);
  const evaluables = resultats.filter((r) => r.textes.evaluable).map((r) => r.textes);
  const ecartsPt = complets.flatMap((t) => t.mesures.pt.ecarts), ecartsLc = complets.flatMap((t) => t.mesures.lc.ecarts);
  const resume = (ecarts) => ({
    n: ecarts.length,
    medianeAbs: mediane(ecarts.map(Math.abs)),
    moyenneAbs: moyenne(ecarts.map(Math.abs)),
    moyenneSignee: moyenne(ecarts),
    maxAbs: ecarts.length ? Math.max(...ecarts.map(Math.abs)) : null,
  });
  const series = resultats.map((r) => r.objets);
  const objets = series.filter((o) => o.evaluable);
  const sansObjets = objets.filter((o) => o.sansObjets);
  const durees = resultats.map((r) => r.duree).filter((d) => Number.isFinite(d));
  return {
    figures: resultats.length,
    erreurs: resultats.filter((r) => r.erreur).length,
    exportsAbsents: resultats.filter((r) => r.exportAbsent).length,
    verdict: {
      evaluables: verdicts.length, justes: compter('juste'),
      faussesAlertesGraves: compter('fausse-alerte-grave'), manquesGraves: compter('manque-grave'),
      tropSeveres: compter('trop-severe'), tropIndulgents: compter('trop-indulgent'), matrice,
    },
    problematiques: {
      figures: complets.length,
      total: somme(complets, (t) => t.problematiques.total), trouves: somme(complets, (t) => t.problematiques.trouves),
      signales: somme(complets, (t) => t.problematiques.signales), bonDegre: somme(complets, (t) => t.problematiques.bonDegre),
    },
    faussesAlertes: {
      sures: somme(evaluables.filter((t) => !t.faussesAlertes.borne), (t) => t.faussesAlertes.n),
      bornees: somme(evaluables.filter((t) => t.faussesAlertes.borne), (t) => t.faussesAlertes.n),
      figuresBornees: evaluables.filter((t) => t.faussesAlertes.borne).length,
      alertesSurConformes: somme(complets, (t) => t.alertesSurConformes.length),
    },
    suggestions: { total: somme(complets, (t) => t.suggestions.total), vraies: somme(complets, (t) => t.suggestions.vraies) },
    effort: {
      ajouter: somme(complets, (t) => t.effort.ajouter), dontSuggeres: somme(complets, (t) => t.effort.dontSuggeres),
      retirer: somme(complets, (t) => t.effort.retirer), dontDoublons: somme(complets, (t) => t.effort.dontDoublons),
    },
    mesures: { pt: resume(ecartsPt), lc: resume(ecartsLc) },
    objets: {
      attendus: somme(objets, (o) => o.attendus), trouves: somme(objets, (o) => o.trouves),
      typeJuste: somme(objets, (o) => o.typeJuste), couleurProche: somme(objets, (o) => o.couleurProche),
      inventes: somme(objets, (o) => o.inventes.length),
      figuresNonComparees: series.length - objets.length,
      seriesAttendues: somme(series, (o) => o.series.attendues), seriesTrouvees: somme(series, (o) => o.series.trouvees),
      seriesInventees: somme(series, (o) => o.series.inventees.length),
      figuresSansObjets: sansObjets.length,
      figuresSansObjetsAvecInventions: sansObjets.filter((o) => o.inventes.length || o.series.inventees.length).length,
      inventesSurSansObjets: somme(sansObjets, (o) => o.inventes.length),
    },
    temps: { total: somme(durees, (d) => d), moyenne: moyenne(durees), max: durees.length ? Math.max(...durees) : null },
  };
}

const SYMBOLES = { ok: '✓', ameliorer: '!', corriger: '✕' };
const CLASSES = { juste: 'juste', 'fausse-alerte-grave': 'FAUSSE AL.', 'manque-grave': 'MANQUE', 'trop-severe': 'sévère', 'trop-indulgent': 'indulgent', 'non-evaluable': '–' };
const pc = (v) => (v == null ? '–' : `${Math.round(v * 100)} %`);
const un = (v) => (v == null ? '–' : v.toFixed(1));

// Tableau par figure, ligne de total, puis les totaux en clair.
export function tableau(resultats, total = totaliser(resultats)) {
  const entete = ['figure', 'verdict', '', 'probl.', 'degré', 'f. al.', 'sugg.', '+cadres', '−cadres', '|Δpt|', '|ΔLc|', 'objets', 'inv.', 's'];
  const lignes = [entete];
  for (const r of resultats) {
    const v = r.verdict, t = r.textes, o = r.objets;
    const fleche = `${v.attendu ? SYMBOLES[v.attendu] : '?'}→${v.obtenu ? SYMBOLES[v.obtenu] : '?'}`;
    const texte = t.evaluable
      ? [`${t.problematiques.trouves}/${t.problematiques.total}`, t.problematiques.bonDegre, `${t.faussesAlertes.borne ? '≤' : ''}${t.faussesAlertes.n}`,
        `${t.suggestions.vraies}/${t.suggestions.total}`, t.effort.ajouter, t.effort.retirer,
        pc(mediane(t.mesures.pt.ecarts.map(Math.abs))), un(moyenne(t.mesures.lc.ecarts.map(Math.abs)))]
      : ['–', '–', '–', '–', '–', '–', '–', '–'];
    lignes.push([r.fichier.slice(0, 34), fleche, CLASSES[v.classe], ...texte, o.evaluable ? `${o.trouves}/${o.attendus}` : '–', o.evaluable ? o.inventes.length : '–', un(r.duree)]);
  }
  const tv = total.verdict, tp = total.problematiques, tf = total.faussesAlertes, ts = total.suggestions, te = total.effort, tm = total.mesures, to = total.objets;
  lignes.push(['TOTAL', `${tv.justes}/${tv.evaluables}`, 'justes', `${tp.trouves}/${tp.total}`, tp.bonDegre,
    `${tf.sures}${tf.bornees ? ` (+≤${tf.bornees})` : ''}`, `${ts.vraies}/${ts.total}`, te.ajouter, te.retirer,
    pc(tm.pt.medianeAbs), un(tm.lc.moyenneAbs), `${to.trouves}/${to.attendus}`, to.inventes, un(total.temps.total)]);
  const largeurs = entete.map((_, k) => Math.max(...lignes.map((l) => String(l[k]).length)));
  const grille = lignes.map((l) => l.map((c, k) => String(c).padEnd(largeurs[k])).join('  ').trimEnd()).join('\n');
  const part = (a, b) => (b ? ` (${pc(a / b)})` : '');
  const clair = [
    `Verdict : ${tv.justes}/${tv.evaluables} justes${part(tv.justes, tv.evaluables)} ; figures conformes déclarées à corriger : ${tv.faussesAlertesGraves} ; figures à corriger déclarées conformes : ${tv.manquesGraves} ; trop sévère : ${tv.tropSeveres}, trop indulgent : ${tv.tropIndulgents}${total.figures - tv.evaluables ? ` ; non évaluables : ${total.figures - tv.evaluables}` : ''}.`,
    `Textes problématiques (${tp.figures} figures à liste complète) : ${tp.trouves}/${tp.total} retrouvés${part(tp.trouves, tp.total)}, ${tp.signales} signalés, ${tp.bonDegre} au bon degré${part(tp.bonDegre, tp.total)}.`,
    `Fausses alertes : ${tf.sures}${tf.bornees ? `, plus au plus ${tf.bornees} sur ${tf.figuresBornees} figure(s) à liste incomplète` : ''} ; alertes sur des textes conformes : ${tf.alertesSurConformes}.`,
    `Suggestions (à vérifier) : ${ts.total}, dont ${ts.vraies} sur un vrai texte${part(ts.vraies, ts.total)}.`,
    `Effort humain : ${te.ajouter} cadre(s) à ajouter (dont ${te.dontSuggeres} déjà suggérés), ${te.retirer} à retirer (dont ${te.dontDoublons} doublons).`,
    `Mesures : corps, écart médian ${pc(tm.pt.medianeAbs)} (signé ${pc(tm.pt.moyenneSignee)}, max ${pc(tm.pt.maxAbs)}, n = ${tm.pt.n}) ; Lc, écart moyen ${un(tm.lc.moyenneAbs)} (signé ${un(tm.lc.moyenneSignee)}, max ${un(tm.lc.maxAbs)}, n = ${tm.lc.n}).`,
    `Objets : ${to.trouves}/${to.attendus} retrouvés, ${to.typeJuste} du bon type, ${to.couleurProche} de la bonne couleur, ${to.inventes} inventés${to.figuresNonComparees ? ` (${to.figuresNonComparees} figure(s) non comparées, export absent)` : ''} ; séries ${to.seriesTrouvees}/${to.seriesAttendues}, ${to.seriesInventees} inventées ; figures sans objet : ${to.figuresSansObjets}, dont ${to.figuresSansObjetsAvecInventions} avec des objets ou séries inventés (${to.inventesSurSansObjets} objets).`,
    `Temps : ${un(total.temps.total)} s en tout, ${un(total.temps.moyenne)} s par figure, ${un(total.temps.max)} s au plus.`,
    ...(total.exportsAbsents ? [`Export absent (repli sur le DOM) : ${total.exportsAbsents} figure(s).`] : []),
    ...(total.erreurs ? [`Erreurs : ${total.erreurs} figure(s).`] : []),
  ];
  return `${grille}\n\n${clair.join('\n')}`;
}

// Détail d'une figure : ce qui manque, ce qui est en trop, ce qui diverge.
export function details(r) {
  const l = [];
  const t = r.textes, o = r.objets;
  if (r.erreur) l.push(`ERREUR : ${r.erreur}`);
  if (r.exportAbsent) l.push('export absent : résultat lu dans le DOM (sans statut, couleurs ni objets)');
  for (const a of r.avertissements) l.push(a);
  if (r.verdict.classe !== 'juste') l.push(`verdict : ${r.verdict.attendu ?? '?'} attendu, ${r.verdict.obtenu ?? '?'} obtenu (${CLASSES[r.verdict.classe]})`);
  if (!t.evaluable) l.push(t.motif);
  else {
    if (t.partiel) l.push(`${t.sansBoite} texte(s) de la vérité sans boîte, non comparés`);
    if (t.outilSansBoite) l.push(`${t.outilSansBoite} texte(s) de l'outil sans boîte, comptés à retirer`);
    const rates = t.problematiques.details.filter((p) => !p.bonDegre);
    if (rates.length) l.push(`problématiques ratés : ${rates.map((p) => `« ${p.texte} » (${p.trouve ? `${p.obtenu ?? 'sans degré'} pour ${p.attendu ?? 'alerte'}` : 'non trouvé'})`).join(', ')}`);
    if (t.faussesAlertes.n) l.push(`fausses alertes : ${t.faussesAlertes.liste.map((f) => `« ${f.texte} » (${f.niveau}${f.corpsPt != null ? `, ${f.corpsPt.toFixed(1)} pt` : ''}${f.lc != null ? `, Lc ${Math.round(Math.abs(f.lc))}` : ''})`).join(', ')}`);
    if (t.alertesSurConformes.length) l.push(`alertes sur des textes conformes : ${t.alertesSurConformes.map((c) => `« ${c.texte} » (${c.obtenu})`).join(', ')}`);
    const ajouts = t.effort.listeAjouter;
    if (ajouts.length) l.push(`à ajouter : ${ajouts.map((m) => `« ${m.texte} »${m.problematique ? ' !' : ''}`).join(', ')}`);
    const retraits = t.effort.listeRetirer;
    if (retraits.length) l.push(`à retirer : ${retraits.map((m) => `« ${m.texte} »${m.doublon ? ' (doublon)' : ''}`).join(', ')}`);
  }
  if (!o.evaluable) l.push(o.motif);
  if (o.manques.length) l.push(`objets manqués : ${o.manques.map((m) => `${m.type ?? 'objet'} ${m.couleur ?? ''}`.trim()).join(', ')}`);
  if (o.inventes.length) l.push(`objets inventés : ${o.inventes.map((m) => `${m.type ?? 'objet'} ${m.couleur ?? ''}`.trim()).join(', ')}`);
  if (o.series.inventees.length) l.push(`séries inventées : ${o.series.inventees.join(' ')}`);
  return l;
}

// ── Navigateur ──────────────────────────────────────────────────────────────────

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Edge sans fenêtre, port de débogage choisi par lui, profil temporaire effacé à la fermeture.
export async function navigateur(chemin) {
  const profil = await mkdtemp(join(tmpdir(), 'szh-banc-'));
  const proc = spawn(chemin, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profil}`,
    '--window-size=1280,1000', 'about:blank'], { stdio: 'ignore' });
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await attendre(100);
    try { port = (await readFile(join(profil, 'DevToolsActivePort'), 'utf8')).split('\n')[0].trim(); } catch { /* pas encore */ }
  }
  let cible;
  for (let i = 0; i < 50 && !cible; i++) {
    try { cible = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((c) => c.type === 'page'); } catch { /* pas encore */ }
    if (!cible) await attendre(100);
  }
  if (!cible) { proc.kill(); throw new Error(`navigateur injoignable : ${chemin}`); }
  const ws = new WebSocket(cible.webSocketDebuggerUrl);
  await new Promise((ok) => ws.addEventListener('open', ok));
  let id = 0;
  const enAttente = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && enAttente.has(m.id)) { enAttente.get(m.id)(m); enAttente.delete(m.id); }
  });
  const cdp = (method, params = {}) => new Promise((ok) => { const n = ++id; enAttente.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
  const evaluer = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result?.value;
  await cdp('Page.enable');
  return {
    cdp, evaluer,
    async fermer() {
      ws.close();
      proc.kill();
      await new Promise((ok) => proc.once('exit', ok));
      await rm(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

// Résultat de l'outil : son export, ou à défaut une lecture du DOM comme la version 1 du
// banc (les boîtes viennent des cadres de la figure annotée, en pixels du canevas, ramenées
// à ceux de l'image ; tout texte vaut confirmé ; pas de couleurs ni d'objets).
const EXPORTER = `(async () => {
  const erreur = document.getElementById('erreur');
  const texteErreur = erreur && !erreur.hidden ? erreur.textContent : null;
  if (window.szhFigureCheck && typeof window.szhFigureCheck.exporter === 'function') {
    return { export: await window.szhFigureCheck.exporter(), exportAbsent: false, erreur: texteErreur };
  }
  const NIVEAUX = ['ok', 'ameliorer', 'corriger'];
  const nombre = (s) => { const m = /-?\\d+(?:[.,]\\d+)?/.exec(s || ''); return m ? parseFloat(m[0].replace(',', '.')) : null; };
  const niveauDe = (el) => NIVEAUX.find((n) => el.classList.contains(n)) || null;
  const pire = (...ns) => ns.filter(Boolean).sort((a, b) => NIVEAUX.indexOf(b) - NIVEAUX.indexOf(a))[0] || null;
  const img = document.querySelector('#analyse-figure img');
  const svg = document.querySelector('#analyse-figure svg');
  const vb = svg ? svg.viewBox.baseVal : null;
  const k = img && vb && vb.width ? img.naturalWidth / vb.width : 1;
  const M = 4;
  const textes = [...document.querySelectorAll('#table-textes tbody tr')].map((tr, id) => {
    tr.dispatchEvent(new Event('mouseenter'));
    const rect = svg && svg.querySelector('rect.actif');
    let boite = null;
    if (rect) {
      const x = rect.x.baseVal.value + M, y = rect.y.baseVal.value + M, w = rect.width.baseVal.value - 2 * M, h = rect.height.baseVal.value - 2 * M;
      boite = { x0: x * k, y0: y * k, x1: (x + w) * k, y1: (y + h) * k };
    }
    tr.dispatchEvent(new Event('mouseleave'));
    const c = tr.cells;
    const nt = niveauDe(c[1]), nc = niveauDe(c[2]);
    return { id, texte: c[0].firstChild ? c[0].firstChild.textContent : '', boite, exact: null, statut: 'confirme', origine: 'dom',
      corpsPt: nombre(c[1].firstChild && c[1].firstChild.textContent), lc: nombre(c[2].firstChild && c[2].firstChild.textContent),
      couleurTexte: null, couleurFond: null, niveauTaille: nt, niveauContraste: nc, niveau: pire(nt, nc) };
  });
  const bilan = document.getElementById('bilan');
  const verdict = bilan && !bilan.hidden ? NIVEAUX.find((n) => bilan.classList.contains(n)) || null : null;
  const cg = document.getElementById('couleurs-graphique');
  const series = cg ? [...cg.querySelectorAll('.cg-couleur')].map((li, id) => ({
    id, couleur: (li.querySelector('b')?.textContent || '').trim().toUpperCase() || null,
    surfacePct: nombre(li.querySelector('.cg-tete .discret')?.textContent), niveau: niveauDe(li),
  })) : [];
  const coche = (nom) => document.querySelector('input[name="' + nom + '"]:checked')?.value ?? null;
  return {
    exportAbsent: true, erreur: texteErreur,
    export: {
      version: 0,
      figure: { nom: document.getElementById('figure-nom')?.textContent || null, type: null, largeurPx: img?.naturalWidth ?? null, hauteurPx: img?.naturalHeight ?? null },
      reglages: { format: coche('format'), seuilLc: nombre(coche('seuil')) },
      verdict, textes, objets: [], series,
      diagnosticEnsemble: document.getElementById('ensemble')?.innerText || null,
    },
  };
})()`;

// ── Serveur ─────────────────────────────────────────────────────────────────────

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.json': 'application/json',
};

export function servir(racine) {
  const serveur = createServer(async (req, res) => {
    const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const fichier = normalize(join(racine, chemin.endsWith('/') ? chemin + 'index.html' : chemin));
    if (!fichier.startsWith(racine)) { res.writeHead(403).end(); return; }
    try {
      const contenu = await readFile(fichier);
      res.writeHead(200, { 'content-type': TYPES[extname(fichier).toLowerCase()] || 'application/octet-stream' }).end(contenu);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((ok) => serveur.listen(0, '127.0.0.1', () => ok(serveur)));
}

// Paramètre d'adresse qui charge une figure servie : les exemples par ?exemple=, le reste
// par ?figure= (la page n'accepte que tmp/).
export function parametreFigure(relatif) {
  return EXEMPLES[relatif] ? `exemple=${EXEMPLES[relatif]}` : `figure=${encodeURIComponent(relatif).replace(/%2F/g, '/')}`;
}

// ── Programme ───────────────────────────────────────────────────────────────────

const DELAI_MS = 300000;

async function analyserDansNavigateur(figures, racine, dossier, edge) {
  const relatif = relative(racine, resolve(dossier)).split(sep).join('/');
  if (relatif.startsWith('..') || !relatif) { console.error('le dossier des figures doit être dans ce dépôt (tmp/ ou exemples/)'); process.exit(2); }
  const serveur = await servir(racine);
  const base = `http://127.0.0.1:${serveur.address().port}/`;
  const nav = await navigateur(edge);
  const sorties = [];
  try {
    for (const fig of figures) {
      const url = `${base}?${parametreFigure(`${relatif}/${fig.fichier}`)}&etape=4&vue=textes`;
      const debut = Date.now();
      await nav.cdp('Page.navigate', { url });
      let fini = false;
      while (Date.now() - debut < DELAI_MS) {
        await attendre(100);
        if (await nav.evaluer('document.readyState === "complete" && document.body && document.body.dataset.etat')) { fini = true; break; }
      }
      const duree = (Date.now() - debut) / 1000;
      const sortie = fini ? await nav.evaluer(EXPORTER) : { export: {}, exportAbsent: false, erreur: 'délai dépassé' };
      sorties.push({ ...sortie, duree });
      console.error(`${fig.fichier} : ${duree.toFixed(1)} s${sortie.exportAbsent ? ' (export absent)' : ''}${sortie.erreur ? ` ERREUR ${sortie.erreur}` : ''}`);
    }
  } finally {
    await nav.fermer();
    serveur.close();
  }
  return sorties;
}

async function lireJson(chemin) { return JSON.parse(await readFile(chemin, 'utf8')); }

// Export enregistré par figure : <dossier>/<fichier>.json ou <dossier>/<nom sans extension>.json,
// soit l'export lui-même, soit { export, duree }.
async function exportEnregistre(dossier, fichier) {
  const sansExt = basename(fichier, extname(fichier));
  for (const nom of [`${basename(fichier)}.json`, `${sansExt}.json`]) {
    try {
      const lu = await lireJson(join(dossier, nom));
      return lu.export ? { export: lu.export, duree: lu.duree ?? null, erreur: lu.erreur ?? null } : { export: lu, duree: null, erreur: null };
    } catch { /* fichier suivant */ }
  }
  return null;
}

async function principal() {
  const args = process.argv.slice(2);
  const option = (nom) => { const i = args.indexOf(nom); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
  const sortieJson = option('--json');
  const seulement = option('--seulement');
  const depuis = option('--depuis');
  const sansNavigateur = option('--sans-navigateur');
  const edge = option('--navigateur') || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const [fichierVerite, dossier] = args;
  if (!fichierVerite || (!dossier && !depuis && !sansNavigateur)) {
    console.error('node outils/banc.mjs <verite.json> <dossier des figures> [--json sortie.json] [--seulement a,b] [--navigateur chemin]\n'
      + 'node outils/banc.mjs <verite.json> --depuis resultats.json\nnode outils/banc.mjs <verite.json> --sans-navigateur <dossier des exports>');
    process.exit(2);
  }
  const verite = await lireJson(fichierVerite);
  if (verite.version !== 2) { console.error(`vérité de terrain version ${verite.version ?? 'absente'} : version 2 attendue (node outils/verite-v2.mjs convertit la version 1)`); process.exit(2); }
  const choisies = seulement ? seulement.split(',').map((s) => s.trim()) : null;
  const figures = verite.figures.filter((f, i) => !choisies || choisies.some((c) => (/^\d+$/.test(c) ? Number(c) === i + 1 : f.fichier.includes(c))));
  if (!figures.length) { console.error('aucune figure retenue'); process.exit(2); }

  let sorties;
  if (depuis) {
    const anciennes = new Map((await lireJson(depuis)).figures.map((r) => [r.fichier, r]));
    sorties = figures.map((fig) => {
      const a = anciennes.get(fig.fichier);
      return a ? { export: a.export, exportAbsent: a.exportAbsent, duree: a.duree, erreur: a.erreur } : { export: {}, erreur: 'absente du résultat enregistré' };
    });
  } else if (sansNavigateur) {
    sorties = await Promise.all(figures.map(async (fig) => (await exportEnregistre(sansNavigateur, fig.fichier)) || { export: {}, erreur: 'export introuvable' }));
  } else {
    const racine = resolve(fileURLToPath(new URL('..', import.meta.url)));
    sorties = await analyserDansNavigateur(figures, racine, dossier, edge);
  }
  const resultats = figures.map((fig, i) => evaluer(fig, sorties[i]));
  const total = totaliser(resultats);
  console.log(tableau(resultats, total));
  for (const r of resultats) {
    const d = details(r);
    if (d.length) console.log(`\n${r.fichier}\n${d.map((x) => `  ${x}`).join('\n')}`);
  }
  if (sortieJson) {
    await writeFile(sortieJson, JSON.stringify({
      version: 2, date: new Date().toISOString(), verite: fichierVerite, total,
      figures: resultats.map((r, i) => ({ ...r, export: sorties[i].export })),
    }, null, 2));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await principal();

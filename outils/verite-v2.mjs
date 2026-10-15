// Convertit une vérité de terrain de la version 1 (champs libres : groupes_de_textes,
// textes_reels, cantons, zones_reelles, taille_mesuree_pt…) en version 2, celle que lit
// outils/banc.mjs (schéma dans docs/BANC.md). Les positions manquent dans la version 1 :
// chaque boîte vaut null, à compléter par l'annotation. Ce que la version 1 observait de
// l'outil (manqués, faux textes) n'est pas une vérité et passe dans les notes.
//   node outils/verite-v2.mjs <verite-v1.json> <verite-v2.json>

import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lc } from '../js/apca.js';
import { TAILLE_MIN_PT, LC_MIN } from '../js/formats.js';

const HEX = /#[0-9A-Fa-f]{6}/g;
const MOTS_COULEUR = { blanc: '#FFFFFF', noir: '#000000', weiss: '#FFFFFF', schwarz: '#000000' };

// Un seul hex dans une chaîne, sinon null (« #D86B6A ou #E7A8A0 », « flèche en dégradé »).
export function hexUnique(s) {
  const tous = String(s || '').match(HEX) || [];
  return tous.length === 1 ? tous[0].toUpperCase() : null;
}

// Chaîne comparable : minuscules, sans accents, sans espaces ni ponctuation.
export const normaliser = (s) => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

const rgb = (hex) => { const v = parseInt(hex.slice(1), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };

export function typeDe(fichier) {
  const ext = extname(String(fichier || '')).toLowerCase();
  if (ext === '.svg') return 'svg';
  if (ext === '.pdf') return 'pdf';
  return 'bitmap';
}

// Verdict attendu lu dans la phrase libre de la version 1 ; null si elle ne tranche pas.
export function verdictDe(texte) {
  if (typeof texte !== 'string') return null;
  const s = texte.toLowerCase();
  if (/rien à corriger|conforme/.test(s) && !/non conforme/.test(s)) return 'ok';
  if (/à améliorer/.test(s) && /pas\s*«?\s*à corriger/.test(s)) return 'ameliorer';
  if (/à corriger/.test(s)) return 'corriger';
  if (/à améliorer/.test(s)) return 'ameliorer';
  return null;
}

// Textes réels d'une figure, avec ce que la version 1 sait de chacun :
// { texte, couleurTexte, couleurFond, dansAplat, lcRef }.
function textesDe(fig, toutes, vus = new Set()) {
  vus.add(fig.n);
  const textes = [];
  const ajouter = (texte, attrs = {}) => textes.push({ texte, couleurTexte: null, couleurFond: null, dansAplat: false, lcRef: null, ...attrs });
  const depuisObjet = (t) => ({ couleurTexte: hexUnique(t.couleur), couleurFond: hexUnique(t.fond), dansAplat: Boolean(t.dans_aplat), lcRef: t.lc_reference ?? null });
  for (const g of fig.groupes_de_textes || []) for (const t of g.textes) ajouter(t, depuisObjet(g));
  if (typeof fig.textes_reels === 'string') {
    const m = /figure (\d+)/i.exec(fig.textes_reels);
    const autre = m && toutes.find((f) => f.n === Number(m[1]));
    if (autre && !vus.has(autre.n)) textes.push(...textesDe(autre, toutes, vus));
  } else if (Array.isArray(fig.textes_reels)) {
    for (const t of fig.textes_reels) (typeof t === 'string' ? ajouter(t) : ajouter(t.texte, depuisObjet(t)));
  }
  for (const t of fig.textes_reels_transcrits || []) ajouter(t);
  for (const paire of fig.cantons || []) for (const t of paire) ajouter(t, { dansAplat: true });
  for (const t of fig.exemples_textes_reels || []) ajouter(t);
  return textes;
}

// Tailles de référence : « tous » vaut pour tous les textes, sinon la clé cite les textes.
function appliquerTailles(fig, textes) {
  for (const [cle, v] of Object.entries(fig.taille_mesuree_pt || {})) {
    const pt = Array.isArray(v) ? (v[0] + v[v.length - 1]) / 2 : v;
    const nc = normaliser(cle);
    for (const t of textes) {
      const nt = normaliser(t.texte);
      if (/\btous\b/i.test(cle) || (nt.length >= 3 && nc.includes(nt))) t.corpsPt = pt;
    }
  }
  if (fig.taille_typique_pt != null) for (const t of textes) if (t.corpsPt == null) t.corpsPt = fig.taille_typique_pt;
}

// « blanc sur #DD807B (Écoles spécialisées, 2,35 %) », lc 59 : couleurs et Lc des textes
// cités ; propres à la figure, ils l'emportent sur ce qu'une liste copiée apportait.
function appliquerContrastes(fig, textes) {
  for (const c of fig.contrastes_reference || []) {
    const m = /\(([^)]*)\)/.exec(c.texte || '');
    if (!m) continue;
    const avant = c.texte.slice(0, m.index).toLowerCase();
    const sur = /sur\s+(#[0-9a-f]{6})/i.exec(avant);
    const fond = sur ? sur[1].toUpperCase() : null;
    const devant = avant.slice(0, sur ? sur.index : avant.length);
    const mot = Object.keys(MOTS_COULEUR).find((k) => devant.includes(k));
    const couleur = hexUnique(devant) || (mot ? MOTS_COULEUR[mot] : null);
    for (const cite of m[1].split(/,\s+/).map((s) => normaliser(s.replace(/…/g, '')))) {
      if (!cite) continue;
      for (const t of textes) {
        if (normaliser(t.texte) !== cite) continue;
        if (c.lc != null) t.lcRef = c.lc;
        if (couleur) t.couleurTexte = couleur;
        if (fond) t.couleurFond = fond;
      }
    }
  }
}

function zonesDe(fig, toutes, vus = new Set()) {
  vus.add(fig.n);
  if (Array.isArray(fig.zones_reelles)) return fig.zones_reelles.map((z) => ({ couleur: z.hex.toUpperCase(), part: z.part }));
  const m = /figure (\d+)/i.exec(fig.zones_reelles || '');
  const autre = m && toutes.find((f) => f.n === Number(m[1]));
  return autre && !vus.has(autre.n) ? zonesDe(autre, toutes, vus) : [];
}

function fondDe(fig, zones) {
  if (/photo|sans objet/i.test(fig.fond_reel || '')) return null;
  const m = /#[0-9A-Fa-f]{6}/.exec(fig.fond_reel || '');
  if (m) return m[0].toUpperCase();
  return zones.length ? zones[0].couleur : null;
}

function lcDe(t) {
  if (t.lcRef != null) return t.lcRef;
  return t.couleurTexte && t.couleurFond ? Math.abs(lc(rgb(t.couleurTexte), rgb(t.couleurFond))) : null;
}

export function convertirFigure(fig, toutes) {
  const notes = [];
  if (fig.n != null) notes.push(`n° ${fig.n} de la version 1`);
  if (fig.type) notes.push(fig.type);
  if (fig.note) notes.push(fig.note);
  if (fig.note_chaines) notes.push(fig.note_chaines);
  if (Array.isArray(fig.imprimee_mm_par_outil)) notes.push(`imprimée ${fig.imprimee_mm_par_outil.join(' × ')} mm par l'outil`);
  if (fig.resolution_signalee_ppp) notes.push(`résolution signalée ${fig.resolution_signalee_ppp} ppp`);

  const textes = textesDe(fig, toutes);
  const defaut = String(fig.couleur_par_defaut || '').match(HEX) || [];
  const zones = zonesDe(fig, toutes);
  const fond = fondDe(fig, zones);
  appliquerTailles(fig, textes);
  appliquerContrastes(fig, textes);
  for (const t of textes) {
    if (!t.couleurTexte && defaut[0]) t.couleurTexte = defaut[0].toUpperCase();
    if (!t.couleurFond && !t.dansAplat) t.couleurFond = (defaut[1] && defaut[1].toUpperCase()) || fond;
  }
  // Une liste vide n'est complète que si la version 1 l'affirme ou annonce zéro texte.
  const listeComplete = fig.liste_complete === true || (fig.liste_complete !== false && (textes.length > 0 || fig.nombre_textes_reels === 0));
  if (fig.nombre_textes_reels != null && textes.length && textes.length !== fig.nombre_textes_reels) {
    notes.push(`${textes.length} textes transcrits pour ${fig.nombre_textes_reels} annoncés`);
  }
  if (fig.nombre_textes_reels_approx != null) notes.push(`environ ${fig.nombre_textes_reels_approx} textes réels, ${textes.length} transcrits`);

  const verdictAttendu = verdictDe(fig.verdict_attendu);
  if (fig.verdict_attendu && !verdictAttendu) notes.push(`verdict à fixer : ${fig.verdict_attendu}`);
  else if (!fig.verdict_attendu) {
    const niveaux = textes.map((t) => {
      const l = lcDe(t);
      if (t.corpsPt != null && t.corpsPt < 6.5) return 'corriger';
      if (l != null && l < LC_MIN - 15) return 'corriger';
      if ((t.corpsPt != null && t.corpsPt < TAILLE_MIN_PT) || (l != null && l < LC_MIN)) return 'ameliorer';
      return null;
    });
    const pire = niveaux.includes('corriger') ? 'corriger' : niveaux.includes('ameliorer') ? 'ameliorer' : null;
    notes.push(pire ? `verdict à fixer : au moins « ${pire} » d'après les références` : 'verdict à fixer');
  }

  const observations = [];
  const liste = (v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : `${x.lu} (${x.endroit || `${x.fois} fois`})`)).join(' ; ') : String(v));
  if (fig.manques_par_l_outil && (Array.isArray(fig.manques_par_l_outil) ? fig.manques_par_l_outil.length : true)) observations.push(`manqués par l'outil (v1) : ${liste(fig.manques_par_l_outil)}`);
  if (fig.faux_textes_observes?.length) observations.push(`faux textes observés (v1) : ${liste(fig.faux_textes_observes)}`);
  if (fig.lectures_deformees?.length) observations.push(`lectures déformées (v1) : ${liste(fig.lectures_deformees)}`);
  if (fig.lus_par_l_outil) observations.push(`lus par l'outil (v1) : ${Array.isArray(fig.lus_par_l_outil) ? fig.lus_par_l_outil.join(', ') : fig.lus_par_l_outil}`);
  if (fig.zones_manquees_par_l_outil?.length) observations.push(`zones manquées par l'outil (v1) : ${fig.zones_manquees_par_l_outil.join(' ')}`);
  if (fig.textes_non_transcrits) observations.push(`textes non transcrits : ${liste(fig.textes_non_transcrits)}`);
  if (typeof fig.zones_reelles === 'string' && !/figure \d+/i.test(fig.zones_reelles)) observations.push(`zones (v1) : ${fig.zones_reelles}`);
  if (typeof fig.fond_reel === 'string' && !/^#[0-9A-Fa-f]{6}$/.test(fig.fond_reel)) observations.push(`fond (v1) : ${fig.fond_reel}`);
  notes.push('boîtes à mesurer sur l\'image', `problematique déduit des références (corps < ${TAILLE_MIN_PT} pt ou Lc < ${LC_MIN}) ; false sans référence`);

  return {
    fichier: fig.fichier,
    provenance: fig.provenance ?? null,
    type: typeDe(fig.fichier),
    largeurPx: Array.isArray(fig.pixels) ? fig.pixels[0] : null,
    hauteurPx: Array.isArray(fig.pixels) ? fig.pixels[1] : null,
    verdictAttendu,
    listeComplete,
    fond,
    textes: textes.map((t) => {
      const l = lcDe(t);
      return {
        texte: t.texte, boite: null,
        corpsPt: t.corpsPt ?? null, couleurTexte: t.couleurTexte, couleurFond: t.couleurFond, dansAplat: t.dansAplat,
        problematique: (t.corpsPt != null && t.corpsPt < TAILLE_MIN_PT) || (l != null && l < LC_MIN),
      };
    }),
    objets: zones.filter((z) => z.couleur !== fond).map((z) => ({ type: null, couleur: z.couleur, boite: null, surfacePct: z.part })),
    notes: [...notes, ...observations].join(' | '),
  };
}

export function convertir(v1) {
  const figures = (v1.figures || []).map((f) => convertirFigure(f, v1.figures));
  const lisezMoi = v1._lisez_moi;
  return {
    version: 2,
    notes: lisezMoi ? Object.entries(lisezMoi).map(([k, v]) => `${k} : ${v}`).join(' | ') : undefined,
    figures,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [entree, sortie] = process.argv.slice(2);
  if (!entree || !sortie) { console.error('node outils/verite-v2.mjs <verite-v1.json> <verite-v2.json>'); process.exit(2); }
  const v1 = JSON.parse(await readFile(entree, 'utf8'));
  const v2 = convertir(v1);
  await writeFile(sortie, JSON.stringify(v2, null, 2) + '\n');
  const textes = v2.figures.reduce((s, f) => s + f.textes.length, 0);
  console.log(`${v2.figures.length} figures, ${textes} textes sans boîte, ${v2.figures.filter((f) => f.verdictAttendu).length} verdicts fixés → ${sortie}`);
}

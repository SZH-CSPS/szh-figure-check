// Interface : quatre étapes en accordéon (figure, paramètres, écran, analyse) ; l'analyse
// montre une vue à la fois (aperçu à taille réelle, textes, couleurs). Dans la vue des
// textes, la vue résidu masque les textes connus pour laisser voir ce qui a été oublié.

import { FORMATS, zoneContenu, tailleFigure, versPoints, TAILLE_MIN_PT, SEUILS_LC, MM_PAR_PX, PPP_MIN, proportionDepuis } from './formats.js?v=0791318027';
import { niveauTaille, niveauContraste, pireNiveau, agrandissement, couleurConforme, regrouper, diagnosticEnsemble, RATIO_X } from './analyse.js?v=0791318027';
import { compte, visible, boiteNormalisee, recouvreUnTexte, exporterLecture, verdictProvisoire, trancherAVerifier, retablir } from './residu.js?v=0791318027';
import { versHex } from './apca.js?v=0791318027';
import { ouvrir } from './sources.js?v=0791318027';
import { lire, mesurerAjout, lireZone } from './lecture.js?v=0791318027';
import { filtreFlou, simulerPerteContraste, lectureAcuite, PROFILS, MM_PAR_DEGRE } from './vision.js?v=0791318027';
import { SALLES, DIAPO, CM_PAR_PT, cadreFigure, largeurApparenteCm, minusculeMinCm } from './projection.js?v=0791318027';
import { T, langueInitiale, nombre } from './i18n.js?v=0791318027';
import { rendreObjets, exporterObjets } from './objets.js?v=0791318027';

const PX_PAR_MM_NOMINAL = 96 / 25.4;
const CLE_CALIBRATION = 'szh-figure-check.pxParMm';
const CARTE_MM = 85.6;
const EXEMPLES = { png: 'exemples/figure-exemple.png', svg: 'exemples/figure-exemple.svg' };

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const etat = {
  langue: langueInitiale(params.get('langue'), navigator.language),
  format: FORMATS[params.get('format')] ? params.get('format') : 'revue',
  proportion: proportionDepuis(params.get('largeur')),
  seuil: SEUILS_LC.includes(Number(params.get('lc'))) ? Number(params.get('lc')) : SEUILS_LC[0],
  masquer: false,
  etape: 1,
  onglet: 'vue-page',
  tailleVue: 'reelle',
  salle: 'petite',
  ecranCm: SALLES.petite.largeurCm,
  distanceCm: SALLES.petite.distanceCm,
  vue: 'reelle',
  pxParMm: lireCalibration(),
  source: null,
  lecture: null,
  jeton: 0,
  annulable: null, // { lecture, ids } : la dernière réponse groupée, qu'on peut défaire
  depliee: null, // la lecture dont la liste « À vérifier » est dépliée en entier
};

const t = (cle, valeurs) => T(etat.langue, cle, valeurs);

function lireCalibration() {
  try {
    const v = parseFloat(localStorage.getItem(CLE_CALIBRATION));
    return v > 1 ? v : null;
  } catch { return null; }
}

function ecrireCalibration(v) {
  try {
    if (v) localStorage.setItem(CLE_CALIBRATION, String(v));
    else localStorage.removeItem(CLE_CALIBRATION);
  } catch { /* stockage indisponible : réglage gardé pour la session */ }
}

function element(nom, attributs = {}, ...enfants) {
  const el = document.createElement(nom);
  for (const [k, v] of Object.entries(attributs)) {
    if (k === 'class') el.className = v;
    else if (k === 'style') Object.assign(el.style, v);
    else el.setAttribute(k, v);
  }
  el.append(...enfants.filter((e) => e != null));
  return el;
}

// ── Textes de l'interface ───────────────────────────────────────────────────────

function appliquerLangue() {
  document.documentElement.lang = etat.langue;
  document.title = t('titre');
  for (const el of document.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  if (!BASSE_VISION) {
    for (const el of document.querySelectorAll('.seulement-basse-vision')) el.hidden = true;
    for (const el of document.querySelectorAll('[data-t="descVision"]')) el.textContent = t('descVisionAVenir');
  }
  for (const el of document.querySelectorAll('[data-t-aria]')) el.setAttribute('aria-label', t(el.dataset.tAria));
  rendreResumes();
  nommerPanneau();
  $('langue').textContent = t('autreLangue');
  $('langue').lang = etat.langue === 'fr' ? 'de' : 'fr';
  if (etat.source) { rendrePage(); rendreAnalyse(); rendreCouleurs(); }
}

// ── Page simulée ────────────────────────────────────────────────────────────────

function figureSurPage() {
  const s = etat.source;
  return tailleFigure(FORMATS[etat.format], s.ratio, s.naturel, etat.proportion);
}

function rendrePage() {
  const f = FORMATS[etat.format];
  const s = etat.source;
  const fig = figureSurPage();
  const page = $('page');
  Object.assign(page.style, {
    width: `${f.page.l}mm`, height: `${f.page.h}mm`,
    padding: `${f.marges.haut}mm ${f.marges.droite}mm ${f.marges.bas}mm ${f.marges.gauche}mm`,
    fontSize: `${f.corpsPt}pt`, lineHeight: String(f.interligne),
  });
  const paragraphes = t('texteCourant');
  const legende = element('figcaption', { style: { fontSize: `${f.legendePt}pt`, fontStyle: f.legendeItalique ? 'italic' : 'normal' } },
    element('b', {}, t('legendeNumero')), ' ', t('legendeTexte'));
  const image = element('img', { src: s.url, alt: '', style: { width: `${fig.l}mm`, height: `${fig.h}mm` } });
  page.replaceChildren(
    element('p', {}, paragraphes[0]),
    element('figure', {}, legende, image),
    ...paragraphes.slice(1).map((p) => element('p', {}, p)),
    ...paragraphes.map((p) => element('p', {}, p)),
  );
  document.querySelector('#style-impression').textContent =
    `@page { size: ${f.page.l}mm ${f.page.h}mm; margin: 0; }`;

  $('dimensions').textContent = t('imprimee', { l: Math.round(fig.l), h: Math.round(fig.h) });
  $('calibration').textContent = t(etat.pxParMm ? 'calibrationOui' : 'calibrationNon');

  const alertes = [];
  const zone = zoneContenu(f);
  if (fig.h >= zone.h * f.plafond - 0.01) alertes.push(t('plafonnee'));
  if (!etat.proportion && s.type === 'bitmap' && s.naturel.l * MM_PAR_PX < zone.l - 1) {
    alertes.push(t('petiteNaturelle', { px: s.naturel.l }));
  }
  // Une image étroite étirée à la largeur de la colonne manque de pixels : elle est floue.
  if (s.pixels) {
    const ppp = s.pixels.l / (fig.l / 25.4);
    const etiree = Boolean(etat.proportion) && s.naturel.l * MM_PAR_PX < fig.l - 0.5;
    if (ppp < PPP_MIN) alertes.push(t(etiree ? 'petiteEtiree' : 'resolutionFaible', { ppp: Math.round(ppp), px: s.pixels.l }));
  }
  $('alertes-page').replaceChildren(...alertes.map((a) => element('li', {}, a)));
  zoomer();
}

function zoomer() {
  const page = $('page');
  const f = FORMATS[etat.format];
  let k = (etat.pxParMm || PX_PAR_MM_NOMINAL) / PX_PAR_MM_NOMINAL;
  if (etat.vue === 'page') {
    const cadre = $('cadre-page');
    const dispoL = cadre.clientWidth - 32, dispoH = window.innerHeight * 0.85;
    k = Math.min(dispoL / (f.page.l * PX_PAR_MM_NOMINAL), dispoH / (f.page.h * PX_PAR_MM_NOMINAL));
  }
  page.style.zoom = String(k);
}

// ── Textes de la figure ─────────────────────────────────────────────────────────

const SYMBOLES = { corriger: '✕', ameliorer: '!', ok: '✓', provisoire: '?' };
const ROUGE = '#d0021b';

function statut(cle, valeurs) {
  $('statut').textContent = cle ? t(cle, valeurs) : '';
}

async function analyser() {
  const jeton = ++etat.jeton;
  etat.lecture = null;
  etat.endroits = null;
  rendreAnalyse();
  try {
    const lecture = await lire(etat.source, figureSurPage().l, (etape, p) => {
      if (jeton !== etat.jeton) return;
      if (etape === 'rendu') statut('preparation');
      else if (etape === 'chargement') statut('chargementOcr');
      else if (etape === 'detecteur-chargement') statut('chargementDetecteur');
      else if (etape === 'detection') statut('detectionTextes');
      else if (etape === 'ocr') statut('lectureOcr', { p: Math.round(p * 100) });
      else if (etape === 'suggestions') statut('rechercheSuggestions');
    });
    if (jeton !== etat.jeton) return;
    etat.lecture = lecture;
    statut(lecture.repli ? 'repliOcr' : null);
    rendreAnalyse();
  } catch (e) {
    if (jeton !== etat.jeton) return;
    statut(null);
    montrerErreur(e.message === 'cdn' ? 'erreurCdn' : 'erreurFichier', e);
  }
  document.body.dataset.etat = 'fini';
}

// Tous les textes de la lecture, statuts compris, avec leurs mesures à l'impression.
function mesures() {
  const { canevas, lignes } = etat.lecture;
  const fig = figureSurPage();
  return lignes.map((l) => {
    const pt = l.corpsPx ? versPoints(l.corpsPx, canevas.width, fig.l) : null;
    const lcv = l.contraste ? l.contraste.lc : null;
    // Le degré se décide sur la valeur affichée, arrondie comme elle s'écrit.
    const nt = niveauTaille(pt == null ? null : Math.round(pt * 10) / 10);
    const nc = niveauContraste(lcv == null ? null : Math.round(lcv), etat.seuil);
    return { ...l, pt, lc: lcv, nt, nc, niveau: pireNiveau(nt, nc) };
  });
}

// Verdict de la figure d'après les textes qui comptent.
function verdictGlobal(lignes) {
  if (lignes.some((l) => l.niveau === 'corriger')) return 'corriger';
  return lignes.some((l) => l.niveau === 'ameliorer') ? 'ameliorer' : 'ok';
}

// Extrait de la figure autour d'une zone, la zone entourée de rouge.
function extrait(canevas, bbox, maxL = 560, maxH = 240) {
  const lb = bbox.x1 - bbox.x0, hb = bbox.y1 - bbox.y0;
  const marge = Math.max(30, Math.min(lb, hb) * 1.5);
  const sx = Math.max(0, bbox.x0 - marge * 1.6), sy = Math.max(0, bbox.y0 - marge);
  const sl = Math.min(canevas.width, bbox.x1 + marge * 1.6) - sx;
  const sh = Math.min(canevas.height, bbox.y1 + marge) - sy;
  const e = Math.min(2, maxL / sl, maxH / sh);
  const c = document.createElement('canvas');
  c.width = Math.round(sl * e);
  c.height = Math.round(sh * e);
  const ctx = c.getContext('2d');
  ctx.drawImage(canevas, sx, sy, sl, sh, 0, 0, c.width, c.height);
  const p = 6;
  ctx.strokeStyle = ROUGE;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect((bbox.x0 - sx) * e - p, (bbox.y0 - sy) * e - p, lb * e + 2 * p, hb * e + 2 * p, 8);
  ctx.stroke();
  return c.toDataURL('image/png');
}

function badge(niveau) {
  return element('span', { class: `badge ${niveau}` },
    element('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES[niveau]), ' ', t(`niveau_${niveau}`));
}

function nuancier(...couleurs) {
  return element('span', { class: 'nuancier', title: couleurs.map(versHex).join(' / ') },
    ...couleurs.map((c) => element('span', { style: { background: versHex(c) } })));
}

function texteTaille(l) {
  return l.pt == null ? t('nonMesure') : `${l.exact ? '' : '≈ '}${nombre(l.pt)} pt`;
}

function texteContraste(l) {
  return l.lc == null ? t('nonMesure') : `Lc ${Math.round(Math.abs(l.lc))}`;
}

// Libellé d'un texte : ce qui a été lu, sinon « texte non lu » en retrait. Une boîte du
// détecteur dont la lecture est vide ou absurde s'affiche « ? », avec son étiquette.
function libelle(l) {
  if (l.lectureIncertaine && l.texte === '?') return element('span', {}, '?', ' ', element('span', { class: 'etiquette discret' }, t('libelleNonLu')));
  return l.texte ? l.texte : element('i', {}, t(l.origine === 'suggestion' ? 'suggestionTexte' : 'texteNonLu'));
}

function etiquetteStatut(statut) {
  return element('span', { class: `statut-etiquette ${statut}` }, t(`statut_${statut}`));
}

function conseils(l, plusieurs) {
  const liste = [];
  if (l.nt && l.nt !== 'ok') liste.push(element('li', {}, t(plusieurs ? 'conseilTailles' : 'conseilTaille', { p: agrandissement(l.pt) })));
  if (l.nc && l.nc !== 'ok') {
    // Avec 10 de marge si possible, sinon juste au seuil.
    const proposition = couleurConforme(l.contraste.texte, l.contraste.fond, etat.seuil + 10)
      || couleurConforme(l.contraste.texte, l.contraste.fond, etat.seuil);
    if (!proposition) {
      liste.push(element('li', {}, t('conseilFond')));
    } else {
      const hex = versHex(proposition.couleur);
      const [avant, apres] = t(proposition.sens === 'foncer' ? 'conseilFoncer' : 'conseilEclaircir', { hex: '\u0000' }).split('\u0000');
      liste.push(element('li', {}, avant, element('b', {}, hex), ' ', nuancier(proposition.couleur), apres));
    }
  }
  return liste;
}

const TEXTES_PAR_CARTE = 6;
const CARTES_MAX = 8;
const CONFORMES_MAX = 6;
const VERIFIER_MAX = 6;

// « 3,0 pt » ou « 3,0 à 4,2 pt » selon l'étendue des valeurs.
function plage(valeurs, formater) {
  const a = Math.min(...valeurs), b = Math.max(...valeurs);
  const fa = formater(a), fb = formater(b);
  return fa === fb ? fa : t('plage', { a: fa, b: fb });
}

// Ce qu'un groupe montre : les pires valeurs et la plage de ses membres.
function resumeGroupe(groupe) {
  const m = groupe.membres;
  const tailles = m.filter((l) => l.pt != null);
  const contrastes = m.filter((l) => l.lc != null);
  const approx = tailles.some((l) => !l.exact) ? '≈ ' : '';
  const pireContraste = contrastes.reduce((a, b) => (Math.abs(b.lc) < Math.abs(a.lc) ? b : a), contrastes[0]);
  return {
    taille: tailles.length ? `${approx}${plage(tailles.map((l) => l.pt), (v) => nombre(v))} pt` : t('nonMesure'),
    contraste: contrastes.length ? `Lc ${plage(contrastes.map((l) => Math.abs(l.lc)), (v) => String(Math.round(v)))}` : t('nonMesure'),
    pour: {
      nt: pireNiveau(...m.map((l) => l.nt)),
      pt: tailles.length ? Math.min(...tailles.map((l) => l.pt)) : null,
      nc: pireNiveau(...m.map((l) => l.nc)),
      contraste: pireContraste ? pireContraste.contraste : null,
    },
  };
}

function carteZone(groupe, numero, canevas) {
  const l = groupe.representant;
  const r = resumeGroupe(groupe);
  const n = groupe.membres.length;
  const montres = n > TEXTES_PAR_CARTE + 1 ? TEXTES_PAR_CARTE : n;
  const cites = groupe.membres.slice(0, montres).map((m) => `« ${m.texte} »`).join(', ')
    + (n > montres ? ` ${t('etAutres', { n: n - montres })}` : '');
  const ligneMesure = (cle, valeur, niveau, minimum, extra) => element('div', { class: 'mesure' },
    element('dt', {}, t(cle)),
    element('dd', { class: niveau || 'inconnu' }, element('b', {}, valeur), ` (${minimum}) `, extra,
      niveau && niveau !== 'ok' ? badge(niveau) : null));
  const carte = element('li', { class: `zone ${groupe.niveau}`, id: `zone-${numero}` },
    element('div', { class: 'zone-tete' }, element('span', { class: 'numero' }, String(numero)), badge(groupe.niveau),
      n > 1 ? element('span', { class: 'discret' }, t('memeStyle', { n })) : null),
    element('img', { src: extrait(canevas, l.bbox), alt: t('extraitAlt', { texte: l.texte }) }),
    element('dl', {},
      element('div', { class: 'mesure' }, element('dt', {}, t(n > 1 ? 'zoneTextesLus' : 'zoneTexteLu')), element('dd', {}, cites)),
      ligneMesure('zoneTaille', r.taille, r.pour.nt, t('minimumTaille', { min: TAILLE_MIN_PT })),
      ligneMesure('zoneContraste', r.contraste, r.pour.nc, t('minimumContraste', { lc: etat.seuil }),
        r.pour.contraste ? nuancier(r.pour.contraste.texte, r.pour.contraste.fond) : null)),
    ...(groupe.niveau === 'ok'
      ? [element('p', { class: 'que-faire' }, t('conformeRien'))]
      : [element('p', { class: 'que-faire' }, element('b', {}, t('queFaire'))),
        element('ul', {}, ...conseils(r.pour, n > 1))]));
  return carte;
}

// Encadré « la figure entière est trop petite », avec ce que donneraient la pleine
// largeur de colonne et une page entière en paysage.
function carteEnsemble(diag) {
  const f = FORMATS[etat.format];
  const zone = zoneContenu(f);
  const fig = figureSurPage();
  const ratio = etat.source.ratio;
  const phrases = [
    t('ensembleTexte', { n: diag.petits, total: diag.total, min: TAILLE_MIN_PT, bas: nombre(diag.bas), haut: nombre(diag.haut) }),
    t('ensembleFacteur', { min: TAILLE_MIN_PT, f: nombre(diag.facteur) }),
  ];
  const pleine = Math.min(zone.l, zone.h * f.plafond / ratio);
  if (pleine > fig.l * 1.05) phrases.push(t('ensemblePleineLargeur', { pt: nombre(diag.mediane * pleine / fig.l) }));
  const paysage = Math.min(zone.h, zone.l / ratio);
  if (paysage > Math.max(fig.l, pleine) * 1.05) phrases.push(t('ensemblePaysage', { pt: nombre(diag.mediane * paysage / fig.l) }));
  return element('div', { class: 'bilan corriger ensemble' },
    element('p', { class: 'bilan-titre' }, element('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES.corriger), ' ', t('ensembleTitre')),
    element('p', {}, phrases.join(' ')),
    element('p', {}, element('b', {}, t('queFaireDeuxPoints')), ' ', t('ensembleConseil')));
}

// Le bilan compte les endroits (les groupes), pas les textes, et dit par où commencer :
// le premier endroit affiché, avec ce qui lui manque (taille, contraste ou les deux).
function phraseEndroits(groupes, premier, diag) {
  const nC = groupes.filter((g) => g.niveau === 'corriger').length;
  const nA = groupes.filter((g) => g.niveau === 'ameliorer').length;
  const comptes = nC ? [t('bilanEndroits_corriger', { n: nC }), nA ? t('bilanEndroitsCourt_ameliorer', { n: nA }) : null]
    : [t('bilanEndroits_ameliorer', { n: nA })];
  const phrase = [comptes.filter(Boolean).join(', ') + '.'];
  const r = resumeGroupe(premier);
  // Quand la figure entière est trop petite, l'encadré d'ensemble parle de la taille.
  const petit = !diag && r.pour.nt && r.pour.nt !== 'ok';
  const pale = r.pour.nc && r.pour.nc !== 'ok';
  if (petit || pale) {
    const n = premier.membres.length;
    const cites = premier.membres.filter((l) => l.texte).slice(0, 2).map((l) => (etat.langue === 'de' ? `«${l.texte}»` : `« ${l.texte} »`)).join(', ');
    const qui = cites ? cites + (n > 2 ? ` ${t('etAutres', { n: n - 2 })}` : '') : t('departCeTexte', { n });
    phrase.push(t('bilanDepart', { n: 1, quoi: `${qui} ${t(petit && pale ? 'departLesDeux' : petit ? 'departTaille' : 'departContraste', { n })}` }));
  }
  return phrase.join(' ');
}

function rendreAnalyse() {
  const cadre = $('analyse-figure');
  const tbody = document.querySelector('#table-textes tbody');
  const f = FORMATS[etat.format];
  rendreObjets($('objets-graphique'), etat.lecture, etat.source, figureSurPage().l, etat.langue);
  $('rapport-fichier').textContent = t('rapportFichier', {
    nom: etat.source.nom, format: t(etat.format === 'revue' ? 'formatRevue' : 'formatLivre'),
  });
  fermerFenetreMasque();
  if (!etat.lecture) {
    cadre.className = 'analyse-figure';
    cadre.replaceChildren(element('img', { src: etat.source.url, alt: '' }));
    for (const id of ['bilan', 'niveaux', 'zones-titre', 'statuts-titre', 'details-textes', 'imprimer-rapport', 'exporter-lecture', 'residu-commandes']) $(id).hidden = true;
    for (const id of ['zones', 'statuts-impression', 'puces', 'panneau', 'ensemble']) $(id).replaceChildren();
    $('zones-reste').textContent = '';
    $('residu-aide').textContent = '';
    tbody.replaceChildren();
    $('note-mesure').textContent = '';
    return;
  }
  const { canevas } = etat.lecture;
  // Seuls les textes confirmés et ajoutés comptent ; ceux à vérifier sont montrés à part,
  // les retirés n'apparaissent plus.
  const toutes = mesures();
  const actives = toutes.filter((l) => visible(l.statut));
  const lignes = actives.filter((l) => compte(l.statut));
  const aVerifier = actives.filter((l) => l.statut === 'a-verifier');
  const ajoutes = actives.filter((l) => l.statut === 'ajoute');
  // Quand la figure entière est trop petite, un encadré le dit une fois pour toutes ; les
  // cartes ne portent alors plus que sur le contraste, par style de texte.
  const diag = diagnosticEnsemble(lignes);
  const fautifs = diag
    ? lignes.filter((l) => l.nc && l.nc !== 'ok').map((l) => ({ ...l, niveau: l.nc }))
    : lignes.filter((l) => l.niveau && l.niveau !== 'ok');
  let groupes = regrouper(fautifs);
  const souple = Boolean(diag) || groupes.length > CARTES_MAX;
  if (souple) groupes = regrouper(fautifs, { souple: true });
  const affiches = groupes.slice(0, CARTES_MAX);
  // Les textes conformes forment eux aussi des groupes, par style, pour pouvoir les montrer.
  const conformes = regrouper(lignes.filter((l) => l.niveau === 'ok'), { souple: true }).slice(0, CONFORMES_MAX);
  const explorables = [...affiches, ...conformes];
  etat.endroits = groupes.length;
  etat.aVerifier = aVerifier.length;
  rendreResumes();

  // Figure annotée : rien n'y est dessiné par défaut, et on n'agit pas sur elle. Les puces
  // numérotées choisissent le groupe mis en évidence, un seul à la fois : le survol
  // l'affiche, le clic le rend actif ; sortir de la rangée de puces revient au groupe actif.
  // Le groupe 1 est actif au départ. Sa carte s'affiche dans le panneau. La puce active est
  // pleine et soulignée, celle qu'on survole n'est que teintée, et le panneau dit s'il
  // montre l'endroit actif ou un aperçu. Les groupes conformes s'encadrent en vert.
  const W = canevas.width, H = canevas.height;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const voile = svgEl('path', { class: 'voile', 'fill-rule': 'evenodd' });
  svg.append(voile);
  const m = 4;
  const boite = (l) => ({ x: l.bbox.x0 - m, y: l.bbox.y0 - m, w: l.bbox.x1 - l.bbox.x0 + 2 * m, h: l.bbox.y1 - l.bbox.y0 + 2 * m });

  // Cadres des textes sans carte, à vérifier compris : invisibles, montrés un par un depuis
  // les listes.
  const rectDe = new Map();
  const groupeDe = new Map();
  explorables.forEach((g, i) => g.membres.forEach((l) => groupeDe.set(l.id, i)));
  const neutres = svgEl('g', { class: 'neutres' });
  for (const l of actives) {
    if (groupeDe.has(l.id)) continue;
    const b = boite(l);
    const r = svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: l.statut === 'a-verifier' ? 'a-verifier' : (l.niveau || 'inconnu') });
    neutres.append(r);
    rectDe.set(l.id, r);
  }
  svg.append(neutres);

  // Tous les textes d'un groupe prennent la couleur du groupe, celle de sa boîte et de sa
  // carte, même si l'un d'eux, pris seul, est d'un degré moins grave.
  const calques = explorables.map((g) => {
    const calque = svgEl('g', { class: `groupe ${g.niveau}` });
    for (const l of g.membres) {
      const b = boite(l);
      const r = svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: `cadre ${g.niveau}` });
      calque.append(r);
      rectDe.set(l.id, r);
    }
    svg.append(calque);
    return calque;
  });
  const surligner = (id, oui) => rectDe.get(id)?.classList.toggle('actif', oui);

  // Quatre boîtes : une par degré, avec ses numéros, et « À vérifier », avec ses textes
  // douteux et, pour chacun, les deux réponses possibles.
  const puces = $('puces');
  const boutons = explorables.map((g, i) => element('button', {
    type: 'button', 'aria-pressed': 'false', 'aria-controls': 'panneau', class: `puce ${g.niveau}`,
    'aria-label': t('puceAria', { n: i + 1, niveau: t(`niveau_${g.niveau}`) }),
  }, String(i + 1)));
  const boitesNiveaux = ['corriger', 'ameliorer', 'ok'].map((niveau) => {
    const ici = boutons.filter((b, i) => explorables[i].niveau === niveau);
    return element('section', { class: `boite-niveau ${niveau}`, 'aria-label': t(`niveau_${niveau}`) },
      element('p', { class: 'boite-titre' },
        element('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES[niveau]), ' ',
        element('b', {}, t(`niveau_${niveau}`)), ' ',
        element('span', { class: 'discret' }, t('nEndroits', { n: ici.length }))),
      element('p', { class: 'boite-legende discret' }, t(`legende_${niveau}`)),
      element('div', { class: 'boite-puces' }, ...(ici.length ? ici : [element('span', { class: 'discret' }, t('aucunEndroit'))])));
  });
  const itemVerifier = (l) => {
    const texteAria = l.texte || t('texteNonLu');
    const oui = element('button', { type: 'button', class: 'oui', 'aria-label': t('estTexteAria', { texte: texteAria }) }, t('estTexte'));
    const non = element('button', { type: 'button', class: 'non', 'aria-label': t('pasTexteAria', { texte: texteAria }) }, t('pasTexte'));
    oui.addEventListener('click', () => changerStatut(l.id, 'confirme'));
    non.addEventListener('click', () => changerStatut(l.id, 'retire'));
    // Une suggestion n'a ni lecture ni mesure fiable : une grande vignette et la question.
    const suggestion = l.origine === 'suggestion';
    const item = suggestion
      ? element('li', { class: 'a-verifier-item suggestion' },
        element('img', { src: extrait(canevas, l.bbox, 400, 160), alt: '' }),
        element('span', { class: 'texte-lu' }, libelle(l)),
        element('span', { class: 'a-verifier-question' }, t('estCeTexte')),
        element('span', { class: 'a-verifier-actions' }, oui, non))
      : element('li', { class: 'a-verifier-item' },
        element('img', { src: extrait(canevas, l.bbox, 200, 80), alt: '' }),
        element('span', { class: 'texte-lu' }, libelle(l), ' ', element('span', { class: 'discret' }, `${texteTaille(l)} · ${texteContraste(l)}`)),
        element('span', { class: 'a-verifier-actions' }, oui, non));
    const activer = (actif) => { item.classList.toggle('actif', actif); surligner(l.id, actif); };
    item.addEventListener('mouseenter', () => activer(true));
    item.addEventListener('mouseleave', () => activer(false));
    item.addEventListener('focusin', () => activer(true));
    item.addEventListener('focusout', () => activer(false));
    return item;
  };
  // Répondre pour tous d'un coup, à partir de deux : un seul rendu à la fin. Le bloc cède
  // la place à « Annuler » tant qu'aucun autre changement n'a eu lieu.
  const trancher = (statut) => {
    const changes = trancherAVerifier(etat.lecture.lignes, statut);
    for (const l of changes) if (statut === 'confirme' && !l.texte) libeller(l);
    etat.annulable = { lecture: etat.lecture, ids: changes.map((l) => l.id) };
    rendreAnalyse();
  };
  const annulable = etat.annulable?.lecture === etat.lecture ? etat.annulable : null;
  let trancherTout = null;
  if (annulable) {
    trancherTout = element('div', { class: 'trancher-tout' }, element('button', { type: 'button', class: 'annuler' }, t('annuler')));
    trancherTout.querySelector('button').addEventListener('click', () => {
      retablir(etat.lecture.lignes, annulable.ids);
      etat.annulable = null;
      rendreAnalyse();
    });
  } else if (aVerifier.length >= 2) {
    trancherTout = element('div', { class: 'trancher-tout' },
      element('span', { class: 'discret' }, t('trancherTout')),
      element('button', { type: 'button', class: 'non' }, t('aucunEstTexte', { n: aVerifier.length })),
      element('button', { type: 'button', class: 'oui' }, t('tousSontTextes', { n: aVerifier.length })));
    trancherTout.querySelector('.oui').addEventListener('click', () => trancher('confirme'));
    trancherTout.querySelector('.non').addEventListener('click', () => trancher('retire'));
  }
  // Au-delà de six, la liste montre les six premiers et un bouton déplie le reste.
  const deplie = etat.depliee === etat.lecture;
  const montres = deplie ? aVerifier : aVerifier.slice(0, VERIFIER_MAX);
  const autres = aVerifier.length - montres.length;
  const boutonAutres = autres > 0 ? element('button', { type: 'button', class: 'autres-verifier' }, t('afficherAutres', { n: autres })) : null;
  if (boutonAutres) boutonAutres.addEventListener('click', () => { etat.depliee = etat.lecture; rendreAnalyse(); });
  const boiteVerifier = element('section', { class: 'boite-niveau a-verifier', 'aria-label': t('statut_a-verifier') },
    element('p', { class: 'boite-titre' },
      element('span', { class: 'symbole', 'aria-hidden': 'true' }, '?'), ' ',
      element('b', {}, t('statut_a-verifier')), ' ',
      element('span', { class: 'discret' }, t('nTextes', { n: aVerifier.length }))),
    element('p', { class: 'boite-legende discret' }, t('legende_verifier')),
    element('div', { class: 'a-verifier-corps' },
      trancherTout,
      aVerifier.length
        ? element('div', {}, element('ul', { class: 'a-verifier-liste' }, ...montres.map(itemVerifier)), boutonAutres)
        : element('div', { class: 'boite-puces' }, element('span', { class: 'discret' }, t('aVerifierVide')))));
  // Une boîte à zéro n'apporte rien : seules celles qui ont un contenu s'affichent, et
  // « À vérifier » reste tant qu'on peut annuler une réponse groupée. Sans aucun texte, un
  // seul message du bilan remplace les boîtes.
  const sansTexte = !lignes.length && !aVerifier.length && !annulable;
  const rangee = element('div', { class: 'boites-niveaux' },
    ...boitesNiveaux.filter((b, i) => explorables.some((g) => g.niveau === ['corriger', 'ameliorer', 'ok'][i])),
    ...(aVerifier.length || annulable ? [boiteVerifier] : []));
  puces.replaceChildren(...(sansTexte ? [] : [rangee]));

  const cartes = new Map();
  const carteDe = (i) => {
    if (!cartes.has(i)) cartes.set(i, carteZone(explorables[i], i + 1, canevas));
    return cartes.get(i);
  };
  const choix = { epingle: explorables.length ? 0 : null };
  let hauteurPanneau = 0;
  $('panneau').style.minHeight = '';
  const montrer = (i) => {
    svg.classList.toggle('focus', i != null);
    calques.forEach((c, k) => c.classList.toggle('choisi', k === i));
    boutons.forEach((b, k) => {
      const actif = k === choix.epingle;
      b.setAttribute('aria-pressed', String(actif));
      b.tabIndex = actif ? 0 : -1;
      b.classList.toggle('apercu', k === i && !actif);
    });
    if (i == null) {
      voile.setAttribute('d', '');
      $('panneau').replaceChildren(element('p', { class: 'discret' }, t(explorables.length ? 'panneauAide' : 'panneauVide')));
      return;
    }
    const trous = explorables[i].membres.map((l) => { const b = boite(l); return `M${b.x} ${b.y}h${b.w}v${b.h}h${-b.w}Z`; }).join('');
    voile.setAttribute('d', `M0 0H${W}V${H}H0Z${trous}`);
    const apercu = i !== choix.epingle;
    const etatPanneau = element('p', { class: `panneau-etat${apercu ? ' apercu' : ''}` },
      apercu ? t('panneauApercu', { n: i + 1, actif: choix.epingle + 1 }) : t('panneauActif', { n: i + 1, total: explorables.length }));
    $('panneau').classList.toggle('apercu', apercu);
    $('panneau').replaceChildren(etatPanneau, carteDe(i));
    // Le panneau ne rapetisse jamais pendant qu'on passe d'un numéro à l'autre : en bas de
    // page, un panneau plus court ferait remonter la page, le numéro sortirait de sous la
    // souris et l'affichage clignoterait.
    hauteurPanneau = Math.max(hauteurPanneau, $('panneau').offsetHeight);
    $('panneau').style.minHeight = `${hauteurPanneau}px`;
  };
  const survoler = (i) => montrer(i);
  const epingler = (i) => { choix.epingle = i; montrer(i); };
  rangee.addEventListener('mouseleave', () => montrer(choix.epingle));
  boutons.forEach((b, i) => {
    b.addEventListener('mouseenter', () => survoler(i));
    b.addEventListener('focus', () => epingler(i));
    b.addEventListener('click', () => epingler(i));
    b.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      boutons[(i + d + boutons.length) % boutons.length].focus();
    });
  });
  montrer(choix.epingle);
  cadre.replaceChildren(element('img', { src: etat.source.url, alt: '' }), svg, rendreResidu(actives, W, H));
  cadre.classList.toggle('residu', etat.masquer);
  $('residu-commandes').hidden = false;
  $('zone-clavier').hidden = !etat.masquer;

  // Bilan
  const global = verdictGlobal(lignes);
  const provisoire = verdictProvisoire(global, aVerifier.length);
  const tailles = lignes.map((l) => l.pt).filter((v) => v != null);
  const nCorriger = lignes.filter((l) => l.niveau === 'corriger').length;
  const nAmeliorer = lignes.filter((l) => l.niveau === 'ameliorer').length;
  const bilan = $('bilan');
  $('panneau').hidden = !explorables.length;
  bilan.className = `bilan ${provisoire ? 'provisoire' : lignes.length ? global : 'inconnu'}`;
  if (sansTexte) {
    bilan.className = 'bilan inconnu';
    bilan.replaceChildren(element('p', {}, t('aucunTexteDetecte')));
  } else bilan.replaceChildren(
    element('p', { class: 'bilan-titre' },
      ...(provisoire ? [element('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES.provisoire), ' ', t('bilan_provisoire', { n: aVerifier.length })]
        : lignes.length ? [element('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES[global]), ' ', t(`bilan_${global}`), global !== 'ok' && aVerifier.length ? ` ${t('bilan_etAVerifier', { n: aVerifier.length })}` : '']
          : [t('aucunTexte')])),
    ...(groupes.length ? [element('p', { class: 'bilan-endroits' }, phraseEndroits(groupes, affiches[0], diag))] : []),
    element('p', { class: 'discret' }, [
      lignes.length ? t('textesLus', { n: lignes.length }) : null,
      nCorriger ? t('compte_corriger', { n: nCorriger }) + '.' : null,
      nAmeliorer ? t('compte_ameliorer', { n: nAmeliorer }) + '.' : null,
      ajoutes.length ? t('compte_ajoute', { n: ajoutes.length }) + '.' : null,
      tailles.length ? t('plusPetitTexte', { pt: nombre(Math.min(...tailles)), min: TAILLE_MIN_PT }) : null,
    ].filter(Boolean).join(' ')),
    ...(etat.source.type === 'bitmap' ? [element('p', { class: 'discret' }, t('lectureApprochee'))] : []));
  bilan.hidden = false;
  $('niveaux').hidden = !lignes.length;

  // Diagnostic d'ensemble et endroits à revoir
  $('ensemble').replaceChildren(...(diag ? [carteEnsemble(diag)] : []));
  $('zones-titre').hidden = !groupes.length;
  $('zones-titre').textContent = t(diag ? 'contrastesTitre' : souple ? 'stylesTitre' : 'zonesTitre', { n: groupes.length });
  $('zones').replaceChildren(...affiches.map((g, i) => carteZone(g, i + 1, canevas)));
  $('zones-reste').textContent = groupes.length > affiches.length ? t('autresGroupes', { n: groupes.length - affiches.length }) : '';

  // À l'impression : les textes ajoutés et ceux à vérifier, avec leur statut.
  const statuts = [...ajoutes, ...aVerifier];
  $('statuts-titre').hidden = !statuts.length;
  $('statuts-titre').textContent = t('statutsTitre', { n: statuts.length });
  $('statuts-impression').replaceChildren(...statuts.map((l) => element('li', {},
    element('img', { src: extrait(canevas, l.bbox, 200, 80), alt: '' }),
    element('span', {}, etiquetteStatut(l.statut), ' ', libelle(l)),
    element('span', { class: 'discret' }, `${texteTaille(l)} · ${texteContraste(l)} · ${t(`origine_${l.origine}`)}`))));

  // Tous les textes visibles, avec leur statut ; « Ce n'est pas un texte » y est accessible
  // au clavier pour chacun.
  tbody.replaceChildren(...actives.map((l) => {
    const cellule = (valeur, niveau) => element('td', { class: niveau || 'inconnu' }, valeur,
      niveau && niveau !== 'ok' ? element('span', { class: 'etiquette' }, t(`niveau_${niveau}`)) : null);
    const retirer = element('button', { type: 'button', class: 'lien', 'aria-label': t('pasTexteAria', { texte: l.texte || t('texteNonLu') }) }, t('pasTexte'));
    retirer.addEventListener('click', () => changerStatut(l.id, 'retire'));
    const tr = element('tr', {},
      element('td', { class: 'texte-lu' }, libelle(l), l.vertical ? element('span', { class: 'etiquette discret' }, t('vertical')) : null),
      cellule(texteTaille(l), l.nt),
      cellule(texteContraste(l), l.nc),
      element('td', {}, l.contraste ? nuancier(l.contraste.texte, l.contraste.fond) : null),
      element('td', { title: t(`origine_${l.origine}`) }, etiquetteStatut(l.statut), element('span', { class: 'etiquette' }, retirer)));
    const activer = (oui) => {
      tr.classList.toggle('actif', oui);
      if (groupeDe.has(l.id)) montrer(oui ? groupeDe.get(l.id) : choix.epingle);
      surligner(l.id, oui);
    };
    tr.addEventListener('mouseenter', () => activer(true));
    tr.addEventListener('mouseleave', () => activer(false));
    return tr;
  }));
  $('details-textes').hidden = !actives.length;
  $('details-titre').textContent = t('tousTextes', { n: actives.length });
  $('imprimer-rapport').hidden = !actives.length;
  $('exporter-lecture').hidden = false;
  rendreProjection();
  rendreLecture();

  const exact = lignes.length && lignes.every((l) => l.exact);
  $('note-mesure').textContent = `${t('seuils', { min: TAILLE_MIN_PT, lc: etat.seuil, corps: nombre(f.corpsPt) })} ${lignes.length ? t(exact ? 'noteExacte' : 'noteEstimation') : ''}`;
}

const ns = 'http://www.w3.org/2000/svg';
function svgEl(nom, attributs = {}) {
  const el = document.createElementNS(ns, nom);
  for (const [k, v] of Object.entries(attributs)) el.setAttribute(k, v);
  return el;
}

// ── Vue résidu ──────────────────────────────────────────────────────────────────

// Un masque hachuré par texte visible. Clic sur un masque : la petite fenêtre qui permet de
// dire que ce n'est pas un texte (ou que c'en est bien un). Rectangle glissé ailleurs : un
// texte ajouté, mesuré sans être lu. Un cadre au clavier remplace la souris.
function rendreResidu(actives, W, H) {
  const svg = svgEl('svg', { class: 'residu', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', tabindex: '-1', 'aria-label': t('masquerTextes') });
  const pas = Math.max(8, W / 90);
  const motif = svgEl('pattern', { id: 'hachures', patternUnits: 'userSpaceOnUse', width: pas, height: pas, patternTransform: 'rotate(45)' });
  motif.append(svgEl('rect', { width: pas, height: pas, fill: '#fff' }), svgEl('line', { x1: 0, y1: 0, x2: 0, y2: pas, stroke: '#9a9a92', 'stroke-width': pas / 4 }));
  const defs = svgEl('defs');
  defs.append(motif);
  svg.append(defs);
  const m = 4;
  for (const l of actives) {
    const r = svgEl('rect', {
      x: l.bbox.x0 - m, y: l.bbox.y0 - m, width: l.bbox.x1 - l.bbox.x0 + 2 * m, height: l.bbox.y1 - l.bbox.y0 + 2 * m,
      class: `masque ${l.statut}`, tabindex: '-1',
    });
    r.addEventListener('click', (e) => { e.stopPropagation(); ouvrirFenetreMasque(l, r); });
    svg.append(r);
  }

  // Glisser un rectangle sur une zone non masquée.
  const point = (e) => {
    const r = svg.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H };
  };
  let depart = null, trace = null;
  svg.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target !== svg) return;
    fermerFenetreMasque();
    depart = point(e);
    trace = svgEl('rect', { class: 'trace', x: depart.x, y: depart.y, width: 0, height: 0 });
    svg.append(trace);
    try { svg.setPointerCapture(e.pointerId); } catch { /* pointeur simulé : pas de capture */ }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!depart) return;
    const b = boiteNormalisee(depart, point(e), W, H);
    trace.setAttribute('x', b.x0); trace.setAttribute('y', b.y0);
    trace.setAttribute('width', b.x1 - b.x0); trace.setAttribute('height', b.y1 - b.y0);
  });
  const finir = (e) => {
    if (!depart) return;
    const b = boiteNormalisee(depart, point(e), W, H);
    depart = null;
    trace.remove();
    if (b.x1 - b.x0 >= 4 && b.y1 - b.y0 >= 4) ajouterZone(b);
  };
  svg.addEventListener('pointerup', finir);
  svg.addEventListener('pointercancel', () => { depart = null; trace?.remove(); });

  // Cadre au clavier : flèches pour déplacer, Maj + flèches pour redimensionner, Entrée
  // pour ajouter, Échap pour annuler.
  svg.addEventListener('keydown', (e) => {
    const cadre = svg.querySelector('.cadre-clavier');
    if (!cadre) return;
    const d = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowUp: [0, -1] }[e.key];
    const lire = (a) => parseFloat(cadre.getAttribute(a));
    if (d) {
      e.preventDefault();
      const pasX = W / 100, pasY = H / 100;
      if (e.shiftKey) {
        cadre.setAttribute('width', Math.max(pasX, lire('width') + d[0] * pasX));
        cadre.setAttribute('height', Math.max(pasY, lire('height') + d[1] * pasY));
      } else {
        cadre.setAttribute('x', Math.min(W - lire('width'), Math.max(0, lire('x') + d[0] * pasX)));
        cadre.setAttribute('y', Math.min(H - lire('height'), Math.max(0, lire('y') + d[1] * pasY)));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const b = { x0: lire('x'), y0: lire('y'), x1: lire('x') + lire('width'), y1: lire('y') + lire('height') };
      cadre.remove();
      ajouterZone(b);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cadre.remove();
      aide('residuAide');
    }
  });
  return svg;
}

// Première phrase visible ; le reste, s'il y en a un, dans un « En savoir plus ».
function aide(cle, valeurs) {
  const zone = $('residu-aide');
  const texte = cle ? t(cle, valeurs) : '';
  const coupe = /^(.+?[.!?])\s+(\S.*)$/s.exec(texte);
  if (!coupe) { zone.textContent = texte; return; }
  zone.replaceChildren(
    element('p', {}, coupe[1]),
    element('details', {}, element('summary', {}, t('enSavoirPlus')), element('p', {}, coupe[2])));
}

function cadreClavier() {
  const svg = $('analyse-figure').querySelector('svg.residu');
  if (!svg) return;
  const [, , W, H] = svg.getAttribute('viewBox').split(' ').map(Number);
  svg.querySelector('.cadre-clavier')?.remove();
  svg.append(svgEl('rect', { class: 'cadre-clavier', x: W * 0.4375, y: H * 0.46875, width: W / 8, height: H / 16 }));
  aide('clavierAide');
  svg.focus();
}

function fermerFenetreMasque() {
  $('analyse-figure').querySelector('.fenetre-masque')?.remove();
}

function ouvrirFenetreMasque(l, rect) {
  fermerFenetreMasque();
  const cadre = $('analyse-figure');
  const [, , W, H] = rect.ownerSVGElement.getAttribute('viewBox').split(' ').map(Number);
  const mesure = mesures().find((x) => x.id === l.id) || l;
  const fermer = element('button', { type: 'button' }, t('fermer'));
  const non = element('button', { type: 'button', class: 'non' }, t('pasTexte'));
  const oui = l.statut === 'a-verifier' ? element('button', { type: 'button', class: 'oui' }, t('estTexte')) : null;
  const fenetre = element('div', {
    class: 'fenetre-masque', role: 'dialog', 'aria-label': t('fenetreMasque'),
    style: { left: `${Math.min(70, l.bbox.x0 / W * 100)}%`, top: `${Math.min(92, l.bbox.y1 / H * 100 + 1)}%` },
  },
  element('p', {}, etiquetteStatut(l.statut), ' ', element('b', {}, libelle(l))),
  element('p', { class: 'discret' }, `${texteTaille(mesure)} · ${texteContraste(mesure)} · ${t(`origine_${l.origine}`)}`),
  element('div', { class: 'actions' }, oui, non, fermer));
  const quitter = () => { fenetre.remove(); rect.focus(); };
  fermer.addEventListener('click', quitter);
  non.addEventListener('click', () => changerStatut(l.id, 'retire'));
  oui?.addEventListener('click', () => changerStatut(l.id, 'confirme'));
  fenetre.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); quitter(); } });
  cadre.append(fenetre);
  (oui || non).focus();
}

// Identifiant d'un texte ajouté : le suivant du plus grand.
function prochainId(lignes) {
  return `t${lignes.reduce((max, l) => Math.max(max, Number(String(l.id).slice(1)) || 0), 0) + 1}`;
}

function changerStatut(id, statut) {
  const ligne = etat.lecture?.lignes.find((l) => l.id === id);
  if (!ligne) return;
  ligne.statut = statut;
  etat.annulable = null;
  if (statut === 'confirme' && !ligne.texte) libeller(ligne);
  rendreAnalyse();
}

// Un rectangle posé par l'humain devient un texte ajouté, mesuré sans être lu ; l'OCR tente
// ensuite de lui donner un libellé.
function ajouterZone(bbox) {
  const { canevas, lignes } = etat.lecture;
  if (recouvreUnTexte(bbox, lignes)) { aide('zoneDeja'); return; }
  etat.annulable = null;
  const mesure = mesurerAjout(canevas, bbox);
  if (!mesure) { aide('zoneVide'); return; }
  const ligne = { ...mesure, id: prochainId(lignes), origine: 'humain', statut: 'ajoute' };
  lignes.push(ligne);
  rendreAnalyse();
  const l = mesures().find((x) => x.id === ligne.id);
  aide('zoneAjoutee', { taille: texteTaille(l), contraste: texteContraste(l) });
  libeller(ligne);
}

async function libeller(ligne) {
  const lecture = etat.lecture;
  try {
    const texte = await lireZone(lecture.canevas, ligne.bbox, ligne.vertical);
    if (texte && lecture === etat.lecture && ligne.statut !== 'retire') {
      ligne.texte = texte;
      rendreAnalyse();
    }
  } catch (e) {
    console.error(e);
  }
}

// ── Export ──────────────────────────────────────────────────────────────────────

// La lecture complète, en pixels de l'image d'origine : window.szhFigureCheck.exporter().
function exporter() {
  if (!etat.source || !etat.lecture) return null;
  const s = etat.source;
  const fig = figureSurPage();
  const toutes = mesures();
  const lignes = toutes.filter((l) => compte(l.statut));
  const donnees = exporterLecture({
    figure: { nom: s.nom, type: s.type, largeurPx: s.espace.l, hauteurPx: s.espace.h },
    reglages: { format: etat.format, proportion: etat.proportion, seuilLc: etat.seuil, largeurMm: fig.l, hauteurMm: fig.h, pxParMm: s.espace.l / fig.l },
    verdict: verdictGlobal(lignes),
    aVerifier: toutes.filter((l) => l.statut === 'a-verifier').length,
    lignes: toutes,
    echelle: s.espace.l / etat.lecture.canevas.width,
    diagnosticEnsemble: diagnosticEnsemble(lignes),
  });
  // Objets et séries du graphique (objets.js), dans le même espace de pixels.
  const objets = exporterObjets();
  return { ...donnees, objets: objets ? objets.objets : [], series: objets ? objets.series : [] };
}

function telechargerExport() {
  const donnees = exporter();
  if (!donnees) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(donnees, null, 2)], { type: 'application/json' }));
  const a = element('a', { href: url, download: `${etat.source.nom.replace(/\.[^.]+$/, '')}.lecture.json` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function imprimerRapport() {
  document.body.dataset.impression = 'rapport';
  $('style-impression').textContent = '@page { size: A4; margin: 15mm; }';
  $('details-textes').open = true;
  window.print();
}

window.addEventListener('afterprint', () => {
  if (document.body.dataset.impression !== 'rapport') return;
  delete document.body.dataset.impression;
  if (etat.source) rendrePage();
});

// ── Couleurs ────────────────────────────────────────────────────────────────────

// Daltonismes : filtres SVG appliqués à l'image d'origine. Basse vision : images calculées
// sur un canevas, à l'échelle de la figure imprimée (le flou dépend de sa largeur).
const VUES_DALTONISME = [
  ['vueOriginale', ''], ['vueDeuteranopie', 'f-deuteranopie'], ['vueProtanopie', 'f-protanopie'],
  ['vueTritanopie', 'f-tritanopie'], ['vueGris', 'f-gris'],
];
const VUES_BASSE_VISION = [['vueAcuite5', 'acuite5'], ['vueAcuite3', 'acuite3'], ['vueContraste', 'contraste'], ['vueCataracte', 'cataracte']];
const LARGEUR_SIMULATION = 1600;
const LARGEUR_SIMULATION_CONTRASTE = 900;
// Basse vision : affichée ; ?basseVision=0 la remplace par « à venir ».
const BASSE_VISION = params.get('basseVision') !== '0';
let simulations = { cle: null, urls: {} };
let vuesVision = [];

async function calculerBasseVision() {
  const s = etat.source;
  const largeurMm = figureSurPage().l;
  const cle = `${s.url}|${largeurMm.toFixed(1)}`;
  if (simulations.cle === cle) return true;
  Object.values(simulations.urls).forEach((u) => URL.revokeObjectURL(u));
  simulations = { cle, urls: {} };
  const base = await s.dessiner(LARGEUR_SIMULATION);
  // Les simulations de contraste (Peli) se calculent sur une image plus petite : elles
  // traitent chaque pixel bande par bande.
  const petite = await s.dessiner(LARGEUR_SIMULATION_CONTRASTE);
  const petitesDonnees = petite.getContext('2d').getImageData(0, 0, petite.width, petite.height);
  const pxParDegre = (petite.width / largeurMm) * MM_PAR_DEGRE;
  for (const [, vue] of VUES_BASSE_VISION) {
    let c;
    if (vue === 'acuite5' || vue === 'acuite3') {
      c = document.createElement('canvas');
      c.width = base.width;
      c.height = base.height;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.filter = filtreFlou(vue === 'acuite5' ? 0.5 : 0.3, base.width, largeurMm);
      ctx.drawImage(base, 0, 0);
    } else {
      await new Promise((ok) => setTimeout(ok));   // laisse la page se redessiner
      const options = vue === 'cataracte' ? { jaunissement: 0.35, voile: 0.08 } : {};
      const pixels = simulerPerteContraste(petitesDonnees.data, petite.width, petite.height, pxParDegre, PROFILS[vue], options);
      c = document.createElement('canvas');
      c.width = petite.width;
      c.height = petite.height;
      c.getContext('2d').putImageData(new ImageData(pixels, petite.width, petite.height), 0, 0);
    }
    const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
    if (simulations.cle !== cle) return false;
    simulations.urls[vue] = URL.createObjectURL(blob);
  }
  return simulations.cle === cle;
}

// vues : éléments de vuesVision ; chaque vignette ouvre la fenêtre agrandie sur sa vue.
function vignettes(vues) {
  return vues.map((v) => {
    const bouton = element('button', { type: 'button', class: 'vignette', 'aria-label': t('agrandirVue', { vue: t(v.cle) }) },
      element('img', { src: v.src, alt: '', class: v.classe }),
      element('span', { class: 'vignette-titre' }, t(v.cle)));
    bouton.addEventListener('click', () => ouvrirVue(vuesVision.indexOf(v)));
    return element('li', {}, bouton);
  });
}

// Vignettes ; un clic ouvre la vue en grand, où l'on passe d'une simulation à l'autre
// par les boutons ou les flèches du clavier.
// Seuil et confort de lecture pour deux acuités, comparés aux textes de la figure.
function rendreLecture() {
  const tableau = $('lecture-acuite');
  if (!BASSE_VISION || !etat.lecture) { tableau.replaceChildren(); return; }
  const tailles = mesures().filter((l) => compte(l.statut)).map((l) => l.pt).filter((v) => v != null);
  const lignes = [[0.5, 'vueAcuite5'], [0.3, 'vueAcuite3']].map(([acuite, cle]) => {
    const { seuil, confort } = lectureAcuite(acuite);
    const sousSeuil = tailles.filter((v) => v < seuil).length;
    const sousConfort = tailles.filter((v) => v < confort).length;
    return element('tr', {},
      element('th', { scope: 'row' }, t(cle)),
      element('td', {}, `${nombre(seuil)}\u00a0pt`),
      element('td', {}, `${nombre(confort)}\u00a0pt`),
      element('td', { class: sousSeuil ? 'corriger' : 'ok' }, t('lectureIllisibles', { n: sousSeuil, total: tailles.length })),
      element('td', { class: sousConfort ? 'ameliorer' : 'ok' }, t('lecturePenibles', { n: sousConfort, total: tailles.length })));
  });
  tableau.replaceChildren(
    element('caption', {}, t('lectureTitre')),
    element('thead', {}, element('tr', {}, ...['lectureColAcuite', 'lectureColSeuil', 'lectureColConfort', 'lectureColIllisibles', 'lectureColPenibles'].map((k) => element('th', { scope: 'col' }, t(k))))),
    element('tbody', {}, ...lignes));
}

async function rendreCouleurs() {
  if (!etat.source) return;
  // Fenêtre agrandie : l'original, puis la basse vision, puis les daltonismes.
  const daltonisme = VUES_DALTONISME.map(([cle, classe]) => ({ cle, classe, src: etat.source.url }));
  const [originale, ...autres] = daltonisme;
  vuesVision = daltonisme;
  $('couleurs').replaceChildren(...vignettes(daltonisme));
  if (!BASSE_VISION) {
    $('basse-vision').replaceChildren(element('li', { class: 'a-venir' }, t('basseVisionAVenir')));
    return;
  }
  rendreLecture();
  $('basse-vision').replaceChildren(element('li', { class: 'discret' }, t('preparation')));
  const source = etat.source;
  if (!(await calculerBasseVision()) || source !== etat.source) return;
  const basse = VUES_BASSE_VISION.map(([cle, vue]) => ({ cle, classe: '', src: simulations.urls[vue] }));
  vuesVision = [originale, ...basse, ...autres];
  $('basse-vision').replaceChildren(...vignettes(basse));
}

// Taille réelle : la figure à sa largeur imprimée, à regarder à environ 40 cm de l'écran,
// condition pour que le flou et les seuils des simulations aient un sens.
function appliquerTailleVue() {
  const image = $('vue-grande');
  const reelle = etat.tailleVue === 'reelle';
  image.style.width = reelle ? `${figureSurPage().l * (etat.pxParMm || PX_PAR_MM_NOMINAL)}px` : '';
  image.classList.toggle('taille-reelle', reelle);
  for (const r of document.querySelectorAll('input[name="taille-vue"]')) r.checked = r.value === etat.tailleVue;
  $('vue-consigne').textContent = reelle ? `${t('vueConsigne')} ${etat.pxParMm ? '' : t('calibrationNon')}` : '';
}

function ouvrirVue(depart) {
  const d = $('dialogue-couleurs');
  const image = $('vue-grande');
  const vues = vuesVision;
  const boutons = vues.map((v, i) => {
    const b = element('button', { type: 'button', role: 'tab', 'aria-controls': 'vue-grande' }, t(v.cle));
    b.addEventListener('click', () => choisir(i));
    return b;
  });
  const choisir = (i) => {
    image.src = vues[i].src;
    image.className = vues[i].classe;
    appliquerTailleVue();
    boutons.forEach((b, k) => { b.setAttribute('aria-selected', String(k === i)); b.tabIndex = k === i ? 0 : -1; });
    d.dataset.vue = i;
  };
  $('vues-onglets').replaceChildren(...boutons);
  d.onkeydown = (e) => {
    const sens = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!sens) return;
    e.preventDefault();
    const i = (Number(d.dataset.vue) + sens + vues.length) % vues.length;
    choisir(i);
    boutons[i].focus();
  };
  choisir(depart);
  d.showModal();
  boutons[depart].focus();
}

// ── Chargement d'une figure ─────────────────────────────────────────────────────

function montrerErreur(cle, e) {
  if (e) console.error(e);
  $('erreur').textContent = t(cle);
  $('erreur').hidden = false;
}

async function charger(fichier) {
  $('erreur').hidden = true;
  delete document.body.dataset.etat;
  let source;
  try {
    source = await ouvrir(fichier);
  } catch (e) {
    montrerErreur('erreurFichier', e);
    return;
  }
  if (etat.source) URL.revokeObjectURL(etat.source.url);
  etat.source = source;
  $('choix-figure').hidden = true;
  $('figure-choisie').hidden = false;
  $('figure-miniature').src = source.url;
  $('figure-nom').textContent = source.nom;
  $('figure-taille').textContent = source.pixels ? t('figureTaille', { l: source.pixels.l, h: source.pixels.h }) : '';
  activerEtapes(true);
  rendrePage();
  rendreCouleurs();
  analyser();
  const demandee = Number(params.get('etape'));
  ouvrirEtape(demandee >= 2 && demandee <= 4 ? demandee : 2);
}

// Les étapes 2 à 4 n'existent qu'avec une figure ; sans elle leur bouton est grisé, et
// l'infobulle « Choisissez d'abord une figure » le décrit.
function activerEtapes(avecFigure) {
  for (const b of document.querySelectorAll('.etape-bouton')) {
    const n = b.dataset.etape;
    const grise = n !== '1' && !avecFigure;
    if (grise) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled');
    b.setAttribute('aria-describedby', grise ? 'resume-' + n + ' etape-' + n + '-aide' : 'resume-' + n);
  }
}

// Retour à l'étape 1 : la figure est oubliée, les réglages sont gardés.
function autreFigure() {
  etat.jeton++;
  if (etat.source) URL.revokeObjectURL(etat.source.url);
  etat.source = null;
  etat.lecture = null;
  etat.endroits = null;
  activerEtapes(false);
  etat.masquer = false;
  $('masquer').checked = false;
  $('fichier').value = '';
  $('choix-figure').hidden = false;
  $('figure-choisie').hidden = true;
  $('erreur').hidden = true;
  statut(null);
  rendreResumes();
  ouvrirEtape(1);
  $('depot').focus();
}

// Charge une figure servie à côté de la page : un exemple, ou `?figure=chemin` en
// développement (fichiers du dossier tmp/, non suivi).
async function chargerUrl(chemin) {
  const blob = await (await fetch(chemin)).blob();
  await charger(new File([blob], chemin.split('/').pop(), { type: blob.type }));
}

// Une image collée n'a pas de nom utile : on lui en donne un, daté.
function renommerCollage(fichier) {
  const extension = (fichier.type.split('/')[1] || 'png').replace('svg+xml', 'svg').replace('jpeg', 'jpg');
  const heure = new Date().toTimeString().slice(0, 5).replace(':', 'h');
  return new File([fichier], `${t('nomCollage')}-${heure}.${extension}`, { type: fichier.type });
}

function chargerExemple(type) {
  return chargerUrl(EXEMPLES[type] || EXEMPLES.png);
}

// ── Calibration ─────────────────────────────────────────────────────────────────

function montrerCarte() {
  $('carte').style.width = `${$('carte-curseur').value * CARTE_MM}px`;
}

function preparerCalibration() {
  $('carte-curseur').value = etat.pxParMm || PX_PAR_MM_NOMINAL;
  montrerCarte();
}

function validerCalibration() {
  const v = parseFloat($('carte-curseur').value);
  etat.pxParMm = Math.abs(v - PX_PAR_MM_NOMINAL) < 0.005 ? null : v;
  ecrireCalibration(etat.pxParMm);
  if (etat.source) { rendrePage(); rendreProjection(); }
  ouvrirEtape(4, true);
}

// ── Étapes et vues ──────────────────────────────────────────────────────────────

const RESUMES = {
  1: () => (etat.source ? etat.source.nom : ''),
  2: () => (etat.source ? `${t(etat.format === 'revue' ? 'formatRevue' : 'formatLivre')} · Lc\u00a0${etat.seuil}` : ''),
  3: () => (etat.source ? t(etat.pxParMm ? 'resumeEcranOui' : 'resumeEcranNon') : ''),
  4: () => {
    if (!etat.source) return '';
    if (etat.endroits == null) return t('resumeAnalyseEnCours');
    if (etat.aVerifier && !etat.endroits) return t('resumeProvisoire', { n: etat.aVerifier });
    if (etat.aVerifier) return t('resumeEtAVerifier', { n: etat.endroits, a: etat.aVerifier });
    return etat.endroits ? t('resumeAnalyse', { n: etat.endroits }) : t('resumeAnalyseOk');
  },
};

function rendreResumes() {
  // Un texte inchangé n'est pas réécrit : le résumé de l'étape 4 est une zone vive.
  for (const n of [1, 2, 3, 4]) {
    const texte = RESUMES[n]();
    if ($(`resume-${n}`).textContent !== texte) $(`resume-${n}`).textContent = texte;
  }
}

// Une seule étape ouverte. Les étapes passées portent une coche.
// `focus` : après un geste de l'utilisateur, le focus suit sur le bouton de l'étape ouverte
// (le bouton « Continuer » disparaît avec son étape).
function ouvrirEtape(n, focus = false) {
  etat.etape = n;
  for (const k of [1, 2, 3, 4]) {
    const ouverte = k === n;
    $(`etape-${k}-corps`).hidden = !ouverte;
    const bouton = document.querySelector(`.etape-bouton[data-etape="${k}"]`);
    bouton.setAttribute('aria-expanded', String(ouverte));
    $(`etape-${k}`).classList.toggle('ouverte', ouverte);
    const faite = Boolean(etat.source) && !ouverte && k < 4;
    $(`etape-${k}`).classList.toggle('faite', faite);
    bouton.querySelector('.etape-num').textContent = faite ? '✓' : String(k);
  }
  if (n === 3) preparerCalibration();
  if (n === 4 && etat.source) montrerVue(etat.onglet);
  rendreResumes();
  const li = $(`etape-${n}`);
  if (li.getBoundingClientRect().top < 0) li.scrollIntoView({ block: 'start' });
  if (focus) document.querySelector(`.etape-bouton[data-etape="${n}"]`).focus({ preventScroll: true });
}

// Le panneau des cartes porte le titre de la vue active.
function nommerPanneau() {
  const actif = document.querySelector('.onglets-analyse [role="tab"][aria-selected="true"] b > span');
  if (actif) $('panneau').setAttribute('aria-label', actif.textContent);
}

// Une seule vue de l'analyse à la fois.
function montrerVue(id) {
  etat.onglet = id;
  for (const b of document.querySelectorAll('.onglets-analyse [role="tab"]')) {
    const actif = b.dataset.vue === id;
    b.setAttribute('aria-selected', String(actif));
    b.tabIndex = actif ? 0 : -1;
    $(b.dataset.vue).hidden = !actif;
  }
  nommerPanneau();
  if (id === 'vue-page' && etat.source) zoomer();
  if (id === 'vue-projection') rendreProjection();
}

// ── Projection ──────────────────────────────────────────────────────────────────

// La diapositive est affichée à la taille apparente qu'elle aurait au dernier rang. Le
// bilan compare la hauteur des minuscules de chaque texte, sur l'écran de la salle, au
// minimum de la norme DISCAS.
function rendreProjection() {
  $('salle-largeur').value = String(Math.round(etat.ecranCm) / 100);
  $('salle-distance').value = String(Math.round(etat.distanceCm) / 100);
  for (const r of document.querySelectorAll('input[name="salle"]')) r.checked = r.value === etat.salle;
  if (!etat.source) return;
  const apparenteCm = largeurApparenteCm(etat.ecranCm, etat.distanceCm);
  const lPx = apparenteCm * (etat.pxParMm || PX_PAR_MM_NOMINAL) * 10;
  const cadre = cadreFigure(etat.source.ratio);
  const diapo = $('diapo');
  Object.assign(diapo.style, { width: `${lPx}px`, height: `${lPx * DIAPO.hauteur}px` });
  diapo.replaceChildren(
    element('div', { class: 'diapo-titre', style: {
      fontSize: `${32 * CM_PAR_PT / DIAPO.largeurCm * lPx}px`,
      height: `${DIAPO.titre * DIAPO.hauteur * lPx}px`,
      padding: `0 ${DIAPO.marge * lPx}px`,
    } }, t('diapoTitre')),
    element('img', { src: etat.source.url, alt: '', style: { width: `${cadre.l * lPx}px`, height: `${cadre.h * lPx}px` } }),
    element('div', { class: 'diapo-voile', style: { opacity: String(SALLES[etat.salle].voile) } }),
  );
  $('projection-consigne').textContent = `${t('projectionConsigne', {
    l: nombre(etat.ecranCm / 100, 2).replace(/,?0+$/, ''), d: nombre(etat.distanceCm / 100).replace(/,0$/, ''),
  })} ${etat.pxParMm ? '' : t('calibrationNon')}`;

  const bilan = $('projection-bilan');
  if (!etat.lecture) {
    bilan.className = 'bilan';
    bilan.replaceChildren(element('p', {}, t('projectionAttente')));
    return;
  }
  const { canevas } = etat.lecture;
  const lignes = etat.lecture.lignes.filter((l) => compte(l.statut));
  const figureCm = cadre.l * etat.ecranCm;
  // Hauteur d'x estimée depuis le corps, aussi pour les textes en capitales.
  const hauteurs = lignes.filter((l) => l.corpsPx).map((l) => l.corpsPx / canevas.width * figureCm * RATIO_X);
  if (!hauteurs.length) {
    bilan.className = 'bilan';
    bilan.replaceChildren(element('p', {}, t('aucunTexte')));
    return;
  }
  const minimum = minusculeMinCm(etat.distanceCm);
  const arrondi = (v) => Math.round(v * 10) / 10;
  const petits = hauteurs.filter((h) => arrondi(h) < arrondi(minimum)).length;
  const plusPetite = Math.min(...hauteurs);
  const valeurs = { d: nombre(etat.distanceCm / 100).replace(/,0$/, ''), min: nombre(minimum), x: nombre(plusPetite), n: petits, total: hauteurs.length,
    p: Math.ceil((minimum / plusPetite - 1) * 20) * 5 };
  bilan.className = `bilan ${petits ? 'corriger' : 'ok'}`;
  bilan.replaceChildren(element('p', {}, t(petits ? 'projectionPetit' : 'projectionOk', valeurs)));
}

function synchroniserReglages() {
  for (const r of document.querySelectorAll('input[name="format"]')) r.checked = r.value === etat.format;
  for (const r of document.querySelectorAll('input[name="seuil"]')) r.checked = Number(r.value) === etat.seuil;
  $('proportion').value = etat.proportion ? String(etat.proportion) : 'fichier';
}

function reglagesChanges() {
  rendreResumes();
  if (!etat.source) return;
  rendrePage();
  rendreCouleurs();
  if (etat.lecture) rendreAnalyse();
}

// ── Branchements ────────────────────────────────────────────────────────────────

function brancher() {
  const depot = $('depot');
  $('fichier').addEventListener('change', (e) => e.target.files[0] && charger(e.target.files[0]));
  depot.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('fichier').click(); }
  });
  for (const type of ['dragenter', 'dragover']) {
    depot.addEventListener(type, (e) => { e.preventDefault(); depot.classList.add('survol'); });
  }
  for (const type of ['dragleave', 'drop']) depot.addEventListener(type, () => depot.classList.remove('survol'));
  depot.addEventListener('drop', (e) => {
    e.preventDefault();
    const fichier = e.dataTransfer.files[0];
    if (fichier) charger(fichier);
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  $('exemple').addEventListener('click', () => chargerExemple('png'));

  // Coller une image : Ctrl+V n'importe où (sauf dans un champ de saisie), ou le bouton, qui
  // lit le presse-papiers quand le navigateur le permet.
  document.addEventListener('paste', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    const fichier = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
    if (!fichier) {
      if (etat.etape === 1) montrerErreur('collerRien');
      return;
    }
    e.preventDefault();
    charger(renommerCollage(fichier));
  });
  $('coller').addEventListener('click', async () => {
    try {
      for (const element of await navigator.clipboard.read()) {
        const type = element.types.find((x) => x.startsWith('image/'));
        if (type) { charger(renommerCollage(new File([await element.getType(type)], 'image', { type }))); return; }
      }
      montrerErreur('collerRien');
    } catch {
      montrerErreur('collerRefuse');
    }
  });
  $('autre-figure').addEventListener('click', autreFigure);
  $('langue').addEventListener('click', () => { etat.langue = etat.langue === 'fr' ? 'de' : 'fr'; appliquerLangue(); });

  // Étapes
  for (const b of document.querySelectorAll('.etape-bouton')) {
    b.addEventListener('click', () => { if (b.getAttribute('aria-disabled') !== 'true') ouvrirEtape(Number(b.dataset.etape), true); });
  }
  activerEtapes(false);
  for (const b of document.querySelectorAll('[data-aller]')) b.addEventListener('click', () => ouvrirEtape(Number(b.dataset.aller), true));

  // Paramètres
  synchroniserReglages();
  for (const r of document.querySelectorAll('input[name="format"]')) {
    r.addEventListener('change', () => { etat.format = r.value; reglagesChanges(); });
  }
  for (const r of document.querySelectorAll('input[name="seuil"]')) {
    r.addEventListener('change', () => { etat.seuil = Number(r.value); reglagesChanges(); });
  }
  $('proportion').addEventListener('change', (e) => { etat.proportion = proportionDepuis(e.target.value); reglagesChanges(); });

  // Info-bulle : un clic l'ouvre ou la ferme, Échap ou un clic ailleurs la ferme.
  const bulle = $('info-seuil'), boutonInfo = $('info-seuil-bouton');
  const basculer = (ouvrir) => { bulle.hidden = !ouvrir; boutonInfo.setAttribute('aria-expanded', String(ouvrir)); };
  boutonInfo.addEventListener('click', (e) => { e.preventDefault(); basculer(bulle.hidden); });
  document.addEventListener('click', (e) => { if (!bulle.hidden && !e.target.closest('.info')) basculer(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !bulle.hidden) { basculer(false); boutonInfo.focus(); } });

  // Écran
  $('carte-curseur').addEventListener('input', montrerCarte);
  $('carte-moins').addEventListener('click', () => { $('carte-curseur').value = parseFloat($('carte-curseur').value) - 0.02; montrerCarte(); });
  $('carte-plus').addEventListener('click', () => { $('carte-curseur').value = parseFloat($('carte-curseur').value) + 0.02; montrerCarte(); });
  $('carte-reinitialiser').addEventListener('click', () => { $('carte-curseur').value = PX_PAR_MM_NOMINAL; montrerCarte(); });
  $('carte-valider').addEventListener('click', validerCalibration);
  $('carte-passer').addEventListener('click', () => ouvrirEtape(4, true));
  $('calibrer').addEventListener('click', () => ouvrirEtape(3, true));

  // Projection : une salle type remplit la largeur et la distance, modifiables ensuite.
  for (const r of document.querySelectorAll('input[name="salle"]')) {
    r.addEventListener('change', () => {
      etat.salle = r.value;
      etat.ecranCm = SALLES[r.value].largeurCm;
      etat.distanceCm = SALLES[r.value].distanceCm;
      rendreProjection();
    });
  }
  const metres = (id, cle, min) => $(id).addEventListener('input', (e) => {
    const v = parseFloat(String(e.target.value).replace(',', '.'));
    if (v >= min) { etat[cle] = v * 100; rendreProjection(); }
  });
  metres('salle-largeur', 'ecranCm', 0.5);
  metres('salle-distance', 'distanceCm', 1);

  // Vues de l'analyse, onglets au clavier compris
  const onglets = [...document.querySelectorAll('.onglets-analyse [role="tab"]')];
  onglets.forEach((b, i) => {
    b.addEventListener('click', () => montrerVue(b.dataset.vue));
    b.addEventListener('keydown', (e) => {
      const sens = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!sens) return;
      e.preventDefault();
      const suivant = onglets[(i + sens + onglets.length) % onglets.length];
      montrerVue(suivant.dataset.vue);
      suivant.focus();
    });
  });
  for (const r of document.querySelectorAll('input[name="vue"]')) {
    r.addEventListener('change', () => { etat.vue = r.value; zoomer(); });
  }
  $('vue-fermer').addEventListener('click', () => $('dialogue-couleurs').close());
  for (const r of document.querySelectorAll('input[name="taille-vue"]')) {
    r.addEventListener('change', () => { etat.tailleVue = r.value; appliquerTailleVue(); });
  }
  $('dialogue-couleurs').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  $('imprimer').addEventListener('click', () => window.print());
  $('imprimer-rapport').addEventListener('click', imprimerRapport);
  $('exporter-lecture').addEventListener('click', telechargerExport);

  // Vue résidu : l'interrupteur masque les textes connus ; le cadre au clavier remplace la souris.
  $('masquer').addEventListener('change', (e) => {
    etat.masquer = e.target.checked;
    $('analyse-figure').classList.toggle('residu', etat.masquer);
    $('zone-clavier').hidden = !etat.masquer;
    fermerFenetreMasque();
    aide(etat.masquer ? 'residuAide' : null);
  });
  $('zone-clavier').addEventListener('click', cadreClavier);
  window.addEventListener('resize', () => etat.source && etat.vue === 'page' && zoomer());
}

brancher();
appliquerLangue();
ouvrirEtape(1);
window.szhFigureCheck = { exporter };
const vueDemandee = { page: 'vue-page', textes: 'rapport', couleurs: 'vue-couleurs', projection: 'vue-projection' }[params.get('vue')];
if (vueDemandee) etat.onglet = vueDemandee;
const figureDemandee = params.get('figure') || '';
if (params.get('exemple')) chargerExemple(params.get('exemple'));
else if (/^tmp\/[\w./-]+$/.test(figureDemandee) && !figureDemandee.includes('..')) chargerUrl(figureDemandee);

// Télécharge d'avance les fichiers lourds dont l'analyse aura besoin, avec les adresses
// exactes de lecture.js et detection.js : le cache HTTP les sert ensuite sans les redemander.
// Seul le modèle du détecteur est gardé en mémoire et remis à chargerDetecteur.
// La table des tailles sert au calcul de la progression quand le serveur ne donne pas la
// taille des octets reçus (contenu compressé) ; test/local.test.mjs la compare à vendor/.

import {
  TESSERACT, TESSERACT_WORKER, TESSERACT_CORE, tessdata, LANGUES_OCR, ORT, ORT_MJS, ORT_WASM, MODELE,
} from './fichiers.js?v=b514a3395f';

// `taille` : octets du fichier de vendor/ désigné par l'adresse.
export const TABLE = [
  { url: TESSERACT, taille: 66695 },
  { url: TESSERACT_WORKER, taille: 123724 },
  { url: TESSERACT_CORE, taille: 3938657 },
  { url: tessdata(LANGUES_OCR[0]), taille: 707406 },
  { url: tessdata(LANGUES_OCR[1]), taille: 1333102 },
  { url: tessdata(LANGUES_OCR[2]), taille: 2952873 },
  { url: ORT, taille: 50196 },
  { url: ORT_MJS, taille: 24381 },
  { url: ORT_WASM, taille: 14239897 },
  { url: MODELE, taille: 2432880 },
];

export const TAILLE_TOTALE = TABLE.reduce((s, f) => s + f.taille, 0);

// Taille attendue des octets lus : content-length quand il est donné et que le contenu
// n'est pas compressé, sinon la table.
export function tailleAttendue(fichier, reponse) {
  const donnee = Number(reponse.headers.get('content-length'));
  return donnee > 0 && !reponse.headers.get('content-encoding') ? donnee : fichier.taille;
}

// Lit tout le corps d'une réponse en signalant les octets reçus ; rend les octets si
// `garder`, sinon null. Lire jusqu'au bout est ce qui range le fichier dans le cache.
async function lireEntier(reponse, surOctets, garder) {
  if (!reponse.body) {
    const octets = new Uint8Array(await reponse.arrayBuffer());
    surOctets(octets.length);
    return garder ? octets : null;
  }
  const lecteur = reponse.body.getReader();
  const morceaux = [];
  let lus = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    lus += value.length;
    surOctets(value.length);
    if (garder) morceaux.push(value);
  }
  if (!garder) return null;
  const octets = new Uint8Array(lus);
  let o = 0;
  for (const m of morceaux) { octets.set(m, o); o += m.length; }
  return octets;
}

// Télécharge toute la table en parallèle. `progres(recus, total)` : octets reçus sur total
// attendu (corrigé au fur et à mesure que les en-têtes arrivent). Rend { modele } (octets du
// détecteur). Une réponse en erreur ou un réseau coupé rejette.
export async function precharger(progres = () => {}, chercher = (url) => fetch(url)) {
  const attendues = TABLE.map((f) => f.taille);
  let recus = 0;
  const signaler = () => progres(recus, attendues.reduce((s, n) => s + n, 0));
  signaler();
  let modele = null;
  await Promise.all(TABLE.map(async (fichier, i) => {
    const reponse = await chercher(fichier.url);
    if (!reponse.ok) throw new Error(`${fichier.url} : ${reponse.status}`);
    attendues[i] = tailleAttendue(fichier, reponse);
    signaler();
    const octets = await lireEntier(reponse, (n) => { recus += n; signaler(); }, fichier.url === MODELE);
    if (fichier.url === MODELE) modele = octets;
  }));
  return { modele };
}

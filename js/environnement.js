// Ce dont l'outil a besoin dans le navigateur : WebAssembly (OCR et détecteur), les Web
// Workers (OCR) et la lecture des pixels d'un canevas (toutes les mesures). Les protections
// contre le pistage (privacy.resistFingerprinting de Firefox) bloquent ou brouillent cette
// lecture tant que l'utilisateur n'a pas autorisé le site, d'où un test sur un motif connu.
// Les fonctions de calcul n'ont pas besoin du DOM : le canevas se fabrique par un rappel.

// Quatre pixels de couleurs précises, dessinés sur un canevas de 2 × 2.
export const MOTIF = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [200, 100, 50]];
export const POSITIONS = [[0, 0], [1, 0], [0, 1], [1, 1]];

// Vrai si les pixels lus (RGBA, 16 valeurs) sont exactement ceux du motif : une lecture
// vide, uniforme ou brouillée d'un seul bit est une lecture bloquée.
export function motifIntact(donnees) {
  if (!donnees || donnees.length !== 16) return false;
  return MOTIF.every((c, i) => c.every((v, k) => donnees[i * 4 + k] === v) && donnees[i * 4 + 3] === 255);
}

function canevasDocument() {
  const c = document.createElement('canvas');
  c.width = 2;
  c.height = 2;
  return c;
}

// Dessine le motif sur un canevas hors écran et le relit. Une erreur (SecurityError) ou un
// contexte absent valent « bloqué ». À appeler dans un gestionnaire de clic pour que
// Firefox puisse afficher sa demande d'autorisation.
export function lirePixelsPossible(creerCanevas = canevasDocument) {
  try {
    const c = creerCanevas();
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    MOTIF.forEach((rvb, i) => {
      ctx.fillStyle = `rgb(${rvb.join(',')})`;
      ctx.fillRect(POSITIONS[i][0], POSITIONS[i][1], 1, 1);
    });
    return motifIntact(ctx.getImageData(0, 0, 2, 2).data);
  } catch {
    return false;
  }
}

// { wasm, worker, canvas } : vrai quand la fonction est disponible.
export function verifierEnvironnement(globale = globalThis, creerCanevas = canevasDocument) {
  return {
    wasm: typeof globale.WebAssembly === 'object' && typeof globale.WebAssembly.instantiate === 'function',
    worker: typeof globale.Worker === 'function',
    canvas: lirePixelsPossible(creerCanevas),
  };
}

const SONDE = new URL('./sonde-travailleur.js?v=64c3d60d2f', import.meta.url).href;

// Lance le travailleur d'essai : { wasm, worker } vus depuis un travailleur. Un travailleur qui
// ne démarre pas (erreur) vaut « pas de Worker » ; un silence au-delà du délai ne conclut rien.
export function sonderTravailleur({ url = SONDE, Travailleur = globalThis.Worker, delaiMs = 4000 } = {}) {
  return new Promise((ok) => {
    let w = null;
    const fin = (r) => { clearTimeout(minuteur); try { w?.terminate(); } catch { /* déjà arrêté */ } ok(r); };
    const minuteur = setTimeout(() => fin({ wasm: true, worker: true }), delaiMs);
    try { w = new Travailleur(url); } catch { fin({ wasm: true, worker: false }); return; }
    w.onmessage = (m) => fin({ wasm: m.data === true, worker: true });
    w.onerror = () => fin({ wasm: true, worker: false });
  });
}

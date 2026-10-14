// Simulation indicative de la basse vision sur la figure à sa taille imprimée, lue à
// LECTURE_MM. Acuité réduite : flou gaussien dont l'écart type vaut l'angle minimal de
// résolution (1 / acuité, en minutes d'arc) à cette distance. Contraste réduit et
// cataracte : filtres de couleur, plus un flou pour la cataracte. Ce n'est pas un modèle
// clinique : il montre ce qui disparaît en premier.

export const LECTURE_MM = 400;
export const MM_PAR_MINUTE = LECTURE_MM * Math.tan(Math.PI / 10800);

export function flouMm(acuite) {
  return MM_PAR_MINUTE / acuite;
}

// Écart type du flou en pixels d'une image large de largeurPx, imprimée sur largeurMm.
export function flouPx(acuite, largeurPx, largeurMm) {
  return flouMm(acuite) * largeurPx / largeurMm;
}

// Filtre de canevas (syntaxe CSS) de chaque vue de basse vision.
export function filtreBasseVision(vue, largeurPx, largeurMm) {
  const flou = (a) => `blur(${flouPx(a, largeurPx, largeurMm).toFixed(2)}px)`;
  switch (vue) {
    case 'acuite5': return flou(0.5);
    case 'acuite3': return flou(0.3);
    case 'contraste': return 'contrast(0.45) brightness(1.3)';
    case 'cataracte': return `${flou(0.5)} sepia(0.35) contrast(0.7) brightness(1.08)`;
    default: return 'none';
  }
}

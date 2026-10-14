// Projection d'une figure sur une diapositive 16:9, vue depuis le dernier rang d'une salle.
// L'aperçu à l'écran a la même taille apparente que la diapositive vue de la salle, pour
// une personne assise à DISTANCE_ECRAN_CM de son propre écran ; sans réglage de l'écran,
// c'est approché. Le verdict, lui, ne dépend que de la salle : il suit la norme DISCAS.

export const CM_PAR_PT = 2.54 / 72;
export const DISTANCE_ECRAN_CM = 60;     // un bras tendu devant son écran

// ANSI/AVIXA V202.01 (DISCAS), prise de décision de base (lire et comprendre) : la hauteur
// d'une lettre minuscule doit atteindre 1/200 de la distance du spectateur le plus éloigné.
export const ACUITE_DISCAS = 200;

// Diapositive de présentation par défaut (PowerPoint, Impress) : 33,867 × 19,05 cm.
// Bandeau de titre en haut, marges sur les côtés et en bas ; la figure occupe le reste.
export const DIAPO = { largeurCm: 33.867, hauteur: 9 / 16, marge: 0.04, titre: 0.15, bas: 0.05 };

// Deux salles types. voile : part de lumière ambiante qui éclaircit l'image, faible pour
// un écran, forte pour un projecteur dans une salle éclairée.
export const SALLES = {
  petite: { largeurCm: 145, distanceCm: 500, voile: 0.06 },
  grande: { largeurCm: 400, distanceCm: 1500, voile: 0.22 },
};

// Cadre de la figure dans la diapositive, en fraction de la largeur de la diapositive.
export function cadreFigure(ratioFigure) {
  const lMax = 1 - 2 * DIAPO.marge;
  const hMax = DIAPO.hauteur * (1 - DIAPO.titre - DIAPO.bas);
  const l = Math.min(lMax, hMax / ratioFigure);
  return { l, h: l * ratioFigure };
}

// Largeur à donner à l'aperçu pour qu'il paraisse aussi grand que l'écran de la salle.
export function largeurApparenteCm(largeurCm, distanceCm, distanceEcranCm = DISTANCE_ECRAN_CM) {
  return largeurCm * distanceEcranCm / distanceCm;
}

// Hauteur minimale d'une minuscule sur l'écran de la salle, selon DISCAS.
export function minusculeMinCm(distanceCm) {
  return distanceCm / ACUITE_DISCAS;
}

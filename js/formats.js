// Géométrie des pages de Pronto, en millimètres, et place qu'y prend une figure.
// Revue : pipeline/styles/print.css et socle.css. Livre : pipeline/styles/livre/normal.css.

export const MM_PAR_PX = 25.4 / 96;      // 1 px CSS
export const MM_PAR_PT = 25.4 / 72;

export const TAILLE_MIN_PT = 8;          // plus petit texte admis dans une figure
export const LC_MIN = 60;                // contraste APCA minimal d'un texte de figure

export const FORMATS = {
  revue: {
    page: { l: 210, h: 297 },
    marges: { haut: 86 * MM_PAR_PX, droite: 72 * MM_PAR_PX, bas: 78 * MM_PAR_PX, gauche: 72 * MM_PAR_PX },
    corpsPt: 10.5,
    interligne: 1.55,
    legendePt: 0.85 * 12,
    legendeItalique: false,
    plafond: 0.8,                        // --plafond-figure : 80vh, soit 80 % de la zone de contenu
  },
  livre: {
    page: { l: 155, h: 225 },
    marges: { haut: 16.25, droite: 20, bas: 22.9, gauche: 20 },
    corpsPt: 10,
    interligne: 1.35,
    legendePt: 10,
    legendeItalique: true,
    plafond: 0.8,
  },
};

export function zoneContenu(format) {
  const { page, marges } = format;
  return { l: page.l - marges.gauche - marges.droite, h: page.h - marges.haut - marges.bas };
}

// Taille de la figure sur la page, en mm. `naturel` est la taille intrinsèque en px CSS
// (1 pixel d'image = 1 px CSS, comme dans WeasyPrint), ou null si elle est inconnue.
// `proportion` impose une fraction de la largeur de colonne ; null reproduit Pronto :
// `max-width: 100%; height: auto; max-height: var(--plafond-figure)`.
export function tailleFigure(format, ratio, naturel, proportion = null) {
  const zone = zoneContenu(format);
  let l;
  if (proportion) l = zone.l * proportion;
  else if (naturel) l = Math.min(naturel.l * MM_PAR_PX, zone.l);
  else l = zone.l;
  let h = l * ratio;
  const plafond = zone.h * format.plafond;
  if (h > plafond) { h = plafond; l = h / ratio; }
  return { l, h };
}

// Taille en points, à l'impression, d'un texte haut de `emPx` pixels dans une image large
// de `largeurPx`, imprimée sur `largeurMm`.
export function versPoints(emPx, largeurPx, largeurMm) {
  return emPx * (largeurMm / largeurPx) / MM_PAR_PT;
}

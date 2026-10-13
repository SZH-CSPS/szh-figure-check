# Contrôle des figures

Page web statique pour les autrices et auteurs de la Revue suisse de pédagogie spécialisée,
de la Schweizerische Zeitschrift für Heilpädagogik et des livres SZH/CSPS. On y dépose une
figure et on voit :

- **la figure sur la page**, à sa taille imprimée, entourée du texte courant au bon corps,
  dans le format de la Revue (A4) ou du livre (155 × 225 mm) ;
- **la taille et le contraste de chaque texte** de la figure, à l’impression : minimum
  8 pt et contraste APCA Lc 60 ;
- **une figure annotée qu’on explore** : des pastilles numérotées, une par endroit à
  revoir ; le survol ou le clic d’une pastille met en évidence ce seul endroit, voile le
  reste et affiche sa carte à côté de la figure (dessous sur un écran étroit) ;
- **un rapport des endroits à revoir** : pour chacun, un extrait de la figure entouré de
  rouge, la taille et le contraste mesurés, un degré de non-conformité et ce qu’il faut
  faire (agrandir de tant de %, prendre telle couleur). Le rapport s’imprime ou
  s’enregistre en PDF pour l’envoyer à la rédaction ;
- **la figure vue par des personnes daltoniennes** (deutéranopie, protanopie, tritanopie)
  et en niveaux de gris.

La figure ne quitte pas le navigateur. Interface en français et en allemand.

## Héberger

Aucun serveur applicatif ni build : copier le dossier sur n’importe quel hébergement de
fichiers statiques (GitHub Pages, un dossier du site, etc.). Le navigateur charge depuis
jsDelivr Tesseract.js 5.1.1 (OCR) et pdf.js 4.4.168 (PDF), et Tesseract télécharge ses
données de langue (fra, deu, eng, quelques Mo, une fois) depuis tessdata.projectnaptha.com.

## Développer

```
node outils/serveur.mjs          # http://localhost:8123/ ; les modules ES refusent file://
node --test test/*.test.mjs      # calculs : APCA, géométrie, contraste, verdicts, i18n
node outils/capture.mjs "http://localhost:8123/?exemple=png" capture.png
node outils/capture.mjs "http://localhost:8123/?exemple=png" rapport.pdf   # rapport imprimé
```

`?exemple=png|svg` charge la figure d’exemple, `?figure=tmp/nom.png` une figure du dossier
`tmp/` (non suivi : les figures d’auteurs ne vont pas dans le dépôt), `?langue=de` et `?format=livre` fixent la
langue et le format. `capture.mjs` ouvre la page dans Edge sans fenêtre, attend
`body[data-etat="fini"]`, imprime le tableau des textes et enregistre une capture.

| Fichier | Rôle |
|---|---|
| `js/formats.js` | géométrie des pages de Pronto, seuils, place de la figure, conversion en points |
| `js/sources.js` | ouverture d’une image, d’un SVG ou de la première page d’un PDF |
| `js/lecture.js` | textes d’une figure : lus dans le SVG ou le PDF, sinon par OCR |
| `js/analyse.js` | calculs sans DOM : corps d’un texte, contraste d’une zone, degré de non-conformité, couleur proposée, regroupement |
| `js/apca.js` | APCA-W3 0.1.9, mêmes constantes que `pipeline/apca.py` de Pronto |
| `js/i18n.js` | libellés fr et de |
| `js/app.js` | interface |

## Ce que mesure l’outil

**Place de la figure.** Celle de Pronto : `max-width: 100%; height: auto; max-height: 80vh`,
un pixel d’image valant un pixel CSS. Une image de moins de 650 px de large reste donc plus
étroite que la colonne de la Revue. Les marges et corps viennent de
`pipeline/styles/print.css`, `socle.css` et `livre/normal.css`. Un PDF est pris page
entière : il doit être recadré sur la figure.

**Corps d’un texte.** Dans un SVG (éléments `<text>`) ou un PDF (texte non vectorisé), il
est lu dans le fichier. Dans une image, Tesseract trouve les mots (mode « texte épars », sur
une copie en gris assombrie pour ne pas perdre le gris clair, puis une seconde fois tournée
d’un quart de tour pour les textes verticaux). La hauteur d’encre des minuscules sans hampe
et des capitales est mesurée sur les pixels et convertie en corps (hauteur d’x 0,52 em,
capitale 0,71 em). Sur la figure d’exemple, l’écart avec les tailles exactes du SVG reste
sous 4 % pour les textes droits.

**Contraste.** Mesuré sur les pixels de chaque mot : Otsu sépare texte et fond, le fond est
le groupe le plus nombreux, la couleur du texte est la moyenne des 20 % de pixels les plus
éloignés du fond. Sur une image de petite résolution, le lissage éclaircit les traits fins
et la mesure est un peu plus sévère que la couleur nominale.

**Degré de non-conformité.** Trois niveaux, avec une couleur et un symbole :

| Niveau | Taille | Contraste |
|---|---|---|
| ✓ Conforme | 8 pt ou plus | Lc 60 ou plus |
| ! À améliorer | de 6,5 à 8 pt | de Lc 45 à 60 |
| ✕ À corriger | moins de 6,5 pt | moins de Lc 45 |

Le degré se décide sur la valeur affichée, arrondie. Les textes qui ont le même défaut
(graduations d’un axe, par exemple) forment un seul endroit à revoir.

**Figure très chargée.** Quand la moitié au moins des textes (et au moins 5) sont sous
8 pt, c’est la figure entière qui est trop petite : un encadré le dit une fois, avec la
plage de tailles, le facteur d’agrandissement nécessaire et ce que donneraient la pleine
largeur et une page entière en paysage. Les cartes ne portent alors plus que sur le
contraste, regroupées par style de texte (mêmes couleurs de texte et de fond, tailles à
20 % près). Au-delà de 8 groupes, les cartes passent aussi par style ; les suivants
restent dans la liste de tous les textes. La couleur proposée
est la plus proche de l’actuelle qui atteint Lc 70, soit le minimum avec 10 de marge.

**Limites.** Un texte incliné, très stylisé ou plus petit qu’environ 4 pt à l’impression
peut échapper à l’OCR. Le « taille réelle » de l’écran n’est juste qu’après le réglage par
carte bancaire ; l’impression à 100 % reste la référence.

## Licence

Code, textes et figure d’exemple : Creative Commons Attribution 4.0 International
(CC BY 4.0, `LICENSE`), SZH/CSPS.

Les polices du dossier `fonts/` (Open Sans semi-condensée) restent sous SIL Open Font
License 1.1 (`fonts/OFL-OpenSans.txt`), la licence de leurs autrices et auteurs.

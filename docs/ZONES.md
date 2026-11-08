# Zones des objets : critères et figures de référence

La vue « Objets du graphique » juge le contraste des zones d’une figure (barres, aires,
secteurs, courbes, éléments d’un dessin) avec le fond et entre elles. Pour que ce jugement
soit utile, l’outil doit trouver **les zones qui portent quelque chose**, chacune d’un seul
tenant, et **rien d’autre**. Ce document fixe ce qu’est une zone utile, décrit les cinq
figures de référence qui le mesurent et donne les résultats avant et après la refonte de la
détection sur les pixels.

## Ce qui n’allait pas

Mesuré sur les figures de référence avec l’ancienne méthode (couleurs regroupées à 12
unités Lab près, puis composantes connexes de 0,25 mm² et plus) :

- **Un léger dégradé n’était pas analysé.** Les régions d’un dégradé étaient bien réunies,
  mais la zone obtenue devenait un « dégradé », sans couleur, donc sans contraste jugé : le
  mur pastel de la maison, la tasse bleu vif, les quatre boîtes pastel du schéma et la boîte
  d’alerte rouge sortaient tous de l’analyse. Un écart type des pixels au-dessus de 8 suffisait.
- **Une zone coupée par un trait fin était découpée.** La bande jaune pâle de la figure 2,
  traversée par une courbe et deux lignes de quadrillage, donnait quatre zones ; la fenêtre à
  croisillons de la figure 3, quatre carreaux.
- **Des micro-zones sortaient.** Avec un seuil de 0,25 mm² (un carré d’un demi-millimètre),
  une poignée de porte, des fleurs de 3 px de rayon, des brins d’herbe, les oiseaux, le reflet
  du soleil, les grains de terre et les points décoratifs du pot devenaient des objets, et des
  séries entières : 15 intrus sur le paysage, 6 sur la tasse et la plante.
- **Les ombres douces sortaient** comme des morceaux de la table qui les porte.
- **Le grain d’une image compressée découpait les aplats** : à ±4 par canal, des barres
  manquaient et les boîtes du schéma partaient en 23 morceaux.
- Dans un SVG, toute zone remplie par un `linearGradient` ou un `radialGradient` n’avait pas
  de couleur (12 barres sur 12 de la figure 1 non analysées), les ombres floutées et les
  pastilles de 7 px étaient des objets.

## Ce qu’est une zone utile

Critères retenus après analyse des cinq figures ; les constantes sont dans `js/objets.js`.

1. **Assez grande pour compter.** Une surface d’au moins 1,5 mm² à l’impression (un rond de
   1,4 mm, le plus petit marqueur d’un nuage de points) ; un trait d’au moins 4 mm de long
   (sa surface rapportée à son épaisseur, au plus la diagonale de sa boîte). En dessous, c’est
   un détail de dessin : il n’est ni montré ni jugé (`ZONE_MIN_MM2`, `TRAIT_MIN_MM`). Ces
   micro-zones servent encore à reconnaître une texture et les briques d’un quadrillage entre
   deux barres, puis quittent l’analyse.
2. **D’un seul tenant malgré un léger dégradé.** L’étendue d’une zone est l’écart Lab de ses
   pixels à sa couleur moyenne, au 95e centile. Jusqu’à 20, c’est un aplat ou un léger
   dégradé, pastel comme vif : une seule zone, jugée sur sa couleur moyenne **et** sur ses
   nuances extrêmes (moyenne des 5 % de pixels les plus clairs, des 5 % les plus foncés) ; le
   contraste retenu est le plus faible des trois. Au-delà, c’est un dégradé fort, qui reste
   hors des séries (`ETENDUE_LEGERE`). Les figures de référence vont de 1 à 14 ; un dégradé
   du bleu foncé au blanc dépasse 30.
3. **D’un seul tenant malgré un trait fin posé dessus.** Deux régions de même couleur que
   sépare seulement un trait d’au plus 1 mm (une courbe, une ligne de quadrillage, un
   croisillon), sur au moins la moitié du plus petit côté de la plus petite, sont une seule
   zone (`PONT_EPAISSEUR_MM`). Un espace où passe la couleur du fond n’est pas un trait :
   deux barres de même couleur séparées par un blanc restent deux barres, même là où le
   quadrillage enclôt ce blanc.
4. **Sans trous de détail.** Une micro-région enclavée à 90 % dans une zone (une fleur dans
   l’herbe, un cœur sur une tasse, une poignée de porte) lui revient, sans compter dans sa
   couleur : la zone garde sa forme et son contour n’a pas de trous.
5. **Pas une ombre ni un halo.** Une région qui se fond dans le fond sans saut (sur 20 % de
   son pourtour au moins) et qui en reste proche (moins de 20 unités Lab) est du fond. Une
   ombre douce posée sur une autre zone se réunit à elle et ne change pas sa couleur.
6. **Pas le grain de l’image.** Avant tout, chaque pixel prend la moyenne de ses voisins qui
   en diffèrent d’au plus 10 par canal : le grain s’efface, les bords et les traits d’un pixel
   restent. La continuité d’un dégradé se juge un pixel plus loin de part et d’autre d’une
   frontière, ce qu’un bord lissé ne passe pas.

7. **Rien de ce qui est texte.** Tout ce que l’outil détecte ou lit comme texte, et tout
   texte ajouté à la main, est écarté de la recherche des formes avec un halo, textes « à
   vérifier » compris ; un texte retiré (« ce n’est pas un texte ») et une suggestion pas
   encore confirmée y restent. Les mots d’une ligne séparés de moins d’une hauteur de ligne
   forment une seule boîte. La recherche est refaite quand un texte est ajouté, retiré ou
   rétabli. Une étiquette plus large que la barre qui la porte ne la coupe pas : la même
   couleur qui reprend de part et d’autre de la boîte du texte recoud la zone, et le contour
   ne suit pas le bord du texte.
8. **Un quadrillage, même d’un seul tenant.** Les nuances se regroupent à 8 unités Lab près
   (et non 12) : une barre pâle et la ligne grise d’un quadrillage qui la touche (9 unités)
   restent distinctes. Un pont ou un escalier ne relie que des morceaux de même épaisseur (à
   un facteur 2 près) et de même couleur (8 unités). Un trait d’un seul tenant qui couvre une
   bonne part de la figure, fait de lignes horizontales et verticales qui la traversent, est
   un quadrillage : ni son contraste ni son épaisseur ne sont jugés.

Dans un SVG, les mêmes critères s’appliquent aux éléments : les arrêts d’un dégradé sont lus
(`href` suivi) et un dégradé dont les arrêts restent à moins de 40 unités Lab les uns des
autres a la couleur moyenne de ses arrêts et leurs extrêmes pour nuances ; un dégradé à
arrêts surtout transparents (un reflet) n’est pas une zone ; un élément flouté par un filtre
fait seulement d’un flou gaussien (une ombre), ou moins opaque que 0,15 avec ses groupes
parents, non plus ; un élément translucide plus opaque a sa couleur mêlée au fond.

## Figures de référence

`exemples/reference/`, données et dessins fictifs, 1200 × 800, à 172 mm de large :

| Figure | Genre | Ce qu’elle éprouve |
|---|---|---|
| `ref-1-barres.svg` | graphique | 12 barres pastel en léger dégradé vertical, une valeur posée sur une barre, légende, quadrillage, graduations de 6 px |
| `ref-2-courbes.svg` | graphique | aire pastel en léger dégradé, courbe vive à marqueurs, bande jaune pâle en léger dégradé coupée par la courbe et deux lignes, points d’annotation de 2 px |
| `ref-3-paysage.svg` | illustration | ciel pastel en dégradé (le fond), soleil vif en dégradé radial avec reflet, nuage, collines et chemin en léger dégradé, maison (mur, toit, porte, fenêtre à croisillons), arbre ; fleurs, brins, oiseaux, poignée de porte en micro-éléments |
| `ref-4-tasse-plante.svg` | illustration | table pastel en dégradé, tasse vive en dégradé avec anse et reflet doux translucide, pot vif en dégradé, rebord, six feuilles de trois verts ; ombres floutées, cœur, grains de terre, points du pot |
| `ref-5-schema.svg` | schéma | quatre boîtes pastel en léger dégradé à bord plus foncé, une boîte rouge vif en dégradé, flèches avec pointes, une flèche qui se divise ; ombres douces, pastilles de 7 px |

Dans chaque SVG, `data-zone="nom"` marque une zone attendue, `data-tolere="nom"` une zone
permise (légende, quadrillage, axes, bords, vapeur, tige) ; tout le reste ne doit pas sortir.
`node outils/zones-reference.mjs` rend les PNG (Chromium de Playwright, 1 px par unité) et
écrit `test/verite-zones.json` : la partie visible de chaque zone est mesurée en masquant
l’élément et en comparant les deux rendus, sa couleur est la moyenne de ses pixels hors frange.

`node outils/zones.mjs [--bruit n] [--echelle 2] [--svg] [--details]` compare l’analyse à la
vérité ; `--banc` donne les totaux dans cinq conditions : nette, grain ±4, grain ±8, réduite
de moitié (une figure envoyée petite), réduite et grain ±4. Les critères :

- **trouvée** : un objet analysé (dans une série) recouvre la zone à IoU 0,5 au moins, avec
  une couleur à ΔE00 10 au plus de la couleur réelle ;
- **découpée** : d’autres objets de sa couleur sont logés dans la zone ;
- **intrus** : un objet qui n’est ni une zone attendue, ni dans une zone tolérée, ni un morceau.

`test/zones.test.mjs` exige, pour les cinq PNG, sans grain et avec un grain de ±4 : toutes les
zones trouvées, aucune découpée, aucun intrus.

## Résultats

Voie approchée (PNG), zones trouvées sur 46, zones découpées, intrus :

| | Avant | Après |
|---|---|---|
| Sans grain | 37 / 46, 4 découpées, 22 intrus | 46 / 46, 0 découpée, 0 intrus |
| Grain ±4 | 33 / 46, 8 découpées, 21 intrus | 46 / 46, 0 découpée, 0 intrus |
| Grain ±6 | 30 / 46, 8 découpées, 1 707 intrus | 46 / 46, 0 découpée, 0 intrus |
| Réduite de moitié | 33 / 46, 7 découpées, 22 intrus | 46 / 46, 3 découpées, 0 intrus |

Le détail des étapes (traits fins recollés, occlusion) et des variantes écartées est dans
`docs/VARIANTES-ZONES.md`. Durée : de 0,2 à
0,8 s par figure de 1200 × 800 sous Node, contre 0,2 à 0,5 s avant.

Voie exacte (SVG), même vérité : avant 15 / 46 et 23 intrus, après 43 / 46 et 2 intrus (un
marqueur de courbe coupé par l’axe, la colline lointaine) ; les 8 zones « découpées » sont
des éléments distincts d’une même zone et d’une même série (marqueurs, cercles d’un nuage,
anse d’une tasse).

La figure d’exemple (`exemples/figure-exemple.png`) garde son résultat : trois séries de
barres, le jaune à corriger sur le blanc (1,6:1), le rouge et le vert difficiles à distinguer
en deutéranopie (écart 11) et en gris (écart 7), le quadrillage reconnu, l’axe.

## Limites connues

- **Occlusion.** Une surface coupée par un objet épais posé dessus (la colline derrière
  l’arbre et la maison) est réunie si sa couleur reprend de l’autre côté ; deux rectangles
  ne le sont jamais (des barres groupées restent des barres). Deux secteurs de même couleur
  séparés par un troisième deviennent une seule zone, de la même série (voir
  `docs/VARIANTES-ZONES.md`).
- **Voie exacte : boîtes d’éléments.** Un élément caché en partie par un autre garde la boîte
  de tout son tracé (la colline lointaine) ; les pointes de flèche dessinées par des
  marqueurs SVG ne sont pas comptées dans la boîte de la flèche ; les marqueurs ronds d’une
  courbe, les cercles d’un nuage et l’anse d’une tasse sont des éléments distincts, de la
  même série que la zone.
- Une zone pâle à moins de 6 unités Lab du fond s’y confond toujours, et un dégradé qui va
  jusqu’à la couleur du fond se fond avec lui.

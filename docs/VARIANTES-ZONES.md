# Variantes de la détection des zones : comparatif

Trois variantes essayées à partir de la refonte de la détection sur les pixels
(`claude/shape-detection-contrast-4chtlj`, voir `docs/ZONES.md`), chacune sur sa branche,
mesurées avec `node outils/zones.mjs --banc` : les cinq figures de référence, 46 zones
attendues, dans cinq conditions. Chaque case : zones trouvées / zones découpées / intrus.

| Condition | Base | A : traits fins | C : A + occlusion | B : croissance (seule) |
|---|---|---|---|---|
| nette | 45 / 1 / 0 | 45 / 1 / 0 | **46 / 0 / 0** | 45 / 2 / 0 |
| grain ±4 | 45 / 1 / 0 | 45 / 1 / 0 | **46 / 0 / 0** | 45 / 2 / 0 |
| grain ±8 | 45 / 1 / 0 | 45 / 1 / 0 | **46 / 0 / 0** | 44 / 4 / 0 |
| réduite ½ | 43 / 5 / 0 | 45 / 4 / 0 | **46 / 3 / 0** | 43 / 4 / 1 |
| réduite ½ + grain ±4 | 43 / 5 / 0 | 45 / 4 / 0 | **45 / 4 / 0** | 42 / 5 / 0 |

Charge (Node, image de 2000 × 1500) : photo synthétique 1,9 s pour la base, 2,6 s pour C ;
mosaïque de 3 199 carreaux 0,9 s et 1,1 s. Sur la photo, la base trouve 1 144 objets et des
« formes nettes », C 10 objets et aucune forme nette, ce qui est la bonne réponse.

## A : traits fins recollés — `claude/zones-a-traits-fins`

Sur une figure envoyée petite, une courbe lissée de moins de 2 px n’est plus qu’un escalier
de paliers qui ne se touchent qu’en diagonale, à travers leur frange ; une ligne de
quadrillage qui la croise la coupe aussi. Deux régions fines de même couleur à au plus deux
pixels l’une de l’autre sont le même trait, les paliers trop petits pour compter seuls
compris ; le pont d’un trait fin se mesure à son épaisseur, pas au petit côté de sa boîte.
Effet : les deux courbes de la figure 2 réduite, en 5 et 7 morceaux, sont d’un seul tenant.
À trois pixels au lieu de deux, le grain ±8 colle des taches voisines (43 / 46) : gardé à deux.

## C : occlusion — `claude/zones-c-occlusion` (contient A) — recommandée

Une surface qu’un objet épais coupe (la colline derrière l’arbre et la maison) reprend, de
l’autre côté, la même couleur. Deux régions épaisses de même couleur que séparent seulement
d’autres régions (ni le fond, ni leur couleur), sur au plus 25 % de la figure et sur au moins
40 % du petit côté du plus petit morceau, sont la même zone. Deux rectangles ne sont jamais
réunis : des barres groupées collées (bleu, orange, bleu) restent trois barres ; un test le
vérifie, et une mosaïque de carreaux n’est pas fusionnée. À 15 %, la maison (196 px de
large sur 1200) coupait encore la colline.

Risque connu : deux secteurs non rectangulaires de même couleur séparés par un troisième
(un anneau bleu, orange, bleu) deviennent une seule zone. Ils sont de toute façon dans la
même série : le verdict ne change pas, seul le nombre d’objets de la série baisse.

## B : croissance de régions — `claude/zones-b-croissance` — rejetée

Le cœur remplacé : au lieu de regrouper les couleurs puis de chercher les composantes, chaque
région s’étend de voisin en voisin tant que le pas reste sous ΔE 6 et l’écart à sa moyenne
sous 20. Plus simple sur le papier, jamais meilleure sur le banc, moins robuste au grain
fort (40 à 44 / 46 au grain ±8 selon les réglages : pas 4 ou 8, dérive 15 ou 30), et deux
tests de référence échouent (paysage). Gardée pour mémoire.

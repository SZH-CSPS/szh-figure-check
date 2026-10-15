# Contrôle des figures

Page web statique pour les autrices et auteurs de la Revue suisse de pédagogie spécialisée,
de la Schweizerische Zeitschrift für Heilpädagogik et des livres SZH/CSPS. On y dépose une
figure et on voit :

- **la figure sur la page**, à sa taille imprimée, entourée du texte courant au bon corps,
  dans le format de la Revue (A4) ou du livre (155 × 225 mm) ;
- **la taille et le contraste de chaque texte** de la figure, à l’impression : minimum
  8 pt et contraste APCA Lc 75 (Lc 90 recommandé) ;
- **une figure qu’on explore** : une rangée de numéros, un par endroit à revoir ; le
  survol d’un numéro met en évidence ce seul endroit sur la figure, voile le reste et
  affiche sa carte à côté (dessous sur un écran étroit) ; le clic le rend actif, et sortir
  de la rangée revient à l’endroit actif, le 1 au départ. Aucun numéro sur la figure ;
- **un rapport des endroits à revoir** : pour chacun, un extrait de la figure entouré de
  rouge, la taille et le contraste mesurés, un degré de non-conformité et ce qu’il faut
  faire (agrandir de tant de %, prendre telle couleur). Le rapport s’imprime ou
  s’enregistre en PDF pour l’envoyer à la rédaction ;
- **la figure projetée** sur une diapositive, dans une petite salle avec écran ou une grande
  salle avec projecteur, à la taille apparente qu’elle a au dernier rang (approchée sans
  réglage de l’écran), jugée selon la norme AVIXA DISCAS : la hauteur d’une minuscule doit
  atteindre 1/200 de la distance du dernier rang ;
- **la figure vue par des personnes daltoniennes** (deutéranopie, protanopie, tritanopie)
  et en niveaux de gris ;
- **la basse vision** : approximations à but
  de sensibilisation, à regarder en taille réelle à 40 cm. Acuité 5/10 et 3/10 (flou
  gaussien), seuil et confort de lecture comparés aux textes de la figure (unité M, réserve
  d’acuité de 2), contraste perçu affaibli et cataracte par la méthode du contraste local
  par bandes de Peli. Les limites de chaque modèle sont dites dans la page.

Le parcours tient en quatre étapes, en accordéon : choisir la figure, régler les paramètres
(format, largeur, contraste minimal Lc 75 par défaut ou Lc 90 recommandé), régler l’écran,
lire l’analyse. L’analyse montre une vue à la fois : aperçu à taille réelle, taille et
contraste des textes, couleurs.

La figure ne quitte pas le navigateur. Interface en français et en allemand.

Pour faire produire des figures conformes par un agent d’IA, voir le méta-prompt
`docs/meta-prompt-figures.md`.

## Héberger

Aucun serveur applicatif ni build : copier le dossier sur n’importe quel hébergement de
fichiers statiques. Il est publié sur GitHub Pages : https://szh-csps.github.io/szh-figure-check/

**Tout est servi par le site lui-même** : polices, détecteur de texte (onnxruntime-web et
son modèle de détection, en WebAssembly), OCR (Tesseract.js, son moteur WebAssembly et les
données de langue fra, deu, eng), lecture des PDF (pdf.js). Les
bibliothèques sont copiées dans `vendor/`, avec leurs versions, licences et empreintes
(`vendor/README.md`). La politique de sécurité de contenu de `index.html` interdit au
navigateur toute connexion vers un autre serveur.

**Aucune télémétrie** : ni statistiques de visite, ni cookie, ni envoi de la figure ou des
résultats. Le seul stockage est local au navigateur : le réglage de l’écran
(`localStorage`) et le cache des données de langue de l’OCR (IndexedDB). L’hébergeur voit
les requêtes de fichiers comme pour toute page web (journaux de GitHub Pages).

## Développer

```
node outils/serveur.mjs          # http://localhost:8123/ ; les modules ES refusent file://
node --test test/*.test.mjs      # calculs : APCA, géométrie, contraste, verdicts, i18n, versions
node outils/version.mjs          # version des références internes, avant chaque publication
node outils/capture.mjs "http://localhost:8123/?exemple=png" capture.png
node outils/capture.mjs "http://localhost:8123/?exemple=png" rapport.pdf   # rapport imprimé
CAPTURE_HORS_LIGNE=1 node outils/capture.mjs …   # tout autre serveur que celui de la page introuvable
```

**Avant chaque publication**, lancer `node outils/version.mjs` et commiter ce qu’il a
modifié. GitHub Pages garde chaque fichier dix minutes en cache ; pour qu’un navigateur ne
mélange pas une nouvelle page avec un ancien module, chaque référence interne à un fichier
`.js`, `.mjs` ou `.css` (dans `index.html`, `style.css` et `js/`) porte le suffixe
`?v=<version>`. La version est l’empreinte du contenu de ces fichiers et de
`vendor/README.md` : l’outil ne change rien si rien n’a changé. `test/version.test.mjs`
échoue tant qu’une référence n’a pas la version du contenu actuel. Une nouvelle référence
s’écrit sans suffixe : l’outil l’ajoute.

`?exemple=png|svg` charge la figure d’exemple, `?etape=2|3|4` ouvre une étape, `?vue=page|textes|couleurs` choisit la vue de l’analyse, `?lc=75` le seuil de contraste, `?figure=tmp/nom.png` une figure du dossier
`tmp/` (non suivi : les figures d’auteurs ne vont pas dans le dépôt), `?langue=de` et `?format=livre` fixent la
langue et le format, `?moteur=tesseract` force l’ancienne lecture de l’image entière par
l’OCR, pour comparer. `capture.mjs` ouvre la page dans Edge sans fenêtre, attend
`body[data-etat="fini"]`, imprime le tableau des textes et enregistre une capture.

| Fichier | Rôle |
|---|---|
| `js/formats.js` | géométrie des pages de Pronto, seuils, place de la figure, conversion en points |
| `js/sources.js` | ouverture d’une image, d’un SVG ou de la première page d’un PDF |
| `js/lecture.js` | textes d’une figure : lus dans le SVG ou le PDF, sinon détectés puis lus ligne à ligne par l’OCR ; repli sur l’OCR seul |
| `js/detection.js` | détecteur de texte : entrée et post-traitement du réseau, corps mesuré sur le profil d’encre |
| `js/analyse.js` | calculs sans DOM : corps d’un texte, contraste et bruit du fond d’une zone, degré de non-conformité, couleur proposée, regroupement |
| `js/apca.js` | APCA-W3 0.1.9, mêmes constantes que `pipeline/apca.py` de Pronto ; valeurs identiques au paquet officiel `apca-w3` |
| `js/couleurs-graphique.js` | couleurs des éléments graphiques : aplats dominants, contraste avec le fond, écart entre deux couleurs selon la vision ; bloc du rapport (styles dans `couleurs-graphique.css`) |
| `js/vision.js` | basse vision : flou d’acuité, seuils de lecture, contraste local par bandes (Peli) |
| `js/projection.js` | diapositive 16:9, salles types, taille apparente, minimum DISCAS |
| `js/i18n.js` | libellés fr et de |
| `js/app.js` | interface |

## Ce que mesure l’outil

**Place de la figure.** Celle de Pronto : `max-width: 100%; height: auto; max-height: 80vh`,
un pixel d’image valant un pixel CSS. Une image de moins de 650 px de large reste donc plus
étroite que la colonne de la Revue. Les marges et corps viennent de
`pipeline/styles/print.css`, `socle.css` et `livre/normal.css`. Un PDF est pris page
entière : il doit être recadré sur la figure.

**Corps d’un texte.** Dans un SVG (éléments `<text>`) ou un PDF (texte non vectorisé), il
est lu dans le fichier. Dans une image, trois temps. *Détection* : un réseau de
segmentation (DBNet, modèle de détection PP-OCRv3 de PaddleOCR, exécuté par onnxruntime-web
en WebAssembly) rend une carte de probabilité du texte ; on la binarise (0,3), on isole les
composantes connexes, chacune devient une boîte (orientée si la ligne est allongée et
franchement inclinée, droite sinon), élargie selon la formule de DB (1,6 × aire / périmètre)
et gardée si la probabilité moyenne atteint 0,5. L’image donnée au réseau a 1280 px au plus
sur son grand côté. *Mesure* : le corps se déduit du profil d’encre de la ligne, sans la
lire : la densité d’encre par rangée a un palier, qui est la hauteur d’x (hauteur de
capitale pour des capitales et des chiffres) ; avec des hampes au-dessus du palier, les deux
estimations se moyennent (hauteur d’x 0,52 em, capitale 0,71 em). Le contraste se mesure
sur les pixels de la boîte. *Lecture* : chaque boîte est découpée (tournée à l’horizontale
si elle est verticale), agrandie à 56 px de haut et lue par Tesseract en mode « une seule
ligne », pour le libellé seulement ; une lecture vide ou absurde garde la boîte, avec « ? »
pour texte. Une boîte dont le fond varie presque autant que l’écart entre texte et fond (une
tache de photo) est écartée : la variation du fond, loin des bords des lettres, doit rester
sous 0,17 fois cet écart.

**Repli.** Si WebAssembly manque, ou si l’exécuteur ou le modèle ne se charge pas, la page
le dit et l’OCR lit l’image entière, comme avec `?moteur=tesseract` : Tesseract trouve les
mots en mode « texte épars » sur une copie en gris assombrie, puis une seconde fois tournée
d’un quart de tour pour les textes verticaux ; une ligne de trois lettres ou chiffres au
plus exige une confiance de 85, et de 95 sur l’image tournée ; la hauteur d’encre des
minuscules sans hampe et des capitales est convertie en corps. Sur la figure d’exemple,
l’écart avec les tailles exactes du SVG reste sous 4 % pour les textes droits avec cette
lecture.

**Contraste.** Mesuré sur les pixels de chaque mot : Otsu sépare texte et fond, le fond est
le groupe le plus nombreux, la couleur du texte est la moyenne des 20 % de pixels les plus
éloignés du fond. Sur une image de petite résolution, le lissage éclaircit les traits fins
et la mesure est un peu plus sévère que la couleur nominale.

**Degré de non-conformité.** Trois niveaux, avec une couleur et un symbole :

| Niveau | Taille | Contraste |
|---|---|---|
| ✓ Conforme | 8 pt ou plus | Lc 75 ou plus |
| ! À améliorer | de 6,5 à 8 pt | de Lc 60 à 75 |
| ✕ À corriger | moins de 6,5 pt | moins de Lc 60 |

Les seuils de contraste sont ceux du réglage par défaut, Lc 75 ; avec Lc 90, « à améliorer »
va de Lc 75 à 90 et « à corriger » commence sous Lc 75. Le degré se décide sur la valeur affichée, arrondie. Les textes qui ont le même défaut
(graduations d’un axe, par exemple) forment un seul endroit à revoir.

**Figure très chargée.** Quand la moitié au moins des textes (et au moins 5) sont sous
8 pt, c’est la figure entière qui est trop petite : un encadré le dit une fois, avec la
plage de tailles, le facteur d’agrandissement nécessaire et ce que donneraient la pleine
largeur et une page entière en paysage. Les cartes ne portent alors plus que sur le
contraste, regroupées par style de texte (mêmes couleurs de texte et de fond, tailles à
20 % près). Au-delà de 8 groupes, les cartes passent aussi par style ; les suivants
restent dans la liste de tous les textes. La couleur proposée
est la plus proche de l’actuelle qui atteint le seuil plus 10 de marge (Lc 85 ou 100), ou à défaut le seuil.

**Couleurs du graphique.** Les grandes surfaces d’une seule couleur (barres, secteurs,
aplats) sont repérées sur l’image d’analyse : le fond est la couleur la plus fréquente du
pourtour ; les textes lus, avec une marge, et les pixels de bord (un voisin qui diffère de
plus de 16 sur un canal) sont écartés ; les nuances à moins de 12 unités Lab se regroupent.
Une couleur compte si elle couvre au moins 0,5 % de l’image (8 au plus). Une photo ou un
dégradé, dont les pixels unis s’étalent sur des dizaines de nuances, n’a pas de couleur
dominante. Pour chaque couleur, le contraste avec le fond doit atteindre 3:1 (WCAG 2.2,
critère 1.4.11) et Lc 30 (APCA, élément non textuel) ; « à corriger » commence sous 2:1 ou
Lc 15. Pour chaque paire, l’écart CIEDE2000 est calculé en vision normale, après simulation
de la deutéranopie, de la protanopie et de la tritanopie (Machado, Oliveira et Fernandes,
2009, sévérité 1) et en niveaux de gris : sous 12, deux séries se distinguent mal ; sous 5,
elles se confondent. Sur la figure d’exemple, le rouge et le vert se distinguent mal en noir
et blanc (écart 7) et pour une personne deutéranope (écart 11), et le jaune n’a qu’un
contraste de 1,6:1 avec le fond blanc.

**Limites.** Un texte incliné, très stylisé ou plus petit qu’environ 4 pt à l’impression
peut échapper au détecteur et à l’OCR. Le « taille réelle » de l’écran n’est juste qu’après le réglage par
carte bancaire ; l’impression à 100 % reste la référence.

## Licence

Code, textes et figure d’exemple : Creative Commons Attribution 4.0 International
(CC BY 4.0, `LICENSE`), SZH/CSPS.

Les polices du dossier `fonts/` (Open Sans semi-condensée) restent sous SIL Open Font
License 1.1 (`fonts/OFL-OpenSans.txt`), la licence de leurs autrices et auteurs.

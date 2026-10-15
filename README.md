# Contrôle des figures

Page web statique pour les autrices et auteurs de la Revue suisse de pédagogie spécialisée,
de la Schweizerische Zeitschrift für Heilpädagogik et des livres SZH/CSPS. On y dépose une
figure et on voit :

- **la figure sur la page**, à sa taille imprimée, entourée du texte courant au bon corps,
  dans le format de la Revue (A4) ou du livre (155 × 225 mm) ;
- **la taille et le contraste de chaque texte** de la figure, à l’impression : minimum
  8 pt et contraste APCA Lc 75 (Lc 90 recommandé). L’outil montre plutôt qu’il ne devine :
  chaque texte lu a un statut (confirmé, à vérifier, ajouté, retiré), seuls les textes
  confirmés ou ajoutés décident du verdict, et une **vue résidu** masque les textes connus
  pour laisser voir ce qui a été oublié ; l’humain complète à la souris ou au clavier, et
  exporte la lecture en JSON ;
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
contraste des textes, couleurs. Pour un résultat exact, la page demande dès la première
étape le PDF ou le SVG de la figure plutôt qu’une capture d’écran : les tailles y sont lues
dans le fichier, alors que dans une image elles sont estimées.

La figure ne quitte pas le navigateur. Interface en français et en allemand.

Pour faire produire des figures conformes par un agent d’IA, voir le méta-prompt
`docs/meta-prompt-figures.md`.

## Héberger

Aucun serveur applicatif ni build : copier le dossier sur n’importe quel hébergement de
fichiers statiques. Il est publié sur GitHub Pages : https://szh-csps.github.io/szh-figure-check/

**Tout est servi par le site lui-même** : polices, OCR (Tesseract.js, son moteur
WebAssembly et les données de langue fra, deu, eng), lecture des PDF (pdf.js). Les
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
node outils/banc.mjs test/verite-exemples.json exemples --json resultats.json   # banc d'essai (docs/BANC.md)
```

**Avant chaque publication**, lancer `node outils/version.mjs` et commiter ce qu’il a
modifié. GitHub Pages garde chaque fichier dix minutes en cache ; pour qu’un navigateur ne
mélange pas une nouvelle page avec un ancien module, chaque référence interne à un fichier
`.js`, `.mjs` ou `.css` (dans `index.html`, `style.css` et `js/`) porte le suffixe
`?v=<version>`. La version est l’empreinte du contenu de ces fichiers et de
`vendor/README.md` : l’outil ne change rien si rien n’a changé. `test/version.test.mjs`
échoue tant qu’une référence n’a pas la version du contenu actuel. Une nouvelle référence
s’écrit sans suffixe : l’outil l’ajoute.

`?exemple=png|svg` charge la figure d’exemple, `?etape=2|3|4` ouvre une étape, `?vue=page|textes|couleurs` choisit la vue de l’analyse, `?lc=75` le seuil de contraste, `?largeur=100|75|50|fichier` la
largeur de la figure (toute la colonne par défaut), `?figure=tmp/nom.png` (ou `tmp/dossier/nom.png`) une figure du dossier
`tmp/` (non suivi : les figures d’auteurs ne vont pas dans le dépôt), `?langue=de` et `?format=livre` fixent la
langue et le format. `capture.mjs` ouvre la page dans Edge sans fenêtre, attend
`body[data-etat="fini"]`, imprime le tableau des textes et enregistre une capture ;
`CAPTURE_JS` joue un script avant la capture (cocher « Masquer les textes reconnus », par
exemple), `CAPTURE_CLIP` cadre un élément, `CAPTURE_MEDIA=print` montre la page telle que
l’imprimante la voit. Dans la page, `window.szhFigureCheck.exporter()`
rend la lecture courante, le même objet que le bouton « Exporter la lecture (JSON) ».

| Fichier | Rôle |
|---|---|
| `js/formats.js` | géométrie des pages de Pronto, seuils, place de la figure, conversion en points |
| `js/sources.js` | ouverture d’une image, d’un SVG ou de la première page d’un PDF |
| `js/lecture.js` | textes d’une figure : lus dans le SVG ou le PDF, sinon par OCR ; statut de chaque texte, suggestions, lecture d’une zone ajoutée |
| `js/analyse.js` | calculs sans DOM : corps d’un texte, contraste et bruit du fond d’une zone, degré de non-conformité, couleur proposée, regroupement |
| `js/residu.js` | sans DOM : règle du statut, mesure d’une zone par son profil d’encre, zones d’encre restantes (suggestions), coordonnées de l’image d’origine, export |
| `js/apca.js` | APCA-W3 0.1.9, mêmes constantes que `pipeline/apca.py` de Pronto ; valeurs identiques au paquet officiel `apca-w3` |
| `js/couleurs-graphique.js` | couleurs des éléments graphiques : aplats dominants, contraste avec le fond, écart entre deux couleurs selon la vision ; bloc du rapport (styles dans `couleurs-graphique.css`) |
| `js/vision.js` | basse vision : flou d’acuité, seuils de lecture, contraste local par bandes (Peli) |
| `js/projection.js` | diapositive 16:9, salles types, taille apparente, minimum DISCAS |
| `js/i18n.js` | libellés fr et de |
| `js/app.js` | interface |

## Ce que mesure l’outil

**Place de la figure.** Pronto imprime toute figure sur toute la largeur de la colonne
(172 mm dans la Revue, 115 mm dans un livre), plafonnée à 80 % de la hauteur de la zone de
texte : c’est la largeur par défaut. Les trois quarts et la moitié de la colonne se
choisissent, et « Taille du fichier » reproduit un dépôt direct par la rédaction, un pixel
d’image valant un pixel CSS. Une image étroite étirée à la pleine largeur manque de pixels :
sous 150 ppp à la taille imprimée, une alerte le dit. Les marges et corps viennent de
`pipeline/styles/print.css`, `socle.css` et `livre/normal.css`. Un PDF est pris page
entière : il doit être recadré sur la figure.

**Corps d’un texte.** Dans un SVG (éléments `<text>`) ou un PDF (texte non vectorisé), il
est lu dans le fichier. Dans une image, Tesseract trouve les mots (mode « texte épars », sur
une copie en gris assombrie pour ne pas perdre le gris clair, puis une seconde fois tournée
d’un quart de tour pour les textes verticaux). La hauteur d’encre des minuscules sans hampe
et des capitales est mesurée sur les pixels et convertie en corps (hauteur d’x 0,52 em,
capitale 0,71 em). Sur la figure d’exemple, l’écart avec les tailles exactes du SVG reste
sous 4 % pour les textes droits.

**Statut des textes.** L’OCR n’est pas fiable sur une figure : il manque des textes et en
invente sur les photos. Plutôt que de trancher à sa place, l’outil donne un statut à chaque
texte. Un texte lu dans un SVG ou un PDF est *confirmé*. Un texte de l’OCR est *à vérifier*
dès que l’une de ces raisons se présente : confiance moyenne de l’OCR sous 80
(`CONFIANCE_SURE`) ; deux lettres ou chiffres au plus (`SIGNES_PEU`, « 50 », « 0 % »), avec une
confiance sous 85 (`CONFIANCE_SURE_COURTE`) ; fond bruité (variation du fond, loin des bords
des lettres, au-delà de 0,17 fois l’écart entre texte et fond, `BRUIT_FOND_MAX`, comme dans une
photo) ; texte vertical, avec une confiance sous 90
(`CONFIANCE_SURE_TOURNEE`) ou s’il est court ; sinon il est *confirmé*. Un texte posé par
l’humain est *ajouté*, un texte qu’il écarte est *retiré*. Le verdict, les trois boîtes d’endroits à revoir et l’encadré « figure
trop petite » ne comptent que les textes confirmés et ajoutés. Les textes à vérifier vont
dans une quatrième boîte, chacun avec deux réponses : « C’est bien un texte » le confirme,
« Ce n’est pas un texte » le retire. Un texte retiré disparaît de la figure et des comptes,
mais reste dans l’export.

**Vue résidu.** Dans la vue des textes, l’interrupteur « Masquer les textes reconnus » couvre
d’un masque blanc hachuré chaque texte confirmé, à vérifier ou ajouté. Ce qui reste lisible
sur la figure a été oublié ; un masque posé là où il n’y a pas de texte est une fausse
lecture. Un clic sur un masque ouvre une petite fenêtre (« Ce n’est pas un texte », et
« C’est bien un texte » pour un texte à vérifier). Un rectangle glissé sur une zone non
masquée devient un texte *ajouté*, que l’outil mesure sans le lire : Otsu sépare l’encre du
fond dans le rectangle, et le profil d’encre des rangées donne, par deux paliers de densité,
la hauteur d’x (rangées qui atteignent 0,6 fois la médiane des rangées encrées) et la
hauteur de capitale (du haut de l’encre au bas de la bande dense) ; si la bande dense couvre
85 % de l’encre, le texte n’a que des capitales ou des chiffres. Les hauteurs sont converties
en corps avec les mêmes rapports (0,52 et 0,71 em), le contraste se mesure comme pour tout
texte ; une zone nettement plus haute que large se lit par colonnes (texte vertical). L’OCR
tente ensuite de donner un libellé au découpage, agrandi ; la mesure ne dépend pas de ce
résultat. Sans souris, le bouton « Ajouter une zone au clavier » pose un cadre au centre de
la figure : flèches pour le déplacer (un centième de la figure), Maj + flèches pour le
redimensionner, Entrée pour ajouter, Échap pour annuler ; les textes à vérifier se tranchent
par les boutons de la quatrième boîte, et « Ce n’est pas un texte » est aussi dans la liste
de tous les textes. Sur la figure d’exemple, un texte ajouté à la main sur « Berne » est
mesuré à 9,9 pt, contre 9,65 pt à l’OCR et 9,7 pt d’après le SVG.

**Suggestions.** Une fois les textes connus masqués, une détection d’encre simple cherche
sur le résidu ce qui ressemble encore à du texte, et le propose *à vérifier*, mesuré comme
une zone ajoutée. Sur une copie réduite à 1200 px, un pixel est de l’encre, sombre ou
claire, s’il s’écarte de plus de 40 de la clarté moyenne de son voisinage ; les deux signes
se séparent pour qu’un texte blanc dans une barre ne se soude pas à la barre, et une
composante de la clarté du fond de la figure n’est pas de l’encre. Les composantes
connexes de hauteur plausible (hauteur d’x d’environ 4 pt à capitale d’environ 30 pt), pas
trop allongées et pas pleines (une lettre laisse du fond dans sa boîte ; seul un trait
mince la remplit) sont des signes ; alignés, de hauteurs proches et séparés d’au plus deux
hauteurs, ils forment une ligne, retenue dès deux signes ou un seul signe large comme un
mot. Au plus 30 suggestions, celles qui ont le plus de signes d’abord ; une zone dont le
fond est très bruité (une photo) n’est pas proposée. La copie réduite se dessine depuis la
source, jamais plus large que ses pixels : agrandie, une photo serait lissée et passerait
pour un aplat. Une photo ou une trame n’a pas de fond où chercher : quand plus de 28 % des
pixels bordent un changement (un voisin qui diffère de plus de 16 sur un canal), rien n’est
proposé. Mesuré à la résolution native : de 4 à 15 % sur les graphiques du corpus, 23 % sur
un schéma dense, 31 % sur un camembert tramé, 32 et 43 % sur deux photos. Une photo peu
texturée passe sous le seuil (22 % sur une photo de classe) et reçoit alors des suggestions
jusqu’au plafond : elles ne comptent pas, et chacune se retire d’un clic. Une suggestion
fausse ne coûte qu’un clic : elle ne fait que demander.

**Export.** « Exporter la lecture (JSON) », ou `window.szhFigureCheck.exporter()`, rend la
lecture complète, statuts compris, en pixels de l’image d’origine (pour un SVG, dans ses
unités ; pour un PDF, dans les points de la page), ce qui en fait une vérité de terrain une
fois corrigée par l’humain :

```
{ version: 1,
  figure: { nom, type: 'bitmap'|'svg'|'pdf', largeurPx, hauteurPx },
  reglages: { format: 'revue'|'livre', proportion: 1|0.75|0.5|null, seuilLc: 75|90,
              largeurMm, hauteurMm, pxParMm },          // pxParMm : pixels d’origine par mm imprimé
  verdict: 'ok'|'ameliorer'|'corriger',
  textes: [ { id, texte, boite: { x0, y0, x1, y1 }, exact, statut, origine: 'ocr'|'fichier'|'suggestion'|'humain',
              corpsPt, lc, couleurTexte: '#RRGGBB'|null, couleurFond, niveauTaille, niveauContraste, niveau } ],
  objets: [], series: [],                                // réservés
  diagnosticEnsemble: { total, petits, bas, haut, mediane, facteur } | null }
```

`proportion` vaut `null` pour « Taille du fichier ». `lc` est signé (négatif pour un texte
clair sur fond sombre), comme la mesure.

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
peut échapper à l’OCR ; la vue résidu le montre, et l’humain l’ajoute. La mesure d’une zone
ajoutée suppose une seule ligne de texte droite ou verticale par bande d’encre : un
rectangle qui prend aussi un filet ou une icône est mesuré avec. Les suggestions proposent
volontiers des rangées de points ou de petits symboles alignés ; elles ne lisent rien, et une
photo peut en recevoir plusieurs dizaines (plafond : 30). Le cadre au clavier se déplace par
pas d’un centième de la figure : un petit texte demande quelques frappes. Le « taille
réelle » de l’écran n’est juste qu’après le réglage par carte bancaire ; l’impression à
100 % reste la référence.

## Licence

Code, textes et figure d’exemple : Creative Commons Attribution 4.0 International
(CC BY 4.0, `LICENSE`), SZH/CSPS.

Les polices du dossier `fonts/` (Open Sans semi-condensée) restent sous SIL Open Font
License 1.1 (`fonts/OFL-OpenSans.txt`), la licence de leurs autrices et auteurs.

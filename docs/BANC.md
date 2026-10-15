# Banc d’essai

`outils/banc.mjs` mesure ce que l’outil réussit sur un lot de figures, comparé à une vérité
de terrain écrite à la main. Les textes et les objets sont appariés **par position** (boîtes
en pixels de l’image), pas par chaîne : un découpage différent (« 25 » + « % » contre
« 25 % ») n’est pas un faux texte, un texte lu deux fois n’est pas deux libellés, et ce qui
est mesuré est ce qui compte pour la personne qui relit : le verdict de la figure, les
textes vraiment problématiques, les fausses alertes et l’effort qu’il reste à fournir.

## Lancer

```
node outils/banc.mjs <verite.json> <dossier des figures> [--json resultats.json] [--seulement a,b] [--navigateur chemin]
node outils/banc.mjs <verite.json> --depuis resultats.json          # réévalue un résultat enregistré, sans navigateur
node outils/banc.mjs <verite.json> --sans-navigateur <dossier>      # exports déjà enregistrés, un fichier par figure
node outils/verite-v2.mjs <verite-v1.json> <verite-v2.json>         # convertit une vérité de la version 1
```

- Le dossier des figures est dans ce dépôt : `tmp/<lot>` (non suivi ; la page n’accepte que
  `tmp/`) ou `exemples/` pour les deux figures d’exemple. `fichier` dans la vérité est
  relatif à ce dossier.
- Le banc sert le dépôt sur un port libre, lance Edge sans fenêtre avec
  `--remote-debugging-port=0` et un profil temporaire, charge chaque figure l’une après
  l’autre (`?figure=…&etape=4&vue=textes`, délai 5 minutes), attend `body[data-etat]`, lit le
  résultat, puis ferme Edge et efface le profil.
- `--seulement 1,3` retient des figures par rang (à partir de 1) ou par un morceau de leur
  nom de fichier.
- `--depuis` relit les exports gardés dans le JSON d’un passage précédent (`figures[].export`) ;
  `--sans-navigateur` cherche, pour chaque figure, `<dossier>/<fichier>.json` ou
  `<dossier>/<nom sans extension>.json`, soit l’export lui-même, soit `{ export, duree }`.
- Sur les exemples : `node outils/banc.mjs test/verite-exemples.json exemples`.

## Résultat de l’outil

Le banc lit `await window.szhFigureCheck.exporter()` dans la page :

```
{ version: 1,
  figure: { nom, type: 'bitmap'|'svg'|'pdf', largeurPx, hauteurPx },
  reglages: { format, proportion, seuilLc, largeurMm, hauteurMm, pxParMm },
  verdict: 'ok'|'ameliorer'|'corriger',          // décidé sur les seuls textes confirmés et ajoutés
  verdictProvisoire: bool,                        // verdict « ok » alors que des textes restent à vérifier
  textesAVerifier: n,
  textes: [ { id, texte, boite: { x0, y0, x1, y1 },   // pixels de l'image d'origine
              exact, statut: 'confirme'|'a-verifier'|'ajoute'|'retire', origine,
              confiance, score,                       // lecture Tesseract (0 à 100) et score du détecteur (0 à 1) ; null hors détecteur
              corpsPt, lc, couleurTexte, couleurFond, niveauTaille, niveauContraste, niveau } ],
  objets: [ { id, type: 'rectangle'|'ellipse'|'trait'|'forme'|'degrade', couleur, boite, surfacePct, epaisseurMm, serie, lcFond, wcagFond, niveau } ],
  series: [ { id, couleur, nObjets, typeDominant, lcFond, wcagFond, epaisseurMinMm, niveau, legende } ],
  diagnosticEnsemble }
```

Tant que cette fonction n’existe pas, le banc se replie sur le DOM comme sa version 1 et le
dit (« export absent ») : les textes viennent du tableau de la page, leurs boîtes des cadres
de la figure annotée (marge de 4 px retirée, ramenées des pixels du canevas à ceux de
l’image), tout texte vaut confirmé, le verdict vient du bilan, les séries des couleurs du
graphique ; pas de couleurs de texte, pas de suggestions, et les objets ne sont pas
comparés (la figure est comptée « non comparée » pour la métrique 6). Si l’export annonce
une autre largeur que la vérité, les boîtes sont ramenées à celle de la vérité.

## Vérité de terrain, version 2

Un fichier JSON par lot, hors du dépôt comme les figures. Seule celle des figures d’exemple
est suivie : `test/verite-exemples.json`.

```
{ "version": 2,
  "notes": "…",                                   // facultatif : protocole, réglages
  "figures": [
    { "fichier": "lan119_p2_fig1.png",            // relatif au dossier des figures
      "provenance": "Lanners, article 119, figure 1",
      "type": "bitmap",                            // bitmap | svg | pdf
      "largeurPx": 1787, "hauteurPx": 1151,        // pixels de l'image d'origine ; unités utilisateur d'un SVG
      "verdictAttendu": "ameliorer",               // ok | ameliorer | corriger ; null tant qu'il n'est pas fixé
      "listeComplete": true,                       // false : des textes réels manquent à la liste
      "fond": "#EFF4F7",                           // facultatif
      "textes": [
        { "texte": "55 000",
          "boite": { "x0": 61, "y0": 118, "x1": 128, "y1": 139 },   // null tant que la position n'est pas mesurée
          "corpsPt": 7.96,                         // ou null ; au format et à la largeur du protocole
          "couleurTexte": "#CD3146", "couleurFond": "#EFF4F7",      // ou null
          "dansAplat": false,
          "problematique": true }                  // ce texte doit être signalé
      ],
      "objets": [
        { "type": "rectangle", "couleur": "#E7A8A0", "boite": { "x0": 190, "y0": 342, "x1": 280, "y1": 680 } }
        // type et boite valent null quand ils ne sont pas connus ; surfacePct est facultatif
      ],
      "notes": "…" } ] }
```

Les boîtes sont des bornes d’encre ou de police, en pixels de l’image d’origine ; les deux
conviennent, l’appariement tolérant les écarts de hauteur. Les références (`corpsPt`,
couleurs) valent pour les réglages du protocole, à écrire dans `notes` (format Revue,
pleine largeur, Lc 75 pour les exemples). Un objet est une surface de donnée (barre,
secteur, carré de légende) ; les traits de grille et les axes ne sont listés que si l’on
attend de l’outil qu’il les trouve.

`outils/verite-v2.mjs` convertit un fichier de la version 1 : il réunit les textes des
champs `groupes_de_textes`, `textes_reels` (y compris « même liste que la figure N »),
`textes_reels_transcrits`, `cantons` et `exemples_textes_reels`, leur attribue tailles
(`taille_mesuree_pt`, `taille_typique_pt`), couleurs et Lc (`contrastes_reference`,
`couleur_par_defaut`, `fond_reel`), déduit `problematique` des références (corps sous 8 pt
ou Lc sous 75 ; false sans référence), lit le verdict dans `verdict_attendu` quand la
phrase tranche, et fait des `zones_reelles` (hors fond) des objets sans type ni boîte avec
leur `surfacePct`. Toutes les boîtes valent `null` : l’annotation les complète. Ce que la
version 1 observait de l’outil (manqués, faux textes) passe dans `notes`.

## Appariement par position

Deux boîtes vont ensemble si leur IoU (intersection sur union) atteint **0,3** ou si le
centre de l’une est dans l’autre. Une boîte de l’outil peut couvrir plusieurs textes réels
(une légende lue d’un trait) et un texte réel peut être lu en plusieurs boîtes (mot à mot) :
toutes ces paires comptent. Garde-fou : une boîte de l’outil que les textes réels qu’elle
touche remplissent à moins de **30 %** est trop grande pour eux (trois barres lues comme un
« 111 » qui contient le centre d’une annotation) ; elle ne garde que les paires dont l’IoU
atteint 0,3. Deux boîtes de l’outil qui se recouvrent à plus de **50 %** sur un même texte
sont un texte lu deux fois : la seconde est un doublon. La **couverture** d’un texte réel
est la part de sa boîte que couvrent les boîtes appariées ; sa moyenne par figure dit si
les cadres de l’outil sont entiers ou fragmentaires.

Les textes de l’outil en statut `confirme` ou `ajoute` sont les textes actifs ; ceux en
`a-verifier` sont des suggestions, appariés à part ; ceux en `retire` sont ignorés. Les
objets s’apparient par IoU ≥ 0,3, un pour un, le meilleur recouvrement d’abord ; le type et
la couleur (écart Lab ≤ 6) se comparent ensuite. Quand la vérité n’a pas de boîtes
d’objets (version 1 convertie), ils s’apparient par couleur seule.

## Métriques

Fixées avant les mesures ; ce sont les critères de réussite.

1. **Verdict.** Un verdict « ok » tant que des textes restent à vérifier est *provisoire* : l'outil n'affiche pas de verdict et l'export porte `verdictProvisoire` et `textesAVerifier`, sans changer `verdict`. Le banc compte ces figures à part (« Verdicts provisoires : n/N figure(s) ») ; la classe ci-dessous se juge sur `verdict`. Par figure, verdict obtenu contre `verdictAttendu` : juste, *fausse alerte
   grave* (figure conforme déclarée « à corriger »), *manque grave* (figure à corriger
   déclarée conforme), trop sévère ou trop indulgent sinon. Total de figures justes, et
   les deux pires cas comptés à part. Une figure sans `verdictAttendu` n’est pas évaluable.
2. **Textes problématiques.** Parmi les textes de la vérité marqués `problematique`, la part
   *retrouvée* (appariée à un texte actif), *signalée* (le pire degré des textes appariés
   est « à améliorer » ou « à corriger ») et *au bon degré* : le degré attendu se déduit des
   références du texte avec les seuils de l’outil (corps arrondi au dixième : 8 pt, 6,5 pt ;
   Lc arrondi à l’unité : seuil de l’export, seuil − 15) ; sans référence, signalé suffit.
3. **Fausses alertes.** Textes actifs de degré « à améliorer » ou « à corriger » sans
   correspondant dans la vérité. Complément : *alertes sur des textes conformes*, textes
   appariés à un texte réel non problématique mais signalés quand même.
4. **Effort humain.** Cadres *à ajouter* : textes de la vérité sans correspondant,
   problématiques ou non (dont ceux qu’une suggestion couvre déjà) ; cadres *à retirer* :
   textes actifs sans correspondant, de tout degré, plus les doublons.
5. **Mesures.** Sur les textes appariés qui ont une référence : écart relatif du corps
   (médiane des `corpsPt` appariés / `corpsPt` de référence − 1) et écart du Lc (médiane
   des |lc| appariés − Lc calculé des couleurs de référence). Médiane et moyenne des écarts
   absolus, moyenne signée, maximum, effectif.
6. **Objets.** Objets retrouvés, du bon type, de la bonne couleur, manqués, inventés ;
   séries : couleurs distinctes de la vérité retrouvées parmi les `series` de l’export,
   séries inventées ; sur les figures dont la vérité n’a aucun objet (photos), tout objet ou
   série de l’outil est inventé, et le nombre de ces figures touchées est compté.
7. **Temps.** Durée de chaque figure, du début de la navigation à la fin de l’analyse ;
   total, moyenne et maximum.

**Suggestions.** Les textes `a-verifier` ne sont ni retrouvés ni fausses alertes : leur
nombre et la part qui tombe sur un vrai texte sont donnés à part.

**Liste incomplète.** Une figure avec `listeComplete: false` ne compte que pour le verdict,
les fausses alertes et les objets ; ses fausses alertes sont une borne haute (un texte lu
peut être un texte réel non listé), marquées « ≤ » dans le tableau et comptées à part dans
le total.

**Vérité sans boîtes.** Si aucun texte d’une figure n’a de boîte (version 1 convertie), le
banc ne compare pas ses textes et le dit ; restent le verdict, le temps et les objets par
couleur. Si quelques textes n’ont pas de boîte, les métriques 2, 4 et 5 portent sur ceux
qui en ont, et les fausses alertes deviennent une borne haute.

## Lire le tableau

Une ligne par figure, puis `TOTAL`, puis les totaux en clair.

| Colonne | Sens |
|---|---|
| `verdict` | attendu → obtenu (✓ ok, ! améliorer, ✕ corriger), puis la classe |
| `probl.` | textes problématiques retrouvés / total |
| `degré` | dont signalés au bon degré |
| `f. al.` | fausses alertes (`≤` : borne haute) |
| `sugg.` | suggestions sur un vrai texte / suggestions |
| `+cadres`, `−cadres` | effort humain : cadres à ajouter, à retirer |
| `\|Δpt\|`, `\|ΔLc\|` | écart médian du corps (relatif), écart moyen du Lc |
| `objets`, `inv.` | objets retrouvés / attendus, inventés |
| `s` | durée en secondes |

Sous le tableau, chaque figure qui a quelque chose à dire liste ses problématiques ratés,
fausses alertes, cadres à ajouter (« ! » marque un problématique) et à retirer, objets
manqués et inventés, et les avertissements (export absent, boîtes ramenées, version).

## Sortie JSON

`--json` écrit `{ version: 2, date, verite, total, figures: [ { fichier, duree, erreur,
exportAbsent, avertissements, verdict, textes, objets, export } ] }`. `total` a la forme
que rend `totaliser()` ; `textes` et `objets` détaillent chaque métrique avec les listes
(problématiques et leur degré, fausses alertes, cadres à ajouter et à retirer, écarts).
`export` est le résultat brut de l’outil, ce qui permet `--depuis`.

## Tests

`test/banc.test.mjs` éprouve la géométrie, l’appariement (un pour un, légende lue d’un
trait, texte lu mot à mot, fragment, boîte géante, doublon, boîtes absentes), les degrés
attendus, les classes de verdict, les métriques d’une figure synthétique, les cas liste
incomplète, vérité sans boîtes et figure sans texte, les objets (IoU, couleur seule,
photo), la mise à l’échelle de l’export, les totaux et le tableau, et la conversion v1 → v2.

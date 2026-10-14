# Prompt : application Google Apps Script « Buffer AJU Frames »

## 1. Objectif

Crée une **web app Google Apps Script autonome** qui visualise en temps réel les **niveaux du buffer AJU Frames** (ligne Frames, Airbus Atlantic) : une ligne par bloc de référence avec une jauge mini / maxi / capacité, la zone de **débord**, et les pièces **à venir**. La vue doit être **synthétique, lisible en 5 secondes**, avec des indicateurs globaux, des filtres, un visuel très parlant, et la **charte graphique Airbus** (section 7).

Tous les fichiers de référence sont dans le dossier de travail : lis-les avant de coder.
- `Pilotage Ferrure_PC FRAME.xlsx` : copie locale du Google Sheet source n°1. Onglets utiles : `ZZ84`, `DATA Poste`, `Tableau de bord`, `AJU`, `liste références`.
- `Dimensionnement Buffer ZINC.xlsx` : copie locale du Google Sheet source n°2. Onglet utile : `L1`.
- `07_Tableau_pilotage_buffer_V1_2026-10-13.pdf` : tableau magnétique A1 du buffer (logique ROUGE / VERT / PLEIN, regroupement par flux, mise en page de référence).
- `01_Presentation_chantier_buffer_frames_V2_2026-10-11.pptx` et `03_Guide_animateur…pdf` : contexte du chantier et charte graphique.
- `IMG_2521.jpeg` : croquis du tableau blanc (une ligne par réf : « Pré-dispo F07 » à gauche, AJU avec repères Mini et Max, Débord à droite).

Les fichiers Excel servent uniquement à comprendre la structure et à tester. **L'appli lit les Google Sheets** :

| Source | Spreadsheet ID |
|---|---|
| Pilotage_Ferrure_PC Frame | `1GXpxmUtseSCqkyI6hznbxlMjcb7RoEDe5GSPcjP2pnk` |
| Dimensionnement Buffer ZINC | `1_Je8iKhNsuKBq5pAXVqb7tPPa49luDxu6XNbmKns9PQ` |

Ces deux sources sont en **lecture seule** : l'appli n'y écrit jamais.

## 2. Règles métier (impératives)

### 2.1 Statut des pièces (onglet `ZZ84` du fichier Pilotage)
- `ZZ84` est une extraction SAP collée à la main. En-têtes en ligne 3, données à partir de la ligne 7. Des lignes d'en-têtes se répètent (sauts de page, par ex. la valeur `Pos.trav` dans la colonne M) : il faut les filtrer. La date et l'heure d'extraction sont en `F1` / `G1` : affiche-les dans l'en-tête de l'appli (« Données SAP du … à … »).
- Colonnes : `C` Opér, `D` Ordre (n° OF), `E` Article (réf), `J` Désignation, `M` Pos.trav (poste), `N` Qté OF (**la quantité à sommer**), `P` Age Pos (jours au poste), `Q` N° série. Repère les colonnes par leur en-tête plutôt que par leur lettre, pour résister à un décalage de colonne.
- Le poste donne le statut via l'onglet `DATA Poste` (colonne C = poste, colonne D = statut). Lis cet onglet dynamiquement. En secours, utilise la table codée en dur suivante :
  - **BUFFER** = `37SBEL1` (« Entrée BUFFER L1 G19 ») : pièce **classée en buffer mais PAS encore dans le buffer AJU Frames**. Affichage : colonne « **À venir** ».
  - **AJU** = `53B0223`, `53B0225`, `37S0223`, `37S0225` : pièce **dans le buffer AJU Frames**. C'est le **niveau du buffer**.
  - Tous les autres postes (CHAUDRO, CONSTIT, SERVITUDE, APPAIRAGE, PERCAGE…) sont ignorés.
- Toutes les pièces au poste AJU comptent comme présentes dans le buffer (pas d'exclusion « AJU en cours »).
- C'est la logique du `Tableau de bord` : `SUMIF(ZZ84!S, ref&"AJU", ZZ84!N)`. **Mais le Tableau de bord oublie les POSMOD et les nouvelles réfs**, alors que l'appli doit les compter (section 2.2).

### 2.2 Blocs et correspondance des références (point critique)
- **1 bloc = 1 emplacement physique, côté D et côté G séparés** (comme le tableau A1). Exemple : « C42 AV G – A321 ACF ».
- Plusieurs réfs SAP alimentent le même bloc : réf standard, POSMOD, nouvelle réf. Le niveau du bloc est la **somme de toutes ses réfs**. Le détail par réf s'affiche **en dépliant la ligne**.
- La correspondance est stockée dans un onglet **`Mapping_Refs`** du classeur Paramètres (section 4), **modifiable depuis l'appli**. Pré-remplis-la avec cette table :

| Prog. | Version | Bloc | Flux | Réf L1 (capacité) | Autres réfs ZZ84 rattachées |
|---|---|---|---|---|---|
| A320 | NEO/CEO | C36 AV G | Amboise | D571.30067.206.02 | D571.32444.200.00 (POSMOD) |
| A320 | NEO/CEO | C36 AV D | Amboise | D571.30067.207.02 | D571.32444.201.00 (POSMOD) |
| A320 | NEO/CEO | C36 AR G | M5 | D571.30068.200.02 | D571.32445.200.00 (POSMOD) |
| A320 | NEO/CEO | C36 AR D | M5 | D571.30068.201.02 | D571.32445.201.00 (POSMOD) |
| A320 | NEO/CEO | C42 AV G | Amboise | D571.30287.200.02 | D571.32209.200.00 ; D571.30422.200.00 (CJ, à confirmer) |
| A320 | NEO/CEO | C42 AV D | Amboise | D571.30287.201.03 | D571.32209.202.00 |
| A320 | NEO/CEO | C42 AR G | T5X→H5 | D571.30410.200.00 | D571.32210.200.40 ; E571.11161.200.00 |
| A320 | NEO/CEO | C42 AR D | T5X→H5 | D571.30410.201.00 | D571.32210.202.40 ; E571.11161.202.00 |
| A321 | ACF | C36 AV G | Amboise | D571.34310.200.01 | E571.11135.200.00 (POSMOD) |
| A321 | ACF | C36 AV D | Amboise | D571.34310.201.01 | E571.11135.201.00 (POSMOD) |
| A321 | ACF | C36 AR G | M5 | D571.34311.200.01 | E571.11136.200.00 (POSMOD) |
| A321 | ACF | C36 AR D | M5 | D571.34311.201.01 | E571.11136.201.00 (POSMOD) |
| A321 | ACF | C42 AV G | M5 | D571.34312.200.01 | – |
| A321 | ACF | C42 AV D | M5 | D571.34313.200.01 | – |
| A321 | ACF | C42 AR G | T5X→H5 | D571.34314.200.01 | E571.11163.200.01 |
| A321 | ACF | C42 AR D | T5X→H5 | D571.34319.200.01 | E571.11165.200.01 |
| A321 | XLR | C42 AV G | M5 | D571.34812.202.00 | – |
| A321 | XLR | C42 AV D | M5 | D571.34813.202.00 | – |
| A321 | XLR | C42 AR G | T5X→H5 | D571.34814.200.00 | – |
| A321 | XLR | C42 AR D | T5X→H5 | D571.34819.200.00 | – |
| A330 | NEO | C40 AV G | M5 | F571.16770.200.00 | – |
| A330 | NEO | C40 AV D | M5 | F571.16770.201.00 | – |
| A330 | CEO | C40 AV G | M5 | F571.12887.200.01 | – |
| A330 | CEO | C40 AV D | M5 | F571.12887.201.01 | – |
| A330 | COMMUN | C40 AR G | V4 | F571.12262.202.01 | – |
| A330 | COMMUN | C40 AR D | V4 | F571.12262.203.01 | – |
| A330 | NEO/CEO | C47 G | M5 | F571.12994.200.00 | – |
| A330 | NEO/CEO | C47 D | M5 | F571.12994.201.00 | – |

- Les rattachements E571.11161 / 11163 / 11165, D571.32210 et CJ D571.30422 sont des **hypothèses** déduites des désignations. Signale-les comme telles dans `Mapping_Refs` (colonne « À valider »).
- Toute réf trouvée dans ZZ84 aux postes BUFFER ou AJU mais **absente du mapping** doit remonter dans un bandeau d'alerte « Réfs non rattachées (n pièces) ». Un clic permet de la rattacher à un bloc. Aucune pièce ne doit disparaître sans qu'on le voie.
- L1 contient des doublons : F571.12262.202.01 et .203.01 apparaissent en LR COMMUN **et** en LR NEO. Garde la ligne LR COMMUN et ignore l'autre, sans planter.

### 2.3 Capacité, mini, maxi
- **Capacité par défaut** = valeur de l'onglet `L1` (fichier Dimensionnement) pour la réf L1 du bloc, avec `Buffer` = `L1 FRAME`. Colonnes : `A` réf, `B` désignation, `C` assemblage, `D` famille, `E` moyen d'usinage, `F` buffer, `G` poste, `H` lot fixe, `I` qté avion. Les colonnes `J`/`K`/`L`/`M` correspondent aux années **2024 / 2025 / 2026-2028 / 2028+**. Un **sélecteur d'année** global dans l'appli choisit la colonne (défaut : 2026-2028).
- **Unité** : les valeurs L1 sont *a priori* des **pièces**, mais l'unité reste **paramétrable** (global, avec possibilité de surcharger par bloc) : « pièces » ou « emplacements ». Conversion : **AV = 1 pièce par emplacement, AR (C36 AR et C42 AR) = 2 pièces par emplacement** (nb : le PPT indique à tort « C36 = 2 pièces »). La jauge affiche toujours des pièces, et l'info-bulle donne aussi l'équivalent en emplacements.
- **Maxi par défaut** = capacité L1. **Mini par défaut** = un pourcentage global réglable de la capacité (défaut 25 %, arrondi au supérieur, au moins 1).
- L'utilisateur peut **modifier mini, maxi et capacité de chaque bloc depuis l'appli** (stepper +/- ou saisie directe, contrôle `0 ≤ mini ≤ maxi ≤ capacité`, avec « Réinitialiser aux valeurs L1 »). Il peut aussi faire des **modifications en masse** sur la sélection filtrée (ex. « tous les A321 C42 AR : mini 4 »). Les valeurs sont enregistrées dans le classeur Paramètres, donc **partagées par tous les utilisateurs**.

### 2.4 Statut d'un bloc (cohérent avec le tableau A1)
- `AJU` = pièces dans le buffer, `À venir` = pièces au statut BUFFER.
- **ROUGE** si AJU < mini : priorité de production ou d'appel.
- **VERT** si mini ≤ AJU < maxi.
- **PLEIN** (gris foncé) si maxi ≤ AJU ≤ capacité : on n'appelle plus.
- **DÉBORD** si AJU > capacité. L'excédent `max(0, AJU − capacité)` part au débord.
- Projection en pointillé : `AJU + À venir`, pour montrer si le bloc va repasser au-dessus du mini ou partir en débord.

### 2.5 Débord
- Débord total = Σ des excédents des blocs (sur les blocs filtrés, et en global).
- **Capacité du débord : 35 places par défaut, modifiable depuis l'appli** (paramètre global, avec l'historique de qui l'a changé et quand).
- Visuel : une grille de N cases (N = capacité courante), remplie par des pastilles à la couleur de la famille, triées par ancienneté (FIFO). Seuils d'alerte paramétrables (défaut : ≤ 50 % normal, 50–80 % vigilance, > 80 % escalade, > 100 % saturé).
- Au-delà de 100 %, les pièces en trop sont « hors zone » : affiche-les en rouge.

## 3. Interface (soigne particulièrement l'UI/UX)

1. **En-tête** : bandeau navy, titre « Buffer AJU Frames », mention « ATLANTIC » et le libellé de classification « Airbus Amber » en orange (comme dans les supports), horodatage des données SAP, bouton **Actualiser** et sélecteur d'année L1.
2. **Bandeau de KPI**, de grands chiffres lisibles de loin :
   - taux de remplissage du buffer AJU (pièces AJU / Σ capacités) ;
   - nombre de blocs **ROUGE** (cliquer filtre sur ces blocs) ;
   - nombre de blocs **PLEIN** ;
   - **Débord x / 35** avec une mini-jauge ;
   - nombre de pièces **à venir** ;
   - âge de la pièce la plus ancienne dans le buffer ;
   - réfs non rattachées (seulement s'il y en a).
   Chaque KPI se décline aussi **par type (A320 / A321)**.
3. **Filtres** (en puces, combinables, gardés dans l'URL et en localStorage) : programme (A320 / A321 / A330, avec **A330 masqué par défaut** et activable), version (NEO/CEO, ACF, XLR, CJ), cadre (C36 / C42 / C40 / C47), AV / AR, côté D / G, flux (Amboise / M5 / T5X→H5 / V4), statut (Rouge / Vert / Plein / Débord), recherche libre sur réf ou désignation. Prévois aussi un tri : par criticité (défaut), par bloc ou par taux de remplissage.
4. **Vue principale, une ligne par bloc** (inspirée du tableau blanc), groupée par programme puis par flux comme le tableau A1 :
   `[À venir n] | nom du bloc + version + puce flux | jauge horizontale | [Débord +n] | âge max`
   - Jauge : **une case par pièce** jusqu'à la capacité, cases pleines pour les pièces AJU, cases en pointillé pour la projection « à venir ». Un **repère rouge au mini**, un **repère vert au maxi**, et une fin de piste nette à la capacité. Les pièces en excès débordent dans la colonne Débord.
   - Couleur de la ligne selon le statut, avec la bande de couleur de la famille déjà utilisée sur le terrain (C42 vert/bleu, C36 rose/orange) sur le bord gauche.
   - Un clic sur la ligne la déplie : détail par réf (standard / POSMOD / nouvelle réf), liste des OF (n° OF, qté, âge, opération, n° série) et réglages mini/maxi/capacité.
   - Pas de scroll horizontal. En mobile ou tablette, la jauge reste lisible.
5. **Vue Débord** : la grille de la section 2.5.
6. **Âge / FIFO** : âge max par bloc (colonne `P` de ZZ84), badge orange si une pièce a plus de 2 jours (seuil paramétrable), et dans le débord, la pièce la plus ancienne mise en évidence.
7. **Mode écran TV** (`?mode=tv`) : plein écran, police agrandie, pas de contrôles d'édition, rafraîchissement automatique toutes les X minutes (paramétrable, défaut 5), alternance KPI + A320 / A321 + débord.
8. **Historique** : un déclencheur horaire (time-driven trigger) prend chaque jour, à des heures paramétrables (défaut 6 h et 13 h 30, prises de poste), une photo des niveaux par bloc et du débord dans l'onglet `Historique`. L'appli affiche une courbe d'évolution (taux de remplissage, débord, nombre de rouges) et une sparkline par bloc.
9. **Export / impression** : feuille de style d'impression A4 / A3 paysage propre, et export PDF de la vue filtrée (génération côté serveur ou `window.print`).
10. États vides, chargement (skeletons) et messages d'erreur clairs, par exemple « Onglet ZZ84 introuvable » ou « Pas d'accès au fichier X ». Accessibilité : contrastes AA, et le statut ne doit jamais être porté par la seule couleur (icône ou texte en plus).

## 4. Architecture technique

- **Projet Apps Script autonome**, déployé en **web app** (exécution en tant que *moi*, accès au domaine). Fichiers : `appsscript.json`, `Code.gs` (doGet, routage), `Data.gs` (lecture et agrégation), `Params.gs` (CRUD des paramètres), `History.gs` (triggers), `Setup.gs`, plus `Index.html`, `Styles.html`, `App.js.html` (inclus via `HtmlService.createTemplateFromFile` et `include()`).
- **Classeur Paramètres dédié**, créé par `setup()` au premier lancement, dont l'ID est stocké dans `PropertiesService.getScriptProperties()`. Onglets : `Parametres_Globaux` (capacité du débord, année L1, unité, % mini par défaut, seuils, délai de rafraîchissement TV, heures de photo), `Parametres_Blocs` (bloc, programme, version, côté, AV/AR, cadre, flux, capacité, unité, mini, maxi, actif, surcharge oui/non), `Mapping_Refs`, `Historique`, `Journal` (qui, quand, quoi, ancienne et nouvelle valeur, via `Session.getActiveUser().getEmail()`).
- Lecture des sources via `SpreadsheetApp.openById(...).getSheetByName(...).getDataRange().getValues()` (un seul appel par onglet). Les IDs sont en constantes dans `Code.gs`.
- Une seule fonction serveur `getDashboardData()` renvoie un JSON complet (blocs, KPI, débord, alertes, horodatage). Mets-le en cache 2 min avec `CacheService` (le bouton Actualiser le vide). Les écritures passent par `saveBlockParams()` et `saveGlobalParams()`, protégées par `LockService`.
- Front-end en vanilla JS (aucun framework imposé). Bibliothèque de graphiques uniquement pour l'historique (Chart.js depuis cdnjs, version figée). Le rendu des jauges se fait en HTML/CSS ou en SVG.
- Le code doit résister aux variations de l'extraction : espaces, retours ligne dans les réfs (ex. `'Ferrure AR G C42\n'`), nombres stockés en texte, lignes vides. Normalise les réfs avec trim et majuscules avant toute comparaison.

## 5. Contrôle de validité (extraction ZZ84 du 14/10/2026 à 04:41, fichiers locaux)

Pour tester, reproduis le calcul en local en Python sur les fichiers `.xlsx`. Avec le mapping ci-dessus, tu dois retrouver **AJU / À venir** par bloc :

| Bloc | AJU | À venir | | Bloc | AJU | À venir |
|---|---|---|---|---|---|---|
| A320 C36 AV G | 3 | 9 | | A321 ACF C36 AV G | 9 | 4 |
| A320 C36 AV D | 9 | 0 | | A321 ACF C36 AV D | 8 | 6 |
| A320 C36 AR G | 4 | 0 | | A321 ACF C36 AR G | 12 | 8 |
| A320 C36 AR D | 4 | 0 | | A321 ACF C36 AR D | 12 | 8 |
| A320 C42 AV G | 1 (CJ) | 4 | | A321 ACF C42 AV G | 6 | 0 |
| A320 C42 AV D | 0 | 4 | | A321 ACF C42 AV D | 4 | 0 |
| A320 C42 AR G | 0 | 2 | | A321 ACF C42 AR G | 3 | 4 |
| A320 C42 AR D | 1 | 2 | | A321 ACF C42 AR D | 13 | 4 |
| A321 XLR C42 AV G | 10 | 0 | | A321 XLR C42 AR G | 0 | 1 |
| A321 XLR C42 AV D | 6 | 0 | | A321 XLR C42 AR D | 0 | 1 |

Totaux A320 + A321 : **AJU = 105, À venir = 57**. A330 : AJU = 6 (C40 AR G 2, C40 AV G 2, C40 AV D 2). Les données Google Sheets en ligne peuvent avoir changé : ces chiffres servent seulement à valider la logique.

## 6. Livrables attendus

1. Le code complet, fichier par fichier, prêt à coller dans l'éditeur Apps Script, avec `appsscript.json` (scopes, timezone `Europe/Paris`, webapp).
2. Un `README.md` en français : création du projet, exécution de `setup()`, autorisations, déploiement de la web app, installation des triggers, mise à jour de ZZ84, modification du mapping.
3. Le script Python de contrôle de la section 5 et son résultat.
4. **Avant de coder**, présente en quelques lignes ton plan et une maquette ASCII de l'écran principal. Ensuite, code tout.

## 7. Charte graphique Airbus (tirée du PPT et des PDF joints)

- Couleurs : **navy `#00205B`** (bandeaux, titres), **bleu `#005587`**, **teal `#0085AD`** (sur-titres, accents), **vert `#84BD00`** (OK / VERT), **rouge `#E4002B`** (ROUGE / alertes), **orange `#FE5000`** (vigilance, libellé « Airbus Amber »), gris `#859199` (texte secondaire, PLEIN), fonds `#F2F4F5` et `#E8EFF5`, texte `#1A1A1A`, blanc `#FFFFFF`.
- Typo : Arial / Helvetica (la police des supports), titres en gras navy, sur-titres en capitales teal.
- Style sobre et industriel : en-têtes de section en bandeaux navy avec texte blanc (comme les sections « 1 BLOCS DE RÉFÉRENCE » du tableau A1), cartes à fond gris clair, coins peu arrondis, aucune ombre lourde. Mot-symbole « AIRBUS » en navy gras en bas à droite (texte stylé, aucun logo téléchargé depuis Internet).
- Définis les couleurs en variables CSS et prévois un thème sombre pour le mode TV.

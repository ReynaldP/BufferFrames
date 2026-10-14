# Buffer AJU Frames : web app Google Apps Script

Visualisation en temps réel des niveaux du buffer AJU Frames (ligne Frames, Airbus Atlantic). L'écran montre, pour chaque bloc, une jauge mini / maxi / capacité, la zone de débord, les pièces à venir, les KPI, l'historique et un mode écran TV.

Les deux Google Sheets sources (Pilotage_Ferrure_PC Frame et Dimensionnement Buffer ZINC) sont **lus uniquement**. L'appli n'y écrit jamais. Tous les réglages vont dans un classeur **Paramètres** dédié, créé par `setup()`.

```
apps-script/          code à coller dans l'éditeur Apps Script
  appsscript.json     manifeste (scopes, fuseau Europe/Paris, web app)
  Code.gs             constantes (IDs des sources), doGet, utilitaires, cache
  Data.gs             lecture ZZ84 / DATA Poste / L1, agrégation, statuts, débord, KPI → getDashboardData()
  Params.gs           lecture/écriture des paramètres → saveBlockParams(), saveGlobalParams(), saveMapping(), getJournal()
  History.gs          photos planifiées → takeSnapshot(), installTriggers(), getHistoryData()
  Setup.gs            setup() : création du classeur Paramètres et du mapping par défaut
  Index.html          page (template)
  Styles.html         charte Airbus, thème TV sombre, impression A4/A3
  App.js.html         front-end (vanilla JS)
controle/
  controle_buffer.py  contrôle Python de la section 5 sur les .xlsx locaux
  resultat_controle.txt
  banc_gas.js         banc Node : exécute le vrai code .gs avec des services Google simulés
  resultat_banc_gas.txt
  build_preview.js    prévisualisation locale du front (sans Google)
```

---

## 1. Créer le projet

1. Ouvrir <https://script.google.com>, puis **Nouveau projet**. Le nommer « Buffer AJU Frames ».
2. **Paramètres du projet** (roue dentée) : cocher **Afficher le fichier manifeste « appsscript.json » dans l'éditeur**.
3. Dans l'éditeur, créer les fichiers suivants et y coller le contenu de `apps-script/`. Les noms doivent être **exacts**, car l'éditeur ajoute lui-même l'extension.

| Type dans l'éditeur | Nom à saisir | Contenu |
|---|---|---|
| (existant) | `appsscript.json` | `appsscript.json` |
| Script | `Code` | `Code.gs` (remplace le `Code.gs` vide) |
| Script | `Data` | `Data.gs` |
| Script | `Params` | `Params.gs` |
| Script | `History` | `History.gs` |
| Script | `Setup` | `Setup.gs` |
| HTML | `Index` | `Index.html` |
| HTML | `Styles` | `Styles.html` |
| HTML | `App.js` | `App.js.html` (le fichier doit s'appeler **App.js**, l'éditeur affiche `App.js.html`) |

> Option : avec [clasp](https://github.com/google/clasp), `clasp create --type standalone --rootDir apps-script` puis `clasp push` envoie tout le dossier.

Les IDs des sources sont en tête de `Code.gs` (`SOURCE_PILOTAGE_ID`, `SOURCE_DIM_ID`). Le compte qui déploie doit avoir **au moins un accès en lecture** aux deux fichiers.

## 2. Lancer `setup()` et accepter les autorisations

1. Dans la liste des fonctions, choisir **`setup`**, puis **Exécuter**.
2. Google demande d'autoriser :
   - **Google Sheets** : lire les sources, créer et modifier le classeur Paramètres ;
   - **Exécuter des scripts quand vous n'êtes pas là** : déclencheurs horaires de l'historique ;
   - **Adresse e-mail** : nom de l'utilisateur dans le Journal.
3. Le journal d'exécution affiche l'URL du classeur **« Buffer AJU Frames – Paramètres »**, créé dans votre Drive. Son ID est stocké dans les propriétés du script (`PARAMS_SPREADSHEET_ID`).

Le classeur contient :

| Onglet | Rôle |
|---|---|
| `Parametres_Globaux` | capacité du débord (35), année L1 (2026-2028), unité (pièces), % mini (25), seuils du débord (50 / 80), seuil d'âge (2 j), rafraîchissement TV (5 min), rotation TV (20 s), heures de photo (06:00;13:30), avec qui et quand |
| `Parametres_Blocs` | les 28 blocs (programme, version, bloc, cadre, AV/AR, côté, flux, réf L1, capacité, unité, mini, maxi, actif, surcharge) |
| `Mapping_Refs` | réf SAP → bloc, type (STANDARD / POSMOD / NOUVELLE / CJ), colonne **À valider** |
| `Historique` | photos des niveaux (lignes KPI par périmètre et lignes BLOC) |
| `Journal` | qui, quand, quoi, ancienne et nouvelle valeur |

Dans `Parametres_Blocs`, une cellule **Capacité / Mini / Maxi vide signifie « valeur par défaut »**. Les défauts sont : capacité L1, maxi = capacité, mini = % de la capacité arrondi au supérieur (au moins 1). « Réinitialiser aux valeurs L1 » vide simplement ces cellules.

`setup()` peut être relancé sans risque : il recrée seulement les onglets manquants, sans toucher aux données existantes.

## 3. Installer les déclencheurs de l'historique

Choisir **`installTriggers`**, puis **Exécuter**. La fonction crée un déclencheur quotidien par heure listée dans `heures_photo` (défaut 06:00 et 13:30, les prises de poste). Apps Script exécute un déclencheur à ± 15 min de l'heure demandée.

- Si les heures sont modifiées depuis l'onglet Réglages de l'appli, les déclencheurs sont réinstallés automatiquement.
- `removeTriggers` supprime tous les déclencheurs de l'historique.
- Le bouton **📷 Prendre une photo maintenant** (onglet Historique) ajoute une photo immédiate.

## 4. Déployer la web app

1. **Déployer**, puis **Nouveau déploiement**, type **Application Web**.
2. **Exécuter en tant que : Moi**. **Qui a accès : tous les utilisateurs du domaine** (déjà prévu dans le manifeste : `USER_DEPLOYING` / `DOMAIN`).
3. Copier l'URL `…/exec` et la partager.
   - Écran TV : ajouter `?mode=tv` à l'URL. On obtient le plein écran (clic sur l'écran), le thème sombre, aucun contrôle d'édition, un rafraîchissement toutes les 5 min et la rotation **KPI + A320 → KPI + A321 → Débord**. La taille du texte s'adapte pour que chaque écran tienne sans défilement.
   - Les filtres sont conservés dans l'URL : un lien comme `…/exec?prog=A321&cadre=C42&st=ROUGE` peut être mis en favori.
4. Après une modification du code : **Gérer les déploiements**, ✎, **Version : nouvelle version**. L'URL ne change pas.

> Le domaine : « tous les utilisateurs du domaine » n'existe qu'avec un compte Google Workspace (compte Airbus). Avec un compte gmail.com personnel, il faut choisir « Moi uniquement » ou « Tous les utilisateurs disposant d'un compte Google ». Dans ce dernier cas, l'e-mail des visiteurs n'apparaît pas toujours dans le Journal.

## 5. Mettre à jour ZZ84

Coller la nouvelle extraction SAP dans l'onglet `ZZ84` du fichier Pilotage, **comme aujourd'hui** :

- en-têtes en ligne 3 (`Opér`, `Ordre`, `Article`, `Désignation`, `Pos.trav`, `Qté OF`, `Age Pos`, `N° série`), date d'extraction en **F1**, heure en **G1** ;
- l'appli repère les colonnes **par leur en-tête**, donc un décalage de colonne ne casse rien ;
- les en-têtes répétés (sauts de page), les lignes vides, les nombres stockés en texte et les retours ligne dans les réfs sont filtrés ou normalisés.

Ensuite, cliquer **⟳ Actualiser** dans l'appli. Le bouton vide le cache (2 min) et relit les Google Sheets. Sans ce clic, une page ouverte ou rechargée plus de 2 min après la dernière lecture relit aussi les sources. Le mode TV se recharge seul toutes les 5 min.

Statut des postes : lu dans `DATA Poste` (colonne C = poste, colonne D = statut `Buffer` ou `AJU`). Si l'onglet est absent ou incomplet, l'appli utilise la table de secours (`37SBEL1` = BUFFER ; `53B0223`, `53B0225`, `37S0223`, `37S0225` = AJU) et affiche un avertissement.

## 6. Modifier le mapping des réfs

- **Depuis l'appli**, onglet **Réglages**, section *Mapping des réfs* : changer le bloc, le type, la version ou « à valider » d'une réf, ajouter une réf, ou retirer un rattachement (×).
- **Réfs non rattachées** : toute réf présente aux postes BUFFER / AJU mais absente du mapping déclenche un bandeau orange et un KPI « Réfs non rattachées (n pièces) ». Le bouton **Rattacher à un bloc** ouvre la liste : choisir un bloc, puis **Rattacher**. Aucune pièce ne disparaît sans qu'on le voie.
- **Directement dans le classeur** `Mapping_Refs` : une ligne par réf (`Réf`, `Bloc ID`, `Type`, …). Le `Bloc ID` doit exister dans `Parametres_Blocs`. Cliquer ensuite sur Actualiser.
- La réf L1 d'un bloc (celle qui porte la capacité) se change dans `Parametres_Blocs`, colonne `Réf L1`.

Mini, maxi et capacité se règlent en dépliant une ligne (stepper ou saisie, contrôle `0 ≤ mini ≤ maxi ≤ capacité`). Pour plusieurs blocs à la fois : **✎ Modifier la sélection** applique la modification à tous les blocs filtrés, avec un aperçu, et ignore les blocs qui deviendraient incohérents. Tout est partagé entre les utilisateurs et tracé dans `Journal`.

## 7. Points à valider sur le terrain

Ces points sont relevés dans les données du 14/10/2026 :

1. **Hypothèses de rattachement** marquées « À valider » (7 réfs) : CJ `D571.30422.200.00` → A320 C42 AV G ; `D571.32210.200.40` / `.202.40` et `E571.11161.200.00` / `.202.00` → A320 C42 AR G / D ; `E571.11163.200.01` → A321 C42 AR G ; `E571.11165.200.01` → A321 C42 AR D.
2. **A321 XLR C42 AV G / D** : la capacité L1 vaut **2**, alors que 10 et 6 pièces sont en AJU. Ces deux blocs envoient 12 pièces au débord (15 au total avec A320 C36 AV D). Il faut soit corriger le dimensionnement, soit saisir une capacité réelle dans l'appli.
3. **A330 CEO C40 AV G / D** : capacité L1 = **0** (« Capacité 0 » sur la jauge). Désactiver ces blocs (`Actif = NON`) s'ils n'existent plus.
4. **Unité L1** : supposée en pièces. Si elle est en emplacements, passer `unite` à « emplacements » (AR = 2 pièces / emplacement).

## 8. Contrôles locaux (sans Google)

```bash
# Contrôle de la section 5 (AJU / À venir par bloc, totaux 105 / 57, A330 = 6)
python controle/controle_buffer.py                    # → controle/resultat_controle.txt
# Banc du vrai code Apps Script avec services simulés (62 vérifications)
python controle/controle_buffer.py --json sheets.json
node controle/banc_gas.js sheets.json demo.json       # → controle/resultat_banc_gas.txt
# Prévisualisation du front dans un navigateur
node controle/build_preview.js demo.json .            # → preview_app.html, preview_tv.html
```

Si un `.xlsx` est verrouillé (ouvert dans Excel ou en synchro OneDrive), le script Python travaille sur une copie temporaire.

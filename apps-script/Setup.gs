/**
 * Setup.gs : création (ou réparation) du classeur Paramètres.
 * À lancer une fois depuis l'éditeur : setup().
 * Idempotent : un nouvel appel recrée seulement les onglets manquants, sans écraser les données.
 */

var SH_GLOBAUX = 'Parametres_Globaux';
var SH_BLOCS = 'Parametres_Blocs';
var SH_MAPPING = 'Mapping_Refs';
var SH_HISTO = 'Historique';
var SH_JOURNAL = 'Journal';

var HEAD_GLOBAUX = ['Clé', 'Valeur', 'Libellé', 'Modifié par', 'Modifié le'];
var HEAD_BLOCS = ['Bloc ID', 'Programme', 'Version', 'Bloc', 'Cadre', 'AV/AR', 'Côté', 'Flux', 'Réf L1',
  'Capacité', 'Unité', 'Mini', 'Maxi', 'Actif', 'Surcharge', 'Ordre', 'Rack'];
var HEAD_MAPPING = ['Réf', 'Bloc ID', 'Type', 'Version réf', 'À valider', 'Commentaire', 'Modifié par', 'Modifié le'];
var HEAD_HISTO = ['Horodatage', 'Type', 'Clé', 'Libellé', 'AJU', 'À venir', 'Capacité', 'Mini', 'Maxi',
  'Statut', 'Excédent', 'Remplissage %', 'Débord total', 'Nb rouges'];
var HEAD_JOURNAL = ['Horodatage', 'Utilisateur', 'Objet', 'Champ', 'Ancienne valeur', 'Nouvelle valeur'];

/** Paramètres globaux par défaut : [clé, valeur, libellé]. */
var DEFAULT_GLOBALS = [
  ['debord_capacite', 35, 'Capacité de la zone de débord (places)'],
  ['annee_l1', '2026-2028', 'Colonne d\'année L1 utilisée pour les capacités (2024 / 2025 / 2026-2028 / 2028+)'],
  ['unite', 'pieces', 'Unité des valeurs L1 : pieces ou emplacements (AV = 1 pc/empl., AR = 2 pcs/empl.)'],
  ['mini_pct', 25, 'Mini par défaut en % de la capacité (arrondi au supérieur, au moins 1)'],
  ['debord_seuil_vigilance', 50, 'Débord : au-delà de ce % → vigilance'],
  ['debord_seuil_escalade', 80, 'Débord : au-delà de ce % → escalade (au-delà de 100 % → saturé)'],
  ['age_seuil_jours', 2, 'Âge (jours au poste) au-delà duquel une pièce est signalée'],
  ['tv_refresh_min', 5, 'Mode TV : rafraîchissement des données (minutes)'],
  ['tv_rotation_s', 20, 'Mode TV : durée d\'affichage de chaque écran (secondes)'],
  ['heures_photo', '06:00;13:30', 'Heures des photos quotidiennes de l\'historique (séparées par ;)']
];

/**
 * Blocs par défaut : [prog, version, bloc, flux, réf L1, autres réfs].
 * Autres réfs : [réf, type, version réf, à valider, commentaire].
 */
var DEFAULT_BLOCKS = [
  ['A320', 'NEO/CEO', 'C36 AV G', 'Amboise', 'D571.30067.206.02', [['D571.32444.200.00', 'POSMOD', '', false, '']]],
  ['A320', 'NEO/CEO', 'C36 AV D', 'Amboise', 'D571.30067.207.02', [['D571.32444.201.00', 'POSMOD', '', false, '']]],
  ['A320', 'NEO/CEO', 'C36 AR G', 'M5', 'D571.30068.200.02', [['D571.32445.200.00', 'POSMOD', '', false, '']]],
  ['A320', 'NEO/CEO', 'C36 AR D', 'M5', 'D571.30068.201.02', [['D571.32445.201.00', 'POSMOD', '', false, '']]],
  ['A320', 'NEO/CEO', 'C42 AV G', 'Amboise', 'D571.30287.200.02', [
    ['D571.32209.200.00', 'NOUVELLE', '', false, ''],
    ['D571.30422.200.00', 'CJ', 'CJ', true, 'Hypothèse : CJ rattachée au C42 AV G A320, à confirmer']]],
  ['A320', 'NEO/CEO', 'C42 AV D', 'Amboise', 'D571.30287.201.03', [['D571.32209.202.00', 'NOUVELLE', '', false, '']]],
  ['A320', 'NEO/CEO', 'C42 AR G', 'T5X→H5', 'D571.30410.200.00', [
    ['D571.32210.200.40', 'NOUVELLE', '', true, 'Hypothèse déduite de la désignation'],
    ['E571.11161.200.00', 'NOUVELLE', '', true, 'Hypothèse déduite de la désignation']]],
  ['A320', 'NEO/CEO', 'C42 AR D', 'T5X→H5', 'D571.30410.201.00', [
    ['D571.32210.202.40', 'NOUVELLE', '', true, 'Hypothèse déduite de la désignation'],
    ['E571.11161.202.00', 'NOUVELLE', '', true, 'Hypothèse déduite de la désignation']]],
  ['A321', 'ACF', 'C36 AV G', 'Amboise', 'D571.34310.200.01', [['E571.11135.200.00', 'POSMOD', '', false, '']]],
  ['A321', 'ACF', 'C36 AV D', 'Amboise', 'D571.34310.201.01', [['E571.11135.201.00', 'POSMOD', '', false, '']]],
  ['A321', 'ACF', 'C36 AR G', 'M5', 'D571.34311.200.01', [['E571.11136.200.00', 'POSMOD', '', false, '']]],
  ['A321', 'ACF', 'C36 AR D', 'M5', 'D571.34311.201.01', [['E571.11136.201.00', 'POSMOD', '', false, '']]],
  ['A321', 'ACF', 'C42 AV G', 'M5', 'D571.34312.200.01', []],
  ['A321', 'ACF', 'C42 AV D', 'M5', 'D571.34313.200.01', []],
  ['A321', 'ACF', 'C42 AR G', 'T5X→H5', 'D571.34314.200.01', [['E571.11163.200.01', 'NOUVELLE', '', true, 'Hypothèse déduite de la désignation']]],
  ['A321', 'ACF', 'C42 AR D', 'T5X→H5', 'D571.34319.200.01', [['E571.11165.200.01', 'NOUVELLE', '', true, 'Hypothèse déduite de la désignation']]],
  ['A321', 'XLR', 'C42 AV G', 'M5', 'D571.34812.202.00', []],
  ['A321', 'XLR', 'C42 AV D', 'M5', 'D571.34813.202.00', []],
  ['A321', 'XLR', 'C42 AR G', 'T5X→H5', 'D571.34814.200.00', []],
  ['A321', 'XLR', 'C42 AR D', 'T5X→H5', 'D571.34819.200.00', []],
  ['A330', 'NEO', 'C40 AV G', 'M5', 'F571.16770.200.00', []],
  ['A330', 'NEO', 'C40 AV D', 'M5', 'F571.16770.201.00', []],
  ['A330', 'CEO', 'C40 AV G', 'M5', 'F571.12887.200.01', []],
  ['A330', 'CEO', 'C40 AV D', 'M5', 'F571.12887.201.01', []],
  ['A330', 'COMMUN', 'C40 AR G', 'V4', 'F571.12262.202.01', []],
  ['A330', 'COMMUN', 'C40 AR D', 'V4', 'F571.12262.203.01', []],
  ['A330', 'NEO/CEO', 'C47 G', 'M5', 'F571.12994.200.00', []],
  ['A330', 'NEO/CEO', 'C47 D', 'M5', 'F571.12994.201.00', []]
];

/** Identifiant stable d'un bloc, ex. « A321-ACF-C42AVG ». */
function makeBlockId_(prog, version, bloc) {
  return [prog, String(version).replace(/[^A-Za-z0-9]/g, ''), String(bloc).replace(/\s+/g, '')]
    .join('-').toUpperCase();
}

/**
 * Rack physique par défaut : programme + bloc (« A321-C42AVG »).
 * Les variantes d'un même rack (A321 ACF + XLR, A330 NEO + CEO) partagent la capacité.
 */
function makeRackId_(prog, bloc) {
  return (String(prog) + '-' + String(bloc).replace(/\s+/g, '')).toUpperCase();
}

/** Décompose « C42 AV G » → {cadre:'C42', avar:'AV', cote:'G'} (C47 G → avar ''). */
function parseBloc_(bloc) {
  var t = String(bloc).trim().toUpperCase().split(/\s+/);
  return {
    cadre: t[0] || '',
    avar: t.indexOf('AV') >= 0 ? 'AV' : (t.indexOf('AR') >= 0 ? 'AR' : ''),
    cote: t[t.length - 1] === 'G' || t[t.length - 1] === 'D' ? t[t.length - 1] : ''
  };
}

function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_PARAMS_ID);
  var ss = null;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('Buffer AJU Frames – Paramètres');
    props.setProperty(PROP_PARAMS_ID, ss.getId());
  }

  ensureSheet_(ss, SH_GLOBAUX, HEAD_GLOBAUX, function () {
    var who = currentUser_(), when = nowStr_();
    return DEFAULT_GLOBALS.map(function (g) { return [g[0], g[1], g[2], who, when]; });
  });

  ensureSheet_(ss, SH_BLOCS, HEAD_BLOCS, function () {
    return DEFAULT_BLOCKS.map(function (b, i) {
      var p = parseBloc_(b[2]);
      return [makeBlockId_(b[0], b[1], b[2]), b[0], b[1], b[2], p.cadre, p.avar, p.cote, b[3], b[4],
        '', '', '', '', 'OUI', 'NON', i + 1, makeRackId_(b[0], b[2])];
    });
  });
  // Mise à niveau d'un classeur créé avant l'ajout de la colonne Rack (vide = programme + bloc)
  var shBlocs = ss.getSheetByName(SH_BLOCS);
  var heads = shBlocs.getRange(1, 1, 1, Math.max(shBlocs.getLastColumn(), 1)).getValues()[0].map(normHead_);
  if (heads.indexOf('rack') < 0) {
    shBlocs.getRange(1, heads.length + 1).setValue('Rack').setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#00205B');
  }

  ensureSheet_(ss, SH_MAPPING, HEAD_MAPPING, function () {
    var rows = [], who = currentUser_(), when = nowStr_();
    DEFAULT_BLOCKS.forEach(function (b) {
      var bid = makeBlockId_(b[0], b[1], b[2]);
      rows.push([b[4], bid, 'STANDARD', '', 'NON', 'Réf L1 (capacité)', who, when]);
      b[5].forEach(function (r) {
        rows.push([r[0], bid, r[1], r[2], r[3] ? 'OUI' : 'NON', r[4], who, when]);
      });
    });
    return rows;
  });

  ensureSheet_(ss, SH_HISTO, HEAD_HISTO, null);
  ensureSheet_(ss, SH_JOURNAL, HEAD_JOURNAL, null);

  var def = ss.getSheetByName('Feuille 1') || ss.getSheetByName('Sheet1') || ss.getSheetByName('Feuille1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  // Listes déroulantes pour limiter les erreurs de saisie directe dans le classeur
  var shB = ss.getSheetByName(SH_BLOCS);
  var n = Math.max(shB.getMaxRows() - 1, 1);
  shB.getRange(2, 11, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['', 'pieces', 'emplacements'], true).setAllowInvalid(false).build());
  shB.getRange(2, 14, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['OUI', 'NON'], true).setAllowInvalid(false).build());
  var shM = ss.getSheetByName(SH_MAPPING);
  shM.getRange(2, 3, Math.max(shM.getMaxRows() - 1, 1), 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(['STANDARD', 'POSMOD', 'NOUVELLE', 'CJ', 'AUTRE'], true).setAllowInvalid(true).build());

  clearDashboardCache_();
  Logger.log('Classeur Paramètres prêt : ' + ss.getUrl());
  return ss.getUrl();
}

function ensureSheet_(ss, name, headers, defaultRowsFn) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setFontColor('#FFFFFF').setBackground('#00205B');
  sh.setFrozenRows(1);
  if (defaultRowsFn) {
    var rows = defaultRowsFn();
    if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sh.autoResizeColumns(1, headers.length);
  return sh;
}

/** Ouvre le classeur Paramètres (erreur claire si setup() n'a pas été lancé). */
function paramsSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty(PROP_PARAMS_ID);
  if (!id) throw new Error('Classeur Paramètres non initialisé : lancez la fonction setup() depuis l\'éditeur Apps Script.');
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Pas d\'accès au classeur Paramètres (ID ' + id + '). Relancez setup() ou vérifiez le partage.');
  }
}

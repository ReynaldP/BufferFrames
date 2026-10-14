/**
 * Buffer AJU Frames : web app Google Apps Script.
 * Code.gs : constantes, point d'entrée doGet, routage et utilitaires communs.
 *
 * Les deux classeurs sources sont en LECTURE SEULE : l'appli n'y écrit jamais.
 * Toutes les écritures vont dans le classeur Paramètres créé par setup().
 */

var SOURCE_PILOTAGE_ID = '1GXpxmUtseSCqkyI6hznbxlMjcb7RoEDe5GSPcjP2pnk';
var SOURCE_PILOTAGE_NAME = 'Pilotage_Ferrure_PC Frame';
var SOURCE_DIM_ID = '1_Je8iKhNsuKBq5pAXVqb7tPPa49luDxu6XNbmKns9PQ';
var SOURCE_DIM_NAME = 'Dimensionnement Buffer ZINC';

var SHEET_ZZ84 = 'ZZ84';
var SHEET_DATA_POSTE = 'DATA Poste';
var SHEET_L1 = 'L1';

var PROP_PARAMS_ID = 'PARAMS_SPREADSHEET_ID';
var CACHE_TTL_S = 120;
var CACHE_PREFIX = 'dash_v1_';

/** Années L1 disponibles (clé → libellé, index de colonne de secours J/K/L/M). */
var L1_YEARS = [
  { key: '2024', label: '2024', col: 9 },
  { key: '2025', label: '2025', col: 10 },
  { key: '2026-2028', label: '2026-2028', col: 11 },
  { key: '2028+', label: '2028 +', col: 12 }
];

/** Table de secours si l'onglet DATA Poste est illisible. */
var FALLBACK_POSTES = {
  '37SBEL1': 'BUFFER',
  '53B0223': 'AJU', '53B0225': 'AJU', '37S0223': 'AJU', '37S0225': 'AJU'
};

function doGet(e) {
  var params = (e && e.parameter) || {};
  var tpl = HtmlService.createTemplateFromFile('Index');
  tpl.mode = params.mode === 'tv' ? 'tv' : 'app';
  return tpl.evaluate()
    .setTitle('Buffer AJU Frames')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Inclusion de fichiers HTML (Styles, App.js) dans le template. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ------------------------------------------------------------------ */
/* Utilitaires communs                                                 */
/* ------------------------------------------------------------------ */

/** Normalise une réf ou un poste : supprime tous les blancs (y c. retours ligne) et passe en majuscules. */
function normRef_(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, '').toUpperCase();
}

/** Normalise un en-tête : minuscules, sans accents ni ponctuation. */
function normHead_(v) {
  return String(v === null || v === undefined ? '' : v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Convertit en nombre (gère les nombres stockés en texte, virgule décimale, espaces). */
function toNum_(v) {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  var n = parseFloat(String(v).replace(/[\s ]/g, '').replace(',', '.'));
  return isFinite(n) ? n : 0;
}

/** Nombre ou null si la cellule est vide (vide = « valeur par défaut »). */
function toNumOrNull_(v) {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  var n = toNum_(v);
  return isFinite(n) ? n : null;
}

function str_(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function currentUser_() {
  try {
    return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || 'inconnu';
  } catch (e) {
    return 'inconnu';
  }
}

function nowStr_() {
  return Utilities.formatDate(new Date(), 'Europe/Paris', 'dd/MM/yyyy HH:mm');
}

/** Ouvre un classeur source avec un message d'erreur explicite. */
function openSource_(id, name) {
  try {
    return SpreadsheetApp.openById(id);
  } catch (e) {
    throw new Error('Pas d\'accès au fichier « ' + name + ' » (ID ' + id + '). Vérifiez le partage avec le compte qui déploie la web app.');
  }
}

/** Lit un onglet en un seul appel getValues(). */
function readSheet_(ss, sheetName, fileName) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error('Onglet « ' + sheetName + ' » introuvable dans « ' + fileName + ' ».');
  return sh.getDataRange().getValues();
}

/* ------------------------------------------------------------------ */
/* Cache (découpé en morceaux : CacheService limite chaque valeur à 100 Ko) */
/* ------------------------------------------------------------------ */

function cachePutJson_(key, obj) {
  try {
    var cache = CacheService.getScriptCache();
    var json = JSON.stringify(obj);
    var size = 90000, parts = {}, n = Math.ceil(json.length / size);
    for (var i = 0; i < n; i++) parts[key + '_' + i] = json.substr(i * size, size);
    parts[key] = String(n);
    cache.putAll(parts, CACHE_TTL_S);
  } catch (e) { /* le cache est une optimisation : jamais bloquant */ }
}

function cacheGetJson_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var n = parseInt(cache.get(key), 10);
    if (!n) return null;
    var keys = [];
    for (var i = 0; i < n; i++) keys.push(key + '_' + i);
    var parts = cache.getAll(keys), json = '';
    for (var j = 0; j < n; j++) {
      if (parts[keys[j]] === undefined || parts[keys[j]] === null) return null;
      json += parts[keys[j]];
    }
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

function clearDashboardCache_() {
  try {
    var cache = CacheService.getScriptCache();
    cache.removeAll(L1_YEARS.map(function (y) { return CACHE_PREFIX + y.key; }).concat([CACHE_PREFIX + 'default']));
  } catch (e) { /* ignore */ }
}

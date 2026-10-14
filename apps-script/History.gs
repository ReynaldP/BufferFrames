/**
 * History.gs : photos quotidiennes des niveaux (déclencheurs horaires) et lecture de l'historique.
 * Lignes « KPI » : une par périmètre (ALL, A320, A321, A330). Lignes « BLOC » : une par bloc actif.
 */

var SNAPSHOT_HANDLER = 'takeSnapshot';

/** Appelé par les déclencheurs horaires. */
function takeSnapshot() {
  var data = computeDashboard_(null);
  var ss = paramsSpreadsheet_();
  var sh = ss.getSheetByName(SH_HISTO) || ensureSheet_(ss, SH_HISTO, HEAD_HISTO, null);
  var now = new Date(), rows = [];
  ['ALL', 'A320', 'A321', 'A330'].forEach(function (scope) {
    var k = data.kpis[scope];
    rows.push([now, 'KPI', scope, scope === 'ALL' ? 'Tous programmes' : scope, k.aju, k.avenir, k.cap, '', '', '',
      k.debord, Math.round(k.fill * 1000) / 10, k.debord, k.rouge]);
  });
  data.blocks.forEach(function (b) {
    rows.push([now, 'BLOC', b.id, blockLabel_(b), b.aju, b.avenir, b.cap, b.mini, b.maxi, b.status,
      b.excess, b.cap > 0 ? Math.round(b.aju / b.cap * 1000) / 10 : '', '', '']);
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEAD_HISTO.length).setValues(rows);
  return { rows: rows.length, at: nowStr_() };
}

/** Photo à la demande depuis l'écran Réglages (tracée au journal). */
function takeSnapshotManual() {
  var res = takeSnapshot();
  journal_(paramsSpreadsheet_(), [{ objet: 'Historique', champ: 'Photo manuelle', avant: '', apres: res.rows + ' lignes' }]);
  return res;
}

/**
 * (Ré)installe les déclencheurs aux heures du paramètre « heures_photo » (défaut 06:00;13:30).
 * À lancer une fois depuis l'éditeur après setup(), puis automatiquement quand les heures changent.
 * Les déclencheurs Apps Script s'exécutent à ± 15 min de l'heure demandée.
 */
function installTriggers() {
  removeTriggers();
  var g = readGlobals_(paramsSpreadsheet_()).values;
  var hours = parsePhotoHours_(g.heures_photo);
  if (!hours.length) hours = [{ h: 6, m: 0 }, { h: 13, m: 30 }];
  hours.forEach(function (t) {
    ScriptApp.newTrigger(SNAPSHOT_HANDLER).timeBased().everyDays(1)
      .atHour(t.h).nearMinute(t.m).inTimezone('Europe/Paris').create();
  });
  Logger.log('Déclencheurs installés : ' + hours.map(function (t) { return pad2_(t.h) + ':' + pad2_(t.m); }).join(', '));
  return hours.length;
}

function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === SNAPSHOT_HANDLER) ScriptApp.deleteTrigger(t);
  });
}

/**
 * Historique pour les courbes et sparklines.
 * @param {number=} days profondeur en jours (défaut 30)
 */
function getHistoryData(days) {
  days = Math.max(1, Math.min(days || 30, 365));
  var ss = paramsSpreadsheet_();
  var sh = ss.getSheetByName(SH_HISTO);
  var out = { kpi: { ALL: [], A320: [], A321: [], A330: [] }, blocks: {}, days: days };
  if (!sh || sh.getLastRow() < 2) return out;
  // On ne lit que la fin de l'onglet : ~ 2 photos × 35 lignes par jour
  var n = Math.min(sh.getLastRow() - 1, days * 120);
  var values = sh.getRange(sh.getLastRow() - n + 1, 1, n, HEAD_HISTO.length).getValues();
  var since = Date.now() - days * 86400000;
  values.forEach(function (r) {
    var t = r[0] instanceof Date ? r[0] : new Date(r[0]);
    if (isNaN(t) || t.getTime() < since) return;
    var ts = Utilities.formatDate(t, 'Europe/Paris', "yyyy-MM-dd'T'HH:mm");
    if (r[1] === 'KPI' && out.kpi[r[2]]) {
      out.kpi[r[2]].push({ t: ts, aju: toNum_(r[4]), cap: toNum_(r[6]), fill: toNum_(r[11]), debord: toNum_(r[12]), rouges: toNum_(r[13]) });
    } else if (r[1] === 'BLOC') {
      (out.blocks[r[2]] = out.blocks[r[2]] || []).push({ t: ts, aju: toNum_(r[4]), status: str_(r[9]) });
    }
  });
  return out;
}

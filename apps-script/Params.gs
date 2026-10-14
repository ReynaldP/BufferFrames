/**
 * Params.gs : lecture et écriture du classeur Paramètres (globaux, blocs, mapping, journal).
 * Toutes les écritures passent par LockService et sont tracées dans l'onglet Journal.
 */

var GLOBAL_KEYS_NUM = ['debord_capacite', 'mini_pct', 'debord_seuil_vigilance', 'debord_seuil_escalade',
  'age_seuil_jours', 'tv_refresh_min', 'tv_rotation_s'];

/* ------------------------------------------------------------------ */
/* Lecture                                                             */
/* ------------------------------------------------------------------ */

function readParams_(ss) {
  ss = ss || paramsSpreadsheet_();
  return {
    ss: ss,
    globals: readGlobals_(ss),
    blocks: readBlocks_(ss),
    mapping: readMapping_(ss)
  };
}

function readGlobals_(ss) {
  var values = readSheet_(ss, SH_GLOBAUX, 'Paramètres');
  var g = {}, meta = {};
  DEFAULT_GLOBALS.forEach(function (d) { g[d[0]] = d[1]; });
  for (var i = 1; i < values.length; i++) {
    var k = str_(values[i][0]);
    if (!k) continue;
    var v = values[i][1];
    g[k] = GLOBAL_KEYS_NUM.indexOf(k) >= 0 ? toNum_(v) : str_(v);
    meta[k] = { by: str_(values[i][3]), at: formatCell_(values[i][4]), label: str_(values[i][2]), row: i + 1 };
  }
  if (g.unite !== 'emplacements') g.unite = 'pieces';
  if (!L1_YEARS.some(function (y) { return y.key === g.annee_l1; })) g.annee_l1 = '2026-2028';
  return { values: g, meta: meta };
}

function readBlocks_(ss) {
  var values = readSheet_(ss, SH_BLOCS, 'Paramètres');
  var col = headerIndex_(values[0], HEAD_BLOCS);
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var id = str_(r[col['Bloc ID']]);
    if (!id) continue;
    var bloc = str_(r[col['Bloc']]);
    var parsed = parseBloc_(bloc);
    out.push({
      row: i + 1,
      id: id,
      prog: str_(r[col['Programme']]).toUpperCase(),
      version: str_(r[col['Version']]),
      bloc: bloc,
      cadre: str_(r[col['Cadre']]).toUpperCase() || parsed.cadre,
      avar: str_(r[col['AV/AR']]).toUpperCase() || parsed.avar,
      cote: str_(r[col['Côté']]).toUpperCase() || parsed.cote,
      flux: str_(r[col['Flux']]),
      refL1: normRef_(r[col['Réf L1']]),
      capOverride: toNumOrNull_(r[col['Capacité']]),
      unitOverride: (function (u) { return u === 'pieces' || u === 'emplacements' ? u : ''; })(str_(r[col['Unité']]).toLowerCase()),
      miniOverride: toNumOrNull_(r[col['Mini']]),
      maxiOverride: toNumOrNull_(r[col['Maxi']]),
      actif: str_(r[col['Actif']]).toUpperCase() !== 'NON',
      order: toNum_(r[col['Ordre']]) || i
    });
  }
  return out;
}

function readMapping_(ss) {
  var values = readSheet_(ss, SH_MAPPING, 'Paramètres');
  var col = headerIndex_(values[0], HEAD_MAPPING);
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    var ref = normRef_(r[col['Réf']]);
    if (!ref) continue;
    out.push({
      row: i + 1,
      ref: ref,
      blockId: str_(r[col['Bloc ID']]),
      type: str_(r[col['Type']]).toUpperCase() || 'AUTRE',
      versionRef: str_(r[col['Version réf']]),
      aValider: str_(r[col['À valider']]).toUpperCase() === 'OUI',
      comment: str_(r[col['Commentaire']])
    });
  }
  return out;
}

/** Index des colonnes par en-tête, avec repli sur l'ordre attendu. */
function headerIndex_(headerRow, expected) {
  var idx = {}, heads = (headerRow || []).map(normHead_);
  expected.forEach(function (h, i) {
    var p = heads.indexOf(normHead_(h));
    idx[h] = p >= 0 ? p : i;
  });
  return idx;
}

function formatCell_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, 'Europe/Paris', 'dd/MM/yyyy HH:mm');
  return str_(v);
}

/* ------------------------------------------------------------------ */
/* Résolution des valeurs effectives d'un bloc (défauts L1 + surcharges) */
/* ------------------------------------------------------------------ */

/**
 * @param {Object} b bloc lu dans Parametres_Blocs
 * @param {number|null} l1Value valeur L1 brute (null si réf absente de L1)
 * @param {Object} g paramètres globaux
 */
function resolveBlockLimits_(b, l1Value, g) {
  var unit = b.unitOverride || g.unite;
  var ppe = b.avar === 'AR' ? 2 : 1; // pièces par emplacement
  var l1 = l1Value === null || l1Value === undefined ? 0 : l1Value;
  var capDefault = Math.round(unit === 'emplacements' ? l1 * ppe : l1);
  var cap = b.capOverride !== null ? Math.round(b.capOverride) : capDefault;
  var maxiDefault = cap;
  var maxi = b.maxiOverride !== null ? Math.round(b.maxiOverride) : maxiDefault;
  var miniDefault = cap > 0 ? Math.max(1, Math.ceil((toNum_(g.mini_pct) / 100) * cap)) : 0;
  miniDefault = Math.min(miniDefault, maxi);
  var mini = b.miniOverride !== null ? Math.round(b.miniOverride) : miniDefault;
  return {
    unit: unit, ppe: ppe, l1Value: l1Value, cap: cap, mini: mini, maxi: maxi,
    capDefault: capDefault, miniDefault: miniDefault, maxiDefault: maxiDefault,
    overrides: { cap: b.capOverride !== null, mini: b.miniOverride !== null, maxi: b.maxiOverride !== null, unit: !!b.unitOverride },
    valid: mini >= 0 && mini <= maxi && maxi <= cap
  };
}

/* ------------------------------------------------------------------ */
/* Écritures (exposées au front)                                       */
/* ------------------------------------------------------------------ */

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw new Error('Un autre utilisateur enregistre en ce moment. Réessayez dans quelques secondes.');
  try {
    return fn();
  } finally {
    lock.releaseLock();
    clearDashboardCache_();
  }
}

function journal_(ss, entries) {
  if (!entries.length) return;
  var sh = ss.getSheetByName(SH_JOURNAL) || ensureSheet_(ss, SH_JOURNAL, HEAD_JOURNAL, null);
  var who = currentUser_(), when = new Date();
  var rows = entries.map(function (e) {
    return [when, who, e.objet, e.champ, e.avant === null || e.avant === undefined ? '' : e.avant,
      e.apres === null || e.apres === undefined ? '' : e.apres];
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * Enregistre les réglages d'un ou plusieurs blocs.
 * @param {Array<Object>} changes [{blockId, cap?, mini?, maxi?, unit?, actif?, reset?}]
 *   Une valeur null = revenir à la valeur par défaut L1. Une clé absente = inchangée.
 *   reset:true efface toutes les surcharges du bloc.
 * @return {{saved:string[], errors:{blockId:string,message:string}[]}}
 */
function saveBlockParams(changes) {
  if (!Array.isArray(changes)) changes = [changes];
  return withLock_(function () {
    var ss = paramsSpreadsheet_();
    var g = readGlobals_(ss).values;
    var blocks = readBlocks_(ss);
    var byId = {};
    blocks.forEach(function (b) { byId[b.id] = b; });
    var l1 = loadL1Safe_(g.annee_l1).caps;

    var sh = ss.getSheetByName(SH_BLOCS);
    var data = sh.getDataRange().getValues();
    var col = headerIndex_(data[0], HEAD_BLOCS);
    var editCols = ['Capacité', 'Unité', 'Mini', 'Maxi', 'Actif', 'Surcharge'].map(function (h) { return col[h]; });
    var c0 = Math.min.apply(null, editCols), c1 = Math.max.apply(null, editCols);
    var saved = [], errors = [], log = [];

    changes.forEach(function (c) {
      var b = byId[c.blockId];
      if (!b) { errors.push({ blockId: c.blockId, message: 'Bloc inconnu' }); return; }
      var next = {
        capOverride: b.capOverride, miniOverride: b.miniOverride, maxiOverride: b.maxiOverride,
        unitOverride: b.unitOverride, actif: b.actif
      };
      if (c.reset) {
        next.capOverride = next.miniOverride = next.maxiOverride = null;
        next.unitOverride = '';
      }
      ['cap', 'mini', 'maxi'].forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(c, k)) {
          var v = c[k] === null || c[k] === '' ? null : Math.round(toNum_(c[k]));
          next[k + 'Override'] = v;
        }
      });
      if (Object.prototype.hasOwnProperty.call(c, 'unit')) next.unitOverride = c.unit === 'pieces' || c.unit === 'emplacements' ? c.unit : '';
      if (Object.prototype.hasOwnProperty.call(c, 'actif')) next.actif = !!c.actif;

      var lim = resolveBlockLimits_(Object.assign({}, b, next), l1[b.refL1] ? l1[b.refL1].value : null, g);
      if (!lim.valid) {
        errors.push({ blockId: b.id, message: b.prog + ' ' + b.version + ' ' + b.bloc +
          ' : contrôle 0 ≤ mini (' + lim.mini + ') ≤ maxi (' + lim.maxi + ') ≤ capacité (' + lim.cap + ') non respecté' });
        return;
      }
      var label = b.prog + ' ' + b.version + ' ' + b.bloc;
      var row = data[b.row - 1];
      row[col['Capacité']] = next.capOverride === null ? '' : next.capOverride;
      row[col['Unité']] = next.unitOverride || '';
      row[col['Mini']] = next.miniOverride === null ? '' : next.miniOverride;
      row[col['Maxi']] = next.maxiOverride === null ? '' : next.maxiOverride;
      row[col['Actif']] = next.actif ? 'OUI' : 'NON';
      var surcharge = next.capOverride !== null || next.miniOverride !== null || next.maxiOverride !== null || !!next.unitOverride;
      row[col['Surcharge']] = surcharge ? 'OUI' : 'NON';

      [['Capacité', 'capOverride'], ['Mini', 'miniOverride'], ['Maxi', 'maxiOverride'], ['Unité', 'unitOverride']].forEach(function (p) {
        var before = b[p[1]], after = next[p[1]];
        if ((before === null ? '' : before) !== (after === null ? '' : after)) {
          log.push({ objet: 'Bloc ' + label, champ: p[0], avant: before === null || before === '' ? 'défaut L1' : before,
            apres: after === null || after === '' ? 'défaut L1' : after });
        }
      });
      if (b.actif !== next.actif) log.push({ objet: 'Bloc ' + label, champ: 'Actif', avant: b.actif ? 'OUI' : 'NON', apres: next.actif ? 'OUI' : 'NON' });

      saved.push(b.id);
    });
    if (saved.length && data.length > 1) {
      // une seule écriture pour toutes les colonnes éditables (Capacité → Surcharge)
      var block = data.slice(1).map(function (r) { return r.slice(c0, c1 + 1); });
      sh.getRange(2, c0 + 1, block.length, c1 - c0 + 1).setValues(block);
    }
    journal_(ss, log);
    return { saved: saved, errors: errors };
  });
}

/**
 * Enregistre des paramètres globaux.
 * @param {Object} values {clé: valeur}
 */
function saveGlobalParams(values) {
  return withLock_(function () {
    var ss = paramsSpreadsheet_();
    var sh = ss.getSheetByName(SH_GLOBAUX);
    var current = readGlobals_(ss);
    var who = currentUser_(), when = new Date(), log = [];
    var allowed = DEFAULT_GLOBALS.map(function (d) { return d[0]; });
    Object.keys(values || {}).forEach(function (k) {
      if (allowed.indexOf(k) < 0) return;
      var v = values[k];
      if (GLOBAL_KEYS_NUM.indexOf(k) >= 0) {
        v = toNum_(v);
        if (v < 0) throw new Error('Valeur négative interdite pour ' + k);
        if (k === 'debord_capacite' || k === 'tv_refresh_min' || k === 'tv_rotation_s') v = Math.max(1, Math.round(v));
      } else if (k === 'unite') {
        v = v === 'emplacements' ? 'emplacements' : 'pieces';
      } else if (k === 'annee_l1') {
        if (!L1_YEARS.some(function (y) { return y.key === v; })) throw new Error('Année L1 inconnue : ' + v);
      } else if (k === 'heures_photo') {
        v = parsePhotoHours_(v).map(function (h) { return pad2_(h.h) + ':' + pad2_(h.m); }).join(';');
        if (!v) throw new Error('Heures de photo invalides (format attendu : 06:00;13:30)');
      }
      var before = current.values[k];
      if (String(before) === String(v)) return;
      var meta = current.meta[k];
      var label = (DEFAULT_GLOBALS.filter(function (d) { return d[0] === k; })[0] || [])[2] || k;
      if (meta) {
        sh.getRange(meta.row, 2).setValue(v);
        sh.getRange(meta.row, 4, 1, 2).setValues([[who, when]]);
      } else {
        sh.appendRow([k, v, label, who, when]);
      }
      log.push({ objet: 'Paramètre global', champ: k, avant: before, apres: v });
    });
    journal_(ss, log);
    if (Object.prototype.hasOwnProperty.call(values || {}, 'heures_photo')) {
      try { installTriggers(); } catch (e) { /* l'utilisateur web n'a pas forcément le droit : non bloquant */ }
    }
    return { saved: log.length };
  });
}

/**
 * Crée, modifie ou supprime des rattachements réf → bloc.
 * @param {Array<Object>} entries [{ref, blockId, type, versionRef, aValider, comment, remove}]
 */
function saveMapping(entries) {
  if (!Array.isArray(entries)) entries = [entries];
  return withLock_(function () {
    var ss = paramsSpreadsheet_();
    var sh = ss.getSheetByName(SH_MAPPING);
    var mapping = readMapping_(ss);
    var blockIds = readBlocks_(ss).map(function (b) { return b.id; });
    var who = currentUser_(), when = new Date(), log = [], toDelete = [];
    entries.forEach(function (e) {
      var ref = normRef_(e.ref);
      if (!ref) throw new Error('Réf vide');
      var existing = mapping.filter(function (m) { return m.ref === ref; })[0];
      if (e.remove) {
        if (existing) {
          toDelete.push(existing.row);
          log.push({ objet: 'Mapping ' + ref, champ: 'Bloc', avant: existing.blockId, apres: '(supprimé)' });
        }
        return;
      }
      if (blockIds.indexOf(e.blockId) < 0) throw new Error('Bloc inconnu : ' + e.blockId);
      var row = [ref, e.blockId, (e.type || 'AUTRE').toUpperCase(), e.versionRef || '', e.aValider ? 'OUI' : 'NON',
        e.comment || '', who, when];
      if (existing) {
        sh.getRange(existing.row, 1, 1, row.length).setValues([row]);
        log.push({ objet: 'Mapping ' + ref, champ: 'Bloc / type', avant: existing.blockId + ' / ' + existing.type, apres: e.blockId + ' / ' + row[2] });
      } else {
        sh.appendRow(row);
        log.push({ objet: 'Mapping ' + ref, champ: 'Bloc', avant: '(non rattachée)', apres: e.blockId });
      }
    });
    toDelete.sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
    journal_(ss, log);
    return { saved: log.length };
  });
}

/** Dernières lignes du journal (pour l'écran Réglages). */
function getJournal(limit) {
  var ss = paramsSpreadsheet_();
  var sh = ss.getSheetByName(SH_JOURNAL);
  if (!sh || sh.getLastRow() < 2) return [];
  limit = Math.min(limit || 50, 500);
  var n = Math.min(limit, sh.getLastRow() - 1);
  var values = sh.getRange(sh.getLastRow() - n + 1, 1, n, HEAD_JOURNAL.length).getValues();
  return values.reverse().map(function (r) {
    return { at: formatCell_(r[0]), by: str_(r[1]), objet: str_(r[2]), champ: str_(r[3]), avant: str_(r[4]), apres: str_(r[5]) };
  });
}

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** « 06:00;13:30 » → [{h:6,m:0},{h:13,m:30}] */
function parsePhotoHours_(s) {
  return String(s || '').split(/[;,\s]+/).map(function (t) {
    var m = /^(\d{1,2})(?:[:hH](\d{2})?)?$/.exec(t.trim());
    if (!m) return null;
    var h = parseInt(m[1], 10), mi = m[2] ? parseInt(m[2], 10) : 0;
    return h >= 0 && h < 24 && mi >= 0 && mi < 60 ? { h: h, m: mi } : null;
  }).filter(function (x) { return x; });
}

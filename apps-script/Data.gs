/**
 * Data.gs : lecture des sources (lecture seule) et agrégation par bloc.
 *
 * Règles :
 *  - ZZ84 : colonnes repérées par en-tête, en-têtes répétés filtrés, Qté OF sommée.
 *  - Statut du poste via DATA Poste (C = poste, D = statut), avec une table de secours.
 *  - AJU = pièces dans le buffer AJU Frames ; BUFFER = « À venir ».
 *  - Niveau d'un bloc = somme de toutes ses réfs (standard, POSMOD, nouvelles réfs) via Mapping_Refs.
 *  - ROUGE si AJU < mini ; VERT si mini ≤ AJU < maxi ; PLEIN si maxi ≤ AJU ≤ capacité ; DÉBORD si AJU > capacité.
 */

var ZZ84_COLUMNS = {
  oper: { heads: ['oper', 'operation'], fallback: 2 },
  ordre: { heads: ['ordre', 'of'], fallback: 3 },
  article: { heads: ['article'], fallback: 4 },
  designation: { heads: ['designation'], fallback: 9 },
  poste: { heads: ['postrav', 'postetravail', 'poste'], fallback: 12 },
  qte: { heads: ['qteof', 'qte'], fallback: 13 },
  age: { heads: ['agepos', 'age'], fallback: 15 },
  serie: { heads: ['nserie', 'noserie', 'numeroserie', 'serie'], fallback: 16 }
};

var STATUS_ORDER = { ROUGE: 0, DEBORD: 1, VERT: 2, PLEIN: 3 };

/**
 * Point d'entrée unique du front.
 * @param {Object=} opts {year: '2026-2028', force: true}
 */
function getDashboardData(opts) {
  opts = opts || {};
  var started = Date.now();
  var yearKey = opts.year || null;
  var cacheKey = CACHE_PREFIX + (yearKey || 'default');
  if (!opts.force) {
    var cached = cacheGetJson_(cacheKey);
    if (cached) { cached.fromCache = true; return cached; }
  }
  if (opts.force) clearDashboardCache_();
  var data = computeDashboard_(yearKey);
  data.durationMs = Date.now() - started;
  cachePutJson_(cacheKey, data);
  data.fromCache = false;
  return data;
}

function computeDashboard_(yearKey) {
  var warnings = [];
  var params = readParams_();
  var g = params.globals.values;
  var year = yearKey && L1_YEARS.some(function (y) { return y.key === yearKey; }) ? yearKey : g.annee_l1;

  /* --- Source 1 : Pilotage (ZZ84 + DATA Poste) --- */
  var ssP = openSource_(SOURCE_PILOTAGE_ID, SOURCE_PILOTAGE_NAME);
  var zzValues = readSheet_(ssP, SHEET_ZZ84, SOURCE_PILOTAGE_NAME);
  var extraction = readExtractionStamp_(ssP, zzValues);

  var posteValues = null;
  try {
    posteValues = readSheet_(ssP, SHEET_DATA_POSTE, SOURCE_PILOTAGE_NAME);
  } catch (e) {
    warnings.push({ level: 'warn', msg: e.message + ' Table des postes de secours utilisée.' });
  }
  var postes = buildPosteMap_(posteValues, warnings);

  /* --- Source 2 : Dimensionnement (L1) --- */
  var l1 = loadL1Safe_(year);
  if (l1.error) warnings.push({ level: 'error', msg: l1.error + ' Capacités L1 indisponibles : seules les surcharges saisies sont utilisées.' });
  l1.duplicates.forEach(function (d) {
    warnings.push({ level: 'info', msg: 'Doublon L1 ignoré : ' + d.ref + ' (' + d.ignored + '), ligne ' + d.kept + ' conservée.' });
  });

  /* --- ZZ84 → pièces aux postes BUFFER / AJU --- */
  var parsed = parseZZ84_(zzValues, postes);
  if (!parsed.headerFound) warnings.push({ level: 'warn', msg: 'En-têtes ZZ84 introuvables (attendus en ligne 3 : Article, Pos.trav, Qté OF…) : colonnes C à Q supposées.' });
  if (parsed.headerFallback) warnings.push({ level: 'warn', msg: 'En-têtes ZZ84 non reconnus (' + parsed.headerFallback.join(', ') + ') : position de colonne par défaut utilisée.' });

  /* --- Blocs --- */
  var refToBlock = {}, refMeta = {};
  params.mapping.forEach(function (m) {
    if (refToBlock[m.ref] && refToBlock[m.ref] !== m.blockId) {
      warnings.push({ level: 'warn', msg: 'Réf ' + m.ref + ' rattachée à deux blocs : ' + refToBlock[m.ref] + ' retenu.' });
      return;
    }
    refToBlock[m.ref] = m.blockId;
    refMeta[m.ref] = m;
  });

  var blocks = [], byId = {};
  params.blocks.forEach(function (b) {
    if (!b.actif) return;
    var l1row = l1.caps[b.refL1] || null;
    if (!l1row && !l1.error) warnings.push({ level: 'warn', msg: 'Réf L1 ' + b.refL1 + ' (' + b.prog + ' ' + b.bloc + ') absente de l\'onglet L1 : capacité 0 par défaut.' });
    var lim = resolveBlockLimits_(b, l1row ? l1row.value : null, g);
    if (!lim.valid) warnings.push({ level: 'warn', msg: b.prog + ' ' + b.version + ' ' + b.bloc + ' : réglages incohérents (mini ' + lim.mini + ', maxi ' + lim.maxi + ', capacité ' + lim.cap + ').' });
    if (!refToBlock[b.refL1]) {
      refToBlock[b.refL1] = b.id;
      refMeta[b.refL1] = { ref: b.refL1, blockId: b.id, type: 'STANDARD', versionRef: '', aValider: false, comment: 'Réf L1 (ajoutée automatiquement)' };
    }
    var blk = {
      id: b.id, prog: b.prog, version: b.version, bloc: b.bloc, cadre: b.cadre, avar: b.avar, cote: b.cote,
      flux: b.flux, order: b.order, refL1: b.refL1, l1Designation: l1row ? l1row.designation : '',
      l1Missing: !l1row, unit: lim.unit, ppe: lim.ppe, l1Value: lim.l1Value,
      cap: lim.cap, mini: lim.mini, maxi: lim.maxi,
      capDefault: lim.capDefault, miniDefault: lim.miniDefault, maxiDefault: lim.maxiDefault,
      overrides: lim.overrides, valid: lim.valid,
      aju: 0, avenir: 0, ageMax: 0, refs: [], ofs: [], overflow: []
    };
    blocks.push(blk);
    byId[b.id] = blk;
  });

  // Toutes les réfs mappées apparaissent dans le détail du bloc, même à 0
  Object.keys(refToBlock).forEach(function (ref) {
    var blk = byId[refToBlock[ref]];
    if (!blk) return;
    var m = refMeta[ref];
    blk.refs.push({ ref: ref, type: m.type, versionRef: m.versionRef, aValider: m.aValider, comment: m.comment,
      designation: ref === blk.refL1 ? blk.l1Designation : '', aju: 0, avenir: 0, isL1: ref === blk.refL1 });
  });

  var unmapped = {};
  parsed.pieces.forEach(function (p) {
    var blk = byId[refToBlock[p.ref]];
    if (!blk) {
      // Réf non rattachée, ou rattachée à un bloc inactif : on la signale, rien ne disparaît
      var u = unmapped[p.ref] || (unmapped[p.ref] = { ref: p.ref, designation: p.designation, aju: 0, avenir: 0, ofs: 0,
        inactiveBlock: refToBlock[p.ref] || '' });
      u[p.statut === 'AJU' ? 'aju' : 'avenir'] += p.qte;
      u.ofs++;
      return;
    }
    var r = blk.refs.filter(function (x) { return x.ref === p.ref; })[0];
    if (!r.designation) r.designation = p.designation;
    if (p.statut === 'AJU') {
      blk.aju += p.qte; r.aju += p.qte;
      blk.ageMax = Math.max(blk.ageMax, p.age);
    } else {
      blk.avenir += p.qte; r.avenir += p.qte;
    }
    blk.ofs.push({ of: p.ordre, ref: p.ref, qte: p.qte, age: p.age, oper: p.oper, serie: p.serie, statut: p.statut, poste: p.poste });
  });

  /* --- Statuts, débord --- */
  var debordPieces = [];
  blocks.forEach(function (blk) {
    blk.refs.sort(function (a, b) { return (b.isL1 - a.isL1) || a.ref.localeCompare(b.ref); });
    blk.ofs.sort(function (a, b) { return (a.statut === b.statut ? 0 : a.statut === 'AJU' ? -1 : 1) || b.age - a.age; });
    blk.projection = blk.aju + blk.avenir;
    blk.status = blockStatus_(blk.aju, blk.mini, blk.maxi, blk.cap);
    blk.projStatus = blockStatus_(blk.projection, blk.mini, blk.maxi, blk.cap);
    blk.excess = Math.max(0, blk.aju - blk.cap);
    blk.projExcess = Math.max(0, blk.projection - blk.cap);
    blk.fill = blk.cap > 0 ? blk.aju / blk.cap : (blk.aju > 0 ? Infinity : 0);
    if (blk.excess > 0) {
      // Les pièces arrivées en dernier (âge le plus faible) sont celles qui n'ont plus de place sur le rack
      var units = [];
      blk.ofs.forEach(function (o) {
        if (o.statut !== 'AJU') return;
        for (var i = 0; i < Math.max(1, Math.round(o.qte)); i++) units.push({ of: o.of, ref: o.ref, age: o.age, serie: o.serie });
      });
      units.sort(function (a, b) { return a.age - b.age; });
      blk.overflow = units.slice(0, blk.excess);
      blk.overflow.forEach(function (u) {
        debordPieces.push({ blockId: blk.id, prog: blk.prog, cadre: blk.cadre, label: blockLabel_(blk), of: u.of, ref: u.ref, age: u.age, serie: u.serie });
      });
    }
    if (!isFinite(blk.fill)) blk.fill = 99;
  });
  debordPieces.sort(function (a, b) { return b.age - a.age; }); // FIFO : la plus ancienne d'abord

  var unmappedList = Object.keys(unmapped).map(function (k) { return unmapped[k]; })
    .sort(function (a, b) { return (b.aju + b.avenir) - (a.aju + a.avenir); });

  var kpis = {};
  ['ALL', 'A320', 'A321', 'A330'].forEach(function (scope) {
    kpis[scope] = computeKpis_(blocks.filter(function (b) { return scope === 'ALL' || b.prog === scope; }), g);
  });

  return {
    ok: true,
    year: year,
    years: L1_YEARS,
    extraction: extraction,
    generatedAt: nowStr_(),
    user: currentUser_(),
    globals: g,
    globalsMeta: params.globals.meta,
    blocks: blocks,
    debord: { pieces: debordPieces, capacity: g.debord_capacite, total: debordPieces.length },
    unmapped: unmappedList,
    kpis: kpis,
    warnings: warnings,
    stats: { zz84Rows: zzValues.length, piecesRows: parsed.pieces.length, repeatedHeaders: parsed.repeatedHeaders },
    paramsUrl: params.ss.getUrl()
  };
}

function blockStatus_(n, mini, maxi, cap) {
  if (n > cap) return 'DEBORD';
  if (n < mini) return 'ROUGE';
  if (n < maxi) return 'VERT';
  return 'PLEIN';
}

function blockLabel_(b) {
  return b.prog + ' ' + b.version + ' ' + b.bloc;
}

function computeKpis_(blocks, g) {
  var k = { blocks: blocks.length, aju: 0, cap: 0, avenir: 0, rouge: 0, vert: 0, plein: 0, debordBlocks: 0, debord: 0,
    oldest: null, ageAlert: 0 };
  blocks.forEach(function (b) {
    k.aju += b.aju; k.cap += b.cap; k.avenir += b.avenir; k.debord += b.excess;
    if (b.status === 'ROUGE') k.rouge++;
    else if (b.status === 'VERT') k.vert++;
    else if (b.status === 'PLEIN') k.plein++;
    else k.debordBlocks++;
    if (b.aju > 0 && (!k.oldest || b.ageMax > k.oldest.age)) k.oldest = { age: b.ageMax, blockId: b.id, label: blockLabel_(b) };
    if (b.ageMax > toNum_(g.age_seuil_jours)) k.ageAlert++;
  });
  k.fill = k.cap > 0 ? k.aju / k.cap : 0;
  return k;
}

/* ------------------------------------------------------------------ */
/* Lecture des onglets                                                 */
/* ------------------------------------------------------------------ */

/** « Données SAP du … à … » : F1 (date) et G1 (heure) de ZZ84. */
function readExtractionStamp_(ss, zzValues) {
  var out = { date: '', time: '' };
  try {
    var disp = ss.getSheetByName(SHEET_ZZ84).getRange('F1:G1').getDisplayValues()[0];
    out.date = str_(disp[0]);
    out.time = str_(disp[1]);
  } catch (e) { /* repli ci-dessous */ }
  var tz = 'Europe/Paris';
  try { tz = ss.getSpreadsheetTimeZone() || tz; } catch (e2) { /* défaut */ }
  var row0 = zzValues[0] || [];
  if (!out.date && row0[5] instanceof Date) out.date = Utilities.formatDate(row0[5], tz, 'dd/MM/yyyy');
  if (!out.time && row0[6] instanceof Date) out.time = Utilities.formatDate(row0[6], tz, 'HH:mm');
  // Heure affichée au format HH:mm même si la cellule montre les secondes
  var m = /^(\d{1,2}):(\d{2})/.exec(out.time);
  if (m) out.time = (m[1].length === 1 ? '0' : '') + m[1] + ':' + m[2];
  return out;
}

function buildPosteMap_(values, warnings) {
  var map = {}, nBuf = 0, nAju = 0;
  (values || []).forEach(function (r) {
    var poste = normRef_(r[2]), statut = normRef_(r[3]);
    if (!poste || (statut !== 'BUFFER' && statut !== 'AJU')) return;
    map[poste] = statut;
    if (statut === 'BUFFER') nBuf++; else nAju++;
  });
  if (!nBuf || !nAju) {
    if (values) warnings.push({ level: 'warn', msg: 'DATA Poste ne contient pas de poste ' + (!nBuf ? 'BUFFER' : 'AJU') + ' : table de secours utilisée.' });
    Object.keys(FALLBACK_POSTES).forEach(function (p) { if (!map[p]) map[p] = FALLBACK_POSTES[p]; });
  }
  return map;
}

function parseZZ84_(values, postes) {
  var headerRow = -1, cols = {}, fallback = [];
  for (var i = 0; i < Math.min(values.length, 15); i++) {
    var heads = values[i].map(normHead_);
    if (heads.indexOf('article') >= 0 && (heads.indexOf('postrav') >= 0 || heads.indexOf('postetravail') >= 0)) {
      headerRow = i;
      Object.keys(ZZ84_COLUMNS).forEach(function (k) {
        var def = ZZ84_COLUMNS[k];
        for (var j = 0; j < def.heads.length; j++) {
          var p = heads.indexOf(def.heads[j]);
          if (p >= 0) { cols[k] = p; break; }
        }
      });
      break;
    }
  }
  var headerFound = headerRow >= 0;
  if (!headerFound) headerRow = 2; // en-têtes attendus en ligne 3
  Object.keys(ZZ84_COLUMNS).forEach(function (k) {
    if (cols[k] === undefined) { cols[k] = ZZ84_COLUMNS[k].fallback; fallback.push(k); }
  });

  var pieces = [], repeated = 0;
  for (var r = headerRow + 1; r < values.length; r++) {
    var row = values[r];
    var ref = normRef_(row[cols.article]);
    var poste = normRef_(row[cols.poste]);
    if (!ref || !poste) continue; // lignes vides, totaux
    if (poste === 'POS.TRAV' || poste === 'POSTRAV' || ref === 'ARTICLE') { repeated++; continue; } // en-têtes répétés
    var statut = postes[poste];
    if (!statut) continue;
    pieces.push({
      ref: ref, poste: poste, statut: statut,
      qte: toNum_(row[cols.qte]),
      age: toNum_(row[cols.age]),
      ordre: str_(row[cols.ordre]).replace(/\.0+$/, ''),
      oper: str_(row[cols.oper]).replace(/\.0+$/, ''),
      designation: str_(row[cols.designation]).replace(/\s+/g, ' '),
      serie: str_(row[cols.serie])
    });
  }
  return { pieces: pieces, repeatedHeaders: repeated, headerFound: headerFound, headerFallback: headerFound && fallback.length ? fallback : null };
}

/**
 * Capacités L1 (Buffer = L1 FRAME) pour l'année choisie.
 * Doublons : la ligne « COMMUN » est conservée, l'autre ignorée.
 */
function loadL1_(yearKey) {
  var ss = openSource_(SOURCE_DIM_ID, SOURCE_DIM_NAME);
  var values = readSheet_(ss, SHEET_L1, SOURCE_DIM_NAME);
  var year = L1_YEARS.filter(function (y) { return y.key === yearKey; })[0] || L1_YEARS[2];
  var heads = (values[0] || []).map(function (h) { return String(h || ''); });

  // Colonne d'année repérée par l'en-tête (« 2026 - 2028 … », « 2028 + … »), repli J/K/L/M
  var yearCol = year.col;
  var patterns = { '2024': /^\s*2024(?!\s*-)/, '2025': /^\s*2025/, '2026-2028': /^\s*2026\s*-\s*2028/, '2028+': /^\s*2028\s*\+/ };
  for (var c = 0; c < heads.length; c++) {
    if (patterns[year.key].test(heads[c])) { yearCol = c; break; }
  }
  var colBuffer = 5, colRef = 0, colDes = 1, colAss = 2;
  heads.forEach(function (h, i) {
    var n = normHead_(h);
    if (n === 'buffer') colBuffer = i;
  });

  var caps = {}, duplicates = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var ref = normRef_(row[colRef]);
    if (!ref || String(row[colBuffer] || '').toUpperCase().indexOf('FRAME') < 0) continue;
    var ass = str_(row[colAss]);
    var entry = { value: toNum_(row[yearCol]), designation: str_(row[colDes]), assemblage: ass, row: r + 1 };
    if (caps[ref]) {
      var keepNew = /COMMUN/i.test(ass) && !/COMMUN/i.test(caps[ref].assemblage);
      duplicates.push({ ref: ref, kept: keepNew ? entry.row + ' (' + ass + ')' : caps[ref].row + ' (' + caps[ref].assemblage + ')',
        ignored: keepNew ? caps[ref].assemblage : ass });
      if (keepNew) caps[ref] = entry;
      continue;
    }
    caps[ref] = entry;
  }
  return { caps: caps, duplicates: duplicates, error: null };
}

function loadL1Safe_(yearKey) {
  try {
    return loadL1_(yearKey);
  } catch (e) {
    return { caps: {}, duplicates: [], error: e.message };
  }
}

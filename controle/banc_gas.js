/**
 * Banc de test Node : exécute le VRAI code Apps Script (apps-script/*.gs) avec des services Google simulés.
 * Les onglets sources proviennent des .xlsx locaux, exportés par :
 *   python controle/controle_buffer.py --json <sheets.json>
 * Usage : node controle/banc_gas.js <sheets.json> [sortie_dashboard.json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const sheetsFile = process.argv[2];
const outFile = process.argv[3];
if (!sheetsFile) { console.error('Usage : node banc_gas.js sheets.json [dashboard.json]'); process.exit(2); }

const raw = JSON.parse(fs.readFileSync(sheetsFile, 'utf8'));
const decode = (v) => (v && typeof v === 'object' && v.__date ? new Date(v.__date) : v);
const grid = (rows) => {
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => { const o = r.map(decode); while (o.length < w) o.push(''); return o; });
};

/* ---------------- Mocks SpreadsheetApp ---------------- */
class Range {
  constructor(sheet, r, c, nr, nc) { Object.assign(this, { sheet, r, c, nr, nc }); }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) {
        const v = (this.sheet.data[this.r - 1 + i] || [])[this.c - 1 + j];
        row.push(v === undefined || v === null ? '' : v);
      }
      out.push(row);
    }
    return out;
  }
  getDisplayValues() {
    return this.getValues().map((r) => r.map((v) => {
      if (v instanceof Date) {
        if (v.getFullYear() === 1899) return v.toTimeString().slice(0, 8);
        return v.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      }
      return String(v);
    }));
  }
  setValues(vals) {
    vals.forEach((row, i) => row.forEach((v, j) => this.sheet.set(this.r + i, this.c + j, v)));
    return this;
  }
  setValue(v) { this.sheet.set(this.r, this.c, v); return this; }
  setFontWeight() { return this; } setFontColor() { return this; } setBackground() { return this; }
  setDataValidation() { return this; }
}
class Sheet {
  constructor(name, data) { this.name = name; this.data = data || []; }
  set(r, c, v) {
    while (this.data.length < r) this.data.push([]);
    const row = this.data[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  getLastRow() { let n = this.data.length; while (n > 0 && this.data[n - 1].every((v) => v === '' || v === null || v === undefined)) n--; return n; }
  getLastColumn() { return Math.max(0, ...this.data.map((r) => r.length)); }
  getMaxRows() { return Math.max(1000, this.data.length); }
  getDataRange() { return new Range(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(a, b, c, d) {
    if (typeof a === 'string') {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(a);
      const col = (s) => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
      return new Range(this, +m[2], col(m[1]), +m[4] - +m[2] + 1, col(m[3]) - col(m[1]) + 1);
    }
    return new Range(this, a, b, c || 1, d || 1);
  }
  appendRow(row) { const r = this.getLastRow() + 1; row.forEach((v, j) => this.set(r, j + 1, v)); }
  deleteRow(r) { this.data.splice(r - 1, 1); }
  setFrozenRows() {} autoResizeColumns() {}
}
class Spreadsheet {
  constructor(id, sheets) { this.id = id; this.sheets = sheets; }
  getSheetByName(n) { return this.sheets.find((s) => s.name === n) || null; }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  getSheets() { return this.sheets; }
  deleteSheet(s) { this.sheets = this.sheets.filter((x) => x !== s); }
  getId() { return this.id; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/' + this.id; }
  getSpreadsheetTimeZone() { return 'Europe/Paris'; }
}
const books = {
  '1GXpxmUtseSCqkyI6hznbxlMjcb7RoEDe5GSPcjP2pnk': new Spreadsheet('pil', [new Sheet('ZZ84', grid(raw.ZZ84)), new Sheet('DATA Poste', grid(raw['DATA Poste']))]),
  '1_Je8iKhNsuKBq5pAXVqb7tPPa49luDxu6XNbmKns9PQ': new Spreadsheet('dim', [new Sheet('L1', grid(raw.L1))])
};
const validationBuilder = { requireValueInList() { return this; }, setAllowInvalid() { return this; }, build() { return {}; } };
const props = {}; const cache = {}; const triggers = [];
const pad = (n) => String(n).padStart(2, '0');

const ctx = {
  console,
  SpreadsheetApp: {
    openById(id) { if (!books[id]) throw new Error('not found'); return books[id]; },
    create(name) { const id = 'params-' + Date.now(); books[id] = new Spreadsheet(id, [new Sheet('Feuille 1')]); return books[id]; },
    newDataValidation() { return Object.create(validationBuilder); }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
  CacheService: { getScriptCache: () => ({
    get: (k) => (k in cache ? cache[k] : null),
    getAll: (ks) => Object.fromEntries(ks.filter((k) => k in cache).map((k) => [k, cache[k]])),
    putAll: (o) => { for (const k in o) { if (o[k].length > 100000) throw new Error('cache value too large'); cache[k] = o[k]; } },
    removeAll: (ks) => ks.forEach((k) => delete cache[k])
  }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, waitLock() {}, releaseLock() {} }) },
  Session: { getActiveUser: () => ({ getEmail: () => 'testeur@airbus.com' }), getEffectiveUser: () => ({ getEmail: () => 'owner@airbus.com' }) },
  Utilities: { formatDate(d, tz, f) {
    return f.replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate()))
      .replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())).replace(/'T'/, 'T');
  } },
  ScriptApp: {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
    newTrigger: (fn) => { const t = { fn, getHandlerFunction: () => fn }; const b = {
      timeBased: () => b, everyDays: () => b, atHour: (h) => { t.h = h; return b; }, nearMinute: (m) => { t.m = m; return b; },
      inTimezone: () => b, create: () => { triggers.push(t); return t; } }; return b; }
  },
  Logger: { log: (m) => console.log('  [Logger] ' + m) },
  HtmlService: {}
};
vm.createContext(ctx);
const dir = path.join(__dirname, '..', 'apps-script');
['Code.gs', 'Setup.gs', 'Params.gs', 'Data.gs', 'History.gs'].forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));

/* ---------------- Tests ---------------- */
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  OK   ' : '  ÉCHEC ') + msg); if (!cond) failures++; };
const EXPECTED = {
  'A320-NEOCEO-C36AVG': [3, 9], 'A320-NEOCEO-C36AVD': [9, 0], 'A320-NEOCEO-C36ARG': [4, 0], 'A320-NEOCEO-C36ARD': [4, 0],
  'A320-NEOCEO-C42AVG': [1, 4], 'A320-NEOCEO-C42AVD': [0, 4], 'A320-NEOCEO-C42ARG': [0, 2], 'A320-NEOCEO-C42ARD': [1, 2],
  'A321-ACF-C36AVG': [9, 4], 'A321-ACF-C36AVD': [8, 6], 'A321-ACF-C36ARG': [12, 8], 'A321-ACF-C36ARD': [12, 8],
  'A321-ACF-C42AVG': [6, 0], 'A321-ACF-C42AVD': [4, 0], 'A321-ACF-C42ARG': [3, 4], 'A321-ACF-C42ARD': [13, 4],
  'A321-XLR-C42AVG': [10, 0], 'A321-XLR-C42AVD': [6, 0], 'A321-XLR-C42ARG': [0, 1], 'A321-XLR-C42ARD': [0, 1]
};

console.log('1. setup()');
ctx.setup();
const pss = books[props.PARAMS_SPREADSHEET_ID];
check(pss && ['Parametres_Globaux', 'Parametres_Blocs', 'Mapping_Refs', 'Historique', 'Journal'].every((n) => pss.getSheetByName(n)), 'les 5 onglets Paramètres sont créés');
check(!pss.getSheetByName('Feuille 1'), 'onglet par défaut supprimé');
check(pss.getSheetByName('Parametres_Blocs').getLastRow() === 29, '28 blocs pré-remplis');
const aValider = pss.getSheetByName('Mapping_Refs').data.filter((r) => r[4] === 'OUI').map((r) => r[0]);
check(aValider.length === 7, 'hypothèses marquées « À valider » : ' + aValider.join(', '));
ctx.setup();
check(pss.getSheetByName('Parametres_Blocs').getLastRow() === 29, 'setup() idempotent (pas de doublon)');

console.log('2. getDashboardData() vs section 5');
const d = ctx.getDashboardData({});
check(d.extraction.date === '14/10/2026' && d.extraction.time === '04:41', 'horodatage SAP : ' + d.extraction.date + ' à ' + d.extraction.time);
const byId = Object.fromEntries(d.blocks.map((b) => [b.id, b]));
let tAju = 0, tVen = 0;
for (const [id, [aju, ven]] of Object.entries(EXPECTED)) {
  const b = byId[id];
  check(b && b.aju === aju && b.avenir === ven, id + ' : ' + (b ? b.aju + ' / ' + b.avenir : 'absent') + ' (attendu ' + aju + ' / ' + ven + ')');
  if (b) { tAju += b.aju; tVen += b.avenir; }
}
check(tAju === 105 && tVen === 57, 'totaux A320 + A321 : AJU ' + tAju + ', À venir ' + tVen);
check(d.kpis.A330.aju === 6, 'A330 AJU = ' + d.kpis.A330.aju);
check(byId['A330-COMMUN-C40ARG'].aju === 2 && byId['A330-NEO-C40AVG'].aju === 2 && byId['A330-NEO-C40AVD'].aju === 2, 'A330 : C40 AR G 2, C40 AV G 2, C40 AV D 2');
check(d.unmapped.length === 0, 'aucune réf non rattachée');
check(d.stats.repeatedHeaders === 7, 'en-têtes répétés filtrés : ' + d.stats.repeatedHeaders);
check(byId['A330-COMMUN-C40ARG'].cap === 2 && d.warnings.some((w) => /Doublon L1/.test(w.msg)), 'doublon L1 F571.12262 : ligne LR COMMUN gardée');
const c42avg = byId['A320-NEOCEO-C42AVG'];
check(c42avg.refs.some((r) => r.ref === 'D571.30422.200.00' && r.aju === 1 && r.aValider), 'CJ comptée dans A320 C42 AV G et marquée à valider');
const rk = Object.fromEntries(d.racks.map((r) => [r.id, r]));
check(d.racks.length === 22, 'racks physiques : ' + d.racks.length + ' (28 variantes)');
const r42 = rk['A321-C42AVG'];
check(r42 && r42.blockIds.length === 2 && r42.cap === 16 && r42.aju === 16 && r42.mini === 5 && r42.maxi === 16,
  'rack A321 C42 AV G partagé ACF + XLR : AJU 16 / capacité 14 + 2 = 16, mini 4 + 1, maxi 14 + 2');
check(r42.status === 'PLEIN' && r42.excess === 0 && byId['A321-XLR-C42AVG'].status === 'PLEIN', 'XLR 10 pcs absorbées par la place ACF : rack PLEIN, pas de débord');
check(rk['A321-C42AVD'].status === 'VERT' && rk['A321-C42AVD'].excess === 0, 'rack A321 C42 AV D : 10 / 16 VERT');
check(rk['A321-C42ARG'].aju === 3 && rk['A321-C42ARG'].avenir === 5 && rk['A321-C42ARG'].status === 'ROUGE', 'rack A321 C42 AR G : 3 / 16, à venir 5, ROUGE');
check(rk['A330-C40AVG'].cap === 2 && rk['A330-C40AVG'].status === 'PLEIN', 'rack A330 C40 AV G partagé NEO + CEO : 2 / 2 PLEIN');
check(d.debord.total === d.kpis.ALL.debord && d.debord.total === 3 && d.debord.pieces.every((p) => p.rackId === 'A320-C36AVD'),
  'débord total = Σ excédents des racks = ' + d.debord.total + ' (A320 C36 AV D)');
const ages = d.debord.pieces.map((p) => p.age);
check(ages.every((a, i) => i === 0 || ages[i - 1] >= a), 'débord trié FIFO (plus ancienne d\'abord)');
check(byId['A320-NEOCEO-C42AVD'].status === 'ROUGE' && byId['A321-ACF-C36AVG'].status === 'VERT', 'statuts ROUGE / VERT');
check(JSON.stringify(d).length < 400000, 'taille JSON : ' + Math.round(JSON.stringify(d).length / 1024) + ' Ko');

console.log('3. cache');
const d2 = ctx.getDashboardData({});
check(d2.fromCache === true, 'second appel servi depuis le cache');
check(ctx.getDashboardData({ force: true }).fromCache === false, 'Actualiser (force) recalcule');

console.log('4. années / unité');
const d24 = ctx.getDashboardData({ year: '2024' });
check(d24.year === '2024' && d24.blocks.find((b) => b.id === 'A321-ACF-C36AVG').cap === 11, 'année 2024 : A321 C36 AV G capacité 11');
const d28 = ctx.getDashboardData({ year: '2028+' });
check(d28.blocks.find((b) => b.id === 'A330-NEOCEO-C47G').cap === 4, 'année 2028+ : C47 G capacité 4');

console.log('5. saveBlockParams');
let r = ctx.saveBlockParams([{ blockId: 'A321-ACF-C42ARG', mini: 4 }, { blockId: 'A321-ACF-C42ARD', mini: 4 }]);
check(r.saved.length === 2 && r.errors.length === 0, 'modif en masse mini 4 sur A321 C42 AR');
let d3 = ctx.getDashboardData({});
check(d3.fromCache === false, 'cache vidé après écriture');
check(d3.blocks.find((b) => b.id === 'A321-ACF-C42ARG').mini === 4 && d3.blocks.find((b) => b.id === 'A321-ACF-C42ARG').overrides.mini, 'mini surchargé = 4');
r = ctx.saveBlockParams([{ blockId: 'A321-XLR-C42AVG', mini: 5 }]);
check(r.errors.length === 1, 'contrôle mini ≤ maxi refusé : ' + (r.errors[0] || {}).message);
r = ctx.saveBlockParams([{ blockId: 'A321-XLR-C42AVG', cap: 12, maxi: 10, mini: 3 }]);
d3 = ctx.getDashboardData({});
const x = d3.blocks.find((b) => b.id === 'A321-XLR-C42AVG');
const xr = d3.racks.find((rr) => rr.id === 'A321-C42AVG');
check(r.saved.length === 1 && x.cap === 12 && x.maxi === 10 && xr.cap === 26 && xr.maxi === 24 && xr.status === 'VERT',
  'XLR capacité 12 / maxi 10 → rack 26 places, maxi 24 → VERT');
ctx.saveBlockParams([{ blockId: 'A321-XLR-C42AVG', reset: true }]);
check(ctx.getDashboardData({}).blocks.find((b) => b.id === 'A321-XLR-C42AVG').cap === 2, 'Réinitialiser aux valeurs L1');
ctx.saveBlockParams([{ blockId: 'A321-ACF-C36ARG', unit: 'emplacements' }]);
const empl = ctx.getDashboardData({}).blocks.find((b) => b.id === 'A321-ACF-C36ARG');
check(empl.cap === 28 && empl.ppe === 2, 'unité emplacements sur un AR : 14 empl. × 2 = 28 pièces');
ctx.saveBlockParams([{ blockId: 'A321-ACF-C36ARG', unit: null }]);

console.log('6. saveGlobalParams / journal');
ctx.saveGlobalParams({ debord_capacite: 40, mini_pct: 30, heures_photo: '6h;13:30;21:00' });
const d4 = ctx.getDashboardData({});
check(d4.globals.debord_capacite === 40 && d4.globalsMeta.debord_capacite.by === 'testeur@airbus.com', 'capacité débord 40, modifiée par testeur@airbus.com le ' + d4.globalsMeta.debord_capacite.at);
check(d4.blocks.find((b) => b.id === 'A321-ACF-C36AVG').mini === 4, 'mini % 30 → ceil(0,3 × 13) = 4');
check(triggers.length === 3, 'heures de photo modifiées → 3 déclencheurs réinstallés');
const j = ctx.getJournal(10);
check(j.length >= 5 && j.some((e) => e.champ === 'debord_capacite' && e.avant === '35' && e.apres === '40'), 'journal : ' + j.length + ' entrées, ancienne / nouvelle valeur tracées');

console.log('7. saveMapping / réfs non rattachées');
ctx.saveMapping([{ ref: 'D571.30422.200.00', remove: true }]);
let d5 = ctx.getDashboardData({});
check(d5.unmapped.length === 1 && d5.unmapped[0].ref === 'D571.30422.200.00' && d5.unmapped[0].aju === 1, 'réf retirée du mapping → remonte dans « non rattachées »');
ctx.saveMapping([{ ref: 'd571.30422.200.00 ', blockId: 'A320-NEOCEO-C42AVG', type: 'CJ', versionRef: 'CJ', aValider: true }]);
d5 = ctx.getDashboardData({});
check(d5.unmapped.length === 0 && d5.blocks.find((b) => b.id === 'A320-NEOCEO-C42AVG').aju === 1, 'rattachement depuis l\'appli (réf normalisée)');

console.log('8. historique');
ctx.installTriggers();
check(triggers.length === 3 && triggers.every((t) => t.fn === 'takeSnapshot'), 'installTriggers()');
const s = ctx.takeSnapshot();
ctx.takeSnapshot();
check(s.rows === 32, 'photo : 4 lignes KPI + 28 blocs = ' + s.rows);
const h = ctx.getHistoryData(30);
check(h.kpi.ALL.length === 2 && Object.keys(h.blocks).length === 28, 'getHistoryData : ' + h.kpi.ALL.length + ' points KPI, ' + Object.keys(h.blocks).length + ' sparklines');

console.log('8b. colonne Rack');
const shB = pss.getSheetByName('Parametres_Blocs');
const rackCol = shB.data[0].indexOf('Rack');
const xlrRow = shB.data.findIndex((row) => row[0] === 'A321-XLR-C42AVG');
check(rackCol === 16 && shB.data[xlrRow][rackCol] === 'A321-C42AVG', 'colonne Rack pré-remplie (programme + bloc)');
shB.data[xlrRow][rackCol] = 'A321-C42AVG-XLR';
let dr = ctx.getDashboardData({ force: true });
check(dr.racks.find((rr) => rr.id === 'A321-C42AVG-XLR').excess === 8, 'Rack distinct saisi → XLR repart seul : débord +8');
shB.data.forEach((row) => row.splice(rackCol, 1)); // ancien classeur sans colonne Rack
dr = ctx.getDashboardData({ force: true });
check(dr.racks.length === 22 && dr.debord.total === 3, 'classeur sans colonne Rack → regroupement par défaut');
ctx.setup();
check(shB.data[0].indexOf('Rack') >= 0, 'setup() ajoute l\'en-tête Rack manquant');

console.log('9. robustesse');
const zz = books['1GXpxmUtseSCqkyI6hznbxlMjcb7RoEDe5GSPcjP2pnk'].getSheetByName('ZZ84');
const backup = zz.data.map((row) => row.slice());
zz.data.forEach((row) => row.splice(1, 0, '')); // décalage d'une colonne
zz.data.forEach((row, i) => { if (i > 5 && row[14] !== '' && typeof row[14] === 'number') row[14] = String(row[14]).replace('.', ','); }); // Qté en texte
zz.data.forEach((row, i) => { if (i > 5 && typeof row[5] === 'string' && row[5]) row[5] = ' ' + row[5].toLowerCase() + '\n'; }); // réfs sales
const d6 = ctx.getDashboardData({ force: true });
const t6 = d6.blocks.filter((b) => b.prog !== 'A330').reduce((a, b) => [a[0] + b.aju, a[1] + b.avenir], [0, 0]);
check(t6[0] === 105 && t6[1] === 57, 'colonne décalée + nombres en texte + réfs sales : ' + t6.join(' / '));
zz.data = backup;
books['1GXpxmUtseSCqkyI6hznbxlMjcb7RoEDe5GSPcjP2pnk'].sheets = books['1GXpxmUtseSCqkyI6hznbxlMjcb7RoEDe5GSPcjP2pnk'].sheets.filter((x) => x.name !== 'DATA Poste');
const d7 = ctx.getDashboardData({ force: true });
check(d7.kpis.ALL.aju === 111 && d7.warnings.some((w) => /DATA Poste/.test(w.msg)), 'DATA Poste absent → table de secours + avertissement');
let err = '';
books['1GXpxmUtseSCqkyI6hznbxlMjcb7RoEDe5GSPcjP2pnk'].sheets = books['1GXpxmUtseSCqkyI6hznbxlMjcb7RoEDe5GSPcjP2pnk'].sheets.filter((x) => x.name !== 'ZZ84');
try { ctx.getDashboardData({ force: true }); } catch (e) { err = e.message; }
check(/Onglet « ZZ84 » introuvable/.test(err), 'message clair : ' + err);
const dimBook = books['1_Je8iKhNsuKBq5pAXVqb7tPPa49luDxu6XNbmKns9PQ'];
delete books['1_Je8iKhNsuKBq5pAXVqb7tPPa49luDxu6XNbmKns9PQ'];
books['1GXpxmUtseSCqkyI6hznbxlMjcb7RoEDe5GSPcjP2pnk'].sheets.push(new Sheet('ZZ84', backup));
const d8 = ctx.getDashboardData({ force: true });
check(d8.warnings.some((w) => w.level === 'error' && /Pas d'accès au fichier « Dimensionnement/.test(w.msg)), 'L1 inaccessible → avertissement, appli toujours utilisable');
books['1_Je8iKhNsuKBq5pAXVqb7tPPa49luDxu6XNbmKns9PQ'] = dimBook;

if (outFile) {
  // Jeu de données de démonstration pour la prévisualisation locale du front (paramètres par défaut)
  ctx.saveGlobalParams({ debord_capacite: 35, mini_pct: 25, heures_photo: '06:00;13:30' });
  ctx.saveBlockParams([{ blockId: 'A321-ACF-C42ARG', reset: true }, { blockId: 'A321-ACF-C42ARD', reset: true }]);
  const demo = ctx.getDashboardData({ force: true });
  fs.writeFileSync(outFile, JSON.stringify({ dashboard: demo, history: ctx.getHistoryData(30), journal: ctx.getJournal(20) }));
  console.log('Jeu de démonstration écrit : ' + outFile);
}
console.log(failures ? '\nRÉSULTAT : ' + failures + ' échec(s)' : '\nRÉSULTAT : tous les tests passent');
process.exit(failures ? 1 : 0);

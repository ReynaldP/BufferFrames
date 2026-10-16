/**
 * Construit une page de prévisualisation locale du front (sans Apps Script) :
 * assemble Index.html + Styles.html + App.js.html et simule google.script.run avec le JSON du banc Node.
 * Usage : node controle/build_preview.js <demo.json> <dossier_sortie>
 * L'historique est complété par des points synthétiques (prévisualisation uniquement).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const [demoFile, outDir] = process.argv.slice(2);
const dir = path.join(__dirname, '..', 'apps-script');
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const demo = JSON.parse(fs.readFileSync(demoFile, 'utf8'));

// Historique synthétique sur 20 jours (2 photos / jour) pour voir courbes et sparklines
const h = { kpi: { ALL: [], A320: [], A321: [], A330: [] }, blocks: {}, days: 90 };
const base = new Date('2026-09-25T06:00:00');
let seed = 7;
const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
for (let d = 0; d < 20; d++) {
  for (const hh of [6, 13.5]) {
    const t = new Date(base.getTime() + d * 86400000 + (hh - 6) * 3600000);
    const ts = t.toISOString().slice(0, 16);
    let rouges = 0, deb = 0, aju = 0, cap = 0;
    demo.dashboard.blocks.forEach((b) => {
      const v = Math.max(0, Math.round(b.aju + (rnd() - 0.5) * Math.max(2, b.cap * 0.6) - (19 - d) * 0.05 * b.cap));
      (h.blocks[b.id] = h.blocks[b.id] || []).push({ t: ts, aju: v, status: v < b.mini ? 'ROUGE' : v > b.cap ? 'DEBORD' : 'VERT' });
      if (b.prog !== 'A330') { if (v < b.mini) rouges++; deb += Math.max(0, v - b.cap); aju += v; cap += b.cap; }
    });
    h.kpi.ALL.push({ t: ts, aju, cap, fill: Math.round(aju / cap * 1000) / 10, debord: deb, rouges });
  }
}

const mock = `<script>
window.onerror = function (m, s, l) { document.body.insertAdjacentHTML('afterbegin', '<pre id="js-error" style="background:red;color:#fff;padding:8px">JS : ' + m + ' (ligne ' + l + ')</pre>'); };
// Interactions simulées pour les captures : #open (déplier une ligne), #mass (modale de masse)
window.addEventListener('load', function () { setTimeout(function () {
  if (location.hash === '#open') { var r = document.querySelectorAll('.row')[1]; r && r.click(); }
  if (location.hash === '#mass') document.querySelector('#btn-mass').click();
  if (location.hash === '#filters') document.querySelector('#btn-filters').click();
  if (location.hash === '#open321') { var r2 = document.querySelector('#row-A321-C42AVG'); r2 && r2.click(); }
  if (location.hash === '#overflow') {
    var W = document.documentElement.clientWidth, out = ['clientWidth=' + W + ' scrollWidth=' + document.documentElement.scrollWidth];
    Array.prototype.forEach.call(document.querySelectorAll('body *'), function (el) {
      var r = el.getBoundingClientRect();
      if (r.right > W + 1 && el.children.length < 3) out.push(el.tagName + '.' + el.className + ' right=' + Math.round(r.right) + ' w=' + Math.round(r.width));
    });
    var pre = document.createElement('pre'); pre.id = 'ovf'; pre.textContent = out.slice(0, 40).join('\\n'); document.body.appendChild(pre);
  }
}, 900); });
window.__DEMO__ = ${JSON.stringify({ dashboard: demo.dashboard, history: h, journal: demo.journal })};
window.google = { script: {
  run: (function () {
    function make(ok, ko) {
      var api = {
        withSuccessHandler: function (f) { return make(f, ko); },
        withFailureHandler: function (f) { return make(ok, f); }
      };
      var resp = {
        getDashboardData: function () { return JSON.parse(JSON.stringify(window.__DEMO__.dashboard)); },
        getHistoryData: function () { return window.__DEMO__.history; },
        getJournal: function () { return window.__DEMO__.journal; },
        saveBlockParams: function (c) { return { saved: c.map(function (x) { return x.blockId; }), errors: [] }; },
        saveGlobalParams: function () { return { saved: 1 }; },
        saveMapping: function () { return { saved: 1 }; },
        takeSnapshotManual: function () { return { rows: 32 }; }
      };
      Object.keys(resp).forEach(function (k) { api[k] = function () { var a = arguments; setTimeout(function () { ok && ok(resp[k].apply(null, a)); }, 150); }; });
      return api;
    }
    return make(null, null);
  })(),
  url: { getLocation: function (cb) { var p = {}; new URLSearchParams(location.search).forEach(function (v, k) { p[k] = v; }); cb({ parameter: p }); } },
  history: { replace: function () {}, push: function () {} }
} };
</script>`;

for (const mode of ['app', 'tv']) {
  let html = read('Index.html')
    .replace("<?!= include('Styles'); ?>", read('Styles.html'))
    .replace("<?!= include('App.js'); ?>", mock + read('App.js.html'))
    .replace("<?= mode === 'tv' ? 'tv' : 'app' ?>", mode)
    .replace('<?= mode ?>', mode);
  if (/<\?/.test(html)) throw new Error('scriptlet non remplacé');
  fs.writeFileSync(path.join(outDir, 'preview_' + mode + '.html'), html);
}
console.log('Prévisualisations écrites dans ' + outDir);

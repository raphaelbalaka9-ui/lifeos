/* LifeOS — moteur d'affichage des écrans.
   Lit les écrans conçus dans Claude Design (format .dc.html), les affiche avec React,
   gère la navigation, le thème clair/sombre global et la sauvegarde locale des données. */
(function () {
  'use strict';
  var R = window.React, RD = window.ReactDOM, h = R.createElement;
  var SCREENS = window.LIFEOS_SCREENS || {};
  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var TRANSIENT = ['switching', 'running', 'tick', 'theme', 'edit', 'msg', 'confirmReset', 'resetting', 'left', 'dur', 'copied', 'proj', 'ciDrag', 'ciFrac', 'ciSw', 'ciFly', 'ciHold', 'ciFx', 'ciBump', 'ciMic', 'ciRankUp', 'sheet', 'pickSel', 'prMsg', 'rdMsg', 'brdBusy', 'brdMsg', 'brdCopied', 'brdCode', 'brdPseudo', 'brdAt', 'plSheet', 'plTick', 'plSel', 'hbMsg', 'newTaskM', 'revOpen', 'revAmt', 'revSrc', 'hitAt', 'hitAmt'];

  var store = {
    get: function (k) { try { var v = localStorage.getItem('lifeos:' + k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set: function (k, v) { var changed = false; try { var nv = JSON.stringify(v), key = 'lifeos:' + k; changed = localStorage.getItem(key) !== nv; localStorage.setItem(key, nv); } catch (e) { /* stockage indisponible */ } userDirty = true; if (changed && k !== 'screen' && k !== 'sync') cloudTouch(); },
    del: function (k) { try { localStorage.removeItem('lifeos:' + k); } catch (e) {} },
    keys: function () { try { return Object.keys(localStorage).filter(function (k) { return k.indexOf('lifeos:') === 0; }); } catch (e) { return []; } }
  };
  var userDirty = true;
  var cloudTouch = function () {};

  /* ---------- Réglages (langue, prénom, devise) ---------- */
  var SETTINGS = Object.assign({ lang: 'fr', name: '', currency: '€', rate: 52.44, rateDate: '2026-11-09' }, store.get('settings') || {});

  /* ---------- Devise : tout est enregistré en euros, l'affichage est converti ---------- */
  var MONEY_RE = /(\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)\s?€/g;
  function rate() { var r = Number(SETTINGS.rate); return r > 1 ? r : 52.44; }
  function fmtNum(n, dec) { return n.toLocaleString('fr-FR', { maximumFractionDigits: dec || 0 }); }
  function toRs(str) {
    return str.replace(MONEY_RE, function (m, num) {
      var v = Number(num.replace(/[ \u00a0\u202f]/g, '').replace(',', '.'));
      return isNaN(v) ? m : fmtNum(Math.round(v * rate())) + ' Rs';
    }).replace(/€/g, 'Rs');
  }
  /* texte d'un palier tapé par l'utilisateur ("5 000 Rs/mois") -> enregistré en euros ("95 €/mois") */
  function amountToEur(txt) {
    var t = String(txt || '');
    if (!/Rs|roupie/i.test(t) && !(SETTINGS.currency === 'Rs' && !/€/.test(t))) return t;
    var m = t.match(/\d[\d \u00a0\u202f]*(?:[.,]\d+)?/);
    if (!m) return t;
    var v = Number(m[0].replace(/[ \u00a0\u202f]/g, '').replace(',', '.')) / rate();
    var eur = fmtNum(Math.round(v)) + ' €';
    return t.replace(m[0], eur + ' ').replace(/\s*(Rs|roupies?)\b/i, '').replace(/€\s+\//, '€/').replace(/\s{2,}/g, ' ').trim();
  }
  function rateRefresh() {
    var age = Date.now() - (SETTINGS.rateAt || 0);
    if (age < 12 * 3600 * 1000 || !window.fetch) return;
    fetch('https://open.er-api.com/v6/latest/EUR').then(function (r) { return r.json(); }).then(function (j) {
      var v = j && j.rates && Number(j.rates.MUR);
      if (j && j.result === 'success' && v > 1) window.LifeOS.set({ rate: Math.round(v * 100) / 100, rateDate: isoDay(new Date()), rateAt: Date.now() });
    }).catch(function () { /* hors ligne : on garde le dernier taux connu */ });
  }
  var bump = function () {};
  try { document.documentElement.lang = SETTINGS.lang; } catch (e) {}

  /* ---------- Traduction à l'affichage (le français est la langue d'origine) ---------- */
  var EN = window.LIFEOS_EN || [], enMap = null, enRe = null, trCache = {}, trCount = 0;
  var USER_KEYS = { nom: 1, metier: 1, ville: 1, contact: 1, note: 1, tpl: 1, t: 1, n: 1, title: 1, name: 1, l: 1, src: 1, goal: 1, kpi: 1, desc: 1, txt: 1, bien: 1, frein: 1, appris: 1, who: 1, sub: 1, amount: 1, monthNote: 1, monthTitle: 1, bossName: 1, palChip: 1, when: 1, linkLabel: 1, l1: 1, l2: 1, l3: 1, c: 1 };
  var userSet = {};
  function collectUser(v, key) {
    if (v == null) return;
    if (typeof v === 'string') { if (key && USER_KEYS[key]) userSet[v.trim()] = 1; return; }
    if (Array.isArray(v)) { v.forEach(function (x) { collectUser(x, key === 'projects' || key === 'habits' ? 'n' : key); }); return; }
    if (typeof v === 'object') Object.keys(v).forEach(function (k) { collectUser(v[k], k); });
  }
  var userList = [], liveState = null;
  function userStrings() {
    if (!userDirty) return userSet;
    userSet = {}; userDirty = false; trCache = {}; trCount = 0;
    store.keys().forEach(function (k) {
      if (k.indexOf('lifeos:state:') !== 0 && k.indexOf('lifeos:shared:') !== 0) return;
      try { collectUser(JSON.parse(localStorage.getItem(k)), null); } catch (e) {}
    });
    if (liveState) collectUser(liveState, null);
    /* ce que tu as écrit toi-même n'est jamais traduit, sauf si c'est exactement un texte connu du dictionnaire */
    if (!enMap) trEn('');
    userList = Object.keys(userSet).filter(function (u) { return u.length >= 4 && enMap[u.toLowerCase()] == null; }).sort(function (a, b) { return b.length - a.length; });
    return userSet;
  }
  function trSafe(str) {
    userStrings();
    var t = str.trim();
    if (enMap[t.toLowerCase()] == null && userSet[t]) return str;
    /* zones écrites par l'utilisateur : une traduction ne peut pas en modifier un morceau */
    var zones = [];
    for (var i = 0; i < userList.length; i++) {
      var u = userList[i], at = str.indexOf(u);
      while (at >= 0) { zones.push([at, at + u.length]); at = str.indexOf(u, at + u.length); }
    }
    return trEn(str, zones);
  }
  function esc(x) { return x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function trEn(str, zones) {
    if (!enRe) {
      enMap = {};
      var list = EN.slice().sort(function (a, b) { return b[0].length - a[0].length; });
      list.forEach(function (p) { enMap[p[0].toLowerCase()] = p[1]; });
      enRe = new RegExp('(?<![A-Za-zÀ-ÿ0-9])(' + list.map(function (p) { return esc(p[0]); }).join('|') + ')(?![A-Za-zÀ-ÿ0-9])', 'gi');
    }
    return str.replace(enRe, function (m) {
      var r = enMap[m.toLowerCase()];
      if (r == null) return m;
      if (zones && zones.length) {
        var o = arguments[arguments.length - 2], e = o + m.length;
        for (var z = 0; z < zones.length; z++) {
          var za = zones[z][0], zb = zones[z][1];
          if (za < e && zb > o && !(o <= za && e >= zb && (o < za || e > zb))) return m;
        }
      }
      var c = m.charAt(0);
      if (m.length > 1 && m === m.toUpperCase() && m !== m.toLowerCase()) return r.toUpperCase();
      if (c !== c.toLowerCase() && c === c.toUpperCase()) r = r.charAt(0).toUpperCase() + r.slice(1);
      return r;
    });
  }
  function out(str) {
    if (typeof str !== 'string' || !str) return str;
    var en = SETTINGS.lang === 'en', rs = SETTINGS.currency === 'Rs';
    if (!en && !rs) return str;
    var key = (en ? 'e' : 'f') + (rs ? 'r' : 'e') + str;
    if (en && userDirty) userStrings();
    if (trCache[key] != null) return trCache[key];
    var r = str;
    if (en && EN.length) r = trSafe(r);
    if (rs) r = toRs(r);
    if (trCount++ > 4000) { trCache = {}; trCount = 0; }
    trCache[key] = r;
    return r;
  }

  /* Données partagées entre les pages (une seule source pour toute l'appli) */
  var SHARED = ['habits', 'revenus', 'tasks', 'cfLog', 'focusLog', 'revueWeek', 'paliers', 'focusRun', 'prospects', 'cfRep', 'cfRdv', 'cfCli', 'checkins'];
  var DEFAULTS = {
    habits: [
      { id: 'planif', n: 'Préparer demain (5 min)', area: 'Perso', goal: 'Mieux m\'organiser', log: {} },
      { id: 'sport', n: '20 min de sport', area: 'Santé', goal: 'Énergie et discipline', log: {} },
      { id: 'lire', n: 'Lire 10 pages', area: 'Perso', goal: 'Apprendre chaque jour', log: {} }
    ],
    checkins: {}, revenus: [], tasks: [], cfLog: {}, focusLog: {}, revueWeek: '', prospects: [], cfRep: 0, cfRdv: 0, cfCli: 0, focusRun: { dur: 25, running: false, endAt: 0, left: 1500, task: '' },
    paliers: [
      { amount: '100 €', desc: 'Tes premiers euros en ligne', state: 'En cours' },
      { amount: '1 000 €/mois', desc: 'Un vrai revenu en ligne', state: 'Ensuite' },
      { amount: '5 000 €/mois', desc: 'Ta liberté financière', state: 'Objectif' },
      { amount: '10 000 €/mois et plus', desc: 'Passer à l\'échelle', state: 'Au-delà' }
    ]
  };
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function isoDay(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function weekKey(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return isoDay(x); }
  /* Flamme qui pardonne : 1 joker par semaine (un soir raté ne casse pas la série) + mode pause (partiels…) */
  function pausedOn(day) { var P = store.get('pauses') || []; for (var i = 0; i < P.length; i++) if (day >= P[i].from && day <= P[i].to) return true; return false; }
  function flameAt(C, d) {
    C = C || {}; var keys = Object.keys(C).filter(function (k) { return /^\d{4}-\d\d-\d\d$/.test(k) && C[k]; }).sort(), first = keys[0];
    var res = { n: 0, jokerWeeks: {}, pausedDays: 0 };
    if (!first) return res;
    var x = new Date(d + 'T12:00:00');
    for (var guard = 0; guard < 4000; guard++) {
      var day = isoDay(x); if (day < first) break;
      if (C[day]) res.n++;
      else if (pausedOn(day)) res.pausedDays++;
      else { var wk = weekKey(x); if (res.jokerWeeks[wk]) break; res.jokerWeeks[wk] = day; }
      x.setDate(x.getDate() - 1);
    }
    return res;
  }
  function flameNow(C) {
    C = C || store.get('shared:checkins') || {}; var now = new Date(), tdy = isoDay(now), y = new Date(now); y.setDate(y.getDate() - 1);
    var r = flameAt(C, C[tdy] ? tdy : isoDay(y)), wk = weekKey(now), P = (store.get('pauses') || []).filter(function (p) { return p.to >= tdy; })[0];
    return { n: r.n, jokerUsed: !!r.jokerWeeks[wk], jokerDay: r.jokerWeeks[wk] || null, paused: !!(P && P.from <= tdy), pause: P || null };
  }

  /* Remise à zéro des anciennes données d'exemple (une seule fois) */
  var dv = store.get('dataVersion');
  if (dv !== 2 && dv !== 3 && dv !== 4 && dv !== 5 && dv !== 6 && dv !== 7) {
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('lifeos:state:') === 0) localStorage.removeItem(k); }); } catch (e) {}
    dv = 2; store.set('dataVersion', 2);
  }
  /* Passage aux données partagées et datées (une seule fois, garde tes données) */
  if (dv === 2) {
    try {
      var now0 = new Date(), today0 = isoDay(now0);
      var back = function (n) { var d = new Date(); d.setDate(d.getDate() - n); return isoDay(d); };
      var M = store.get('state:Main') || {}, H = store.get('state:Habitudes') || {}, P = store.get('state:Productivity') || {}, D = store.get('state:Developpement') || {};
      if (H.habits || M.habits) {
        var AREA = { copyfy: ['Business', 'Mon projet'], sport: ['Santé', 'Sport 3 fois par semaine'], apprendre: ['Perso', 'Un livre business par mois'] };
        var list = [], byId = {};
        (H.habits || []).forEach(function (h) {
          var log = {}, hist = h.hist || [];
          for (var i = 0; i < hist.length; i++) { if (hist[i] === 1 || hist[i] === 0) log[back(hist.length - i)] = hist[i]; }
          if (h.done) log[today0] = 1;
          var o = { id: h.id, n: h.n, area: h.area || 'Perso', goal: h.goal || 'Aucun objectif lié', log: log };
          byId[h.id] = o; list.push(o);
        });
        (M.habits || []).forEach(function (h) {
          var o = byId[h.id];
          if (!o) { var a = AREA[h.id] || ['Perso', 'Aucun objectif lié']; o = { id: h.id, n: h.n, area: a[0], goal: a[1], log: {} }; byId[h.id] = o; list.push(o); }
          var hist = h.hist || [];
          for (var i = 0; i < hist.length; i++) { if (hist[i] === 1 || hist[i] === true) o.log[back(hist.length - i)] = 1; }
          if (h.done) o.log[today0] = 1;
        });
        store.set('shared:habits', list);
      }
      if (M.revenus) store.set('shared:revenus', M.revenus.map(function (r) { return Object.assign({ d: today0 }, r); }));
      if (P.tasks) store.set('shared:tasks', P.tasks);
      if (M.cfLog) store.set('shared:cfLog', M.cfLog);
      if (P.sessions || P.minutes) { var fl = {}; fl[today0] = { s: P.sessions || 0, m: P.minutes || 0 }; store.set('shared:focusLog', fl); }
      if (M.revueDone || D.weekDone) store.set('shared:revueWeek', weekKey(now0));
      if (M.prios) { M.prios = M.prios.map(function (p) { return Object.assign({ day: today0 }, p); }); store.set('state:Main', M); }
    } catch (e) { /* on garde l'appli utilisable même si la migration échoue */ }
    store.set('dataVersion', 3); dv = 3;
  }
  var BOOT_HAS_DATA = (function () { try { return Object.keys(localStorage).some(function (k) { return /^lifeos:state:/.test(k) || k === 'lifeos:shared:checkins' || k === 'lifeos:shared:revenus'; }); } catch (e) { return false; } })();
  /* Nettoyage : plus aucune trace des anciens projets perso (Copyfy, prospection, agents), une seule fois */
  (function () {
    try {
      if (store.get('cleanV9')) return;
      var OLD = /copyfy|copify|prospect/i;
      var hb = store.get('shared:habits');
      if (hb) store.set('shared:habits', hb.filter(function (h) { return h.id !== 'copyfy' && !OLD.test(h.n || '') && !OLD.test(h.goal || ''); }));
      ['prospects', 'cfLog', 'cfRep', 'cfRdv', 'cfCli'].forEach(function (k) { store.del('shared:' + k); });
      ['state:Prospects', 'state:Agents'].forEach(function (k) { store.del(k); });
      var tk = store.get('shared:tasks'); if (tk) store.set('shared:tasks', tk.filter(function (t) { return !OLD.test(t.t || ''); }));
      var rv = store.get('shared:revenus'); if (rv) store.set('shared:revenus', rv.map(function (r) { return OLD.test(r.src || '') ? Object.assign({}, r, { src: 'Mon projet' }) : r; }));
      var ck = store.get('shared:checkins');
      if (ck) {
        Object.keys(ck).forEach(function (k) {
          var d = ck[k] && ck[k].d; if (!d) return;
          if (OLD.test(d.src || '')) d.src = 'Mon projet';
          if (d.win === 'copyfy' || d.win === 'prospection') d.win = 'projet';
          if (d.win === 'cookies') d.win = 'travail';
          delete d.pros; delete d.rep; delete d.rdv; delete d.cli;
        });
        store.set('shared:checkins', ck);
      }
      var M = store.get('state:Main');
      if (M) {
        if (M.prios) M.prios = M.prios.filter(function (x) { return !OLD.test(x.t || ''); });
        if (M.week) M.week = M.week.filter(function (x) { return !OLD.test(x.l || ''); });
        ['cfLog', 'cfRep', 'cfRdv', 'cfCli', 'cfObj', 'prospects'].forEach(function (k) { delete M[k]; });
        store.set('state:Main', M);
      }
      var P = store.get('state:Productivity');
      if (P) {
        if (P.projects) P.projects = P.projects.map(function (x) { return OLD.test(x.name || '') || OLD.test(x.goal || '') ? Object.assign({}, x, { name: OLD.test(x.name || '') ? 'Mon projet' : x.name, goal: OLD.test(x.goal || '') ? '' : x.goal }) : x; });
        if (P.events) P.events = P.events.filter(function (x) { return !OLD.test(x.l || ''); });
        if (P.inbox) P.inbox = P.inbox.filter(function (x) { return !OLD.test(typeof x === 'string' ? x : (x.t || x.l || '')); });
        store.set('state:Productivity', P);
      }
      var O = store.get('state:Objectifs');
      if (O && O.goals) { O.goals = O.goals.filter(function (x) { return !OLD.test((x.t || '') + ' ' + (x.title || '') + ' ' + (x.kpi || '') + ' ' + (x.desc || '')); }); store.set('state:Objectifs', O); }
      var H = store.get('state:Habitudes'); if (H && H.sel === 'copyfy') { delete H.sel; store.set('state:Habitudes', H); }
    } catch (e) {}
    store.set('cleanV9', true);
  })();
  /* Planning de Raphaël (semaines A/B), posé une seule fois sur son PC ou son téléphone */
  (function () {
    try {
      if (store.get('planV8')) return;
      var mine = location.protocol === 'file:' || /^rapha/i.test(String(SETTINGS.name || '').trim());
      if (!mine) return;
      var M = store.get('state:Main') || {};
      if (M.week) store.set('weekBackup', M.week);
      M.week = [
        { d: [1], w: 'B', s: '07:45', e: '14:40', k: 'stage', l: 'Cours' },
        { d: [1], w: 'A', s: '07:45', e: '13:40', k: 'stage', l: 'Cours' },
        { d: [2, 3, 4], s: '07:45', e: '14:40', k: 'stage', l: 'Cours' },
        { d: [5], s: '07:45', e: '11:45', k: 'stage', l: 'Cours' },
        { d: [1, 3], s: '15:30', e: '16:45', k: 'sport', l: 'Sport (salle)', c: 'Sport' },
        { d: [1, 3], s: '17:00', e: '18:00', k: 'apprendre', l: 'Révisions / devoirs', c: 'Rév.' },
        { d: [1, 3], s: '18:15', e: '19:15', k: 'copyfy', l: 'LifeOS (Focus)', c: 'LifeOS' },
        { d: [2, 4], s: '15:30', e: '17:00', k: 'apprendre', l: 'Révisions / devoirs', c: 'Rév.' },
        { d: [2, 4], s: '17:15', e: '18:45', k: 'copyfy', l: 'LifeOS (Focus)', c: 'LifeOS' },
        { d: [1, 2, 3, 4, 7], s: '21:00', e: '21:15', k: 'revue', l: 'Check-in + préparer demain', c: '✓' },
        { d: [5], s: '13:00', e: '14:15', k: 'sport', l: 'Sport (salle)', c: 'Sport' },
        { d: [5], s: '15:00', e: '17:30', k: 'copyfy', l: 'LifeOS, gros bloc', c: 'LifeOS' },
        { d: [6], s: '09:00', e: '12:00', k: 'copyfy', l: 'LifeOS, gros bloc', c: 'LifeOS' },
        { d: [6], s: '14:00', e: '15:00', k: 'apprendre', l: 'Révisions', c: 'Rév.' },
        { d: [7], s: '10:00', e: '11:00', k: 'apprendre', l: 'Révisions', c: 'Rév.' },
        { d: [7], s: '15:00', e: '17:00', k: 'perso', l: 'Cookies', c: 'Cookies' },
        { d: [7], s: '17:30', e: '18:00', k: 'revue', l: 'Revue de la semaine', c: 'Revue' }
      ];
      store.set('state:Main', M);
      store.set('planV8', true);
    } catch (e) {}
  })();
  /* Nouvelles habitudes choisies avec Claude (une seule fois) : garde l'historique et les habitudes perso */
  if (dv === 3) {
    try {
      var cur = store.get('shared:habits') || clone(DEFAULTS.habits);
      var keep = {}; cur.forEach(function (h) { keep[h.id] = h; });
      var next = DEFAULTS.habits.map(function (h) { var o = clone(h); if (h.id === 'sport' && keep.sport && keep.sport.log) o.log = keep.sport.log; return o; });
      cur.forEach(function (h) { if (['copyfy', 'sport', 'apprendre', 'planif'].indexOf(h.id) < 0 && !next.some(function (x) { return x.id === h.id; })) next.push(h); });
      store.set('shared:habits', next);
      var hs = store.get('state:Habitudes'); if (hs) { hs.sel = 'copyfy'; store.set('state:Habitudes', hs); }
    } catch (e) {}
    store.set('dataVersion', 4); dv = 4;
  }
  /* Paliers d'argent partagés entre l'Accueil, Objectifs et Paramètres (une seule fois) */
  if (dv === 4) {
    try { var O = store.get('state:Objectifs'); if (O && Array.isArray(O.paliers) && O.paliers.length) store.set('shared:paliers', O.paliers.map(function (p) { return { amount: p.amount, desc: p.desc, state: p.state }; })); } catch (e) {}
    store.set('dataVersion', 5); dv = 5;
  }
  /* Minuteur Focus partagé : reprend la durée choisie avant (une seule fois) */
  if (dv === 5) {
    try { var Pp = store.get('state:Productivity'); if (Pp && Pp.dur === 50) store.set('shared:focusRun', { dur: 50, running: false, endAt: 0, left: 3000, task: '' }); } catch (e) {}
    store.set('dataVersion', 6); dv = 6;
  }
  /* Anciennes données (une seule fois) */
  if (dv === 6) {
    try { var Mm = store.get('state:Main') || {}; ['cfRep', 'cfRdv', 'cfCli'].forEach(function (k) { if (Number(Mm[k]) > 0) store.set('shared:' + k, Number(Mm[k])); }); } catch (e) {}
    store.set('dataVersion', 7);
  }

  /* ---------- Lecture des écrans ---------- */
  var injected = {};
  function parseScreen(name) {
    var src = String(SCREENS[name] || '')
      .replace(/<select\b/g, '<x-select').replace(/<\/select>/g, '</x-select>');
    var doc = new DOMParser().parseFromString(src, 'text/html');
    var helmet = doc.querySelector('helmet');
    if (helmet) {
      Array.prototype.forEach.call(helmet.querySelectorAll('style'), function (st) {
        var css = st.textContent;
        if (!injected[css]) {
          injected[css] = true;
          var el = document.createElement('style');
          el.textContent = css;
          document.head.appendChild(el);
        }
      });
      helmet.parentNode.removeChild(helmet);
    }
    var xdc = doc.querySelector('x-dc');
    var scriptEl = doc.querySelector('script[data-dc-script]');
    return { nodes: xdc ? Array.prototype.slice.call(xdc.childNodes) : [], script: scriptEl ? scriptEl.textContent : 'class Component extends DCLogic { renderVals() { return {}; } }' };
  }

  /* ---------- Trous {{ ... }} ---------- */
  function lookup(path, scope) {
    if (path === 'true') return true;
    if (path === 'false') return false;
    if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
    var parts = path.split('.'), v = scope[parts[0]];
    for (var i = 1; i < parts.length; i++) { if (v == null) return undefined; v = v[parts[i]]; }
    return v;
  }
  function interp(str, scope) {
    var m = str.match(/^\s*\{\{\s*([^}]+?)\s*\}\}\s*$/);
    if (m) return lookup(m[1], scope);
    return str.replace(HOLE, function (_, p) { var v = lookup(p, scope); return v == null ? '' : String(v); });
  }

  /* ---------- Styles et attributs ---------- */
  function styleObj(s) {
    var o = {};
    String(s == null ? '' : s).split(';').forEach(function (d) {
      var i = d.indexOf(':');
      if (i < 0) return;
      var k = d.slice(0, i).trim(), v = d.slice(i + 1).trim();
      if (!k) return;
      if (k.indexOf('--') === 0) { o[k] = v; return; }
      k = k.replace(/^-(webkit|moz|ms)-/, function (m, p) { return p.charAt(0).toUpperCase() + p.slice(1) + '-'; });
      k = k.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); });
      o[k] = v;
    });
    return o;
  }
  var EVT = { onclick: 'onClick', onchange: 'onChange', oninput: 'onInput', onsubmit: 'onSubmit', onkeydown: 'onKeyDown', onkeyup: 'onKeyUp', onblur: 'onBlur', onfocus: 'onFocus', onpointerdown: 'onPointerDown', onpointermove: 'onPointerMove', onpointerup: 'onPointerUp', onpointercancel: 'onPointerCancel', onpointerleave: 'onPointerLeave', onwheel: 'onWheel', oncontextmenu: 'onContextMenu' };
  function propName(n) {
    if (EVT[n]) return EVT[n];
    if (n === 'class') return 'className';
    if (n === 'for') return 'htmlFor';
    if (n === 'maxlength') return 'maxLength';
    if (n === 'tabindex') return 'tabIndex';
    if (n === 'readonly') return 'readOnly';
    if (n.indexOf('aria-') === 0 || n.indexOf('data-') === 0) return n;
    if (n.indexOf(':') >= 0) return null;
    if (n.indexOf('-') > 0) return n.replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); });
    return n;
  }

  /* ---------- Menu déroulant au design de LifeOS (remplace le <select> de Windows) ---------- */
  function isDark() { return document.body.getAttribute('data-theme') === 'sombre'; }
  function txt(c) { return [].concat(c == null ? [] : c).map(function (x) { return typeof x === 'string' || typeof x === 'number' ? String(x) : ''; }).join(''); }
  function flatOpts(children, outL) {
    R.Children.forEach(children, function (c) {
      if (!c || typeof c !== 'object') return;
      if (c.type === R.Fragment) flatOpts(c.props.children, outL);
      else if (c.type === 'option') outL.push({ v: String(c.props.value != null ? c.props.value : txt(c.props.children)), l: txt(c.props.children) });
    });
    return outL;
  }
  function Select(p) {
    var opts = flatOpts(p.children, []);
    var o1 = R.useState(false), open = o1[0], setOpen = o1[1];
    var a1 = R.useState(0), act = a1[0], setAct = a1[1];
    var ps = R.useState(null), pos = ps[0], setPos = ps[1];
    var ref = R.useRef(null), listRef = R.useRef(null);
    var val = String(p.value != null ? p.value : '');
    var idx = -1; for (var i = 0; i < opts.length; i++) if (opts[i].v === val) { idx = i; break; }
    var cur = opts[idx] || opts[0] || { l: '' };
    function place() {
      var r = ref.current.getBoundingClientRect(), below = window.innerHeight - r.bottom, hgt = Math.min(320, opts.length * 42 + 12);
      var up = below < hgt + 12 && r.top > below;
      setPos({ left: Math.min(r.left, window.innerWidth - Math.max(r.width, 180) - 8), width: Math.max(r.width, 180), top: up ? null : r.bottom + 6, bottom: up ? window.innerHeight - r.top + 6 : null, maxH: Math.max(140, Math.min(320, (up ? r.top : below) - 16)) });
    }
    function openIt() { if (!ref.current) return; place(); setAct(idx < 0 ? 0 : idx); setOpen(true); }
    function pick(o) {
      setOpen(false);
      if (o && o.v !== val && p.onChange) p.onChange({ target: { value: o.v }, currentTarget: { value: o.v }, preventDefault: function () {} });
      if (ref.current) ref.current.focus();
    }
    R.useEffect(function () {
      if (!open) return;
      function inside(e) { return (ref.current && ref.current.contains(e.target)) || (listRef.current && listRef.current.contains(e.target)); }
      function onDoc(e) { if (!inside(e)) setOpen(false); }
      function onScroll(e) { if (!(listRef.current && listRef.current.contains(e.target))) setOpen(false); }
      function onRes() { setOpen(false); }
      document.addEventListener('mousedown', onDoc, true);
      window.addEventListener('scroll', onScroll, true);
      window.addEventListener('resize', onRes);
      var el = listRef.current && listRef.current.querySelector('[aria-selected="true"]');
      if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
      return function () { document.removeEventListener('mousedown', onDoc, true); window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onRes); };
    }, [open]);
    function onKey(e) {
      var k = e.key;
      if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); if (!open) { openIt(); return; } setAct(function (a) { return Math.max(0, Math.min(opts.length - 1, a + (k === 'ArrowDown' ? 1 : -1))); }); }
      else if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); if (open) pick(opts[act]); else openIt(); }
      else if (k === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); } }
      else if (k === 'Tab') setOpen(false);
    }
    var dark = isDark();
    var C = dark ? { bg: '#18181b', ink: '#f2f2f3', mut: '#8e9096', line: 'rgba(255,255,255,.09)', hov: 'rgba(255,255,255,.06)', sel: 'rgba(255,255,255,.10)' }
                 : { bg: '#ffffff', ink: '#0d0e10', mut: '#5c6067', line: 'rgba(13,14,16,.10)', hov: 'rgba(13,14,16,.05)', sel: 'rgba(13,14,16,.08)' };
    var trig = Object.assign({}, p.style || {}, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit' });
    if (!trig.color) trig.color = 'inherit';
    var chev = h('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', style: { flex: 'none', opacity: 0.6, transition: 'transform .2s ease', transform: open ? 'rotate(180deg)' : 'none' } }, h('path', { d: 'M6 9l6 6 6-6' }));
    var list = open && pos ? RD.createPortal(h('div', {
      ref: listRef, role: 'listbox', 'aria-label': p['aria-label'] || '',
      style: { position: 'fixed', zIndex: 2000, left: pos.left, width: pos.width, top: pos.top == null ? 'auto' : pos.top, bottom: pos.bottom == null ? 'auto' : pos.bottom, maxHeight: pos.maxH, overflowY: 'auto', boxSizing: 'border-box', padding: 6, borderRadius: 16, background: C.bg, color: C.ink, border: '1px solid ' + C.line, boxShadow: '0 18px 50px rgba(0,0,0,' + (dark ? '.55' : '.18') + ')', fontFamily: "'Manrope', system-ui, sans-serif", animation: 'lifeos-drop .16s ease-out' }
    }, opts.map(function (o, i) {
      var on = o.v === val, hi = i === act;
      return h('div', { key: i, role: 'option', 'aria-selected': on ? 'true' : 'false', onMouseEnter: function () { setAct(i); }, onMouseDown: function (e) { e.preventDefault(); }, onClick: function () { pick(o); },
        style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 38, padding: '8px 12px', borderRadius: 10, cursor: 'pointer', fontSize: 13.5, fontWeight: on ? 800 : 600, background: on ? C.sel : hi ? C.hov : 'transparent', transition: 'background-color .12s ease' } },
        h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, o.l),
        on ? h('svg', { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true', style: { flex: 'none' } }, h('path', { d: 'M5 12l5 5 9-10' })) : null);
    })), document.body) : null;
    return h(R.Fragment, null,
      h('button', { type: 'button', ref: ref, 'aria-haspopup': 'listbox', 'aria-expanded': open ? 'true' : 'false', 'aria-label': p['aria-label'], title: p.title, style: trig, onClick: function () { if (open) setOpen(false); else openIt(); }, onKeyDown: onKey },
        h('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, cur.l), chev),
      list);
  }

  /* ---------- Roulette à faire glisser (style Liftoff) pour les nombres ---------- */
  function Ruler(p) {
    var step = Number(p.step) || 1, min = p.min != null && p.min !== '' ? Number(p.min) : 0, max = p.max != null && p.max !== '' ? Number(p.max) : 99999, dec = Number(p.dec) || 0;
    var acc3 = String(p.accel || '1,2,5').split(',').map(Number);
    var v = Number(p.value) || 0;
    var f1 = R.useState(0), frac = f1[0], setFrac = f1[1];
    var d1 = R.useState(false), drag = d1[0], setDrag = d1[1];
    var b1 = R.useState(0), bump = b1[0], setBump = b1[1];
    var vr = R.useRef(v), w = R.useRef(null), acc = R.useRef(0), raf = R.useRef(0), ww = R.useRef({ t: 0, n: 0 }), box = R.useRef(null), cbs = R.useRef(null);
    if (!w.current && !raf.current) vr.current = v;
    function setV(n) {
      var nv = Math.max(min, Math.min(max, Math.round((vr.current + n * step) / step) * step));
      nv = Number(nv.toFixed(dec));
      if (nv === vr.current) return;
      vr.current = nv;
      if (p.onChange) p.onChange(nv);
      setBump(function (b) { return b + 1; });
      try { if (navigator.vibrate) navigator.vibrate(4); } catch (e) {}
    }
    function spin(px, speed) {
      acc.current += px; var G = 16, t = 0;
      while (acc.current >= G) { acc.current -= G; t++; }
      while (acc.current <= -G) { acc.current += G; t--; }
      var m = speed > 2.6 ? acc3[2] : speed > 1.5 ? acc3[1] : acc3[0];
      if (t) setV(t * m);
      if ((vr.current <= min && acc.current < 0) || (vr.current >= max && acc.current > 0)) acc.current = 0;
      setFrac(acc.current);
    }
    function stop() { cancelAnimationFrame(raf.current); raf.current = 0; }
    function end() { acc.current = 0; setDrag(false); setFrac(0); }
    cbs.current = { setV: setV };
    R.useEffect(function () {
      var el = box.current; if (!el) return;
      function onWheel(e) {
        e.preventDefault();
        var now = performance.now(), q = ww.current;
        q.n = now - q.t < 90 ? q.n + 1 : 0; q.t = now;
        var dir = (e.deltaY || e.deltaX) < 0 ? 1 : -1;
        cbs.current.setV(dir * (q.n > 24 ? acc3[2] : q.n > 10 ? acc3[1] : acc3[0]));
      }
      el.addEventListener('wheel', onWheel, { passive: false });
      return function () { el.removeEventListener('wheel', onWheel); stop(); };
    }, []);
    var dark = p.dark === true || p.dark === 'true' || (p.dark == null && isDark());
    var C = dark ? { bg: '#0f0f11', ink: '#f2f2f3', mut: '#8e9096', faint: '#4a4c51', line: 'rgba(255,255,255,.09)' } : { bg: '#f6f7f9', ink: '#0d0e10', mut: '#5c6067', faint: '#c3c6cb', line: 'rgba(13,14,16,.10)' };
    var base = Math.round(v / step), ticks = [];
    for (var i = -20; i <= 20; i++) {
      var n = base + i, major = n % 10 === 0, mid = n % 5 === 0, col = major ? C.ink : C.faint, tv = n * step;
      var outR = tv < min - 1e-9 || tv > max + 1e-9;
      ticks.push(h('i', { key: i, style: { flex: 'none', width: 12, height: major ? 44 : mid ? 30 : 18, background: outR ? 'transparent' : 'linear-gradient(to right, transparent 5px, ' + col + ' 5px, ' + col + ' 7px, transparent 7px)' } }));
    }
    var shown = v.toLocaleString('fr-FR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 } },
      p.label ? h('span', { style: { fontSize: 12, fontWeight: 800, color: C.mut } }, out(p.label)) : null,
      h('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6 } },
        h('b', { key: bump % 2 ? 'a' : 'b', className: 'lifeos-bump', style: { fontFamily: "'Urbanist', 'Manrope', system-ui, sans-serif", fontWeight: 700, fontSize: Number(p.size) || 44, lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' } }, shown),
        p.unit ? h('span', { style: { fontSize: 15, fontWeight: 800, color: C.mut } }, out(String(p.unit))) : null),
      h('div', {
        ref: box, role: 'slider', tabIndex: 0, 'aria-label': p.label ? out(p.label) : undefined, 'aria-valuemin': min, 'aria-valuemax': max, 'aria-valuenow': v, 'aria-valuetext': shown + (p.unit ? ' ' + p.unit : ''),
        onPointerDown: function (e) { stop(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch (er) {} w.current = { x: e.clientX, t: performance.now(), v: 0 }; setDrag(true); },
        onPointerMove: function (e) { var q = w.current; if (!q) return; var now = performance.now(), dx = q.x - e.clientX, dt = Math.max(1, now - q.t); q.x = e.clientX; q.t = now; q.v = (dx / dt) * 0.6 + q.v * 0.4; spin(dx, Math.abs(q.v)); },
        onPointerUp: function () {
          var q = w.current; w.current = null;
          var vel = q && performance.now() - q.t < 80 ? q.v : 0;
          if (Math.abs(vel) > 0.3) { var loop = function () { vel *= 0.9; spin(vel * 16, Math.abs(vel)); if ((vr.current <= min && vel < 0) || (vr.current >= max && vel > 0)) vel = 0; if (Math.abs(vel) > 0.06) raf.current = requestAnimationFrame(loop); else { raf.current = 0; end(); } }; raf.current = requestAnimationFrame(loop); }
          else end();
        },
        onPointerCancel: function () { w.current = null; end(); },
        onKeyDown: function (e) { var map = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 }; if (map[e.key]) { e.preventDefault(); setV(map[e.key]); } },
        style: { position: 'relative', height: 72, borderRadius: 18, background: C.bg, border: '1px solid ' + C.line, overflow: 'hidden', touchAction: 'none', userSelect: 'none', cursor: drag ? 'grabbing' : 'grab', outlineOffset: 3 }
      },
        h('div', { style: { position: 'absolute', left: '50%', top: 0, bottom: 0, display: 'flex', alignItems: 'center', transform: 'translateX(calc(-50% - ' + frac.toFixed(1) + 'px))', transition: drag ? 'none' : 'transform .25s ease' } }, ticks),
        h('i', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 70, background: 'linear-gradient(to right, ' + C.bg + ', transparent)', pointerEvents: 'none' } }),
        h('i', { style: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 70, background: 'linear-gradient(to left, ' + C.bg + ', transparent)', pointerEvents: 'none' } }),
        h('i', { style: { position: 'absolute', left: '50%', top: 8, bottom: 8, width: 4, marginLeft: -2, borderRadius: 4, background: '#ff6b2c', boxShadow: '0 0 12px rgba(255,107,44,.6)' } })),
      h('div', { style: { display: 'flex', justifyContent: 'center', gap: 8 } },
        h('button', { type: 'button', 'aria-label': out('Moins'), onClick: function () { setV(-1); }, style: { width: 40, height: 40, borderRadius: '50%', border: '1px solid ' + C.line, background: 'transparent', color: C.ink, font: 'inherit', fontSize: 20, fontWeight: 700, cursor: 'pointer' } }, '−'),
        h('button', { type: 'button', 'aria-label': out('Plus'), onClick: function () { setV(1); }, style: { width: 40, height: 40, borderRadius: '50%', border: '1px solid ' + C.line, background: 'transparent', color: C.ink, font: 'inherit', fontSize: 20, fontWeight: 700, cursor: 'pointer' } }, '+')));
  }

  /* ---------- Compte et sauvegarde en ligne (Supabase) ---------- */
  var Cloud = (function () {
    var SB_URL = 'https://huipwdtnpdntwulqzjhc.supabase.co', SB_KEY = 'sb_publishable_JaiXKTAEO-3XN-djLxCmbA_pKd55AM1';
    var sb = null, user = null, listeners = [], timer = 0, ready = false, applying = false;
    var st = { status: 'off', err: '', conflict: null };
    var EXCL = { 'lifeos:screen': 1, 'lifeos:sync': 1 };
    function meta() { try { return JSON.parse(localStorage.getItem('lifeos:sync') || 'null') || { at: 0, localAt: 0, dirty: false }; } catch (e) { return { at: 0, localAt: 0, dirty: false }; } }
    function setMeta(m) { try { localStorage.setItem('lifeos:sync', JSON.stringify(m)); } catch (e) {} }
    function emit() { listeners.slice().forEach(function (f) { try { f(); } catch (e) {} }); }
    function set(patch) { Object.assign(st, patch); emit(); }
    function snapshot() { var o = {}; store.keys().forEach(function (k) { if (!EXCL[k]) o[k] = localStorage.getItem(k); }); return o; }
    function apply(data, rAt) {
      applying = true; frozen = true;
      try {
        store.keys().forEach(function (k) { if (!EXCL[k] && !(k in data)) localStorage.removeItem(k); });
        Object.keys(data || {}).forEach(function (k) { if (k.indexOf('lifeos:') === 0 && !EXCL[k] && typeof data[k] === 'string') localStorage.setItem(k, data[k]); });
      } catch (e) {}
      setMeta({ at: rAt, localAt: rAt, dirty: false });
      window.location.reload();
    }
    function push() {
      if (!user || !sb) return Promise.resolve();
      clearTimeout(timer);
      var now = new Date().toISOString();
      set({ status: 'saving' });
      return sb.from('lifeos_sync').upsert({ user_id: user.id, data: snapshot(), updated_at: now, device: (navigator.userAgent || '').slice(0, 120) }).then(function (r) {
        if (r.error) { set({ status: 'error', err: r.error.message }); return; }
        var m = meta(); m.at = Date.parse(now); m.dirty = false; setMeta(m); set({ status: 'ok', err: '' }); try { Cloud.board.publish().catch(function () {}); } catch (e) {}
      }, function (e) { set({ status: 'error', err: String(e && e.message || e) }); });
    }
    function wipe() {
      if (!user || !sb) return null;
      var now = new Date().toISOString();
      return sb.from('lifeos_sync').upsert({ user_id: user.id, data: snapshot(), updated_at: now, device: (navigator.userAgent || '').slice(0, 120) }).then(function (r) {
        if (!r.error) setMeta({ at: Date.parse(now), localAt: Date.parse(now), dirty: false });
        else setMeta({ at: Date.now(), localAt: Date.now(), dirty: true });
      });
    }
    function pull(isLogin) {
      if (!user || !sb) return Promise.resolve();
      set({ status: 'loading' });
      return sb.from('lifeos_sync').select('data, updated_at').eq('user_id', user.id).maybeSingle().then(function (r) {
        ready = true;
        if (r.error) { set({ status: 'error', err: r.error.message }); return; }
        var row = r.data, m = meta();
        if (!row) return push();
        var rAt = Date.parse(row.updated_at);
        if (isLogin) { set({ status: 'choose', conflict: { data: row.data, at: rAt } }); return; }
        if (rAt > (m.at || 0) && (!m.dirty || rAt > (m.localAt || 0))) { apply(row.data, rAt); return; }
        if (m.dirty) return push();
        set({ status: 'ok' });
      }, function (e) { ready = true; set({ status: 'error', err: String(e && e.message || e) }); });
    }
    function init() {
      if (!window.supabase || !window.supabase.createClient) { ready = true; set({ status: 'unavailable' }); return; }
      var fromLink = /access_token=|type=magiclink|type=signup/.test(window.location.hash || '');
      try {
        sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'lifeos-auth' } });
      } catch (e) { ready = true; set({ status: 'unavailable' }); return; }
      sb.auth.getSession().then(function (r) {
        user = r.data && r.data.session ? r.data.session.user : null;
        if (user) { if (fromLink) { try { history.replaceState(null, '', window.location.pathname); } catch (e) {} } pull(fromLink); }
        else { ready = true; set({ status: 'off' }); }
      }, function () { ready = true; set({ status: 'off' }); });
      sb.auth.onAuthStateChange(function (ev, session) { user = session ? session.user : null; if (!user) set({ status: 'off' }); else emit(); });
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && user && meta().dirty) push(); else if (document.visibilityState === 'visible' && user && ready && !applying) pull(false); });
      window.addEventListener('online', function () { if (user && meta().dirty) push(); });
    }
    cloudTouch = function () {
      if (applying) return;
      var m = meta(); m.dirty = true; m.localAt = Date.now(); setMeta(m);
      if (!user || !ready) return;
      clearTimeout(timer); timer = setTimeout(push, 3000);
    };
    return {
      init: init, state: st, user: function () { return user; }, meta: meta,
      /* ---- Classement (V2) : profil public, amis, monde ---- */
      board: {
        me: function () { return store.get('boardMe') || {}; },
        setMe: function (patch) { store.set('boardMe', Object.assign({}, store.get('boardMe') || {}, patch || {})); return this.publish(); },
        code: function () { var m = store.get('boardMe') || {}; if (!m.code) { var n = String(Math.floor(1000 + Math.random() * 9000)), base = String((store.get('settings') || {}).name || 'LIFE').normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4) || 'LIFE'; m.code = base + '-' + n; store.set('boardMe', m); } return m.code; },
        publish: function () {
          if (!user || !sb || !window.LifeOS || !window.LifeOS.xp) return Promise.resolve(null);
          var X = window.LifeOS.xp.summary(), me = store.get('boardMe') || {}, S = store.get('settings') || {}, SP = store.get('state:Sport') || {};
          var row = { user_id: user.id, pseudo: String(me.pseudo || S.name || 'Joueur').slice(0, 20), code: this.code(), level: X.level, xp_total: X.total, xp_week: X.week, week_key: X.weekKey,
            sport_rank: SP.rankInfo && SP.rankInfo.v === 2 ? (SP.rankInfo.r || 0) : 0, streak: X.streak, is_public: me.hidden ? false : true, updated_at: new Date().toISOString() };
          return sb.from('lifeos_profiles').upsert(row).then(function (r) { if (r.error) throw r.error; return row; });
        },
        friends: function () {
          if (!user || !sb) return Promise.resolve([]);
          return sb.from('lifeos_friends').select('friend_id').eq('user_id', user.id).then(function (r) {
            if (r.error) throw r.error;
            var ids = (r.data || []).map(function (x) { return x.friend_id; }).concat([user.id]);
            return sb.from('lifeos_profiles').select('user_id, pseudo, code, level, xp_total, xp_week, week_key, sport_rank, streak').in('user_id', ids).then(function (q) { if (q.error) throw q.error; return q.data || []; });
          });
        },
        world: function (by) {
          if (!user || !sb) return Promise.resolve([]);
          return sb.from('lifeos_profiles').select('user_id, pseudo, level, xp_total, xp_week, week_key, sport_rank, streak').eq('is_public', true).order(by === 'week' ? 'xp_week' : 'xp_total', { ascending: false }).limit(100).then(function (q) { if (q.error) throw q.error; return q.data || []; });
        },
        count: function () {
          if (!user || !sb) return Promise.resolve(0);
          return sb.from('lifeos_profiles').select('user_id', { count: 'exact', head: true }).eq('is_public', true).then(function (q) { return q.count || 0; }, function () { return 0; });
        },
        addFriend: function (code) {
          if (!user || !sb) return Promise.reject(new Error('Connecte-toi d\'abord (Paramètres → Compte).'));
          return sb.rpc('lifeos_add_friend', { friend_code: String(code || '').trim().toUpperCase() }).then(function (r) { if (r.error) throw r.error; if (!r.data) throw new Error('Aucun joueur avec ce code.'); return r.data; });
        },
        removeFriend: function (id) { if (!user || !sb) return Promise.resolve(); return sb.from('lifeos_friends').delete().eq('user_id', user.id).eq('friend_id', id).then(function () {}); }
      },
      on: function (f) { listeners.push(f); return function () { var i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); }; },
      wipe: wipe,
      rpc: function (name, args) { if (!sb) return Promise.reject(new Error('indisponible')); return sb.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); },
      sendCode: function (email) { if (!sb) return Promise.reject(new Error('indisponible')); return sb.auth.signInWithOtp({ email: email, options: { shouldCreateUser: true, emailRedirectTo: /^https?:/.test(location.protocol) ? location.origin + location.pathname : undefined } }).then(function (r) { if (r.error) throw r.error; }); },
      verify: function (email, code) { return sb.auth.verifyOtp({ email: email, token: code, type: 'email' }).then(function (r) { if (r.error) throw r.error; user = r.data.user || (r.data.session && r.data.session.user); return pull(true); }); },
      keepRemote: function () { var c = st.conflict; if (c) apply(c.data, c.at); },
      keepLocal: function () { set({ conflict: null }); return push(); },
      syncNow: function () { var m = meta(); return m.dirty ? push() : pull(false); },
      signOut: function () { if (!sb) return Promise.resolve(); var p = meta().dirty ? push() : Promise.resolve(); return p.then(function () { return sb.auth.signOut(); }).then(function () { user = null; set({ status: 'off', conflict: null }); }); }
    };
  })();

  function AccountCard() {
    var t1 = R.useState(0), force = t1[1];
    var e1 = R.useState(''), email = e1[0], setEmail = e1[1];
    var c1 = R.useState(''), code = c1[0], setCode = c1[1];
    var s1 = R.useState('email'), step = s1[0], setStep = s1[1];
    var b1 = R.useState(false), busy = b1[0], setBusy = b1[1];
    var m1 = R.useState(''), msg = m1[0], setMsg = m1[1];
    R.useEffect(function () { var off = Cloud.on(function () { force(function (n) { return n + 1; }); }); var iv = setInterval(function () { force(function (n) { return n + 1; }); }, 30000); return function () { off(); clearInterval(iv); }; }, []);
    var dark = isDark();
    var C = dark ? { ink: '#f2f2f3', mut: '#8e9096', line: 'rgba(255,255,255,.1)', field: '#0f0f11', btn: '#f2f2f3', btnInk: '#0b0b0c', soft: 'rgba(255,255,255,.06)', bad: '#ff8a8a', good: '#5fae7b' }
                 : { ink: '#0d0e10', mut: '#5c6067', line: 'rgba(13,14,16,.12)', field: '#ffffff', btn: '#0d0e10', btnInk: '#ffffff', soft: 'rgba(13,14,16,.05)', bad: '#b42318', good: '#1f8a4c' };
    var btn = { border: 0, borderRadius: 999, padding: '12px 18px', minHeight: 46, font: 'inherit', fontSize: 14, fontWeight: 800, background: C.btn, color: C.btnInk, cursor: 'pointer' };
    var ghost = Object.assign({}, btn, { background: 'transparent', color: C.ink, border: '1px solid ' + C.line });
    var link = { border: 0, background: 'transparent', color: C.mut, font: 'inherit', fontSize: 13, fontWeight: 700, cursor: 'pointer', padding: 4, textDecoration: 'underline' };
    var field = { boxSizing: 'border-box', width: '100%', border: '1px solid ' + C.line, background: C.field, color: C.ink, borderRadius: 14, padding: '12px 14px', font: 'inherit', fontSize: 16, minHeight: 48 };
    var p = function (txt, extra) { return h('p', { style: Object.assign({ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: C.mut, fontWeight: 600 }, extra || {}) }, out(txt)); };
    var col = function () { return h.apply(null, ['div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } }].concat([].slice.call(arguments))); };
    var row = function () { return h.apply(null, ['div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' } }].concat([].slice.call(arguments))); };
    var S = Cloud.state, u = Cloud.user();
    function run(fn) { setBusy(true); setMsg(''); return Promise.resolve().then(fn).catch(function (e) { var m = String((e && e.message) || e); if (/rate|security purposes|seconds/i.test(m)) m = 'Trop de demandes : attends une minute avant de redemander un code.'; else if (/expired|invalid|otp/i.test(m)) m = 'Code incorrect ou expiré. Vérifie-le ou redemande un code.'; setMsg(m); }).then(function () { setBusy(false); }); }
    if (S.status === 'unavailable') return col(p('La sauvegarde en ligne n\'est pas disponible pour l\'instant (pas de connexion). Tes données restent enregistrées sur cet appareil.'));
    if (S.status === 'choose' && S.conflict) {
      var d = new Date(S.conflict.at);
      return col(
        h('b', { style: { fontSize: 15 } }, out('Ton compte contient déjà des données')),
        p('Dernière sauvegarde : ' + d.toLocaleDateString('fr-FR') + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) + '. Lesquelles veux-tu garder sur cet appareil ?'),
        h('button', { type: 'button', style: btn, onClick: function () { Cloud.keepRemote(); } }, out('Récupérer les données du compte (recommandé)')),
        h('button', { type: 'button', style: ghost, onClick: function () { run(function () { return Cloud.keepLocal(); }); } }, out('Garder celles de cet appareil')),
        p('« Garder celles de cet appareil » remplace la sauvegarde du compte.', { fontSize: 12 }));
    }
    if (u) {
      var m = Cloud.meta(), ago = m.at ? Math.max(0, Math.round((Date.now() - m.at) / 60000)) : null;
      var line = S.status === 'saving' || S.status === 'loading' ? 'Synchronisation…' : S.status === 'error' ? 'Pas synchronisé : ' + S.err : (m.dirty ? 'Modifications en attente d\'envoi' : (ago === null ? 'Synchronisé' : 'Synchronisé ' + (ago < 1 ? 'à l\'instant' : 'il y a ' + (ago < 60 ? ago + ' min' : Math.round(ago / 60) + ' h'))));
      return col(
        row(h('span', { 'aria-hidden': 'true', style: { width: 10, height: 10, borderRadius: '50%', background: S.status === 'error' ? C.bad : C.good, flex: 'none' } }), h('b', { style: { fontSize: 15, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, u.email || '')),
        p(line, S.status === 'error' ? { color: C.bad } : null),
        p('Tes données sont sauvegardées en ligne et se retrouvent sur tous les appareils où tu te connectes avec cet e-mail.', { fontSize: 12.5 }),
        row(h('button', { type: 'button', style: btn, disabled: busy, onClick: function () { run(function () { return Cloud.syncNow(); }); } }, out('Synchroniser maintenant')),
          h('button', { type: 'button', style: ghost, disabled: busy, onClick: function () { run(function () { return Cloud.signOut(); }); } }, out('Se déconnecter'))),
        msg ? p(msg, { color: C.bad }) : null);
    }
    if (step === 'code') {
      return col(
        p('On t\'a envoyé un code à ' + email + '. Tape-le ici (regarde aussi dans les spams).'),
        h('input', { type: 'text', inputMode: 'numeric', autoComplete: 'one-time-code', maxLength: 10, value: code, placeholder: '000000', 'aria-label': out('Code reçu par e-mail'), onChange: function (e) { setCode(e.target.value.replace(/\D/g, '')); }, style: Object.assign({}, field, { letterSpacing: '0.3em', fontWeight: 800, textAlign: 'center', fontSize: 20 }) }),
        h('button', { type: 'button', style: btn, disabled: busy || code.length < 6, onClick: function () { run(function () { return Cloud.verify(email.trim(), code); }); } }, out(busy ? 'Vérification…' : 'Valider')),
        row(h('button', { type: 'button', style: link, onClick: function () { run(function () { return Cloud.sendCode(email.trim()).then(function () { setMsg('Nouveau code envoyé.'); }); }); } }, out('Renvoyer un code')), h('button', { type: 'button', style: link, onClick: function () { setStep('email'); setCode(''); setMsg(''); } }, out('Changer d\'e-mail'))),
        msg ? p(msg, { color: /envoyé/.test(msg) ? C.good : C.bad }) : null);
    }
    var okMail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
    return col(
      p('Crée ton compte gratuit pour sauvegarder tes données et les retrouver sur ton téléphone et ton PC. Pas de mot de passe : on t\'envoie un code par e-mail.'),
      h('input', { type: 'email', autoComplete: 'email', value: email, placeholder: out('ton@email.com'), 'aria-label': out('Ton adresse e-mail'), onChange: function (e) { setEmail(e.target.value); }, style: field }),
      h('button', { type: 'button', style: btn, disabled: busy || !okMail, onClick: function () { run(function () { return Cloud.sendCode(email.trim()).then(function () { setStep('code'); }); }); } }, out(busy ? 'Envoi…' : 'Recevoir mon code')),
      p('Connexion avec Google : bientôt.', { fontSize: 12 }),
      msg ? p(msg, { color: C.bad }) : null);
  }

  /* ---------- Construction de l'arbre React ---------- */
  function kids(node, scope) {
    var out = [];
    Array.prototype.forEach.call(node.childNodes, function (c, i) {
      var r = build(c, scope, i);
      if (r !== null && r !== undefined && r !== '') out.push(r);
    });
    return out;
  }
  function build(node, scope, key) {
    if (node.nodeType === 3) {
      var tx = node.textContent;
      if (!tx.trim() && tx.indexOf('\n') >= 0) return null;
      var txo = tx.indexOf('{{') >= 0 ? interp(tx, scope) : tx;
      return typeof txo === 'string' ? out(txo) : txo;
    }
    if (node.nodeType !== 1) return null;
    var tag = node.localName;
    if (tag === 'sc-for') {
      var list = interp(node.getAttribute('list') || '', scope);
      var as = node.getAttribute('as') || 'item';
      if (!Array.isArray(list)) list = [];
      return h(R.Fragment, { key: key }, list.map(function (it, i) {
        var sc = Object.assign({}, scope); sc[as] = it; sc.$index = i;
        return h(R.Fragment, { key: i }, kids(node, sc));
      }));
    }
    if (tag === 'sc-if') {
      return interp(node.getAttribute('value') || '', scope) ? h(R.Fragment, { key: key }, kids(node, scope)) : null;
    }
    if (tag === 'helmet' || tag === 'script' || tag === 'dc-import') return null;
    var props = { key: key };
    Array.prototype.forEach.call(node.attributes, function (a) {
      if (a.name.indexOf('hint-') === 0) return;
      var pn = propName(a.name);
      if (!pn) return;
      var v = a.value.indexOf('{{') >= 0 ? interp(a.value, scope) : a.value;
      if (pn === 'style') { props.style = styleObj(v); return; }
      if (pn === 'value' && v == null) v = '';
      if (a.name === 'placeholder' || a.name === 'aria-label' || a.name === 'title') v = out(v);
      props[pn] = v;
    });
    if (tag === 'x-select') return h.apply(null, [Select, props].concat(kids(node, scope)));
    if (tag === 'x-ruler') return h(Ruler, props);
    if (tag === 'x-account') return h(AccountCard, { key: key });
    var t = tag;
    if (t === 'input' || t === 'img' || t === 'br' || t === 'hr' || t === 'textarea') return h(t, props);
    return h.apply(null, [t, props].concat(kids(node, scope)));
  }

  /* ---------- Base des écrans ---------- */
  class DCLogicBase extends R.Component {
    render() {
      if (this.state !== liveState) { liveState = this.state; userDirty = true; }
      var vals = this.renderVals ? this.renderVals() : {};
      var c = kids({ childNodes: this.constructor.__tpl || [] }, Object.assign({}, vals));
      return c.length === 1 ? c[0] : h.apply(null, [R.Fragment, null].concat(c));
    }
    setState(p, cb) {
      if (p && typeof p === 'object' && p.theme && window.__lifeosSetTheme) window.__lifeosSetTheme(p.theme);
      return super.setState(p, cb);
    }
  }

  var mounted = [];
  function syncShared() {
    mounted.forEach(function (inst) {
      var patch = {}, any = false, st = inst.state || {};
      SHARED.forEach(function (k) {
        if (!(k in st)) return;
        var v = store.get('shared:' + k);
        if (v != null && JSON.stringify(v) !== JSON.stringify(st[k])) { patch[k] = v; any = true; }
      });
      if (any) inst.setState(patch);
    });
  }
  var cache = {};
  function screenComp(name) {
    if (cache[name]) return cache[name];
    var parsed = parseScreen(name);
    var Base = class extends DCLogicBase {};
    Base.__tpl = parsed.nodes;
    var Comp = new Function('DCLogic', parsed.script + '\n;return Component;')(Base);
    class Persisted extends Comp {
      constructor(p) {
        super(p);
        var saved = store.get('state:' + name);
        if (this.state) {
          var merged = Object.assign({}, this.state), self = this;
          if (saved) {
            Object.keys(saved).forEach(function (k) { if (SHARED.indexOf(k) < 0) merged[k] = saved[k]; });
            TRANSIENT.forEach(function (k) { if (k in self.state) merged[k] = self.state[k]; });
          }
          SHARED.forEach(function (k) {
            if (!(k in self.state)) return;
            var v = store.get('shared:' + k);
            merged[k] = v != null ? v : clone(DEFAULTS[k]);
          });
          this.state = merged;
        }
      }
      componentDidMount() { mounted.push(this); if (super.componentDidMount) super.componentDidMount(); }
      componentWillUnmount() { var i = mounted.indexOf(this); if (i >= 0) mounted.splice(i, 1); if (super.componentWillUnmount) super.componentWillUnmount(); }
      componentDidUpdate(pp, ps) {
        if (super.componentDidUpdate) super.componentDidUpdate(pp, ps);
        if (frozen) return;
        var s = {}, st = this.state || {}, prev = ps || {};
        Object.keys(st).forEach(function (k) {
          if (SHARED.indexOf(k) >= 0) { if (st[k] !== prev[k]) store.set('shared:' + k, st[k]); return; }
          if (TRANSIENT.indexOf(k) < 0) s[k] = st[k];
        });
        store.set('state:' + name, s);
      }
    }
    cache[name] = Persisted;
    return Persisted;
  }

  /* ---------- Filet de sécurité : jamais d'écran vide ---------- */
  function Screen(p) { return h(screenComp(p.name), { theme: p.theme, lang: p.lang, rev: p.rev }); }
  class Boundary extends R.Component {
    constructor(p) { super(p); this.state = { err: null }; }
    static getDerivedStateFromError(err) { return { err: err }; }
    componentDidCatch(err) { try { console.error('[LifeOS]', err); } catch (e) {} }
    render() {
      if (!this.state.err) return this.props.children;
      var dark = this.props.theme === 'sombre';
      var ink = dark ? '#f2f2f3' : '#0d0e10', mut = dark ? '#8e9096' : '#5c6067';
      var btn = { border: 0, borderRadius: 999, padding: '10px 18px', font: 'inherit', fontWeight: 700, fontSize: 13.5, cursor: 'pointer', background: ink, color: dark ? '#0b0b0c' : '#fff' };
      var ghost = Object.assign({}, btn, { background: 'transparent', color: ink, border: '1px solid ' + mut });
      return h('div', { style: { minHeight: '100%', display: 'grid', placeItems: 'center', padding: 24, fontFamily: "'Manrope', system-ui, sans-serif", color: ink } },
        h('div', { style: { maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 14 } },
          h('div', { style: { fontSize: 22, fontWeight: 700 } }, 'Cette page a eu un souci.'),
          h('div', { style: { fontSize: 14, color: mut } }, 'Tes données sont gardées. Recharge LifeOS ; si ça revient, envoie une capture de ce message à Claude.'),
          h('code', { style: { fontSize: 12, color: mut, wordBreak: 'break-word' } }, String((this.state.err && this.state.err.message) || this.state.err)),
          h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
            h('button', { type: 'button', style: btn, onClick: function () { window.location.reload(); } }, 'Recharger'),
            h('button', { type: 'button', style: ghost, onClick: function () { store.set('screen', 'Main'); window.location.reload(); } }, 'Aller à l\'Accueil'))));
    }
  }

  /* ---------- Minuteur Focus : tourne sur toutes les pages ---------- */
  var Focus = {
    get: function () {
      var f = Object.assign({}, DEFAULTS.focusRun, store.get('shared:focusRun') || {});
      f.dur = Math.max(1, Math.min(240, Math.round(Number(f.dur) || 25)));
      f.leftNow = f.running ? Math.max(0, Math.ceil(((f.endAt || 0) - Date.now()) / 1000)) : (typeof f.left === 'number' ? f.left : f.dur * 60);
      return f;
    },
    put: function (f) { store.set('shared:focusRun', { dur: f.dur, base: f.base || 0, running: !!f.running, endAt: f.endAt || 0, left: f.left, task: f.task || '' }); syncShared(); },
    start: function () { var f = Focus.get(); if (f.running) return; f.running = true; f.endAt = Date.now() + f.leftNow * 1000; f.left = f.leftNow; Focus.put(f); },
    pause: function () { var f = Focus.get(); if (!f.running) return; f.running = false; f.left = f.leftNow; f.endAt = 0; Focus.put(f); },
    done: function () {
      var f = Focus.get(), k = isoDay(new Date()), log = store.get('shared:focusLog') || {}, cur = log[k] || { s: 0, m: 0 };
      log[k] = { s: (cur.s || 0) + 1, m: (cur.m || 0) + f.dur };
      store.set('shared:focusLog', log);
      var nd = f.base || f.dur;
      Focus.put({ dur: nd, base: 0, running: false, endAt: 0, left: nd * 60, task: f.task });
      try {
        var ac = new (window.AudioContext || window.webkitAudioContext)();
        [0, 0.28, 0.56].forEach(function (t0) { var o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = 880; o.connect(g); g.connect(ac.destination); g.gain.setValueAtTime(0.0001, ac.currentTime + t0); g.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t0 + 0.22); o.start(ac.currentTime + t0); o.stop(ac.currentTime + t0 + 0.25); });
      } catch (e) {}
      try { if (window.Notification) new Notification(out('Focus terminé'), { body: out('Bravo ! Prends 5 minutes de pause.') }); } catch (e) {}
    }
  };
  setInterval(function () { var f = Focus.get(); if (f.running && f.leftNow <= 0) Focus.done(); }, 1000);

  function FocusPill(p) {
    var tk = R.useState(0);
    R.useEffect(function () { var iv = setInterval(function () { tk[1](function (n) { return n + 1; }); }, 1000); return function () { clearInterval(iv); }; }, []);
    var f = Focus.get();
    var paused = !f.running && f.leftNow < f.dur * 60;
    if (p.screen === 'Productivity' || (!f.running && !paused)) return null;
    var dark = p.theme === 'sombre';
    var mm = Math.floor(f.leftNow / 60), ss = f.leftNow % 60, clock = (mm < 10 ? '0' : '') + mm + ':' + (ss < 10 ? '0' : '') + ss;
    var bg = dark ? '#ececee' : '#0d0e10', ink = dark ? '#0b0b0c' : '#ffffff';
    var btn = { border: 0, borderRadius: 999, padding: '7px 12px', font: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', background: 'transparent', color: ink, border: '1px solid ' + (dark ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,.3)') };
    return h('div', { role: 'status', className: 'lifeos-pill', 'aria-label': out('Minuteur Focus'), style: { position: 'fixed', right: 20, bottom: 20, zIndex: 40, display: 'flex', alignItems: 'center', gap: 10, padding: '8px 8px 8px 16px', borderRadius: 999, background: bg, color: ink, boxShadow: '0 12px 30px rgba(0,0,0,.25)', fontFamily: "'Manrope', system-ui, sans-serif" } },
      h('span', { style: { width: 8, height: 8, borderRadius: '50%', background: f.running ? '#5fae7b' : '#e0a33a' } }),
      h('a', { href: 'Productivity.dc.html', style: { color: ink, textDecoration: 'none', fontWeight: 700, fontSize: 13 } }, out(f.running ? 'Focus' : 'Focus en pause') + ' · ', h('span', { style: { fontFamily: "'JetBrains Mono', ui-monospace, monospace" } }, clock)),
      f.task ? h('span', { title: f.task, style: { fontSize: 12, opacity: 0.7, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, f.task) : null,
      h('button', { type: 'button', style: btn, onClick: function () { if (f.running) Focus.pause(); else Focus.start(); tk[1](function (n) { return n + 1; }); } }, out(f.running ? 'Pause' : 'Reprendre')));
  }

  /* ---------- Réglages et sauvegarde, utilisés par la page Paramètres ---------- */
  window.LifeOS = {
    settings: SETTINGS,
    share: function (d) { try { window.dispatchEvent(new CustomEvent('lifeos-share', { detail: d || {} })); } catch (e) {} },
    flame: {
      now: function (C) { return flameNow(C); }, at: function (C, d) { return flameAt(C, d); },
      pause: function (days) { var t = new Date(), e = new Date(); e.setDate(e.getDate() + Math.max(1, Math.min(21, Number(days) || 7)) - 1); var P = (store.get('pauses') || []).filter(function (p) { return p.to < isoDay(t); }); P.push({ from: isoDay(t), to: isoDay(e) }); store.set('pauses', P); },
      resume: function () { var t = new Date(), y = new Date(); y.setDate(y.getDate() - 1); var tdy = isoDay(t); store.set('pauses', (store.get('pauses') || []).map(function (p) { return p.from <= tdy && p.to >= tdy ? { from: p.from, to: isoDay(y) } : p; }).filter(function (p) { return p.to >= p.from; })); }
    },
    /* Notifications du soir (Web Push) : la PWA s'abonne, Supabase envoie la notification à l'heure du check-in */
    push: (function () {
      function b64(s) { var p = '='.repeat((4 - s.length % 4) % 4), raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')), out = new Uint8Array(raw.length); for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out; }
      function ios() { return /iPhone|iPad|iPod/i.test(navigator.userAgent || ''); }
      function standalone() { try { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; } catch (e) { return false; } }
      function supported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && /^https:/.test(location.protocol); }
      function state() {
        if (!supported()) return ios() && !standalone() ? 'ios-home' : 'unsupported';
        if (ios() && !standalone()) return 'ios-home';
        if (Notification.permission === 'denied') return 'denied';
        var P = store.get('push'); return P && P.on && Notification.permission === 'granted' ? 'on' : 'off';
      }
      function tz() { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch (e) { return 'UTC'; } }
      function enable(hour) {
        hour = Math.max(0, Math.min(23, Number(hour) || (store.get('profile') || {}).ciHour || 21));
        var C = window.LifeOS.cloud;
        if (!supported()) return Promise.reject(new Error(state() === 'ios-home' ? 'Ajoute d\'abord l\'appli à ton écran d\'accueil (Partager → Sur l\'écran d\'accueil), puis ouvre-la depuis l\'icône.' : 'Ton navigateur ne gère pas les notifications. Utilise le rappel agenda.'));
        var guard = new Promise(function (_, rej) { setTimeout(function () { rej(new Error('Le téléphone ne répond pas. Réessaie, ou utilise le rappel agenda.')); }, 20000); });
        return Promise.race([guard, Notification.requestPermission().then(function (perm) {
          if (perm !== 'granted') throw new Error('Notifications refusées. Tu peux les réactiver dans les réglages du téléphone.');
          return Promise.all([navigator.serviceWorker.ready, C.rpc('lifeos_push_public_key')]);
        }).then(function (r) {
          var reg = r[0], key = r[1]; if (!key) throw new Error('Notifications pas encore prêtes côté serveur.');
          return reg.pushManager.getSubscription().then(function (old) { return old || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }); });
        }).then(function (sub) {
          var j = sub.toJSON();
          return C.rpc('lifeos_push_subscribe', { sub: j, hour: hour, tz: tz() }).then(function () { store.set('push', { on: true, hour: hour, at: isoDay(new Date()), endpoint: j.endpoint }); return true; });
        })]).catch(function (e) { var m = (e && e.message) || ''; throw new Error(/Ajoute|Notifications|téléphone|navigateur/.test(m) ? m : 'Connexion au serveur impossible pour le moment. Réessaie plus tard, ou utilise le rappel agenda.'); });
      }
      function disable() {
        var P = store.get('push') || {}; store.set('push', { on: false, hour: P.hour });
        return navigator.serviceWorker.ready.then(function (reg) { return reg.pushManager.getSubscription(); }).then(function (sub) {
          if (!sub) return; var ep = sub.endpoint; return sub.unsubscribe().then(function () { return window.LifeOS.cloud.rpc('lifeos_push_unsubscribe', { endpoint_in: ep }).catch(function () {}); });
        }).catch(function () {});
      }
      function test() {
        var P = store.get('push') || {}; if (!P.endpoint) return Promise.reject(new Error('Active d\'abord les notifications.'));
        return fetch('https://huipwdtnpdntwulqzjhc.supabase.co/functions/v1/lifeos-push?test=' + encodeURIComponent(P.endpoint), { method: 'POST' }).then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.sent) throw new Error('Aucune notification envoyée. Désactive puis réactive les notifications.'); return true; }).catch(function (e) { var m = (e && e.message) || ''; throw new Error(/Active|Aucune/.test(m) ? m : 'Serveur de notifications pas encore prêt.'); });
      }
      return { supported: supported, state: state, enable: enable, disable: disable, test: test, get: function () { return store.get('push'); } };
    })(),
    /* Rappel du soir sans serveur : un événement d'agenda qui se répète chaque jour (iPhone/PC : fichier .ics ; Android : Google Agenda) */
    reminder: (function () {
      function pad(n) { return ('0' + n).slice(-2); }
      function appUrl() { try { return /^https?:/.test(location.protocol) ? location.origin + location.pathname : ''; } catch (e) { return ''; } }
      function startOf(hour) { var d = new Date(); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(hour) + '0000'; }
      var TITLE = '⚔️ Check-in LifeOS XP (2 min)', DESC = 'Note ton argent du jour, coche ta kill list et frappe ton Boss. +300 XP.';
      function fold(l) { var a = Array.from(l), out = [], i = 0; while (i < a.length) { var n = i === 0 ? 70 : 69; out.push((i ? ' ' : '') + a.slice(i, i + n).join('')); i += n; } return out.join('\r\n'); }
      function ics(hour) {
        hour = Math.max(0, Math.min(23, Number(hour) || 21));
        var now = new Date(), stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + 'T' + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + '00Z';
        var u = appUrl();
        return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//LifeOS XP//Rappel//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
          'BEGIN:VEVENT', 'UID:lifeosxp-checkin-' + now.getTime() + '@lifeosxp', 'DTSTAMP:' + stamp, 'DTSTART:' + startOf(hour), 'DURATION:PT10M', 'RRULE:FREQ=DAILY',
          'SUMMARY:' + TITLE, 'DESCRIPTION:' + DESC + (u ? '\\n' + u : '')].concat(u ? ['URL:' + u] : []).concat([
          'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + TITLE, 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR']).map(fold).join('\r\n') + '\r\n';
      }
      function google(hour) {
        hour = Math.max(0, Math.min(23, Number(hour) || 21));
        var st = startOf(hour), en = st.slice(0, 9) + pad(hour) + '1000', u = appUrl();
        return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(TITLE) + '&dates=' + st + '/' + en +
          '&recur=' + encodeURIComponent('RRULE:FREQ=DAILY') + '&details=' + encodeURIComponent(DESC + (u ? '\n' + u : ''));
      }
      function kind() { var ua = navigator.userAgent || ''; return /android/i.test(ua) ? 'google' : 'ics'; }
      function add(hour) {
        hour = Number(hour) || (store.get('profile') || {}).ciHour || 21;
        var k = kind();
        try {
          if (k === 'google') { window.open(google(hour), '_blank', 'noopener'); }
          else {
            var url = URL.createObjectURL(new Blob([ics(hour)], { type: 'text/calendar;charset=utf-8' })), a = document.createElement('a');
            a.href = url; if (/iPhone|iPad|iPod/i.test(navigator.userAgent || '')) { a.target = '_blank'; a.rel = 'noopener'; } else a.download = 'rappel-lifeos-xp.ics';
            document.body.appendChild(a); a.click(); setTimeout(function () { a.remove(); URL.revokeObjectURL(url); }, 4000);
          }
          store.set('reminder', { hour: hour, at: isoDay(new Date()), kind: k });
        } catch (e) {}
        return k;
      }
      return { ics: ics, google: google, add: add, kind: kind, get: function () { return store.get('reminder'); } };
    })(),
    set: function (patch) { Object.assign(SETTINGS, patch || {}); store.set('settings', SETTINGS); try { document.documentElement.lang = SETTINGS.lang; } catch (e) {} bump(); },
    themeMode: function () { return store.get('theme') || 'auto'; },
    setTheme: function () {},
    peek: function (name) { return store.get('state:' + name) || {}; },
    /* écrit dans les données d'un autre écran (seulement quand il n'est pas affiché) */
    poke: function (name, patch) { var cur = store.get('state:' + name) || {}; store.set('state:' + name, Object.assign(cur, patch || {})); },
    /* ---------- V2 : niveaux 1 à 100 et XP, calculés à partir de tes vraies données ---------- */
    xp: (function () {
      var BOSS = [
        ['Le Gardien des 100 €', 100, 'total', 10000], ['Le Collecteur', 500, 'total', 20000], ['Le Mur du Mois', 1000, 'mois', 50000],
        ['Le Double Tranchant', 2000, 'mois', 75000], ['Le Roi des 5 000', 5000, 'mois', 150000], ['Le Titan à 5 chiffres', 10000, 'mois', 200000],
        ['L\'Empereur', 25000, 'mois', 225000], ['Le Dragon', 50000, 'mois', 250000], ['Le Boss Final', 100000, 'mois', 300000]
      ];
      var SPORT_XP = [0, 2000, 5000, 10000, 20000, 30000, 45000, 60000, 80000, 100000];
      function levelOf(total) { var L = 0, need = 1000, acc = 0; while (L < 100 && total >= acc + need) { acc += need; L++; need = (L + 1) * 1000; } return { level: L, into: total - acc, need: L >= 100 ? 0 : need, start: acc }; }
      /* Look de chaque Boss (trophée quand il est battu) : index -1 = Boss 0 */
      var LOOK = [['🛡️', '#8a94a6'], ['💰', '#b08d3c'], ['🧱', '#a0563b'], ['⚔️', '#5b6b8c'], ['👑', '#c9a227'], ['🗿', '#6f7d6b'], ['🏛️', '#8c6fb0'], ['🐉', '#3f8f6b'], ['💀', '#b23a3a']];
      function lookOf(i) { if (i < 0) return { emoji: '🚀', tint: '#4f7cc9' }; var L = LOOK[i] || ['🏆', '#8a94a6']; return { emoji: L[0], tint: L[1] }; }
      /* Actions de la kill list par jour (3 max comptées par jour) */
      function actionsByDay(mainIn) {
        var MN = mainIn || store.get('state:Main') || {}, KL = Object.assign({}, MN.killLog || {}), tdy = isoDay(new Date());
        var kT = (MN.prios || []).filter(function (p) { return p.done && (p.day || tdy) === tdy; }).length; KL[tdy] = Math.max(Number(KL[tdy]) || 0, kT);
        var out = {}; Object.keys(KL).forEach(function (d) { var n = Math.min(3, Number(KL[d]) || 0); if (n > 0 && /^\d{4}-\d\d-\d\d$/.test(d)) out[d] = n; }); return out;
      }
      var ACT_PCT = 0.01, ACT_CAP = 0.15; /* chaque action = 1 % des PV du Boss, au maximum 15 % : le reste, c'est l'argent */
      function bosses(revIn, mainIn) {
        var custom = store.get('bossList'), list = (custom && custom.length ? custom : BOSS.map(function (b) { return { name: b[0], target: b[1], kind: b[2], xp: b[3] }; }));
        var rev = (revIn || store.get('shared:revenus') || []).slice().sort(function (a, b) { return (a.d || '') < (b.d || '') ? -1 : 1; });
        var start = Math.max(0, Math.min(list.length - 1, Number(store.get('bossStart')) || 0));
        var killed = list.map(function (b, i) { return i < start ? 'avant' : null; });
        var ACT = actionsByDay(mainIn), byDay = {}, tdy = isoDay(new Date());
        rev.forEach(function (r) { var d = r.d || tdy; (byDay[d] = byDay[d] || []).push(Number(r.m) || 0); });
        var days = Object.keys(byDay).concat(Object.keys(ACT)).filter(function (d, k, a) { return a.indexOf(d) === k; }).sort();
        var firstRev = rev.length ? (rev[0].d || tdy) : null, launchOn = !!store.get('launch');
        var total = 0, months = {}, cur = start, acts = 0, actsMonth = null, since = null;
        days.forEach(function (d) {
          var mk = d.slice(0, 7);
          (byDay[d] || []).forEach(function (m) { total += m; months[mk] = (months[mk] || 0) + m; });
          if (cur < list.length) {
            var b0 = list[cur];
            if (b0.kind !== 'total' && actsMonth !== mk) { acts = 0; actsMonth = mk; }
            var countable = (since === null || d > since) && !(launchOn && (!firstRev || d < firstRev));
            if (countable) acts += ACT[d] || 0;
          }
          while (cur < list.length) {
            var b = list[cur], money = b.kind === 'total' ? total : (months[mk] || 0), dmg = Math.min(ACT_CAP * b.target, acts * ACT_PCT * b.target);
            if (money + dmg >= b.target) { killed[cur] = d; cur++; acts = 0; since = d; actsMonth = mk; } else break;
          }
        });
        var mkNow = tdy.slice(0, 7), bestMonth = 0;
        Object.keys(months).forEach(function (k) { bestMonth = Math.max(bestMonth, months[k]); });
        var B = cur < list.length ? list[cur] : null, have = B ? (B.kind === 'total' ? total : (months[mkNow] || 0)) : 0;
        var actsNow = B ? (B.kind !== 'total' && actsMonth !== mkNow ? 0 : acts) : 0, actDmg = B ? Math.min(ACT_CAP * B.target, actsNow * ACT_PCT * B.target) : 0;
        var left = B ? Math.max(0, B.target - have - actDmg) : 0;
        return { list: list.map(function (b, i) { return Object.assign({}, b, { i: i, killed: killed[i], look: lookOf(i) }); }), cur: B ? cur : -1, boss: B, have: have, total: total, thisMonth: months[mkNow] || 0, bestMonth: bestMonth,
          acts: actsNow, actDmg: actDmg, actCap: B ? ACT_CAP * B.target : 0, actFull: B ? actDmg >= ACT_CAP * B.target - 1e-9 : false, look: B ? lookOf(cur) : null,
          hp: left, hpPct: B ? Math.max(0, Math.round(left / B.target * 100)) : 0 };
      }
      /* Boss 0 « Le Démarrage » : pour ceux qui n'ont pas encore gagné leur 1er euro. 4 étapes à cocher + la 1re vente. */
      var LAUNCH = {
        'Revente': ['Choisir ma plateforme (Vinted, Leboncoin…)', 'Trouver mes 3 premiers articles', 'Prendre de belles photos', 'Publier mes 3 premières annonces'],
        'Freelance': ['Choisir mon service et mon prix', 'Préparer 2 exemples de mon travail', 'Contacter 10 clients potentiels', 'Publier mon offre'],
        'Contenu': ['Choisir ma niche', 'Créer mon compte pro', 'Publier mes 3 premières vidéos', 'Choisir comment je vais gagner de l\'argent'],
        'Vente': ['Choisir mon produit', 'Calculer mon prix et ma marge', 'Créer ma boutique ou ma page', 'Publier mon premier post produit'],
        'Fait': ['Choisir mes 2 produits phares', 'Fixer mes prix', 'Prendre des photos de mes créations', 'Annoncer sur WhatsApp ou Insta'],
        'Coaching': ['Définir mon offre', 'Fixer mon prix', 'Lister 3 premiers clients ou élèves possibles', 'Publier mon offre'],
        'def': ['Choisir ce que je vends, en une phrase', 'Fixer mon prix', 'En parler à 5 personnes de ma cible', 'Publier ma première offre (post, annonce, story)']
      };
      function bizKey(b) { b = String(b || ''); var k = Object.keys(LAUNCH).filter(function (x) { return x !== 'def' && b.indexOf(x) === 0; })[0]; return k || 'def'; }
      function launch(revIn) {
        var L = store.get('launch');
        if (!L) return { on: false, has: false, killed: false, nDone: 0, steps: [] };
        var prof = store.get('profile') || {}, done = L.done || {};
        var total = (revIn || store.get('shared:revenus') || []).reduce(function (a, r) { return a + (Number(r.m) || 0); }, 0);
        var names = LAUNCH[bizKey(prof.biz)].concat(['Encaisser mon premier euro']);
        var steps = names.map(function (n, i) { return { i: i, name: n, auto: i === 4, done: i === 4 ? total > 0 : !!done[i] }; });
        var nDone = steps.filter(function (x) { return x.done; }).length, killed = total > 0;
        return { on: !killed, has: true, killed: killed, nDone: nDone, manualDone: steps.filter(function (x) { return x.done && !x.auto; }).length, steps: steps, hpPct: Math.round((5 - nDone) / 5 * 100), xp: 5000 };
      }
      function toggleLaunch(i) {
        var L = store.get('launch'); if (!L || i < 0 || i > 3) return;
        L.done = L.done || {}; if (L.done[i]) delete L.done[i]; else L.done[i] = isoDay(new Date());
        store.set('launch', L);
      }
      function streakAt(C, d) { return flameAt(C, d).n; }
      function summary() {
        var C = store.get('shared:checkins') || {}, H = store.get('shared:habits') || [], F = store.get('shared:focusLog') || {}, SP = store.get('state:Sport') || {}, OB = store.get('state:Objectifs') || {};
        var days = {};
        Object.keys(C).forEach(function (d) { if (/^\d{4}-\d\d-\d\d$/.test(d)) (days[d] = days[d] || {}).ci = 1; });
        (SP.sets || []).forEach(function (x) { if (x.d) (days[x.d] = days[x.d] || {}).se = 1; });
        H.forEach(function (h) { Object.keys(h.log || {}).forEach(function (d) { if (h.log[d] === 1) { var o = (days[d] = days[d] || {}); o.h = (o.h || 0) + 1; } }); });
        Object.keys(F).forEach(function (d) { var m = Number((F[d] || {}).m) || 0; if (m >= 25) (days[d] = days[d] || {}).f = Math.min(4, Math.floor(m / 25)); });
        var MN = store.get('state:Main') || {}, KL = Object.assign({}, MN.killLog || {});
        var tdy = isoDay(new Date()), total = 0, today = 0, week = 0, nH = H.length, wk0 = weekKey(new Date());
        var kT = (MN.prios || []).filter(function (p) { return p.done && (p.day || tdy) === tdy; }).length; KL[tdy] = Math.max(Number(KL[tdy]) || 0, kT);
        Object.keys(KL).forEach(function (d) { if (Number(KL[d]) > 0) (days[d] = days[d] || {}).k = Math.min(3, Number(KL[d])); });
        Object.keys(days).forEach(function (d) {
          var o = days[d], base = (o.ci ? 300 : 0) + (o.se ? 500 : 0) + Math.min(3, o.h || 0) * 150 + (nH && (o.h || 0) >= nH ? 300 : 0) + (o.f || 0) * 200 + (o.k || 0) * 100;
          var st = o.ci ? streakAt(C, d) : 0, mult = 1 + Math.min(0.5, 0.1 * Math.floor(st / 7)), v = Math.round(base * mult);
          total += v; if (d === tdy) today = v; if (d >= wk0) week += v;
        });
        var B = bosses(), bossXP = 0; B.list.forEach(function (b) { if (b.killed && b.killed !== 'avant') bossXP += Number(b.xp) || 0; });
        var ri = SP.rankInfo && SP.rankInfo.v === 2 ? SP.rankInfo : null, spR = ri ? Math.max(0, Math.min(9, ri.r || 0)) : 0, sportXP = 0;
        for (var r = 1; r <= spR; r++) sportXP += SPORT_XP[r];
        var goalsDone = (OB.goals || []).filter(function (g) { return Number(g.pct) >= 100; }).length, goalXP = goalsDone * 10000;
        var LN = launch(), launchXP = LN.has ? LN.manualDone * 200 + (LN.killed ? 5000 : 0) : 0;
        total += bossXP + sportXP + goalXP + launchXP;
        var L = levelOf(total), stNow = streakAt(C, C[tdy] ? tdy : isoDay(new Date(Date.now() - 864e5)));
        return { total: total, today: today, week: week, weekKey: wk0, level: L.level, into: L.into, need: L.need, pct: L.need ? Math.round(L.into / L.need * 100) : 100,
          streak: stNow, mult: 1 + Math.min(0.5, 0.1 * Math.floor(stNow / 7)), bossXP: bossXP, sportXP: sportXP, goalXP: goalXP, launchXP: launchXP, launch: LN, bosses: B };
      }
      function fmt(n) { return Math.round(Number(n) || 0).toLocaleString('fr-FR'); }
      /* Rivaux 🤖 : clairement indiqués comme des bots, ils progressent chaque jour à un rythme réaliste */
      var BOTS = [['Léo le Régulier', 1400, 9000], ['Nora Focus', 1900, 30000], ['Sam Débutant', 650, 1500], ['Inès la Machine', 2600, 120000], ['Max Série', 1700, 60000],
        ['Yanis Push', 1200, 22000], ['Lina Matin', 2100, 85000], ['Tom Chill', 500, 4000], ['Sofia Discipline', 2900, 260000], ['Adam Grind', 3200, 520000], ['Ravi Calme', 900, 14000], ['Jade Sprint', 1500, 40000]];
      function rivals() {
        var d0 = new Date(2026, 10, 1), now = new Date(), days = Math.max(0, Math.floor((now - d0) / 864e5)), dow = (now.getDay() + 6) % 7;
        return BOTS.map(function (b, i) {
          var wob = 0.75 + 0.5 * ((Math.sin(days * 1.3 + i * 7) + 1) / 2), total = Math.round(b[2] + b[1] * days * 0.97), wk = Math.round(b[1] * (dow + 1) * wob);
          return { bot: true, user_id: 'bot' + i, pseudo: b[0], xp_total: total, xp_week: wk, level: levelOf(total).level, sport_rank: Math.min(6, 1 + (i % 5)), streak: 3 + (i * 5) % 40 };
        });
      }
      return { summary: summary, bosses: bosses, lookOf: lookOf, ACT_PCT: ACT_PCT, ACT_CAP: ACT_CAP, launch: launch, toggleLaunch: toggleLaunch, bizKey: bizKey, levelOf: levelOf, fmt: fmt, rivals: rivals, BOSS: BOSS, SPORT_XP: SPORT_XP };
    })(),
    /* Rangs du sport : 5 rangs à 3 niveaux, puis Champion et Légende, avec leur emblème */
    sport: (function () {
      /* Rangs façon Liftoff : 9 rangs sur une note de force de 1 à 1000, 100 LP par rang */
      var FAM = [['Non classé', ['#b4b7bc', '#7c7f85', '#45474c']], ['Bois', ['#d9b38c', '#8a5a3b', '#4a2d1a']], ['Bronze', ['#f3c193', '#b9814f', '#6e4527']], ['Argent', ['#f4f6f8', '#a3a9b0', '#5d636a']], ['Or', ['#ffe9a3', '#d9ad2f', '#8a6608']],
        ['Platine', ['#c6f5f2', '#4fb8b6', '#1f6b6a']], ['Diamant', ['#d3e2ff', '#5b8def', '#2443a3']], ['Champion', ['#ffc2d4', '#e0457b', '#8c1d47']], ['Titan', ['#ffd6b0', '#e06a1f', '#7a2e05']], ['Olympien', ['#ecd9ff', '#a259ff', '#5418b0']]];
      var names = FAM.map(function (x) { return x[0]; });
      var ROMAN = ['?', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', '★'];
      /* points d'ancrage : note -> fraction des standards [débutant, novice, intermédiaire, avancé, élite, élite+] */
      function anchors(th) {
        return [[0, 0], [200, th[1]], [300, th[2]], [400, (th[2] + th[3]) / 2], [500, th[3]], [600, (th[3] + th[4]) / 2], [700, th[4]], [800, th[5]], [900, th[5] * 1.12], [1000, th[5] * 1.24]];
      }
      function rating(v, th) {
        if (!th || !(v > 0)) return 0;
        var A = anchors(th);
        for (var i = 1; i < A.length; i++) if (v < A[i][1]) return Math.max(1, Math.floor(A[i - 1][0] + (A[i][0] - A[i - 1][0]) * (v - A[i - 1][1]) / (A[i][1] - A[i - 1][1])));
        var L = A[A.length - 1], P = A[A.length - 2];
        return Math.floor(L[0] + (L[0] - P[0]) * (v - L[1]) / (L[1] - P[1]));
      }
      function valueFor(r, th) { var A = anchors(th); for (var i = 1; i < A.length; i++) if (r <= A[i][0]) return A[i - 1][1] + (A[i][1] - A[i - 1][1]) * (r - A[i - 1][0]) / (A[i][0] - A[i - 1][0]); return A[A.length - 1][1]; }
      function rankOfRating(r) { return r <= 0 ? 0 : r < 200 ? 1 : Math.min(9, Math.floor(r / 100)); }
      function lp(r) { return r <= 0 ? 0 : r < 200 ? Math.floor(r / 2) : r >= 900 ? r - 900 : r % 100; }
      function floorOf(i) { return i <= 0 ? 0 : i === 1 ? 1 : i * 100; }
      var SH = 'polygon(50% 0, 100% 17%, 100% 63%, 50% 100%, 0 63%, 0 17%)';
      function emblem(i, size) {
        i = Math.max(0, Math.min(9, Number(i) || 0)); size = size || 46;
        var c = FAM[i][1], on = i > 0;
        return {
          name: names[i], family: names[i], color: on ? c[1] : 'inherit', label: ROMAN[i],
          wrap: 'position: relative; display: inline-grid; place-items: center; flex: none; width: ' + size + 'px; height: ' + Math.round(size * 1.14) + 'px; --g: ' + c[1] + ';' + (on ? ' animation: lifeos-glow 2.8s ease-in-out infinite;' : ' opacity: .55;'),
          shape: 'position: relative; width: 100%; height: 100%; clip-path: ' + SH + '; background: linear-gradient(160deg, ' + c[0] + ' 0%, ' + c[1] + ' 55%, ' + c[2] + ' 100%); display: grid; place-items: center; overflow: hidden;',
          inner: 'position: absolute; inset: ' + Math.max(3, Math.round(size * 0.09)) + 'px; clip-path: ' + SH + '; background: linear-gradient(200deg, rgba(255,255,255,.38), rgba(255,255,255,0) 62%); box-shadow: inset 0 0 0 2px rgba(255,255,255,.25); pointer-events: none;',
          shine: on ? 'position: absolute; top: -20%; bottom: -20%; left: 0; width: 38%; background: linear-gradient(90deg, transparent, rgba(255,255,255,.8), transparent); animation: lifeos-shine 3.4s ease-in-out infinite; pointer-events: none;' : 'display: none;',
          num: "position: relative; color: #fff; font-family: 'Urbanist', 'Manrope', system-ui, sans-serif; font-weight: 800; font-size: " + Math.round(size * (i >= 7 && i <= 8 ? 0.26 : 0.34)) + 'px; line-height: 1; text-shadow: 0 1px 5px rgba(0,0,0,.45);'
        };
      }
      return { v: 2, names: names, rating: rating, valueFor: valueFor, rankOfRating: rankOfRating, lp: lp, floorOf: floorOf, emblem: emblem, families: names, max: 9 };
    })(),
    /* XP, rangs et série du check-in du soir */
    ci: {
      RANKS: [[0, 'Recrue'], [100, 'Apprenti'], [300, 'Débrouillard'], [700, 'Hustler'], [1500, 'Entrepreneur'], [3000, 'Fondateur'], [6000, 'Boss'], [12000, 'Légende']],
      total: function (C) { return Object.keys(C || {}).reduce(function (a, k) { return a + (Number((C[k] || {}).xp) || 0); }, 0); },
      rank: function (xp) {
        var RK = window.LifeOS.ci.RANKS, i = 0;
        while (i + 1 < RK.length && xp >= RK[i + 1][0]) i++;
        var nx = RK[i + 1];
        return { i: i, name: RK[i][1], min: RK[i][0], next: nx ? nx[0] : null, nextName: nx ? nx[1] : '', left: nx ? nx[0] - xp : 0, pct: nx ? Math.round((xp - RK[i][0]) / (nx[0] - RK[i][0]) * 100) : 100 };
      },
      streak: function (C, tdy) {
        C = C || {}; var d = new Date(tdy + 'T12:00:00');
        if (!C[tdy]) d.setDate(d.getDate() - 1);
        return flameAt(C, isoDay(d)).n;
      },
      streakBefore: function (C, tdy) { var d = new Date(tdy + 'T12:00:00'); d.setDate(d.getDate() - 1); return flameAt(C || {}, isoDay(d)).n; }
    },
    rate: rate,
    toDisp: function (eur) { return SETTINGS.currency === 'Rs' ? Math.round(Number(eur || 0) * rate()) : Number(eur || 0); },
    fromDisp: function (v) { var n = Number(v) || 0; return SETTINGS.currency === 'Rs' ? Math.round(n / rate() * 100) / 100 : Math.round(n * 100) / 100; },
    amountToEur: amountToEur,
    amountToDisp: function (t) { return SETTINGS.currency === 'Rs' ? toRs(String(t || '')) : String(t || ''); },
    exportData: function () {
      var data = {};
      store.keys().forEach(function (k) { data[k] = localStorage.getItem(k); });
      var name = 'LifeOS-sauvegarde-' + isoDay(new Date()) + '.json';
      var blob = new Blob([JSON.stringify({ app: 'LifeOS', format: 1, exportedAt: new Date().toISOString(), data: data }, null, 1)], { type: 'application/json' });
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1500);
      return name;
    },
    importData: function (file, cb) {
      var fr = new FileReader();
      fr.onerror = function () { cb(false); };
      fr.onload = function () {
        var obj = null;
        try { obj = JSON.parse(String(fr.result)); } catch (e) {}
        var ok = obj && obj.app === 'LifeOS' && obj.data && typeof obj.data === 'object' && Object.keys(obj.data).length > 0 && Object.keys(obj.data).every(function (k) { return k.indexOf('lifeos:') === 0 && typeof obj.data[k] === 'string'; });
        if (!ok) { cb(false); return; }
        store.keys().forEach(function (k) { localStorage.removeItem(k); });
        Object.keys(obj.data).forEach(function (k) { try { localStorage.setItem(k, obj.data[k]); } catch (e) {} });
        frozen = true; cb(true);
        setTimeout(function () { window.location.reload(); }, 900);
      };
      fr.readAsText(file);
    },
    resetAll: function (cb) {
      frozen = true;
      /* on garde seulement les réglages d'affichage et les marqueurs de mise à jour (sinon d'anciennes données reviendraient) */
      var KEEP = { 'lifeos:theme': 1, 'lifeos:dataVersion': 1, 'lifeos:planV8': 1, 'lifeos:cleanV9': 1, 'lifeos:sync': 1 };
      store.keys().forEach(function (k) { if (!KEEP[k] && k !== 'lifeos:settings') localStorage.removeItem(k); });
      try { var S = JSON.parse(localStorage.getItem('lifeos:settings') || '{}') || {}; localStorage.setItem('lifeos:settings', JSON.stringify({ lang: S.lang || 'fr', currency: S.currency || '€', name: '' })); } catch (e) {}
      try { localStorage.setItem('lifeos:shared:habits', '[]'); } catch (e) {}
      var done = function () { window.location.reload(); };
      /* connecté : on efface aussi la sauvegarde en ligne, sinon elle remettrait tout au rechargement */
      var w = Cloud.wipe(); if (cb) cb(!!w);
      if (w) { var t = setTimeout(done, 6000); w.then(function () { clearTimeout(t); done(); }, function () { clearTimeout(t); done(); }); }
      else done();
    }
  };
  var frozen = false;

  /* ---------- Animations : pages, rafraîchissement, boutons qui glissent ---------- */
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function animatedReload() {
    if (reduce) { window.location.reload(); return; }
    document.body.classList.add('lifeos-leaving');
    setTimeout(function () { window.location.reload(); }, 380);
  }
  (function () {
    var css = [
      '@keyframes lifeos-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}',
      '@keyframes lifeos-spin{to{transform:rotate(360deg)}}',
      '@keyframes lifeos-glow{0%,100%{filter:drop-shadow(0 0 4px var(--g))}50%{filter:drop-shadow(0 0 14px var(--g))}}',
      '@keyframes lifeos-shine{0%{transform:translateX(-140%) skewX(-18deg)}55%,100%{transform:translateX(320%) skewX(-18deg)}}',
      '@keyframes lifeos-rankup{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.12);opacity:1}100%{transform:scale(1)}}',
      '@keyframes lifeos-drop{from{opacity:0;transform:translateY(-4px) scale(.98)}to{opacity:1;transform:none}}',
      '@keyframes lifeos-bumpk{0%{transform:scale(1)}35%{transform:scale(1.14)}100%{transform:scale(1)}}',
      '.lifeos-bump{display:inline-block;animation:lifeos-bumpk .24s ease}',
      '@keyframes lifeos-pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,107,44,.45)}50%{box-shadow:0 0 0 12px rgba(255,107,44,0)}}',
      '.lifeos-pulse{animation:lifeos-pulse 1.8s ease-in-out infinite}',
      '.lifeos-page{min-height:100%;animation:lifeos-in .42s cubic-bezier(.2,.7,.2,1)}',
      '#root{transition:opacity .34s ease,filter .34s ease}',
      'body.lifeos-leaving #root{opacity:0;filter:blur(6px)}',
      'body.lifeos-leaving [data-lifeos-logo] span{animation:lifeos-spin .38s cubic-bezier(.4,0,.2,1)}',
      'button,a[href]{transition:background-color .28s ease,color .28s ease,border-color .28s ease,box-shadow .28s ease,opacity .28s ease,transform .16s ease!important}',
      'button:active,a[href]:active,[data-lifeos-logo]:active{transform:scale(.96)}',
      '[role="dialog"]{animation:lifeos-in .26s cubic-bezier(.2,.7,.2,1)}',
      '.lifeos-seg{position:relative!important;isolation:isolate}',
      '.lifeos-seg::before{content:"";position:absolute;left:0;top:0;width:var(--seg-w,0);height:var(--seg-h,0);transform:translate(var(--seg-x,0),var(--seg-y,0));background:var(--seg-bg,transparent);border-radius:var(--seg-r,999px);z-index:0;pointer-events:none;transition:transform .36s cubic-bezier(.4,0,.2,1),width .36s cubic-bezier(.4,0,.2,1),height .36s cubic-bezier(.4,0,.2,1),background-color .3s ease}',
      '.lifeos-seg.lifeos-seg-init::before{transition:none}',
      '.lifeos-seg>button{position:relative;z-index:1}',
      '.lifeos-seg>button[aria-pressed="true"]{background:transparent!important;border-color:transparent!important}',
      '.lifeos-tabbar{display:none}',
      '.lifeos-mobile-only{display:none!important}.lifeos-hide{display:none!important}',
      '.lifeos-press{transition:transform 160ms cubic-bezier(0.23,1,0.32,1)}.lifeos-press:active{transform:scale(0.97)}',
      '@keyframes lifeos-hit{0%{opacity:0;transform:translateY(6px) scale(.96)}20%{opacity:1;transform:none}100%{opacity:0;transform:translateY(-26px)}}@keyframes lifeos-shake{0%,100%{transform:none}25%{transform:translateX(-4px)}55%{transform:translateX(3px)}80%{transform:translateX(-1px)}}',
      '.lifeos-dmg{animation:lifeos-hit 900ms cubic-bezier(0.23,1,0.32,1) forwards}.lifeos-shake{animation:lifeos-shake 320ms cubic-bezier(0.23,1,0.32,1)}.lifeos-hp{transition:width 600ms cubic-bezier(0.23,1,0.32,1)}',
      '@media (prefers-reduced-motion: reduce){.lifeos-press,.lifeos-hp{transition:none}.lifeos-dmg{animation:none;opacity:0}.lifeos-shake{animation:none}}',
      'aside a[href^="Developpement"]{display:none!important}',
      '@media (max-width:760px){' + [
        '.lifeos-tabbar{display:flex}div.lifeos-tabbar{display:block}',
        'aside[aria-label="Navigation"]{display:none!important}',
        '.lifeos-mobile-only{display:grid!important}.lifeos-desk-only{display:none!important}',
        '.sp-ranks,.sp-more{display:none!important}',
        '.lifeos-page>div>div[aria-hidden="true"]:first-child{display:none!important}',
        'html,body,#root{height:auto!important;min-height:100%}',
        '.lifeos-page{padding-bottom:calc(112px + env(safe-area-inset-bottom))}',
        '.lifeos-pill{bottom:calc(86px + env(safe-area-inset-bottom))!important;right:12px!important}',
        'main{gap:14px!important}',
        'input,select,textarea{font-size:16px!important}',
        'main>header>button,main>header>div:last-child:not(:first-child){display:none!important}',
        'main>header h1{font-size:30px!important}',
        'section[aria-label="Planning"],section[aria-label="Boss du palier 1"],section#priorites,section#argent,body[data-screen="Main"] section#habitudes{display:none!important}',
        'section[aria-label="Agenda de la semaine"],section[aria-label="Boîte d\'idées"]{display:none!important}',
        'section[aria-label="Détail de l\'objectif"]{display:none!important}',
        '.obj-pal{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:10px!important;overflow:visible!important}',
        '.obj-pal span[style*="26px"]{font-size:20px!important}',
        '.sp-howto{display:none!important}',
        '.sp-routines{order:2}.sp-ranks{order:3}.sp-more{order:4}',
        '.hab-grid{gap:4px!important}',
        '.hab-cell{min-height:42px!important;border-radius:10px!important}',
        '.hab-cell-btn{font-size:0!important;padding:0!important;width:22px;height:22px;margin-top:16px!important;display:grid;place-items:center}',
        '.hab-cell-btn::after{content:"✓";font-size:13px;font-weight:900}',
        'body[data-screen="CheckIn"] .lifeos-page{padding-bottom:12px}',
        'div.lifeos-tabbar[data-lifeos-logo]{display:grid}',
        'main>header{padding-right:58px!important}'
      ].join('') + '}',
      '@keyframes lifeos-sheet{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:none}}',
      '@keyframes lifeos-fade{from{opacity:0}to{opacity:1}}',
      '@media (prefers-reduced-motion: reduce){.lifeos-page,[role="dialog"]{animation:none}.lifeos-seg::before{transition:none}}'
    ].join('\n');
    var el = document.createElement('style'); el.textContent = css; document.head.appendChild(el);
  })();
  function updateSegs() {
    Array.prototype.forEach.call(document.querySelectorAll('[role="group"]'), function (g) {
      var btns = Array.prototype.filter.call(g.children, function (c) { return c.tagName === 'BUTTON' && c.hasAttribute('aria-pressed'); });
      var on = btns.filter(function (b) { return b.getAttribute('aria-pressed') === 'true'; });
      if (btns.length < 2 || on.length !== 1) { if (g.classList.contains('lifeos-seg')) g.style.setProperty('--seg-w', '0px'); return; }
      var b = on[0], bg = b.style.backgroundColor || b.style.background;
      if (!bg || /transparent|rgba\(0, 0, 0, 0\)/.test(bg)) return;
      var first = !g.classList.contains('lifeos-seg');
      if (first) g.classList.add('lifeos-seg', 'lifeos-seg-init');
      var gr = g.getBoundingClientRect(), br = b.getBoundingClientRect();
      var bl = parseFloat(getComputedStyle(g).borderLeftWidth) || 0, bt = parseFloat(getComputedStyle(g).borderTopWidth) || 0;
      g.style.setProperty('--seg-x', (br.left - gr.left - bl) + 'px');
      g.style.setProperty('--seg-y', (br.top - gr.top - bt) + 'px');
      g.style.setProperty('--seg-w', br.width + 'px');
      g.style.setProperty('--seg-h', br.height + 'px');
      g.style.setProperty('--seg-bg', bg);
      g.style.setProperty('--seg-r', getComputedStyle(b).borderRadius);
      if (first) requestAnimationFrame(function () { requestAnimationFrame(function () { g.classList.remove('lifeos-seg-init'); }); });
    });
  }
  var segQueued = false;
  function queueSegs() { if (segQueued) return; segQueued = true; requestAnimationFrame(function () { segQueued = false; updateSegs(); }); }
  try {
    new MutationObserver(function (recs) { for (var i = 0; i < recs.length; i++) { var t = recs[i].target; if (!(recs[i].type === 'attributes' && t.classList && t.classList.contains('lifeos-seg'))) { queueSegs(); return; } } }).observe(document.getElementById('root'), { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'style'] });
    window.addEventListener('resize', queueSegs);
  } catch (e) {}

  /* ---------- Téléphone : barre d'onglets en bas (remplace le menu de gauche) ---------- */
  var TAB_ICONS = {
    Main: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
    CheckIn: 'M13 2L4 14h7l-1 8 9-12h-7z',
    Planning: 'M4 5h16v15H4zM4 10h16M9 3v4M15 3v4',
    Objectifs: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    Sport: 'M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11',
    Productivity: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2M9 2h6',
    Plus: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'
  };
  function TabBar(p) {
    var o = R.useState(false), more = o[0], setMore = o[1];
    if (p.screen === 'CheckIn') return null;
    var dark = p.theme === 'sombre';
    var C = dark ? { bg: 'rgba(27,27,30,.94)', ink: '#f2f2f3', mut: '#9a9ca2', line: 'rgba(255,255,255,.08)', sheet: '#151517', on: 'rgba(255,255,255,.08)', act: '#f2f2f3', actInk: '#0b0b0c', card: 'rgba(255,255,255,.05)' }
                 : { bg: 'rgba(255,255,255,.96)', ink: '#0d0e10', mut: '#45474c', line: 'rgba(13,14,16,.08)', sheet: '#ffffff', on: 'rgba(13,14,16,.06)', act: '#0d0e10', actInk: '#ffffff', card: '#f3f4f6' };
    var MORE = [['Sport', 'Sport', 'Séances et rangs', 'M6.5 6.5v11M17.5 6.5v11M3 9.5v5M21 9.5v5M6.5 12h11'], ['Habitudes', 'Habitudes', 'Flames et séries', 'M12.6 2.2c.4 2.6 1.8 4.2 3.3 5.9 1.4 1.6 2.6 3.3 2.6 5.9A6.5 6.5 0 0 1 12 20.5 6.5 6.5 0 0 1 5.5 14c0-2.4 1.1-4.1 2.6-5.3-.1 1.6.4 2.9 1.6 3.6-.2-3.7 1.2-7.3 2.9-10.1z'], ['Classement', 'Classement', 'Amis et monde', 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3'], ['Parametres', 'Paramètres', 'Langue, thème, données', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a7.9 7.9 0 0 0 0-6M4.6 9a7.9 7.9 0 0 0 0 6']];
    var inMore = MORE.some(function (m) { return m[0] === p.screen; });
    function icon(d) { return h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }, h('path', { d: d })); }
    function tab(name, label, key) {
      var on = key === 'Plus' ? (more || inMore) : p.screen === name;
      var st = on
        ? { display: 'flex', alignItems: 'center', gap: 8, padding: '0 18px', height: 48, borderRadius: 999, background: C.act, color: C.actInk, textDecoration: 'none', border: 0, font: 'inherit', fontSize: 13, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap', transition: 'background-color .25s ease' }
        : { width: 48, height: 48, display: 'grid', placeItems: 'center', borderRadius: '50%', color: C.mut, textDecoration: 'none', border: 0, background: 'transparent', font: 'inherit', cursor: 'pointer', flex: 'none' };
      var kids = on ? [h('span', { key: 'i', style: { display: 'grid' } }, icon(TAB_ICONS[key || name])), h('span', { key: 'l' }, out(label))] : [icon(TAB_ICONS[key || name])];
      if (key === 'Plus') return h('button', { key: key, type: 'button', 'aria-label': out(label), 'aria-expanded': more ? 'true' : 'false', onClick: function () { setMore(!more); }, style: st }, kids);
      return h('a', { key: name, href: name + '.dc.html', 'aria-label': on ? undefined : out(label), onClick: function () { setMore(false); }, 'aria-current': on ? 'page' : undefined, style: st }, kids);
    }
    return h(R.Fragment, null,
      more ? h('div', { className: 'lifeos-tabbar', onClick: function () { setMore(false); }, style: { position: 'fixed', inset: 0, zIndex: 58, background: 'rgba(0,0,0,.45)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)', animation: 'lifeos-fade .2s ease' } }) : null,
      more ? h('div', { className: 'lifeos-tabbar', role: 'menu', style: { position: 'fixed', left: 12, right: 12, bottom: 'calc(84px + env(safe-area-inset-bottom))', zIndex: 59, background: C.sheet, border: '1px solid ' + C.line, borderRadius: 26, padding: 14, boxShadow: '0 24px 60px rgba(0,0,0,.4)', animation: 'lifeos-sheet .28s cubic-bezier(.2,.8,.2,1)', fontFamily: "'Manrope', system-ui, sans-serif" } },
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 } },
          MORE.map(function (m, i) {
            var on = p.screen === m[0], hero = i === 0;
            return h('a', { key: m[0], role: 'menuitem', href: m[0] + '.dc.html', onClick: function () { setMore(false); }, style: { display: 'flex', flexDirection: 'column', gap: 12, padding: 16, minHeight: 132, borderRadius: 22, textDecoration: 'none', color: hero ? C.actInk : C.ink, background: hero ? C.act : C.card, border: on ? '2px solid ' + C.ink : '0', animation: 'lifeos-sheet .32s cubic-bezier(.2,.8,.2,1) both', animationDelay: (0.04 * i) + 's' } },
              h('span', { style: { width: 40, height: 40, borderRadius: 14, display: 'grid', placeItems: 'center', background: hero ? 'rgba(127,127,127,.18)' : (dark ? 'rgba(255,255,255,.08)' : '#ffffff') } }, icon(m[3])),
              h('span', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, h('b', { style: { fontSize: 15, fontWeight: 800 } }, out(m[1])), h('span', { style: { fontSize: 12, fontWeight: 600, color: hero ? (dark ? '#45474c' : '#a2a5aa') : C.mut } }, out(m[2]))));
          }))) : null,
      h('div', { className: 'lifeos-tabbar', 'data-lifeos-logo': '1', role: 'button', tabIndex: 0, title: out('Rafraîchir LifeOS'), 'aria-label': out('Rafraîchir LifeOS'), style: { position: 'absolute', top: 'calc(14px + env(safe-area-inset-top))', right: 16, zIndex: 30, width: 44, height: 44, borderRadius: 14, background: C.ink, color: dark ? '#0b0b0c' : '#ffffff', placeItems: 'center', cursor: 'pointer', boxShadow: '0 6px 18px rgba(0,0,0,.25)', fontFamily: "'Urbanist', 'Manrope', system-ui, sans-serif", fontWeight: 700, fontSize: 21, userSelect: 'none' } }, h('span', null, 'L')),
      h('nav', { className: 'lifeos-tabbar', 'aria-label': out('Navigation'), style: { position: 'fixed', left: 14, right: 14, bottom: 'calc(14px + env(safe-area-inset-bottom))', zIndex: 60, padding: 7, alignItems: 'center', justifyContent: 'space-between', borderRadius: 999, background: C.bg, boxShadow: '0 14px 34px rgba(13,14,16,.18)', border: '1px solid ' + C.line, backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)', fontFamily: "'Manrope', system-ui, sans-serif" } },
        tab('Main', 'Accueil'), tab('Planning', 'Planning'), tab('Productivity', 'Focus'), tab('Objectifs', 'Objectifs'), tab(null, 'Plus', 'Plus')));
  }

  /* ---------- Application ---------- */
  /* ---------- Cartes à partager (story 1080×1920, noir et blanc) ---------- */
  function shareCard(o) {
    var W = 1080, H = 1920, cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    var c = cv.getContext('2d');
    var ready = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    return ready.then(function () {
      var UR = "'Urbanist', 'Manrope', system-ui, sans-serif", MA = "'Manrope', system-ui, sans-serif";
      c.fillStyle = '#0b0b0c'; c.fillRect(0, 0, W, H);
      var g = c.createRadialGradient(W * 0.8, H * 0.12, 40, W * 0.8, H * 0.12, 900); g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, W, H);
      function rr(x, y, w, hh, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hh, r); c.arcTo(x + w, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
      function fit(txt, font, size, maxW) { var sz = size; do { c.font = font.replace('{s}', sz); sz -= 4; } while (c.measureText(txt).width > maxW && sz > 40); return sz + 4; }
      /* logo */
      rr(90, 120, 96, 96, 26); c.fillStyle = '#f4f4f5'; c.fill();
      c.fillStyle = '#0b0b0c'; c.font = '800 58px ' + UR; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('L', 138, 170);
      c.textAlign = 'left'; c.fillStyle = '#f4f4f5'; c.font = '800 46px ' + UR; c.fillText('LifeOS XP', 214, 170);
      /* kicker */
      c.textBaseline = 'alphabetic'; c.fillStyle = '#a2a5aa'; c.font = '800 40px ' + MA; c.fillText(String(o.kicker || '').toUpperCase(), 90, 520);
      /* titre */
      c.fillStyle = '#f4f4f5'; fit(o.title || '', '800 {s}px ' + UR, 132, W - 180); c.fillText(o.title || '', 90, 680);
      if (o.sub) { c.fillStyle = '#a2a5aa'; c.font = '600 46px ' + MA; c.fillText(o.sub, 90, 760); }
      /* grand chiffre */
      if (o.big) { c.fillStyle = '#f4f4f5'; fit(o.big, '800 {s}px ' + UR, 360, W - 180); c.fillText(o.big, 80, 1180); }
      if (o.bigSub) { c.fillStyle = '#a2a5aa'; c.font = '700 48px ' + MA; c.fillText(o.bigSub, 90, 1260); }
      /* barre */
      if (o.bar != null) { rr(90, 1320, W - 180, 34, 17); c.fillStyle = 'rgba(255,255,255,0.12)'; c.fill(); var bw = Math.max(34, (W - 180) * Math.max(0, Math.min(1, o.bar))); rr(90, 1320, bw, 34, 17); c.fillStyle = '#f4f4f5'; c.fill(); }
      /* stats */
      var st = o.stats || [], cw = (W - 180 - 40 * (st.length - 1)) / Math.max(1, st.length);
      st.forEach(function (x, i) {
        var x0 = 90 + i * (cw + 40); rr(x0, 1460, cw, 200, 40); c.fillStyle = 'rgba(255,255,255,0.07)'; c.fill();
        c.fillStyle = '#a2a5aa'; c.font = '700 34px ' + MA; c.fillText(x[0], x0 + 34, 1530);
        c.fillStyle = '#f4f4f5'; fit(String(x[1]), '800 {s}px ' + UR, 70, cw - 68); c.fillText(String(x[1]), x0 + 34, 1620);
      });
      c.fillStyle = '#6b6e75'; c.font = '700 36px ' + MA; c.fillText(o.foot || 'Transforme ton business en jeu · LifeOS XP', 90, 1800);
      return new Promise(function (res) { cv.toBlob(function (b) { res(b); }, 'image/png'); });
    });
  }
  function ShareSheet() {
    var s1 = R.useState(null), cur = s1[0], setCur = s1[1];
    var u1 = R.useState(''), url = u1[0], setUrl = u1[1];
    var m1 = R.useState(''), msg = m1[0], setMsg = m1[1];
    var blobRef = R.useRef(null);
    R.useEffect(function () {
      function on(e) { setCur(e.detail || {}); setMsg(''); setUrl(''); blobRef.current = null; shareCard(e.detail || {}).then(function (b) { blobRef.current = b; setUrl(URL.createObjectURL(b)); }); }
      window.addEventListener('lifeos-share', on);
      return function () { window.removeEventListener('lifeos-share', on); };
    }, []);
    if (!cur) return null;
    var dark = isDark(), name = 'lifeos-xp-' + (cur.kind || 'carte') + '.png';
    var close = function () { setCur(null); if (url) URL.revokeObjectURL(url); };
    var share = function () {
      var b = blobRef.current; if (!b) return;
      var f = null; try { f = new File([b], name, { type: 'image/png' }); } catch (e) {}
      if (f && navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f], text: cur.text || '' }).catch(function () {}); }
      else { var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setMsg(out('Image enregistrée. Publie-la en story !')); }
    };
    var btn = { border: 0, borderRadius: 999, minHeight: 52, padding: '0 22px', font: 'inherit', fontSize: 15, fontWeight: 800, cursor: 'pointer' };
    return h('div', { role: 'dialog', 'aria-modal': 'true', 'aria-label': out('Partager'), onClick: close, style: { position: 'fixed', inset: 0, zIndex: 90, background: 'rgba(0,0,0,.6)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 20, animation: 'lifeos-fade .2s ease', fontFamily: "'Manrope', system-ui, sans-serif" } },
      h('div', { onClick: function (e) { e.stopPropagation(); }, style: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, animation: 'lifeos-sheet .28s cubic-bezier(.23,1,.32,1)' } },
        url ? h('img', { src: url, alt: out('Carte à partager'), style: { width: 'min(62vw, 300px)', aspectRatio: '9 / 16', borderRadius: 22, boxShadow: '0 24px 60px rgba(0,0,0,.5)' } }) : h('div', { style: { width: 'min(62vw, 300px)', aspectRatio: '9 / 16', borderRadius: 22, background: '#151517' } }),
        h('div', { style: { display: 'flex', gap: 10 } },
          h('button', { type: 'button', onClick: share, className: 'lifeos-press', style: Object.assign({}, btn, { background: '#f4f4f5', color: '#0b0b0c' }) }, out('Partager')),
          h('button', { type: 'button', onClick: close, className: 'lifeos-press', style: Object.assign({}, btn, { background: 'rgba(255,255,255,.12)', color: '#f4f4f5' }) }, out('Fermer'))),
        msg ? h('span', { role: 'status', style: { color: '#f4f4f5', fontSize: 13, fontWeight: 700 } }, msg) : null));
  }

  /* ---------- Onboarding (premier lancement) ---------- */
  function needsOnboarding() {
    if (store.get('onboarded')) return false;
    try {
      if (BOOT_HAS_DATA) { store.set('onboarded', true); return false; }
    } catch (e) {}
    return !/[?&]skipOnboarding/.test(location.search);
  }
  function Onboarding(p) {
    var st1 = R.useState(0), step = st1[0], setStep = st1[1];
    var a1 = R.useState({ name: '', biz: '', rev: -1, tasks: [], hour: 21, task: '' }), A = a1[0], setA = a1[1];
    var dark = p.theme === 'sombre';
    var C = dark ? { bg: '#0b0b0c', card: '#151517', ink: '#f2f2f3', mut: '#8e9096', soft: 'rgba(255,255,255,.07)', line: 'rgba(255,255,255,.1)', strong: '#f2f2f3', strongInk: '#0b0b0c' }
                 : { bg: '#edeef0', card: '#ffffff', ink: '#0d0e10', mut: '#5c6067', soft: '#f3f4f6', line: 'rgba(13,14,16,.1)', strong: '#0d0e10', strongInk: '#ffffff' };
    var BOSS = (window.LifeOS && window.LifeOS.xp) ? window.LifeOS.xp.BOSS : [];
    var REV = [['0 €', 0], ['Moins de 100 €', 0], ['100 à 500 €', 1], ['500 à 1 000 €', 2], ['1 000 à 2 000 €', 3], ['2 000 à 5 000 €', 4], ['Plus de 5 000 €', 5]];
    var BIZ = ['Revente (Vinted…)', 'Vente / e-commerce', 'Fait maison (food, créations)', 'Freelance / services', 'Coaching / cours', 'Contenu / réseaux', 'Autre', 'Pas encore lancé'];
    var SUG = {
      'Revente': ['Publier 2 annonces', 'Répondre aux messages des acheteurs', 'Trouver 3 articles à revendre'],
      'Vente': ['Publier 1 post produit', 'Répondre aux messages clients', 'Améliorer 1 fiche produit'],
      'Fait': ['Annoncer les commandes de la semaine', 'Noter les commandes à livrer', 'Poster 1 photo d\'une création'],
      'Freelance': ['Envoyer 10 messages de prospection', 'Relancer 2 anciens clients', 'Mettre à jour mon portfolio'],
      'Coaching': ['Contacter 3 clients ou élèves potentiels', 'Préparer ma prochaine séance', 'Poster 1 conseil gratuit'],
      'Contenu': ['Publier 1 vidéo', 'Écrire 3 idées de vidéos', 'Répondre aux commentaires'],
      'Autre': ['Avancer 1 h sur mon projet', 'Contacter 3 personnes', 'Noter 1 idée à tester'],
      'Pas': ['Choisir mon idée de business', 'Parler à 3 clients potentiels', 'Lister ce que je sais vendre']
    };
    var sugFor = function (b) { b = String(b || ''); var k = Object.keys(SUG).filter(function (x) { return b.indexOf(x) === 0; })[0]; return SUG[k || 'Autre']; };
    var pushSt = window.LifeOS && window.LifeOS.push ? window.LifeOS.push.state() : 'unsupported';
    var start = A.rev >= 0 ? REV[A.rev][1] : 0, isLaunch = A.rev === 0 || A.biz === 'Pas encore lancé';
    var firstBoss = isLaunch ? ['Le Démarrage', 5, 'launch', 5000] : (BOSS[start] || BOSS[0] || ['Le Gardien des 100 €', 100, 'total', 10000]);
    var bossSub = function (b) { return b[2] === 'launch' ? out('Boss 0 · 5 étapes pour lancer ton business') : b[2] === 'total' ? b[1] + ' € gagnés au total' : b[1].toLocaleString('fr-FR') + ' € en un mois'; };
    var N = 7, set = function (patch) { setA(function (x) { return Object.assign({}, x, patch); }); };
    var next = function () { setStep(function (s0) { return Math.min(N - 1, s0 + 1); }); }, back = function () { setStep(function (s0) { return Math.max(0, s0 - 1); }); };
    function finish() {
      var nm = String(A.name || '').trim().slice(0, 30);
      if (nm && window.LifeOS) window.LifeOS.set({ name: nm });
      store.set('profile', { biz: A.biz, rev: A.rev >= 0 ? REV[A.rev][0] : '', ciHour: A.hour, at: isoDay(new Date()) });
      store.set('bossStart', start);
      if (A.rev === 0 || A.biz === 'Pas encore lancé') store.set('launch', { at: isoDay(new Date()), done: {} });
      var tdy = isoDay(new Date()), M = store.get('state:Main') || {};
      M.prios = A.tasks.slice(0, 3).map(function (t, i) { return { id: Date.now() + i, t: t, tag: 'copyfy', done: false, day: tdy }; });
      if (!M.week) M.week = [{ d: [1, 2, 3, 4, 5, 6, 7], s: ('0' + A.hour).slice(-2) + ':00', e: ('0' + A.hour).slice(-2) + ':15', k: 'revue', l: 'Check-in du soir', c: '✓' }];
      store.set('state:Main', M);
      store.set('onboarded', true);
      p.onDone();
    }
    var btn = { border: 0, borderRadius: 999, minHeight: 56, padding: '0 24px', font: 'inherit', fontSize: 16, fontWeight: 800, cursor: 'pointer' };
    var primary = function (label, on, dis) { return h('button', { type: 'button', className: 'lifeos-press', disabled: !!dis, onClick: on, style: Object.assign({}, btn, { flex: 1, background: C.strong, color: C.strongInk, opacity: dis ? 0.35 : 1 }) }, out(label)); };
    var chip = function (label, on, click, key) { return h('button', { key: key || label, type: 'button', className: 'lifeos-press', 'aria-pressed': on ? 'true' : 'false', onClick: click, style: { border: 0, borderRadius: 16, padding: '14px 16px', minHeight: 52, textAlign: 'left', font: 'inherit', fontSize: 15, fontWeight: 700, cursor: 'pointer', background: on ? C.strong : C.card, color: on ? C.strongInk : C.ink, transition: 'background-color 160ms ease, color 160ms ease' } }, out(label)); };
    var q = function (kicker, title, sub) { return [h('span', { key: 'k', style: { fontSize: 12, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: C.mut } }, out(kicker)), h('h1', { key: 't', style: { margin: 0, fontFamily: "'Urbanist', 'Manrope', system-ui, sans-serif", fontSize: 32, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1.1 } }, out(title)), sub ? h('p', { key: 's', style: { margin: 0, fontSize: 15, fontWeight: 600, color: C.mut, lineHeight: 1.45 } }, out(sub)) : null]; };
    var inp = { boxSizing: 'border-box', width: '100%', border: '1px solid ' + C.line, background: C.card, color: C.ink, borderRadius: 16, padding: '14px 16px', font: 'inherit', fontSize: 17, minHeight: 56 };
    var body, cta;
    if (step === 0) {
      body = [h('div', { key: 'l', 'aria-hidden': 'true', style: { width: 72, height: 72, borderRadius: 22, background: C.strong, color: C.strongInk, display: 'grid', placeItems: 'center', fontFamily: "'Urbanist', sans-serif", fontWeight: 800, fontSize: 36 } }, 'L')]
        .concat(q('LifeOS XP', 'Transforme ton business en jeu.', 'Pour les étudiants qui lancent leur business sans sacrifier leurs études. Gratuit pendant la bêta, sans carte bancaire.'))
        .concat([h('div', { key: 'v', style: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 } }, [['⚔️', 'Bats des Boss en gagnant de l\'argent', 'Même avant ton premier euro : le Boss 0 t\'aide à te lancer, étape par étape.'], ['🎯', 'Ta kill list du jour', '3 actions qui font avancer ton business. Pas plus.'], ['⬆️', '100 niveaux', 'Chaque check-in, chaque euro, chaque tâche te fait monter.']].map(function (v, i) {
          return h('div', { key: i, style: { display: 'flex', gap: 14, alignItems: 'flex-start', padding: 14, borderRadius: 18, background: C.card, animation: 'lifeos-sheet .4s cubic-bezier(.23,1,.32,1) both', animationDelay: (0.06 * i + 0.05) + 's' } }, h('span', { 'aria-hidden': 'true', style: { fontSize: 24 } }, v[0]), h('span', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, h('b', { style: { fontSize: 15, fontWeight: 800 } }, out(v[1])), h('span', { style: { fontSize: 13, fontWeight: 600, color: C.mut } }, out(v[2]))));
        }))]);
      cta = primary('Commencer', next);
    } else if (step === 1) {
      body = q('1 / 5', 'Comment tu t\'appelles ?', 'Juste ton prénom ou un pseudo.').concat([h('input', { key: 'i', type: 'text', value: A.name, autoFocus: true, maxLength: 30, placeholder: out('Ton prénom'), 'aria-label': out('Ton prénom'), onChange: function (e) { set({ name: e.target.value }); }, onKeyDown: function (e) { if (e.key === 'Enter' && A.name.trim()) next(); }, style: inp })]);
      cta = primary('Continuer', next, !A.name.trim());
    } else if (step === 2) {
      body = q('2 / 5', 'Ton business, c\'est quoi ?', 'Tu pourras changer plus tard.').concat([h('div', { key: 'c', style: { display: 'flex', flexDirection: 'column', gap: 8 } }, BIZ.map(function (b) { return chip(b, A.biz === b, function () { set({ biz: b, tasks: [] }); setTimeout(next, 220); }); }))]);
      cta = null;
    } else if (step === 3) {
      body = q('3 / 5', 'Combien tu gagnes par mois en ce moment ?', 'Pour choisir ton premier Boss. Sois honnête, personne ne le voit.').concat([h('div', { key: 'c', style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 } }, REV.map(function (r, i) { return chip(r[0], A.rev === i, function () { set({ rev: i }); }, 'r' + i); })),
        A.rev >= 0 ? h('div', { key: 'b', style: { display: 'flex', alignItems: 'center', gap: 14, padding: 16, borderRadius: 20, background: C.strong, color: C.strongInk, animation: 'lifeos-sheet .3s cubic-bezier(.23,1,.32,1)' } }, h('span', { 'aria-hidden': 'true', style: { width: 52, height: 52, flex: 'none', borderRadius: '50%', background: 'radial-gradient(circle at 32% 28%, #b9bbc0 0 6%, #5d5f65 22%, #26272b 55%, #0d0e10 78%, #3a3b40 100%)' } }), h('span', { style: { display: 'flex', flexDirection: 'column', gap: 2 } }, h('span', { style: { fontSize: 12, fontWeight: 700, opacity: 0.7 } }, out('Ton premier Boss')), h('b', { style: { fontSize: 18, fontWeight: 800 } }, firstBoss[0]), h('span', { style: { fontSize: 12.5, fontWeight: 600, opacity: 0.7 } }, bossSub(firstBoss)))) : null]);
      cta = primary('Continuer', next, A.rev < 0);
    } else if (step === 4) {
      var sug = sugFor(A.biz);
      var add = function (t) { t = String(t || '').trim(); if (!t || A.tasks.length >= 3 || A.tasks.indexOf(t) >= 0) return; set({ tasks: A.tasks.concat([t]), task: '' }); };
      body = q('4 / 5', 'Ta kill list d\'aujourd\'hui', '3 actions max qui font avancer ton business. Touche une idée ou écris la tienne.').concat([
        h('div', { key: 'k', style: { display: 'flex', flexDirection: 'column', gap: 8 } }, A.tasks.map(function (t, i) { return h('div', { key: t, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 16, background: C.strong, color: C.strongInk } }, h('b', { style: { flex: 1, fontSize: 15 } }, t), h('button', { type: 'button', 'aria-label': out('Retirer'), onClick: function () { set({ tasks: A.tasks.filter(function (x, j) { return j !== i; }) }); }, style: { border: 0, background: 'transparent', color: 'inherit', opacity: 0.6, fontSize: 15, cursor: 'pointer', width: 32, height: 32 } }, '✕')); })),
        A.tasks.length < 3 ? h('div', { key: 's', style: { display: 'flex', flexWrap: 'wrap', gap: 8 } }, sug.filter(function (x) { return A.tasks.indexOf(x) < 0; }).map(function (x) { return h('button', { key: x, type: 'button', className: 'lifeos-press', onClick: function () { add(x); }, style: { border: '1px dashed ' + C.line, borderRadius: 999, padding: '10px 14px', background: 'transparent', color: C.ink, font: 'inherit', fontSize: 14, fontWeight: 700, cursor: 'pointer' } }, '+ ' + x); })) : null,
        A.tasks.length < 3 ? h('div', { key: 'i', style: { display: 'flex', gap: 8 } }, h('input', { type: 'text', value: A.task, maxLength: 80, placeholder: out('Ou écris ta tâche…'), 'aria-label': out('Nouvelle tâche'), onChange: function (e) { set({ task: e.target.value }); }, onKeyDown: function (e) { if (e.key === 'Enter') { e.preventDefault(); add(A.task); } }, style: Object.assign({}, inp, { flex: 1, width: 'auto', minWidth: 0 }) }), h('button', { type: 'button', className: 'lifeos-press', 'aria-label': out('Ajouter'), onClick: function () { add(A.task); }, style: { width: 56, height: 56, flex: 'none', border: 0, borderRadius: 16, background: C.strong, color: C.strongInk, fontSize: 24, fontWeight: 800, cursor: 'pointer' } }, '+')) : null]);
      cta = primary(A.tasks.length ? 'Continuer' : 'Plus tard', next);
    } else if (step === 5) {
      body = q('5 / 5', 'Ton check-in du soir, à quelle heure ?', '2 minutes pour faire le point et frapper ton Boss. Tu pourras ajouter un rappel à l\'étape suivante.').concat([h('div', { key: 'h', style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 } }, [18, 19, 20, 21, 22, 23].map(function (x) { return chip(x + ' h', A.hour === x, function () { set({ hour: x }); }, 'h' + x); }))]);
      cta = primary('Continuer', next);
    } else {
      body = q('C\'est prêt', (A.name.trim() || 'Toi') + ', ton jeu commence.', null).concat([
        h('div', { key: 'b', style: { display: 'flex', flexDirection: 'column', gap: 14, padding: 20, borderRadius: 26, background: C.strong, color: C.strongInk } },
          h('span', { style: { fontSize: 12, fontWeight: 800, opacity: 0.7 } }, out('Ton premier Boss')),
          h('b', { style: { fontFamily: "'Urbanist', sans-serif", fontSize: 28, fontWeight: 700 } }, firstBoss[0]),
          h('span', { style: { display: 'block', height: 12, borderRadius: 999, background: 'rgba(127,127,127,.3)', overflow: 'hidden' } }, h('i', { style: { display: 'block', height: '100%', width: '100%', background: C.strongInk, borderRadius: 999 } })),
          h('span', { style: { fontSize: 13, fontWeight: 700, opacity: 0.75 } }, out('Récompense') + ' +' + Number(firstBoss[3]).toLocaleString('fr-FR') + ' XP')),
        h('div', { key: 'rm', style: { display: 'flex', flexDirection: 'column', gap: 10, padding: 16, borderRadius: 20, background: C.card, border: '1px solid ' + C.line } },
          h('b', { style: { fontSize: 15, fontWeight: 800 } }, '⏰ ' + out('Ne rate pas ton check-in de') + ' ' + A.hour + ' h'),
          h('span', { style: { fontSize: 13, fontWeight: 600, color: C.mut, lineHeight: 1.4 } }, out(pushSt === 'off' ? 'La plupart des gens lâchent une appli parce qu\'ils oublient de l\'ouvrir. Active les notifications : un petit message chaque soir à l\'heure de ton check-in.' : 'La plupart des gens lâchent une appli parce qu\'ils oublient de l\'ouvrir. Ajoute un rappel quotidien dans ton agenda, ça prend 10 secondes.')),
          pushSt === 'off' ? h('button', { type: 'button', className: 'lifeos-press', disabled: A.pushBusy, onClick: function () { set({ pushBusy: true, pushErr: '' }); window.LifeOS.push.enable(A.hour).then(function () { set({ pushBusy: false, pushOk: true }); }, function (e) { set({ pushBusy: false, pushErr: (e && e.message) || 'Impossible d\'activer.' }); }); }, style: Object.assign({}, btn, { minHeight: 48, fontSize: 14.5, background: A.pushOk ? C.soft : C.strong, color: A.pushOk ? C.ink : C.strongInk }) }, A.pushOk ? '✓ ' + out('Notifications activées') : A.pushBusy ? out('Activation…') : '🔔 ' + out('Activer les notifications')) : null,
          A.pushErr ? h('span', { style: { fontSize: 12.5, fontWeight: 700, color: '#c0392b', lineHeight: 1.4 } }, A.pushErr) : null,
          (pushSt !== 'off' || A.pushErr) ? h('button', { type: 'button', className: 'lifeos-press', onClick: function () { window.LifeOS.reminder.add(A.hour); set({ rem: true }); }, style: Object.assign({}, btn, { minHeight: 48, fontSize: 14.5, background: A.rem ? C.soft : (pushSt === 'off' ? C.soft : C.strong), color: A.rem || pushSt === 'off' ? C.ink : C.strongInk }) }, A.rem ? '✓ ' + out('Rappel ajouté (touche pour réessayer)') : '📅 ' + out('Ajouter le rappel à mon agenda')) : null,
          pushSt === 'ios-home' ? h('span', { style: { fontSize: 12, fontWeight: 600, color: C.mut, lineHeight: 1.4 } }, out('💡 Pour recevoir de vraies notifications sur iPhone : Partager → « Sur l\'écran d\'accueil », puis ouvre l\'appli depuis l\'icône et active-les dans Paramètres.')) : null),
        h('div', { key: 'r', style: { display: 'flex', flexDirection: 'column', gap: 6, fontSize: 14, fontWeight: 700, color: C.mut } },
          h('span', null, '🎯 ' + (A.tasks.length ? A.tasks.length + ' ' + out('tâche(s) dans ta kill list') : out('Kill list à remplir sur l\'Accueil'))),
          h('span', null, '🎁 ' + out('Gratuit pendant la bêta')),
          h('span', null, '💾 ' + out('Crée ton compte dans Paramètres pour sauvegarder')))]);
      cta = primary('C\'est parti', finish);
    }
    var pct = Math.round(step / (N - 1) * 100);
    return h('div', { style: { minHeight: '100vh', boxSizing: 'border-box', background: C.bg, color: C.ink, fontFamily: "'Manrope', system-ui, sans-serif", display: 'flex', justifyContent: 'center', padding: 'calc(18px + env(safe-area-inset-top)) 18px calc(24px + env(safe-area-inset-bottom))' } },
      h('div', { style: { width: '100%', maxWidth: 480, display: 'flex', flexDirection: 'column', gap: 18, minHeight: 'calc(100vh - 60px)' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          step > 0 ? h('button', { type: 'button', onClick: back, 'aria-label': out('Retour'), className: 'lifeos-press', style: { width: 44, height: 44, flex: 'none', border: 0, borderRadius: '50%', background: C.card, color: C.ink, fontSize: 18, fontWeight: 800, cursor: 'pointer' } }, '←') : null,
          h('div', { role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pct, style: { flex: 1, height: 8, borderRadius: 999, background: C.line, overflow: 'hidden' } }, h('i', { style: { display: 'block', height: '100%', width: pct + '%', background: C.strong, borderRadius: 999, transition: 'width 300ms cubic-bezier(0.23,1,0.32,1)' } }))),
        h('div', { key: 'st' + step, style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 14, animation: 'lifeos-sheet .3s cubic-bezier(.23,1,.32,1)' } }, body),
        cta ? h('div', { style: { display: 'flex', position: 'sticky', bottom: 0, padding: '12px 0', background: 'linear-gradient(to bottom, transparent, ' + C.bg + ' 30%)' } }, cta) : null));
  }

  function App() {
    var sysTheme = function () { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'sombre' : 'clair'; };
    var initialTheme = store.get('theme') || sysTheme();
    var bState = R.useState(0);
    bump = function () { userDirty = true; trCache = {}; bState[1](function (n) { return n + 1; }); };
    var oState = R.useState(needsOnboarding());
    var sState = R.useState(/[?&]ci=1/.test(location.search) && SCREENS.CheckIn ? 'CheckIn' : SCREENS[store.get('screen')] ? store.get('screen') : 'Main');
    var tState = R.useState(initialTheme);
    var screen = sState[0], setScreen = sState[1], theme = tState[0], setTheme = tState[1];

    window.__lifeosSetTheme = function (t) { setTheme(t); store.set('theme', t); document.body.setAttribute('data-theme', t); };
    window.LifeOS.themeMode = function () { return store.get('theme') || 'auto'; };
    window.LifeOS.setTheme = function (mode) {
      if (mode === 'auto') { store.del('theme'); var t = sysTheme(); setTheme(t); document.body.setAttribute('data-theme', t); }
      else window.__lifeosSetTheme(mode);
    };
    R.useEffect(function () { document.body.setAttribute('data-theme', theme); }, [theme]);
    R.useEffect(function () { document.body.setAttribute('data-screen', screen); }, [screen]);
    R.useEffect(function () {
      if (!window.matchMedia) return;
      var mq = window.matchMedia('(prefers-color-scheme: dark)');
      var onSys = function () { if (!store.get('theme')) setTheme(sysTheme()); };
      if (mq.addEventListener) mq.addEventListener('change', onSys);
      return function () { if (mq.removeEventListener) mq.removeEventListener('change', onSys); };
    }, []);
    R.useEffect(function () {
      function onClick(e) {
        var fs = e.target && e.target.closest ? e.target.closest('[data-focus-start]') : null;
        if (fs) Focus.start();
        var logo = e.target && e.target.closest ? e.target.closest('[data-lifeos-logo]') : null;
        if (logo) { e.preventDefault(); animatedReload(); return; }
        var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        if (!a) return;
        var m = (a.getAttribute('href') || '').match(/^([A-Za-z]+)\.dc\.html$/);
        if (!m) return;
        e.preventDefault();
        var n = m[1].replace(/Sombre$/, '');
        if (n === 'Ecran') n = 'Main';
        if (SCREENS[n]) { setScreen(n); store.set('screen', n); window.scrollTo(0, 0); }
      }
      function onKey(e) {
        var el = e.target;
        if (e.key === 'Enter' && !e.shiftKey && el && el.tagName === 'INPUT' && !/^(checkbox|radio|file|range|button|submit)$/i.test(el.type || '')) {
          var dlg = el.closest('[role="dialog"]');
          if (dlg) {
            var save = Array.prototype.filter.call(dlg.querySelectorAll('button'), function (b) { return /^(Enregistrer|Save)$/.test((b.textContent || '').trim()); })[0];
            if (save) { e.preventDefault(); setTimeout(function () { save.click(); }, 0); }
            return;
          }
          var up = el.parentElement;
          for (var lv = 0; lv < 4 && up; lv++, up = up.parentElement) {
            var b = up.querySelector('[data-enter-btn]');
            if (b) { e.preventDefault(); setTimeout(function () { b.click(); }, 0); return; }
          }
          return;
        }
        if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.closest && e.target.closest('[data-lifeos-logo]')) { e.preventDefault(); animatedReload(); }
      }
      document.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
      return function () { document.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); };
    }, []);

    if (oState[0]) return h(Onboarding, { theme: theme, onDone: function () { store.set('screen', 'Main'); setScreen('Main'); oState[1](false); window.scrollTo(0, 0); } });
    return h(R.Fragment, null, h('div', { key: screen, className: 'lifeos-page' }, h(Boundary, { theme: theme }, h(Screen, { name: screen, theme: theme, lang: SETTINGS.lang, rev: bState[0] }))), h(ShareSheet, null), h(FocusPill, { screen: screen, theme: theme }), h(TabBar, { screen: screen, theme: theme }));
  }

  document.body.setAttribute('data-theme', store.get('theme') || 'clair');
  Cloud.init();
  window.LifeOS.cloud = Cloud;
  RD.createRoot(document.getElementById('root')).render(h(App));
  (function () {
    var sp = document.getElementById('lifeos-splash'); if (!sp) return;
    var t0 = window.__lifeosT0 || Date.now();
    setTimeout(function () { sp.style.opacity = '0'; sp.style.transform = 'scale(1.04)'; setTimeout(function () { if (sp.parentNode) sp.parentNode.removeChild(sp); }, 450); }, Math.max(0, 900 - (Date.now() - t0)));
  })();
  setTimeout(rateRefresh, 1500);
})();

/* «Министерство в 5 мирах» — клиент. Роли: игрок (по умолчанию), #host, #screen, #curator. */
(function () {
  'use strict';
  var G = window.GAME;
  var CFG = window.FORSIGHT_CONFIG || {};
  var qs = new URLSearchParams(location.search);
  var API = qs.get('api') || CFG.API_URL || '';
  if (API && API.indexOf('ВСТАВЬТЕ') >= 0) API = '';

  var SCHEMA = 9;
  var PHASES = ['intro', 'lobby', 'signals', 'factors', 'teams', 'world', 'pitch', 'map', 'overlay', 'auction', 'reveal', 'shock', 'results', 'bet', 'final'];
  var PHASE_HINT = {
    intro: 'Что такое форсайт', lobby: 'Собираемся', signals: 'Что меняется вокруг министерства?', factors: 'Какие силы определят будущее?',
    teams: 'Пять штабов цифровизации', world: 'Ваш мир 2030 года', pitch: 'Команды рассказывают о своих мирах', map: 'Отдайте решения замминистрам', overlay: 'Что совпало у команд',
    auction: 'Бюджет ограничен — выбирайте', reveal: 'Какой мир наступит?', shock: 'Кубик решит, сколько будет шоков', results: 'Кто подготовил министерство лучше',
    bet: 'Рискнёте своими баллами?', final: 'Итоговый рейтинг',
  };
  var PHASE_NAME = { intro: 'Заставка', lobby: 'Сбор', signals: 'Сигналы', factors: 'Факторы', teams: 'Команды', world: 'Миры', pitch: 'Рассказ', map: 'Внедрение', overlay: 'Наложение', auction: 'Аукцион', reveal: 'Судьба', shock: 'Шоки', results: 'Итоги', bet: 'Ставка', final: 'Финал' };
  var W = G.worldOrder;
  var B = G.blockOrder;
  var FK = Object.keys(G.factors);
  var PK = Object.keys(G.projects);
  var SPIN_MS = 6500;
  var LETTERS = ['А', 'Б', 'В', 'Г', 'Д'];

  // ---------- хранилище браузера (может быть недоступно) ----------
  var store = {
    get: function (k) { try { return localStorage.getItem('m5:' + k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('m5:' + k, v); } catch (e) { } },
    del: function (k) { try { localStorage.removeItem('m5:' + k); } catch (e) { } },
  };

  var role = 'play';
  function readRole() {
    var h = location.hash.replace('#', '');
    role = ['host', 'screen', 'curator'].indexOf(h) >= 0 ? h : 'play';
    document.body.dataset.role = role;
  }
  readRole();

  var S = null;           // состояние игры с сервера
  var offset = 0;         // серверное время − время устройства
  var pid = store.get('pid');
  var pin = store.get('pin') || '';
  var drafts = {};        // несохранённый текст в полях: key → value
  var saveTimers = {};
  var ui = {
    pending: null, pendBlock: null, busy: false, conn: true, curTeam: Number(store.get('curTeam') || 0), spinDone: null,
    closing: {}, bids: {}, sel: {}, autoClose: true, lotSeconds: 40, toastT: null, sigType: 'trend', rate: null, rateEdit: false, renaming: false,
  };
  var root = document.getElementById('app');
  var swarm = null;

  function now() { return Date.now() + offset; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function plural(n, a, b, c) { n = Math.abs(n) % 100; var n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }
  function signed(n) { return n > 0 ? '+' + n : String(n).replace('-', '−'); }
  function sgnCls(n) { return n > 0 ? 'pos' : n < 0 ? 'neg' : 'zero'; }
  function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function world(id) { return G.worlds[id]; }
  function proj(id) { return G.projects[id]; }
  function block(id) { return G.blocks[id]; }
  function tColor(ti) { return G.teamColors[ti % G.teamColors.length]; }
  function tNo(ti) { return S.teams[ti].no || ti + 1; }
  function tLabel(ti) { return 'Команда ' + tNo(ti); }
  function tName(ti) { var t = S.teams[ti]; return t.title || (t.world ? world(t.world).name : tLabel(ti)); }
  function me() { return S && pid ? S.players[pid] : null; }
  function myTeam() { var p = me(); return p && p.team != null ? S.teams[p.team] : null; }
  function members(ti) { return S.order.filter(function (id) { return S.players[id] && S.players[id].team === ti; }).map(function (id) { return S.players[id]; }); }
  function players() { return S.order.filter(function (id) { return S.players[id]; }).map(function (id) { return S.players[id]; }); }
  function teamStyle(ti) { return '--c:' + tColor(ti); }
  function worldStyle(wid) { var w = world(wid); return '--w:' + w.color + ';--wd:' + w.dark; }
  function teamOfWorld(wid) { for (var i = 0; i < S.teams.length; i++) if (S.teams[i].world === wid) return i; return null; }
  function initials(name) { return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(function (x) { return x.charAt(0).toUpperCase(); }).join(''); }
  // последствия выбора блока приходят с сервера только после отправки плана команды
  function eff(ti, project) { var t = S.teams[ti]; return t && t.effects && t.effects[project] ? t.effects[project] : null; }
  // капитан: назначен или лидирует в голосовании (сервер присылает t.leader)
  function captainId(ti) { var t = S.teams[ti]; return t ? (t.captain || t.leader || null) : null; }
  function isCaptain(t) { return !!(t && pid && captainId(t.id) === pid); }
  function captainName(ti) { var c = captainId(ti); return c && S.players[c] ? S.players[c].name : '—'; }
  function crown(size) { size = size || 16; return '<svg class="crown" width="' + size + '" height="' + Math.round(size * 0.75) + '" viewBox="0 0 18 14" aria-hidden="true"><path d="M1 12L2 3l4 4 3-6 3 6 4-4 1 9z"/></svg>'; }
  function check(color) { return '<svg class="check" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="' + (color || 'currentColor') + '" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>'; }
  function captainBanner(t) {
    if (isCaptain(t)) return '<div class="capbar me">' + crown() + '<span><b>Вы капитан.</b> Вы вводите ответы и делаете ставки за всю команду — советуйтесь с ней.</span></div>';
    return '<div class="capbar">' + crown() + '<span>За команду действует капитан <b>' + esc(captainName(t.id)) + '</b>. Обсуждайте и подсказывайте — экран обновится сам.</span></div>';
  }
  function myPoints() { var pp = S.points && pid && S.points.players[pid]; return pp || null; }
  function chip(ti, size) { return '<span class="tno' + (size ? ' s' + size : '') + '" style="' + teamStyle(ti) + '">' + tNo(ti) + '</span>'; }
  function wdot(wid, size) { return '<span class="wdot' + (size ? ' s' + size : '') + '" style="' + worldStyle(wid) + '">' + wid + '</span>'; }

  // ---------- сеть ----------
  function apiUrl(q) { return API + (API.indexOf('?') >= 0 ? '&' : '?') + q; }

  function api(body) {
    body = Object.assign({}, body);
    if (role === 'play' && pid && !('pid' in body)) body.pid = pid;
    if (role !== 'play' && pin) body.pin = pin;
    // text/plain без заголовков — Apps Script принимает такой запрос без CORS-preflight
    return fetch(API, { method: 'POST', body: JSON.stringify(body), redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.now) offset = d.now - Date.now();
        if (d.state) applyState(d.state);
        if (!d.ok) throw new Error(d.error || 'Ошибка сервера');
        setConn(true);
        return d;
      }, function (e) {
        if (e && e.message && !/fetch|network|Failed|JSON/i.test(e.message)) throw e;
        setConn(false);
        throw new Error('Нет связи с сервером. Повторите через пару секунд.');
      });
  }

  var pollTimer = null;
  function poll() {
    clearTimeout(pollTimer);
    if (!API) return;
    var q = new URLSearchParams({ a: 'state' });
    if (S) q.set('v', S.v);
    if (role === 'play' && pid) q.set('pid', pid);
    if (role !== 'play' && pin) q.set('pin', pin);
    fetch(apiUrl(q.toString()), { redirect: 'follow' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d.now) offset = d.now - Date.now();
        if (d.state) applyState(d.state);
        setConn(true);
        pollTimer = setTimeout(poll, pollDelay());
      })
      .catch(function () {
        setConn(false);
        pollTimer = setTimeout(poll, Math.max(4000, pollDelay() * 1.5));
      });
  }

  // как часто спрашивать сервер: капитаны и ведущий — чаще, остальные игроки — реже (так сервер не перегружается)
  function pollDelay() {
    if (role === 'host') return CFG.POLL_HOST_MS || 2000;
    if (role === 'screen') return CFG.POLL_SCREEN_MS || 2500;
    if (role === 'curator') return 5000;
    var ph = S && S.phase;
    if (ph === 'intro' || ph === 'lobby') return CFG.POLL_IDLE_MS || 5000;
    var t = S && myTeam();
    if (t && isCaptain(t)) return CFG.POLL_PLAYER_MS || 2000;
    if (ph === 'signals' || ph === 'factors' || ph === 'teams' || ph === 'bet') return CFG.POLL_ACTIVE_MS || 3000;
    return CFG.POLL_TEAM_MS || 4000;
  }

  function setConn(ok) {
    if (ui.conn === ok) return;
    ui.conn = ok;
    var b = document.getElementById('conn');
    if (b) b.hidden = ok;
  }

  function applyState(st) {
    if (S && st.v < S.v) return;
    var prevPhase = S && S.phase;
    S = st;
    if (prevPhase && prevPhase !== S.phase) { ui.pending = null; ui.pendBlock = null; window.scrollTo(0, 0); lastHtml = ''; phaseTransition(S.phase); }
    render();
  }

  // переход между этапами: шторка с номером этапа, затем контент плавно проявляется
  function phaseTransition(ph) {
    if (role === 'host' || role === 'curator') return;
    var fx = document.getElementById('phaseFx');
    var i = PHASES.indexOf(ph);
    if (fx) {
      fx.innerHTML = '<div class="fxin"><span class="fxnum">' + String(i + 1).padStart(2, '0') + '</span><span class="fxline"></span><span class="fxname">' + esc(PHASE_NAME[ph]) + '</span><span class="fxhint">' + esc(PHASE_HINT[ph] || '') + '</span></div>';
      fx.classList.remove('run'); void fx.offsetWidth; fx.classList.add('run');
    }
    root.classList.remove('enter'); void root.offsetWidth; root.classList.add('enter');
  }

  function toast(msg, kind, ms) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(ui.toastT);
    ui.toastT = setTimeout(function () { t.className = 'toast'; }, ms || 3200);
  }

  function run(body, okMsg) {
    ui.busy = true; render();
    return api(body).then(function (d) {
      ui.busy = false; render();
      if (okMsg) toast(okMsg, 'ok');
      return d;
    }, function (e) {
      ui.busy = false; render();
      toast(e.message, 'err');
      throw e;
    });
  }

  // ---------- проектор: сцена 1600×900, масштабируется под любой экран ----------
  function fitStage() {
    var k = Math.min(window.innerWidth / 1600, window.innerHeight / 900);
    document.documentElement.style.setProperty('--k', k.toFixed(4));
  }
  window.addEventListener('resize', fitStage);
  fitStage();

  // ---------- отрисовка с сохранением фокуса и черновиков ----------
  var lastHtml = '';
  function render() {
    var html;
    try { html = view(); } catch (e) { console.error(e); html = '<div class="pad"><p>Ошибка отрисовки: ' + esc(e.message) + '</p></div>'; }
    document.body.dataset.phase = S ? S.phase : '';
    if (html === lastHtml) return;
    lastHtml = html;
    var a = document.activeElement;
    var key = a && a.dataset ? a.dataset.key : null;
    var sel = null;
    if (key && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) { try { sel = [a.selectionStart, a.selectionEnd]; } catch (e) { } }
    var sy = window.scrollY;
    var scrollers = {};
    root.querySelectorAll('[data-scroll]').forEach(function (el) { scrollers[el.dataset.scroll] = el.scrollTop; });
    root.innerHTML = html;
    root.querySelectorAll('[data-key]').forEach(function (el) { if (drafts[el.dataset.key] !== undefined) el.value = drafts[el.dataset.key]; });
    if (key) {
      var el = root.querySelector('[data-key="' + key + '"]');
      if (el) { el.focus({ preventScroll: true }); if (sel) { try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { } } }
    }
    root.querySelectorAll('[data-scroll]').forEach(function (el2) { if (scrollers[el2.dataset.scroll]) el2.scrollTop = scrollers[el2.dataset.scroll]; });
    window.scrollTo(0, sy);
    var cv = root.querySelector('canvas.swarm');
    if (cv) {
      if (!swarm) swarm = new window.Swarm(role === 'screen' ? 240 : 120);
      swarm.attach(cv);
      // на проекторе текст слева: кластеры собираются справа, а свободные точки плывут по всему экрану
      if (role === 'screen' && cv.closest('.sintro')) swarm.region(0.44, 1, cv.closest('.is-rules') ? 0 : 0.46);
      else swarm.region(0, 1, 0);
      swarm.setStep(Number(cv.dataset.step || 0));
    }
    tick();
  }

  function view() {
    if (!API) return viewNoApi();
    if (!S) return '<div class="loading"><div class="loader"></div><p>Подключаемся к игре…</p></div>';
    if (role === 'screen') return viewScreen();
    if (role === 'host') return pinOk() ? viewHost() : viewPin('Пульт ведущего');
    if (role === 'curator') return pinOk() ? viewCurator() : viewPin('Оценки кураторов');
    return viewPlayer();
  }

  function pinOk() { return !!(S && S.isHost); }

  function viewNoApi() {
    return '<div class="pad narrow"><h1 class="ph1">Сервер не подключён</h1><p class="plead">Откройте файл <b>config.js</b> и вставьте в <b>API_URL</b> адрес веб-приложения Google Apps Script (заканчивается на <code>/exec</code>). Инструкция — в README репозитория.</p></div>';
  }

  function viewPin(title) {
    return '<div class="pad narrow pinbox"><h1 class="ph1">' + esc(title) + '</h1>' +
      '<form class="stack" data-form="pin"><label class="lbl" for="pin">PIN ведущего</label>' +
      '<input id="pin" class="inp" data-key="pin" inputmode="numeric" autocomplete="off" placeholder="Например, 2040" value="' + esc(pin) + '">' +
      '<button class="btn primary" type="submit">Войти</button></form>' +
      (pin && !pinOk() ? '<p class="muted small">Этот PIN не подошёл. Он задаётся в начале файла Code.gs.</p>' : '') + '</div>';
  }

  // ---------- общие элементы ----------
  function phaseStrip(ph) {
    var idx = PHASES.indexOf(ph);
    return '<div class="pstrip" aria-label="Этап ' + (idx + 1) + ' из ' + PHASES.length + '"><div class="pseg">' + PHASES.map(function (p, i) { return '<i class="' + (i < idx ? 'done' : i === idx ? 'now' : '') + '"></i>'; }).join('') + '</div>' +
      '<div class="pmeta"><span class="pnum">Этап ' + (idx + 1) + ' из ' + PHASES.length + '</span><b>' + PHASE_NAME[ph] + '</b></div></div>';
  }

  // карточка мира: на телефоне — полная, kicker — подпись над названием
  function worldCard(wid, opts) {
    var w = world(wid);
    opts = opts || {};
    return '<article class="wcard" style="' + worldStyle(wid) + '">' +
      '<div class="wband"><span class="wletter">' + wid + '</span><span class="wtitles">' + (opts.kicker ? '<span class="wkick">' + esc(opts.kicker) + '</span>' : '') + '<span class="wname">' + esc(opts.title || w.name) + '</span><span class="waxes">' + esc(opts.sub || w.axes) + '</span></span></div>' +
      (opts.short ? '' : '<div class="wbody"><p class="wstory">' + esc(w.story) + '</p><dl class="wdata">' + w.data.map(function (d) { return '<div><dt>' + esc(d[0]) + '</dt><dd>' + esc(d[1]) + '</dd></div>'; }).join('') + '</dl><p class="wnote">Министерство вымышленное, цифры учебные.</p></div>') +
      '</article>';
  }

  function soldMap() { var m = {}; S.auction.results.forEach(function (r) { m[r.project] = r; }); return m; }

  // что команды выбрали на этапе внедрения: решение → команды и блоки
  function overlayData() {
    var map = {};
    PK.forEach(function (p) { map[p] = { project: p, teams: [], blocks: {} }; });
    S.teams.forEach(function (t) {
      Object.keys(t.placements || {}).forEach(function (p) {
        if (!map[p]) return;
        map[p].teams.push(t.id);
        var b = t.placements[p];
        (map[p].blocks[b] = map[p].blocks[b] || []).push(t.id);
      });
    });
    return map;
  }
  function isCons(p) {
    if (S.consensus) return S.consensus.indexOf(p) >= 0;
    var n = 0; S.teams.forEach(function (t) { if (t.placements && t.placements[p]) n++; });
    return n >= G.consensusMin;
  }
  function consStamp() { return '<span class="stamp"><b>КАНДИДАТ В УСТОЙЧИВЫЕ</b><span>+' + G.consensusBonus + ' во всех мирах</span></span>'; }
  function consBadge() { return '<span class="consb">кандидат в устойчивые, +' + G.consensusBonus + ' во всех мирах</span>'; }

  // таймер-кольцо: size — диаметр, stroke — толщина
  function countdownHtml(lot, size, stroke) {
    var r = (size - stroke) / 2 - 1, c = 2 * Math.PI * r, h = size / 2;
    var left = Math.max(0, Math.ceil((lot.endsAt - now()) / 1000));
    return '<span class="timer" style="--ts:' + size + 'px"><svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true"><circle cx="' + h + '" cy="' + h + '" r="' + r.toFixed(1) + '" class="tr-bg" stroke-width="' + stroke + '"/>' +
      '<circle cx="' + h + '" cy="' + h + '" r="' + r.toFixed(1) + '" class="tr-fg" stroke-width="' + stroke + '" stroke-dasharray="' + c.toFixed(1) + '" data-ring="' + lot.endsAt + '" data-total="' + lot.seconds * 1000 + '" data-len="' + c.toFixed(1) + '" transform="rotate(-90 ' + h + ' ' + h + ')"/></svg>' +
      '<span class="tnum" data-countdown="' + lot.endsAt + '">' + left + '</span></span>';
  }
  function clockHtml(lot) {
    var left = Math.max(0, Math.ceil((lot.endsAt - now()) / 1000));
    return '<span class="clock" data-clock="' + lot.endsAt + '">' + Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0') + '</span>';
  }

  // ---------- колесо судьбы ----------
  function wheelHtml(size) {
    var n = W.length, r = 100;
    var s = '<div class="wheel-wrap" style="width:' + size + 'px;height:' + size + 'px"><svg class="pointer" viewBox="0 0 48 40" aria-hidden="true"><path d="M2,2 L46,2 L24,38 Z"/></svg>' +
      '<svg id="wheel" viewBox="-110 -110 220 220" width="' + size + '" height="' + size + '" aria-label="Колесо судьбы"><circle r="108" class="wrim"/>';
    W.forEach(function (wid, i) {
      var a0 = (i * 360 / n - 90 - 180 / n) * Math.PI / 180, a1 = ((i + 1) * 360 / n - 90 - 180 / n) * Math.PI / 180;
      var x0 = r * Math.cos(a0), y0 = r * Math.sin(a0), x1 = r * Math.cos(a1), y1 = r * Math.sin(a1);
      var am = (i * 360 / n - 90) * Math.PI / 180, tx = 64 * Math.cos(am), ty = 64 * Math.sin(am);
      s += '<path d="M0,0 L' + x0.toFixed(2) + ',' + y0.toFixed(2) + ' A' + r + ',' + r + ' 0 0 1 ' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' Z" fill="' + world(wid).color + '" class="wseg"/>' +
        '<text x="' + tx.toFixed(1) + '" y="' + (ty + 7).toFixed(1) + '" text-anchor="middle" class="wl" data-rx="' + tx.toFixed(1) + '" data-ry="' + ty.toFixed(1) + '">' + wid + '</text>';
    });
    s += '<circle r="16" class="whub"/></svg></div>';
    return s;
  }

  function spinState() {
    if (!S.reveal) return null;
    var elapsed = now() - S.reveal.at;
    return { done: elapsed >= SPIN_MS, elapsed: elapsed };
  }

  function wheelAngle() {
    if (!S.reveal) return 0;
    var i = W.indexOf(S.reveal.world);
    var h = 0; String(S.reveal.spinId || '').split('').forEach(function (ch) { h = (h * 31 + ch.charCodeAt(0)) % 1000; });
    var jitter = (h / 1000 - 0.5) * 40;
    var target = 360 * 7 - i * 72 + jitter;
    var t = Math.min(1, Math.max(0, (now() - S.reveal.at) / SPIN_MS));
    return target * (1 - Math.pow(1 - t, 4));
  }

  // ---------- кубик ----------
  var DICE_MS = 2600;
  function diceHtml(size) {
    var face = function (n, cls) {
      var pips = n === 1 ? '<i class="c"></i>' : '<i class="tl"></i><i class="br"></i>';
      return '<div class="face ' + cls + '">' + pips + '</div>';
    };
    var v = S.dice ? S.dice.value : 1, o = v === 1 ? 2 : 1;
    return '<div class="dicewrap" style="--ds:' + size + 'px"><div class="dice" id="dice">' +
      face(v, 'f1') + face(o, 'f2') + face(v, 'f3') + face(o, 'f4') + face(v, 'f5') + face(o, 'f6') + '</div></div>';
  }
  function diceDone() { return S.dice && now() - S.dice.at >= DICE_MS; }
  function diceAngle() {
    if (!S.dice) return [-20, 30];
    var h = 0; String(S.dice.id || '').split('').forEach(function (ch) { h = (h * 31 + ch.charCodeAt(0)) % 997; });
    var t = Math.min(1, Math.max(0, (now() - S.dice.at) / DICE_MS));
    var e = 1 - Math.pow(1 - t, 3);
    var spinsX = 4 + (h % 3), spinsY = 3 + (h % 2);
    return [360 * spinsX * e, 360 * spinsY * e];
  }

  function shockIcon(kind, size) {
    var p = {
      leak: '<path d="M12 3l7 3v5c0 5-3 8.5-7 10-4-1.5-7-5-7-10V6z"/><path d="M10 9l4 5M14 9l-4 5"/>',
      budget: '<ellipse cx="9" cy="6" rx="6" ry="2.5"/><path d="M3 6v4c0 1.4 2.7 2.5 6 2.5s6-1.1 6-2.5V6"/><path d="M3 10v4c0 1.4 2.7 2.5 6 2.5"/><path d="M18 12v8M15 17l3 3 3-3"/>',
      ai: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/><path d="M10 14l2-5 2 5M10.7 12.5h2.6"/>',
      people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-6 6.5-6s5.9 2.4 6.5 6"/><path d="M16 11h6"/>',
      outage: '<path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18z"/><path d="M3 3l18 18"/>',
    }[kind] || '';
    size = size || 48;
    return '<svg class="shicon" width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
  }

  // ---------- тик: таймеры, колесо, кубик, автозакрытие лота ----------
  function tick() {
    if (!S) return;
    var n = now();
    root.querySelectorAll('[data-countdown]').forEach(function (el) {
      var left = Math.max(0, Math.ceil((Number(el.dataset.countdown) - n) / 1000));
      if (el.textContent !== String(left)) el.textContent = left;
      el.parentNode.classList.toggle('hurry', left <= 5);
    });
    root.querySelectorAll('[data-clock]').forEach(function (el) {
      var left = Math.max(0, Math.ceil((Number(el.dataset.clock) - n) / 1000));
      var txt = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
      if (el.textContent !== txt) el.textContent = txt;
      el.classList.toggle('hurry', left <= 10);
    });
    root.querySelectorAll('[data-ring]').forEach(function (el) {
      var left = Math.max(0, Number(el.dataset.ring) - n), tot = Number(el.dataset.total), len = Number(el.dataset.len);
      el.setAttribute('stroke-dashoffset', (len * (1 - left / tot)).toFixed(1));
    });
    var dc = document.getElementById('dice');
    if (dc && S.dice) { var ang = diceAngle(); dc.style.transform = 'rotateX(' + ang[0].toFixed(1) + 'deg) rotateY(' + ang[1].toFixed(1) + 'deg)'; }
    if (S.dice) { var dk = S.dice.id + (diceDone() ? ':done' : ''); if (ui.diceDone !== dk) { ui.diceDone = dk; if (diceDone()) render(); } }
    var wh = document.getElementById('wheel');
    if (wh && S.reveal) {
      var wa = wheelAngle();
      wh.style.transform = 'rotate(' + wa.toFixed(2) + 'deg)';
      // буквы на секторах остаются вертикальными
      wh.querySelectorAll('text.wl').forEach(function (tx) { tx.setAttribute('transform', 'rotate(' + (-wa).toFixed(2) + ' ' + tx.dataset.rx + ' ' + tx.dataset.ry + ')'); });
    }
    if (S.reveal) {
      var st = spinState();
      var key = S.reveal.spinId + (st.done ? ':done' : '');
      if (ui.spinDone !== key) { ui.spinDone = key; if (st.done) render(); }
    }
    if (role === 'host' && pinOk() && ui.autoClose && S.auction && S.auction.open) {
      S.auction.open.forEach(function (lot) {
        if (n > lot.endsAt + 1600 && !ui.closing[lot.project]) {
          ui.closing[lot.project] = true;
          api({ a: 'closeLot', project: lot.project }).then(function (d) { if (d.result) toast(resultText(d.result), 'ok'); }, function (e) { ui.closing[lot.project] = false; toast(e.message, 'err'); });
        }
      });
    }
  }

  // фон: тот же «рой» сигналов, что и в заставке, но спокойнее
  var bg = null, bgFrame = 0;
  function bgSwarm() {
    if ((role !== 'play' && role !== 'screen') || bg) return;
    var cv = document.createElement('canvas');
    cv.className = 'bgswarm';
    cv.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(cv, document.body.firstChild);
    bg = new window.Swarm(role === 'screen' ? 150 : 70);
    bg.attach(cv);
  }
  function loop(t) {
    tick();
    if (swarm) swarm.frame(t);
    // на заставке проектора фон закрыт своей анимацией — не тратим на него кадры
    if (bg && (bgFrame++ % 2 === 0) && !(role === 'screen' && S && S.phase === 'intro')) bg.frame(t);
    requestAnimationFrame(loop);
  }

  function resultText(r) {
    var p = proj(r.project).name;
    return r.team == null ? '«' + p + '» никто не купил' : '«' + p + '» — ' + tLabel(r.team).toLowerCase() + ' за ' + r.price;
  }

  // ---------- агрегаты ----------
  function factorStats() {
    var sums = {}, n = 0;
    FK.forEach(function (f) { sums[f] = [0, 0]; });
    Object.keys(S.ratings || {}).forEach(function (id) {
      var r = S.ratings[id]; if (!r) return; n++;
      FK.forEach(function (f) { if (r[f]) { sums[f][0] += r[f][0]; sums[f][1] += r[f][1]; } });
    });
    var out = FK.map(function (f) { return { f: f, inf: n ? sums[f][0] / n : 0, unc: n ? sums[f][1] / n : 0 }; });
    out.sort(function (a, b) { return (b.inf + b.unc) - (a.inf + a.unc); });
    return { n: n, list: out };
  }
  function fmt1(v) { return (Math.round(v * 10) / 10).toFixed(1).replace('.', ','); }
  function hash(s) { var h = 0; String(s).split('').forEach(function (ch) { h = (h * 131 + ch.charCodeAt(0)) % 1000003; }); return h; }

  // карта факторов: влияние × неопределённость. big — версия для проектора (крупнее, с облаком оценок)
  function scatter(big) {
    var st = factorStats();
    var Wd = big ? 900 : 760, Hd = big ? 760 : 560, L = big ? 86 : 54, R = big ? 64 : 18, T = big ? 40 : 30, Bm = big ? 80 : 52;
    var x = function (v) { return L + (v - 1) / 4 * (Wd - L - R); };
    var y = function (v) { return T + (1 - (v - 1) / 4) * (Hd - T - Bm); };
    var s = '<svg class="scatter' + (big ? ' big' : '') + '" viewBox="0 0 ' + Wd + ' ' + Hd + '" role="img" aria-label="Карта факторов: влияние и неопределённость">';
    s += '<rect class="q trend" x="' + x(1) + '" y="' + y(5) + '" width="' + (x(3) - x(1)) + '" height="' + (y(3) - y(5)) + '"/>';
    s += '<rect class="q crit" x="' + x(3) + '" y="' + y(5) + '" width="' + (x(5) - x(3)) + '" height="' + (y(3) - y(5)) + '"/>';
    s += '<rect class="q wild" x="' + x(3) + '" y="' + y(3) + '" width="' + (x(5) - x(3)) + '" height="' + (y(1) - y(3)) + '"/>';
    for (var v = 1; v <= 5; v++) {
      var mid = v === 3;
      s += '<line class="gl' + (mid ? ' mid' : '') + '" x1="' + x(v) + '" x2="' + x(v) + '" y1="' + y(1) + '" y2="' + y(5) + '"/><line class="gl' + (mid ? ' mid' : '') + '" x1="' + x(1) + '" x2="' + x(5) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      s += '<text class="tk" x="' + x(v) + '" y="' + (y(1) + 22) + '" text-anchor="middle">' + v + '</text><text class="tk" x="' + (x(1) - 12) + '" y="' + (y(v) + 5) + '" text-anchor="end">' + v + '</text>';
    }
    s += '<line class="axl" x1="' + x(1) + '" x2="' + x(1) + '" y1="' + y(1) + '" y2="' + y(5) + '"/><line class="axl" x1="' + x(1) + '" x2="' + x(5) + '" y1="' + y(1) + '" y2="' + y(1) + '"/>';
    s += '<text class="qt" x="' + (x(1) + 14) + '" y="' + (y(5) + 22) + '">Тренды: учесть во всех сценариях</text>';
    s += '<text class="qt crit" x="' + (x(5) - 14) + '" y="' + (y(5) + 22) + '" text-anchor="end">Критические неопределённости</text>';
    s += '<text class="qt dim" x="' + (x(1) + 14) + '" y="' + (y(1) - 14) + '">Второстепенное</text>';
    s += '<text class="qt wild" x="' + (x(5) - 14) + '" y="' + (y(1) - 14) + '" text-anchor="end">Возможные джокеры: следить</text>';
    s += '<text class="ax" x="' + x(5) + '" y="' + (Hd - 18) + '" text-anchor="end">Неопределённость →</text>';
    s += '<text class="ax" transform="translate(' + (big ? 26 : 16) + ' ' + y(4.2) + ') rotate(-90)" text-anchor="middle">Влияние →</text>';
    var kind = function (p) { return p.inf >= 3 && p.unc >= 3 ? 'crit' : p.inf < 3 && p.unc >= 3 ? 'wild' : 'norm'; };
    if (st.n) {
      // облако отдельных оценок вокруг средних
      if (big) {
        Object.keys(S.ratings || {}).forEach(function (id) {
          var r = S.ratings[id];
          FK.forEach(function (f) {
            if (!r[f]) return;
            var h = hash(id + f), jx = ((h % 100) / 100 - 0.5) * 34, jy = ((Math.floor(h / 100) % 100) / 100 - 0.5) * 34;
            var mean = st.list.filter(function (q) { return q.f === f; })[0];
            s += '<circle class="vote ' + kind(mean) + '" cx="' + (x(r[f][1]) + jx).toFixed(1) + '" cy="' + (y(r[f][0]) + jy).toFixed(1) + '" r="4"/>';
          });
        });
      }
      // подписи раскладываем так, чтобы они не наезжали друг на друга и на подписи четвертей
      var boxes = [
        { x0: x(1), x1: x(1) + 290, y0: y(5) + 4, y1: y(5) + 30 }, { x0: x(5) - 290, x1: x(5), y0: y(5) + 4, y1: y(5) + 30 },
        { x0: x(1), x1: x(1) + 160, y0: y(1) - 34, y1: y(1) - 6 }, { x0: x(5) - 290, x1: x(5), y0: y(1) - 34, y1: y(1) - 6 },
      ];
      var hit = function (b) { return boxes.some(function (o) { return b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0; }); };
      var placedPts = [];
      st.list.forEach(function (p) {
        var cx = x(p.unc), cy = y(p.inf);
        placedPts.forEach(function (q) { if (Math.abs(q[0] - cx) < 8 && Math.abs(q[1] - cy) < 8) { cx += 11; cy -= 11; } });
        placedPts.push([cx, cy]);
        boxes.push({ x0: cx - 12, x1: cx + 12, y0: cy - 12, y1: cy + 12 });
      });
      var fs = big ? 15 : 14;
      st.list.forEach(function (p, idx) {
        var cx = placedPts[idx][0], cy = placedPts[idx][1], k = kind(p), axis = S.axesShown && G.axisFactors.indexOf(p.f) >= 0;
        var label = G.factors[p.f].name;
        var w = label.length * fs * 0.56 + 22, hgt = fs + 13;
        var opts = [[18, 0], [-18, 0], [18, -26], [18, 26], [-18, -26], [-18, 26], [0, -30], [0, 30], [18, -44], [18, 44], [-18, -44], [-18, 44]];
        var pick = null;
        for (var oi = 0; oi < opts.length && !pick; oi++) {
          var dx = opts[oi][0], dy = opts[oi][1];
          var ax0 = dx > 0 ? cx + dx : dx < 0 ? cx + dx - w : cx - w / 2;
          var b = { x0: ax0, x1: ax0 + w, y0: cy + dy - hgt / 2, y1: cy + dy + hgt / 2 };
          if (b.x0 < 4 || b.x1 > Wd - 4 || b.y0 < 4 || b.y1 > Hd - 36) continue;
          if (!hit(b)) pick = { b: b, dx: dx, dy: dy };
        }
        if (!pick) { var fx = cx + 18 + w > Wd ? cx - 18 - w : cx + 18; pick = { b: { x0: fx, x1: fx + w, y0: cy - hgt / 2, y1: cy + hgt / 2 }, dx: 18, dy: 0 }; }
        boxes.push(pick.b);
        var rad = k === 'crit' ? (big ? 11 : 9) : (big ? 8 : 7);
        s += '<g class="pt ' + k + (axis ? ' axis' : '') + '">' +
          (pick.dy ? '<line class="lead" x1="' + cx.toFixed(1) + '" y1="' + cy.toFixed(1) + '" x2="' + ((pick.b.x0 + pick.b.x1) / 2).toFixed(1) + '" y2="' + (cy + pick.dy).toFixed(1) + '"/>' : '') +
          '<circle class="halo" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (rad + 6) + '"/><circle class="dot" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + rad + '"/>' +
          '<rect class="lbg" x="' + pick.b.x0.toFixed(1) + '" y="' + pick.b.y0.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + hgt + '" rx="' + (hgt / 2) + '"/>' +
          '<text x="' + ((pick.b.x0 + pick.b.x1) / 2).toFixed(1) + '" y="' + (cy + pick.dy + fs * 0.36).toFixed(1) + '" text-anchor="middle" style="font-size:' + fs + 'px">' + esc(label) + '</text></g>';
      });
    } else {
      s += '<text class="qt" x="' + (Wd / 2) + '" y="' + (Hd / 2) + '" text-anchor="middle">Ждём первые оценки…</text>';
    }
    return s + '</svg>';
  }

  // =====================================================================
  //                               ИГРОК
  // =====================================================================
  function viewPlayer() {
    var p = me();
    if (!p || ui.renaming) return viewJoin();
    var t = myTeam();
    var head = '<header class="bar"' + (t ? ' style="' + teamStyle(t.id) + '"' : '') + '>' +
      '<span class="logo">' + esc(G.title) + '</span>' +
      '<span class="who"><span class="wn">' + esc(p.name) + '</span>' + (t ? chip(t.id, 26) : '') + '</span></header>';
    var body;
    var ph = S.phase;
    if (ph === 'intro') body = viewIntroPlayer(p);
    else if (ph === 'lobby') body = viewWait(p);
    else if (ph === 'signals') body = viewSignalsPlayer(p);
    else if (ph === 'factors') body = viewFactorsPlayer(p);
    else if (ph === 'teams') body = viewTeamsPlayer(p);
    else if (!t) body = waitBox('Вы пока не в команде', 'Ведущий скоро добавит вас. Экран обновится сам.');
    else if (!t.world) body = waitBox('Раздаём миры…', '');
    else if (ph === 'world') body = viewWorldPlayer(t);
    else if (ph === 'pitch') body = viewPitchPlayer(t);
    else if (ph === 'map') body = viewMapPlayer(t);
    else if (ph === 'overlay') body = viewOverlayPlayer(t);
    else if (ph === 'auction') body = viewAuctionPlayer(t);
    else if (ph === 'reveal') body = viewRevealPlayer(t);
    else if (ph === 'shock') body = viewShockPlayer(t);
    else if (ph === 'bet') body = viewBetPlayer(t);
    else if (ph === 'final') body = viewFinalPlayer(t);
    else body = viewResultsPlayer(t);
    return head + phaseStrip(ph) + '<main class="pmain">' + body + '</main>';
  }

  function orb() { return '<div class="orb" aria-hidden="true"><span></span></div>'; }
  function waitBox(title, text) {
    return '<section class="center wait">' + orb() + '<h1 class="ph1">' + esc(title) + '</h1>' + (text ? '<p class="plead">' + esc(text) + '</p>' : '') + '</section>';
  }

  function viewJoin() {
    return '<section class="join">' +
      '<div class="joinhero"><canvas class="swarm" data-step="0" aria-hidden="true"></canvas><h1 class="jtitle">Министерство в&nbsp;5&nbsp;мирах</h1></div>' +
      '<div class="joinbody"><p class="plead big">Форсайт-сессия о цифровом будущем министерства. Вы не угадываете будущее, а ищете решения, которые сработают в любом из пяти миров.</p>' +
      '<form class="stack joinform" data-form="join"><label class="lbl" for="name">Как вас зовут?</label>' +
      '<input id="name" class="inp big" data-key="name" maxlength="40" autocomplete="name" placeholder="Имя и фамилия">' +
      '<span class="hint">Имя и фамилию увидят ведущие и ваша команда.</span>' +
      '<button class="btn primary big" type="submit"' + (ui.busy ? ' disabled' : '') + '>' + (ui.renaming ? 'Сохранить имя' : 'Войти в игру') + '</button></form></div></section>';
  }

  function viewIntroPlayer(p) {
    var step = S.introStep || 0, sl = G.intro[step];
    if (sl.layout === 'rules') {
      return '<section><h1 class="ph1">' + esc(sl.title) + '</h1><p class="plead">' + esc(sl.text) + '</p><ol class="rulelist phone">' +
        sl.steps.map(function (x, i) { return '<li><span class="rn">' + (i + 1) + '</span><span><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></span></li>'; }).join('') + '</ol></section>';
    }
    return '<section class="center wait">' + orb() + '<h1 class="ph1">Смотрите на экран</h1><p class="plead">Ведущие рассказывают, что такое форсайт. Игра начнётся сама, когда они перейдут к сбору.</p>' +
      '<span class="slidecap">Слайд ' + (step + 1) + ' из ' + G.intro.length + ': ' + esc(sl.title) + '</span></section>';
  }

  function viewWait(p) {
    var n = players().length;
    return '<section class="center wait">' + orb() +
      '<h1 class="ph1">Вы в игре, ' + esc(p.name.split(' ')[0]) + '</h1>' +
      '<p class="plead">Ждём, пока ведущий начнёт. Экран переключится сам.</p>' +
      '<p class="count"><b>' + n + '</b> ' + plural(n, 'участник', 'участника', 'участников') + ' в комнате</p>' +
      '<button class="link" data-act="rename">Изменить имя</button></section>';
  }

  function viewSignalsPlayer(p) {
    var mine = (S.signals || []).filter(function (x) { return x.pid === p.id; });
    var left = 2 - mine.length;
    // в каждой категории — не больше одного сигнала от игрока
    var used = {}; mine.forEach(function (x) { used[x.type] = true; });
    if (used[ui.sigType]) ui.sigType = G.signalOrder.filter(function (k) { return !used[k]; })[0] || ui.sigType;
    var html = '<section class="stack14"><h1 class="ph1">Что меняется вокруг министерства?</h1>' +
      '<p class="plead">' + (mine.length ? 'Пришлите ещё один сигнал.' : 'Пришлите до двух сигналов: что меняется в стране, технологиях и жизни людей?') + ' В каждой категории — только один ваш.</p>';
    if (left > 0) {
      html += '<div class="types" role="radiogroup" aria-label="Тип сигнала">' + G.signalOrder.map(function (k) {
        var ty = G.signalTypes[k], u = used[k], on = ui.sigType === k && !u;
        return '<button class="type' + (on ? ' on' : '') + (u ? ' used' : '') + '" role="radio" aria-checked="' + on + '" data-act="sigType" data-type="' + k + '"' + (u ? ' disabled' : '') + '><b>' + esc(ty.name) + '</b><span>' + (u ? 'Ваш сигнал уже здесь' : esc(ty.hint)) + '</span></button>';
      }).join('') + '</div>' +
        '<form class="stack" data-form="signal"><label class="lbl" for="sig">Ваш ' + esc(G.signalTypes[ui.sigType].name.toLowerCase()) + '</label>' +
        '<input id="sig" class="inp" data-key="sig" maxlength="140" placeholder="Например: ' + esc(G.signalTypes[ui.sigType].example) + '">' +
        '<button class="btn primary" type="submit"' + (ui.busy ? ' disabled' : '') + '>Отправить на общий экран</button></form>';
    } else {
      html += '<div class="notice ok">Оба ваших сигнала на экране. Посмотрите, что прислали другие.</div>';
    }
    if (mine.length) {
      html += '<h2 class="ph2">Ваши сигналы</h2><ul class="siglist">' + mine.map(function (x) {
        return '<li><span class="stype" style="--s:' + G.signalColors[x.type] + '">' + esc(G.signalTypes[x.type].name) + '</span><span class="stext">' + esc(x.text) + '</span><button class="x" data-act="delSignal" data-id="' + x.id + '" aria-label="Удалить сигнал">×</button></li>';
      }).join('') + '</ul>';
    }
    var all = (S.signals || []).length;
    html += '<p class="count bottom"><b>' + all + '</b> ' + plural(all, 'сигнал', 'сигнала', 'сигналов') + ' от группы</p></section>';
    return html;
  }

  function viewFactorsPlayer(p) {
    var saved = S.ratings && S.ratings[p.id];
    if (!ui.rate) ui.rate = saved ? JSON.parse(JSON.stringify(saved)) : {};
    if (saved && !ui.rateEdit) {
      return '<section class="stack14"><h1 class="ph1">Оценки отправлены</h1><p class="plead">Посмотрите на общий экран: какие силы оказались одновременно сильными и непредсказуемыми? Из них строят оси сценариев.</p>' +
        '<div class="scbox">' + scatter(false) + '</div><button class="link" data-act="rateEdit">Изменить мои оценки</button></section>';
    }
    var done = FK.filter(function (f) { return ui.rate[f] && ui.rate[f][0] && ui.rate[f][1]; }).length;
    var html = '<section class="stack12"><h1 class="ph1">Что сильнее всего изменит министерство?</h1>' +
      '<p class="plead small">Оцените каждую силу от 1 до 5: насколько она повлияет на министерство и насколько непредсказуемо сложится.</p>';
    FK.forEach(function (f) {
      var v = ui.rate[f] || [0, 0];
      var full = v[0] && v[1], part = !full && (v[0] || v[1]);
      var row = function (axis, lbl) {
        var o = ''; for (var k = 1; k <= 5; k++) o += '<button class="' + (v[axis] === k ? 'on' : '') + '" data-act="rate" data-f="' + f + '" data-axis="' + axis + '" data-v="' + k + '" aria-label="' + lbl + ' ' + k + '"' + (v[axis] === k ? ' aria-pressed="true"' : '') + '>' + k + '</button>';
        return '<div class="rrow"><span>' + lbl + '</span>' + o + '</div>';
      };
      html += '<div class="fcard' + (full ? ' done' : part ? ' part' : '') + '"><div class="fhead"><b>' + esc(G.factors[f].name) + '</b><span>' + (full ? 'готово' : part ? (v[0] ? 'осталась неопределённость' : 'осталось влияние') : '') + '</span></div><p>' + esc(G.factors[f].text) + '</p>' + row(0, 'Влияние') + row(1, 'Неопределённость') + '</div>';
    });
    html += '<button class="btn primary wide sticky" data-act="sendRates"' + (done < FK.length || ui.busy ? ' disabled' : '') + '>' + (done < FK.length ? 'Оценено ' + done + ' из ' + FK.length : 'Отправить оценки') + '</button></section>';
    return html;
  }

  function viewTeamsPlayer(p) {
    var html = '<section class="stack14">';
    if (S.teamMode === 'host') {
      if (p.team == null) return waitBox('Ведущий распределяет команды', 'Подождите немного — вы увидите свою команду здесь.');
      html += '<h1 class="ph1">Ваша команда</h1>' + teamIntro(p.team);
    } else {
      html += '<h1 class="ph1">' + (p.team == null ? 'Выберите команду' : 'Ваша команда') + '</h1><div class="teampick">';
      S.teams.forEach(function (t) {
        var m = members(t.id), mine = p.team === t.id, full = m.length >= S.teamSize && !mine;
        html += '<button class="tpick' + (mine ? ' mine' : '') + '" style="' + teamStyle(t.id) + '" data-act="pickTeam" data-team="' + t.id + '"' + (full || ui.busy ? ' disabled' : '') + ' aria-label="' + tLabel(t.id) + ', ' + m.length + ' из ' + S.teamSize + '">' +
          '<b>' + tNo(t.id) + '</b><span>' + m.length + '/' + S.teamSize + '</span></button>';
      });
      html += '</div>';
      if (p.team == null) html += '<p class="plead small">В команде до ' + S.teamSize + ' человек. Миры раздадут командам случайно.</p>';
    }
    if (p.team != null) html += captainVote(p.team) + '<p class="hint bottom">Капитан закрепится, когда ведущий раздаст миры.' + (S.teamMode === 'self' ? ' <button class="link inline" data-act="pickTeam" data-team="">Выйти из команды</button>' : '') + '</p>';
    return html + '</section>';
  }

  function captainVote(ti) {
    var t = S.teams[ti], ms = members(ti), myVote = t.votes && t.votes[pid];
    var tally = t.tally || {};
    var html = '<div class="capvote" style="' + teamStyle(ti) + '"><h2 class="ph2">Выберите капитана</h2>' +
      '<p class="hint">Капитан один вводит ответы, отдаёт решения блокам и делает ставки за команду. Голосовать можно за себя.</p><ul class="voters">';
    ms.forEach(function (m) {
      var n = tally[m.id] || 0, lead = t.leader === m.id && n > 0;
      html += '<li class="' + (lead ? 'leader' : '') + '">' + (lead ? crown(18) : '') + '<span class="vname">' + esc(m.name) + (m.id === pid ? ' <span class="you">(вы)</span>' : '') + '</span>' +
        (n ? '<span class="vcount" aria-label="Голосов: ' + n + '">' + n + '</span>' : '') +
        '<button class="btn small' + (myVote === m.id ? ' primary' : ' ghost') + '" data-act="vote" data-pid="' + m.id + '"' + (ui.busy ? ' disabled' : '') + '>' + (myVote === m.id ? 'Ваш голос' : 'Голосовать') + '</button></li>';
    });
    return html + '</ul></div>';
  }

  function teamIntro(ti) {
    var m = members(ti);
    return '<div class="teamintro" style="' + teamStyle(ti) + '">' + chip(ti, 48) + '<div><b>' + tLabel(ti) + '</b><p>' + m.map(function (x) { return esc(x.name); }).join(', ') + '</p></div></div>';
  }

  function field(t, key, label, hint, rows) {
    var e = t.edits && t.edits[key];
    if (!isCaptain(t)) {
      return '<div class="field ro"><p class="lbl">' + label + '</p>' + (hint ? '<p class="hint">' + hint + '</p>' : '') +
        '<div class="rotext">' + (t[key] ? esc(t[key]) : '<span class="muted">Капитан ещё не написал. Подскажите ему!</span>') + '</div></div>';
    }
    var saving = drafts['f:' + key] !== undefined;
    return '<div class="field"><label class="lbl" for="f-' + key + '">' + label + '</label>' + (hint ? '<p class="hint">' + hint + '</p>' : '') +
      (rows === 1 ? '<input id="f-' + key + '" class="inp" data-key="f:' + key + '" data-field="' + key + '" maxlength="60" value="' + esc(t[key]) + '">'
        : '<textarea id="f-' + key + '" class="inp" rows="' + (rows || 3) + '" data-key="f:' + key + '" data-field="' + key + '" maxlength="600">' + esc(t[key]) + '</textarea>') +
      '<p class="meta">' + (saving ? 'Сохраняем…' : e ? 'Сохранено' : 'Команда видит текст на своих телефонах') + '</p></div>';
  }

  var PITCH_Q = [
    ['residents', 'Для жителей'],
    ['business', 'Для сотрудников'],
    ['government', 'Для министра'],
    ['signposts', 'Ранние признаки'],
  ];

  function viewWorldPlayer(t) {
    return '<section class="stack14">' + worldCard(t.world, { kicker: 'Ваш мир в 2030 году' }) +
      '<div><h2 class="ph2">Задание команды</h2><p class="plead small">Представьте, что этот мир наступил. Что он значит для жителей, сотрудников министерства и министра? По каким новостям его можно заметить заранее?</p></div>' + captainBanner(t) +
      field(t, 'title', 'Своё название мира', 'Например, «Министерство за стеной» или «Тихая гавань»', 1) +
      field(t, 'residents', 'Что изменится для жителей', '', 3) +
      field(t, 'business', 'Что изменится для сотрудников министерства', '', 3) +
      field(t, 'government', 'Что изменится для министра', '', 3) +
      field(t, 'signposts', 'Ранние признаки', 'По каким новостям в 2027–2029 годах мы поймём, что движемся именно в этот мир?', 3) +
      '</section>';
  }

  // ---------- рассказ команд о своих мирах ----------
  function pitchTeams() { return S.teams.filter(function (t) { return t.world && members(t.id).length; }).map(function (t) { return t.id; }); }
  function pitchCur() { var ids = pitchTeams(); var c = S.pitchTeam; return ids.indexOf(c) >= 0 ? c : (ids.length ? ids[0] : null); }

  function pitchAnswers(ti) {
    var t = S.teams[ti];
    return '<dl class="pitchans" style="' + worldStyle(t.world) + '">' + PITCH_Q.map(function (q) {
      return '<div><dt>' + q[1] + '</dt><dd>' + (t[q[0]] ? esc(t[q[0]]) : '<span class="muted">—</span>') + '</dd></div>';
    }).join('') + '</dl>';
  }

  function viewPitchPlayer(t) {
    var cur = pitchCur();
    if (cur == null) return waitBox('Скоро начнём', '');
    if (cur === t.id) {
      return '<section class="stack12"><div class="pitchme" style="' + worldStyle(t.world) + '"><span class="mic" aria-hidden="true"></span><div><p>Сейчас ваша очередь</p><h1>Расскажите о своём мире</h1></div></div>' +
        '<ol class="pitchplan"><li><b>Что за мир.</b> Название и суть в одной фразе: доверяют ли жители цифре и есть ли единая платформа.</li><li><b>Последствия.</b> Что изменится для жителей, сотрудников и министра.</li><li><b>Ранние признаки.</b> По каким новостям мы поймём, что движемся в этот мир.</li></ol>' +
        '<p class="hint">Около 1,5 минуты. Ваши ответы уже на экране — это подсказка, не читайте их дословно.</p>' + pitchAnswers(t.id) + '</section>';
    }
    var ct = S.teams[cur];
    return '<section class="stack12">' + worldCard(ct.world, { short: true, kicker: 'Сейчас рассказывает ' + tLabel(cur).toLowerCase(), title: tName(cur), sub: ct.title ? 'мир «' + world(ct.world).name + '»' : world(ct.world).axes }) +
      '<p class="plead small">Слушайте и сравнивайте со своим миром. Что у вас общего? Какое решение пригодилось бы и там, и у вас?</p>' + pitchAnswers(cur) +
      '<p class="hint center bottom">' + (S.pitched && S.pitched.indexOf(t.id) >= 0 ? 'Ваша команда уже выступила.' : 'Ваша команда выступит позже — ведущий скажет, когда.') + '</p></section>';
  }

  // ---------- внедрение: решения → блоки замминистров ----------
  function blockUsed(t, b, except) {
    return Object.keys(t.placements || {}).filter(function (p) { return p !== except && t.placements[p] === b; }).length;
  }
  function effectHtml(r) {
    if (!r) return '';
    return '<p class="effect ' + (r.v < 0 ? 'neg' : 'pos') + '"><b>' + signed(r.v) + '</b> ' + esc(r.text) + '</p>';
  }

  function viewPlacePicker(t) {
    var pr = proj(ui.pending), cur = t.placements[ui.pending];
    var sel = ui.pendBlock || null;
    var html = '<section class="stack10 picker"><h1 class="ph1">Кому из замов отдать решение?</h1>' +
      '<div class="card"><b class="pname">' + esc(pr.name) + '</b><span class="hint">' + esc(pr.text) + '</span></div>' +
      '<div class="minbar"><b>' + esc(G.minister.name) + '</b><span>решения внедряют блоки замов</span></div><div class="btree">';
    B.forEach(function (b) {
      var bl = block(b), cap = bl.depts.length, used = blockUsed(t, b, ui.pending), full = used >= cap, on = sel === b;
      html += '<button class="bpick' + (on ? ' on' : '') + (full ? ' full' : '') + '" data-act="pickBlock" data-block="' + b + '"' + (full ? ' disabled' : '') + '>' +
        '<span class="bt"><b>' + esc(bl.name) + '</b><span>' + esc(bl.short) + '</span></span>' +
        (on ? check('#49D3F5') : full ? '<span class="cap">мест нет</span>' : '<span class="cap">свободно ' + (cap - used) + ' из ' + cap + '</span>') + '</button>';
    });
    html += '</div><button class="btn primary big" data-act="placeBlock"' + (!sel || ui.busy ? ' disabled' : '') + '>' + (sel ? 'Отдать блоку «' + esc(block(sel).name) + '»' : 'Выберите блок') + '</button>' +
      '<button class="link center" data-act="cancelPick">' + (cur ? 'Оставить как было' : 'Отмена') + '</button></section>';
    return html;
  }

  function viewMapPlayer(t) {
    var cap = isCaptain(t);
    if (ui.pending && !t.submitted && cap) return viewPlacePicker(t);
    var placed = Object.keys(t.placements || {});
    var limit = G.mapLimit, full = placed.length >= limit;
    var effSum = placed.reduce(function (a, p) { var r = eff(t.id, p); return a + (r ? r.v : 0); }, 0);
    var html = '<section class="stack14"><h1 class="ph1">Цифровизация в мире «' + esc(tName(t.id)) + '»</h1>' +
      '<p class="plead small">Выберите ' + limit + ' решений, которые нужны министерству в вашем мире, и отдайте каждое одному из замминистров. <b>В блок помещается столько ваших решений, сколько в нём отделов.</b> После отправки плана вы узнаете, удачно ли выбран блок: это плюс или минус к итогу.</p>' +
      captainBanner(t) +
      '<div class="counter"><b>' + placed.length + '</b> из ' + limit + ' решений' + (effSum ? ' · выбор блоков: <b class="' + sgnCls(effSum) + '">' + signed(effSum) + '</b>' : '') + (t.submitted ? ' · план отправлен' : '') + '</div>';
    // план команды по блокам
    html += '<div class="plan">' + B.map(function (b) {
      var bl = block(b), mine = placed.filter(function (p) { return t.placements[p] === b; });
      return '<div class="pblock' + (mine.length ? ' has' : '') + '"><div class="pbh"><b>' + esc(bl.name) + '</b><span>' + mine.length + ' из ' + bl.depts.length + '</span></div>' +
        (mine.length ? '<ul>' + mine.map(function (p) {
          var r = eff(t.id, p);
          return '<li class="' + (r ? (r.v < 0 ? 'neg' : 'pos') : '') + '"><span class="pn">' + esc(proj(p).name) + '</span>' + effectHtml(r) +
            (t.submitted || !cap ? '' : '<span class="acts"><button class="link" data-act="pick" data-project="' + p + '">Другой блок</button><button class="link" data-act="unplace" data-project="' + p + '">Убрать</button></span>') + '</li>';
        }).join('') + '</ul>' : '') + '</div>';
    }).join('') + '</div>';
    if (t.submitted) {
      html += '<div class="notice ok">План отправил(а) ' + esc(t.submittedBy) + '. Ждите следующего этапа.</div>';
    } else {
      html += '<h2 class="ph2">Цифровые решения</h2><ul class="projects">' + PK.map(function (p) {
        var pr = proj(p), on = !!t.placements[p];
        return '<li class="proj' + (on ? ' on' : '') + '"><div><span class="tag">' + esc(block(pr.block).name) + '</span><h3>' + esc(pr.name) + '</h3><p>' + esc(pr.text) + '</p></div>' +
          (on ? '<span class="state">' + check('#6EE3A4') + '</span>' : cap ? '<button class="btn small ghost" data-act="pick" data-project="' + p + '"' + (full || ui.busy ? ' disabled' : '') + '>' + (full ? 'Лимит' : 'Внедрить') + '</button>' : '') + '</li>';
      }).join('') + '</ul>';
      html += field(t, 'rationale', 'Почему именно эти решения?', 'Одно-два предложения: как они помогут министерству в вашем мире', 3);
      if (cap) html += '<button class="btn primary big" data-act="submitMap"' + (placed.length === 0 || ui.busy ? ' disabled' : '') + '>Отправить план команды</button><p class="hint center">После отправки план нельзя менять — договоритесь в команде.</p>';
    }
    return html + '</section>';
  }

  // наложение: что выбрали все команды, по блокам
  function overlayByBlock() {
    var ov = overlayData(), out = {};
    B.forEach(function (b) { out[b] = []; });
    PK.forEach(function (p) {
      Object.keys(ov[p].blocks).forEach(function (b) { out[b].push({ project: p, teams: ov[p].blocks[b], total: ov[p].teams.length }); });
    });
    B.forEach(function (b) { out[b].sort(function (a, c) { return c.total - a.total || c.teams.length - a.teams.length || a.project.localeCompare(c.project); }); });
    return out;
  }

  function viewOverlayPlayer(t) {
    var by = overlayByBlock();
    return '<section class="stack14"><h1 class="ph1">Что внедрили все команды</h1><p class="plead small">Решения, которые выбрали ' + G.consensusMin + ' команды и больше, нужны сразу в нескольких мирах. Это кандидаты в устойчивые: <b>+' + G.consensusBonus + ' к результату во всех мирах</b> тому, кто купит их на аукционе.</p>' +
      B.map(function (b) {
        if (!by[b].length) return '';
        return '<div class="ovblock"><h2>' + esc(block(b).name) + '</h2><ul>' + by[b].map(function (x) {
          return '<li class="' + (isCons(x.project) ? 'robust' : '') + '"><span class="pn">' + esc(proj(x.project).name) + '</span><span class="chips">' + x.teams.map(function (ti) { return chip(ti, 22); }).join('') + '</span>' + (isCons(x.project) ? consBadge() : '') + '</li>';
        }).join('') + '</ul></div>';
      }).join('') + '</section>';
  }

  // ---------- аукцион ----------
  function committed(t, except) {
    return (S.auction.open || []).reduce(function (a, lot) { if (lot.project === except) return a; var b = lot.bids[t.id]; return a + (b && b.amount ? b.amount : 0); }, 0);
  }

  function viewAuctionPlayer(t) {
    var open = S.auction.open || [];
    var sold = S.auction.results;
    var mine = sold.filter(function (r) { return r.team === t.id; });
    var cap = isCaptain(t);
    var free = t.budget - committed(t);
    var html = '<section class="stack12"><div class="budget"><span>Бюджет</span><b>' + t.budget + '</b><span>' + plural(t.budget, 'монета', 'монеты', 'монет') + (open.length ? ', свободно ' + free : '') + '</span></div>' + (cap ? '' : captainBanner(t));
    if (open.length) {
      open.forEach(function (lot, li) {
        var pr = proj(lot.project);
        var isOpen = now() < lot.endsAt + 1500;
        var b = lot.bids[t.id];
        if (ui.bids[lot.project] == null) ui.bids[lot.project] = b && b.amount ? b.amount : 10;
        var v = Math.max(0, Math.min(t.budget, ui.bids[lot.project]));
        var myBlock = t.placements[lot.project], r = myBlock ? eff(t.id, lot.project) : null;
        var expanded = cap && isOpen && (ui.lotOpen && open.some(function (l) { return l.project === ui.lotOpen; }) ? ui.lotOpen === lot.project : (li === 0 || !b));
        if (!expanded) {
          html += '<article class="lot mini"><div><span class="ltag">' + esc(block(pr.block).name) + '</span><b>' + esc(pr.name) + '</b><span class="hint">' + (b ? (b.pass ? 'Команда пасует' : 'Ставка команды: <b>' + b.amount + '</b>') + (cap && isOpen ? '. Можно изменить' : '') : isOpen ? 'Капитан ещё не сделал ставку' : 'Время вышло, подводим итог…') + '</span></div>' + clockHtml(lot) +
            (cap && isOpen ? '<button class="cover" data-act="openLot" data-project="' + lot.project + '" aria-label="Изменить ставку на «' + esc(pr.name) + '»"></button>' : '') + '</article>';
          return;
        }
        html += '<article class="lot"><div class="lothead"><div><span class="ltag">' + esc(block(pr.block).name) + '</span><h2>' + esc(pr.name) + '</h2></div>' + countdownHtml(lot, 60, 5) + '</div>' +
          (isCons(lot.project) ? consBadge() : '') +
          '<p class="hint">' + esc(pr.text) + '</p>' +
          (myBlock ? '<p class="hint">У вас это решение в блоке «' + esc(block(myBlock).name) + '»' + (r ? ': <b class="' + sgnCls(r.v) + '">' + signed(r.v) + '</b>' + (r.v > 0 ? ', профильный блок' : '') : '') + '</p>' : '') +
          '<div class="stepper"><button class="btn round" data-act="bidStep" data-project="' + lot.project + '" data-d="-5" aria-label="Минус 5">−5</button><output class="bidval">' + v + '</output>' +
          '<button class="btn round" data-act="bidStep" data-project="' + lot.project + '" data-d="5" aria-label="Плюс 5">+5</button><button class="btn round" data-act="bidStep" data-project="' + lot.project + '" data-d="25" aria-label="Плюс 25">+25</button></div>' +
          '<div class="bidacts"><button class="btn primary" data-act="bid" data-project="' + lot.project + '"' + (v < 5 || ui.busy ? ' disabled' : '') + '>Поставить ' + v + '</button><button class="btn ghost" data-act="pass" data-project="' + lot.project + '"' + (ui.busy ? ' disabled' : '') + '>Пас</button></div>' +
          (b ? '<p class="meta">' + (b.pass ? 'Сейчас команда пасует.' : 'Ставка команды: <b>' + b.amount + '</b>. Можно изменить до конца времени.') + '</p>' : '') + '</article>';
      });
      html += '<p class="hint bottom">Ставки закрытые. Сумма ставок по всем открытым лотам не может превышать бюджет.</p>';
    } else {
      var last = sold.slice(-3).reverse();
      html += '<div class="notice">' + (last.length ? last.map(resultText).join('<br>') + '<br>' : '') + 'Ждём следующие лоты.</div>';
    }
    html += '<h2 class="ph2">Куплено командой</h2>' + (mine.length ? '<ul class="bought">' + mine.map(function (r) { return '<li><span>' + esc(proj(r.project).name) + '</span><b>' + r.price + '</b></li>'; }).join('') + '</ul>' : '<p class="hint">Пока ничего. Неиспользованные монеты в конце сгорают — как бюджет в конце года.</p>');
    return html + '</section>';
  }

  // ---------- судьба ----------
  function viewRevealPlayer(t) {
    if (!S.reveal) return waitBox('Торги окончены', 'Сейчас ведущий раскрутит колесо судьбы, и мы узнаем, какой мир наступил.');
    var st = spinState();
    var html = '<section class="stack14 center">' + wheelHtml(280);
    if (!st.done) return html + '<h1 class="ph1">Какой мир наступит?</h1></section>';
    html += '</section><section class="stack14">' + worldCard(S.reveal.world, { kicker: '2030 год наступил' + (S.reveal.world === t.world ? ' — это ваш мир!' : '') }) +
      '<p class="hint center">Дальше кубик решит, сколько будет шоков.</p></section>';
    return html;
  }

  // ---------- шоки ----------
  function shockTitle(n) { return n === 1 ? 'Один шок' : 'Два шока'; }
  function viewShockPlayer(t) {
    var html = '<section class="stack12">';
    if (!S.dice) return html + '<div class="center">' + diceHtml(110) + '<h1 class="ph1">Сколько шоков ждёт министерство?</h1><p class="plead">Ведущий бросит кубик: выпадет 1 или 2.</p></div></section>';
    if (!diceDone()) return html + '<div class="center">' + diceHtml(110) + '<h1 class="ph1">Бросаем кубик…</h1></div></section>';
    html += '<h1 class="ph1">' + shockTitle(S.dice.value) + ' в мире «' + esc(world(S.reveal ? S.reveal.world : t.world).name) + '»</h1>';
    for (var i = 0; i < S.dice.value; i++) {
      var k = S.shocks[i];
      if (k) {
        var sh = G.shocks[k];
        html += '<div class="shockrow t-' + sh.tone + '">' + shockIcon(sh.icon, 34) + '<div><b>' + esc(sh.name) + '</b><span>' + esc(sh.text) + '</span></div></div>';
      } else html += '<div class="shockrow back"><span class="q">?</span><b>Шок ' + (i + 1) + ' ещё не вытянут</b></div>';
    }
    if (S.score && S.shocks.length) {
      var sc = S.score.teams[t.id];
      html += '<section class="card stack8"><h2 class="ph3">Что это значит для вашей команды</h2>';
      if (!sc.projects.length) html += '<p class="hint">Команда ничего не купила на аукционе.</p>';
      else {
        html += '<div class="mrow head"><span>Решение</span><span>мир</span><span>шоки</span></div>' + sc.projects.map(function (pp) {
          var base = pp.value - pp.shock;
          return '<div class="mrow"><span>' + esc(proj(pp.project).short) + '</span><b class="' + sgnCls(base) + '">' + signed(base) + '</b><b class="' + sgnCls(pp.shock) + '">' + signed(pp.shock) + '</b></div>';
        }).join('');
      }
      html += '<div class="mtotal"><span>Итого в наступившем мире</span><b>' + signed(sc.actual) + '</b></div></section>';
      html += '<div><h2 class="ph3">Как команда ответит на шок</h2>' + captainBanner(t) + field(t, 'shockAnswer', 'Как вы скорректируете стратегию?', 'Что бы вы купили или не купили, зная про эти события? Был ли среди ваших «ранних признаков» намёк на них?', 4) + '</div>';
    }
    return html + '</section>';
  }

  // ---------- итоги ----------
  function ranking() {
    var pts = S.points.teams.slice().sort(function (a, b) { return a.place - b.place; });
    var withProj = S.score.teams.filter(function (x) { return x.projects.length > 0; });
    var robust = (withProj.length ? withProj : S.score.teams).slice().sort(function (a, b) { return b.min - a.min || b.avg - a.avg; })[0];
    var best = S.score.teams.slice().sort(function (a, b) { return b.actual - a.actual || b.min - a.min; })[0];
    return { arr: pts, robust: robust, best: best };
  }
  function medal(place) { return place === 1 ? 'gold' : place === 2 ? 'silver' : place === 3 ? 'bronze' : ''; }
  function worstWorld(sc) { var i = sc.byWorld.indexOf(sc.min); return i >= 0 ? W[i] : W[0]; }

  function viewResultsPlayer(t) {
    if (!S.score || !S.points) return waitBox('Итоги считаются…', '');
    var tp = S.points.teams[t.id], sc = S.score.teams[t.id], rk = ranking();
    var ww = worstWorld(sc);
    var html = '<section class="stack14"><div class="placecard ' + medal(tp.place) + '"><span class="pl">' + tp.place + '</span><div><span class="small">место из ' + S.teams.length + '</span><b class="pt">' + esc(tName(t.id)) + '</b><span><b class="num">' + tp.points + '</b> ' + plural(tp.points, 'балл', 'балла', 'баллов') + ' за игру</span></div></div>' +
      '<section class="card stack8 formula"><div class="frow"><span>За участие</span><b>50</b></div>' +
      '<div class="frow"><span>Мир ' + S.reveal.world + ' наступил: ' + signed(sc.actual) + ' × 10</span><b class="' + sgnCls(sc.actual) + '">' + signed(10 * sc.actual) + '</b></div>' +
      '<div class="frow"><span>Худший мир ' + ww + ': ' + signed(sc.min) + ' × 10</span><b class="' + sgnCls(sc.min) + '">' + signed(10 * sc.min) + '</b></div>' +
      '<div class="frow total"><span>Итого' + (50 + 10 * sc.actual + 10 * sc.min < 10 ? ' (не меньше 10)' : '') + '</span><b>' + tp.points + '</b></div></section>' +
      (rk.robust.team === t.id ? '<div class="notice ok">У вашей команды самая устойчивая стратегия: лучший результат даже в худшем мире.</div>' : '') +
      '<section class="card stack10"><h2 class="ph3">Ваш результат в каждом мире</h2><div class="wgrid">' + W.map(function (w, i) {
        var v = sc.byWorld[i], cls = w === S.reveal.world ? ' cur' : w === ww ? ' worst' : '';
        return '<div class="wcell' + cls + '"><span>' + w + '</span><b class="' + (cls ? '' : sgnCls(v)) + '">' + signed(v) + '</b></div>';
      }).join('') + '</div><span class="hint">Синяя рамка — наступивший мир (без шоков), красная пунктирная — худший для вашего набора решений.</span></section>' +
      (sc.projects.length ? '<h2 class="ph2">Ваши решения во всех мирах</h2>' + worldsTable(sc.projects) : '') +
      '<p class="hint bottom">Каждый игрок команды получает эти баллы лично. Дальше — финальная ставка: ими можно рискнуть.</p></section>';
    return html;
  }

  function worldsTable(projects) {
    var html = '<div class="tablewrap"><table class="wt"><thead><tr><th>Решение</th>' + W.map(function (w) { return '<th>' + wdot(w, 22) + '</th>'; }).join('') + '</tr></thead><tbody>';
    var sums = W.map(function () { return 0; });
    projects.forEach(function (pp) {
      html += '<tr><td>' + esc(proj(pp.project).short) + (pp.place ? ' <span class="small ' + sgnCls(pp.place) + '">блок ' + signed(pp.place) + '</span>' : '') + (pp.cons ? ' <span class="small pos">поддержка ' + signed(pp.cons) + '</span>' : '') + '</td>' + W.map(function (w, i) { var v = S.payoff[pp.project][i] + pp.place + (pp.cons || 0); sums[i] += v; return '<td class="' + sgnCls(v) + (w === S.reveal.world ? ' cur' : '') + '">' + signed(v) + '</td>'; }).join('') + '</tr>';
    });
    html += '<tr class="sum"><td>Итого</td>' + sums.map(function (v, i) { return '<td class="' + (W[i] === S.reveal.world ? 'cur' : '') + '">' + signed(v) + '</td>'; }).join('') + '</tr></tbody></table></div>';
    return html;
  }

  // ---------- финальная ставка ----------
  function betCounts() {
    var c = [0, 0, 0, 0, 0];
    Object.keys(S.bets || {}).forEach(function (k) { var b = S.bets[k]; if (b && b.option != null) c[b.option]++; });
    return c;
  }

  function betTable(q, ans) {
    return '<div class="tablewrap"><table class="wt"><thead><tr><th>Вариант</th>' + W.map(function (w) { return '<th>' + wdot(w, 22) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      q.options.map(function (o, i) {
        return '<tr class="' + (i === ans.correct ? 'win' : '') + '"><td>' + (i + 1) + '. ' + esc(o[0]) + '</td>' + ans.payoff[i].map(function (v) { return '<td class="' + sgnCls(v) + '">' + signed(v) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function viewBetPlayer(t) {
    var mp = myPoints();
    if (!S.bet || !mp) return waitBox('Скоро финальная ставка', 'Ведущий выбирает вопрос.');
    var q = G.bets[S.bet.qid], mine = S.bets && S.bets[pid], revealed = S.bet.revealed, ans = S.betAnswer;
    var html = '<section class="stack12"><div class="mypts"><span>Ваши баллы</span><b>' + mp.base + '</b></div>' +
      '<h1 class="ph1 sm">' + esc(q.title) + '</h1>';
    if (ui.betOpt == null && mine) ui.betOpt = mine.option;
    html += '<div class="betopts" role="radiogroup" aria-label="Варианты ответа">' + q.options.map(function (o, i) {
      var cls = revealed ? (i === ans.correct ? ' right' : (mine && mine.option === i ? ' wrong' : ' dim')) : (ui.betOpt === i ? ' on' : '');
      var on = !revealed && ui.betOpt === i;
      return '<button class="betopt' + cls + '" role="radio" aria-checked="' + on + '" data-act="betOpt" data-i="' + i + '"' + (revealed ? ' disabled' : '') + '><span><b>' + esc(o[0]) + '</b><small>' + esc(o[1]) + '</small></span>' + (on || (revealed && i === ans.correct) ? check(revealed ? '#6EE3A4' : '#49D3F5') : '') + '</button>';
    }).join('') + '</div>';
    if (!revealed) {
      if (ui.betStake == null) ui.betStake = mine ? mine.stake : Math.min(mp.base, Math.round(mp.base / 2));
      var v = Math.max(0, Math.min(mp.base, ui.betStake));
      html += '<div class="stack6"><label class="lbl" for="stake">Сколько баллов ставите: ' + v + '</label><input id="stake" type="range" class="range" min="0" max="' + mp.base + '" step="1" value="' + v + '" data-act-change="betStake" data-key="betStake">' +
        '<div class="rangehint"><span>угадаете: ' + (mp.base + v) + '</span><span>ошибётесь: ' + (mp.base - v) + '</span></div>' +
        '<div class="row6"><button class="btn small ghost" data-act="betStep" data-d="-10">−10</button><button class="btn small ghost" data-act="betStep" data-d="10">+10</button><button class="btn small ghost" data-act="betAll">Всё</button><button class="btn small ghost" data-act="noBet"' + (ui.busy ? ' disabled' : '') + '>Не рисковать</button></div></div>' +
        '<button class="btn primary big" data-act="placeBet"' + (ui.betOpt == null || v < 1 || ui.busy ? ' disabled' : '') + '>Поставить ' + v + ' ' + plural(v, 'балл', 'балла', 'баллов') + '</button>' +
        '<p class="meta center">' + (mine ? 'Ваша ставка: <b>' + mine.stake + '</b> на «' + esc(q.options[mine.option][0]) + '». Можно изменить, пока ведущий не раскрыл ответ.' : 'Угадали — баллы удваиваются, ошиблись — сгорают.') + '</p>';
    } else {
      html += '<div class="betres ' + (!mine ? '' : mp.delta > 0 ? 'win' : 'lose') + '"><b>' + (!mine ? 'Вы не рисковали' : mp.delta > 0 ? 'Угадали! +' + mp.delta : 'Не угадали: ' + signed(mp.delta)) + '</b><span>Итого у вас: ' + mp.total + ' ' + plural(mp.total, 'балл', 'балла', 'баллов') + '</span></div>' +
        '<p class="plead small">' + esc(q.explain) + '</p>' + betTable(q, ans);
    }
    return html + '</section>';
  }

  function playerBoard(limit) {
    var pl = S.points ? S.points.players : {};
    var arr = Object.keys(pl).map(function (k) { return { pid: k, name: S.players[k] ? S.players[k].name : '?', team: pl[k].team, base: pl[k].base, delta: pl[k].delta, total: pl[k].total }; });
    arr.sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name); });
    return arr.slice(0, limit || arr.length);
  }

  function viewFinalPlayer(t) {
    var mp = myPoints();
    if (!mp) return waitBox('Спасибо за игру!', '');
    var board = playerBoard(), idx = board.map(function (x) { return x.pid; }).indexOf(pid), place = idx + 1;
    var rows = board.slice(0, 3).map(function (x, i) { return [x, i]; });
    if (idx >= 3) rows.push([board[idx], idx]);
    return '<section class="stack14"><div class="placecard final ' + (mp.delta > 0 ? 'win' : mp.delta < 0 ? 'lose' : '') + '"><span class="pl">' + place + '</span><div><span class="small">место из ' + board.length + '</span><b class="big">' + mp.total + ' ' + plural(mp.total, 'балл', 'балла', 'баллов') + '</b><span class="small">за игру ' + mp.base + (mp.delta ? ', ставка ' + (mp.delta > 0 ? 'сыграла ' : 'сгорела ') + signed(mp.delta) : '') + '</span></div></div>' +
      '<section class="card stack8"><h2 class="ph3">Лучшие игроки</h2>' + rows.map(function (r) {
        var x = r[0], i = r[1], mine2 = x.pid === pid;
        return '<div class="lrow' + (mine2 ? ' me' : '') + '"><b class="n ' + medal(i + 1) + '">' + (i + 1) + '</b>' + chip(x.team, 22) + '<span class="nm">' + (mine2 ? 'Вы' : esc(x.name)) + '</span><b>' + x.total + '</b></div>';
      }).join('') + '</section>' +
      '<p class="closing">Спасибо за игру! Форсайт — не про угадывание будущего, а про решения, которые сработают в любом из возможных миров.</p></section>';
  }

  // =====================================================================
  //                         ЭКРАН ПРОЕКТОРА (сцена 1600×900)
  // =====================================================================
  function joinUrl() {
    var u = location.origin + location.pathname;
    if (qs.get('api')) u += '?api=' + encodeURIComponent(qs.get('api'));
    return u;
  }

  function qrSvg(text) {
    try { var q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 0, scalable: true }); } catch (e) { return ''; }
  }

  function stage(cls, body) { return '<div class="stagewrap"><div class="stage ' + cls + '">' + body + '</div></div>'; }
  function brand() { return '<p class="sbrand">' + esc(G.title) + '</p>'; }

  function viewScreen() {
    var ph = S.phase;
    if (ph === 'intro') return screenIntro();
    if (ph === 'lobby') return stage('s-lobby', screenLobby());
    if (ph === 'signals') return stage('s-flow s-signals', screenSignals());
    if (ph === 'factors') return stage('s-factors', screenFactors());
    if (ph === 'teams') return stage('s-flow s-teams', screenTeams());
    if (ph === 'world') return stage('s-matrix', screenMatrix());
    if (ph === 'pitch') return stage('s-pitch', screenPitch());
    if (ph === 'map') return stage('s-org', orgChart('map'));
    if (ph === 'overlay') return stage('s-org', orgChart('overlay'));
    if (ph === 'auction') return stage('s-flow s-auction', screenAuction());
    if (ph === 'reveal') return stage('s-reveal', screenReveal());
    if (ph === 'shock') return stage('s-flow s-shock', screenShock());
    if (ph === 'bet') return stage('s-flow s-bet', screenBet());
    if (ph === 'final') return stage('s-flow s-final', screenFinal());
    return stage('s-flow s-results', screenResults());
  }

  function screenIntro() {
    var step = S.introStep || 0, sl = G.intro[step], body;
    if (sl.layout === 'rules') {
      body = '<div class="rhead"><p class="istep">' + (step + 1) + ' / ' + G.intro.length + '</p><h1>' + esc(sl.title) + '</h1><p class="ilead">' + esc(sl.text) + '</p></div>' +
        '<ol class="rulelist" style="--rows:' + Math.ceil(sl.steps.length / 2) + '">' + sl.steps.map(function (x, i) { return '<li><span class="rn">' + (i + 1) + '</span><span><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></span></li>'; }).join('') + '</ol>';
    } else {
      body = '<div class="ishade"></div><div class="ipanel"><p class="istep">' + (step + 1) + ' / ' + G.intro.length + '</p><h1>' + esc(sl.title) + '</h1><p class="ilead">' + esc(sl.text) + '</p>' +
        '<ul class="ipoints">' + sl.points.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' + (sl.source ? '<p class="isource">' + esc(sl.source) + '</p>' : '') + '</div>';
    }
    return '<div class="sintro' + (sl.layout === 'rules' ? ' is-rules' : '') + '"><canvas class="swarm" data-step="' + (sl.swarm || 0) + '" aria-hidden="true"></canvas>' +
      '<div class="stagewrap"><div class="stage s-intro">' + body + brand() + '</div></div></div>';
  }

  function screenLobby() {
    var ps = players(), last = ps.length ? ps[ps.length - 1].id : null;
    return '<div class="ljoin"><h1>Министерство в&nbsp;5&nbsp;мирах</h1><p class="ilead">Отсканируйте код, введите имя и ждите старта.</p>' +
      '<div class="qr">' + qrSvg(joinUrl()) + '</div><p class="url">' + esc(joinUrl().replace(/^https?:\/\//, '').replace(/\/$/, '')) + '</p></div>' +
      '<div class="lnames"><div class="bigcount"><b>' + ps.length + '</b><span>' + plural(ps.length, 'участник', 'участника', 'участников') + ' в игре</span></div><div class="names">' +
      ps.map(function (p) { return '<span class="nm' + (p.id === last ? ' fresh' : '') + '">' + esc(p.name) + '</span>'; }).join('') + '</div>' +
      '<p class="lnote">Новые участники появляются здесь сразу после входа.</p></div>' + brand();
  }

  function shead(title, sub, right) {
    return '<div class="shead"><div><h1>' + title + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' + (right ? '<div class="sright">' + right + '</div>' : '') + '</div>';
  }

  function screenSignals() {
    var sig = S.signals || [];
    var right = '<span class="bigcount"><b>' + sig.length + '</b><span>' + plural(sig.length, 'сигнал', 'сигнала', 'сигналов') + '</span></span>';
    return shead('Что меняется вокруг министерства?', 'Сигналы будущего от группы. Каждый прислал до двух, по одному в категорию.', right) +
      '<div class="sigcols">' + G.signalOrder.map(function (k) {
        var list = sig.filter(function (x) { return x.type === k; }).slice().reverse();
        // сколько карточек помещается в колонку: оцениваем высоту по длине текста
        var hLeft = 600, shown = [];
        for (var i = 0; i < list.length; i++) {
          var lines = Math.ceil((list[i].text.length + list[i].name.length + 3) / 32);
          var h = 16 + 21 * Math.max(1, lines) + 8;
          if (hLeft - h < 0 && shown.length) break;
          hLeft -= h; shown.push(list[i]);
        }
        return '<section class="sigcol" style="--s:' + G.signalColors[k] + '"><div class="sch"><div><h2>' + esc(G.signalTypes[k].name) + '</h2><p>' + esc(G.signalTypes[k].hint) + '</p></div><span class="scount">' + list.length + '</span></div>' +
          shown.map(function (x, j) { return '<div class="sig' + (j === 0 ? ' fresh' : '') + '">' + esc(x.text) + ' <span>· ' + esc(x.name) + '</span></div>'; }).join('') +
          (list.length > shown.length ? '<p class="more">и ещё ' + (list.length - shown.length) + '</p>' : '') + '</section>';
      }).join('') + '</div>';
  }

  function screenFactors() {
    var st = factorStats(), total = players().length;
    var top = st.list.slice(0, 3);
    return '<div class="facbox">' + scatter(true) + '</div><div class="facside"><h1>Какие силы определят будущее министерства?</h1>' +
      '<p class="ilead s">Крупная точка — среднее по группе, мелкие вокруг — оценки отдельных участников. Чем шире облако, тем сильнее группа разошлась во мнениях.</p>' +
      '<div class="bigcount"><b>' + st.n + '</b><span>из ' + total + ' ' + plural(total, 'участника', 'участников', 'участников') + ' оценили</span></div>' +
      (st.n ? '<section class="panel"><h2>Самые сильные и непредсказуемые</h2><div class="topf"><span></span><span>влияние</span><span>неопределённость</span>' + top.map(function (p) {
        return '<b>' + esc(G.factors[p.f].name) + '</b><span class="mbar"><i style="width:' + Math.round(p.inf / 5 * 100) + '%"></i></span><em>' + fmt1(p.inf) + '</em><span class="mbar c"><i style="width:' + Math.round(p.unc / 5 * 100) + '%"></i></span><em>' + fmt1(p.unc) + '</em>';
      }).join('') + '</div></section>' : '') +
      (S.axesShown ? '<div class="axnote"><b>Оси нашей матрицы:</b> ' + esc(G.axisNote) + '. Совпало с вашим выбором?</div>' : '') + '</div>';
  }

  function screenTeams() {
    var free = players().filter(function (p) { return p.team == null; });
    var taken = players().length - free.length, seats = S.teamSize * S.teams.length;
    var right = '<span class="bigcount"><b>' + taken + '</b><span>из ' + seats + ' мест занято</span></span>';
    return shead('Пять штабов цифровизации', free.length ? 'Без команды: ' + free.map(function (p) { return esc(p.name); }).join(', ') : (S.teamMode === 'self' ? 'Выберите команду на телефоне и проголосуйте за капитана. Корона у лидера голосования.' : 'Проголосуйте на телефоне за капитана команды. Корона у лидера голосования.'), right) +
      '<div class="tcols">' + S.teams.map(function (t) {
        var m = members(t.id), tally = t.tally || {}, voted = 0;
        Object.keys(tally).forEach(function (k) { voted += tally[k]; });
        var lead = t.captain || (t.leader && tally[t.leader] ? t.leader : null);
        var rows = m.slice().sort(function (a, b) { return (b.id === lead) - (a.id === lead); }).map(function (x) {
          var isL = x.id === lead, n = tally[x.id] || 0;
          return '<div class="mem' + (isL ? ' lead' : '') + '"><span class="av">' + esc(initials(x.name)) + '</span><span class="mn">' + (isL ? '<span class="nm">' + crown() + esc(x.name) + '</span><span class="vc">' + n + ' ' + plural(n, 'голос', 'голоса', 'голосов') + '</span>' : '<span class="nm">' + esc(x.name) + '</span>') + '</span>' + (!isL && n ? '<span class="vn">' + n + ' ' + plural(n, 'голос', 'голоса', 'голосов') + '</span>' : '') + '</div>';
        }).join('');
        for (var k = m.length; k < S.teamSize; k++) rows += '<div class="mem slot"><span class="av">+</span><span class="nm">Свободное место</span></div>';
        var pct = m.length ? Math.round(voted / m.length * 100) : 0;
        return '<section class="tcol" style="' + teamStyle(t.id) + '"><div class="th">' + chip(t.id, 52) + '<span><b>' + tLabel(t.id) + '</b><span>' + m.length + ' из ' + S.teamSize + '</span></span></div>' + rows +
          '<div class="vprog"><span>Проголосовали ' + voted + ' из ' + m.length + '</span><span class="bar"><i style="width:' + pct + '%"></i></span></div>' +
          '<div class="wslot">' + (t.world ? '<b style="' + worldStyle(t.world) + '">' + t.world + '</b><span>' + esc(world(t.world).name) + '</span>' : '<b>?</b><span>мир 2030 года</span>') + '</div></section>';
      }).join('') + '</div>';
  }

  function screenMatrix() {
    var ax = G.axes;
    var cell = function (wid, cls) {
      var ti = teamOfWorld(wid), w = world(wid), t = ti == null ? {} : S.teams[ti];
      var filled = ti == null ? 0 : ['title', 'residents', 'business', 'government', 'signposts'].filter(function (k) { return t[k]; }).length;
      return '<div class="mcell ' + cls + '" style="' + worldStyle(wid) + '"><div class="mh"><span class="ml">' + wid + '</span><span class="mn">' + esc(w.name) + '</span>' + (wid === 'E' ? '<span class="mx">центр матрицы: всё идёт как сейчас</span>' : '') + '</div>' +
        '<p>' + esc(w.story) + '</p><div class="mf">' + (ti != null ? chip(ti, 22) + '<span>' + tLabel(ti) + (t.title ? ': «' + esc(cut(t.title, 40)) + '»' : '') + '</span><span class="mfill">ответов ' + filled + ' из 5</span>' : '<span>Команды нет</span>') + '</div></div>';
    };
    return '<div class="mline v"></div><div class="mline h"></div>' +
      '<p class="mlabel">Две неопределённости, которые сильнее всего изменят министерство к 2030 году</p><h1 class="mtitle">Пять миров министерства</h1>' +
      '<span class="axp top">' + esc(ax.y.top) + '</span><span class="axp bottom">' + esc(ax.y.bottom) + '</span><span class="axp left">' + esc(ax.x.left) + '</span><span class="axp right">' + esc(ax.x.right) + '</span>' +
      cell('A', 'tl') + cell('C', 'tr') + cell('B', 'bl') + cell('D', 'br') + cell('E', 'mc');
  }

  function screenPitch() {
    var ids = pitchTeams(), cur = pitchCur();
    if (cur == null) return '<div class="sempty"><h1>Команды готовятся рассказать о своих мирах</h1></div>';
    var t = S.teams[cur], w = world(t.world), ms = members(cur), cap = captainId(cur);
    var blk = function (lbl, v, big) { return '<div class="pblk' + (big ? ' big' : '') + '"><h3>' + lbl + '</h3><p>' + (v ? esc(v) : '<span class="muted">—</span>') + '</p></div>'; };
    return '<aside class="pworld" style="' + worldStyle(t.world) + '"><span class="pletter">' + t.world + '</span><p class="pkick">' + tLabel(cur) + ' рассказывает о мире</p>' +
      '<h1 class="ptitle">' + esc(t.title || w.name) + '</h1>' + (t.title ? '<p class="porig">мир «' + esc(w.name) + '»</p>' : '') +
      '<span class="paxes">' + esc(w.axes) + '</span><p class="pstory">' + esc(w.story) + '</p>' +
      '<ul class="pteam">' + ms.map(function (m) { return '<li' + (m.id === cap ? ' class="leader"' : '') + '>' + (m.id === cap ? crown() : '') + esc(m.name) + '</li>'; }).join('') + '</ul></aside>' +
      '<section class="pbody" style="' + worldStyle(t.world) + '">' + blk('Для жителей', t.residents) + blk('Для сотрудников', t.business) + blk('Для министра', t.government) + blk('Ранние признаки: как мы узнаем, что движемся сюда', t.signposts, true) +
      '<ol class="pqueue">' + ids.map(function (id) {
        var done = S.pitched && S.pitched.indexOf(id) >= 0 && id !== cur;
        return '<li class="' + (id === cur ? 'now' : done ? 'done' : '') + '" style="' + worldStyle(S.teams[id].world) + '"><span class="ql">' + S.teams[id].world + '</span>' + tLabel(id) + '</li>';
      }).join('') + '</ol></section>';
  }

  // оргструктура министерства: mode 'map' — команды внедряют (видно только сколько), 'overlay' — что внедрили
  function orgChart(mode) {
    var X0 = 64, STEP = 299, FW = 276;
    var by = mode === 'overlay' ? overlayByBlock() : null;
    var html = '<p class="olabel">' + esc(G.ministry) + '</p><h1 class="otitle">' + (mode === 'overlay' ? 'Что команды внедрили' : 'Команды внедряют решения') + '</h1>';
    if (mode === 'overlay') html += '<p class="olegend">Пунктирная рамка — блок одного замминистра. Цифра в кружке — номер команды. Решения 3+ команд получают +' + G.consensusBonus + ' во всех мирах.</p>';
    else html += '<div class="oprog">' + S.teams.map(function (t) {
      var n = Object.keys(t.placements || {}).length;
      return '<span class="opi' + (t.submitted ? ' done' : '') + '" style="' + teamStyle(t.id) + '">' + chip(t.id, 24) + '<b>' + (t.submitted ? 'готово' : n + '/' + G.mapLimit) + '</b></span>';
    }).join('') + '</div>';
    // министр и шина
    html += '<div class="minister"><b>' + esc(G.minister.name) + '</b><span>' + esc(G.minister.text) + '</span></div>' +
      '<i class="ln" style="left:799px;top:200px;width:2px;height:26px"></i><i class="ln" style="left:' + (X0 + 138) + 'px;top:225px;width:' + (STEP * 4 + 2) + 'px;height:2px"></i>';
    B.forEach(function (b, i) {
      var L = X0 + STEP * i, bl = block(b), n = bl.depts.length;
      var hasCons = by && by[b].some(function (x) { return isCons(x.project); });
      html += '<div class="bframe' + (hasCons ? ' cons' : '') + '" style="left:' + L + 'px"></div>' +
        '<i class="ln" style="left:' + (L + 137) + 'px;top:226px;width:2px;height:42px"></i>' +
        '<div class="deputy" style="left:' + (L + 16) + 'px"><span>' + esc(bl.deputy) + '</span><b>' + esc(bl.name) + '</b></div>' +
        '<i class="ln" style="left:' + (L + 39) + 'px;top:332px;width:2px;height:' + (40 + 48 * (n - 1) - 3) + 'px"></i>';
      bl.depts.forEach(function (d, j) {
        html += '<i class="ln" style="left:' + (L + 40) + 'px;top:' + (371 + 48 * j) + 'px;width:24px;height:2px"></i><div class="dept" style="left:' + (L + 64) + 'px;top:' + (352 + 48 * j) + 'px">' + esc(d) + '</div>';
      });
      var inner = '';
      if (mode === 'overlay') {
        var items = by[b], shown = [], hLeft = 200;
        for (var k = 0; k < items.length; k++) {
          var h = 19 * Math.ceil(proj(items[k].project).name.length / 29) + 6 + (isCons(items[k].project) ? 40 : 22) + 12;
          if (hLeft - h < 0 && shown.length) break;
          hLeft -= h; shown.push(items[k]);
        }
        inner = shown.map(function (x) {
          var c = isCons(x.project);
          return '<div class="osol' + (c ? ' cons' : '') + '"><div class="on">' + esc(proj(x.project).name) + '</div><div class="oc">' + x.teams.map(function (ti) { return chip(ti, 22); }).join('') + (c ? consStamp() : '') + '</div></div>';
        }).join('') + (items.length > shown.length ? '<p class="omore">и ещё ' + (items.length - shown.length) + '</p>' : '') + (items.length ? '' : '<p class="omore">Сюда никто не отдал решений</p>');
      } else {
        var rows = S.teams.map(function (t) {
          var k2 = Object.keys(t.placements || {}).filter(function (p) { return t.placements[p] === b; }).length;
          return k2 ? '<div class="ocount">' + chip(t.id, 22) + '<span class="pips">' + '<i></i>'.repeat(k2) + '</span><span>' + k2 + ' ' + plural(k2, 'решение', 'решения', 'решений') + '</span></div>' : '';
        }).join('');
        inner = rows || '<p class="omore">Пока пусто</p>';
      }
      html += '<div class="osols" style="left:' + (L + 16) + 'px"><div class="oh">Решения команд в блоке</div>' + inner + '</div>' +
        '<div class="ocap" style="left:' + (L + 16) + 'px">' + n + ' ' + plural(n, 'отдел', 'отдела', 'отделов') + ', до ' + n + ' ' + plural(n, 'решения', 'решений', 'решений') + ' от команды</div>';
    });
    return html + '<p class="onote">Министерство и область вымышленные, цифры в игре учебные.</p>';
  }

  function teamChipsRow(lot, big) {
    return '<div class="bidchips">' + S.teams.map(function (t) { var b = lot.bids[t.id]; return '<span class="ob' + (b ? ' made' : '') + '" style="' + teamStyle(t.id) + '">' + tNo(t.id) + (b ? ' ✓' : '') + '</span>'; }).join('') + '</div>';
  }

  function screenAuction() {
    var open = S.auction.open || [], res = S.auction.results;
    var html = shead('Аукцион решений', open.length ? 'Ставки закрытые: суммы увидите после закрытия лота. Остаток монет сгорает.' : 'У каждой команды ' + G.budget + ' монет. Ставки закрытые, побеждает самая высокая. Неиспользованные монеты в конце сгорают.', open.length ? '<span class="ropen">Открыто лотов: <b>' + open.length + '</b></span>' : '');
    if (open.length) {
      html += '<div class="lotgrid n' + Math.min(open.length, 3) + '">' + open.slice(0, 6).map(function (lot) {
        var pr = proj(lot.project);
        return '<article class="slot"><div class="slh"><div><span class="ltag">' + esc(block(pr.block).name) + '</span><h2>' + esc(pr.name) + '</h2></div>' + countdownHtml(lot, 88, 7) + '</div>' +
          (isCons(lot.project) ? consBadge() : '') + (open.length <= 3 ? '<p>' + esc(pr.text) + '</p>' : '') + teamChipsRow(lot) + '</article>';
      }).join('') + '</div>';
    }
    html += '<div class="abottom"><section class="panel"><h2>' + (res.length ? 'Уже продано' : 'Лоты ещё не продавались') + '</h2>' + (res.length ? '' : '<p class="phint">Здесь появятся проданные решения: кто купил и за сколько.</p>') + res.slice(-6).reverse().map(function (r) {
      return '<div class="srow"><span>' + esc(proj(r.project).name) + '</span>' + (r.team != null ? '<span class="sw">' + chip(r.team, 26) + 'за <b>' + r.price + '</b></span>' : '<span class="none">никто не купил</span>') + '</div>';
    }).join('') + '</section><section class="panel"><h2>Осталось монет</h2>' + S.teams.map(function (t) {
      return '<div class="brow" style="' + teamStyle(t.id) + '">' + chip(t.id, 28) + '<span class="bar"><i style="width:' + Math.max(0, Math.min(100, t.budget / G.budget * 100)) + '%"></i></span><b>' + t.budget + '</b></div>';
    }).join('') + '</section></div>';
    return html;
  }

  function screenReveal() {
    var st = S.reveal ? spinState() : null;
    var html = '<div class="rwheel">' + wheelHtml(600) + '</div><div class="rtext">';
    if (!S.reveal) html += '<p class="rk">Наступает 2030 год</p><h1>Какой мир наступит?</h1><p class="ilead">Сейчас раскрутим колесо судьбы.</p>';
    else if (!st.done) html += '<p class="rk">Колесо крутится…</p><h1>Какой мир наступит?</h1>';
    else {
      var w = world(S.reveal.world), ti = teamOfWorld(S.reveal.world);
      html += '<p class="rk">2030 год наступил. Это мир</p><h1>' + S.reveal.world + '. ' + esc(w.name) + '</h1><span class="raxes" style="' + worldStyle(S.reveal.world) + '">' + esc(w.axes) + '</span>' +
        '<p class="rstory">' + esc(w.story) + '</p><p class="rnote">' + (ti != null ? 'Этот мир описывала ' + tLabel(ti).toLowerCase() + '. ' : '') + 'Дальше кубик решит, сколько будет шоков.</p>';
    }
    return html + '</div>';
  }

  function screenShock() {
    if (!S.dice) return '<div class="sdice">' + diceHtml(180) + '<h1>Сколько шоков ждёт министерство?</h1><p class="ilead">Ведущий бросит кубик: выпадет 1 или 2.</p></div>';
    if (!diceDone()) return '<div class="sdice">' + diceHtml(180) + '<h1>Бросаем кубик…</h1></div>';
    var n = S.dice.value, wname = S.reveal ? world(S.reveal.world).name : '';
    var html = '<div class="shhead">' + diceHtml(96) + '<div><h1>На кубике ' + n + ': ' + (n === 1 ? 'один шок' : 'два шока') + '</h1><p>' + (wname ? 'Мир «' + esc(wname) + '» уже наступил, и тут случилось ещё кое-что. ' : '') + (n === 1 ? 'Шок учитывается в баллах.' : 'Оба шока учитываются в баллах.') + '</p></div></div>';
    html += '<div class="shcards n' + n + '">';
    for (var i = 0; i < n; i++) {
      var k = S.shocks[i];
      if (!k) { html += '<article class="shcard back"><span class="q">?</span><p>Шок ' + (i + 1) + ' ещё не вытянут</p></article>'; continue; }
      var sh = G.shocks[k], m = (S.shockMods && S.shockMods[i]) || { mods: {} }, fresh = i === S.shocks.length - 1 && now() - (S.shockAt || 0) < 1500;
      var mods = Object.keys(m.mods).map(function (p) { return [p, m.mods[p]]; }).sort(function (a, b) { return b[1] - a[1]; });
      if (mods.length > 4) mods = mods.filter(function (x) { return x[1] > 0; }).slice(0, 2).concat(mods.filter(function (x) { return x[1] < 0; }).sort(function (a, b) { return a[1] - b[1]; }).slice(0, 2));
      html += '<article class="shcard t-' + sh.tone + (fresh ? ' fresh' : '') + '"><div class="shh">' + shockIcon(sh.icon, 56) + '<div><span class="shk">Шок ' + (i + 1) + '</span><h2>' + esc(sh.name) + '</h2></div></div><p>' + esc(sh.text) + '</p><div class="mods">' +
        mods.map(function (x) { return '<div class="mod ' + sgnCls(x[1]) + '"><span>' + esc(proj(x[0]).name) + '</span><b>' + signed(x[1]) + '</b></div>'; }).join('') +
        (m.zone ? '<div class="mod neg"><span>Все решения в блоке «' + esc(block(m.zone).name) + '»</span><b>' + signed(m.zoneMod) + '</b></div>' : '') + '</div></article>';
    }
    html += '</div>';
    if (S.score && S.shocks.length) {
      html += '<div class="deltas">' + S.score.teams.map(function (x) {
        var d = x.actual - x.base;
        return '<span class="dpill">' + chip(x.team, 28) + 'шоки: <b class="' + sgnCls(d) + '">' + signed(d) + '</b></span>';
      }).join('') + '</div>';
    }
    return html;
  }

  function screenResults() {
    if (!S.score || !S.points) return '<div class="sempty"><h1>Итоги считаются…</h1></div>';
    var rk = ranking(), top = rk.arr, wid = S.reveal.world, nsh = (S.shocks || []).length;
    var pod = function (tp, h) {
      if (!tp) return '';
      return '<div class="pod ' + medal(tp.place) + '">' + chip(tp.team, tp.place === 1 ? 56 : 48) + '<span class="pn">' + esc(tName(tp.team)) + '</span><b class="pp">' + tp.points + '</b><div class="pblock" style="height:' + h + 'px">' + tp.place + '</div></div>';
    };
    return shead('Итоги: кто подготовил министерство лучше', 'Наступил мир ' + wid + ' «' + esc(world(wid).name) + '»' + (nsh ? ', ' + (nsh === 1 ? 'шок один' : 'шоков два') : '') + '.', '<span class="formula">Баллы = 50 + 10 × <b>наступивший мир</b> + 10 × <b>худший мир</b></span>') +
      '<div class="rgrid"><div class="podium">' + pod(top[1], 220) + pod(top[0], 300) + pod(top[2], 160) + '</div>' +
      '<table class="rtable"><thead><tr><th>Место</th><th>Команда</th><th class="r">Мир ' + wid + '</th><th class="r">Худший мир</th><th class="r">Баллы</th></tr></thead><tbody>' +
      top.map(function (tp) {
        var badges = (rk.robust.team === tp.team ? '<span class="bdg pos">самая устойчивая</span>' : '') + (rk.best.team === tp.team ? '<span class="bdg alt">лучшая в мире ' + wid + '</span>' : '');
        return '<tr class="' + (tp.place === 1 ? 'win' : '') + '"><td class="pl">' + tp.place + '</td><td><span class="tn">' + chip(tp.team, 26) + esc(tName(tp.team)) + badges + '</span></td>' +
          '<td class="r ' + sgnCls(tp.actual) + '">' + signed(tp.actual) + '</td><td class="r ' + sgnCls(tp.min) + '">' + signed(tp.min) + '</td><td class="r pts">' + tp.points + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function screenBet() {
    if (!S.bet) return '<div class="sempty"><h1>Финальная ставка</h1><p class="ilead">Каждый может рискнуть своими баллами: угадал — баллы удваиваются, ошибся — сгорают.</p></div>';
    var q = G.bets[S.bet.qid], ans = S.betAnswer, revealed = S.bet.revealed;
    var total = Object.keys(S.points ? S.points.players : {}).length;
    var nb = S.betCount != null ? S.betCount : Object.keys(S.bets || {}).length;
    var counts = revealed ? betCounts() : null;
    var html = '<div class="bhead"><p>Финальная ставка. Угадали — баллы ×2, ошиблись — сгорают.</p><h1>' + esc(q.title) + '</h1></div>' +
      '<div class="bopts">' + q.options.map(function (o, i) {
        var right = revealed && i === ans.correct, cls = revealed ? (right ? ' right' : ' dim') : '';
        var c = counts ? counts[i] : 0;
        return '<div class="bopt' + cls + '"><span class="bn">' + (i + 1) + (right ? check('#6EE3A4') : '') + '</span><b>' + esc(o[0]) + '</b><small>' + esc(o[1]) + '</small>' +
          (revealed ? '<span class="bc">' + c + ' ' + plural(c, 'ставка', 'ставки', 'ставок') + (right && c ? ', все ×2' : '') + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    if (revealed) {
      var pl = S.points.players, nw = 0, lost = 0;
      Object.keys(pl).forEach(function (k) { var d = pl[k].delta; if (d > 0) nw++; if (d < 0) lost -= d; });
      html += '<section class="panel why"><h2>Почему так</h2><p>' + esc(q.explain) + '</p></section>' +
        '<div class="bstats"><span>Поставили: <b>' + Object.keys(S.bets || {}).length + ' из ' + total + '</b></span><span>Выиграли: <b class="pos">' + nw + ' ' + plural(nw, 'игрок', 'игрока', 'игроков') + '</b></span><span>Сгорело баллов: <b class="neg">' + lost + '</b></span></div>';
    } else {
      html += '<div class="bstats"><span>Поставили: <b>' + nb + ' из ' + total + '</b></span><span>Ровно один вариант даёт плюс во всех пяти мирах.</span></div>';
    }
    return html;
  }

  function screenFinal() {
    if (!S.points) return '<div class="sempty"><h1>Финал</h1></div>';
    var board = playerBoard(10), rk = ranking();
    return '<div class="finhead"><h1>Финальный рейтинг</h1><p>Баллы команды плюс результат личной ставки.</p></div><div class="fgrid"><ol class="fboard">' + board.map(function (x, i) {
      return '<li class="' + medal(i + 1) + '"><span class="n">' + (i + 1) + '</span>' + chip(x.team, 26) + '<span class="nm">' + esc(x.name) + '</span><b>' + x.total + '</b></li>';
    }).join('') + '</ol><aside><section class="panel"><h2>Команды</h2>' + rk.arr.map(function (tp) {
      return '<div class="frow2">' + chip(tp.team, 28) + '<span>' + esc(tName(tp.team)) + '</span><b>' + tp.points + '</b></div>';
    }).join('') + '</section><p class="fclose">Форсайт — не про угадывание будущего, а про решения, которые сработают в любом из возможных миров.</p></aside></div>';
  }

  // =====================================================================
  //                               ВЕДУЩИЙ
  // =====================================================================
  function viewHost() {
    var ph = S.phase, i = PHASES.indexOf(ph);
    var nxt = PHASES[Math.min(PHASES.length - 1, i + 1)];
    var np = players().length;
    var html = '<header class="hbar"><b>Пульт ведущего</b><span>' + np + ' ' + plural(np, 'участник', 'участника', 'участников') + ', ' + S.teams.length + ' команд</span><span class="hlinks"><a href="#screen" target="_blank" rel="noopener">Экран проектора</a><a href="#curator" target="_blank" rel="noopener">Кураторы</a></span></header>';
    if (S.schema !== SCHEMA) html += '<div class="notice bad"><b>Сервер устарел.</b> Сайт уже версии ' + SCHEMA + ', а скрипт в Google Таблице — старый, поэтому часть кнопок не работает. Вставьте новый Code.gs и обязательно сделайте Развернуть → Управление развертываниями → ✏️ → Версия: новая → Развернуть.</div>';
    html += '<nav class="hphases" aria-label="Этапы">' + PHASES.map(function (p, k) {
      return '<button class="hph' + (p === ph ? ' now' : k < i ? ' done' : '') + '" data-act="phase" data-phase="' + p + '"' + (p === ph ? ' aria-current="step"' : '') + '>' + (k + 1) + ' ' + PHASE_NAME[p] + '</button>';
    }).join('') + '<span class="hnav"><button class="btn small ghost" data-act="phase" data-phase="' + PHASES[Math.max(0, i - 1)] + '"' + (i === 0 ? ' disabled' : '') + '>Назад</button><button class="btn small primary" data-act="phase" data-phase="' + nxt + '"' + (i === PHASES.length - 1 ? ' disabled' : '') + '>Дальше: ' + PHASE_NAME[nxt] + '</button></span></nav>';
    html += '<div class="hgrid"><main class="hmain">' + hostPanel(ph) + '</main><aside class="hside">' + hostSide(ph) + '</aside></div>';
    html += '<details class="danger"><summary>Сброс игры</summary><p class="small">Начать заново: все ответы, ставки и оценки будут удалены.</p><button class="btn small ghost" data-act="reset" data-keep="1">Заново, игроков оставить</button> <button class="btn small bad" data-act="reset" data-keep="0">Полный сброс</button></details>';
    return html;
  }

  function progressRow(ti, n, total, label, extra) {
    return '<div class="prow" style="' + teamStyle(ti) + '">' + chip(ti, 26) + '<span class="pname">' + esc(tName(ti)) + '</span><span class="pbar"><i style="width:' + (total ? n / total * 100 : 0) + '%"></i></span><span class="pn">' + label + '</span>' + (extra || '') + '</div>';
  }

  var HOST_TIP = {
    intro: 'Слайды идут на проекторе поверх анимации. Переключайте их здесь — у игроков на телефоне видно, какой сейчас слайд.',
    lobby: 'Покажите проектор с QR-кодом. Когда все зашли — переходите к сигналам.',
    signals: 'Спросите: какие сигналы на самом деле тренды, а какие — слабые сигналы? Что может стать джокером?',
    factors: 'Обсудите правый верхний угол — из него берут оси. Затем покажите оси нашей матрицы.',
    teams: 'Миры раздадутся случайно, а капитаны закрепятся при переходе к этапу «Миры».',
    world: 'Команды описывают последствия и ранние признаки. На проекторе собирается сценарная матрица.',
    pitch: 'После всех выступлений спросите: что общего у миров? Это подводит к поиску устойчивых решений.',
    map: 'Подскажите командам: блок важен. Профильный блок даёт плюс, неподходящий — минус.',
    overlay: 'Спросите: почему разные миры выбрали одни и те же решения? Это и есть устойчивые решения.',
    auction: 'Сначала откройте кандидатов в устойчивые — за них будет самый жаркий торг.',
    reveal: 'Перед вращением спросите, какой мир команды считают самым вероятным.',
    shock: 'После шоков дайте капитанам пару минут написать, как команда ответит на шок.',
    results: 'Обсудите, почему выиграла самая устойчивая стратегия, а не самая смелая.',
    bet: 'Правильный ответ виден только вам — не произносите его вслух до раскрытия.',
    final: 'Выгрузите оценки и результаты в Google Таблицу.',
  };

  function hostSide(ph) {
    var html = '<h2 class="hh">Команды' + (PHASES.indexOf(ph) >= PHASES.indexOf('auction') ? ' и бюджет' : '') + '</h2><div class="hteams">' + S.teams.map(function (t) {
      var cid = captainId(t.id), m = members(t.id).length;
      return '<div class="htr">' + chip(t.id, 24) + '<span>' + (cid && S.players[cid] ? 'Капитан ' + esc(S.players[cid].name) : m + ' ' + plural(m, 'игрок', 'игрока', 'игроков')) + '</span><b>' + (PHASES.indexOf(ph) >= PHASES.indexOf('auction') ? t.budget : m + '/' + S.teamSize) + '</b></div>';
    }).join('') + '</div>' + (HOST_TIP[ph] ? '<div class="htip">' + HOST_TIP[ph] + '</div>' : '');
    var ps = players();
    html += '<h2 class="hh">Игроки · ' + ps.length + '</h2><ul class="plist" data-scroll="plist">' + ps.map(function (p) {
      return '<li><span class="plname">' + esc(p.name) + '</span><select class="inp sm" data-act-change="assign" data-pid="' + p.id + '" aria-label="Команда игрока ' + esc(p.name) + '"><option value="">—</option>' + S.teams.map(function (t) { return '<option value="' + t.id + '"' + (p.team === t.id ? ' selected' : '') + '>' + tNo(t.id) + '</option>'; }).join('') + '</select>' +
        '<button class="x" data-act="kick" data-pid="' + p.id + '" aria-label="Удалить ' + esc(p.name) + '">×</button></li>';
    }).join('') + '</ul>';
    return html;
  }

  function hostPanel(ph) {
    if (ph === 'intro') {
      var step = S.introStep || 0, sl = G.intro[step];
      var items = sl.layout === 'rules' ? sl.steps.map(function (x) { return x[0] + ': ' + x[1]; }) : sl.points;
      return '<h1 class="hh1">Заставка: что такое форсайт</h1>' +
        '<div class="row">' + G.intro.map(function (x, k) { return '<button class="btn small' + (k === step ? ' primary' : ' ghost') + '" data-act="intro" data-step="' + k + '">' + (k + 1) + '. ' + esc(x.title) + '</button>'; }).join('') + '</div>' +
        '<div class="notes"><h3>' + esc(sl.title) + '</h3><p>' + esc(sl.text) + '</p><ul>' + items.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' + (sl.source ? '<p class="small muted">' + esc(sl.source) + '</p>' : '') + '</div>' +
        (step < G.intro.length - 1 ? '<button class="btn primary" data-act="intro" data-step="' + (step + 1) + '">Следующий слайд</button>' : '<button class="btn primary" data-act="phase" data-phase="lobby">К сбору участников</button>');
    }
    if (ph === 'lobby') return '<h1 class="hh1">Сбор участников</h1><p>Покажите на проекторе экран с QR-кодом (ссылка «Экран проектора» вверху). Ссылка для игроков:</p><p class="url">' + esc(joinUrl()) + '</p><div class="qr small">' + qrSvg(joinUrl()) + '</div>';
    if (ph === 'signals') {
      var sig = S.signals || [];
      return '<h1 class="hh1">Сигналы будущего · ' + sig.length + '</h1><p class="muted">Каждый участник присылает до двух сигналов, по одному в категорию. Неуместные можно скрыть с экрана.</p><ul class="hsig">' +
        sig.slice().reverse().map(function (x) { return '<li class="' + (x.hidden ? 'hid' : '') + '"><span class="stype" style="--s:' + G.signalColors[x.type] + '">' + esc(G.signalTypes[x.type].name) + '</span><span class="stext">' + esc(x.text) + ' <span class="muted small">' + esc(x.name) + '</span></span><button class="link" data-act="hideSignal" data-id="' + x.id + '">' + (x.hidden ? 'Показать' : 'Скрыть') + '</button></li>'; }).join('') + '</ul>';
    }
    if (ph === 'factors') {
      var st = factorStats();
      return '<h1 class="hh1">Оценка факторов</h1><p>Оценили: <b>' + st.n + '</b> из ' + players().length + '</p><div class="scbox">' + scatter(false) + '</div>' +
        '<button class="btn' + (S.axesShown ? ' ghost' : ' primary') + '" data-act="showAxes">' + (S.axesShown ? 'Скрыть оси матрицы' : 'Показать оси нашей матрицы') + '</button>' +
        '<p class="muted small">В нашем кейсе оси — «' + esc(G.factors[G.axisFactors[0]].name) + '» и «' + esc(G.factors[G.axisFactors[1]].name) + '».</p>';
    }
    if (ph === 'teams') {
      return '<h1 class="hh1">Команды</h1><div class="seg"><button class="' + (S.teamMode === 'self' ? 'on' : '') + '" data-act="teamMode" data-mode="self">Игроки выбирают сами</button><button class="' + (S.teamMode === 'host' ? 'on' : '') + '" data-act="teamMode" data-mode="host">Распределяю я</button></div>' +
        '<label class="lbl inline">Мест в команде <select class="inp sm" data-act-change="teamSize">' + [3, 4, 5, 6].map(function (n) { return '<option' + (n === S.teamSize ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
        '<div class="row"><button class="btn primary" data-act="autoTeams" data-keep="0">Раздать всех случайно</button><button class="btn ghost" data-act="autoTeams" data-keep="1">Раздать только тех, кто без команды</button></div>' +
        hostCaptains();
    }
    if (ph === 'world') return '<h1 class="hh1">Миры</h1><p class="muted">Миры розданы случайно. Команды описывают последствия и ранние признаки.</p>' +
      S.teams.map(function (t) {
        var n = ['title', 'residents', 'business', 'government', 'signposts'].filter(function (k) { return t[k]; }).length;
        return progressRow(t.id, n, 5, n + '/5', t.world ? wdot(t.world, 22) : '');
      }).join('') + '<button class="btn ghost" data-act="dealWorlds">Перераздать миры заново</button>';
    if (ph === 'map') return '<h1 class="hh1">Внедрение</h1><p class="muted">Команды отдают ' + G.mapLimit + ' решений блокам замминистров. Штрафы за неподходящий блок видны после отправки плана.</p>' + S.teams.map(function (t) {
      var n = Object.keys(t.placements || {}).length;
      var bad = Object.keys(t.placements || {}).filter(function (p) { var r = eff(t.id, p); return r && r.v < 0; }).length;
      return progressRow(t.id, n, G.mapLimit, t.submitted ? 'отправлен' : n + '/' + G.mapLimit, (bad ? '<span class="small neg">штрафов: ' + bad + '</span>' : '') + (t.submitted ? '<button class="link" data-act="unlockMap" data-team="' + t.id + '">Открыть</button>' : ''));
    }).join('');
    if (ph === 'overlay') {
      var by = overlayByBlock();
      return '<h1 class="hh1">Наложение</h1><p class="muted">Решения, которые выбрали ' + G.consensusMin + '+ команды, получают +' + G.consensusBonus + ' во всех мирах.</p>' + B.map(function (b) {
        return '<div class="hblock"><h3>' + esc(block(b).name) + '</h3>' + (by[b].length ? by[b].map(function (x) { return '<div class="hsol' + (isCons(x.project) ? ' cons' : '') + '"><span>' + esc(proj(x.project).name) + '</span><span class="chips">' + x.teams.map(function (ti) { return chip(ti, 22); }).join('') + '</span></div>'; }).join('') : '<p class="small muted">пусто</p>') + '</div>';
      }).join('');
    }
    if (ph === 'pitch') return hostPitch();
    if (ph === 'auction') return hostAuction();
    if (ph === 'reveal') {
      var sp = S.reveal ? spinState() : null;
      return '<h1 class="hh1">Колесо судьбы</h1><div class="row"><button class="btn primary" data-act="spin"' + (ui.busy ? ' disabled' : '') + '>' + (S.reveal ? 'Крутить ещё раз' : 'Крутить колесо') + '</button>' +
        '<label class="lbl inline">или назначить мир <select class="inp sm" data-act-change="spinWorld"><option value="">—</option>' + W.map(function (w) { return '<option value="' + w + '">' + w + ' · ' + esc(world(w).name) + '</option>'; }).join('') + '</select></label></div>' +
        (S.reveal ? '<p>' + (sp.done ? 'Наступил мир <b>' + S.reveal.world + ' · ' + esc(world(S.reveal.world).name) + '</b>' : 'Колесо крутится…') + '</p>' : '') +
        (S.reveal && sp.done && S.score ? hostBoard(false) : '');
    }
    if (ph === 'shock') {
      var drawn = S.shocks || [];
      var html2 = '<h1 class="hh1">Шоки</h1>' + (!S.reveal ? '<p class="notice">Сначала раскрутите колесо на этапе «Судьба».</p>' : '');
      html2 += '<div class="row"><button class="btn primary" data-act="rollDice">' + (S.dice ? 'Перебросить кубик' : 'Бросить кубик') + '</button>' +
        '<label class="lbl inline">или задать <select class="inp sm" data-act-change="diceValue"><option value="">—</option><option value="1">1 шок</option><option value="2">2 шока</option></select></label></div>';
      if (S.dice) {
        html2 += '<p>На кубике: <b>' + S.dice.value + '</b>. Вытянуто шоков: <b>' + drawn.length + ' из ' + S.dice.value + '</b>.</p>';
        if (drawn.length < S.dice.value) {
          html2 += '<button class="btn primary" data-act="drawShock" data-shock="">Вытянуть случайный шок</button><p class="small muted">или выберите конкретный:</p><div class="shocks">' + Object.keys(G.shocks).filter(function (k) { return drawn.indexOf(k) < 0; }).map(function (k) {
            return '<button class="shockbtn" data-act="drawShock" data-shock="' + k + '"><b>' + esc(G.shocks[k].name) + '</b><span>' + esc(G.shocks[k].text) + '</span></button>';
          }).join('') + '</div>';
        }
        html2 += drawn.map(function (k, j) { return '<div class="notice">Шок ' + (j + 1) + ': <b>' + esc(G.shocks[k].name) + '</b></div>'; }).join('');
        html2 += '<button class="link" data-act="clearShocks">Сбросить кубик и шоки</button>';
      }
      if (S.score && drawn.length) html2 += hostBoard(true);
      return html2;
    }
    if (ph === 'bet') {
      var hb = '<h1 class="hh1">Финальная ставка</h1><p class="muted">Выберите вопрос. Каждый игрок ставит свои баллы: угадал — ×2, ошибся — сгорают.</p><div class="shocks">' + Object.keys(G.bets).map(function (k) {
        var q = G.bets[k];
        return '<button class="shockbtn' + (S.bet && S.bet.qid === k ? ' on' : '') + '" data-act="setBet" data-q="' + k + '"><b>' + esc(q.title) + '</b><span>' + q.options.map(function (o) { return o[0]; }).join(' · ') + '</span></button>';
      }).join('') + '</div>';
      if (S.bet) {
        var nb = Object.keys(S.bets || {}).length, npp = S.points ? Object.keys(S.points.players).length : 0;
        var correct = { q1: 1, q2: 3, q3: 2 }[S.bet.qid];
        hb += '<p>Ставок: <b>' + nb + '</b> из ' + npp + '.</p>' + (S.bet.revealed ? '<div class="notice ok">Ответ раскрыт: ' + esc(G.bets[S.bet.qid].options[S.betAnswer.correct][0]) + '</div><button class="btn primary" data-act="phase" data-phase="final">К финальному рейтингу</button>' : '<button class="btn primary" data-act="revealBet">Закрыть приём и раскрыть ответ</button>');
        hb += '<p class="small muted">Правильный ответ: ' + esc(G.bets[S.bet.qid].options[correct][0]) + ' (видно только вам)</p>';
      }
      return hb;
    }
    if (ph === 'final') return '<h1 class="hh1">Финал</h1><p>На экране — рейтинг игроков после ставки.</p><div class="row"><button class="btn primary" data-act="export">Выгрузить в Google Таблицу</button><button class="btn ghost" data-act="csv">Скачать оценки (CSV)</button></div>' + gradeSummary();
    return '<h1 class="hh1">Итоги</h1><p>Сохраните оценки кураторов и результаты команд.</p><div class="row"><button class="btn primary" data-act="export">Выгрузить в Google Таблицу</button><button class="btn ghost" data-act="csv">Скачать оценки (CSV)</button></div>' + gradeSummary() +
      (S.score ? hostBoard(true) : '') +
      '<div class="notes"><h3>Вопросы для рефлексии</h3><ul><li>Почему команда купила именно эти решения?</li><li>Какие решения оказались полезны во всех мирах — и почему?</li><li>Сработали ли ваши «ранние признаки»? Можно ли было предвидеть шок?</li><li>Где форсайт упрощён в игре, а где в реальной цифровизации министерства всё сложнее?</li></ul></div>';
  }

  function hostBoard(withShock) {
    var arr = S.score.teams.slice().sort(function (a, b) { return (withShock ? b.actual - a.actual : b.base - a.base); });
    return '<h2 class="hh">Результаты команд' + (withShock && S.shocks && S.shocks.length ? ' с учётом шоков' : '') + '</h2><div class="hboard">' + arr.map(function (x) {
      var v = withShock ? x.actual : x.base, d = withShock ? x.actual - x.base : 0;
      return '<div class="hbr">' + chip(x.team, 24) + '<span><b>' + esc(tName(x.team)) + '</b><small>' + (x.projects.map(function (p) { return esc(proj(p.project).short); }).join(', ') || 'ничего не купили') + '</small></span>' + (d ? '<em class="' + sgnCls(d) + '">' + signed(d) + '</em>' : '') + '<b class="' + sgnCls(v) + '">' + signed(v) + '</b></div>';
    }).join('') + '</div>';
  }

  function hostPitch() {
    var ids = pitchTeams(), cur = pitchCur();
    var k = ids.indexOf(cur), nxt = k >= 0 && k < ids.length - 1 ? ids[k + 1] : null;
    return '<h1 class="hh1">Рассказ команд</h1><p class="muted">Каждая команда за 1,5–2 минуты рассказывает суть своего мира. На проекторе — мир и ответы выступающей команды.</p>' +
      '<div class="row">' + ids.map(function (id) {
        var done = S.pitched && S.pitched.indexOf(id) >= 0 && id !== cur;
        return '<button class="btn small' + (id === cur ? ' primary' : ' ghost') + '" data-act="pitchTeam" data-team="' + id + '">' + chip(id, 22) + ' ' + esc(tName(id)) + (id === cur ? ' · на экране' : done ? ' · выступила' : '') + '</button>';
      }).join('') + '</div>' +
      (nxt != null ? '<button class="btn primary pnext" data-act="pitchTeam" data-team="' + nxt + '">Следующая: ' + tLabel(nxt) + '</button>' : '<p class="notice ok">Это последняя команда. Дальше — внедрение решений.</p>');
  }

  function hostCaptains() {
    return '<h2 class="hh">Капитаны</h2><table class="mini"><tbody>' + S.teams.map(function (t) {
      var ms = members(t.id), tally = t.tally || {};
      return '<tr><td>' + chip(t.id, 24) + '</td><td><select class="inp sm" data-act-change="setCaptain" data-team="' + t.id + '" aria-label="Капитан команды ' + tNo(t.id) + '">' +
        '<option value="">По голосованию' + (t.leader && S.players[t.leader] ? ' — ' + esc(S.players[t.leader].name) : '') + '</option>' +
        ms.map(function (m) { return '<option value="' + m.id + '"' + (t.captain === m.id ? ' selected' : '') + '>' + esc(m.name) + (tally[m.id] ? ' (' + tally[m.id] + ')' : '') + '</option>'; }).join('') +
        '</select></td><td class="small muted">голосов: ' + Object.keys(t.votes || {}).length + ' из ' + ms.length + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  function hostAuction() {
    var open = S.auction.open || [], sold = soldMap();
    var openMap = {}; open.forEach(function (l) { openMap[l.project] = l; });
    var ov = overlayData();
    var html = '<h1 class="hh1">Аукцион</h1>';
    if (open.length) {
      html += '<div class="hlots">' + open.map(function (lot) {
        var left = lot.endsAt - now();
        return '<section class="hlot' + (left < 10000 ? ' hurry' : '') + '"><div class="hlh"><b>' + esc(proj(lot.project).short) + '</b>' + clockHtml(lot) + '</div>' +
          '<p class="small">' + S.teams.map(function (t) { var b = lot.bids[t.id]; return tNo(t.id) + ': ' + (b ? (b.amount === 0 ? 'пас' : '<b>' + b.amount + '</b>') : '—'); }).join(', ') + '</p>' +
          '<div class="row6"><button class="btn small primary" data-act="closeLot" data-project="' + lot.project + '">Закрыть</button><button class="btn small ghost" data-act="cancelLot" data-project="' + lot.project + '">Отменить</button></div></section>';
      }).join('') + '</div>';
      if (open.length > 1) html += '<button class="btn small ghost" data-act="closeAll">Закрыть все открытые лоты</button>';
    }
    var nSel = Object.keys(ui.sel).filter(function (k) { return ui.sel[k] && !sold[k] && !openMap[k]; }).length;
    html += '<div class="row hctl"><label class="lbl inline">Время на лот <select class="inp sm" data-act-change="lotSeconds">' + [20, 30, 40, 60, 90, 120].map(function (n) { return '<option value="' + n + '"' + (n === ui.lotSeconds ? ' selected' : '') + '>' + n + ' с</option>'; }).join('') + '</select></label>' +
      '<label class="lbl inline chk"><input type="checkbox" data-act-change="autoClose"' + (ui.autoClose ? ' checked' : '') + '> закрывать автоматически</label>' +
      '<button class="btn small primary push" data-act="startLots"' + (nSel ? '' : ' disabled') + '>Открыть выбранные лоты (' + nSel + ')</button></div>';
    var order = PK.slice().sort(function (a, b) { return (isCons(b) - isCons(a)) || (ov[b].teams.length - ov[a].teams.length) || a.localeCompare(b); });
    html += '<ul class="lots">' + order.map(function (p) {
      var r = sold[p], live = openMap[p], n = ov[p].teams.length;
      return '<li class="' + (r ? 'sold' : '') + (live ? ' live' : '') + (isCons(p) ? ' cons' : '') + '">' +
        (r || live ? '<span></span>' : '<input type="checkbox" data-act-change="selLot" data-project="' + p + '"' + (ui.sel[p] ? ' checked' : '') + ' aria-label="Выбрать лот ' + esc(proj(p).name) + '">') +
        '<span class="ln">' + esc(proj(p).name) + '</span>' +
        (r ? '<span class="lb">' + (r.team == null ? 'не продан' : 'продано') + '</span><span class="lt">' + (r.team == null ? '' : 'команде ' + tNo(r.team) + ' за ' + r.price) + '</span>' :
          live ? '<span class="lb">идёт</span><span class="lt"></span>' :
            '<span class="lb">' + esc(block(proj(p).block).name.split(' ')[0]) + '</span><span class="lt">' + (n ? n + ' ' + plural(n, 'команда', 'команды', 'команд') : '—') + '</span>') + '</li>';
    }).join('') + '</ul>' + (S.auction.results.length ? '<button class="link" data-act="undoLot">Отменить результат последнего лота</button>' : '');
    return html;
  }

  function gradeTotal(g) { return G.criteria.reduce(function (a, c) { return a + (Number(g && g[c.key]) || 0); }, 0); }

  function gradeSummary() {
    var ps = players();
    var done = ps.filter(function (p) { return S.grades && S.grades[p.id]; }).length;
    return '<p class="muted">Оценено ' + done + ' из ' + ps.length + ' участников.</p>';
  }

  function csv() {
    var rows = [['Игрок', 'Команда'].concat(G.criteria.map(function (c) { return c.name + ' (0–' + c.max + ')'; }), ['Итог (0–10)', 'Комментарий', 'Куратор'])];
    players().forEach(function (p) {
      var g = (S.grades || {})[p.id] || {};
      rows.push([p.name, p.team == null ? '' : tLabel(p.team)].concat(G.criteria.map(function (c) { return g[c.key] == null ? '' : g[c.key]; }), [gradeTotal(g), g.note || '', g.by || '']));
    });
    var text = '﻿' + rows.map(function (r) { return r.map(function (v) { v = String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(';'); }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    a.download = 'оценки-форсайт.csv';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // =====================================================================
  //                               КУРАТОР
  // =====================================================================
  function viewCurator() {
    var ti = Math.min(ui.curTeam, S.teams.length - 1);
    var t = S.teams[ti];
    var by = store.get('curName') || '';
    var html = '<header class="bar" style="' + teamStyle(ti) + '"><span class="logo">Оценки куратора</span><span class="who">Этап: ' + PHASE_NAME[S.phase] + '</span></header>';
    html += '<main class="pmain stack12"><div class="tabs">' + S.teams.map(function (tt) { return '<button class="tab' + (tt.id === ti ? ' on' : '') + '" style="' + teamStyle(tt.id) + '" data-act="curTeam" data-team="' + tt.id + '">' + tNo(tt.id) + '</button>'; }).join('') + '</div>' +
      '<label class="lbl" for="curname">Ваше имя (куратор)</label><input id="curname" class="inp" data-key="curName" value="' + esc(by) + '" placeholder="Например, Егор">' +
      '<h1 class="ph1 sm">' + tLabel(ti) + (t.world ? ' · мир ' + t.world + ' «' + esc(tName(ti)) + '»' : '') + '</h1>';
    var ms = members(ti);
    html += '<p class="hint">Шкала: ' + G.criteria.map(function (c) { return esc(c.name) + ' 0–' + c.max; }).join(', ') + '. Итог — до 10 баллов.</p>';
    html += ms.length ? ms.map(function (p) {
      var g = (S.grades || {})[p.id] || {};
      var sigs = (S.signals || []).filter(function (x) { return x.pid === p.id; }).length;
      var rated = S.ratings && S.ratings[p.id] ? 'да' : 'нет';
      return '<div class="gcard"><div class="ghead"><b>' + (captainId(ti) === p.id ? crown() : '') + esc(p.name) + (captainId(ti) === p.id ? ' <span class="small muted">капитан</span>' : '') + '</b><span class="gt">' + gradeTotal(g) + '<small>/10</small></span></div>' +
        '<p class="hint">Сигналов: ' + sigs + ' · оценил факторы: ' + rated + '</p>' +
        G.criteria.map(function (c) {
          var opts = ''; for (var k = 0; k <= c.max; k++) opts += '<button class="' + (g[c.key] === k ? 'on' : '') + '" data-act="grade" data-pid="' + p.id + '" data-k="' + c.key + '" data-v="' + k + '">' + k + '</button>';
          return '<div class="crit"><span>' + esc(c.name) + '</span><div class="seg num">' + opts + '</div></div>';
        }).join('') +
        '<input class="inp sm" data-key="note:' + p.id + '" data-note="' + p.id + '" placeholder="Комментарий (необязательно)" value="' + esc(g.note || '') + '"></div>';
    }).join('') : '<p class="hint">В команде пока никого.</p>';
    var LBL = { title: 'Название мира', residents: 'Для жителей', business: 'Для сотрудников', government: 'Для министра', signposts: 'Ранние признаки', rationale: 'Обоснование плана', shockAnswer: 'Реакция на шок' };
    html += '<h2 class="ph2">Работа команды</h2><div class="card cwork">' + Object.keys(LBL).map(function (k) {
      return t[k] ? '<p><b>' + LBL[k] + ':</b> ' + esc(t[k]) + '</p>' : '';
    }).join('') + (Object.keys(t.placements || {}).length ? '<p><b>Внедрение:</b> ' + Object.keys(t.placements).map(function (p) { var r = eff(t.id, p); return esc(proj(p).short) + ' → ' + esc(block(t.placements[p]).name) + (r ? ' (' + signed(r.v) + ')' : ''); }).join(', ') + '</p>' : '') + '</div></main>';
    return html;
  }

  // =====================================================================
  //                              СОБЫТИЯ
  // =====================================================================
  root.addEventListener('submit', function (e) {
    var f = e.target.closest('[data-form]');
    if (!f) return;
    e.preventDefault();
    if (f.dataset.form === 'join') {
      var name = (root.querySelector('[data-key="name"]').value || '').trim();
      if (!name) { toast('Введите имя', 'err'); return; }
      delete drafts.name;
      run({ a: 'join', name: name, pid: pid || '' }).then(function (d) { pid = d.pid; ui.renaming = false; store.set('pid', pid); lastHtml = ''; render(); }, function () { });
    }
    if (f.dataset.form === 'pin') {
      pin = (root.querySelector('[data-key="pin"]').value || '').trim();
      delete drafts.pin;
      store.set('pin', pin);
      api({ a: 'checkPin' }).then(function () { S = null; lastHtml = ''; poll(); }, function (er) { toast(er.message, 'err'); render(); });
    }
    if (f.dataset.form === 'signal') {
      var inp = root.querySelector('[data-key="sig"]');
      var text = (inp.value || '').trim();
      if (text.length < 3) { toast('Опишите сигнал хотя бы парой слов', 'err'); return; }
      run({ a: 'signal', type: ui.sigType, text: text }, 'Сигнал на экране').then(function () { delete drafts.sig; lastHtml = ''; render(); }, function () { });
    }
  });

  root.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    var a = el.dataset.act, d = el.dataset;
    switch (a) {
      case 'rename': ui.renaming = true; drafts.name = me() ? me().name : ''; lastHtml = ''; render(); break;
      case 'sigType': ui.sigType = d.type; render(); break;
      case 'delSignal': run({ a: 'delSignal', id: d.id }).catch(function () { }); break;
      case 'rate': { var f = d.f; ui.rate[f] = ui.rate[f] || [0, 0]; ui.rate[f][Number(d.axis)] = Number(d.v); render(); break; }
      case 'sendRates': run({ a: 'rate', ratings: ui.rate }, 'Оценки отправлены').then(function () { ui.rateEdit = false; render(); }, function () { }); break;
      case 'rateEdit': ui.rateEdit = true; render(); break;
      case 'vote': run({ a: 'vote', candidate: d.pid }).catch(function () { }); break;
      case 'pickTeam': run({ a: 'pickTeam', team: d.team === '' ? null : Number(d.team) }).catch(function () { }); break;
      case 'pick': { var mt0 = myTeam(); ui.pending = d.project; ui.pendBlock = mt0 && mt0.placements[d.project] ? mt0.placements[d.project] : null; render(); window.scrollTo(0, 0); break; }
      case 'pickBlock': ui.pendBlock = d.block; render(); break;
      case 'cancelPick': ui.pending = null; ui.pendBlock = null; render(); break;
      case 'placeBlock': {
        if (!ui.pending || !ui.pendBlock) return;
        var pj = ui.pending, bk = ui.pendBlock;
        ui.pending = null; ui.pendBlock = null;
        run({ a: 'place', project: pj, block: bk }, '«' + proj(pj).short + '» → ' + block(bk).name).catch(function () { });
        window.scrollTo(0, 0);
        break;
      }
      case 'unplace': run({ a: 'place', project: d.project, block: '' }).catch(function () { }); break;
      case 'submitMap':
        if (confirm('Отправить план команды? После этого его нельзя будет изменить.'))
          run({ a: 'submitMap' }).then(function (r) {
            var e2 = r.effects || { sum: 0, count: 0 };
            if (!e2.count) toast('План отправлен. Блоки выбраны без штрафов и бонусов.', 'ok', 5000);
            else toast('План отправлен. Выбор блоков: ' + signed(e2.sum) + ' — подробности под решениями.', e2.sum < 0 ? 'err' : 'ok', 6500);
            window.scrollTo(0, 0);
          }, function () { });
        break;
      case 'openLot': ui.lotOpen = d.project; render(); break;
      case 'bidStep': { var t = myTeam(); var pr0 = d.project; var cur0 = ui.bids[pr0] == null ? 10 : ui.bids[pr0]; var nv = Math.max(0, Math.min(t ? t.budget : 0, cur0 + Number(d.d))); if (nv > 0 && nv < 5) nv = 5; ui.bids[pr0] = nv; render(); break; }
      case 'bid': ui.lotOpen = null; run({ a: 'bid', project: d.project, amount: ui.bids[d.project] }, 'Ставка принята: ' + ui.bids[d.project]).catch(function () { }); break;
      case 'pass': ui.lotOpen = null; run({ a: 'bid', project: d.project, amount: 0 }, 'Команда пасует').catch(function () { }); break;
      // ведущий
      case 'phase': run({ a: 'setPhase', phase: d.phase }).catch(function () { }); break;
      case 'intro': run({ a: 'setIntro', step: Number(d.step) }).catch(function () { }); break;
      case 'hideSignal': run({ a: 'hideSignal', id: d.id }).catch(function () { }); break;
      case 'showAxes': run({ a: 'showAxes' }).catch(function () { }); break;
      case 'pitchTeam': run({ a: 'setPitch', team: Number(d.team) }).catch(function () { }); break;
      case 'dealWorlds': if (confirm('Раздать миры командам заново? Тексты команд сохранятся, но будут относиться к новому миру.')) run({ a: 'dealWorlds' }, 'Миры розданы заново').catch(function () { }); break;
      case 'teamMode': run({ a: 'setTeamMode', mode: d.mode }).catch(function () { }); break;
      case 'autoTeams': run({ a: 'autoTeams', keep: d.keep === '1' }, 'Команды распределены').catch(function () { }); break;
      case 'kick': if (confirm('Удалить игрока из игры?')) run({ a: 'kick', pid: d.pid }).catch(function () { }); break;
      case 'unlockMap': run({ a: 'unlockMap', team: Number(d.team) }).catch(function () { }); break;
      case 'startLots': {
        var list = Object.keys(ui.sel).filter(function (k) { return ui.sel[k]; });
        run({ a: 'startLots', projects: list, seconds: ui.lotSeconds }, list.length > 1 ? 'Открыто лотов: ' + list.length : 'Лот открыт').then(function () { ui.sel = {}; render(); }, function () { });
        break;
      }
      case 'closeLot': ui.closing[d.project] = true; run({ a: 'closeLot', project: d.project }).then(function (r) { if (r.result) toast(resultText(r.result), 'ok'); }, function () { ui.closing[d.project] = false; }); break;
      case 'closeAll': run({ a: 'closeAll' }, 'Все лоты закрыты').catch(function () { }); break;
      case 'cancelLot': run({ a: 'cancelLot', project: d.project }).catch(function () { }); break;
      case 'undoLot': if (confirm('Отменить результат последнего лота и вернуть монеты?')) run({ a: 'undoLot' }).catch(function () { }); break;
      case 'spin': run({ a: 'spin' }).catch(function () { }); break;
      case 'rollDice': run({ a: 'rollDice' }).catch(function () { }); break;
      case 'drawShock': run({ a: 'drawShock', shock: d.shock || '' }).catch(function () { }); break;
      case 'clearShocks': if (confirm('Сбросить кубик и все шоки?')) run({ a: 'clearShocks' }).catch(function () { }); break;
      case 'setBet': if (!S.bet || confirm('Сменить вопрос? Уже сделанные ставки обнулятся.')) run({ a: 'setBet', qid: d.q }).catch(function () { }); break;
      case 'revealBet': if (confirm('Закрыть приём ставок и раскрыть правильный ответ?')) run({ a: 'revealBet' }).catch(function () { }); break;
      case 'betOpt': ui.betOpt = Number(d.i); render(); break;
      case 'betStep': { var mp = myPoints(); ui.betStake = Math.max(0, Math.min(mp ? mp.base : 0, (ui.betStake || 0) + Number(d.d))); render(); break; }
      case 'betAll': { var mp2 = myPoints(); ui.betStake = mp2 ? mp2.base : 0; render(); break; }
      case 'placeBet': run({ a: 'placeBet', option: ui.betOpt, stake: ui.betStake }, 'Ставка принята: ' + ui.betStake).catch(function () { }); break;
      case 'noBet': ui.betStake = 0; run({ a: 'placeBet', option: 0, stake: 0 }, 'Вы не рискуете — баллы сохранятся').catch(function () { }); break;
      case 'export': run({ a: 'export' }, 'Выгружено в листы «Итоги», «Оценки» и «Сигналы»').catch(function () { }); break;
      case 'csv': csv(); break;
      case 'reset': if (confirm(d.keep === '1' ? 'Начать игру заново? Игроки останутся, всё остальное удалится.' : 'Полностью сбросить игру? Удалятся все игроки и ответы.')) run({ a: 'reset', keepPlayers: d.keep === '1' }, 'Игра сброшена').catch(function () { }); break;
      // куратор
      case 'curTeam': ui.curTeam = Number(d.team); store.set('curTeam', String(ui.curTeam)); render(); break;
      case 'grade': {
        var body = { a: 'grade', pid: d.pid, by: store.get('curName') || '' };
        body[d.k] = Number(d.v);
        api(body).catch(function (er) { toast(er.message, 'err'); });
        break;
      }
    }
  });

  root.addEventListener('change', function (e) {
    var el = e.target.closest('[data-act-change]');
    if (!el) return;
    var a = el.dataset.actChange;
    if (a === 'teamSize') run({ a: 'setTeamMode', size: Number(el.value) }).catch(function () { });
    if (a === 'setCaptain') run({ a: 'setCaptain', team: Number(el.dataset.team), pid: el.value || null }, el.value ? 'Капитан назначен' : 'Капитан — по голосованию').catch(function () { });
    if (a === 'assign') run({ a: 'assign', pid: el.dataset.pid, team: el.value === '' ? null : Number(el.value) }).catch(function () { });
    if (a === 'diceValue' && el.value) run({ a: 'rollDice', value: Number(el.value) }).catch(function () { });
    if (a === 'betStake') { ui.betStake = Number(el.value); delete drafts.betStake; render(); }
    if (a === 'selLot') { ui.sel[el.dataset.project] = el.checked; render(); }
    if (a === 'lotSeconds') { ui.lotSeconds = Number(el.value); render(); }
    if (a === 'autoClose') { ui.autoClose = el.checked; render(); }
    if (a === 'spinWorld' && el.value) { if (confirm('Назначить мир ' + el.value + ' вместо случайного?')) run({ a: 'spin', world: el.value }).catch(function () { }); else el.value = ''; }
  });

  // ползунок ставки: подпись и кнопка обновляются сразу, без перерисовки всего экрана
  root.addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset && el.dataset.actChange === 'betStake') {
      ui.betStake = Number(el.value);
      var mp = myPoints(), v = ui.betStake;
      var lb = root.querySelector('label[for="stake"]'); if (lb) lb.textContent = 'Сколько баллов ставите: ' + v;
      var rh = root.querySelector('.rangehint'); if (rh && mp) rh.innerHTML = '<span>угадаете: ' + (mp.base + v) + '</span><span>ошибётесь: ' + (mp.base - v) + '</span>';
      var bt = root.querySelector('button[data-act="placeBet"]'); if (bt) { bt.textContent = 'Поставить ' + v + ' ' + plural(v, 'балл', 'балла', 'баллов'); bt.disabled = ui.betOpt == null || v < 1; }
    }
  });

  // текстовые поля команды: черновик сразу, сохранение через паузу и при уходе с поля
  function saveField(key, name, value) {
    clearTimeout(saveTimers[key]);
    api({ a: 'field', field: name, value: value }).then(function () {
      if (drafts[key] === value) { delete drafts[key]; render(); }
    }, function (er) { toast(er.message, 'err'); });
  }
  function saveNote(pidX, value) {
    var key = 'note:' + pidX;
    clearTimeout(saveTimers[key]);
    api({ a: 'grade', pid: pidX, note: value, by: store.get('curName') || '' }).then(function () {
      if (drafts[key] === value) { delete drafts[key]; render(); }
    }, function (er) { toast(er.message, 'err'); });
  }
  root.addEventListener('input', function (e) {
    var el = e.target;
    var key = el.dataset && el.dataset.key;
    if (!key || key === 'betStake') return;
    drafts[key] = el.value;
    if (el.dataset.field) {
      clearTimeout(saveTimers[key]);
      saveTimers[key] = setTimeout(function () { saveField(key, el.dataset.field, drafts[key]); }, 1200);
      var m = el.parentNode.querySelector('.meta'); if (m) m.textContent = 'Сохраняем…';
    } else if (el.dataset.note) {
      clearTimeout(saveTimers[key]);
      saveTimers[key] = setTimeout(function () { saveNote(el.dataset.note, drafts[key]); }, 1200);
    } else if (key === 'curName') {
      store.set('curName', el.value);
    }
  });
  root.addEventListener('focusout', function (e) {
    var el = e.target;
    var key = el.dataset && el.dataset.key;
    if (!key || drafts[key] === undefined) return;
    if (el.dataset.field) saveField(key, el.dataset.field, drafts[key]);
    else if (el.dataset.note) saveNote(el.dataset.note, drafts[key]);
    else if (key === 'curName') delete drafts[key];
  });

  window.addEventListener('hashchange', function () { readRole(); S = null; lastHtml = ''; bgSwarm(); render(); poll(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

  bgSwarm();
  render();
  poll();
  requestAnimationFrame(loop);
})();

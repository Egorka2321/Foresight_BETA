/* «Город в 5 мирах» — клиент. Роли: игрок (по умолчанию), #host, #screen, #curator. */
(function () {
  'use strict';
  var G = window.GAME;
  var CFG = window.FORSIGHT_CONFIG || {};
  var qs = new URLSearchParams(location.search);
  var API = qs.get('api') || CFG.API_URL || '';
  if (API && API.indexOf('ВСТАВЬТЕ') >= 0) API = '';

  var PHASES = ['intro', 'lobby', 'signals', 'factors', 'teams', 'world', 'pitch', 'map', 'overlay', 'auction', 'reveal', 'shock', 'results', 'bet', 'final'];
  var PHASE_HINT = {
    intro: 'Что такое форсайт', lobby: 'Собираемся', signals: 'Что меняется вокруг города?', factors: 'Что сильнее всего изменит город?',
    teams: 'Объединяемся в команды', world: 'Ваш мир будущего', pitch: 'Команды рассказывают о своих мирах', map: 'Стройте город для своего мира', overlay: 'Что совпало у команд',
    auction: 'Бюджет ограничен — выбирайте', reveal: 'Какой мир наступит?', shock: 'Кубик решит, сколько будет шоков', results: 'Кто победил и почему',
    bet: 'Рискнёте своими баллами?', final: 'Итоговый рейтинг',
  };
  var PHASE_NAME = { intro: 'Заставка', lobby: 'Сбор', signals: 'Сигналы', factors: 'Факторы', teams: 'Команды', world: 'Миры', pitch: 'Рассказ', map: 'Карта', overlay: 'Наложение', auction: 'Аукцион', reveal: 'Судьба', shock: 'Шоки', results: 'Итоги', bet: 'Ставка', final: 'Финал' };
  var W = G.worldOrder;
  var FK = Object.keys(G.factors);
  var SPIN_MS = 6500;

  // ---------- хранилище браузера (может быть недоступно) ----------
  var store = {
    get: function (k) { try { return localStorage.getItem('f5:' + k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem('f5:' + k, v); } catch (e) { } },
    del: function (k) { try { localStorage.removeItem('f5:' + k); } catch (e) { } },
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
    pending: null, bid: null, busy: false, conn: true, curTeam: Number(store.get('curTeam') || 0), spinDone: null, lotSeen: null,
    closing: {}, bids: {}, sel: {}, autoClose: true, lotSeconds: 40, toastT: null, sigType: 'trend', rate: null, rateEdit: false, renaming: false,
  };
  var root = document.getElementById('app');
  var swarm = null;

  function now() { return Date.now() + offset; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function plural(n, a, b, c) { n = Math.abs(n) % 100; var n1 = n % 10; if (n > 10 && n < 20) return c; if (n1 > 1 && n1 < 5) return b; if (n1 === 1) return a; return c; }
  function signed(n) { return n > 0 ? '+' + n : String(n).replace('-', '−'); }
  function cut(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function world(id) { return G.worlds[id]; }
  function teamWorld(ti) { return S.teams[ti].world; }
  function tColor(ti) { var w = teamWorld(ti); return w ? world(w).color : G.teamColors[ti]; }
  function tSoft(ti) { var w = teamWorld(ti); return w ? world(w).soft : '#DCE8F8'; }
  function tNo(ti) { return S.teams[ti].no || ti + 1; }
  function tLabel(ti) { return 'Команда ' + tNo(ti); }
  function tName(ti) { var t = S.teams[ti]; return t.title || (t.world ? world(t.world).name : tLabel(ti)); }
  function me() { return S && pid ? S.players[pid] : null; }
  function myTeam() { var p = me(); return p && p.team != null ? S.teams[p.team] : null; }
  function members(ti) { return S.order.filter(function (id) { return S.players[id] && S.players[id].team === ti; }).map(function (id) { return S.players[id]; }); }
  function players() { return S.order.filter(function (id) { return S.players[id]; }).map(function (id) { return S.players[id]; }); }
  function teamStyle(ti) { return '--c:' + tColor(ti) + ';--cs:' + tSoft(ti); }
  function worldStyle(wid) { var w = world(wid); return '--c:' + w.color + ';--cs:' + w.soft; }
  function teamOfWorld(wid) { for (var i = 0; i < S.teams.length; i++) if (S.teams[i].world === wid) return i; return null; }
  // последствия размещения приходят с сервера только после отправки плана команды
  function eff(ti, project) { var t = S.teams[ti]; return t && t.effects && t.effects[project] ? t.effects[project] : null; }
  // капитан: назначен или лидирует в голосовании (сервер присылает t.leader)
  function captainId(ti) { var t = S.teams[ti]; return t ? (t.captain || t.leader || null) : null; }
  function isCaptain(t) { return !!(t && pid && captainId(t.id) === pid); }
  function captainName(ti) { var c = captainId(ti); return c && S.players[c] ? S.players[c].name : '—'; }
  function captainBanner(t) {
    if (isCaptain(t)) return '<div class="capbar me"><span class="crown" aria-hidden="true"></span><span><b>Вы капитан.</b> Вы вводите ответы и делаете ставки за всю команду — советуйтесь с ней.</span></div>';
    return '<div class="capbar"><span class="crown" aria-hidden="true"></span><span>За команду действует капитан <b>' + esc(captainName(t.id)) + '</b>. Обсуждайте и подсказывайте ему — экран обновится сам.</span></div>';
  }
  function myPoints() { var pp = S.points && pid && S.points.players[pid]; return pp || null; }
  function chip(ti, big) { return '<span class="tno' + (big ? ' big' : '') + '" style="' + teamStyle(ti) + '">' + tNo(ti) + '</span>'; }

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
    if (prevPhase && prevPhase !== S.phase) { ui.pending = null; window.scrollTo(0, 0); lastHtml = ''; phaseTransition(S.phase); }
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

  // ---------- отрисовка с сохранением фокуса и черновиков ----------
  var lastHtml = '';
  function render() {
    var html;
    try { html = view(); } catch (e) { console.error(e); html = '<div class="pad"><p>Ошибка отрисовки: ' + esc(e.message) + '</p></div>'; }
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
    var rw = root.querySelector('.routewrap'), rn = rw && rw.querySelector('li.now');
    if (rn) rw.scrollLeft = Math.max(0, rn.offsetLeft - rw.clientWidth / 2 + rn.clientWidth / 2);
    var cv = root.querySelector('canvas.swarm');
    if (cv) {
      if (!swarm) swarm = new window.Swarm(role === 'screen' ? 240 : 120);
      swarm.attach(cv);
      // на проекторе текст слева: кластеры собираются справа, а свободные точки плывут по всему экрану
      if (role === 'screen' && cv.closest('.sintro')) swarm.region(0.42, 1, cv.closest('.is-rules') ? 0 : 0.46);
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
    return '<div class="pad narrow"><h1 class="h1">Сервер не подключён</h1><p>Откройте файл <b>config.js</b> и вставьте в <b>API_URL</b> адрес веб-приложения Google Apps Script (заканчивается на <code>/exec</code>). Инструкция — в README репозитория.</p></div>';
  }

  function viewPin(title) {
    return '<div class="pad narrow"><h1 class="h1">' + esc(title) + '</h1>' +
      '<form class="stack" data-form="pin"><label class="lbl" for="pin">PIN ведущего</label>' +
      '<input id="pin" class="inp" data-key="pin" inputmode="numeric" autocomplete="off" placeholder="Например, 2040" value="' + esc(pin) + '">' +
      '<button class="btn primary" type="submit">Войти</button></form>' +
      (pin && !pinOk() ? '<p class="muted small">Этот PIN не подошёл. Он задаётся в начале файла Code.gs.</p>' : '') + '</div>';
  }

  // ---------- общие элементы ----------
  function mapSvg(opts) {
    opts = opts || {};
    var names = {}; Object.keys(G.zones).forEach(function (z) { names[z] = G.zones[z].name; });
    opts.names = names;
    return window.CityMap.svg(opts);
  }

  function mapBox(opts, cls) {
    return '<div class="mapbox' + (cls ? ' ' + cls : '') + '">' + mapSvg(opts) + '</div>';
  }

  function phaseStrip(ph) {
    var idx = PHASES.indexOf(ph);
    return '<div class="pstrip" aria-label="Этап ' + (idx + 1) + ' из ' + PHASES.length + '"><div class="pseg" style="--n:' + PHASES.length + '">' + PHASES.map(function (p, i) { return '<i class="' + (i < idx ? 'done' : i === idx ? 'now' : '') + '"></i>'; }).join('') + '</div>' +
      '<div class="pmeta"><span class="pnum">Этап ' + (idx + 1) + ' из ' + PHASES.length + '</span><b>' + PHASE_NAME[ph] + '</b></div></div>';
  }

  function route(current) {
    var idx = PHASES.indexOf(current);
    return '<ol class="route" aria-label="Этапы игры">' + PHASES.map(function (p, i) {
      return '<li class="' + (i < idx ? 'done' : i === idx ? 'now' : '') + '"' + (i === idx ? ' aria-current="step"' : '') + '><span class="st"></span><span class="nm">' + PHASE_NAME[p] + '</span></li>';
    }).join('') + '</ol>';
  }

  function worldCard(wid, opts) {
    var w = world(wid);
    opts = opts || {};
    return '<article class="wcard" style="' + worldStyle(wid) + '">' +
      '<div class="wband"><span class="wletter">' + wid + '</span><div>' + (opts.kicker ? '<p class="wkick">' + esc(opts.kicker) + '</p>' : '') + '<h2 class="wname">' + esc(w.name) + '</h2><p class="waxes">' + esc(w.axes) + '</p></div></div>' +
      (opts.short ? '' : '<p class="wstory">' + esc(w.story) + '</p><dl class="wdata">' + w.data.map(function (d) { return '<div><dt>' + esc(d[0]) + '</dt><dd>' + esc(d[1]) + '</dd></div>'; }).join('') + '</dl><p class="tiny muted">Данные учебные, город вымышленный.</p>') +
      '</article>';
  }

  function dots(teamIds) {
    return '<span class="dots">' + S.teams.map(function (t) {
      var on = teamIds.indexOf(t.id) >= 0;
      return '<i class="' + (on ? 'on' : '') + '" style="--c:' + tColor(t.id) + '" title="' + (on ? tLabel(t.id) : '') + '"></i>';
    }).join('') + '</span>';
  }

  function overlayData() {
    var map = {};
    Object.keys(G.projects).forEach(function (p) { map[p] = { project: p, teams: [], zones: {} }; });
    S.teams.forEach(function (t) {
      Object.keys(t.placements || {}).forEach(function (p) {
        if (!map[p]) return;
        map[p].teams.push(t.id);
        map[p].zones[t.placements[p]] = (map[p].zones[t.placements[p]] || 0) + 1;
      });
    });
    return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return b.teams.length - a.teams.length || a.project.localeCompare(b.project); });
  }

  function allPins() {
    var pins = [];
    S.teams.forEach(function (t) {
      Object.keys(t.placements || {}).forEach(function (p) {
        var r = eff(t.id, p);
        pins.push({ zone: t.placements[p], color: tColor(t.id), label: String(tNo(t.id)), bad: r && r.v < 0 });
      });
    });
    return pins;
  }

  function soldMap() { var m = {}; S.auction.results.forEach(function (r) { m[r.project] = r; }); return m; }

  function countdownHtml(cur, big) {
    var r = big ? 54 : 30, sw = big ? 9 : 6, c = 2 * Math.PI * r, size = (r + sw) * 2;
    return '<div class="timer' + (big ? ' big' : '') + '"><svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="tr-bg" stroke-width="' + sw + '"/>' +
      '<circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" class="tr-fg" stroke-width="' + sw + '" stroke-dasharray="' + c.toFixed(1) + '" data-ring="' + cur.endsAt + '" data-total="' + cur.seconds * 1000 + '" data-len="' + c.toFixed(1) + '" transform="rotate(-90 ' + size / 2 + ' ' + size / 2 + ')"/></svg>' +
      '<span class="tnum" data-countdown="' + cur.endsAt + '">' + Math.max(0, Math.ceil((cur.endsAt - now()) / 1000)) + '</span></div>';
  }

  function wheelHtml(size) {
    var n = W.length, r = 100;
    var s = '<div class="wheel-wrap" style="width:' + size + 'px;height:' + size + 'px"><svg class="pointer" viewBox="0 0 40 30" aria-hidden="true"><path d="M20,30 L4,2 L36,2 Z"/></svg>' +
      '<svg id="wheel" viewBox="-110 -110 220 220" width="' + size + '" height="' + size + '" aria-label="Колесо судьбы">';
    W.forEach(function (wid, i) {
      var a0 = (i * 360 / n - 90 - 180 / n) * Math.PI / 180, a1 = ((i + 1) * 360 / n - 90 - 180 / n) * Math.PI / 180;
      var x0 = r * Math.cos(a0), y0 = r * Math.sin(a0), x1 = r * Math.cos(a1), y1 = r * Math.sin(a1);
      var am = (i * 360 / n - 90) * Math.PI / 180;
      s += '<path d="M0,0 L' + x0.toFixed(2) + ',' + y0.toFixed(2) + ' A' + r + ',' + r + ' 0 0 1 ' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' Z" fill="' + world(wid).color + '" stroke="#F4F8FD" stroke-width="2"/>' +
        '<text x="' + (66 * Math.cos(am)).toFixed(1) + '" y="' + (66 * Math.sin(am) + 9).toFixed(1) + '" text-anchor="middle" class="wl">' + wid + '</text>';
    });
    s += '<circle r="16" fill="#F4F8FD"/><circle r="6" fill="#0C2340"/></svg></div>';
    return s;
  }

  function spinState() {
    if (!S.reveal) return null;
    var elapsed = now() - S.reveal.at;
    return { done: elapsed >= SPIN_MS, elapsed: elapsed };
  }

  function wheelAngle() {
    var i = W.indexOf(S.reveal.world);
    var h = 0; String(S.reveal.spinId || '').split('').forEach(function (ch) { h = (h * 31 + ch.charCodeAt(0)) % 1000; });
    var jitter = (h / 1000 - 0.5) * 40;
    var target = 360 * 7 - i * 72 + jitter;
    var t = Math.min(1, Math.max(0, (now() - S.reveal.at) / SPIN_MS));
    return target * (1 - Math.pow(1 - t, 4));
  }

  // ---------- тик: таймеры, колесо, заставка, автозакрытие лота ----------
  function tick() {
    if (!S) return;
    var n = now();
    root.querySelectorAll('[data-countdown]').forEach(function (el) {
      var left = Math.max(0, Math.ceil((Number(el.dataset.countdown) - n) / 1000));
      if (el.textContent !== String(left)) el.textContent = left;
      el.parentNode.classList.toggle('hurry', left <= 5);
    });
    root.querySelectorAll('[data-ring]').forEach(function (el) {
      var left = Math.max(0, Number(el.dataset.ring) - n), tot = Number(el.dataset.total), len = Number(el.dataset.len);
      el.setAttribute('stroke-dashoffset', (len * (1 - left / tot)).toFixed(1));
    });
    var dc = document.getElementById('dice');
    if (dc && S.dice) { var ang = diceAngle(); dc.style.transform = 'rotateX(' + ang[0].toFixed(1) + 'deg) rotateY(' + ang[1].toFixed(1) + 'deg)'; }
    if (S.dice) { var dk = S.dice.id + (diceDone() ? ':done' : ''); if (ui.diceDone !== dk) { ui.diceDone = dk; if (diceDone()) render(); } }
    var wh = document.getElementById('wheel');
    if (wh && S.reveal) wh.style.transform = 'rotate(' + wheelAngle().toFixed(2) + 'deg)';
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

  // фон телефона: тот же «рой» сигналов, что и на проекторе, но спокойнее
  var bg = null, bgFrame = 0;
  function bgSwarm() {
    if (role !== 'play' || bg) return;
    var cv = document.createElement('canvas');
    cv.className = 'bgswarm';
    cv.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(cv, document.body.firstChild);
    bg = new window.Swarm(70);
    bg.attach(cv);
  }
  function loop(t) {
    tick();
    if (swarm) swarm.frame(t);
    if (bg && (bgFrame++ % 2 === 0)) { bg.setStep(S && S.phase === 'intro' ? 0 : 0); bg.frame(t); }
    requestAnimationFrame(loop);
  }

  function resultText(r) {
    var p = G.projects[r.project].name;
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

  function scatter(big) {
    var st = factorStats();
    var Wd = 760, Hd = 520, L = 70, R = 24, T = 44, B = 62;
    var x = function (v) { return L + (v - 1) / 4 * (Wd - L - R); };
    var y = function (v) { return T + (1 - (v - 1) / 4) * (Hd - T - B); };
    var s = '<svg class="scatter' + (big ? ' big' : '') + '" viewBox="0 0 ' + Wd + ' ' + Hd + '" role="img" aria-label="Карта факторов: влияние и неопределённость">';
    s += '<rect class="q crit" x="' + x(3) + '" y="' + y(5) + '" width="' + (x(5) - x(3)) + '" height="' + (y(3) - y(5)) + '"/>';
    s += '<rect class="q trend" x="' + x(1) + '" y="' + y(5) + '" width="' + (x(3) - x(1)) + '" height="' + (y(3) - y(5)) + '"/>';
    s += '<text class="qt" x="' + x(5) + '" y="' + (y(5) - 14) + '" text-anchor="end">Критические неопределённости ↗</text>';
    s += '<text class="qt" x="' + x(1) + '" y="' + (y(5) - 14) + '">↖ Тренды: учесть во всех мирах</text>';
    s += '<text class="qt dim" x="' + (x(5) - 10) + '" y="' + (y(1) - 12) + '" text-anchor="end">Джокеры: следить</text>';
    s += '<text class="qt dim" x="' + (x(1) + 10) + '" y="' + (y(1) - 12) + '">Второстепенное</text>';
    for (var v = 1; v <= 5; v++) {
      s += '<line class="gl" x1="' + x(v) + '" x2="' + x(v) + '" y1="' + y(1) + '" y2="' + y(5) + '"/><line class="gl" x1="' + x(1) + '" x2="' + x(5) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      s += '<text class="tk" x="' + x(v) + '" y="' + (y(1) + 20) + '" text-anchor="middle">' + v + '</text><text class="tk" x="' + (x(1) - 12) + '" y="' + (y(v) + 5) + '" text-anchor="end">' + v + '</text>';
    }
    s += '<text class="ax" x="' + ((x(1) + x(5)) / 2) + '" y="' + (Hd - 12) + '" text-anchor="middle">Неопределённость →</text>';
    s += '<text class="ax" transform="translate(18 ' + ((y(1) + y(5)) / 2) + ') rotate(-90)" text-anchor="middle">Влияние на город →</text>';
    if (st.n) {
      // подписи раскладываем так, чтобы они не наезжали друг на друга и на подписи четвертей
      var boxes = [
        { x0: x(1), x1: x(1) + 260, y0: y(5) - 32, y1: y(5) - 6 }, { x0: x(5) - 270, x1: x(5), y0: y(5) - 32, y1: y(5) - 6 },
        { x0: x(1), x1: x(1) + 150, y0: y(1) - 30, y1: y(1) - 4 }, { x0: x(5) - 160, x1: x(5), y0: y(1) - 30, y1: y(1) - 4 },
      ];
      var hit = function (b) { return boxes.some(function (o) { return b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0; }); };
      var placedPts = [];
      st.list.forEach(function (p) {
        var cx = x(p.unc), cy = y(p.inf);
        // точки с одинаковыми координатами чуть разводим
        placedPts.forEach(function (q) { if (Math.abs(q[0] - cx) < 6 && Math.abs(q[1] - cy) < 6) { cx += 9; cy -= 9; } });
        placedPts.push([cx, cy]);
        boxes.push({ x0: cx - 9, x1: cx + 9, y0: cy - 9, y1: cy + 9 });
      });
      st.list.forEach(function (p, idx) {
        var cx = placedPts[idx][0], cy = placedPts[idx][1], axis = S.axesShown && G.axisFactors.indexOf(p.f) >= 0;
        var label = G.factors[p.f].name + (axis ? ' — ось матрицы' : '');
        var w = label.length * 8.4 + 6;
        var opts = [[14, 0], [-14, 0], [14, -20], [14, 20], [-14, -20], [-14, 20], [14, -38], [14, 38], [-14, -38], [-14, 38], [0, -24], [0, 26]];
        var pick = null;
        for (var oi = 0; oi < opts.length && !pick; oi++) {
          var dx = opts[oi][0], dy = opts[oi][1];
          var ax0 = dx > 0 ? cx + dx : dx < 0 ? cx + dx - w : cx - w / 2;
          var b = { x0: ax0, x1: ax0 + w, y0: cy + dy - 11, y1: cy + dy + 11 };
          if (b.x0 < 4 || b.x1 > Wd - 4 || b.y0 < 2 || b.y1 > Hd - 40) continue;
          if (!hit(b)) pick = { b: b, dx: dx, dy: dy };
        }
        if (!pick) { var fx = cx + 14 + w > Wd ? cx - 14 - w : cx + 14; pick = { b: { x0: fx, x1: fx + w, y0: cy - 11, y1: cy + 11 }, dx: 14, dy: 0 }; }
        boxes.push(pick.b);
        s += '<g class="pt' + (axis ? ' axis' : '') + '"><circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + (axis ? 11 : 8) + '"/>' +
          (pick.dy ? '<line class="lead" x1="' + cx.toFixed(1) + '" y1="' + cy.toFixed(1) + '" x2="' + (pick.dx >= 0 ? pick.b.x0 : pick.b.x1).toFixed(1) + '" y2="' + (cy + pick.dy).toFixed(1) + '"/>' : '') +
          '<text x="' + pick.b.x0.toFixed(1) + '" y="' + (cy + pick.dy + 5).toFixed(1) + '">' + esc(label) + '</text></g>';
      });
    } else {
      s += '<text class="qt" x="' + Wd / 2 + '" y="' + Hd / 2 + '" text-anchor="middle">Ждём первые оценки…</text>';
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
      '<span class="logo">Город в 5 мирах</span>' +
      '<span class="who">' + esc(p.name) + (t ? chip(t.id) : '') + '</span></header>';
    var body;
    var ph = S.phase;
    if (ph === 'intro') body = viewIntroPlayer(p);
    else if (ph === 'lobby') body = viewWait(p);
    else if (ph === 'signals') body = viewSignalsPlayer(p);
    else if (ph === 'factors') body = viewFactorsPlayer(p);
    else if (ph === 'teams') body = viewTeamsPlayer(p);
    else if (!t) body = '<section class="pad center"><div class="pulse"></div><h1 class="h2">Вы пока не в команде</h1><p class="muted">Ведущий скоро добавит вас. Экран обновится сам.</p></section>';
    else if (!t.world) body = '<section class="pad center"><div class="pulse"></div><h1 class="h2">Раздаём миры…</h1></section>';
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
    return head + phaseStrip(ph) + body;
  }

  function viewJoin() {
    return '<section class="join">' +
      '<div class="joinhero"><canvas class="swarm" data-step="0" aria-hidden="true"></canvas><h1 class="title">Город в&nbsp;5&nbsp;мирах</h1></div>' +
      '<p class="lead">Форсайт-сессия про будущее учебного моногорода ' + G.city + '. Вы не угадываете будущее, а ищете решения, которые сработают в любом из пяти миров.</p>' +
      '<form class="stack" data-form="join"><label class="lbl" for="name">Как вас зовут?</label>' +
      '<input id="name" class="inp" data-key="name" maxlength="40" autocomplete="name" placeholder="Имя и фамилия">' +
      '<button class="btn primary" type="submit"' + (ui.busy ? ' disabled' : '') + '>' + (ui.renaming ? 'Сохранить имя' : 'Войти в игру') + '</button></form></section>';
  }

  function viewIntroPlayer(p) {
    var sl = G.intro[S.introStep || 0];
    if (sl.layout === 'rules') {
      return '<section class="pad"><h1 class="h2">' + esc(sl.title) + '</h1><p class="muted">' + esc(sl.text) + '</p><ol class="rulelist phone">' +
        sl.steps.map(function (x) { return '<li><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></li>'; }).join('') + '</ol></section>';
    }
    return '<section class="pad center wait"><div class="introcanvas"><canvas class="swarm" data-step="' + (sl.swarm || 0) + '" aria-hidden="true"></canvas></div>' +
      '<h1 class="h2">Смотрите на экран</h1><p class="muted">Ведущие рассказывают, что такое форсайт.</p>' +
      '<p class="slidecap">' + esc(sl.title) + '</p></section>';
  }

  function viewWait(p) {
    var n = players().length;
    return '<section class="pad center wait"><div class="introcanvas"><canvas class="swarm" data-step="0" aria-hidden="true"></canvas></div>' +
      '<h1 class="h2">Вы в игре, ' + esc(p.name.split(' ')[0]) + '</h1>' +
      '<p class="muted">Ждём, пока ведущий начнёт. Экран переключится сам.</p>' +
      '<p class="count"><b>' + n + '</b> ' + plural(n, 'человек', 'человека', 'человек') + ' в комнате</p>' +
      '<button class="link" data-act="rename">Изменить имя</button></section>';
  }

  function viewSignalsPlayer(p) {
    var mine = (S.signals || []).filter(function (x) { return x.pid === p.id; });
    var left = 2 - mine.length;
    // в каждой категории — не больше одного сигнала от игрока
    var used = {}; mine.forEach(function (x) { used[x.type] = true; });
    if (used[ui.sigType]) ui.sigType = G.signalOrder.filter(function (k) { return !used[k]; })[0] || ui.sigType;
    var html = '<section class="pad"><h1 class="h2">Сигналы будущего</h1>' +
      '<p class="muted">Что меняется вокруг Северогорска — в стране, в технологиях, в жизни людей? Предложите ' + (mine.length ? 'ещё один фактор' : 'до двух факторов') + ' и определите, что это. <b>В каждой категории — только один ваш сигнал.</b></p>';
    if (left > 0) {
      html += '<div class="types" role="radiogroup" aria-label="Тип сигнала">' + G.signalOrder.map(function (k) {
        var ty = G.signalTypes[k], u = used[k];
        return '<button class="type' + (ui.sigType === k && !u ? ' on' : '') + (u ? ' used' : '') + '" role="radio" aria-checked="' + (ui.sigType === k && !u) + '" data-act="sigType" data-type="' + k + '"' + (u ? ' disabled' : '') + '><b>' + esc(ty.name) + '</b><span>' + (u ? 'Ваш сигнал уже здесь' : esc(ty.hint)) + '</span></button>';
      }).join('') + '</div>' +
        '<form class="stack" data-form="signal"><label class="lbl" for="sig">Ваш ' + esc(G.signalTypes[ui.sigType].name.toLowerCase()) + '</label>' +
        '<input id="sig" class="inp" data-key="sig" maxlength="140" placeholder="Например: ' + esc(G.signalTypes[ui.sigType].example) + '">' +
        '<button class="btn primary" type="submit"' + (ui.busy ? ' disabled' : '') + '>Отправить на общий экран</button></form>';
    } else {
      html += '<div class="notice ok">Оба ваших сигнала на экране. Посмотрите, что прислали другие.</div>';
    }
    if (mine.length) {
      html += '<h2 class="h3">Ваши сигналы</h2><ul class="siglist">' + mine.map(function (x) {
        return '<li><span class="stype ' + x.type + '">' + esc(G.signalTypes[x.type].name) + '</span><span>' + esc(x.text) + '</span><button class="x" data-act="delSignal" data-id="' + x.id + '" aria-label="Удалить сигнал">×</button></li>';
      }).join('') + '</ul>';
    }
    var all = (S.signals || []).length;
    html += '<p class="count"><b>' + all + '</b> ' + plural(all, 'сигнал', 'сигнала', 'сигналов') + ' от группы</p></section>';
    return html;
  }

  function viewFactorsPlayer(p) {
    var saved = S.ratings && S.ratings[p.id];
    if (!ui.rate) ui.rate = saved ? JSON.parse(JSON.stringify(saved)) : {};
    if (saved && !ui.rateEdit) {
      return '<section class="pad"><h1 class="h2">Оценки отправлены</h1><p class="muted">Посмотрите на общий экран: какие факторы оказались одновременно сильными и непредсказуемыми? Это кандидаты в оси сценариев.</p>' +
        '<div class="scbox">' + scatter(false) + '</div><button class="link" data-act="rateEdit">Изменить мои оценки</button></section>';
    }
    var done = FK.filter(function (f) { return ui.rate[f] && ui.rate[f][0] && ui.rate[f][1]; }).length;
    var html = '<section class="pad"><h1 class="h2">Что сильнее всего изменит город?</h1>' +
      '<p class="muted">Оцените каждый фактор от 1 до 5 по двум шкалам. <b>Влияние</b> — насколько сильно он изменит Северогорск. <b>Неопределённость</b> — насколько трудно предсказать, как он сложится.</p>';
    FK.forEach(function (f) {
      var v = ui.rate[f] || [0, 0];
      var row = function (axis, lbl) {
        var o = ''; for (var k = 1; k <= 5; k++) o += '<button class="' + (v[axis] === k ? 'on' : '') + '" data-act="rate" data-f="' + f + '" data-axis="' + axis + '" data-v="' + k + '" aria-label="' + lbl + ' ' + k + '">' + k + '</button>';
        return '<div class="rrow"><span>' + lbl + '</span><div class="seg num">' + o + '</div></div>';
      };
      html += '<div class="fcard' + (v[0] && v[1] ? ' done' : '') + '"><h3>' + esc(G.factors[f].name) + '</h3><p>' + esc(G.factors[f].text) + '</p>' + row(0, 'Влияние') + row(1, 'Неопределённость') + '</div>';
    });
    html += '<button class="btn primary wide" data-act="sendRates"' + (done < FK.length || ui.busy ? ' disabled' : '') + '>' + (done < FK.length ? 'Оценено ' + done + ' из ' + FK.length : 'Отправить оценки') + '</button></section>';
    return html;
  }

  function viewTeamsPlayer(p) {
    var html = '<section class="pad">';
    if (S.teamMode === 'host') {
      if (p.team == null) return html + '<div class="pulse"></div><h1 class="h2 center">Ведущий распределяет команды</h1><p class="muted center">Подождите немного — вы увидите свою команду здесь.</p></section>';
      html += teamIntro(p.team);
    } else {
      html += '<h1 class="h2">Выберите команду</h1><p class="muted">В команде до ' + S.teamSize + ' человек. Миры будущего раздадут командам случайно.</p><div class="teamgrid">';
      S.teams.forEach(function (t) {
        var m = members(t.id), mine = p.team === t.id, full = m.length >= S.teamSize && !mine;
        html += '<button class="teamtile' + (mine ? ' mine' : '') + '" style="' + teamStyle(t.id) + '" data-act="pickTeam" data-team="' + t.id + '"' + (full || ui.busy ? ' disabled' : '') + '>' +
          '<span class="tl">' + tNo(t.id) + '</span><span class="tc">' + m.length + '/' + S.teamSize + '</span>' +
          '<span class="tm">' + (m.length ? m.map(function (x) { return esc(x.name); }).join(', ') : 'Пока пусто') + '</span>' +
          (mine ? '<span class="tmark">Ваша команда</span>' : full ? '<span class="tmark">Мест нет</span>' : '') + '</button>';
      });
      html += '</div>' + (p.team != null ? '<button class="link" data-act="pickTeam" data-team="">Выйти из команды</button>' : '');
    }
    if (p.team != null) html += captainVote(p.team);
    return html + '</section>';
  }

  function captainVote(ti) {
    var t = S.teams[ti], ms = members(ti), myVote = t.votes && t.votes[pid];
    var tally = t.tally || {};
    var html = '<div class="capvote" style="' + teamStyle(ti) + '"><h2 class="h3">Выберите капитана команды</h2>' +
      '<p class="muted small">Капитан один вводит ответы, ставит проекты на карту и делает ставки за всю команду. Остальные помогают советом. Голосуйте за любого, можно за себя.</p><ul class="voters">';
    ms.forEach(function (m) {
      var n = tally[m.id] || 0, lead = t.leader === m.id;
      html += '<li class="' + (lead ? 'leader' : '') + '"><span class="vname">' + (lead ? '<span class="crown" aria-hidden="true"></span>' : '') + esc(m.name) + (m.id === pid ? ' <span class="muted small">(вы)</span>' : '') + '</span>' +
        '<span class="vcount" aria-label="Голосов: ' + n + '">' + '<i></i>'.repeat(n) + '</span>' +
        '<button class="btn small' + (myVote === m.id ? ' primary' : '') + '" data-act="vote" data-pid="' + m.id + '"' + (ui.busy ? ' disabled' : '') + '>' + (myVote === m.id ? 'Ваш голос' : 'Голосовать') + '</button></li>';
    });
    html += '</ul><p class="small muted">Сейчас лидирует: <b>' + esc(captainName(ti)) + '</b>. Капитан закрепится, когда ведущий перейдёт к мирам.</p></div>';
    return html;
  }

  function teamIntro(ti) {
    var m = members(ti);
    return '<div class="teamintro" style="' + teamStyle(ti) + '"><span class="tl">' + tNo(ti) + '</span><div><h1 class="h2">Ваша ' + tLabel(ti).toLowerCase() + '</h1><p>' + m.map(function (x) { return esc(x.name); }).join(', ') + '</p></div></div>';
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

  function viewWorldPlayer(t) {
    return '<section class="pad">' + worldCard(t.world, { kicker: tLabel(t.id) + ' получила мир' }) +
      '<h2 class="h3">Задание команды</h2><p class="muted">Представьте, что этот мир наступил. Что он значит для города? Пишите коротко и по делу.</p>' + captainBanner(t) +
      field(t, 'title', 'Своё название мира', 'Например, «Город инженеров» или «Тихая гавань»', 1) +
      field(t, 'residents', 'Что изменится для жителей', '', 3) +
      field(t, 'business', 'Что изменится для бизнеса', '', 3) +
      field(t, 'government', 'Что изменится для городской власти', '', 3) +
      field(t, 'signposts', 'Ранние признаки', 'По каким новостям в 2027–2030 годах мы поймём, что движемся именно в этот мир?', 3) +
      '</section>';
  }

  // ---------- рассказ команд о своих мирах ----------
  var PITCH_Q = [
    ['title', 'Как вы назвали свой мир'],
    ['residents', 'Жители'],
    ['business', 'Бизнес'],
    ['government', 'Городская власть'],
    ['signposts', 'Ранние признаки'],
  ];
  function pitchTeams() { return S.teams.filter(function (t) { return t.world && members(t.id).length; }).map(function (t) { return t.id; }); }
  function pitchCur() { var ids = pitchTeams(); var c = S.pitchTeam; return ids.indexOf(c) >= 0 ? c : (ids.length ? ids[0] : null); }

  function viewPitchPlayer(t) {
    var cur = pitchCur();
    if (cur === t.id) {
      return '<section class="pad"><div class="pitchme" style="' + teamStyle(t.id) + '"><span class="mic" aria-hidden="true"></span><div><p class="small">Сейчас ваша очередь</p><h1 class="h2">Расскажите о своём мире</h1></div></div>' +
        '<ol class="pitchplan"><li><b>Что за мир.</b> Название и суть в одной фразе: что случилось с комбинатом и с вниманием государства.</li><li><b>Последствия.</b> Что изменится для жителей, бизнеса и власти.</li><li><b>Ранние признаки.</b> По каким новостям мы поймём, что движемся в этот мир.</li></ol>' +
        '<p class="muted small">Около 1,5 минуты. Ваши ответы уже на экране — это подсказка, не читайте их дословно.</p>' + pitchAnswers(t.id) + '</section>';
    }
    if (cur == null) return '<section class="pad center"><div class="pulse"></div><h1 class="h2">Скоро начнём</h1></section>';
    var w = S.teams[cur].world;
    return '<section class="pad">' + worldCard(w, { kicker: 'Рассказывает ' + tLabel(cur).toLowerCase(), short: true }) +
      '<p class="muted">Слушайте и сравнивайте со своим миром. Что в нём общего с вашим? Какой проект пригодился бы и там, и у вас?</p>' + pitchAnswers(cur) +
      (cur !== t.id ? '<p class="small muted center">' + (S.pitched && S.pitched.indexOf(t.id) >= 0 ? 'Ваша команда уже выступила.' : 'Ваша команда выступит позже — ведущий скажет, когда.') + '</p>' : '') + '</section>';
  }

  function pitchAnswers(ti) {
    var t = S.teams[ti];
    return '<dl class="pitchans" style="' + teamStyle(ti) + '">' + PITCH_Q.map(function (q) {
      return '<div><dt>' + q[1] + '</dt><dd>' + (t[q[0]] ? esc(t[q[0]]) : '<span class="muted">—</span>') + '</dd></div>';
    }).join('') + '</dl>';
  }

  function effectHtml(r) {
    if (!r) return '';
    return '<p class="effect ' + (r.v < 0 ? 'neg' : 'pos') + '"><b>' + signed(r.v) + '</b> ' + esc(r.text) + '</p>';
  }

  function viewMapPlayer(t) {
    var placed = Object.keys(t.placements || {});
    var limit = G.mapLimit;
    var full = placed.length >= limit;
    var pins = placed.map(function (p, i) { var r = eff(t.id, p); return { zone: t.placements[p], color: tColor(t.id), label: String(i + 1), bad: r && r.v < 0 }; });
    var pend = ui.pending && !t.submitted ? G.projects[ui.pending] : null;
    var busy = busyZones(t, ui.pending);
    var effSum = placed.reduce(function (a, p) { var r = eff(t.id, p); return a + (r ? r.v : 0); }, 0);
    var html = '<section class="pad">' +
      '<div class="maphead"><h1 class="h2">Город в мире «' + esc(tName(t.id)) + '»</h1><p class="muted">Выберите ' + limit + ' проектов, которые нужны городу в вашем мире, и поставьте их на карту. <b>Один район — одна постройка.</b> Место имеет значение: после отправки плана жители оценят, где вы строите, — штрафы и бонусы войдут в итог.</p></div>' +
      captainBanner(t) + mapBox({ pins: pins, pick: !!pend, busy: pend ? busy : null }, pend ? 'picking' : '');
    var cap = isCaptain(t);
    if (pend) {
      html += '<div class="pickbar" role="status"><p>Куда поставить «' + esc(pend.name) + '»? Нажмите на свободный район на карте или выберите здесь. Тёмные районы уже заняты.</p><div class="zonechips">' +
        Object.keys(G.zones).map(function (z) { return '<button class="chip zbtn' + (busy[z] ? ' busy' : '') + '" data-act="placeZone" data-zone="' + z + '"' + (ui.busy || busy[z] ? ' disabled' : '') + ' title="' + (busy[z] ? 'Занято: ' + esc(G.projects[busy[z]].name) : '') + '">' + esc(G.zones[z].name) + (busy[z] ? ' · занят' : '') + '</button>'; }).join('') +
        '</div><button class="link" data-act="cancelPick">Отмена</button></div>';
    }
    html += '<div class="counter"><b>' + placed.length + '</b> из ' + limit + ' проектов' + (effSum ? ' · последствия размещения: <b class="' + (effSum < 0 ? 'neg' : 'pos') + '">' + signed(effSum) + '</b>' : '') + (t.submitted ? ' · план отправлен' : '') + '</div>';
    if (placed.length) {
      html += '<ol class="placed">' + placed.map(function (p, i) {
        var r = eff(t.id, p);
        return '<li class="' + (r ? (r.v < 0 ? 'neg' : 'pos') : '') + '"><span class="num" style="--c:' + tColor(t.id) + '">' + (i + 1) + '</span><div class="pbody"><b>' + esc(G.projects[p].name) + '</b><span class="muted small">' + esc(G.zones[t.placements[p]].name) + '</span>' + effectHtml(r) + '</div>' +
          (t.submitted || !cap ? '' : '<span class="acts"><button class="link" data-act="pick" data-project="' + p + '">Переставить</button><button class="link" data-act="unplace" data-project="' + p + '">Убрать</button></span>') + '</li>';
      }).join('') + '</ol>';
    }
    if (t.submitted) {
      html += '<div class="notice ok">План отправил(а) ' + esc(t.submittedBy) + '. Ждите следующего этапа.</div>';
    } else {
      html += '<h2 class="h3">Библиотека проектов</h2><ul class="projects">' + Object.keys(G.projects).map(function (p) {
        var pr = G.projects[p], on = !!t.placements[p];
        return '<li class="proj' + (on ? ' on' : '') + (ui.pending === p ? ' sel' : '') + '"><div><span class="tag">' + esc(pr.tag) + '</span><h3>' + esc(pr.name) + '</h3><p>' + esc(pr.text) + '</p></div>' +
          (on ? '<span class="state">На карте</span>' : cap ? '<button class="btn small" data-act="pick" data-project="' + p + '"' + (full || ui.busy ? ' disabled' : '') + '>' + (full ? 'Лимит ' + limit : 'Поставить') + '</button>' : '') + '</li>';
      }).join('') + '</ul>';
      html += field(t, 'rationale', 'Почему именно эти проекты?', 'Одно-два предложения: как они помогают городу в вашем мире', 3);
      if (cap) html += '<button class="btn primary wide" data-act="submitMap"' + (placed.length === 0 || ui.busy ? ' disabled' : '') + '>Отправить план команды</button><p class="hint center">После отправки план нельзя менять — договоритесь в команде.</p>';
    }
    return html + '</section>';
  }

  // районы, где у команды уже стоит другой проект
  function busyZones(t, except) {
    var b = {};
    Object.keys(t.placements || {}).forEach(function (p) { if (p !== except) b[t.placements[p]] = p; });
    return b;
  }

  function isCons(p) {
    if (S.consensus) return S.consensus.indexOf(p) >= 0;
    var n = 0; S.teams.forEach(function (t) { if (t.placements && t.placements[p]) n++; });
    return n >= G.consensusMin;
  }
  function consBadge() { return '<em class="consb" title="Поддержка горожан: +' + G.consensusBonus + ' к результату во всех мирах">+' + G.consensusBonus + ' во всех мирах</em>'; }

  function overlayList(limit) {
    var data = overlayData().filter(function (x) { return x.teams.length > 0; });
    if (limit) data = data.slice(0, limit);
    if (!data.length) return '<p class="muted">Команды пока не поставили проекты на карту.</p>';
    return '<ol class="overlay">' + data.map(function (x) {
      var robust = x.teams.length >= G.consensusMin;
      return '<li class="' + (robust ? 'robust' : '') + '"><span class="ovn">' + x.teams.length + '</span><span class="ovt">' + esc(G.projects[x.project].name) + (robust ? '<em>кандидат в устойчивые · +' + G.consensusBonus + ' во всех мирах</em>' : '') + '</span>' + dots(x.teams) + '</li>';
    }).join('') + '</ol>';
  }

  function viewOverlayPlayer(t) {
    return '<section class="pad"><h1 class="h2">Пять карт наложены</h1><p class="muted">Каждая метка — проект одной из команд. Проекты, которые выбрали ' + G.consensusMin + ' команды и больше, нужны сразу в нескольких мирах — это кандидаты в устойчивые решения.</p>' +
      consRule() + mapBox({ pins: allPins() }) + overlayList() + '</section>';
  }

  function consRule() {
    return '<div class="consrule"><b>Это влияет на очки.</b> Кандидаты в устойчивые получают поддержку горожан: <b>+' + G.consensusBonus + ' к результату во всех пяти мирах</b>, в том числе в худшем. Кто купит такой проект на аукционе, получит этот бонус. Ждите за них торга.</div>';
  }

  function committed(t, except) {
    return (S.auction.open || []).reduce(function (a, lot) { if (lot.project === except) return a; var b = lot.bids[t.id]; return a + (b && b.amount ? b.amount : 0); }, 0);
  }

  function viewAuctionPlayer(t) {
    var open = S.auction.open || [];
    var sold = S.auction.results;
    var mine = sold.filter(function (r) { return r.team === t.id; });
    var cap = isCaptain(t);
    var free = t.budget - committed(t);
    var html = '<section class="pad"><div class="budget" style="' + teamStyle(t.id) + '"><span>Бюджет</span><b>' + t.budget + '</b><span>' + plural(t.budget, 'монета', 'монеты', 'монет') + (open.length ? ' · свободно ' + free : '') + '</span></div>' + captainBanner(t);
    if (open.length) {
      html += '<p class="muted small">Открыто лотов: ' + open.length + '. Ставки закрытые. Сумма ставок по всем открытым лотам не может быть больше бюджета.</p>';
      open.forEach(function (lot) {
        var pr = G.projects[lot.project];
        var ov = overlayData().filter(function (x) { return x.project === lot.project; })[0];
        var isOpen = now() < lot.endsAt + 1500;
        var b = lot.bids[t.id];
        if (ui.bids[lot.project] == null) ui.bids[lot.project] = b && b.amount ? b.amount : 10;
        var v = Math.max(0, Math.min(t.budget, ui.bids[lot.project]));
        var myZone = t.placements[lot.project];
        html += '<article class="lot"><div class="lothead"><div><span class="tag">' + esc(pr.tag) + '</span><h2 class="h2">' + esc(pr.name) + '</h2></div>' + countdownHtml(lot, false) + '</div><p>' + esc(pr.text) + '</p>' +
          (isCons(lot.project) ? '<p class="consline">' + consBadge() + ' кандидат в устойчивые</p>' : '') + '<p class="small muted">На картах выбрали: ' + dots(ov ? ov.teams : []) + (myZone ? ' · у вас — ' + esc(G.zones[myZone].name) : '') + '</p>' + effectHtml(myZone ? eff(t.id, lot.project) : null);
        if (isOpen && cap) {
          html += '<div class="bidrow"><div class="stepper">' +
            '<button class="btn round" data-act="bidStep" data-project="' + lot.project + '" data-d="-5" aria-label="Минус 5">−5</button><output class="bidval">' + v + '</output>' +
            '<button class="btn round" data-act="bidStep" data-project="' + lot.project + '" data-d="5" aria-label="Плюс 5">+5</button><button class="btn round" data-act="bidStep" data-project="' + lot.project + '" data-d="25" aria-label="Плюс 25">+25</button></div>' +
            '<div class="bidacts"><button class="btn primary" data-act="bid" data-project="' + lot.project + '"' + (v < 5 || ui.busy ? ' disabled' : '') + '>Поставить ' + v + '</button><button class="btn" data-act="pass" data-project="' + lot.project + '"' + (ui.busy ? ' disabled' : '') + '>Пас</button></div></div>';
        }
        html += '<p class="meta">' + (b ? (b.pass ? 'Команда пасует' : 'Ставка команды: <b>' + b.amount + '</b>') + (cap ? '. Можно изменить до конца времени.' : '') : isOpen ? (cap ? 'Ставки закрытые: побеждает самая высокая.' : 'Капитан ещё не сделал ставку.') : 'Время вышло, подводим итог…') + '</p>' +
          '<div class="others">' + S.teams.map(function (tt) { var bb = lot.bids[tt.id]; return '<span class="ob' + (bb ? ' made' : '') + '" style="' + teamStyle(tt.id) + '">' + tNo(tt.id) + (bb ? ' ✓' : '') + '</span>'; }).join('') + '</div></article>';
      });
    } else {
      var last = sold.slice(-3).reverse();
      html += '<div class="notice">' + (last.length ? last.map(resultText).join('<br>') + '<br>' : '') + 'Ждём следующие лоты.</div>';
    }
    html += '<h2 class="h3">Куплено командой</h2>' + (mine.length ? '<ul class="bought">' + mine.map(function (r) { return '<li>' + esc(G.projects[r.project].name) + '<span>' + r.price + '</span></li>'; }).join('') + '</ul>' : '<p class="muted">Пока ничего. Неиспользованные монеты в конце сгорают — как бюджет в конце года.</p>');
    return html + '</section>';
  }

  function viewRevealPlayer(t) {
    if (!S.reveal) return '<section class="pad center"><div class="pulse"></div><h1 class="h2">Торги окончены</h1><p class="muted">Сейчас ведущий раскрутит колесо судьбы и узнаем, какой мир наступил.</p></section>';
    var st = spinState();
    var html = '<section class="pad center">' + wheelHtml(260);
    if (!st.done) return html + '<p class="h3">Какой мир наступит?</p></section>';
    var sc = S.score.teams[t.id];
    html += worldCard(S.reveal.world, { short: true, kicker: 'Наступил мир' + (S.reveal.world === t.world ? ' — ваш!' : '') }) + '</section>';
    html += '<section class="pad">' + scoreBlock(t, sc, false) + '</section>';
    return html;
  }

  function scoreBlock(t, sc, withShock) {
    var wi = W.indexOf(S.reveal.world);
    var total = withShock ? sc.actual : sc.base;
    var html = '<div class="score" style="' + teamStyle(t.id) + '"><span>Результат: ' + tLabel(t.id).toLowerCase() + '</span><b>' + signed(total) + '</b></div>';
    if (!sc.projects.length) return html + '<p class="muted">Команда ничего не купила на аукционе.</p>';
    html += '<ul class="bought score-list">' + sc.projects.map(function (pp) {
      var base = S.payoff[pp.project][wi], v = withShock ? pp.value : base + pp.place + (pp.cons || 0);
      var r = pp.place ? { v: pp.place, text: pp.placeText } : null;
      return '<li><div><b>' + esc(G.projects[pp.project].name) + '</b><span class="small muted">в этом мире ' + signed(base) + (pp.place ? ' · место ' + signed(pp.place) : '') + (pp.cons ? ' · поддержка горожан ' + signed(pp.cons) : '') + (withShock && pp.shock ? ' · шоки ' + signed(pp.shock) : '') + '</span>' +
        (r && r.v < 0 ? '<span class="small neg">' + esc(r.text) + '</span>' : '') + '</div><span class="' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '') + '">' + signed(v) + '</span></li>';
    }).join('') + '</ul>';
    return html;
  }

  // ---------- шоки: кубик и карты ----------
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

  function shockIcon(kind) {
    var svg = {
      flood: '<path class="sw1" d="M8,62 Q22,52 36,62 T64,62 T92,62 T120,62 L120,96 L8,96Z"/><path class="sw2" d="M8,72 Q22,62 36,72 T64,72 T92,72 T120,72 L120,96 L8,96Z"/><rect x="40" y="26" width="26" height="30" class="sh"/><path d="M36,28 L53,14 L70,28Z" class="sr"/><rect x="78" y="36" width="20" height="20" class="sh"/>',
      grant: '<circle cx="64" cy="54" r="28" class="sc"/><text x="64" y="66" text-anchor="middle" class="st">₽</text><circle cx="28" cy="80" r="10" class="sc f1"/><circle cx="100" cy="30" r="8" class="sc f2"/>',
      remote: '<rect x="22" y="26" width="84" height="52" rx="6" class="sh"/><rect x="30" y="34" width="68" height="36" class="ss"/><rect x="14" y="80" width="100" height="8" rx="4" class="sr"/><path class="sig" d="M58,52 a8,8 0 0 1 12,0 M52,46 a16,16 0 0 1 24,0"/>',
      steel: '<path d="M24,70 L44,44 L104,44 L84,70Z" class="sr"/><path d="M24,70 L84,70 L84,80 L24,80Z" class="sh"/><line x1="18" y1="22" x2="110" y2="96" class="sx"/><line x1="110" y1="22" x2="18" y2="96" class="sx"/>',
      demo: '<rect x="18" y="30" width="16" height="56" class="bar1"/><rect x="42" y="42" width="16" height="44" class="bar2"/><rect x="66" y="56" width="16" height="30" class="bar3"/><rect x="90" y="70" width="16" height="16" class="bar4"/><path d="M16,24 L108,64" class="trend"/>',
    }[kind] || '';
    return '<svg class="shicon ' + kind + '" viewBox="0 0 128 100" aria-hidden="true">' + svg + '</svg>';
  }

  function shockCards(big) {
    if (!S.dice) return '';
    var n = S.dice.value, out = '<div class="shockcards n' + n + '">';
    for (var i = 0; i < n; i++) {
      var k = S.shocks[i];
      if (k) {
        var sh = G.shocks[k], fresh = i === S.shocks.length - 1 && now() - (S.shockAt || 0) < 1500;
        out += '<article class="shock card' + (big ? ' big' : '') + (fresh ? ' fresh' : '') + '"><span class="shk">Шок ' + (i + 1) + ' из ' + n + '</span>' + shockIcon(sh.icon) + '<h2 class="' + (big ? 'title' : 'h2') + '">' + esc(sh.name) + '</h2><p class="' + (big ? 'lead' : '') + '">' + esc(sh.text) + '</p></article>';
      } else {
        out += '<article class="shock card back' + (big ? ' big' : '') + '"><span class="q">?</span><p>Шок ' + (i + 1) + ' ещё не вытянут</p></article>';
      }
    }
    return out + '</div>';
  }

  function shockStage(big) {
    if (!S.dice) return '<div class="center"><h1 class="' + (big ? 'title xl' : 'h2') + '">Сколько шоков ждёт город?</h1><p class="' + (big ? 'lead' : 'muted') + '">Ведущий бросит кубик: выпадет 1 или 2.</p>' + diceHtml(big ? 180 : 110) + '</div>';
    if (!diceDone()) return '<div class="center"><h1 class="' + (big ? 'title xl' : 'h2') + '">Бросаем кубик…</h1>' + diceHtml(big ? 180 : 110) + '</div>';
    return '<div class="dicehead">' + diceHtml(big ? 90 : 56) + '<h1 class="' + (big ? 'title' : 'h2') + '">' + (S.dice.value === 1 ? 'Городу выпал один шок' : 'Городу выпало два шока') + '</h1></div>' + shockCards(big);
  }

  function viewShockPlayer(t) {
    var html = '<section class="pad">' + shockStage(false);
    if (S.score && S.shocks.length && diceDone()) html += scoreBlock(t, S.score.teams[t.id], true) + captainBanner(t) +
      field(t, 'shockAnswer', 'Как вы скорректируете стратегию?', 'Что бы вы купили или не купили, зная про эти события? Был ли среди ваших «ранних признаков» намёк на них?', 4);
    return html + '</section>';
  }

  function ranking() {
    var pts = S.points.teams.slice().sort(function (a, b) { return a.place - b.place; });
    var withProj = S.score.teams.filter(function (x) { return x.projects.length > 0; });
    var robust = (withProj.length ? withProj : S.score.teams).slice().sort(function (a, b) { return b.min - a.min || b.avg - a.avg; })[0];
    var best = S.score.teams.slice().sort(function (a, b) { return b.actual - a.actual || b.min - a.min; })[0];
    return { arr: pts, robust: robust, best: best };
  }

  function pointsFormula(tp) {
    return '50 ' + (tp.actual >= 0 ? '+ ' : '− ') + Math.abs(10 * tp.actual) + ' ' + (tp.min >= 0 ? '+ ' : '− ') + Math.abs(10 * tp.min) + (50 + 10 * tp.actual + 10 * tp.min < 10 ? ' → минимум 10' : '');
  }

  function viewResultsPlayer(t) {
    if (!S.score || !S.points) return '<section class="pad center"><h1 class="h2">Итоги считаются…</h1></section>';
    var tp = S.points.teams[t.id], sc = S.score.teams[t.id], rk = ranking();
    var html = '<section class="pad"><div class="placecard" style="' + teamStyle(t.id) + '"><span class="pl">' + tp.place + '</span><div><p class="small">место из ' + S.teams.length + '</p><h1 class="h2">' + (tp.place === 1 ? 'Ваша команда победила!' : tLabel(t.id)) + '</h1><p><b>' + tp.points + '</b> ' + plural(tp.points, 'балл', 'балла', 'баллов') + ' за игру</p></div></div>' +
      '<div class="formula"><p class="lbl">Как посчитаны баллы</p><div class="frow"><span>За участие</span><b>50</b></div>' +
      '<div class="frow"><span>10 × результат в наступившем мире (' + signed(sc.actual) + ')</span><b>' + signed(10 * sc.actual) + '</b></div>' +
      '<div class="frow"><span>10 × результат в худшем из миров (' + signed(sc.min) + ')</span><b>' + signed(10 * sc.min) + '</b></div>' +
      '<div class="frow total"><span>Итого</span><b>' + tp.points + '</b></div></div>' +
      (rk.robust.team === t.id ? '<div class="notice ok">У вашей команды самая устойчивая стратегия: лучший результат даже в худшем мире.</div>' : '') +
      '<p class="muted">Каждый игрок команды получает эти баллы лично. Дальше — финальная ставка: ими можно рискнуть.</p>' +
      '<h2 class="h3">Ваши проекты во всех мирах</h2>' + worldsTable(sc.projects) + '</section>';
    return html;
  }

  function worldsTable(projects) {
    if (!projects.length) return '<p class="muted">Нет купленных проектов.</p>';
    var html = '<div class="tablewrap"><table class="wt"><thead><tr><th>Проект</th>' + W.map(function (w) { return '<th style="' + worldStyle(w) + '"><span class="wdot">' + w + '</span></th>'; }).join('') + '</tr></thead><tbody>';
    var sums = W.map(function () { return 0; });
    projects.forEach(function (pp) {
      html += '<tr><td>' + esc(G.projects[pp.project].name) + (pp.place ? ' <span class="small ' + (pp.place < 0 ? 'neg' : 'pos') + '">место ' + signed(pp.place) + '</span>' : '') + (pp.cons ? ' <span class="small pos">поддержка ' + signed(pp.cons) + '</span>' : '') + '</td>' + W.map(function (w, i) { var v = S.payoff[pp.project][i] + pp.place + (pp.cons || 0); sums[i] += v; return '<td class="' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '') + (w === S.reveal.world ? ' cur' : '') + '">' + signed(v) + '</td>'; }).join('') + '</tr>';
    });
    html += '<tr class="sum"><td>Итого</td>' + sums.map(function (v, i) { return '<td class="' + (W[i] === S.reveal.world ? 'cur' : '') + '">' + signed(v) + '</td>'; }).join('') + '</tr></tbody></table></div>';
    return html;
  }

  // =====================================================================
  //                         ЭКРАН ПРОЕКТОРА
  // =====================================================================
  function joinUrl() {
    var u = location.origin + location.pathname;
    if (qs.get('api')) u += '?api=' + encodeURIComponent(qs.get('api'));
    return u;
  }

  function qrSvg(text) {
    try { var q = window.qrcode(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } catch (e) { return ''; }
  }

  function viewScreen() {
    var ph = S.phase, body = '';
    if (ph === 'intro') return screenIntro();
    if (ph === 'lobby') body = screenLobby();
    else if (ph === 'signals') body = screenSignals();
    else if (ph === 'factors') body = screenFactors();
    else if (ph === 'teams') body = screenTeams();
    else if (ph === 'world') body = screenMatrix();
    else if (ph === 'pitch') body = screenPitch();
    else if (ph === 'map') body = screenMap();
    else if (ph === 'overlay') body = screenOverlay();
    else if (ph === 'auction') body = screenAuction();
    else if (ph === 'reveal') body = screenReveal();
    else if (ph === 'shock') body = screenShock();
    else if (ph === 'bet') body = screenBet();
    else if (ph === 'final') body = screenFinal();
    else body = screenResults();
    return '<div class="screen"><header class="sbar"><span class="logo">Город в 5 мирах · ' + G.city + '</span>' + route(ph) + '</header><main class="sbody">' + body + '</main></div>';
  }

  function screenIntro() {
    var step = S.introStep || 0, sl = G.intro[step];
    var body;
    if (sl.layout === 'rules') {
      body = '<div class="ipanel rules"><p class="istep">' + (step + 1) + ' / ' + G.intro.length + '</p><h1 class="title xl">' + esc(sl.title) + '</h1><p class="lead">' + esc(sl.text) + '</p>' +
        '<ol class="rulelist" style="--rows:' + Math.ceil(sl.steps.length / 2) + '">' + sl.steps.map(function (x) { return '<li><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></li>'; }).join('') + '</ol></div>';
    } else {
      body = '<div class="ipanel"><p class="istep">' + (step + 1) + ' / ' + G.intro.length + '</p><h1 class="title xl">' + esc(sl.title) + '</h1><p class="lead">' + esc(sl.text) + '</p>' +
        '<ul class="ipoints">' + sl.points.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' + (sl.source ? '<p class="isource">' + esc(sl.source) + '</p>' : '') + '</div>';
    }
    return '<div class="sintro' + (sl.layout === 'rules' ? ' is-rules' : '') + '"><canvas class="swarm" data-step="' + (sl.swarm || 0) + '" aria-hidden="true"></canvas>' + body +
      '<p class="ibrand">Город в 5 мирах · форсайт-сессия</p></div>';
  }

  function screenLobby() {
    var ps = players();
    return '<div class="slobby"><div class="sjoin"><h1 class="title xl">Город в&nbsp;5&nbsp;мирах</h1><p class="lead">Отсканируйте код, введите имя — и ждите старта.</p>' +
      '<div class="qr">' + qrSvg(joinUrl()) + '</div><p class="url">' + esc(joinUrl().replace(/^https?:\/\//, '')) + '</p></div>' +
      '<div class="snames"><p class="count"><b>' + ps.length + '</b> ' + plural(ps.length, 'участник', 'участника', 'участников') + '</p><div class="names">' +
      ps.map(function (p) { return '<span class="nm">' + esc(p.name) + '</span>'; }).join('') + '</div></div></div>';
  }

  function screenSignals() {
    var sig = S.signals || [];
    return '<div class="ssig"><div class="shead"><h1 class="h2">Сигналы будущего</h1><p class="count"><b>' + sig.length + '</b> ' + plural(sig.length, 'сигнал', 'сигнала', 'сигналов') + '</p></div><div class="sigcols">' +
      G.signalOrder.map(function (k) {
        var list = sig.filter(function (x) { return x.type === k; });
        return '<div class="sigcol ' + k + '"><h2>' + esc(G.signalTypes[k].name) + '<small>' + esc(G.signalTypes[k].hint) + '</small></h2><ul>' +
          list.slice(-9).reverse().map(function (x) { return '<li>' + esc(x.text) + '<span>' + esc(x.name) + '</span></li>'; }).join('') +
          (list.length > 9 ? '<li class="more">и ещё ' + (list.length - 9) + '</li>' : '') + '</ul></div>';
      }).join('') + '</div></div>';
  }

  function screenFactors() {
    var st = factorStats();
    return '<div class="sfac"><div class="scbox dark">' + scatter(true) + '</div><div class="facside"><h1 class="h2">Какие силы определят будущее?</h1>' +
      '<p class="lead">Каждая точка — среднее по оценкам группы. Самые сильные и непредсказуемые факторы — в правом верхнем углу: из них строят сценарии.</p>' +
      '<p class="count"><b>' + st.n + '</b> ' + plural(st.n, 'участник оценил', 'участника оценили', 'участников оценили') + '</p>' +
      (S.axesShown ? '<div class="axnote"><b>Оси нашей матрицы:</b> «' + esc(G.factors[G.axisFactors[0]].name) + '» и «' + esc(G.factors[G.axisFactors[1]].name) + '». Совпало ли с вашим выбором?</div>' : '') + '</div></div>';
  }

  function screenTeams() {
    var free = players().filter(function (p) { return p.team == null; });
    return '<div class="steams">' + S.teams.map(function (t) {
      var m = members(t.id), tally = t.tally || {};
      return '<div class="scol" style="' + teamStyle(t.id) + '"><span class="tl">' + tNo(t.id) + '</span><p class="tc">' + m.length + ' / ' + S.teamSize + '</p><ul>' + m.map(function (x) {
        var lead = t.leader === x.id;
        return '<li class="' + (lead ? 'leader' : '') + '">' + (lead ? '<span class="crown" aria-hidden="true"></span>' : '') + esc(x.name) + (tally[x.id] ? '<span class="vc">' + tally[x.id] + '</span>' : '') + '</li>';
      }).join('') + '</ul></div>';
    }).join('') + '</div>' + (free.length ? '<p class="sfree">Без команды: ' + free.map(function (p) { return esc(p.name); }).join(', ') + '</p>' : '') +
      '<p class="shint">' + (S.teamMode === 'self' ? 'Выберите команду на телефоне, затем проголосуйте за капитана.' : 'Проголосуйте на телефоне за капитана команды.') + ' Корона — у лидера голосования.</p>';
  }

  function cell(wid) {
    var ti = teamOfWorld(wid);
    var w = world(wid);
    var t = ti == null ? {} : S.teams[ti];
    var line = function (lbl, v) { return v ? '<p><b>' + lbl + '</b> ' + esc(cut(v, 110)) + '</p>' : ''; };
    return '<div class="mcell" style="' + worldStyle(wid) + '"><div class="mhead"><span class="tl">' + wid + '</span><div><h3>' + esc(t.title || w.name) + '</h3><p class="small">' + (t.title ? esc(w.name) + ' · ' : '') + (ti != null ? tLabel(ti) : '') + '</p></div></div>' +
      line('Жители:', t.residents) + line('Бизнес:', t.business) + line('Власть:', t.government) + line('Признаки:', t.signposts) +
      (!t.residents && !t.business && !t.government ? '<p class="muted">Команда думает…</p>' : '') + '</div>';
  }

  function screenMatrix() {
    var ax = G.axes;
    return '<div class="matrix">' +
      '<div class="ax top">' + esc(ax.y.name) + ': ' + esc(ax.y.top) + '</div><div class="ax bottom">' + esc(ax.y.name) + ': ' + esc(ax.y.bottom) + '</div>' +
      '<div class="ax left">' + esc(ax.x.name) + ' ' + esc(ax.x.left) + '</div><div class="ax right">' + esc(ax.x.name) + ' ' + esc(ax.x.right) + '</div>' +
      '<div class="mgrid">' + cell('A') + cell('C') + cell('B') + cell('D') + '<div class="mcenter">' + cell('E') + '</div></div></div>';
  }

  function screenPitch() {
    var ids = pitchTeams(), cur = pitchCur();
    if (cur == null) return '<div class="spitch empty"><h1 class="title xl">Команды готовятся рассказать о своих мирах</h1></div>';
    var t = S.teams[cur], w = world(t.world), ms = members(cur), cap = captainId(cur);
    var block = function (lbl, v, big) { return '<div class="pblk' + (big ? ' big' : '') + '"><h3>' + lbl + '</h3><p>' + (v ? esc(v) : '<span class="muted">—</span>') + '</p></div>'; };
    return '<div class="spitch" style="' + worldStyle(t.world) + '">' +
      '<aside class="pworld"><span class="pletter">' + t.world + '</span><p class="pkick">' + tLabel(cur) + ' рассказывает о мире</p>' +
      '<h1 class="ptitle">' + esc(t.title || w.name) + '</h1>' + (t.title ? '<p class="porig">мир «' + esc(w.name) + '»</p>' : '') +
      '<p class="paxes">' + esc(w.axes) + '</p><p class="pstory">' + esc(w.story) + '</p>' +
      '<ul class="pteam">' + ms.map(function (m) { return '<li' + (m.id === cap ? ' class="leader"' : '') + '>' + (m.id === cap ? '<span class="crown" aria-hidden="true"></span>' : '') + esc(m.name) + '</li>'; }).join('') + '</ul></aside>' +
      '<section class="pbody">' + block('Что изменится для жителей', t.residents) + block('Для бизнеса', t.business) + block('Для городской власти', t.government) + block('Ранние признаки: как мы узнаем, что движемся сюда', t.signposts, true) +
      '<ol class="pqueue">' + ids.map(function (id) {
        var done = S.pitched && S.pitched.indexOf(id) >= 0 && id !== cur;
        return '<li class="' + (id === cur ? 'now' : done ? 'done' : '') + '" style="' + teamStyle(id) + '"><span class="tl s">' + S.teams[id].world + '</span>' + tLabel(id) + '</li>';
      }).join('') + '</ol></section></div>';
  }

  function hostPitch() {
    var ids = pitchTeams(), cur = pitchCur();
    var k = ids.indexOf(cur), nxt = k >= 0 && k < ids.length - 1 ? ids[k + 1] : null;
    return '<h2 class="h2">Рассказ команд</h2><p class="muted">Каждая команда за 1,5–2 минуты рассказывает суть своего мира и что она написала. На проекторе — мир и ответы выступающей команды. После всех выступлений спросите: что общего у миров? Это подводит к поиску устойчивых решений на карте.</p>' +
      '<div class="pitchhost">' + ids.map(function (id) {
        var done = S.pitched && S.pitched.indexOf(id) >= 0 && id !== cur;
        return '<button class="btn' + (id === cur ? ' primary' : '') + '" data-act="pitchTeam" data-team="' + id + '">' + chip(id) + ' ' + esc(tName(id)) + (id === cur ? ' · на экране' : done ? ' · выступила' : '') + '</button>';
      }).join('') + '</div>' +
      (nxt != null ? '<button class="btn primary pnext" data-act="pitchTeam" data-team="' + nxt + '">Следующая: ' + tLabel(nxt) + '</button>' : '<p class="notice ok">Это последняя команда. Дальше — карта города.</p>');
  }

  function screenMap() {
    return '<div class="ssplit">' + mapBox({ pins: allPins() }) + '<div class="sprog"><h2 class="h2">Команды строят город</h2>' + S.teams.map(function (t) {
      var n = Object.keys(t.placements || {}).length;
      return '<div class="prow" style="' + teamStyle(t.id) + '"><span class="tl s">' + tNo(t.id) + '</span><span class="pname">' + esc(tName(t.id)) + '</span><span class="pbar"><i style="width:' + (n / G.mapLimit * 100) + '%"></i></span><span class="pn">' + (t.submitted ? 'готово' : n + '/' + G.mapLimit) + '</span></div>';
    }).join('') + '<p class="small muted">Метка с восклицательным знаком — проект в неудачном месте: жители против.</p></div></div>';
  }

  function screenOverlay() {
    return '<div class="ssplit">' + mapBox({ pins: allPins() }) + '<div><h2 class="h2">Что совпало у команд</h2>' + consRule() + overlayList(10) + '</div></div>';
  }

  function screenAuction() {
    var open = S.auction.open || [], res = S.auction.results;
    var left;
    if (open.length) {
      left = '<div class="lotgrid n' + Math.min(open.length, 4) + '">' + open.map(function (lot) {
        var pr = G.projects[lot.project];
        var ov = overlayData().filter(function (x) { return x.project === lot.project; })[0];
        return '<div class="slot mini"><span class="tag">' + esc(pr.tag) + '</span><h2 class="stitle">' + esc(pr.name) + '</h2><p class="small">На картах: ' + dots(ov ? ov.teams : []) + '</p>' +
          '<div class="slotfoot">' + countdownHtml(lot, open.length <= 2) + '<div class="bidchips">' + S.teams.map(function (t) { var b = lot.bids[t.id]; return '<span class="ob' + (b ? ' made' : '') + '" style="' + teamStyle(t.id) + '">' + tNo(t.id) + (b ? ' ✓' : '') + '</span>'; }).join('') + '</div></div></div>';
      }).join('') + '</div>';
    } else if (res.length) {
      left = '<div class="slot"><h1 class="title">Итоги торгов</h1><ul class="lastres">' + res.slice(-6).reverse().map(function (r) {
        return '<li><span>' + esc(G.projects[r.project].name) + '</span>' + (r.team != null ? '<b style="' + teamStyle(r.team) + '" class="win">' + tLabel(r.team) + ' · ' + r.price + '</b>' : '<b class="none">не продан</b>') + '</li>';
      }).join('') + '</ul></div>';
    } else {
      left = '<div class="slot"><h1 class="title">Аукцион проектов</h1><p class="lead">У каждой команды ' + G.budget + ' монет. Ставки закрытые, побеждает самая высокая. Можно торговаться за несколько лотов сразу. Неиспользованные монеты в конце сгорают.</p></div>';
    }
    var right = '<div class="steamsbar">' + S.teams.map(function (t) {
      var won = res.filter(function (r) { return r.team === t.id; }).length;
      return '<div class="tbud" style="' + teamStyle(t.id) + '"><span class="tl s">' + tNo(t.id) + '</span><span class="tb">' + t.budget + '<small>' + plural(t.budget, 'монета', 'монеты', 'монет') + '</small></span><span class="small">' + won + ' ' + plural(won, 'проект', 'проекта', 'проектов') + '</span></div>';
    }).join('') + '</div>';
    return '<div class="sauction">' + left + right + '</div>';
  }

  function screenReveal() {
    if (!S.reveal) return '<div class="center sfull"><h1 class="title xl">Какой мир наступит?</h1><p class="lead">Сейчас раскрутим колесо судьбы.</p></div>';
    var st = spinState();
    if (!st.done) return '<div class="center sfull"><h1 class="title">Какой мир наступит?</h1>' + wheelHtml(440) + '</div>';
    var ti = teamOfWorld(S.reveal.world);
    return '<div class="ssplit"><div>' + worldCard(S.reveal.world, { kicker: 'Наступил мир' + (ti != null ? ' команды ' + tNo(ti) : '') }) + '</div><div>' + scoreboard(false) + '</div></div>';
  }

  function scoreboard(withShock) {
    var arr = S.score.teams.slice().sort(function (a, b) { return (withShock ? b.actual - a.actual : b.base - a.base); });
    return '<h2 class="h2">Результаты команд' + (withShock && S.shocks && S.shocks.length ? ' с учётом шоков' : '') + '</h2><ol class="board">' + arr.map(function (x) {
      var v = withShock ? x.actual : x.base;
      var d = withShock ? x.actual - x.base : 0;
      var bad = x.projects.filter(function (p) { return p.place < 0; }).length;
      return '<li style="' + teamStyle(x.team) + '"><span class="tl s">' + tNo(x.team) + '</span><span class="bn">' + esc(tName(x.team)) + '<small>' + (x.projects.map(function (p) { return esc(G.projects[p.project].name); }).join(', ') || 'ничего не купили') + (bad ? ' · штрафы за место: ' + bad : '') + '</small></span>' +
        (d ? '<span class="delta ' + (d < 0 ? 'neg' : 'pos') + '">' + signed(d) + '</span>' : '') + '<b>' + signed(v) + '</b></li>';
    }).join('') + '</ol>';
  }

  function screenShock() {
    var stage = shockStage(true);
    if (S.dice && diceDone() && S.shocks.length && S.score) return '<div class="sshock with-board"><div>' + stage + '</div><div class="shockboard">' + scoreboard(true) + '</div></div>';
    return '<div class="sshock">' + stage + '</div>';
  }

  function screenResults() {
    if (!S.score || !S.points) return '<div class="center sfull"><h1 class="title xl">Итоги</h1></div>';
    var rk = ranking(), top = rk.arr;
    var podium = [top[1], top[0], top[2]].filter(Boolean).map(function (tp) {
      var x = S.score.teams[tp.team];
      return '<div class="pod p' + tp.place + '" style="' + teamStyle(tp.team) + '"><span class="pteam">' + chip(tp.team, true) + '<b>' + esc(tName(tp.team)) + '</b></span><span class="ppts">' + tp.points + '<small>' + plural(tp.points, 'балл', 'балла', 'баллов') + '</small></span>' +
        '<span class="pblock"><em>' + tp.place + '</em></span><span class="psub">мир ' + signed(x.actual) + ' · худший ' + signed(x.min) + '</span></div>';
    }).join('');
    return '<div class="sres"><div class="reshead"><h1 class="title">Победитель — ' + tLabel(top[0].team) + '</h1>' +
      '<p class="lead">Баллы = 50 + 10 × результат в наступившем мире «' + esc(world(S.reveal.world).name) + '»' + (S.shocks && S.shocks.length ? ' с шоками' : '') + ' + 10 × результат в худшем из пяти миров. Выигрывает тот, кто и угадал, и подстраховался.</p></div>' +
      '<div class="podium">' + podium + '</div>' +
      '<div class="tablewrap"><table class="wt big"><thead><tr><th>Место</th><th>Команда</th><th>Наступивший мир</th><th>Худший мир</th><th>Расчёт</th><th>Баллы</th></tr></thead><tbody>' +
      top.map(function (tp) {
        return '<tr class="' + (tp.place === 1 ? 'win' : '') + '"><td class="pl">' + tp.place + '</td><td>' + chip(tp.team) + ' ' + esc(tName(tp.team)) + (rk.robust.team === tp.team ? ' <span class="badge">самая устойчивая</span>' : '') + (rk.best.team === tp.team ? ' <span class="badge alt">лучший в мире</span>' : '') + '</td>' +
          '<td class="' + (tp.actual > 0 ? 'pos' : tp.actual < 0 ? 'neg' : '') + '">' + signed(tp.actual) + '</td><td class="' + (tp.min > 0 ? 'pos' : tp.min < 0 ? 'neg' : '') + '">' + signed(tp.min) + '</td>' +
          '<td class="small">' + pointsFormula(tp) + '</td><td class="minc">' + tp.points + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }

  // =====================================================================
  //                               ВЕДУЩИЙ
  // =====================================================================
  // ---------- финальная ставка ----------
  function betOptions(q, mine, revealed, ans) {
    var L = ['А', 'Б', 'В', 'Г', 'Д'];
    return q.options.map(function (o, i) {
      var cls = revealed ? (i === ans.correct ? ' right' : (mine && mine.option === i ? ' wrong' : '')) : (ui.betOpt === i ? ' on' : '');
      return '<button class="betopt' + cls + '" data-act="betOpt" data-i="' + i + '"' + (revealed ? ' disabled' : '') + '><span class="bl">' + L[i] + '</span><span><b>' + esc(o[0]) + '</b><small>' + esc(o[1]) + '</small></span></button>';
    }).join('');
  }

  function betTable(q, ans) {
    var L = ['А', 'Б', 'В', 'Г', 'Д'];
    return '<div class="tablewrap"><table class="wt"><thead><tr><th>Вариант</th>' + W.map(function (w) { return '<th style="' + worldStyle(w) + '"><span class="wdot">' + w + '</span></th>'; }).join('') + '</tr></thead><tbody>' +
      q.options.map(function (o, i) {
        return '<tr class="' + (i === ans.correct ? 'win' : '') + '"><td>' + L[i] + '. ' + esc(o[0]) + '</td>' + ans.payoff[i].map(function (v) { return '<td class="' + (v > 0 ? 'pos' : v < 0 ? 'neg' : '') + '">' + signed(v) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  function viewBetPlayer(t) {
    var mp = myPoints();
    if (!S.bet || !mp) return '<section class="pad center"><div class="pulse"></div><h1 class="h2">Скоро финальная ставка</h1><p class="muted">Ведущий выбирает вопрос.</p></section>';
    var q = G.bets[S.bet.qid], mine = S.bets && S.bets[pid], revealed = S.bet.revealed, ans = S.betAnswer;
    var html = '<section class="pad"><div class="budget"><span>Ваши баллы</span><b>' + mp.base + '</b></div>' +
      '<h1 class="h2">' + esc(q.title) + '</h1><p class="muted small">Ровно один вариант даёт плюс во всех пяти мирах. Угадали — поставленные баллы удваиваются. Ошиблись — сгорают. Не ставите — баллы не меняются.</p>' +
      '<div class="betopts">' + betOptions(q, mine, revealed, ans) + '</div>';
    if (!revealed) {
      if (ui.betStake == null) ui.betStake = mine ? mine.stake : Math.min(mp.base, 10);
      if (ui.betOpt == null && mine) ui.betOpt = mine.option;
      var v = Math.max(0, Math.min(mp.base, ui.betStake));
      html += '<div class="bidbox"><p class="lbl">Сколько баллов ставите?</p><input type="range" class="range" min="0" max="' + mp.base + '" step="1" value="' + v + '" data-act-change="betStake" data-key="betStake" aria-label="Размер ставки">' +
        '<div class="stepper"><button class="btn round" data-act="betStep" data-d="-10">−10</button><output class="bidval">' + v + '</output><button class="btn round" data-act="betStep" data-d="10">+10</button><button class="btn round" data-act="betAll">Всё</button></div>' +
        '<div class="bidacts"><button class="btn primary" data-act="placeBet"' + (ui.betOpt == null || v < 1 || ui.busy ? ' disabled' : '') + '>Поставить ' + v + '</button><button class="btn" data-act="noBet"' + (ui.busy ? ' disabled' : '') + '>Не рисковать</button></div>' +
        '<p class="meta">' + (mine ? 'Ваша ставка: <b>' + mine.stake + '</b> на вариант ' + ['А', 'Б', 'В', 'Г', 'Д'][mine.option] + '. Можно изменить, пока ведущий не раскрыл ответ.' : 'Вы пока не сделали ставку.') + '</p></div>';
    } else {
      html += '<div class="betres ' + (!mine ? '' : mp.delta > 0 ? 'win' : 'lose') + '"><b>' + (!mine ? 'Вы не рисковали' : mp.delta > 0 ? 'Угадали! +' + mp.delta : 'Не угадали: ' + signed(mp.delta)) + '</b><span>Итого у вас: ' + mp.total + ' ' + plural(mp.total, 'балл', 'балла', 'баллов') + '</span></div>' +
        '<p>' + esc(q.explain) + '</p>' + betTable(q, ans);
    }
    return html + '</section>';
  }

  function screenBet() {
    if (!S.bet) return '<div class="center sfull"><h1 class="title xl">Финальная ставка</h1><p class="lead">Каждый может рискнуть своими баллами: угадал — баллы удваиваются, ошибся — сгорают.</p></div>';
    var q = G.bets[S.bet.qid], ans = S.betAnswer, revealed = S.bet.revealed;
    var total = Object.keys(S.points ? S.points.players : {}).length;
    var html = '<div class="sbet"><div class="bethead"><p class="istep">Финальная ставка</p><h1 class="title">' + esc(q.title) + '</h1>' +
      (revealed ? '<p class="lead">' + esc(q.explain) + '</p>' : '<p class="lead">Ровно один вариант даёт плюс во всех пяти мирах. Угадали — баллы ×2, ошиблись — сгорают.</p><p class="count"><b>' + (S.betCount != null ? S.betCount : Object.keys(S.bets || {}).length) + '</b> из ' + total + ' уже сделали ставку</p>') + '</div>';
    html += '<div class="betopts big">' + betOptions(q, null, revealed, ans) + '</div>';
    if (revealed) {
      var pl = S.points.players, won = 0, lost = 0, nw = 0, nl = 0;
      Object.keys(pl).forEach(function (k) { var d = pl[k].delta; if (d > 0) { won += d; nw++; } if (d < 0) { lost -= d; nl++; } });
      html += '<div class="betsum"><span class="pos">Угадали: ' + nw + ' · +' + won + '</span><span class="neg">Не угадали: ' + nl + ' · −' + lost + '</span></div>' + betTable(q, ans);
    }
    return html + '</div>';
  }

  function playerBoard(limit) {
    var pl = S.points ? S.points.players : {};
    var arr = Object.keys(pl).map(function (k) { return { pid: k, name: S.players[k] ? S.players[k].name : '?', team: pl[k].team, base: pl[k].base, delta: pl[k].delta, total: pl[k].total }; });
    arr.sort(function (a, b) { return b.total - a.total || a.name.localeCompare(b.name); });
    return arr.slice(0, limit || arr.length);
  }

  function viewFinalPlayer(t) {
    var mp = myPoints();
    if (!mp) return '<section class="pad center"><h1 class="h2">Спасибо за игру!</h1></section>';
    var board = playerBoard(), place = board.map(function (x) { return x.pid; }).indexOf(pid) + 1;
    return '<section class="pad"><div class="placecard" style="' + teamStyle(t.id) + '"><span class="pl">' + place + '</span><div><p class="small">место из ' + board.length + '</p><h1 class="h2">' + mp.total + ' ' + plural(mp.total, 'балл', 'балла', 'баллов') + '</h1><p class="small">за игру ' + mp.base + (mp.delta ? ' · ставка ' + signed(mp.delta) : '') + '</p></div></div>' +
      '<h2 class="h3">Лучшие игроки</h2><ol class="pboard">' + board.slice(0, 10).map(function (x, i) { return '<li class="' + (x.pid === pid ? 'me' : '') + '"><span class="n">' + (i + 1) + '</span>' + chip(x.team) + '<span class="nm">' + esc(x.name) + '</span><b>' + x.total + '</b></li>'; }).join('') + '</ol>' +
      '<p class="muted center">Спасибо за игру! Форсайт — это не про угадывание будущего, а про решения, которые сработают в любом из возможных миров.</p></section>';
  }

  function screenFinal() {
    if (!S.points) return '<div class="center sfull"><h1 class="title xl">Финал</h1></div>';
    var board = playerBoard(10), rk = ranking();
    return '<div class="sfinal"><div><h1 class="title">Лучшие игроки</h1><ol class="pboard big">' + board.map(function (x, i) {
      return '<li class="' + (i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : '') + '"><span class="n">' + (i + 1) + '</span>' + chip(x.team) + '<span class="nm">' + esc(x.name) + '</span><span class="small">' + x.base + (x.delta ? ' ' + signed(x.delta) : '') + '</span><b>' + x.total + '</b></li>';
    }).join('') + '</ol></div><div><h2 class="h2">Команды</h2><ol class="board">' + rk.arr.map(function (tp) {
      return '<li style="' + teamStyle(tp.team) + '"><span class="tl s">' + tp.place + '</span><span class="bn">' + tLabel(tp.team) + ' · ' + esc(tName(tp.team)) + '</span><b>' + tp.points + '</b></li>';
    }).join('') + '</ol><p class="lead">Спасибо за игру! Устойчивые решения выигрывают не потому, что угадали будущее, а потому, что готовы к любому.</p></div></div>';
  }

  function viewHost() {
    var ph = S.phase;
    var html = '<header class="bar host"><span class="logo">Пульт ведущего</span><span class="who"><a href="#screen" target="_blank" rel="noopener" class="link">Экран проектора</a> <a href="#curator" target="_blank" rel="noopener" class="link">Оценки</a></span></header>';
    if (S.schema !== 8) html += '<div class="notice bad"><b>Сервер устарел.</b> Сайт уже версии 8, а скрипт в Google Таблице — старый, поэтому часть кнопок не работает. Вставьте новый Code.gs и обязательно сделайте Развернуть → Управление развертываниями → ✏️ → Версия: новая → Развернуть.</div>';
    html += '<nav class="hphases">' + PHASES.map(function (p, i) {
      return '<button class="hph' + (p === ph ? ' now' : '') + '" data-act="phase" data-phase="' + p + '"><span>' + (i + 1) + '</span>' + PHASE_NAME[p] + '</button>';
    }).join('') + '</nav>';
    var i = PHASES.indexOf(ph);
    var nxt = PHASES[Math.min(PHASES.length - 1, i + 1)];
    html += '<div class="hnav"><button class="btn" data-act="phase" data-phase="' + PHASES[Math.max(0, i - 1)] + '"' + (i === 0 ? ' disabled' : '') + '>Назад</button><button class="btn primary" data-act="phase" data-phase="' + nxt + '"' + (i === PHASES.length - 1 ? ' disabled' : '') + '>Дальше: ' + PHASE_NAME[nxt] + '</button></div>';
    html += '<div class="hgrid"><div class="hmain">' + hostPanel(ph) + '</div><aside class="hside">' + hostPlayers() + '</aside></div>';
    html += '<details class="danger"><summary>Сброс игры</summary><p class="small">Начать заново: все ответы, ставки и оценки будут удалены.</p><button class="btn" data-act="reset" data-keep="1">Заново, игроков оставить</button> <button class="btn bad" data-act="reset" data-keep="0">Полный сброс</button></details>';
    return html;
  }

  function progressRow(ti, n, total, label, extra) {
    return '<div class="prow" style="' + teamStyle(ti) + '"><span class="tl s">' + tNo(ti) + '</span><span class="pname">' + esc(tName(ti)) + '</span><span class="pbar"><i style="width:' + (n / total * 100) + '%"></i></span><span class="pn">' + label + '</span>' + (extra || '') + '</div>';
  }

  function hostPanel(ph) {
    if (ph === 'intro') {
      var step = S.introStep || 0, sl = G.intro[step];
      var items = sl.layout === 'rules' ? sl.steps.map(function (x) { return x[0] + ': ' + x[1]; }) : sl.points;
      return '<h2 class="h2">Заставка: что такое форсайт</h2><p class="muted">Слайды идут на экране проектора поверх анимации. Ниже — подсказка, что рассказать.</p>' +
        '<div class="row">' + G.intro.map(function (x, k) { return '<button class="btn' + (k === step ? ' primary' : '') + '" data-act="intro" data-step="' + k + '">' + (k + 1) + '. ' + esc(x.title) + '</button>'; }).join('') + '</div>' +
        '<div class="notes"><h3 class="h3">' + esc(sl.title) + '</h3><p>' + esc(sl.text) + '</p><ul>' + items.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' + (sl.source ? '<p class="small muted">' + esc(sl.source) + '</p>' : '') + '</div>' +
        (step < G.intro.length - 1 ? '<button class="btn primary" data-act="intro" data-step="' + (step + 1) + '">Следующий слайд</button>' : '<button class="btn primary" data-act="phase" data-phase="lobby">К сбору участников</button>');
    }
    if (ph === 'lobby') return '<h2 class="h2">Сбор участников</h2><p>Покажите на проекторе экран с QR-кодом (ссылка «Экран проектора» вверху). Ссылка для игроков:</p><p class="url">' + esc(joinUrl()) + '</p><div class="qr small">' + qrSvg(joinUrl()) + '</div><p class="muted">Когда все зашли — переходите к сигналам.</p>';
    if (ph === 'signals') {
      var sig = S.signals || [];
      return '<h2 class="h2">Сигналы будущего · ' + sig.length + '</h2><p class="muted">Каждый участник присылает до двух факторов и сам определяет их тип. Неуместные можно скрыть с экрана.</p><ul class="hsig">' +
        sig.slice().reverse().map(function (x) { return '<li class="' + (x.hidden ? 'hid' : '') + '"><span class="stype ' + x.type + '">' + esc(G.signalTypes[x.type].name) + '</span><span>' + esc(x.text) + ' <span class="muted small">' + esc(x.name) + '</span></span><button class="link" data-act="hideSignal" data-id="' + x.id + '">' + (x.hidden ? 'Показать' : 'Скрыть') + '</button></li>'; }).join('') + '</ul>' +
        '<p class="muted small">Для обсуждения: какие из сигналов — действительно тренды, а какие — слабые сигналы? Что из этого может стать джокером?</p>';
    }
    if (ph === 'factors') {
      var st = factorStats();
      return '<h2 class="h2">Оценка факторов</h2><p>Оценили: <b>' + st.n + '</b> из ' + players().length + '</p><div class="scbox">' + scatter(false) + '</div>' +
        '<button class="btn' + (S.axesShown ? '' : ' primary') + '" data-act="showAxes">' + (S.axesShown ? 'Скрыть оси матрицы' : 'Показать оси нашей матрицы') + '</button>' +
        '<p class="muted small">Обсудите: что попало в правый верхний угол? В нашем кейсе оси — «Судьба комбината» и «Внимание государства».</p>';
    }
    if (ph === 'teams') {
      return '<h2 class="h2">Команды</h2><div class="seg"><button class="' + (S.teamMode === 'self' ? 'on' : '') + '" data-act="teamMode" data-mode="self">Игроки выбирают сами</button><button class="' + (S.teamMode === 'host' ? 'on' : '') + '" data-act="teamMode" data-mode="host">Распределяю я</button></div>' +
        '<label class="lbl">Мест в команде <select class="inp sm" data-act-change="teamSize">' + [3, 4, 5, 6].map(function (n) { return '<option' + (n === S.teamSize ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></label>' +
        '<div class="row"><button class="btn primary" data-act="autoTeams" data-keep="0">Раздать всех случайно</button><button class="btn" data-act="autoTeams" data-keep="1">Раздать только тех, кто без команды</button></div>' +
        '<div class="hteams">' + S.teams.map(function (t) { return '<div class="ht" style="' + teamStyle(t.id) + '"><b>' + tNo(t.id) + '</b> · ' + members(t.id).length + ' чел.</div>'; }).join('') + '</div>' +
        hostCaptains() + '<p class="muted small">Миры раздадутся командам случайно, а капитаны закрепятся при переходе к этапу «Миры».</p>';
    }
    if (ph === 'world') return '<h2 class="h2">Миры</h2><p class="muted">Миры розданы случайно. Команды описывают последствия и ранние признаки, на проекторе собирается сценарная матрица.</p>' +
      S.teams.map(function (t) {
        var n = ['title', 'residents', 'business', 'government', 'signposts'].filter(function (k) { return t[k]; }).length;
        return progressRow(t.id, n, 5, n + '/5', '<span class="small">мир ' + (t.world || '—') + '</span>');
      }).join('') + '<button class="btn" data-act="dealWorlds">Перераздать миры заново</button>';
    if (ph === 'map') return '<h2 class="h2">Карта</h2>' + S.teams.map(function (t) {
      var n = Object.keys(t.placements || {}).length;
      var bad = Object.keys(t.placements || {}).filter(function (p) { var r = eff(t.id, p); return r && r.v < 0; }).length;
      return progressRow(t.id, n, G.mapLimit, t.submitted ? 'отправлен' : n + '/' + G.mapLimit, (bad ? '<span class="small neg">штрафов: ' + bad + '</span>' : '') + (t.submitted ? '<button class="link" data-act="unlockMap" data-team="' + t.id + '">Открыть</button>' : ''));
    }).join('');
    if (ph === 'overlay') return '<h2 class="h2">Наложение карт</h2>' + consRule() + overlayList() + '<p class="muted small">Спросите команды: почему разные миры выбрали одни и те же проекты? Это и есть инвариантные (устойчивые) решения.</p>';
    if (ph === 'pitch') return hostPitch();
    if (ph === 'auction') return hostAuction();
    if (ph === 'reveal') {
      var sp = S.reveal ? spinState() : null;
      return '<h2 class="h2">Колесо судьбы</h2><div class="row"><button class="btn primary" data-act="spin"' + (ui.busy ? ' disabled' : '') + '>' + (S.reveal ? 'Крутить ещё раз' : 'Крутить колесо') + '</button>' +
        '<label class="lbl">или назначить мир <select class="inp sm" data-act-change="spinWorld"><option value="">—</option>' + W.map(function (w) { return '<option value="' + w + '">' + w + ' · ' + esc(world(w).name) + '</option>'; }).join('') + '</select></label></div>' +
        (S.reveal ? '<p>' + (sp.done ? 'Наступил мир <b>' + S.reveal.world + ' · ' + esc(world(S.reveal.world).name) + '</b>' : 'Колесо крутится…') + '</p>' : '') +
        (S.reveal && sp.done ? scoreboard(false) : '');
    }
    if (ph === 'shock') {
      var drawn = S.shocks || [];
      var html2 = '<h2 class="h2">Шоки</h2>' + (!S.reveal ? '<p class="notice">Сначала раскрутите колесо на этапе «Судьба».</p>' : '');
      html2 += '<div class="row"><button class="btn primary" data-act="rollDice"' + (S.dice ? '' : '') + '>' + (S.dice ? 'Перебросить кубик' : 'Бросить кубик') + '</button>' +
        '<label class="lbl">или задать <select class="inp sm" data-act-change="diceValue"><option value="">—</option><option value="1">1 шок</option><option value="2">2 шока</option></select></label></div>';
      if (S.dice) {
        html2 += '<p>На кубике: <b>' + S.dice.value + '</b>. Вытянуто шоков: <b>' + drawn.length + ' из ' + S.dice.value + '</b>.</p>';
        if (drawn.length < S.dice.value) {
          html2 += '<button class="btn primary" data-act="drawShock" data-shock="">Вытянуть случайный шок</button><p class="small muted">или выберите конкретный:</p><div class="shocks">' + Object.keys(G.shocks).filter(function (k) { return drawn.indexOf(k) < 0; }).map(function (k) {
            return '<button class="shockbtn" data-act="drawShock" data-shock="' + k + '"><b>' + esc(G.shocks[k].name) + '</b><span>' + esc(G.shocks[k].text) + '</span></button>';
          }).join('') + '</div>';
        }
        html2 += drawn.map(function (k, i) { return '<div class="notice">Шок ' + (i + 1) + ': <b>' + esc(G.shocks[k].name) + '</b></div>'; }).join('');
        html2 += '<button class="link" data-act="clearShocks">Сбросить кубик и шоки</button>';
      }
      if (S.score && drawn.length) html2 += scoreboard(true);
      return html2;
    }
    if (ph === 'bet') {
      var hb = '<h2 class="h2">Финальная ставка</h2><p class="muted">Выберите вопрос. Каждый игрок ставит свои баллы: угадал — ×2, ошибся — сгорают.</p><div class="shocks">' + Object.keys(G.bets).map(function (k) {
        var q = G.bets[k];
        return '<button class="shockbtn' + (S.bet && S.bet.qid === k ? ' on' : '') + '" data-act="setBet" data-q="' + k + '"><b>' + esc(q.title) + '</b><span>' + q.options.map(function (o) { return o[0]; }).join(' · ') + '</span></button>';
      }).join('') + '</div>';
      if (S.bet) {
        var nb = Object.keys(S.bets || {}).length, np = S.points ? Object.keys(S.points.players).length : 0;
        hb += '<p>Ставок: <b>' + nb + '</b> из ' + np + '.</p>' + (S.bet.revealed ? '<div class="notice ok">Ответ раскрыт: ' + esc(G.bets[S.bet.qid].options[S.betAnswer.correct][0]) + '</div><button class="btn primary" data-act="phase" data-phase="final">К финальному рейтингу</button>' : '<button class="btn primary" data-act="revealBet">Закрыть приём и раскрыть ответ</button>');
        hb += '<p class="small muted">Правильный ответ: ' + esc(G.bets[S.bet.qid].options[[1, 3, 2][['q1', 'q2', 'q3'].indexOf(S.bet.qid)]][0]) + ' (видно только вам)</p>';
      }
      return hb;
    }
    if (ph === 'final') return '<h2 class="h2">Финал</h2><p>На экране — рейтинг игроков после ставки.</p><div class="row"><button class="btn primary" data-act="export">Выгрузить в Google Таблицу</button><button class="btn" data-act="csv">Скачать оценки (CSV)</button></div>' + gradeSummary();
    return '<h2 class="h2">Итоги</h2><p>Сохраните оценки кураторов и результаты команд.</p><div class="row"><button class="btn primary" data-act="export">Выгрузить в Google Таблицу</button><button class="btn" data-act="csv">Скачать оценки (CSV)</button></div>' + gradeSummary() +
      '<div class="notes"><h3 class="h3">Вопросы для рефлексии</h3><ul><li>Почему команда купила именно эти проекты?</li><li>Какие проекты оказались полезны во всех мирах — и почему?</li><li>Сработали ли ваши «ранние признаки»? Можно ли было предвидеть шок?</li><li>Где форсайт упрощён в игре, а где в реальной стратегии города всё сложнее?</li></ul></div>';
  }

  function hostCaptains() {
    return '<h3 class="h3">Капитаны</h3><table class="mini"><tbody>' + S.teams.map(function (t) {
      var ms = members(t.id), tally = t.tally || {};
      return '<tr><td>' + chip(t.id) + '</td><td><select class="inp sm" data-act-change="setCaptain" data-team="' + t.id + '" aria-label="Капитан команды ' + tNo(t.id) + '">' +
        '<option value="">По голосованию' + (t.leader && S.players[t.leader] ? ' — ' + esc(S.players[t.leader].name) : '') + '</option>' +
        ms.map(function (m) { return '<option value="' + m.id + '"' + (t.captain === m.id ? ' selected' : '') + '>' + esc(m.name) + (tally[m.id] ? ' (' + tally[m.id] + ')' : '') + '</option>'; }).join('') +
        '</select></td><td class="small muted">голосов: ' + Object.keys(t.votes || {}).length + ' из ' + ms.length + '</td></tr>';
    }).join('') + '</tbody></table>';
  }

  function hostAuction() {
    var open = S.auction.open || [], sold = soldMap();
    var openMap = {}; open.forEach(function (l) { openMap[l.project] = l; });
    var ov = {}; overlayData().forEach(function (x) { ov[x.project] = x.teams; });
    var html = '<h2 class="h2">Аукцион</h2>';
    open.forEach(function (lot) {
      html += '<div class="hlot"><div><span class="tag">Идёт лот</span><h3 class="h3">' + esc(G.projects[lot.project].name) + '</h3>' +
        '<p class="small">' + S.teams.map(function (t) { var b = lot.bids[t.id]; return tNo(t.id) + ': ' + (b ? (b.amount === 0 ? 'пас' : '<b>' + b.amount + '</b>') : '—'); }).join(' · ') + '</p>' +
        '<div class="row"><button class="btn small primary" data-act="closeLot" data-project="' + lot.project + '">Закрыть</button><button class="btn small" data-act="cancelLot" data-project="' + lot.project + '">Отменить</button></div></div>' + countdownHtml(lot, false) + '</div>';
    });
    if (open.length > 1) html += '<button class="btn" data-act="closeAll">Закрыть все открытые лоты</button>';
    var nSel = Object.keys(ui.sel).filter(function (k) { return ui.sel[k] && !sold[k] && !openMap[k]; }).length;
    html += '<div class="row"><label class="lbl">Время на лот <select class="inp sm" data-act-change="lotSeconds">' + [20, 30, 40, 60, 90, 120].map(function (n) { return '<option value="' + n + '"' + (n === ui.lotSeconds ? ' selected' : '') + '>' + n + ' с</option>'; }).join('') + '</select></label>' +
      '<label class="lbl chk"><input type="checkbox" data-act-change="autoClose"' + (ui.autoClose ? ' checked' : '') + '> закрывать лоты автоматически</label></div>' +
      '<p class="small muted">Отметьте один или несколько проектов и откройте их одновременно.</p>' +
      '<button class="btn primary" data-act="startLots"' + (nSel ? '' : ' disabled') + '>Открыть выбранные лоты (' + nSel + ')</button>';
    html += '<ul class="lots">' + Object.keys(G.projects).map(function (p) {
      var r = sold[p], live = openMap[p];
      return '<li class="' + (r ? 'sold' : '') + (live ? ' live' : '') + '">' +
        (r || live ? '<span></span>' : '<input type="checkbox" data-act-change="selLot" data-project="' + p + '"' + (ui.sel[p] ? ' checked' : '') + ' aria-label="Выбрать лот ' + esc(G.projects[p].name) + '">') +
        '<span class="ln">' + esc(G.projects[p].name) + '</span>' + dots(ov[p] || []) +
        (r ? '<span class="small">' + (r.team == null ? 'не продан' : tLabel(r.team) + ' · ' + r.price) + '</span>' : live ? '<span class="small">идёт</span>' : '<span></span>') + '</li>';
    }).join('') + '</ul>' + (S.auction.results.length ? '<button class="link" data-act="undoLot">Отменить результат последнего лота</button>' : '');
    return html;
  }

  function hostPlayers() {
    var ps = players();
    return '<h2 class="h3">Игроки · ' + ps.length + '</h2><ul class="plist" data-scroll="plist">' + ps.map(function (p) {
      return '<li><span class="plname">' + esc(p.name) + '</span><select class="inp sm" data-act-change="assign" data-pid="' + p.id + '" aria-label="Команда игрока ' + esc(p.name) + '"><option value="">—</option>' + S.teams.map(function (t) { return '<option value="' + t.id + '"' + (p.team === t.id ? ' selected' : '') + '>' + tNo(t.id) + '</option>'; }).join('') + '</select>' +
        '<button class="x" data-act="kick" data-pid="' + p.id + '" aria-label="Удалить ' + esc(p.name) + '">×</button></li>';
    }).join('') + '</ul>';
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
    html += '<div class="pad"><div class="tabs">' + S.teams.map(function (tt) { return '<button class="tab' + (tt.id === ti ? ' on' : '') + '" style="' + teamStyle(tt.id) + '" data-act="curTeam" data-team="' + tt.id + '">' + tNo(tt.id) + '</button>'; }).join('') + '</div>' +
      '<label class="lbl" for="curname">Ваше имя (куратор)</label><input id="curname" class="inp" data-key="curName" value="' + esc(by) + '" placeholder="Например, Егор">' +
      '<h2 class="h2">' + tLabel(ti) + (t.world ? ' · мир ' + t.world + ' «' + esc(tName(ti)) + '»' : '') + '</h2>';
    var ms = members(ti);
    html += '<p class="muted small">Шкала: ' + G.criteria.map(function (c) { return esc(c.name) + ' 0–' + c.max; }).join(', ') + '. Итог — до 10 баллов.</p>';
    html += ms.length ? ms.map(function (p) {
      var g = (S.grades || {})[p.id] || {};
      var sigs = (S.signals || []).filter(function (x) { return x.pid === p.id; }).length;
      var rated = S.ratings && S.ratings[p.id] ? 'да' : 'нет';
      return '<div class="gcard"><div class="ghead"><b>' + (captainId(ti) === p.id ? '<span class="crown" aria-hidden="true"></span>' : '') + esc(p.name) + (captainId(ti) === p.id ? ' <span class="small muted">капитан</span>' : '') + '</b><span class="gt">' + gradeTotal(g) + '<small>/10</small></span></div>' +
        '<p class="small muted">Сигналов: ' + sigs + ' · оценил факторы: ' + rated + '</p>' +
        G.criteria.map(function (c) {
          var opts = ''; for (var k = 0; k <= c.max; k++) opts += '<button class="' + (g[c.key] === k ? 'on' : '') + '" data-act="grade" data-pid="' + p.id + '" data-k="' + c.key + '" data-v="' + k + '">' + k + '</button>';
          return '<div class="crit"><span>' + esc(c.name) + '</span><div class="seg num">' + opts + '</div></div>';
        }).join('') +
        '<input class="inp sm" data-key="note:' + p.id + '" data-note="' + p.id + '" placeholder="Комментарий (необязательно)" value="' + esc(g.note || '') + '"></div>';
    }).join('') : '<p class="muted">В команде пока никого.</p>';
    html += '<h2 class="h3">Работа команды</h2><div class="cwork">' + ['title', 'residents', 'business', 'government', 'signposts', 'rationale', 'shockAnswer'].map(function (k) {
      var lbl = { title: 'Название мира', residents: 'Жители', business: 'Бизнес', government: 'Власть', signposts: 'Ранние признаки', rationale: 'Обоснование плана', shockAnswer: 'Реакция на шок' }[k];
      return t[k] ? '<p><b>' + lbl + ':</b> ' + esc(t[k]) + '</p>' : '';
    }).join('') + (Object.keys(t.placements || {}).length ? '<p><b>На карте:</b> ' + Object.keys(t.placements).map(function (p) { var r = eff(t.id, p); return esc(G.projects[p].name) + ' (' + esc(G.zones[t.placements[p]].name) + (r ? ', ' + signed(r.v) : '') + ')'; }).join(', ') + '</p>' : '') + '</div></div>';
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
      case 'pick': ui.pending = d.project; render(); var mb = root.querySelector('.mapbox'); if (mb) mb.scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      case 'cancelPick': ui.pending = null; render(); break;
      case 'placeZone': {
        if (!ui.pending) return;
        var zone = d.zone || (e.target.dataset && e.target.dataset.zone);
        var proj = ui.pending, mt = myTeam(), bz = mt ? busyZones(mt, proj) : {};
        if (!zone) return;
        if (bz[zone]) { toast('Один район — одна постройка: в районе «' + G.zones[zone].name + '» уже стоит «' + G.projects[bz[zone]].name + '»', 'err', 4000); return; }
        ui.pending = null;
        run({ a: 'place', project: proj, zone: zone }, '«' + G.projects[proj].name + '» → ' + G.zones[zone].name).catch(function () { });
        break;
      }
      case 'unplace': run({ a: 'place', project: d.project, zone: '' }).catch(function () { }); break;
      case 'submitMap':
        if (confirm('Отправить план команды? После этого его нельзя будет изменить, а жители оценят размещение.'))
          run({ a: 'submitMap' }).then(function (r) {
            var e2 = r.effects || { sum: 0, count: 0 };
            if (!e2.count) toast('План отправлен. Жители не возражают против размещения.', 'ok', 5000);
            else toast('План отправлен. Реакция жителей на размещение: ' + signed(e2.sum) + ' — подробности под проектами.', e2.sum < 0 ? 'err' : 'ok', 6500);
            window.scrollTo(0, 0);
          }, function () { });
        break;
      case 'bidStep': { var t = myTeam(); var pr0 = d.project; var cur0 = ui.bids[pr0] == null ? 10 : ui.bids[pr0]; var nv = Math.max(0, Math.min(t ? t.budget : 0, cur0 + Number(d.d))); if (nv > 0 && nv < 5) nv = 5; ui.bids[pr0] = nv; render(); break; }
      case 'bid': run({ a: 'bid', project: d.project, amount: ui.bids[d.project] }, 'Ставка принята: ' + ui.bids[d.project]).catch(function () { }); break;
      case 'pass': run({ a: 'bid', project: d.project, amount: 0 }, 'Команда пасует').catch(function () { }); break;
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
      case 'shock': { var k = d.shock; if (k === 'random') { var ks = Object.keys(G.shocks); k = ks[Math.floor(Math.random() * ks.length)]; } run({ a: 'setShock', shock: k }).catch(function () { }); break; }
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
    if (!key) return;
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
  root.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('polygon[data-act]')) { e.preventDefault(); e.target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });

  window.addEventListener('hashchange', function () { readRole(); S = null; lastHtml = ''; bgSwarm(); render(); poll(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });

  bgSwarm();
  render();
  poll();
  requestAnimationFrame(loop);
})();

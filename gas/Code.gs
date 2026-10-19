/**
 * «Министерство в 5 мирах» — сервер игры на Google Apps Script. Версия 9.
 *
 * Состояние игры хранится в CacheService (быстро, для опроса) и периодически
 * копируется в лист «state» этой таблицы — на случай, если кэш очистится.
 * Все изменения идут под LockService. Чтобы не перегружать сервер, действия
 * за команду (тексты, внедрение решений, ставки на аукционе) делает только капитан.
 *
 * Разверните как веб-приложение: «Выполнять от имени: Я», «Доступ: Все».
 * После замены кода: Развернуть → Управление развертываниями → ✏️ → Версия: новая.
 */

// ======================= НАСТРОЙКИ =======================
var HOST_PIN = '2040';          // PIN ведущего и кураторов — ПОМЕНЯЙТЕ перед игрой
var START_BUDGET = 100;         // монет у каждой команды на аукционе
var MAP_LIMIT = 5;              // сколько цифровых решений команда внедряет
var DEFAULT_TEAM_SIZE = 4;
var SIGNALS_PER_PLAYER = 2;     // сколько сигналов будущего может прислать один игрок
var CONSENSUS_MIN = 3;          // решение у стольких команд — «кандидат в устойчивые»
var CONSENSUS_BONUS = 1;        // ...и получает поддержку всего министерства: +1 во всех мирах
// =========================================================

var SCHEMA = 9;
var TEAM_COUNT = 5;
var WORLDS = ['A', 'B', 'C', 'D', 'E'];
var FACTORS = ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8'];
var SIGNAL_TYPES = ['trend', 'weak', 'driver', 'wild'];
var PHASES = ['intro', 'lobby', 'signals', 'factors', 'teams', 'world', 'pitch', 'map', 'overlay', 'auction', 'reveal', 'shock', 'results', 'bet', 'final'];
var TEXT_FIELDS = ['title', 'residents', 'business', 'government', 'signposts', 'rationale', 'shockAnswer'];
var INTRO_STEPS = 30; // верхняя граница: число слайдов задаётся в content.js на сайте

// Отдача цифровых решений в каждом мире: [A, B, C, D, E]. Скрыта от игроков до раскрытия мира.
// A Государство-платформа, B Цифровая крепость, C Своими силами, D Назад к бумаге, E Инерция.
var PAYOFF = {
  p01: [4, -1, 3, -2, 2],  // ИИ-помощник для ответов на обращения
  p02: [5, 1, 1, -2, 1],   // Проактивные выплаты без заявлений
  p03: [2, 0, 3, -1, 2],   // Чат-бот горячей линии
  p04: [1, 2, 2, 3, 2],    // Видеоприём и выездная служба
  p05: [-1, 3, 0, 4, 1],   // Резервные окна очного приёма
  p06: [2, 2, 3, 1, 2],    // Программные роботы для бухгалтерии
  p07: [3, 1, 2, 0, 1],    // Электронные закупки
  p08: [3, 1, 2, -1, 1],   // Аналитика расходов бюджета
  p09: [5, -2, 2, -3, 1],  // Единое хранилище данных о получателях
  p10: [5, 2, -3, -2, 0],  // Переезд систем на госплатформу
  p11: [1, 3, 1, 0, 1],    // Переход на отечественное ПО
  p12: [3, 1, 2, -3, 0],   // Ситуационный центр министра
  p13: [2, 4, 2, 1, 1],    // Центр мониторинга кибератак
  p14: [2, 3, 1, 1, 1],    // Правила для ИИ и данных
  p15: [2, 1, 2, 0, 2],    // Электронный документооборот
  p16: [2, 2, 3, 2, 2],    // Цифровая школа для сотрудников
  p17: [2, -1, 2, -1, 1],  // Удалённая работа и гибкий офис
  p18: [3, -2, 2, -1, 1]   // Открытые данные министерства
};
var PROJECTS = Object.keys(PAYOFF);

// Оргструктура: блок заместителя министра → число отделов. Команда может отдать блоку
// столько своих решений, сколько в нём отделов.
var BLOCKS = { b1: 3, b2: 4, b3: 2, b4: 2, b5: 3 };
var ZONES = Object.keys(BLOCKS); // старое имя: «зона» = блок замминистра

// Последствия выбора блока: решение → блок → [баллы, объяснение для команды].
// Команда узнаёт их только после отправки плана. Действуют в любом мире.
// Блоки: b1 Стратегия и финансы, b2 Работа с гражданами, b3 Цифровое развитие, b4 Безопасность и право, b5 Кадры и организация.
var ZONE_RULES = {
  p01: {
    b2: [1, 'Профильный блок: обращения идут через приёмную, помощник сразу у тех, кто отвечает жителям.'],
    b1: [-1, 'Финансисты не отвечают на обращения — помощник будет простаивать.'],
    b4: [-1, 'Безопасники будут только запрещать: без пользователей решение не взлетит.']
  },
  p02: {
    b2: [1, 'Профильный блок: отдел выплат знает получателей и сам запускает выплаты.'],
    b4: [-2, 'Юристы и безопасники затянут запуск: каждое начисление без заявления проверяют вручную.'],
    b5: [-1, 'Кадровики не работают с выплатами жителям.']
  },
  p03: {
    b2: [1, 'Профильный блок: горячая линия сразу снимает с операторов типовые вопросы.'],
    b1: [-1, 'Бот у финансистов жители просто не найдут.'],
    b5: [-1, 'Кадровая служба не знает, о чём спрашивают жители.']
  },
  p04: {
    b2: [1, 'Профильный блок: выездная служба уже ездит к жителям, видео расширит её охват.'],
    b1: [-1, 'Финансисты не ведут приём граждан.'],
    b4: [-1, 'Под контролем безопасников запись каждого видеоприёма отпугнёт людей.']
  },
  p05: {
    b2: [1, 'Профильный блок: приёмная умеет принимать людей вживую.'],
    b3: [-2, 'ИТ-отдел не принимает граждан — окна окажутся без сотрудников.'],
    b4: [-1, 'Приём под надзором службы безопасности превратится в проходную с пропусками.']
  },
  p06: {
    b1: [1, 'Профильный блок: бухгалтерия сама знает, какие операции рутинные.'],
    b2: [-1, 'Роботам для бухгалтерии нечего делать в работе с гражданами.'],
    b4: [-1, 'Юристы не ведут учёт — роботы будут автоматизировать чужие процессы.']
  },
  p07: {
    b1: [1, 'Профильный блок: отдел закупок сразу переводит торги в цифру.'],
    b2: [-2, 'Закупки у отдела обращений нарушают порядок — юристы против.'],
    b5: [-1, 'Хозотдел покупает канцелярию, а не проводит торги на миллионы.']
  },
  p08: {
    b1: [1, 'Профильный блок: бюджетный отдел видит, на что уходят деньги.'],
    b5: [-1, 'Кадровики не распоряжаются бюджетом — аналитика никому не пригодится.'],
    b4: [-1, 'Безопасники закроют доступ к финансовым данным, отчёты будут пустыми.']
  },
  p09: {
    b3: [1, 'Профильный блок: отдел данных умеет строить хранилища и следить за качеством.'],
    b2: [-1, 'Без ИТ-специалистов хранилище быстро превратится в свалку таблиц.'],
    b5: [-2, 'Кадровики не потянут хранилище данных о сотнях тысяч жителей.']
  },
  p10: {
    b3: [1, 'Профильный блок: ИТ-инфраструктура отвечает за переезд систем.'],
    b1: [-1, 'Финансисты сорвут сроки: переезд — инженерная задача.'],
    b2: [-2, 'Работа с гражданами не умеет переносить системы — сервисы встанут на месяц.']
  },
  p11: {
    b3: [1, 'Профильный блок: ИТ-отдел сам проверит совместимость систем.'],
    b5: [-1, 'Хозотдел купит лицензии, но внедрять их некому.'],
    b2: [-1, 'Отдел обращений не умеет менять программы — работа встанет.']
  },
  p12: {
    b3: [1, 'Профильный блок: аналитики данных соберут экраны для министра.'],
    b4: [-1, 'Безопасники закроют доступ к данным — экраны будут пустыми.'],
    b5: [-1, 'В кадровом блоке нет данных о выплатах и очередях.']
  },
  p13: {
    b4: [1, 'Профильный блок: защита информации круглосуточно отвечает за инциденты.'],
    b2: [-2, 'Мониторинг атак в отделе обращений бесполезен без специалистов.'],
    b5: [-2, 'Кадровики не отличат атаку от обычного сбоя.']
  },
  p14: {
    b4: [1, 'Профильный блок: юристы пишут правила, безопасники следят за их исполнением.'],
    b2: [-1, 'Правила, написанные приёмной, не выдержат первой проверки.'],
    b1: [-1, 'Финансисты не разбираются в персональных данных.']
  },
  p15: {
    b5: [1, 'Профильный блок: документооборот и архив — хозяева этого процесса.'],
    b4: [-1, 'Безопасники будут согласовывать каждый документ — система встанет.'],
    b2: [-1, 'Отдел обращений внедрит систему только для себя, остальные останутся на бумаге.']
  },
  p16: {
    b5: [1, 'Профильный блок: кадровая служба знает, кого и чему учить.'],
    b1: [-1, 'Финансисты урежут обучение при первой экономии.'],
    b4: [-1, 'Учить будут только правилам безопасности, а не работе с системами.']
  },
  p17: {
    b5: [1, 'Профильный блок: кадры и хозотдел вместе меняют правила и рабочие места.'],
    b4: [-1, 'Безопасность запретит работу из дома по умолчанию.'],
    b2: [-1, 'Приёмная не может уйти на удалёнку — правила будут только для неё.']
  },
  p18: {
    b3: [1, 'Профильный блок: отдел данных готовит наборы и следит за их обновлением.'],
    b4: [-2, 'Безопасники будут годами согласовывать публикацию каждого набора.'],
    b1: [-1, 'Финансисты опубликуют только бюджетные отчёты — сервисы на них не построишь.']
  }
};

// Карты-шоки: поправки к отдаче решений; zone/zoneMod — дополнительный штраф всем решениям, отданным этому блоку.
var SHOCKS = {
  s1: { mods: { p13: 2, p14: 1, p09: -2, p02: -1, p18: -1, p01: -1 } },
  s2: { mods: { p06: 1, p08: 1, p11: -2, p12: -1, p10: -1 } },
  s3: { mods: { p01: 2, p03: 1, p14: 1, p05: -1 } },
  s4: { mods: { p16: 2, p17: 1 }, zone: 'b3', zoneMod: -1 },
  s5: { mods: { p10: -2, p02: -1, p05: 2, p04: 1 } }
};

// Финальная ставка: какое решение работает во всех пяти мирах. Правильный ответ скрыт до раскрытия.
var BETS = {
  q1: { correct: 1, payoff: [[-1, 2, 3, -2, 1], [2, 2, 3, 2, 1], [4, -2, 3, -3, 1], [3, -2, 3, -2, 1], [4, -1, 2, -4, 0]] },
  q2: { correct: 3, payoff: [[5, -3, 1, -2, 1], [-2, 1, 3, 0, 1], [-4, 1, -3, 3, -1], [2, 3, 2, 1, 1], [2, -4, 1, -2, 0]] },
  q3: { correct: 2, payoff: [[5, -2, 3, -4, 1], [-3, 3, -2, 4, 0], [2, 2, 2, 2, 1], [3, -3, 3, -3, 1], [2, 1, -2, 1, 0]] }
};

// ---------------- HTTP ----------------
function doGet(e) { return respond_(route_((e && e.parameter) || {})); }

function doPost(e) {
  var body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { body = {}; }
  return respond_(route_(body));
}

function respond_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function route_(req) {
  try {
    var a = String(req.a || 'state');
    if (a === 'state') return readState_(req);
    if (a === 'ping') return { ok: true, now: Date.now() };
    return mutate_(function (s) { return act_(s, a, req); }, req);
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err), now: Date.now() };
  }
}

// ---------------- Хранение ----------------
var CACHE_TTL = 21600; // 6 часов — максимум CacheService
var CHUNK = 90000;

function cache_() { return CacheService.getScriptCache(); }

function loadState_() {
  var c = cache_();
  var n = c.get('state_n');
  if (n) {
    var keys = [];
    for (var i = 0; i < Number(n); i++) keys.push('state_' + i);
    var parts = c.getAll(keys);
    var str = '';
    var whole = true;
    for (var j = 0; j < keys.length; j++) {
      if (parts[keys[j]] == null) { whole = false; break; }
      str += parts[keys[j]];
    }
    if (whole && str) {
      var cached = JSON.parse(str);
      if (cached.schema === SCHEMA) return cached;
    }
  }
  var sh = sheet_('state');
  var vals = sh.getRange(1, 1, 1, 10).getValues()[0];
  var saved = vals.join('');
  if (saved) {
    var st = JSON.parse(saved);
    if (st.schema === SCHEMA) {
      writeCache_(st);
      return st;
    }
  }
  var fresh = newState_();
  writeCache_(fresh);
  return fresh;
}

function writeCache_(s) {
  var str = JSON.stringify(s);
  var obj = {};
  var n = Math.max(1, Math.ceil(str.length / CHUNK));
  for (var i = 0; i < n; i++) obj['state_' + i] = str.substr(i * CHUNK, CHUNK);
  obj['state_n'] = String(n);
  obj['ver'] = String(s.v);
  cache_().putAll(obj, CACHE_TTL);
}

function saveState_(s, force) {
  s.v = (s.v || 0) + 1;
  writeCache_(s);
  var c = cache_();
  var last = Number(c.get('savedAt') || 0);
  if (force || Date.now() - last > 4000) {
    var str = JSON.stringify(s);
    if (str.length > 450000) throw new Error('Состояние игры слишком большое');
    var row = [];
    for (var i = 0; i < 10; i++) row.push(str.substr(i * 45000, 45000));
    sheet_('state').getRange(1, 1, 1, 10).setValues([row]);
    c.put('savedAt', String(Date.now()), CACHE_TTL);
  }
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function newTeam_(i) {
  return {
    id: i, no: i + 1, world: null, captain: null, votes: {},
    title: '', residents: '', business: '', government: '', signposts: '', rationale: '', shockAnswer: '',
    edits: {},
    placements: {}, submitted: false, submittedBy: '',
    budget: START_BUDGET
  };
}

function newState_() {
  var teams = [];
  for (var i = 0; i < TEAM_COUNT; i++) teams.push(newTeam_(i));
  return {
    schema: SCHEMA, v: 1, created: Date.now(), phase: 'intro', introStep: 0,
    teamMode: 'self', teamSize: DEFAULT_TEAM_SIZE,
    players: {}, order: [], teams: teams,
    signals: [], ratings: {},
    worldsDealt: false, dealtAt: 0, axesShown: false, pitchTeam: 0, pitched: [],
    auction: { open: [], results: [] },
    reveal: null, dice: null, shocks: [],
    bet: null, bets: {},
    grades: {}
  };
}

// ---------------- Чтение ----------------
function readState_(req) {
  var now = Date.now();
  var ver = cache_().get('ver');
  if (ver && req.v && String(req.v) === ver && !req.full) return { ok: true, same: true, v: Number(ver), now: now };
  var s = loadState_();
  return { ok: true, now: now, state: publicView_(s, req.pin === HOST_PIN, req.pid) };
}

function publicView_(s, isHost, pid) {
  var out = JSON.parse(JSON.stringify(s));
  var me = pid && s.players[pid];
  var myTeam = me ? me.team : null;
  if (!isHost) {
    delete out.grades;
    // суммы чужих ставок на аукционе не уходят на клиент — видно только «ставка сделана»
    out.auction.open.forEach(function (lot) {
      Object.keys(lot.bids).forEach(function (tid) {
        var b = lot.bids[tid], own = Number(tid) === myTeam;
        lot.bids[tid] = { made: true, pass: b.amount === 0, by: own ? b.by : '', amount: own ? b.amount : null, at: b.at };
      });
    });
    out.signals = out.signals.filter(function (x) { return !x.hidden; });
    // финальные ставки других игроков скрыты до раскрытия ответа
    if (!(s.bet && s.bet.revealed)) {
      var mine = pid && s.bets[pid];
      out.bets = {};
      if (mine) out.bets[pid] = mine;
      out.betCount = Object.keys(s.bets).length;
    }
  }
  // голоса за капитана: видно, кто за кого, только внутри своей команды
  out.teams.forEach(function (t) {
    var tally = {};
    Object.keys(t.votes || {}).forEach(function (v) { tally[t.votes[v]] = (tally[t.votes[v]] || 0) + 1; });
    t.tally = tally;
    t.leader = captainOf_(s, s.teams[t.id]);
    if (!isHost && myTeam !== t.id) delete t.votes;
  });
  out.isHost = !!isHost;
  // последствия размещения команда узнаёт только после отправки плана
  out.teams.forEach(function (t) {
    if (!t.submitted && !s.reveal) return;
    t.effects = {};
    Object.keys(t.placements || {}).forEach(function (p) {
      var r = ZONE_RULES[p] && ZONE_RULES[p][t.placements[p]];
      if (r) t.effects[p] = { v: r[0], text: r[1] };
    });
  });
  if (PHASES.indexOf(s.phase) >= PHASES.indexOf('overlay')) out.consensus = Object.keys(consensus_(s));
  if (s.reveal) {
    out.payoff = PAYOFF;
    out.score = score_(s);
    out.points = points_(s);
  }
  if (s.shocks.length) out.shockMods = s.shocks.map(function (k) { return SHOCKS[k]; });
  if (s.bet && s.bet.revealed) out.betAnswer = BETS[s.bet.qid];
  return out;
}

// ---------------- Изменения ----------------
function mutate_(fn, req) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { ok: false, error: 'Сервер занят, повторите', now: Date.now() };
  try {
    var s = loadState_();
    var res = fn(s) || {};
    if (res.ok === false) return { ok: false, error: res.error, now: Date.now() };
    saveState_(s, !!res.force);
    res.ok = true;
    res.now = Date.now();
    res.state = publicView_(s, req.pin === HOST_PIN, req.pid);
    return res;
  } finally {
    lock.releaseLock();
  }
}

function fail_(msg) { return { ok: false, error: msg }; }

function clean_(v, max) {
  return String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').slice(0, max || 600);
}

function uid_() {
  var chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  var out = '';
  for (var i = 0; i < 8; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function shuffle_(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var k = Math.floor(Math.random() * (i + 1));
    var tmp = arr[i]; arr[i] = arr[k]; arr[k] = tmp;
  }
  return arr;
}

function dealWorlds_(s) {
  var w = shuffle_(WORLDS.slice());
  s.teams.forEach(function (t, i) { t.world = w[i]; });
  s.worldsDealt = true;
  s.dealtAt = Date.now();
}

function teamMembers_(s, ti) {
  return s.order.filter(function (id) { return s.players[id] && s.players[id].team === ti; });
}

// Капитан: назначен ведущим или выбран голосованием (при равенстве — тот, кто раньше получил голос)
function captainOf_(s, t) {
  var members = teamMembers_(s, t.id);
  if (t.captain && members.indexOf(t.captain) >= 0) return t.captain;
  var tally = {}, first = {}, order = 0;
  Object.keys(t.votes || {}).forEach(function (voter) {
    var c = t.votes[voter];
    if (members.indexOf(voter) < 0 || members.indexOf(c) < 0) return;
    tally[c] = (tally[c] || 0) + 1;
    if (first[c] == null) first[c] = order++;
  });
  var best = null;
  Object.keys(tally).forEach(function (c) {
    if (!best || tally[c] > tally[best] || (tally[c] === tally[best] && first[c] < first[best])) best = c;
  });
  return best || members[0] || null;
}

function lockCaptains_(s) {
  s.teams.forEach(function (t) { t.captain = captainOf_(s, t); });
}

function playerTeam_(s, pid, captainOnly) {
  var p = s.players[pid];
  if (!p) return { error: 'Игрок не найден — войдите заново' };
  if (p.team == null) return { error: 'Вы пока не в команде' };
  var t = s.teams[p.team];
  if (captainOnly && captainOf_(s, t) !== pid) return { error: 'Это делает капитан команды. Подскажите ему!' };
  return { p: p, t: t };
}

function committed_(s, teamId, exceptProject) {
  return s.auction.open.reduce(function (acc, lot) {
    if (lot.project === exceptProject) return acc;
    var b = lot.bids[teamId];
    return acc + (b ? b.amount : 0);
  }, 0);
}

function closeLot_(s, lot, now) {
  var winner = null, wb = null;
  var bids = {};
  Object.keys(lot.bids).forEach(function (tid) {
    var b = lot.bids[tid];
    bids[tid] = b.amount;
    if (b.amount > 0 && (!wb || b.amount > wb.amount || (b.amount === wb.amount && b.at < wb.at))) { winner = Number(tid); wb = b; }
  });
  var res = { project: lot.project, team: winner, price: wb ? wb.amount : 0, bids: bids, at: now };
  if (winner != null) s.teams[winner].budget -= wb.amount;
  s.auction.results.push(res);
  s.auction.open = s.auction.open.filter(function (x) { return x.project !== lot.project; });
  return res;
}

function act_(s, a, req) {
  var isHost = req.pin === HOST_PIN;
  var hostOnly = ['setPhase', 'setIntro', 'setTeamMode', 'autoTeams', 'assign', 'kick', 'startLots', 'closeLot', 'closeAll', 'cancelLot',
    'spin', 'rollDice', 'drawShock', 'clearShocks', 'reset', 'export', 'unlockMap', 'grade', 'rename', 'setBudget', 'undoLot', 'dealWorlds',
    'hideSignal', 'showAxes', 'setCaptain', 'setBet', 'revealBet'];
  if (hostOnly.indexOf(a) >= 0 && !isHost) return fail_('Неверный PIN');
  var now = Date.now();
  var r, t, p, i;

  switch (a) {
    case 'checkPin':
      return isHost ? {} : fail_('Неверный PIN');

    case 'join': {
      var name = clean_(req.name, 40).trim();
      if (!name) return fail_('Введите имя');
      if (req.pid && s.players[req.pid]) {
        s.players[req.pid].name = name;
        return { pid: req.pid };
      }
      if (Object.keys(s.players).length >= 60) return fail_('Комната заполнена');
      var id = uid_();
      s.players[id] = { id: id, name: name, team: null, joined: now };
      s.order.push(id);
      return { pid: id };
    }

    // ----- сигналы будущего -----
    case 'signal': {
      p = s.players[req.pid];
      if (!p) return fail_('Игрок не найден — войдите заново');
      if (s.phase !== 'signals') return fail_('Сейчас не этап сигналов');
      if (SIGNAL_TYPES.indexOf(req.type) < 0) return fail_('Выберите тип: тренд, слабый сигнал, драйвер или джокер');
      var text = clean_(req.text, 140).trim();
      if (text.length < 3) return fail_('Опишите сигнал хотя бы парой слов');
      if (s.signals.filter(function (x) { return x.pid === p.id; }).length >= SIGNALS_PER_PLAYER) return fail_('Можно прислать не больше ' + SIGNALS_PER_PLAYER + ' сигналов');
      // не больше одного сигнала в каждой категории — чтобы сигналы распределялись по всем четырём колонкам экрана
      if (s.signals.some(function (x) { return x.pid === p.id && x.type === req.type; })) return fail_('В этой категории у вас уже есть сигнал — выберите другой тип');
      s.signals.push({ id: uid_(), pid: p.id, name: p.name, type: req.type, text: text, at: now });
      return {};
    }

    case 'delSignal': {
      var idx = -1;
      s.signals.forEach(function (x, k) { if (x.id === req.id) idx = k; });
      if (idx < 0) return {};
      if (s.signals[idx].pid !== req.pid && !isHost) return fail_('Можно удалить только свой сигнал');
      s.signals.splice(idx, 1);
      return {};
    }

    case 'hideSignal': {
      s.signals.forEach(function (x) { if (x.id === req.id) x.hidden = !x.hidden; });
      return {};
    }

    // ----- оценка факторов -----
    case 'rate': {
      p = s.players[req.pid];
      if (!p) return fail_('Игрок не найден — войдите заново');
      if (s.phase !== 'factors') return fail_('Сейчас не этап оценки факторов');
      var vals = req.ratings || {};
      var clean = {};
      FACTORS.forEach(function (f) {
        var v = vals[f];
        if (!v || v.length !== 2) return;
        var inf = Math.round(Number(v[0])), unc = Math.round(Number(v[1]));
        if (inf >= 1 && inf <= 5 && unc >= 1 && unc <= 5) clean[f] = [inf, unc];
      });
      if (Object.keys(clean).length < FACTORS.length) return fail_('Оцените все факторы по обеим шкалам');
      s.ratings[p.id] = clean;
      return {};
    }

    // ----- команды и капитаны -----
    case 'pickTeam': {
      p = s.players[req.pid];
      if (!p) return fail_('Игрок не найден — войдите заново');
      if (s.teamMode !== 'self') return fail_('Команды распределяет ведущий');
      if (s.phase !== 'teams') return fail_('Выбор команд закрыт');
      var ti = req.team === null || req.team === '' ? null : Number(req.team);
      if (ti !== null) {
        if (!(ti >= 0 && ti < s.teams.length)) return fail_('Нет такой команды');
        if (p.team !== ti && teamSize_(s, ti) >= s.teamSize) return fail_('В этой команде уже нет мест');
      }
      if (p.team != null && p.team !== ti) delete s.teams[p.team].votes[p.id];
      p.team = ti;
      return {};
    }

    case 'vote': {
      r = playerTeam_(s, req.pid, false); if (r.error) return fail_(r.error);
      if (r.t.captain && PHASES.indexOf(s.phase) >= PHASES.indexOf('world')) return fail_('Капитан уже выбран');
      var cand = s.players[req.candidate];
      if (!cand || cand.team !== r.p.team) return fail_('Голосовать можно только за игрока своей команды');
      r.t.votes[r.p.id] = cand.id;
      return {};
    }

    case 'setCaptain': {
      t = s.teams[Number(req.team)];
      if (!t) return fail_('Нет такой команды');
      if (req.pid && (!s.players[req.pid] || s.players[req.pid].team !== t.id)) return fail_('Игрок не из этой команды');
      t.captain = req.pid || null;
      return {};
    }

    case 'field': {
      r = playerTeam_(s, req.pid, true); if (r.error) return fail_(r.error);
      if (TEXT_FIELDS.indexOf(req.field) < 0) return fail_('Нет такого поля');
      r.t[req.field] = clean_(req.value, req.field === 'title' ? 60 : 600);
      r.t.edits[req.field] = { by: r.p.name, at: now };
      return {};
    }

    case 'place': {
      r = playerTeam_(s, req.pid, true); if (r.error) return fail_(r.error);
      if (s.phase !== 'map') return fail_('Сейчас не этап внедрения');
      if (r.t.submitted) return fail_('План уже отправлен');
      if (PROJECTS.indexOf(req.project) < 0) return fail_('Нет такого решения');
      var blk = req.block != null ? req.block : req.zone;
      if (blk == null || blk === '') {
        delete r.t.placements[req.project];
        return {};
      }
      if (!BLOCKS[blk]) return fail_('Нет такого блока');
      if (!r.t.placements[req.project] && Object.keys(r.t.placements).length >= MAP_LIMIT)
        return fail_('Можно выбрать не больше ' + MAP_LIMIT + ' решений');
      var used = 0;
      Object.keys(r.t.placements).forEach(function (k) { if (k !== req.project && r.t.placements[k] === blk) used++; });
      if (used >= BLOCKS[blk]) return fail_('В этом блоке ' + BLOCKS[blk] + ' отдела — мест для ваших решений больше нет');
      r.t.placements[req.project] = blk;
      return {};
    }

    case 'submitMap': {
      r = playerTeam_(s, req.pid, true); if (r.error) return fail_(r.error);
      if (Object.keys(r.t.placements).length < 1) return fail_('Отдайте блокам хотя бы одно решение');
      r.t.submitted = true;
      r.t.submittedBy = r.p.name;
      var sum = 0, n = 0;
      Object.keys(r.t.placements).forEach(function (pr) {
        var rr = ZONE_RULES[pr] && ZONE_RULES[pr][r.t.placements[pr]];
        if (rr) { sum += rr[0]; n++; }
      });
      return { force: true, effects: { sum: sum, count: n } };
    }

    // ----- аукцион: несколько лотов одновременно -----
    case 'bid': {
      r = playerTeam_(s, req.pid, true); if (r.error) return fail_(r.error);
      if (s.phase !== 'auction') return fail_('Аукцион сейчас не идёт');
      var lot = null;
      s.auction.open.forEach(function (x) { if (x.project === req.project) lot = x; });
      if (!lot) return fail_('Этот лот уже закрыт');
      if (now > lot.endsAt + 1500) return fail_('Время на ставку вышло');
      var amount = Math.floor(Number(req.amount));
      if (!(amount >= 0)) return fail_('Неверная сумма');
      if (amount > 0 && amount < 5) return fail_('Минимальная ставка — 5 монет');
      var busy = committed_(s, r.t.id, lot.project);
      if (amount + busy > r.t.budget) return fail_('Не хватает монет: свободно ' + (r.t.budget - busy) + ' (остальное — в других ставках)');
      lot.bids[r.t.id] = { amount: amount, by: r.p.name, at: now };
      return {};
    }

    // ----- финальная ставка (каждый игрок сам) -----
    case 'placeBet': {
      p = s.players[req.pid];
      if (!p) return fail_('Игрок не найден — войдите заново');
      if (!s.bet || s.bet.revealed || !s.bet.open) return fail_('Ставки сейчас не принимаются');
      if (p.team == null || !s.reveal) return fail_('У вас пока нет баллов');
      var have = points_(s).teams[p.team].points;
      var stake = Math.floor(Number(req.stake) || 0);
      if (stake < 0 || stake > have) return fail_('Можно поставить от 0 до ' + have + ' баллов');
      var opt = Number(req.option);
      if (stake === 0) { delete s.bets[p.id]; return {}; }
      if (!(opt >= 0 && opt < BETS[s.bet.qid].payoff.length)) return fail_('Выберите вариант ответа');
      s.bets[p.id] = { option: opt, stake: stake, at: now };
      return {};
    }

    // ----- ведущий -----
    case 'setPhase': {
      if (PHASES.indexOf(req.phase) < 0) return fail_('Нет такого этапа');
      s.phase = req.phase;
      var pi = PHASES.indexOf(req.phase);
      if (pi >= PHASES.indexOf('world')) {
        if (!s.worldsDealt) dealWorlds_(s);
        lockCaptains_(s);
      }
      return { force: true };
    }

    case 'setIntro': {
      s.introStep = Math.max(0, Math.min(INTRO_STEPS - 1, Number(req.step) || 0));
      s.phase = 'intro';
      return {};
    }

    case 'showAxes': { s.axesShown = !s.axesShown; return {}; }

    case 'setPitch': {
      var pt = Number(req.team);
      if (!(pt >= 0 && pt < s.teams.length)) return fail_('Нет такой команды');
      if (!s.pitched) s.pitched = [];
      if (s.pitchTeam != null && s.pitched.indexOf(s.pitchTeam) < 0) s.pitched.push(s.pitchTeam);
      s.pitchTeam = pt;
      s.phase = 'pitch';
      return { force: true };
    }
    case 'dealWorlds': { dealWorlds_(s); return { force: true }; }

    case 'setTeamMode': {
      if (req.mode) s.teamMode = req.mode === 'host' ? 'host' : 'self';
      if (req.size) s.teamSize = Math.max(1, Math.min(10, Number(req.size)));
      return {};
    }

    case 'autoTeams': {
      var ids = s.order.filter(function (pid) { return s.players[pid]; });
      if (!req.keep) { ids.forEach(function (pid) { s.players[pid].team = null; }); s.teams.forEach(function (tt) { tt.votes = {}; tt.captain = null; }); }
      var free = shuffle_(ids.filter(function (pid) { return s.players[pid].team == null; }));
      free.forEach(function (pid) {
        var best = 0;
        for (var tj = 1; tj < s.teams.length; tj++) if (teamSize_(s, tj) < teamSize_(s, best)) best = tj;
        s.players[pid].team = best;
      });
      return { force: true };
    }

    case 'assign': {
      p = s.players[req.pid];
      if (!p) return fail_('Игрок не найден');
      if (p.team != null) delete s.teams[p.team].votes[p.id];
      p.team = req.team === null || req.team === '' ? null : Number(req.team);
      return {};
    }

    case 'rename': {
      p = s.players[req.pid];
      if (!p) return fail_('Игрок не найден');
      p.name = clean_(req.name, 40) || p.name;
      return {};
    }

    case 'kick': {
      if (!s.players[req.pid]) return fail_('Игрок не найден');
      var kt = s.players[req.pid].team;
      if (kt != null) { delete s.teams[kt].votes[req.pid]; if (s.teams[kt].captain === req.pid) s.teams[kt].captain = null; }
      delete s.players[req.pid];
      delete s.ratings[req.pid];
      delete s.bets[req.pid];
      s.order = s.order.filter(function (pid) { return pid !== req.pid; });
      return {};
    }

    case 'unlockMap': {
      t = s.teams[Number(req.team)];
      if (!t) return fail_('Нет такой команды');
      t.submitted = false;
      return {};
    }

    case 'setBudget': {
      t = s.teams[Number(req.team)];
      if (!t) return fail_('Нет такой команды');
      t.budget = Math.max(0, Math.floor(Number(req.budget) || 0));
      return {};
    }

    case 'startLots': {
      var list = [].concat(req.projects || []).filter(function (pr) {
        return PROJECTS.indexOf(pr) >= 0 &&
          !s.auction.results.some(function (x) { return x.project === pr; }) &&
          !s.auction.open.some(function (x) { return x.project === pr; });
      });
      if (!list.length) return fail_('Выберите хотя бы один свободный лот');
      var sec = Math.max(10, Math.min(300, Number(req.seconds) || 40));
      list.forEach(function (pr) { s.auction.open.push({ project: pr, startedAt: now, endsAt: now + sec * 1000, seconds: sec, bids: {} }); });
      s.phase = 'auction';
      return { force: true };
    }

    case 'closeLot': {
      var target = null;
      s.auction.open.forEach(function (x) { if (x.project === req.project) target = x; });
      if (!target) return {}; // уже закрыт
      return { force: true, result: closeLot_(s, target, now) };
    }

    case 'closeAll': {
      var results = s.auction.open.slice().map(function (x) { return closeLot_(s, x, now); });
      return { force: true, results: results };
    }

    case 'cancelLot': {
      s.auction.open = s.auction.open.filter(function (x) { return x.project !== req.project; });
      return {};
    }

    case 'undoLot': {
      var last = s.auction.results.pop();
      if (last && last.team != null) s.teams[last.team].budget += last.price;
      return {};
    }

    case 'spin': {
      var w = req.world && WORLDS.indexOf(req.world) >= 0 ? req.world : WORLDS[Math.floor(Math.random() * WORLDS.length)];
      s.reveal = { world: w, at: now, spinId: uid_() };
      s.phase = 'reveal';
      return { force: true };
    }

    // ----- шоки: кубик решает, сколько их будет (1 или 2) -----
    case 'rollDice': {
      var val = req.value === 1 || req.value === 2 ? req.value : 1 + Math.floor(Math.random() * 2);
      s.dice = { value: val, at: now, id: uid_() };
      s.shocks = [];
      s.phase = 'shock';
      return { force: true };
    }

    case 'drawShock': {
      if (!s.dice) return fail_('Сначала бросьте кубик');
      if (s.shocks.length >= s.dice.value) return fail_('Все шоки уже вытянуты');
      var k2 = req.shock;
      if (k2 && (!SHOCKS[k2] || s.shocks.indexOf(k2) >= 0)) return fail_('Эта карта недоступна');
      if (!k2) {
        var left = Object.keys(SHOCKS).filter(function (x) { return s.shocks.indexOf(x) < 0; });
        k2 = left[Math.floor(Math.random() * left.length)];
      }
      s.shocks.push(k2);
      s.shockAt = now;
      s.phase = 'shock';
      return { force: true };
    }

    case 'clearShocks': {
      s.shocks = []; s.dice = null;
      return { force: true };
    }

    case 'setBet': {
      if (!BETS[req.qid]) return fail_('Нет такого вопроса');
      if (!s.reveal) return fail_('Сначала раскрутите колесо — баллы считаются после него');
      s.bet = { qid: req.qid, open: true, revealed: false, at: now };
      s.bets = {};
      s.phase = 'bet';
      return { force: true };
    }

    case 'revealBet': {
      if (!s.bet) return fail_('Вопрос ещё не выбран');
      s.bet.open = false;
      s.bet.revealed = true;
      s.bet.revealedAt = now;
      return { force: true };
    }

    case 'grade': {
      if (!s.players[req.pid]) return fail_('Игрок не найден');
      var g = s.grades[req.pid] || {};
      ['c1', 'c2', 'c3', 'c4'].forEach(function (k) {
        if (req[k] !== undefined && req[k] !== null && req[k] !== '') g[k] = Number(req[k]);
      });
      if (req.note !== undefined) g.note = clean_(req.note, 300);
      if (req.by) g.by = clean_(req.by, 40);
      g.at = now;
      s.grades[req.pid] = g;
      return {};
    }

    case 'export': {
      exportSheets_(s);
      return { force: true };
    }

    case 'reset': {
      var old = s;
      var fresh = newState_();
      if (req.keepPlayers) {
        fresh.players = old.players;
        fresh.order = old.order;
        fresh.phase = 'lobby';
        Object.keys(fresh.players).forEach(function (pid) { fresh.players[pid].team = null; });
      }
      Object.keys(s).forEach(function (k) { delete s[k]; });
      Object.keys(fresh).forEach(function (k) { s[k] = fresh[k]; });
      s.v = (old.v || 0) + 1;
      return { force: true };
    }
  }
  return fail_('Неизвестное действие: ' + a);
}

function teamSize_(s, ti) {
  var n = 0;
  Object.keys(s.players).forEach(function (pid) { if (s.players[pid].team === ti) n++; });
  return n;
}

// ---------------- Подсчёт очков ----------------
function projectZone_(s, project, teamId) {
  var t = s.teams[teamId];
  if (t && t.placements[project]) return t.placements[project];
  var counts = {};
  s.teams.forEach(function (tt) {
    var z = tt.placements[project];
    if (z) counts[z] = (counts[z] || 0) + 1;
  });
  var best = null;
  Object.keys(counts).forEach(function (z) { if (!best || counts[z] > counts[best]) best = z; });
  return best;
}

function placeMod_(s, project, teamId) {
  var z = projectZone_(s, project, teamId);
  var rule = z && ZONE_RULES[project] && ZONE_RULES[project][z];
  return rule ? rule[0] : 0;
}

function placeText_(s, project, teamId) {
  var z = projectZone_(s, project, teamId);
  var rule = z && ZONE_RULES[project] && ZONE_RULES[project][z];
  return rule ? rule[1] : '';
}

function shockMod_(s, project, teamId) {
  var v = 0;
  (s.shocks || []).forEach(function (k) {
    var sh = SHOCKS[k];
    if (sh.mods[project]) v += sh.mods[project];
    if (sh.zone && projectZone_(s, project, teamId) === sh.zone) v += sh.zoneMod;
  });
  return v;
}

// «Кандидаты в устойчивые»: решения, которые независимо выбрали CONSENSUS_MIN и больше команд
// (а значит, они нужны сразу в нескольких мирах), получают поддержку всего министерства: +CONSENSUS_BONUS во всех мирах.
function consensus_(s) {
  var c = {}, out = {};
  s.teams.forEach(function (t) { Object.keys(t.placements || {}).forEach(function (p) { c[p] = (c[p] || 0) + 1; }); });
  Object.keys(c).forEach(function (p) { if (c[p] >= CONSENSUS_MIN) out[p] = c[p]; });
  return out;
}

function consMod_(s, project) { return consensus_(s)[project] ? CONSENSUS_BONUS : 0; }

function value_(s, project, worldIdx, teamId, withShock) {
  return PAYOFF[project][worldIdx] + placeMod_(s, project, teamId) + consMod_(s, project) + (withShock ? shockMod_(s, project, teamId) : 0);
}

function score_(s) {
  var wIdx = WORLDS.indexOf(s.reveal.world);
  var teams = s.teams.map(function (t) {
    var won = s.auction.results.filter(function (x) { return x.team === t.id; });
    var byWorld = WORLDS.map(function (w, wi) {
      return won.reduce(function (acc, x) { return acc + value_(s, x.project, wi, t.id, false); }, 0);
    });
    var actual = won.reduce(function (acc, x) { return acc + value_(s, x.project, wIdx, t.id, true); }, 0);
    var min = byWorld.length ? Math.min.apply(null, byWorld) : 0;
    var avg = byWorld.reduce(function (a2, b) { return a2 + b; }, 0) / WORLDS.length;
    return {
      team: t.id,
      projects: won.map(function (x) {
        return {
          project: x.project, price: x.price, zone: projectZone_(s, x.project, t.id),
          base: PAYOFF[x.project][wIdx], place: placeMod_(s, x.project, t.id), placeText: placeText_(s, x.project, t.id), cons: consMod_(s, x.project),
          shock: shockMod_(s, x.project, t.id), value: value_(s, x.project, wIdx, t.id, true)
        };
      }),
      byWorld: byWorld, base: byWorld[wIdx], actual: actual, min: min, avg: Math.round(avg * 10) / 10, left: t.budget
    };
  });
  var city = teams.reduce(function (acc, x) { return acc + x.actual; }, 0);
  return { world: s.reveal.world, teams: teams, city: city };
}

// Баллы за игру: 50 за участие + 10 × результат в наступившем мире (с шоками) + 10 × результат в худшем из миров.
// Так награждается и удача, и устойчивость стратегии. Не меньше 10.
function points_(s) {
  var sc = score_(s);
  var teams = sc.teams.map(function (x) {
    var pts = Math.max(10, 50 + 10 * x.actual + 10 * x.min);
    return { team: x.team, actual: x.actual, min: x.min, points: pts };
  });
  var ranked = teams.slice().sort(function (a, b) { return b.points - a.points || b.min - a.min || b.actual - a.actual; });
  ranked.forEach(function (x, k) { teams[x.team].place = k + 1; });
  var players = {};
  var answer = s.bet && s.bet.revealed ? BETS[s.bet.qid].correct : null;
  s.order.forEach(function (pid) {
    var p = s.players[pid];
    if (!p || p.team == null) return;
    var base = teams[p.team].points;
    var b = s.bets[pid];
    var delta = 0;
    if (b && answer != null) delta = b.option === answer ? b.stake : -b.stake;
    players[pid] = { team: p.team, base: base, delta: delta, total: base + delta };
  });
  return { teams: teams, players: players };
}

// ---------------- Выгрузка в таблицу ----------------
function exportSheets_(s) {
  var pts = s.reveal ? points_(s) : null;
  var sh = sheet_('Оценки');
  sh.clear();
  var rows = [['Игрок', 'Команда', 'Капитан', 'Вовлечённость (0–3)', 'Анализ мира (0–3)', 'Обоснованность решений (0–2)', 'Рефлексия (0–2)', 'Итог (0–10)', 'Комментарий', 'Куратор', 'Баллы за игру', 'Ставка', 'Итог после ставки']];
  s.order.forEach(function (id) {
    var p = s.players[id];
    if (!p) return;
    var g = s.grades[id] || {};
    var total = ['c1', 'c2', 'c3', 'c4'].reduce(function (a, k) { return a + (Number(g[k]) || 0); }, 0);
    var pp = pts && pts.players[id];
    var b = s.bets[id];
    rows.push([p.name, p.team == null ? '—' : 'Команда ' + (p.team + 1), p.team != null && s.teams[p.team].captain === id ? 'да' : '',
      g.c1 == null ? '' : g.c1, g.c2 == null ? '' : g.c2, g.c3 == null ? '' : g.c3, g.c4 == null ? '' : g.c4, total, g.note || '', g.by || '',
      pp ? pp.base : '', b ? b.stake : '', pp ? pp.total : '']);
  });
  sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);

  var sh2 = sheet_('Итоги');
  sh2.clear();
  var rows2 = [['Команда', 'Мир', 'Название мира', 'Для жителей', 'Для сотрудников', 'Для министра', 'Ранние признаки', 'Обоснование плана', 'Решения по блокам', 'Купленные решения', 'Очки в наступившем мире', 'Минимум по мирам', 'Баллы за игру', 'Место', 'Ответ на шок']];
  var sc = s.reveal ? score_(s) : null;
  s.teams.forEach(function (t) {
    var won = s.auction.results.filter(function (x) { return x.team === t.id; }).map(function (x) { return x.project + ' (' + x.price + ')'; }).join(', ');
    var st = sc ? sc.teams[t.id] : null;
    var tp = pts ? pts.teams[t.id] : null;
    rows2.push(['Команда ' + t.no, t.world || '', t.title, t.residents, t.business, t.government, t.signposts, t.rationale,
      Object.keys(t.placements).map(function (k) { return k + '→' + t.placements[k]; }).join(', '),
      won, st ? st.actual : '', st ? st.min : '', tp ? tp.points : '', tp ? tp.place : '', t.shockAnswer]);
  });
  sh2.getRange(1, 1, rows2.length, rows2[0].length).setValues(rows2);

  var sh3 = sheet_('Сигналы');
  sh3.clear();
  var rows3 = [['Игрок', 'Тип', 'Сигнал']];
  s.signals.forEach(function (x) { rows3.push([x.name, x.type, x.text]); });
  sh3.getRange(1, 1, rows3.length, 3).setValues(rows3);
}

// Запустите один раз вручную из редактора, чтобы выдать скрипту доступ к таблице.
function setup() {
  sheet_('state');
  Logger.log('Готово. Теперь: Развернуть → Новое развертывание → Веб-приложение.');
}

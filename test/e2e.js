// Полный прогон игры v9 «Министерство в 5 мирах»: 20 игроков + ведущий + проектор, через настоящий интерфейс.
const { chromium } = require('playwright');
const BASE = 'http://localhost:8787/';
const API = 'http://localhost:8787/exec';
const URL = BASE + '?api=' + encodeURIComponent(API);
const SHOTS = process.env.SHOTS || '/tmp/claude-0/shots';
const N = Number(process.env.N || 20);
const fs = require('fs');
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
const post = (body) => fetch(API, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.json());
const state = (q) => fetch(API + '?a=state' + (q || '')).then((r) => r.json());

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  async function page(viewport, url) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
    await p.goto(url);
    return p;
  }
  await post({ a: 'reset', pin: '2040' });
  const screen = await page({ width: 1600, height: 900 }, URL + '#screen');
  const host = await page({ width: 1280, height: 900 }, URL + '#host');
  await host.fill('[data-key="pin"]', '2040');
  await host.click('form[data-form="pin"] button');
  await host.waitForSelector('.hphases');
  await sleep(3000);
  await screen.screenshot({ path: SHOTS + '/00a-intro1.png' });
  await sleep(6000);
  await screen.screenshot({ path: SHOTS + '/00b-intro1-later.png' });
  for (const k of [1, 2, 3, 4, 5, 6]) {
    await host.click(`button[data-act="intro"][data-step="${k}"]`);
    await sleep(2600);
    if ([3, 4, 6].includes(k)) await screen.screenshot({ path: SHOTS + `/00-intro${k + 1}.png` });
  }

  const names = ['Аня Смирнова', 'Борис Ким', 'Вера Лис', 'Гоша Петров', 'Даша Орлова', 'Егор Павлов', 'Женя Ли', 'Зоя Мороз', 'Илья Гусев', 'Катя Белова', 'Лёша Ткач', 'Маша Ерёма', 'Никита Фом', 'Оля Зуева', 'Паша Рыжов', 'Рита Сом', 'Саша Юдин', 'Тима Волков', 'Уля Ноль', 'Фёдор Кот'];
  const players = [];
  for (let i = 0; i < N; i++) {
    const p = await page({ width: 390, height: 844 }, URL);
    await p.fill('[data-key="name"]', names[i]);
    await p.click('form[data-form="join"] button');
    players.push(p);
  }
  await Promise.all(players.map((p) => p.waitForSelector('.pstrip', { timeout: 15000 })));
  await players[0].screenshot({ path: SHOTS + '/01a-player-rules.png', fullPage: true });
  await post({ a: 'setPhase', phase: 'lobby', pin: '2040' });
  await sleep(6000);
  await screen.screenshot({ path: SHOTS + '/02-screen-lobby.png' });

  // сигналы
  await post({ a: 'setPhase', phase: 'signals', pin: '2040' });
  await Promise.all(players.map((p) => p.waitForSelector('.types', { timeout: 20000 })));
  const types = ['trend', 'weak', 'driver', 'wild'];
  for (let i = 0; i < 8; i++) {
    await players[i].click(`button[data-act="sigType"][data-type="${types[i % 4]}"]`);
    await players[i].fill('[data-key="sig"]', 'Сигнал номер ' + (i + 1));
    await players[i].click('form[data-form="signal"] button');
    await sleep(200);
  }
  // по одному сигналу в категорию
  const pid0 = await players[0].evaluate(() => localStorage.getItem('m5:pid'));
  const dupSig = await post({ a: 'signal', pid: pid0, type: 'trend', text: 'Ещё один тренд' });
  if (dupSig.ok) errors.push('second signal of same type allowed');
  const okSig = await post({ a: 'signal', pid: pid0, type: 'wild', text: 'Джокер от первого игрока' });
  if (!okSig.ok) errors.push('second signal of other type rejected: ' + okSig.error);
  await sleep(2500);
  await players[1].screenshot({ path: SHOTS + '/02b-player-signal-used.png', fullPage: true });
  const usedBtn = await players[1].$('button.type.used[data-type="weak"]');
  if (!usedBtn) errors.push('used signal type not disabled');
  await screen.screenshot({ path: SHOTS + '/02c-screen-signals.png' });

  // факторы: каждый оценивает 8 сил
  await post({ a: 'setPhase', phase: 'factors', pin: '2040' });
  await Promise.all(players.map((p) => p.waitForSelector('.fcard', { timeout: 20000 })));
  const fpids = await Promise.all(players.map((p) => p.evaluate(() => localStorage.getItem('m5:pid'))));
  const base = { f1: [4, 4], f2: [5, 4], f3: [4, 3], f4: [3, 2], f5: [4, 3], f6: [3, 2], f7: [2, 3], f8: [3, 1] };
  for (let i = 1; i < N; i++) {
    const r = {};
    Object.keys(base).forEach((f, j) => { r[f] = [Math.max(1, Math.min(5, base[f][0] + ((i + j) % 3) - 1)), Math.max(1, Math.min(5, base[f][1] + ((i * 2 + j) % 3) - 1))]; });
    await post({ a: 'rate', pid: fpids[i], ratings: r });
  }
  for (let k = 0; k < 8; k++) { await players[0].click(`.fcard:nth-of-type(${k + 1}) button[data-axis="0"][data-v="${3 + (k % 3)}"]`).catch(() => {}); }
  await players[0].screenshot({ path: SHOTS + '/02d-player-factors.png', fullPage: true });
  await post({ a: 'showAxes', pin: '2040' });
  await sleep(3500);
  await screen.screenshot({ path: SHOTS + '/02e-screen-factors.png' });

  // команды
  await post({ a: 'setPhase', phase: 'teams', pin: '2040' });
  await Promise.all(players.map((p) => p.waitForSelector('.teampick', { timeout: 20000 })));
  for (let i = 0; i < 10; i++) { await players[i].click(`.tpick[data-team="${i % 5}"]`); await sleep(150); }
  await post({ a: 'autoTeams', keep: true, pin: '2040' });
  await sleep(4500);
  const st1 = await state('&pin=2040');
  const pids = await Promise.all(players.map((p) => p.evaluate(() => localStorage.getItem('m5:pid'))));
  const teamOfP = pids.map((id) => st1.state.players[id].team);
  const firstInTeam = {};
  st1.state.order.forEach((id) => { const t = st1.state.players[id].team; if (t != null && firstInTeam[t] == null) firstInTeam[t] = id; });
  for (let i = 0; i < N; i++) {
    const p = players[i];
    await p.waitForSelector('.capvote', { timeout: 15000 });
    await p.click(`button[data-act="vote"][data-pid="${firstInTeam[teamOfP[i]]}"]`);
    await sleep(120);
  }
  await sleep(3500);
  await players[1].screenshot({ path: SHOTS + '/03-player-vote.png', fullPage: true });
  await screen.screenshot({ path: SHOTS + '/04-screen-teams.png' });

  // миры: капитаны закрепляются
  await host.click('button[data-act="phase"][data-phase="world"]');
  await Promise.all(players.map((p) => p.waitForSelector('.wcard', { timeout: 20000 })));
  const st2 = await state('&pin=2040');
  st2.state.teams.forEach((t) => { if (t.captain !== firstInTeam[t.id]) errors.push('captain mismatch team ' + t.id); });
  const capIdx = {}, otherIdx = {};
  pids.forEach((id, i) => { const t = teamOfP[i]; if (id === firstInTeam[t]) capIdx[t] = i; else if (otherIdx[t] == null) otherIdx[t] = i; });
  for (const t of Object.keys(capIdx)) {
    const p = players[capIdx[t]];
    await p.fill('[data-field="title"]', 'Мир команды ' + (Number(t) + 1));
    await p.fill('[data-field="residents"]', 'Жителям нужна работа.');
    await p.locator('[data-field="residents"]').blur();
  }
  await sleep(5000);
  for (const t of Object.keys(otherIdx)) {
    const ro = await players[otherIdx[t]].$$('.field.ro');
    if (!ro.length) errors.push('non-captain can edit, team ' + t);
    const txt = await players[otherIdx[t]].$eval('.field.ro .rotext', (e) => e.textContent);
    if (!txt.includes('Мир команды')) errors.push('non-captain does not see captain text: ' + txt);
  }
  const bad = await post({ a: 'field', pid: pids[otherIdx[0]], field: 'title', value: 'взлом' });
  if (bad.ok) errors.push('non-captain field write allowed');
  await players[capIdx[0]].screenshot({ path: SHOTS + '/05-captain-world.png', fullPage: true });
  await screen.screenshot({ path: SHOTS + '/05a-screen-matrix.png' });
  await players[otherIdx[0]].screenshot({ path: SHOTS + '/06-member-world.png', fullPage: true });

  // рассказ команд
  await host.click('button[data-act="phase"][data-phase="pitch"]');
  await Promise.all(players.map((p) => p.waitForSelector('.pitchans', { timeout: 20000 })));
  await sleep(1500);
  await screen.screenshot({ path: SHOTS + '/06a-screen-pitch.png' });
  await host.screenshot({ path: SHOTS + '/06b-host-pitch.png', fullPage: true });
  const curPitch = (await state()).state.pitchTeam;
  await players[capIdx[curPitch]].screenshot({ path: SHOTS + '/06c-player-pitch-me.png', fullPage: true });
  await players[otherIdx[(curPitch + 1) % 5]].screenshot({ path: SHOTS + '/06d-player-pitch-other.png', fullPage: true });
  await host.click('button.pnext');
  await sleep(3000);
  const stp = await state();
  if (stp.state.pitchTeam === curPitch) errors.push('pitch did not advance');
  if (!stp.state.pitched.includes(curPitch)) errors.push('pitched list not updated');
  await screen.screenshot({ path: SHOTS + '/06e-screen-pitch2.png' });

  // внедрение: решения → блоки замминистров
  await host.click('button[data-act="phase"][data-phase="map"]');
  await Promise.all(players.map((p) => p.waitForSelector('.plan', { timeout: 20000 })));
  await sleep(1500);
  await screen.screenshot({ path: SHOTS + '/07-screen-map.png' });
  const plans = [[['p01', 'b2'], ['p13', 'b4'], ['p16', 'b5']], [['p01', 'b2'], ['p09', 'b3'], ['p06', 'b1']], [['p01', 'b1'], ['p15', 'b5'], ['p03', 'b2']], [['p10', 'b3'], ['p05', 'b2']], [['p11', 'b3'], ['p04', 'b2']]];
  for (const t of Object.keys(capIdx)) {
    const p = players[capIdx[t]];
    for (const [proj, blk] of plans[t]) {
      await p.click(`button[data-act="pick"][data-project="${proj}"]`);
      await p.click(`button[data-act="pickBlock"][data-block="${blk}"]`);
      if (t === '0' && proj === 'p01') await p.screenshot({ path: SHOTS + '/07a-picker.png' });
      await p.click('button[data-act="placeBlock"]');
      await p.waitForFunction(() => !document.querySelector('.picker'), null, { timeout: 10000 });
      await sleep(400);
    }
    if (t === '0') {
      // в блок помещается столько решений, сколько в нём отделов: в «Безопасности и праве» их два
      const ok2 = await post({ a: 'place', pid: pids[capIdx[0]], project: 'p14', block: 'b4' });
      if (!ok2.ok) errors.push('second solution in b4 rejected: ' + ok2.error);
      const over = await post({ a: 'place', pid: pids[capIdx[0]], project: 'p18', block: 'b4' });
      if (over.ok) errors.push('third solution in 2-dept block allowed');
      await sleep(2500);
      await p.click('button[data-act="pick"][data-project="p18"]');
      await sleep(300);
      const dis = await p.$eval('button[data-act="pickBlock"][data-block="b4"]', (b) => b.disabled);
      if (!dis) errors.push('full block not disabled');
      await p.screenshot({ path: SHOTS + '/07b-picker-full.png' });
      await p.click('button[data-act="cancelPick"]');
      await post({ a: 'place', pid: pids[capIdx[0]], project: 'p14', block: '' });
      await sleep(2500);
    }
    p.once('dialog', (d) => d.accept());
    await p.click('button[data-act="submitMap"]');
    await sleep(500);
  }
  await sleep(4000);
  await players[capIdx[0]].screenshot({ path: SHOTS + '/07c-captain-plan.png', fullPage: true });
  await screen.screenshot({ path: SHOTS + '/07d-screen-map-done.png' });

  // наложение
  await host.click('button[data-act="phase"][data-phase="overlay"]');
  await sleep(3500);
  const sto = await state();
  if (!(sto.state.consensus || []).includes('p01')) errors.push('p01 should be consensus');
  await screen.screenshot({ path: SHOTS + '/07e-screen-overlay.png' });
  await players[otherIdx[3]].screenshot({ path: SHOTS + '/07f-player-overlay.png', fullPage: true });

  // аукцион: три лота сразу
  await host.click('button[data-act="phase"][data-phase="auction"]');
  await sleep(1500);
  await host.selectOption('select[data-act-change="lotSeconds"]', '90');
  for (const pr of ['p01', 'p13', 'p16']) { await host.check(`input[data-act-change="selLot"][data-project="${pr}"]`); await sleep(150); }
  await host.click('button[data-act="startLots"]');
  await Promise.all(Object.values(capIdx).map((i) => players[i].waitForSelector('.lot', { timeout: 15000 })));
  let k = 0;
  for (const t of Object.keys(capIdx)) {
    const p = players[capIdx[t]];
    for (const pr of ['p01', 'p13', 'p16']) {
      for (let j = 0; j < (k + pr.charCodeAt(2)) % 4; j++) await p.click(`button[data-act="bidStep"][data-project="${pr}"][data-d="5"]`);
      await p.click(`button[data-act="bid"][data-project="${pr}"]`);
      await sleep(150);
    }
    k++;
  }
  await sleep(2500);
  await players[capIdx[1]].screenshot({ path: SHOTS + '/08-captain-auction.png', fullPage: true });
  await players[otherIdx[1]].screenshot({ path: SHOTS + '/09-member-auction.png' });
  await screen.screenshot({ path: SHOTS + '/10-screen-auction.png' });
  await host.screenshot({ path: SHOTS + '/11-host-auction.png', fullPage: true });
  const v = await state('&pid=' + pids[capIdx[0]]);
  v.state.auction.open.forEach((lot) => Object.keys(lot.bids).forEach((tid) => { if (Number(tid) !== 0 && lot.bids[tid].amount != null) errors.push('bid leak'); }));
  if (!v.state.auction.open.length) errors.push('no open lots seen');
  await host.click('button[data-act="closeAll"]');
  await host.waitForFunction(() => !document.querySelector('.hlot'), null, { timeout: 40000 });
  await sleep(1500);
  const st3 = await state('&pin=2040');
  console.log('results:', JSON.stringify(st3.state.auction.results.map((r) => [r.project, r.team, r.price])), 'budgets:', st3.state.teams.map((t) => t.budget).join(','));
  if (st3.state.auction.results.length !== 3) errors.push('expected 3 sold lots');
  const p01 = st3.state.auction.results.find((r) => r.project === 'p01');
  await screen.screenshot({ path: SHOTS + '/12-screen-auction-done.png' });

  // судьба
  await host.click('button[data-act="phase"][data-phase="reveal"]');
  await sleep(1000);
  await host.click('button[data-act="spin"]');
  await sleep(3000);
  await screen.screenshot({ path: SHOTS + '/12a-screen-spin.png' });
  await sleep(5500);
  await screen.screenshot({ path: SHOTS + '/12b-screen-reveal.png' });
  await players[4].screenshot({ path: SHOTS + '/12c-player-reveal.png', fullPage: true });

  // шоки: кубик на 2
  await host.click('button[data-act="phase"][data-phase="shock"]');
  await sleep(1500);
  await host.selectOption('select[data-act-change="diceValue"]', '2');
  await sleep(1300);
  await screen.screenshot({ path: SHOTS + '/13-screen-dice.png' });
  await sleep(2500);
  await host.click('button[data-act="drawShock"][data-shock="s1"]');
  await sleep(2500);
  await screen.screenshot({ path: SHOTS + '/14-screen-shock1.png' });
  await host.click('button[data-act="drawShock"][data-shock=""]');
  await sleep(3500);
  await screen.screenshot({ path: SHOTS + '/15-screen-shock2.png' });
  await players[capIdx[2]].screenshot({ path: SHOTS + '/16-player-shock.png', fullPage: true });
  const st4 = await state('&pin=2040');
  if (p01 && p01.team != null) {
    const pr = st4.state.score.teams[p01.team].projects.find((x) => x.project === 'p01');
    if (!pr || pr.cons !== 1) errors.push('consensus bonus missing in score');
  }
  if (st4.state.shocks.length !== 2) errors.push('expected 2 shocks');

  // итоги
  await host.click('button[data-act="phase"][data-phase="results"]');
  await sleep(4500);
  await screen.screenshot({ path: SHOTS + '/17-screen-results.png' });
  await players[capIdx[0]].screenshot({ path: SHOTS + '/18-player-results.png', fullPage: true });

  // финальная ставка
  await host.click('button[data-act="phase"][data-phase="bet"]');
  await sleep(1000);
  await host.click('button[data-act="setBet"][data-q="q1"]');
  await Promise.all(players.map((p) => p.waitForSelector('.betopts', { timeout: 20000 })));
  for (let i = 0; i < 10; i++) {
    const p = players[i];
    await p.click(`button[data-act="betOpt"][data-i="${i % 3 === 0 ? 1 : i % 5}"]`);
    if (i % 2) await p.click('button[data-act="betAll"]'); else await p.click('button[data-act="betStep"][data-d="10"]');
    await p.click('button[data-act="placeBet"]');
    await sleep(200);
  }
  await sleep(2500);
  await players[3].screenshot({ path: SHOTS + '/19-player-bet.png', fullPage: true });
  await screen.screenshot({ path: SHOTS + '/20-screen-bet.png' });
  const before = await state('&pin=2040');
  const pub = await state();
  if (pub.state.bets && Object.keys(pub.state.bets).length) errors.push('bets leaked before reveal');
  host.once('dialog', (d) => d.accept());
  await host.click('button[data-act="revealBet"]');
  await sleep(4000);
  await screen.screenshot({ path: SHOTS + '/21-screen-bet-reveal.png' });
  await players[0].screenshot({ path: SHOTS + '/22-player-bet-result.png', fullPage: true });
  const after = await state('&pin=2040');
  Object.keys(after.state.bets).forEach((id) => {
    const b = after.state.bets[id], pp = after.state.points.players[id];
    const expect = b.option === 1 ? pp.base + b.stake : pp.base - b.stake;
    if (pp.total !== expect) errors.push('bet math wrong for ' + id);
  });
  console.log('bets:', Object.keys(before.state.bets).length, 'winners:', Object.values(after.state.points.players).filter((x) => x.delta > 0).length);

  await host.click('button[data-act="phase"][data-phase="final"]');
  await sleep(4500);
  await screen.screenshot({ path: SHOTS + '/23-screen-final.png' });
  await players[5].screenshot({ path: SHOTS + '/24-player-final.png', fullPage: true });

  await host.goto(URL + '#curator');
  await host.waitForSelector('.gcard', { timeout: 15000 });
  await host.click('button[data-act="grade"][data-k="c1"][data-v="3"]');
  await sleep(1500);
  await host.screenshot({ path: SHOTS + '/25-curator.png', fullPage: true });
  await host.goto(URL + '#host');
  await host.waitForSelector('.hphases', { timeout: 15000 });
  await host.click('button[data-act="export"]');
  await sleep(2000);
  const sheet = await (await fetch(BASE + '__sheet?n=' + encodeURIComponent('Оценки'))).json();
  console.log('sheet rows:', sheet && sheet.length, JSON.stringify(sheet && sheet[1]));
  const stt = await (await fetch(BASE + '__stats')).json();
  console.log('api calls:', stt.calls);
  console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'NO ERRORS');
  await browser.close();
})().catch((e) => { console.error('FAIL', e); console.log([...new Set(errors)].join('\n')); process.exit(1); });

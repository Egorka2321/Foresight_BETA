/* Заставка: точки-сигналы. Шаг 0 — свободно плывут по всему экрану по плавному «течению» и связываются тонкими нитями,
   шаг 1 — собираются в тренды, шаг 2 — в матрицу миров, шаг 3 — в устойчивые решения. */
(function () {
  'use strict';
  var BLUES = ['#5AA9FF', '#8CC8FF', '#2F7BFF', '#BFE3FF', '#49D3F5', '#7FA8FF'];
  var TRENDS = ['Старение', 'Автоматизация', 'Удалёнка', 'Отток молодёжи', 'Климат', 'Господдержка', 'Цены на сталь'];
  var WORLDS = [['A', 'Новая сталь'], ['C', 'Перезапуск'], ['B', 'Тихий цех'], ['D', 'Последний гудок'], ['E', 'Инерция']];

  function Swarm(n, opts) {
    this.n = n || 220;
    this.opts = opts || {};
    this.dots = [];
    this.step = -1;
    this.t0 = performance.now();
    this.last = this.t0;
    this.canvas = null;
    this.clusters = [];
    this.x0 = 0; this.x1 = 1; // область, где собираются кластеры (на проекторе — справа от текста)
    this.fade = 0;            // левая часть экрана, где точки притушены, чтобы не мешать тексту
    for (var i = 0; i < this.n; i++) {
      this.dots.push({
        x: Math.random(), y: Math.random(), tx: 0, ty: 0, vx: 0, vy: 0,
        r: 1.1 + Math.pow(Math.random(), 1.6) * 2.9, c: BLUES[Math.floor(Math.random() * BLUES.length)],
        born: Math.random() * 2600, ph: Math.random() * Math.PI * 2, g: 0, robust: Math.random() < 0.16,
        sp: 0.55 + Math.random() * 0.9, // индивидуальная скорость дрейфа
        z: 0.4 + Math.random() * 0.6,   // «глубина»: дальние точки мельче, тусклее и медленнее
      });
    }
    this.setStep(0);
  }

  Swarm.prototype.region = function (x0, x1, fade) {
    if (this.x0 === x0 && this.x1 === x1 && this.fade === fade) return;
    this.x0 = x0; this.x1 = x1; this.fade = fade || 0;
    var s = this.step; this.step = -1; if (s > 0) this.setStep(s); else this.step = s;
  };
  function rx(self, v) { return self.x0 + v * (self.x1 - self.x0); }

  Swarm.prototype.setStep = function (step) {
    if (step === this.step) return;
    this.step = step;
    this.stepAt = performance.now();
    var self = this;
    if (step === 0) {
      // из кластеров точки сначала мягко разлетаются по всему экрану, потом их подхватывает течение
      var scatter = this.clusters.length > 0;
      this.dots.forEach(function (d) { d.g = -1; if (scatter) { d.tx = 0.02 + Math.random() * 0.96; d.ty = 0.03 + Math.random() * 0.94; } });
      this.scatterUntil = scatter ? performance.now() + 4500 : 0;
      this.clusters = [];
    } else if (step === 1) {
      var cs = [];
      for (var tries = 0; cs.length < TRENDS.length && tries < 3000; tries++) {
        var c = { x: 0.12 + Math.random() * 0.76, y: 0.18 + Math.random() * 0.66 };
        var gap = tries > 1500 ? 0.12 : 0.2;
        if (cs.every(function (o) { return Math.hypot(o.x - c.x, (o.y - c.y) * 0.6) > gap; })) cs.push(c);
      }
      while (cs.length < TRENDS.length) cs.push({ x: 0.12 + Math.random() * 0.76, y: 0.18 + Math.random() * 0.66 });
      this.clusters = cs.map(function (c, i) { return { x: rx(self, c.x), y: c.y, label: TRENDS[i] }; });
      var sx = this.x1 - this.x0;
      this.dots.forEach(function (d, i) {
        d.g = i % TRENDS.length;
        var cl = self.clusters[d.g], a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * 0.075;
        d.tx = cl.x + Math.cos(a) * rr * sx; d.ty = cl.y + Math.sin(a) * rr * 1.5;
      });
    } else {
      var pos = [{ x: 0.27, y: 0.28 }, { x: 0.73, y: 0.28 }, { x: 0.27, y: 0.74 }, { x: 0.73, y: 0.74 }, { x: 0.5, y: 0.51 }];
      var sx2 = this.x1 - this.x0;
      this.clusters = pos.map(function (p, i) { return { x: rx(self, p.x), y: p.y, label: WORLDS[i][0] + ' · ' + WORLDS[i][1] }; });
      this.dots.forEach(function (d, i) {
        d.g = i % 5;
        var cl = self.clusters[d.g], a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * (d.g === 4 ? 0.06 : 0.11);
        d.tx = cl.x + Math.cos(a) * rr * sx2; d.ty = cl.y + Math.sin(a) * rr * 1.4;
      });
    }
  };

  Swarm.prototype.attach = function (canvas) { this.canvas = canvas; };

  // плавное поле течений: сумма медленных синусоид даёт вихри без резких поворотов
  function flow(x, y, t) {
    return Math.sin(x * 3.1 + t * 0.00011) * 1.6 + Math.cos(y * 2.6 - t * 0.00009) * 1.8 +
      Math.sin((x + y) * 1.7 + t * 0.00006) * 1.2 + Math.cos((x - y) * 4.3 - t * 0.00014) * 0.6;
  }
  function smooth(e0, e1, v) { var k = Math.min(1, Math.max(0, (v - e0) / (e1 - e0))); return k * k * (3 - 2 * k); }

  Swarm.prototype.frame = function (now) {
    var cv = this.canvas;
    if (!cv || !cv.isConnected) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var t = now - this.t0, ts = now - this.stepAt;
    var dt = Math.min(50, Math.max(0, now - this.last)); this.last = now;
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var k = reduce ? 1 : 0.035, step = this.step, self = this;
    var minD = Math.min(W, H), fade = this.fade;
    var X0 = this.x0 * W, XW = (this.x1 - this.x0) * W;

    // оси матрицы
    if (step >= 2) {
      var a = Math.min(1, ts / 900), mx = X0 + XW * 0.5;
      ctx.strokeStyle = 'rgba(140,200,255,' + (0.45 * a) + ')';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(mx, H * 0.06); ctx.lineTo(mx, H * 0.96); ctx.moveTo(X0 + XW * 0.04, H * 0.51); ctx.lineTo(X0 + XW * 0.96, H * 0.51); ctx.stroke();
      ctx.fillStyle = 'rgba(190,227,255,' + (0.7 * a) + ')';
      ctx.font = '500 ' + Math.max(10, Math.round(W / 70)) + 'px Unbounded, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Внимание государства', mx, H * 0.04);
      ctx.save(); ctx.translate(X0 + XW * 0.985, H * 0.51); ctx.rotate(Math.PI / 2); ctx.fillText('Судьба комбината', 0, 0); ctx.restore();
    }
    // связи устойчивых решений
    if (step === 3) {
      var core = { x: X0 + XW * 0.5, y: H * 0.51 };
      var la = Math.min(1, ts / 1200);
      this.dots.forEach(function (d) {
        if (!d.robust || d.g === 4) return;
        ctx.strokeStyle = 'rgba(120,220,255,' + (0.22 * la) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(d.x * W, d.y * H); ctx.lineTo(core.x, core.y); ctx.stroke();
      });
      var pr = 18 + Math.sin(t / 380) * 4;
      var grd = ctx.createRadialGradient(core.x, core.y, 0, core.x, core.y, pr * 3);
      grd.addColorStop(0, 'rgba(160,230,255,' + (0.55 * la) + ')'); grd.addColorStop(1, 'rgba(160,230,255,0)');
      ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(core.x, core.y, pr * 3, 0, Math.PI * 2); ctx.fill();
    }

    // движение
    var free = step === 0, ease = free ? Math.min(1, ts / 2500) : 0;
    var scat = free && this.scatterUntil ? Math.max(0, (this.scatterUntil - now) / 4500) : 0;
    this.dots.forEach(function (d) {
      if (free) {
        // дрейф по течению; скорость в пикселях, чтобы движение было одинаковым по горизонтали и вертикали
        var ang = flow(d.x * (W / minD), d.y * (H / minD), t + d.ph * 900) + Math.sin(t * 0.00025 + d.ph * 3) * 0.7;
        var v = (reduce ? 0 : 0.00004) * d.sp * d.z * minD * dt;
        var fx = Math.cos(ang) * v / W, fy = Math.sin(ang) * v / H;
        if (scat > 0) { fx += (d.tx - d.x) * 0.03 * scat; fy += (d.ty - d.y) * 0.03 * scat; }
        // после кластеров точки плавно «отпускаются» в поток
        var m = 0.04 + 0.08 * ease;
        d.vx += (fx - d.vx) * m; d.vy += (fy - d.vy) * m;
        d.x += d.vx; d.y += d.vy;
        // за краем экрана точка появляется с противоположной стороны
        if (d.x < -0.03) d.x += 1.06; else if (d.x > 1.03) d.x -= 1.06;
        if (d.y < -0.04) d.y += 1.08; else if (d.y > 1.04) d.y -= 1.08;
      } else {
        var jx = Math.sin(t / 900 + d.ph) * 0.004, jy = Math.cos(t / 1100 + d.ph) * 0.004;
        d.vx = (d.vx + (d.tx + jx - d.x) * k) * 0.82;
        d.vy = (d.vy + (d.ty + jy - d.y) * k) * 0.82;
        d.x += d.vx; d.y += d.vy;
      }
    });

    // нити между близкими сигналами — живая «сеть» в свободном режиме
    if (free && this.opts.links !== false) {
      var R = minD * 0.11, R2 = R * R, ds = this.dots, la3 = Math.min(1, ts / 1500);
      ctx.lineWidth = 0.8;
      for (var i = 0; i < ds.length; i++) {
        var p = ds[i], px = p.x * W, py = p.y * H;
        if (t - p.born < 500) continue;
        for (var j = i + 1; j < ds.length; j++) {
          var q = ds[j], dx = q.x * W - px, dy = q.y * H - py, dd = dx * dx + dy * dy;
          if (dd > R2 || t - q.born < 500) continue;
          var al = (1 - Math.sqrt(dd) / R) * 0.28 * la3 * Math.min(p.z, q.z);
          if (fade) al *= 0.45 + 0.55 * smooth(fade * 0.25, fade, Math.min(p.x, q.x));
          ctx.strokeStyle = 'rgba(120,190,255,' + al.toFixed(3) + ')';
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(q.x * W, py + dy); ctx.stroke();
        }
      }
    }

    // точки
    this.dots.forEach(function (d) {
      var appear = Math.min(1, Math.max(0, (t - d.born) / 500));
      if (appear <= 0) return;
      var alpha = appear * (step === 3 && !d.robust ? 0.35 : 0.9);
      var r = d.r * (step === 3 && d.robust ? 1.6 : 1);
      if (free) { alpha *= 0.45 + 0.55 * d.z; r *= 0.7 + 0.45 * d.z; }
      if (fade) alpha *= 0.45 + 0.55 * smooth(fade * 0.25, fade, d.x);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = step === 3 && d.robust ? '#E8FBFF' : d.c;
      ctx.beginPath(); ctx.arc(d.x * W, d.y * H, r, 0, Math.PI * 2); ctx.fill();
      // мягкое «дыхание» сигналов: медленная синусоида, без резких вспышек
      if (free) {
        var glow = 0.5 + 0.5 * Math.sin(t / (950 + d.ph * 150) + d.ph * 7);
        if (glow > 0.6) { ctx.globalAlpha = alpha * (glow - 0.6) * 0.5; ctx.beginPath(); ctx.arc(d.x * W, d.y * H, r * (1.6 + glow * 1.6), 0, Math.PI * 2); ctx.fill(); }
      }
    });
    ctx.globalAlpha = 1;
    // подписи кластеров
    if (step >= 1) {
      var la2 = Math.min(1, Math.max(0, (ts - 600) / 700));
      ctx.font = '600 ' + Math.max(11, Math.round(W / 62)) + 'px Golos, sans-serif';
      ctx.textAlign = 'center';
      this.clusters.forEach(function (c, i) {
        var y = c.y * H - (step >= 2 ? H * (i === 4 ? 0.1 : 0.17) : H * 0.12);
        var w = ctx.measureText(c.label).width + 20;
        ctx.globalAlpha = la2;
        ctx.fillStyle = 'rgba(8,28,60,.78)';
        roundRect(ctx, c.x * W - w / 2, y - 15, w, 24, 12); ctx.fill();
        ctx.fillStyle = '#DDF0FF';
        ctx.fillText(c.label, c.x * W, y + 2);
      });
      ctx.globalAlpha = 1;
    }
  };

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  window.Swarm = Swarm;
})();

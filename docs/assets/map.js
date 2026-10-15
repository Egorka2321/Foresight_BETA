/* Карта Северогорска: процедурно сгенерированный генплан (детерминированный — у всех одинаковый). */
(function () {
  'use strict';

  var ZONES = {
    z6: [[0, 0], [130, 0], [110, 180], [123.6, 280], [0, 280]],
    z9: [[0, 280], [123.6, 280], [140, 400], [0, 400]],
    z4: [[130, 0], [200, 0], [185, 120], [204, 260], [190, 400], [140, 400], [110, 180]],
    z3: [[200, 0], [370, 0], [370, 120], [185, 120]],
    z8: [[370, 0], [600, 0], [600, 120], [370, 120]],
    z2: [[185, 120], [370, 120], [370, 260], [204, 260]],
    z1: [[370, 120], [600, 120], [600, 280], [370, 280]],
    z5: [[204, 260], [370, 260], [370, 280], [380, 400], [190, 400]],
    z7: [[370, 280], [600, 280], [600, 400], [380, 400]],
  };
  // где ставить подпись зоны и метки проектов
  var AT = { z1: [490, 205], z2: [292, 196], z3: [292, 70], z4: [158, 250], z5: [262, 352], z6: [52, 120], z7: [492, 345], z8: [492, 66], z9: [66, 316] };

  // ---------- генератор случайных чисел с зерном ----------
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function inPoly(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function bez(p0, p1, p2, p3, n) {
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t;
      out.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
    }
    return out;
  }
  var RIVER = bez([165, 0], [150, 90], [205, 170], [188, 255], 30).concat(bez([188, 255], [171, 340], [160, 350], [168, 400], 20));
  var RIVER_D = 'M165,0 C150,90 205,170 188,255 S160,350 168,400';

  // дороги: [ширина, точки]
  var ROADS = {
    main: [[0, 206], [120, 200], [190, 194], [240, 195], [374, 195], [380, 195]],
    ns: [[285, 0], [285, 262], [292, 318], [300, 400]],
    highway: [[0, 392], [190, 388], [380, 380], [600, 372]],
    north: [[200, 62], [374, 62], [598, 58]],
    c1: [[195, 158], [374, 158]],
    c2: [[202, 232], [374, 232]],
    v1: [[240, 0], [240, 260]],
    v2: [[330, 0], [330, 260]],
    plant: [[374, 250], [598, 250]],
    whs: [[472, 246], [480, 280], [480, 376]],
    whs2: [[380, 330], [600, 330]],
    lake: [[120, 200], [100, 235], [70, 268]],
    sta: [[292, 318], [345, 300], [374, 290]],
    // объездная вдоль комбината: связывает север, центр, проходную, склады и трассу
    east: [[374, 58], [374, 195], [374, 250], [376, 330], [380, 378]],
    gateN: [[520, 58], [520, 128]],
    // частный сектор: узкие улочки и дорога через лес к главной улице
    pv1: [[0, 302], [126, 302]],
    pv2: [[0, 350], [132, 350]],
    pv3: [[0, 372], [135, 372]],
    pvv: [[58, 280], [58, 390]],
    pvn: [[18, 391], [18, 205]],
    plantE: [[598, 58], [598, 372]],
  };
  var MAIN = ['main', 'ns', 'highway'];

  function distSeg(px, py, a, b) {
    var dx = b[0] - a[0], dy = b[1] - a[1];
    var t = ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy || 1);
    t = Math.max(0, Math.min(1, t));
    var x = a[0] + t * dx, y = a[1] + t * dy;
    return Math.hypot(px - x, py - y);
  }
  function distLine(px, py, pts) {
    var d = 1e9;
    for (var i = 1; i < pts.length; i++) d = Math.min(d, distSeg(px, py, pts[i - 1], pts[i]));
    return d;
  }
  function nearRoad(x, y, m) {
    for (var k in ROADS) if (distLine(x, y, ROADS[k]) < m + (MAIN.indexOf(k) >= 0 ? 5 : 3)) return true;
    return false;
  }
  function nearRiver(x, y, m) { return distLine(x, y, RIVER) < m; }
  function inLake(x, y) { return Math.pow((x - 64) / 44, 2) + Math.pow((y - 236) / 31, 2) < 1; }
  var RAIL_Y = 322;

  function pts(a) { return a.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' '); }
  function poly(a) { return pts(a); }
  function rect(x, y, w, h, cls, rot) {
    return '<rect class="' + cls + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) + '"' +
      (rot ? ' transform="rotate(' + rot.toFixed(1) + ' ' + (x + w / 2).toFixed(1) + ' ' + (y + h / 2).toFixed(1) + ')"' : '') + '/>';
  }

  // ---------- палитры объёмных зданий: [крыша, южная стена, восточная стена, контур] ----------
  var PAL = {
    panel: ['#DCE0E8', '#B4BCCB', '#A2AABB', '#A3ACBE'],
    block: ['#E4D9C8', '#C8B69C', '#B8A58A', '#BCA98F'],
    civic: ['#EDD2A9', '#CDA875', '#BC9765', '#BD9866'],
    school: ['#EEDDC4', '#CFB894', '#C0A883', '#C2AA86'],
    factory: ['#D0CADA', '#A9A0BA', '#978EAA', '#9C93AE'],
    wh: ['#DEDAE4', '#BAB2C7', '#AAA2B9', '#ADA5BC'],
    house: ['#EAD7BE', '#C8AE8B', '#B89E7C', '#BBA17F'],
    cottage: ['#E9B79C', '#C9967A', '#B8866B', '#C08A6E'],
    garage: ['#D8D2C8', '#BCB3A5', '#ADA496', '#B0A799'],
    tank: ['#E0DCE8', '#B8B1C6', '#A8A1B8', '#A39CB4'],
    chimney: ['#8E869B', '#6E6680', '#5F5871', '#5F5871'],
  };
  var HEIGHT = { cottage: 3, panel: 12, block: 7, civic: 9, school: 6, factory: 13, wh: 6, house: 3, garage: 2.5, tank: 9, chimney: 34 };

  var CACHE = null;
  function build() {
    if (CACHE) return CACHE;
    var R = rng(20400);
    var g = '';      // земля, вода, дороги — общие для 2D и 3D
    var objs = [];   // здания и деревья
    function box(x, y, w, h, kind, H) { objs.push({ t: 'box', x: x, y: y, w: w, h: h, k: kind, H: H == null ? HEIGHT[kind] : H }); }
    function cyl(cx, cy, r, kind, H) { objs.push({ t: 'cyl', x: cx, y: cy, r: r, k: kind, H: H == null ? HEIGHT[kind] : H }); }
    function tree(cx, cy, r, dark) { objs.push({ t: 'tree', x: cx, y: cy, r: r, d: dark }); }

    // ---------- подложка по зонам ----------
    g += '<rect x="0" y="0" width="600" height="400" class="m-land"/>';
    g += '<polygon class="m-forest" points="' + poly(ZONES.z6) + '"/>';
    g += '<polygon class="m-meadow" points="' + poly(ZONES.z4) + '"/>';
    g += '<polygon class="m-resi" points="' + poly(ZONES.z3) + '"/>';
    g += '<polygon class="m-waste" points="' + poly(ZONES.z8) + '"/>';
    g += '<polygon class="m-center" points="' + poly(ZONES.z2) + '"/>';
    g += '<polygon class="m-ind" points="' + poly(ZONES.z1) + '"/>';
    g += '<polygon class="m-ind2" points="' + poly(ZONES.z7) + '"/>';
    g += '<polygon class="m-sta" points="' + poly(ZONES.z5) + '"/>';
    g += '<polygon class="m-private" points="' + poly(ZONES.z9) + '"/>';

    // пустырь
    for (var i = 0; i < 14; i++) {
      var cx = 385 + R() * 200, cy = 10 + R() * 100;
      if (nearRoad(cx, cy, 8)) continue;
      g += '<ellipse class="m-dirt" cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" rx="' + (6 + R() * 16).toFixed(1) + '" ry="' + (4 + R() * 8).toFixed(1) + '"/>';
    }
    g += '<path class="m-parcel" d="M440,70 L440,118 M510,70 L510,118 M560,4 L560,118 M440,90 L600,90"/>';
    for (i = 0; i < 6; i++) box(392 + i * 8, 74, 6, 8, 'garage');

    // пойма
    g += '<path class="m-oxbow" d="M140,300 C128,320 150,345 172,338"/>';
    for (i = 0; i < 90; i++) {
      var x = 112 + R() * 92, y = R() * 400;
      if (!inPoly(x, y, ZONES.z4) || nearRiver(x, y, 11) || nearRoad(x, y, 5) || Math.abs(y - RAIL_Y) < 6) continue;
      g += '<circle class="m-bush" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (1.6 + R() * 2.2).toFixed(1) + '"/>';
    }

    // река, озеро
    g += '<path class="m-bank" d="' + RIVER_D + '"/><path class="m-river" d="' + RIVER_D + '"/>';
    g += '<path class="m-beach" d="M24,222 C28,190 92,182 106,208 C122,236 100,272 64,272 C34,272 20,250 24,222Z"/>';
    g += '<path class="m-water" d="M30,222 C35,195 88,188 100,210 C113,234 96,264 65,264 C40,264 26,246 30,222Z"/>';
    g += '<path class="m-pier" d="M96,226 L110,222"/>';

    // лес
    for (i = 0; i < 480; i++) {
      x = R() * 140; y = R() * 400;
      if (!inPoly(x, y, ZONES.z6) || Math.pow((x - 64) / 50, 2) + Math.pow((y - 236) / 37, 2) < 1 || nearRoad(x, y, 4) || Math.abs(y - RAIL_Y) < 6) continue;
      tree(x, y, 2.2 + R() * 2.8, R() < .35);
    }

    // Частный сектор: участки с огородами, одноэтажные дома, сады
    for (var py = 282; py < 392; py += 11) {
      for (var px = 1; px < 138; px += 12.5) {
        var hx = px + R() * 1.5, hy = py + R() * 1.5;
        if (!inPoly(hx, hy, ZONES.z9) || !inPoly(hx + 11, hy + 10, ZONES.z9)) continue;
        if (nearRoad(hx + 5.5, hy + 5, 4.5) || Math.abs(hy + 5 - RAIL_Y) < 8) continue;
        g += '<rect class="m-plot" x="' + hx.toFixed(1) + '" y="' + hy.toFixed(1) + '" width="11.5" height="10"/>';
        if (R() < 0.6) g += '<rect class="m-bed" x="' + (hx + 7).toFixed(1) + '" y="' + (hy + 1.5).toFixed(1) + '" width="3.5" height="7"/>';
        box(hx + 1.2 + R(), hy + 1.5 + R() * 2.5, 5.2, 4.6, 'cottage');
        if (R() < 0.45) tree(hx + 9, hy + 8, 1.7);
      }
    }

    // Спальный район: панельки (9 этажей) и школа
    var cells = [[200, 0, 240, 62], [240, 0, 285, 62], [285, 0, 330, 62], [330, 0, 370, 62], [194, 62, 240, 120], [240, 62, 285, 120], [285, 62, 330, 120], [330, 62, 370, 120]];
    cells.forEach(function (c, k) {
      var x0 = c[0] + 6, y0 = c[1] + 7, w = c[2] - c[0] - 12, h = c[3] - c[1] - 13;
      if (k === 6) return; // школа
      if (k % 2 === 0) { box(x0, y0, w, 6, 'panel'); box(x0, y0 + h - 6, w, 6, 'panel'); box(x0, y0 + 9, 6, h - 18, 'panel', 9); }
      else { box(x0, y0, 6, h, 'panel', 15); box(x0 + w - 6, y0, 6, h, 'panel'); box(x0 + 10, y0 + h / 2 - 3, w - 20, 6, 'panel', 9); }
      for (var q = 0; q < 3; q++) tree(x0 + 12 + R() * (w - 22), y0 + 12 + R() * (h - 24), 2.4);
    });
    box(296, 72, 26, 14, 'school');
    g += '<rect class="m-pitch" x="298" y="92" width="22" height="12"/>';

    // Центральный район: кварталы по периметру с дворами
    var blocks = [[192, 124, 236, 154], [244, 124, 281, 154], [289, 124, 326, 154], [334, 124, 366, 154], [200, 162, 236, 228], [334, 162, 366, 228], [206, 236, 236, 258], [244, 236, 281, 258], [289, 236, 326, 258], [334, 236, 366, 258]];
    blocks.forEach(function (b, k) {
      var w = b[2] - b[0], h = b[3] - b[1], t = 5.5, H = 6 + (k % 3) * 1.5;
      g += '<rect class="m-yard" x="' + b[0] + '" y="' + b[1] + '" width="' + w + '" height="' + h + '"/>';
      box(b[0], b[1], w, t, 'block', H); box(b[0], b[3] - t, w, t, 'block', H);
      box(b[0], b[1] + t, t, h - 2 * t, 'block', H); box(b[2] - t, b[1] + t, t, h - 2 * t, 'block', H);
    });
    g += '<rect class="m-plaza" x="244" y="162" width="82" height="66"/>';
    g += '<circle class="m-fountain" cx="285" cy="196" r="9"/>';
    box(252, 166, 26, 14, 'civic', 11); box(296, 211, 24, 12, 'civic');
    for (i = 0; i < 9; i++) tree(250 + R() * 70, 186 + R() * 38, 2.4);

    // Комбинат
    g += '<polygon class="m-fence" points="380,130 594,130 594,242 380,242"/>';
    g += '<rect class="m-gate" x="376" y="189" width="6" height="12"/><rect class="m-gate" x="514" y="126" width="12" height="6"/><rect class="m-gate" x="466" y="240" width="12" height="6"/>';
    box(392, 140, 70, 34, 'factory', 15); box(478, 136, 50, 58, 'factory', 18); box(540, 140, 46, 34, 'factory');
    box(398, 204, 58, 32, 'factory', 11); box(540, 186, 46, 50, 'factory', 14);
    cyl(492, 222, 10, 'tank'); cyl(516, 222, 10, 'tank');
    [[420, 180], [432, 180], [502, 202], [566, 182]].forEach(function (c) { cyl(c[0], c[1], 3.2, 'chimney'); });
    g += '<path class="m-conveyor" d="M462,160 L478,160 M528,170 L540,170 M456,214 L482,218"/>';

    // Склады
    [[386, 286, 84, 18], [386, 308, 84, 16], [492, 286, 96, 16], [492, 306, 44, 18], [544, 306, 46, 18], [392, 340, 70, 16], [392, 360, 54, 12], [492, 340, 98, 14], [500, 358, 40, 10]].forEach(function (b) { box(b[0], b[1], b[2], b[3], 'wh'); });
    for (i = 0; i < 10; i++) g += '<rect class="m-truck" x="' + (548 + R() * 40).toFixed(1) + '" y="' + (356 + R() * 8).toFixed(1) + '" width="5" height="2.4"/>';

    // Вокзал
    box(296, 296, 40, 14, 'civic', 8);
    g += '<rect class="m-platform" x="300" y="326" width="54" height="3"/><rect class="m-platform" x="230" y="326" width="50" height="3"/>';
    g += '<rect class="m-parking" x="236" y="290" width="44" height="22"/>';
    for (i = 0; i < 14; i++) g += '<rect class="m-car" x="' + (238 + (i % 7) * 6) + '" y="' + (292 + Math.floor(i / 7) * 11) + '" width="4" height="7"/>';
    for (i = 0; i < 6; i++) box(216 + i * 9, 346, 7, 10, 'garage');
    for (i = 0; i < 5; i++) box(312 + i * 9, 346, 7, 10, 'garage');
    for (i = 0; i < 20; i++) {
      x = 212 + R() * 150; y = 266 + R() * 22;
      if (nearRoad(x, y, 4)) continue;
      box(x, y, 5, 5, 'house');
    }

    // дороги
    var casing = '', fill = '';
    Object.keys(ROADS).forEach(function (k) {
      var main = MAIN.indexOf(k) >= 0, hw = k === 'highway', path = k === 'lake';
      var d = 'M' + ROADS[k].map(function (p) { return p[0] + ',' + p[1]; }).join(' L');
      var cl = (main ? ' main' : '') + (hw ? ' hw' : '') + (path ? ' path' : '');
      casing += '<path class="m-road-c' + cl + '" d="' + d + '"/>';
      fill += '<path class="m-road' + cl + '" d="' + d + '"/>';
    });
    g += casing + fill;
    // мосты ровно по оси реки (x реки в точке пересечения: 190 у главной улицы, 173 у ЖД, 166 у трассы)
    g += '<path class="m-bridge" d="M177,188.5 L203,188.5 M177,200.5 L203,200.5"/>';
    g += '<path class="m-bridge" d="M153,382.8 L180,382.2 M153,394.8 L180,394.2"/>';
    g += '<rect class="m-deck" x="159" y="317" width="28" height="10"/><path class="m-bridge" d="M159,317 L187,317 M159,327 L187,327"/>';
    var rail = 'M0,' + RAIL_Y + ' L600,' + RAIL_Y + ' M420,' + RAIL_Y + ' C440,' + RAIL_Y + ' 448,300 456,286 L470,246';
    g += '<path class="m-rail-b" d="' + rail + '"/><path class="m-rail" d="' + rail + '"/>';

    // ---------- 2D: вид сверху с лёгкой тенью ----------
    var flat = '';
    objs.forEach(function (o) {
      if (o.t === 'box') {
        var c = PAL[o.k];
        flat += '<rect x="' + (o.x + 1.4).toFixed(1) + '" y="' + (o.y + 1.4).toFixed(1) + '" width="' + o.w.toFixed(1) + '" height="' + o.h.toFixed(1) + '" class="m-sh"/>' +
          '<rect x="' + o.x.toFixed(1) + '" y="' + o.y.toFixed(1) + '" width="' + o.w.toFixed(1) + '" height="' + o.h.toFixed(1) + '" fill="' + c[0] + '" stroke="' + c[3] + '" stroke-width=".7"/>';
      } else if (o.t === 'cyl') {
        flat += '<circle cx="' + o.x + '" cy="' + o.y + '" r="' + o.r + '" fill="' + PAL[o.k][0] + '" stroke="' + PAL[o.k][3] + '" stroke-width="1"/>';
        if (o.k === 'chimney') flat += '<circle class="m-smoke" cx="' + (o.x + 7) + '" cy="' + (o.y - 9) + '" r="7"/><circle class="m-smoke" cx="' + (o.x + 14) + '" cy="' + (o.y - 15) + '" r="5"/>';
      } else {
        flat += '<circle class="m-tree' + (o.d ? ' d' : '') + '" cx="' + o.x.toFixed(1) + '" cy="' + o.y.toFixed(1) + '" r="' + o.r.toFixed(1) + '"/>';
      }
    });

    CACHE = '<g class="ground">' + g + '</g><g class="b2d">' + flat + '</g>';
    return CACHE;
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // opts: { pins:[{zone,color,label,bad}], pick:bool, busy:{z1:true} — занятые районы, names:{z1:'…'}, labels:bool }
  function svg(opts) {
    opts = opts || {};
    var s = '<svg class="citymap' + (opts.pick ? ' picking' : '') + '" viewBox="0 0 600 400" role="img" aria-label="Карта города">' + build();
    Object.keys(ZONES).forEach(function (z) {
      var busy = opts.busy && opts.busy[z];
      s += '<polygon class="zone' + (busy ? ' busy' : '') + '" data-zone="' + z + '" points="' + poly(ZONES[z]) + '"' +
        (opts.pick && !busy ? ' data-act="placeZone" tabindex="0" role="button" aria-label="Зона ' + esc(opts.names ? opts.names[z] : z) + '"' : '') + '/>';
    });
    if (opts.labels !== false && opts.names) {
      Object.keys(AT).forEach(function (z) {
        var p = AT[z], nm = opts.names[z], w = nm.length * 6.6 + 14;
        s += '<g class="zl" pointer-events="none"><rect x="' + (p[0] - w / 2).toFixed(1) + '" y="' + (p[1] - 31) + '" width="' + w.toFixed(1) + '" height="17" rx="8.5"/><text x="' + p[0] + '" y="' + (p[1] - 19) + '" text-anchor="middle">' + esc(nm) + '</text></g>';
      });
    }
    var byZone = {};
    (opts.pins || []).forEach(function (pn) { (byZone[pn.zone] = byZone[pn.zone] || []).push(pn); });
    Object.keys(byZone).forEach(function (z) {
      var list = byZone[z], at = AT[z];
      var per = Math.min(list.length, 5);
      list.forEach(function (pn, i) {
        var col = i % per, row = Math.floor(i / per);
        var x = at[0] + (col - (per - 1) / 2) * 22, y = at[1] + 4 + row * 24;
        s += '<g class="pin' + (pn.bad ? ' bad' : '') + '" pointer-events="none" transform="translate(' + x.toFixed(1) + ' ' + y.toFixed(1) + ')">' +
          '<g class="pinhead"><path d="M0,10 C-4,4 -10,0 -10,-6 A10,10 0 1 1 10,-6 C10,0 4,4 0,10Z" fill="' + pn.color + '"/>' +
          (pn.label ? '<text y="-2" text-anchor="middle">' + esc(pn.label) + '</text>' : '') +
          (pn.bad ? '<circle cx="9" cy="-14" r="5.5" class="pin-bad"/><text x="9" y="-11" text-anchor="middle" class="pin-bad-t">!</text>' : '') + '</g></g>';
      });
    });
    return s + '</svg>';
  }

  window.CityMap = { svg: svg, zones: Object.keys(ZONES) };
})();

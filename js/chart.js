/* Livessa 折れ線グラフ（SVG・道具なし）
   ・線は2px、目盛りは控えめ、0 の線だけ少し濃く。縦の目盛りは1つだけ（左右に別の目盛りを持たせない）
   ・2本以上のときは、凡例を出し、線の右端に名前も書く（色だけで見分けさせない）
   ・指でなぞると、縦の線と、その年の値の札が出る
   色は CSS の --s1 --s2 --s3（css/style.css。グラフの色の決まりで確かめた並び）

   Chart.line(箱, {
     xs: [x の値…], xLabel: function(i){…}, xTick: function(i){ 目盛りを打つなら文字 }, yFmt: function(v){…},
     series: [{ name, cls:'s1', values:[…] }], tip: function(i){ return [[名前, 値の文字, cls], …] },
     height: 220, zero: true
   }) */
(function (global) {
  'use strict';
  var NS = 'http://www.w3.org/2000/svg';

  function s(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function niceStep(span, n) {
    var raw = span / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

  function line(box, o) {
    box.innerHTML = '';
    box.classList.add('chart');
    var W = Math.max(280, box.clientWidth || 340), H = o.height || 220;
    var multi = o.series.length > 1;
    var L = 48, R = multi ? 58 : 14, T = 12, B = 26;
    var all = [];
    o.series.forEach(function (se) { se.values.forEach(function (v) { if (v !== null && isFinite(v)) all.push(v); }); });
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (o.zero !== false) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
    if (hi === lo) hi = lo + 1;
    var step = niceStep(hi - lo, 4);
    lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step;
    var n = o.xs.length;
    var X = function (i) { return L + (n === 1 ? 0 : i * (W - L - R) / (n - 1)); };
    var Y = function (v) { return T + (hi - v) * (H - T - B) / (hi - lo); };

    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': o.label || 'グラフ' }, box);
    // 目盛り
    for (var v = lo; v <= hi + step / 2; v += step) {
      var y = Y(v);
      s('line', { x1: L, x2: W - R, y1: y, y2: y, class: Math.abs(v) < step / 1000 ? 'ax0' : 'grid' }, svg);
      var tx = s('text', { x: L - 6, y: y + 4, class: 'tick', 'text-anchor': 'end' }, svg);
      tx.textContent = o.yFmt(v);
    }
    for (var i = 0; i < n; i++) {
      var lab = o.xTick && o.xTick(i);
      if (!lab) continue;
      s('line', { x1: X(i), x2: X(i), y1: H - B, y2: H - B + 4, class: 'ax0' }, svg);
      var tt = s('text', { x: X(i), y: H - 8, class: 'tick', 'text-anchor': 'middle' }, svg);
      tt.textContent = lab;
    }
    // 線
    o.series.forEach(function (se) {
      var d = '';
      se.values.forEach(function (v, i) { if (v === null) return; d += (d ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); });
      s('path', { d: d, class: 'ln ' + se.cls }, svg);
      if (multi) {
        var li = se.values.length - 1;
        var t2 = s('text', { x: X(li) + 6, y: Y(se.values[li]) + 4, class: 'endlab ' + se.cls }, svg);
        t2.textContent = se.name;
      }
    });
    // 線の右端の名前が重なったら、少しずらす
    if (multi) {
      var labs = Array.prototype.slice.call(svg.querySelectorAll('.endlab'));
      labs.sort(function (a, b) { return +a.getAttribute('y') - +b.getAttribute('y'); });
      for (var k = 1; k < labs.length; k++) {
        var py = +labs[k - 1].getAttribute('y'), cy = +labs[k].getAttribute('y');
        if (cy - py < 14) labs[k].setAttribute('y', py + 14);
      }
    }

    // なぞる
    var cross = s('line', { y1: T, y2: H - B, class: 'cross', visibility: 'hidden' }, svg);
    var dots = o.series.map(function (se) { return s('circle', { r: 4.5, class: 'dot ' + se.cls, visibility: 'hidden' }, svg); });
    var tip = document.createElement('div');
    tip.className = 'tip'; tip.hidden = true;
    box.appendChild(tip);
    var hit = s('rect', { x: L, y: 0, width: Math.max(1, W - L - R), height: H, class: 'hit' }, svg);
    function at(ev) {
      var r = svg.getBoundingClientRect(), px = (ev.clientX - r.left) * W / r.width;
      var i = Math.round((px - L) / ((W - L - R) / Math.max(1, n - 1)));
      i = Math.max(0, Math.min(n - 1, i));
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i)); cross.setAttribute('visibility', 'visible');
      o.series.forEach(function (se, j) {
        var v = se.values[i];
        if (v === null) { dots[j].setAttribute('visibility', 'hidden'); return; }
        dots[j].setAttribute('cx', X(i)); dots[j].setAttribute('cy', Y(v)); dots[j].setAttribute('visibility', 'visible');
      });
      tip.innerHTML = '';
      var head = document.createElement('b'); head.textContent = o.xLabel(i); tip.appendChild(head);
      o.tip(i).forEach(function (row) {
        var p = document.createElement('div');
        if (row[2]) { var sw = document.createElement('i'); sw.className = 'sw ' + row[2]; p.appendChild(sw); }
        p.appendChild(document.createTextNode(row[0] + ' '));
        var b = document.createElement('span'); b.textContent = row[1]; p.appendChild(b);
        tip.appendChild(p);
      });
      tip.hidden = false;
      var left = X(i) * r.width / W;
      var tw = tip.offsetWidth;
      tip.style.left = Math.max(0, Math.min(r.width - tw, left - tw / 2)) + 'px';
    }
    function off() {
      cross.setAttribute('visibility', 'hidden');
      dots.forEach(function (d) { d.setAttribute('visibility', 'hidden'); });
      tip.hidden = true;
    }
    hit.addEventListener('pointermove', at);
    hit.addEventListener('pointerdown', at);
    hit.addEventListener('pointerleave', off);

    if (multi) {
      var lg = document.createElement('div');
      lg.className = 'legend';
      o.series.forEach(function (se) {
        var it = document.createElement('span');
        var sw = document.createElement('i'); sw.className = 'sw ' + se.cls;
        it.appendChild(sw); it.appendChild(document.createTextNode(se.name));
        lg.appendChild(it);
      });
      box.insertBefore(lg, svg);
    }
  }

  global.Chart = { line: line };
})(this);

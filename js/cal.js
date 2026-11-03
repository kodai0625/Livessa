/* Livessa 銀行の休み（土日・祝日・年末年始）
   ★祝日の計算は CrecaLog（~/個人Claude/クレジット管理/index.html の holidaysOfYear）から借りたもの。
     振替休日（日曜と重なったら次の休みでない日）と国民の休日（祝日に挟まれた平日）も入っている。
     春分・秋分は近い年だけ合う式。法律で祝日が変わったら、両方を直すこと

   Cal.payDate(年, 月, 日, ずらし方) … 毎月決まったもの（給料・家賃など）の、その月の実際の日（'YYYY-MM-DD'）
     日は 1〜31。31 はその月の末日（30日までの月は30日）
     ずらし方：'before' 前の平日／'after' 次の平日／'none' ずらさない */
(function (global) {
  'use strict';

  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }   // m は 1〜12
  function nthMonday(y, m, n) { var first = new Date(y, m - 1, 1).getDay(); var off = (8 - first) % 7; return 1 + off + (n - 1) * 7; }
  function shunbun(y) { return Math.floor(20.8431 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)); }
  function shubun(y) { return Math.floor(23.2488 + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4)); }
  var cache = {};
  function holidaysOfYear(y) {
    if (cache[y]) return cache[y];
    var set = {}, K = function (m, d) { return m + '-' + d; };
    var base = [[1, 1], [1, nthMonday(y, 1, 2)], [2, 11], [3, shunbun(y)], [4, 29], [5, 3], [5, 4], [5, 5], [7, nthMonday(y, 7, 3)], [9, nthMonday(y, 9, 3)], [9, shubun(y)], [10, nthMonday(y, 10, 2)], [11, 3], [11, 23]];
    if (y >= 2020) base.push([2, 23]);   // 天皇誕生日
    if (y >= 2016) base.push([8, 11]);   // 山の日
    base.forEach(function (a) { set[K(a[0], a[1])] = 1; });
    // 振替休日（日曜と重なったら次の休みでない日へ）
    base.forEach(function (a) {
      var dt = new Date(y, a[0] - 1, a[1]);
      if (dt.getDay() === 0) {
        var n = new Date(y, a[0] - 1, a[1] + 1);
        while (set[K(n.getMonth() + 1, n.getDate())]) n.setDate(n.getDate() + 1);
        set[K(n.getMonth() + 1, n.getDate())] = 1;
      }
    });
    // 国民の休日（祝日に挟まれた平日）
    for (var mo = 1; mo <= 12; mo++) {
      var dm = daysInMonth(y, mo);
      for (var dd = 1; dd <= dm; dd++) {
        var dt2 = new Date(y, mo - 1, dd);
        if (dt2.getDay() === 0 || set[K(mo, dd)]) continue;
        var p = new Date(y, mo - 1, dd - 1), nx = new Date(y, mo - 1, dd + 1);
        if (set[K(p.getMonth() + 1, p.getDate())] && set[K(nx.getMonth() + 1, nx.getDate())]) set[K(mo, dd)] = 1;
      }
    }
    cache[y] = set;
    return set;
  }
  function isHoliday(y, m, d) { return !!holidaysOfYear(y)[m + '-' + d]; }
  function bankClosed(dt) {
    var wd = dt.getDay();
    if (wd === 0 || wd === 6) return true;
    var m = dt.getMonth() + 1, d = dt.getDate();
    if (m === 1 && d <= 3) return true;     // 正月休み
    if (m === 12 && d === 31) return true;  // 大晦日
    return isHoliday(dt.getFullYear(), m, d);
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(dt) { return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }

  function payDate(y, m, day, shift) {
    var dt = new Date(y, m - 1, Math.min(Math.max(1, day | 0), daysInMonth(y, m)));
    var step = shift === 'before' ? -1 : shift === 'after' ? 1 : 0;
    if (step) { var guard = 0; while (bankClosed(dt) && guard++ < 10) dt.setDate(dt.getDate() + step); }
    return ymd(dt);
  }

  global.Cal = { payDate: payDate, bankClosed: bankClosed, isHoliday: isHoliday, daysInMonth: daysInMonth };
})(this);

/* Livessa 受け口と送り合う（Task Board の js/sync.js と同じ形）
   ・受け口は1つ（個人の Google アカウント。gas/コード.gs）。つなぎ先と合言葉は Store.conn()
   ・送るのは送信箱（Store.outboxOps）。送ってから受け取る（手元の直しを先に届ける）
   ・次に受け取る目印（since）は必ず受け口が返した now を使う。手元の時計は Google の時計とずれる
   ・★Google は返事の受け取りで、ときどき 404 や形の違う返事を返す（Task Board で 2026-09-26・29 に本物で見た）。
     受け口の仕事は済んでいて、書き込みは id ごとの上書きなので、2回まで黙って送り直す */
(function (global) {
  'use strict';

  function explain(obj) {
    if (obj.error === 'bad_pin') return '合言葉が違います';
    if (obj.error === 'locked') return '合言葉を何度もまちがえたので、10分止まっています';
    if (obj.error === 'not_setup') return '受け口の用意（setup）がまだです';
    if (obj.error === 'busy') return '受け口がメールを読んでいる最中です。少し待ってください';
    return obj.error || '断られました';
  }
  function wait(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  var NEED = { ping: 'now', pull: 'rows', push: 'applied', scan: 'added', mails: 'sources' };

  function post(u, payload, tries) {
    tries = tries || 0;
    return fetch(u, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // text/plain にすると、ブラウザが前もって尋ねない（Apps Script はそれに答えられない）
      body: JSON.stringify(payload),
      redirect: 'follow'
    }).then(function (r) { return r.text(); }).then(function (t) {
      var obj = null;
      try { obj = JSON.parse(t); } catch (e) { obj = null; }
      var need = NEED[payload.action];
      if (obj && obj.ok && need && !(need in obj)) obj = null;   // 形が違う返事は、読めなかったのと同じに扱う
      if (!obj) {
        if (tries < 2) return wait(800 * (tries + 1)).then(function () { return post(u, payload, tries + 1); });
        throw new Error('返事が読めません（URL がウェブアプリのもの（…/exec）か確かめてください）');
      }
      if (!obj.ok) throw new Error(explain(obj));
      return obj;
    }, function () {
      if (tries < 2) return wait(800 * (tries + 1)).then(function () { return post(u, payload, tries + 1); });
      throw new Error('受け口に届きません（電波か URL を確かめてください）');
    });
  }

  var busy = false, timer = null, soon = null;
  var Sync = {
    lastError: '',
    version: '',          // 受け口の版の印（ping で受け取る）
    lastScan: 0,
    scanError: '',        // 受け口がメールを読めずに止まった理由（受け口が覚えている。読めたら空になる）
    onChange: null,       // 様子が変わったとき（帯を描き直す）
    onData: null,         // 受け取ったものがあったとき（画面を描き直す）

    enabled: function () { return Store.mode() === 'real' && !!Store.conn(); },
    call: function (action, extra) {
      var c = Store.conn();
      if (!c) return Promise.reject(new Error('受け口につないでいません'));
      var p = { pin: c.pin, action: action };
      Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
      return post(c.url, p);
    },

    /** つながるか確かめるだけ（つなぐ前に使う） */
    test: function (url, pin) { return post(String(url).trim(), { pin: String(pin).trim(), action: 'ping' }); },

    state: function () {
      var n = Store.outboxCount();
      if (!Sync.enabled()) return { kind: 'off', pending: n };
      if (busy) return { kind: 'busy', pending: n };
      if (Sync.lastError) return { kind: 'error', pending: n, message: Sync.lastError };
      if (n) return { kind: 'pending', pending: n };
      return { kind: 'ok', pending: 0, at: Store.meta().lastSyncAt };
    },

    /** 送って受け取る。手で押したときは force=true（失敗を投げる） */
    run: function (force) {
      if (!Sync.enabled()) return Promise.resolve({ skipped: 'off' });
      if (busy) return Promise.resolve({ skipped: 'busy' });
      busy = true; changed();
      var ops = Store.outboxOps();
      var step = ops.length
        ? Sync.call('push', { ops: ops.map(function (o) { return { kind: o.kind, id: o.id, rec: o.rec }; }) })
            .then(function (res) { Store.outboxDone(ops, res.applied || []); })
        : Promise.resolve();
      return step.then(function () {
        return Sync.call('pull', { since: Store.meta().since || 0 });
      }).then(function (res) {
        var n = Store.applyRows(res.rows || []);
        Store.setMeta({ since: res.now, lastSyncAt: Date.now() });
        Sync.lastError = ''; busy = false; changed();
        if (n && Sync.onData) Sync.onData(n);
        return { pulled: n };
      }).catch(function (e) {
        busy = false; Sync.lastError = e.message || String(e); changed();
        if (force) throw e;
        return { error: Sync.lastError };
      });
    },

    /** いますぐメールを読ませて、受け取る */
    scan: function () {
      return Sync.call('scan').then(function (res) { Sync.lastScan = res.now || Date.now(); Sync.scanError = ''; return Sync.run(true).then(function () { return res; }); },
        function (e) { Sync.scanError = e.message || String(e); changed(); throw e; });
    },

    ping: function () {
      return Sync.call('ping').then(function (res) {
        Sync.version = res.version || ''; Sync.lastScan = res.lastScan || 0; Sync.scanError = res.lastError || '';
        // カード会社の名前は受け口から（公開するコードには書かない）。変わったら描き直す
        if (res.pays && Store.setPays(res.pays) && Sync.onData) Sync.onData(0);
        changed(); return res;
      });
    },

    /** 直したら、少し待ってから送る（続けて直すとき1回にまとめる） */
    soon: function () { clearTimeout(soon); soon = setTimeout(function () { Sync.run(false); }, 1500); },

    start: function () {
      if (timer || !Sync.enabled()) return;
      timer = setInterval(function () { Sync.run(false); }, ((global.APP && APP.autoSyncSec) || 60) * 1000);
      global.addEventListener('online', function () { Sync.run(false); });
      document.addEventListener('visibilitychange', function () { if (!document.hidden) Sync.run(false); });
      Sync.ping().catch(function () { /* 帯に出る */ });
      Sync.run(false);
    },
    stop: function () { clearInterval(timer); timer = null; }
  };
  function changed() { if (Sync.onChange) Sync.onChange(); }

  global.Sync = Sync;
})(window);

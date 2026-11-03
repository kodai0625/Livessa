/* Livessa データの入れ物
   ・入れ物は2つ。★見本と本物を混ぜない
       見本（受け口につないでいないとき） … lv.sample.v2。js/sample.js の作り物。月が変わって開いたら作り直す
       本物（受け口につないだとき）       … lv.real.v1。受け口（gas/コード.gs）と送り合う
     つなぎ先と合言葉 … lv.conn（{ url, pin }）。この端末の中だけ
     いま開いている画面など … lv.ui
   ・中身の形はどちらも同じ（tx・rules・accounts・snaps・fixed・plan）。画面（js/app.js）はどちらかを気にしない

   本物の送り方（js/sync.js が使う）
     ・記録は「種類/id」ごとに1つ（tx・rule・acct・snap・fixed・plan）。受け口のシートの1行と同じ
     ・save のたびに、受け口から最後に受け取った（または送った）形（lv.real.base）と比べ、違うものだけを送信箱（lv.real.outbox）に積む
       画面の側は「どれを直したか」を覚えなくてよい（直したら save するだけ）
     ・受け取ったものは、送信箱に積んであるもの（まだ送っていない手元の直し）より弱い。手元を先に送ってから受け取る
     ・次に受け取る目印（since）は、受け口が返した now を使う（手元の時計は Google の時計とずれる。Task Board と同じ）

   分類の決め方（設計.md「分類（ほぼ自動）」）
     1. 明細に分類が書いてあれば、それ（自分で分けた・決まったもの）
     2. なければ、決まりごとを上から順に見て、最初に当たったもの。★自分で足したもの（by:'mine'）が必ず先
     3. どれにも当たらなければ「分類待ち」 */
(function (global) {
  'use strict';

  // 見本は 2026-11-03 に v2 へ（毎月決まったものの形を変えたので、古い見本は消して作り直す）
  var KEY_SAMPLE = 'lv.sample.v2', KEY_SAMPLE_OLD = 'lv.sample.v1', KEY_REAL = 'lv.real.v1', KEY_BASE = 'lv.real.base', KEY_OUT = 'lv.real.outbox',
    KEY_META = 'lv.real.meta', KEY_CONN = 'lv.conn', KEY_UI = 'lv.ui', KEY_PAYS = 'lv.pays';
  var S = null, mode = 'sample', base = {}, outbox = {}, meta = {};

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function nowYm() { return ymOf(new Date()); }
  function addMonths(ym, k) {
    var p = ym.split('-'), d = new Date(+p[0], +p[1] - 1 + k, 1);
    return ymOf(d);
  }
  function read(k, dflt) { try { var v = JSON.parse(localStorage.getItem(k)); return v === null ? dflt : v; } catch (e) { return dflt; } }
  function write(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 入れられなくても画面は動く */ } }

  function conn() { var c = read(KEY_CONN, null); return c && c.url && c.pin ? c : null; }

  function builtRules() { return APP.builtRules.map(function (x, i) { return { k: x[0], c: x[1], by: 'built', ord: 100 + i }; }); }

  /* 本物のはじめの中身。ライフプランは空（生まれ年などは自分で入れる） */
  function blankReal() {
    var y = new Date().getFullYear();
    return {
      made: 'real', tx: [], rules: builtRules(), accounts: [], snaps: {}, fixed: [],
      plan: {
        values: { dream: '', work: '', home: '', family: '', spend: '', retire: '', top: ['', '', ''] },
        useBook: true, useBal: true,
        budget: {
          income: { monthly: [{ name: '本人 給与（手取り）', member: '本人', amount: 0 }], annual: [{ name: '本人 賞与（手取り・年合計）', member: '本人', amount: 0 }] },
          expenses: { monthly: {}, annual: {} }, savings: { monthly_investment: 0 }
        },
        bs: { assets: { cash: [], investments: [], others: [] }, liabilities: [] },
        events: [],
        assumptions: {
          start_year: y + 1, end_age: 95, min_cash: 100, retired_expense_ratio: 0.8,
          members: [{ name: '本人', birth_year: '', retirement_age: 65, pension_start_age: 65, pension_annual: '' }],
          rates: { inflation: 0.015, income_growth: 0.01, pension_growth: 0.005, investment_return: 0.04, cash_interest: 0.001 },
          scenarios: ['基本']
        }
      }
    };
  }

  /* カード会社の名前（払い方の見出し）。★公開するコードには書かない（設計.md）。
     本物の分は受け口が ping で渡す（setPays。この端末に控えて、次からは電波が無くても出せる）。
     見本の分は js/sample.js の Sample.pays（公開用には js/sample.js が入らない） */
  function mergePays(p) {
    if (!p || typeof p !== 'object') return;
    Object.keys(p).forEach(function (k) { if (p[k] && typeof p[k].label === 'string') APP.pays[k] = p[k]; });
  }
  function setPays(p) {
    if (!p || typeof p !== 'object') return false;
    var changed = JSON.stringify(read(KEY_PAYS, {})) !== JSON.stringify(p);
    write(KEY_PAYS, p); mergePays(p);
    return changed;
  }

  function load() {
    if (global.Sample && Sample.pays) mergePays(Sample.pays);
    mergePays(read(KEY_PAYS, {}));
    mode = conn() ? 'real' : 'sample';
    if (mode === 'real') {
      S = read(KEY_REAL, null) || blankReal();
      // 用意した決まりごとは、いつも config.js の最新に入れ替える（自分で決めたものはそのまま）
      S.rules = builtRules().concat((S.rules || []).filter(function (r) { return r.by === 'mine'; }));
      base = read(KEY_BASE, {}); outbox = read(KEY_OUT, {}); meta = read(KEY_META, {});
      return 'real';
    }
    try { localStorage.removeItem(KEY_SAMPLE_OLD); } catch (e) { /* なくてもよい */ }
    if (!global.Sample) {   // 公開用には見本が無い（js/sample.js を入れない）。つなぐまでは、からっぽで動く
      S = read(KEY_SAMPLE, null);
      if (!S || !S.tx) { S = blankReal(); S.made = 'none'; write(KEY_SAMPLE, S); }
      return 'none';
    }
    S = read(KEY_SAMPLE, null);
    if (!S || S.made !== nowYm() || !S.tx) { S = Sample.make(new Date()); write(KEY_SAMPLE, S); return 'made'; }
    return 'kept';
  }

  var onSave = null;
  function save() {
    if (mode === 'real') {
      write(KEY_REAL, S);
      diff();
      if (onSave) onSave();
    } else write(KEY_SAMPLE, S);
  }
  function reset() { if (mode === 'sample' && global.Sample) { S = Sample.make(new Date()); write(KEY_SAMPLE, S); } }

  function loadUi() { return read(KEY_UI, {}) || {}; }
  function saveUi(ui) { write(KEY_UI, ui); }

  /* ---------- 本物：受け口と送り合う形 ---------- */
  var KINDS = ['tx', 'rule', 'acct', 'snap', 'fixed', 'plan'];
  function pack(kind, x) {
    if (kind === 'rule') return { k: x.k, c: x.c, ord: x.ord };
    if (kind === 'snap') return { ym: x.ym, v: x.v };
    return x;
  }
  function records() {
    var out = {};
    var put = function (kind, id, x) { out[kind + '/' + id] = { kind: kind, id: String(id), json: JSON.stringify(pack(kind, x)) }; };
    S.tx.forEach(function (t) { put('tx', t.id, t); });
    S.rules.forEach(function (r) { if (r.by === 'mine') put('rule', norm(r.k), r); });
    S.accounts.forEach(function (a) { put('acct', a.id, a); });
    Object.keys(S.snaps).forEach(function (ym) { put('snap', ym, { ym: ym, v: S.snaps[ym] }); });
    S.fixed.forEach(function (f) { put('fixed', f.id, f); });
    put('plan', 'main', S.plan);
    return out;
  }
  var GONE = JSON.stringify({ deleted: true });
  function diff() {
    var cur = records(), changed = false;
    Object.keys(cur).forEach(function (key) {
      if (cur[key].json !== base[key]) { outbox[key] = { kind: cur[key].kind, id: cur[key].id, json: cur[key].json }; changed = true; }
      else if (outbox[key]) { delete outbox[key]; changed = true; }   // 直して、また元に戻した
    });
    Object.keys(base).forEach(function (key) {
      if (cur[key] || base[key] === GONE) return;
      var p = key.indexOf('/');
      outbox[key] = { kind: key.slice(0, p), id: key.slice(p + 1), json: GONE }; changed = true;
    });
    // ★足してから、送る前に消したもの（受け口はまだ知らない）は、送信箱から外すだけ。
    //   残すと、消したものが受け口に足され、次に受け取ったときに戻ってくる（2026-11-03 口座で起きた）
    Object.keys(outbox).forEach(function (key) {
      if (!cur[key] && !(key in base)) { delete outbox[key]; changed = true; }
    });
    if (changed) write(KEY_OUT, outbox);
  }

  function outboxCount() { return Object.keys(outbox).length; }
  function outboxOps() {
    return Object.keys(outbox).map(function (key) { var o = outbox[key]; return { kind: o.kind, id: o.id, rec: JSON.parse(o.json), _json: o.json }; });
  }
  /* 送れたもの。送っている間にまた直したもの（送信箱の中身が違う）は残す */
  function outboxDone(sent, applied) {
    var ok = {};
    (applied || []).forEach(function (a) { ok[a.kind + '/' + a.id] = 1; });
    sent.forEach(function (op) {
      var key = op.kind + '/' + op.id;
      if (!ok[key]) return;
      base[key] = op._json;
      if (outbox[key] && outbox[key].json === op._json) delete outbox[key];
    });
    write(KEY_BASE, base); write(KEY_OUT, outbox);
  }

  /* 受け取ったものを入れる。★送信箱に積んであるもの（まだ送っていない手元の直し）は上書きしない */
  function applyRows(rows) {
    var n = 0;
    rows.forEach(function (row) {
      if (KINDS.indexOf(row.kind) < 0) return;
      var key = row.kind + '/' + row.id;
      if (outbox[key]) return;
      var obj = null;
      if (!row.deleted) { try { obj = JSON.parse(row.json); } catch (e) { return; } }
      put(row.kind, String(row.id), obj);
      base[key] = obj ? JSON.stringify(pack(row.kind, row.kind === 'rule' ? { k: obj.k, c: obj.c, ord: obj.ord } : obj)) : GONE;
      n++;
    });
    if (n) { write(KEY_REAL, S); write(KEY_BASE, base); }
    return n;
  }
  function put(kind, id, obj) {
    var arr = kind === 'tx' ? S.tx : kind === 'acct' ? S.accounts : kind === 'fixed' ? S.fixed : null;
    if (arr) {
      for (var i = 0; i < arr.length; i++) if (String(arr[i].id) === id) { if (obj) arr[i] = obj; else arr.splice(i, 1); return; }
      if (obj) arr.push(obj);
      return;
    }
    if (kind === 'rule') {
      S.rules = S.rules.filter(function (r) { return !(r.by === 'mine' && norm(r.k) === id); });
      if (obj) S.rules.push({ k: obj.k, c: obj.c, ord: obj.ord, by: 'mine' });
      return;
    }
    if (kind === 'snap') { if (obj) S.snaps[obj.ym || id] = obj.v; else delete S.snaps[id]; return; }
    if (kind === 'plan' && obj) S.plan = obj;
  }

  function connect(url, pin) {
    write(KEY_CONN, { url: url, pin: pin });
    load();
  }
  /* つなぎを切る。★本物の手元の控え（lv.real.*）は消す。送っていないものがあれば、切る前に送ること（画面の側で確かめる） */
  function disconnect() {
    [KEY_CONN, KEY_REAL, KEY_BASE, KEY_OUT, KEY_META, KEY_PAYS].forEach(function (k) { try { localStorage.removeItem(k); } catch (e) { /* なくてもよい */ } });
    base = {}; outbox = {}; meta = {};
    load();
  }

  /* 店の名前をそろえる。半角カナ→全角、ひらがな→カタカナ、小さい字→大きい字（カード会社の明細は大きい字で書く）、
     長音のゆれ（－ ｰ -）→ー、空白を取る、英字は大文字。決まりごとの側も同じようにそろえてから比べる */
  var SMALL = { 'ァ': 'ア', 'ィ': 'イ', 'ゥ': 'ウ', 'ェ': 'エ', 'ォ': 'オ', 'ッ': 'ツ', 'ャ': 'ヤ', 'ュ': 'ユ', 'ョ': 'ヨ', 'ヮ': 'ワ' };
  function norm(s) {
    return String(s || '').normalize('NFKC').toUpperCase()
      .replace(/[ぁ-ゖ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0x60); })
      .replace(/[ァィゥェォッャュョヮ]/g, function (c) { return SMALL[c]; })
      .replace(/[-‐‑‒–—―−ｰ]/g, 'ー')
      .replace(/[\s　]/g, '');
  }

  /* 店名でないもの。カードによっては、店名のかわりに「Mastercard加盟店」「ＵＣＳ加盟店利用」のように書くことがある（2026-11-03 本物で見た）。
     ★これを店名として覚えると、ちがう店がみな同じ分類になるので、店名なしとして扱う */
  function noName(shop) { return /加盟店(利用)?$/.test(String(shop || '').normalize('NFKC').trim()); }

  /* 決まりごとに覚えるときの名前。支店名・「／ＮＦＣ」（タッチ払い）・「（ＰＯＳ）」を外す。
     「見本食堂  見本町店／ＮＦＣ」→「見本食堂」。支店が変わっても同じ分類になるように */
  function ruleKey(shop) {
    var s = String(shop || '').normalize('NFKC').replace(/\/NFC$/i, '').replace(/\(POS\)$/i, '').trim();
    var parts = s.split(/\s+/);
    if (parts.length > 1 && /店$/.test(parts[parts.length - 1])) parts.pop();
    return parts.join(' ').trim() || s;
  }

  function rules() {
    return S.rules.slice().sort(function (a, b) {
      var ma = a.by === 'mine' ? 0 : 1, mb = b.by === 'mine' ? 0 : 1;
      return ma - mb || a.ord - b.ord;
    });
  }

  /* その明細の分類と、なぜそこに入ったか */
  function catOf(t) {
    if (t.cat) {
      var why = t.src === 'fixed' ? '毎月決まったもの' : t.by === 'mine' ? '自分で分けた' : '';
      return { cat: t.cat, why: why };
    }
    if (t.shop && !noName(t.shop)) {
      var n = norm(t.shop), list = rules();
      for (var i = 0; i < list.length; i++) {
        if (n.indexOf(norm(list[i].k)) >= 0) {
          return { cat: list[i].c, why: (list[i].by === 'mine' ? '自分で決めた決まりごと' : '決まりごと') + '「' + list[i].k + '」', rule: list[i] };
        }
      }
    }
    return { cat: '', why: '' };
  }

  function isAnnual(cat) { return APP.cats.annual.indexOf(cat) >= 0; }

  function live(t) { return !t.deleted; }
  function byNew(a, b) { return a.d < b.d ? 1 : a.d > b.d ? -1 : (b.t || '') < (a.t || '') ? -1 : 1; }

  function monthTx(ym) {
    return S.tx.filter(function (t) { return live(t) && t.d.slice(0, 7) === ym; }).sort(byNew);
  }

  function isMove(t, c) { return t.dir === 'move' || (t.dir !== 'in' && c === APP.cats.move); }
  /* 証券への積立（投資）か。ライフプランの「投資の積立」に入れる */
  function isInvest(t) { return !!t.inv || /証券|投信|積立/.test(String(t.shop || '').normalize('NFKC')); }

  function sums(ym) {
    var o = { inn: 0, out: 0, move: 0, byCat: {}, pending: 0, pendingAmt: 0, quick: 0, count: 0 };
    monthTx(ym).forEach(function (t) {
      o.count++;
      var c = catOf(t).cat;
      if (t.dir === 'in') { o.inn += t.amt; return; }
      if (isMove(t, c)) { o.move += t.amt; return; }
      o.out += t.amt;
      if (t.src === 'mail' || t.src === 'touch') o.quick++;
      if (!c) { o.pending++; o.pendingAmt += t.amt; return; }
      o.byCat[c] = (o.byCat[c] || 0) + t.amt;
    });
    return o;
  }

  function pendingAll() {
    return S.tx.filter(function (t) { return live(t) && t.dir === 'out' && !catOf(t).cat; }).sort(byNew);   // 「移動」に決まったものは catOf で分類が付くので、ここには来ない
  }

  function months() {
    var set = {};
    S.tx.forEach(function (t) { if (live(t)) set[t.d.slice(0, 7)] = 1; });
    set[nowYm()] = 1;
    return Object.keys(set).sort();
  }

  /* 直近 n か月（今月は入れない）の平均。ライフプランの収支表に使う（円） */
  function averages(n) {
    n = n || 6;
    var cur = nowYm(), list = [];
    for (var k = n; k >= 1; k--) list.push(addMonths(cur, -k));
    var have = list.filter(function (ym) { return monthTx(ym).length; });
    var m = have.length || 1;
    var o = { months: have, salary: 0, bonusYear: 0, monthly: {}, annual: {}, invest: 0, pendingAmt: 0 };
    APP.cats.monthly.forEach(function (c) { o.monthly[c] = 0; });
    APP.cats.annual.forEach(function (c) { o.annual[c] = 0; });
    have.forEach(function (ym) {
      monthTx(ym).forEach(function (t) {
        var c = catOf(t).cat;
        if (t.dir === 'in') { if (c === '給料') o.salary += t.amt; else if (c === '賞与') o.bonusYear += t.amt; return; }
        if (isMove(t, c)) { if (isInvest(t)) o.invest += t.amt; return; }
        if (!c) { o.pendingAmt += t.amt; return; }
        if (o.monthly[c] !== undefined) o.monthly[c] += t.amt;
        else if (o.annual[c] !== undefined) o.annual[c] += t.amt;
      });
    });
    var r100 = function (v) { return Math.round(v / 100) * 100; }, r1000 = function (v) { return Math.round(v / 1000) * 1000; };
    o.salary = r100(o.salary / m);
    o.bonusYear = r1000(o.bonusYear * 12 / m);
    o.invest = r100(o.invest / m);
    Object.keys(o.monthly).forEach(function (c) { o.monthly[c] = r100(o.monthly[c] / m); });
    Object.keys(o.annual).forEach(function (c) { o.annual[c] = r1000(o.annual[c] * 12 / m); });
    o.pendingAmt = r100(o.pendingAmt / m);
    return o;
  }

  function snapKeys() { return Object.keys(S.snaps).sort(); }
  function latestSnap() { var k = snapKeys(); return k.length ? { ym: k[k.length - 1], v: S.snaps[k[k.length - 1]] } : null; }
  function netOf(v) {
    var o = { cash: 0, inv: 0, other: 0, debt: 0 };
    S.accounts.forEach(function (a) { o[a.kind] += +(v[a.id] || 0); });
    o.net = o.cash + o.inv + o.other - o.debt;
    return o;
  }

  /* キットの入力の形（js/plan.js が読む形）に組み立てる。
     収支表は家計簿の平均、バランスシートは残高の画面の最新の月末から（それぞれ切り替えられる） */
  function rawPlan() {
    var p = S.plan, budget = p.budget, bs = p.bs;
    if (p.useBook) {
      var a = averages(6);
      budget = {
        income: {
          monthly: [{ name: '本人 給与（手取り）', member: p.assumptions.members[0].name, amount: a.salary }],
          annual: [{ name: '本人 賞与（手取り・年合計）', member: p.assumptions.members[0].name, amount: a.bonusYear }]
        },
        expenses: { monthly: a.monthly, annual: a.annual },
        savings: { monthly_investment: a.invest }
      };
    }
    var snap = latestSnap();
    if (p.useBal && snap) {
      var man = function (v) { return Math.round(+(v || 0) / 1000) / 10; };   // 円 → 万円（小数1けた）
      var pick = function (kind) {
        return S.accounts.filter(function (x) { return x.kind === kind; }).map(function (x) { return { name: x.name, amount: man(snap.v[x.id]) }; });
      };
      bs = {
        assets: { cash: pick('cash'), investments: pick('inv'), others: pick('other') },
        liabilities: S.accounts.filter(function (x) { return x.kind === 'debt'; }).map(function (x) {
          return { name: x.name, balance: man(snap.v[x.id]), annual_repayment: x.repay || 0, included_in_budget: x.inBudget !== false };
        })
      };
    }
    return { assumptions: p.assumptions, budget: budget, bs: bs, events: p.events };
  }

  var idn = 0;
  function newId(head) { return head + Date.now().toString(36) + (++idn); }
  function ymdOf(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  /* ---------- 毎月決まったもの（給料・家賃・積立など） ----------
     銀行の知らせには金額が無いので、登録した額で、その日になったら明細を作る（設計.md「メールで取れないもの」）。
     ・明細の id は「f-決まったものの id-年月」。★id が決まっているので、2台の端末が同じ月を作っても1つになる
     ・入るお金（給料など）は、その月のものだけ「合っていますか？」と聞く（ok:false）。さかのぼって作った月は聞かない
     ・作った明細を消したら、その月は skip に入れて、もう作らない（消した印が別の端末から届いても同じ）
     ・メールが来ないカード（mode:'total'）は明細を作らない。前の月の合計を入れるよう「確かめること」に出すだけ
     ★見本のときは作らない（見本の明細は js/sample.js が作ってある） */
  function applyFixed(today) {
    if (mode !== 'real') return 0;
    today = today || new Date();
    var tdy = ymdOf(today), end = ymOf(today), have = {}, added = 0;
    S.tx.forEach(function (t) { have[t.id] = 1; });
    S.fixed.forEach(function (f) {
      if (f.mode === 'total' || !(f.amt > 0) || !f.day) return;
      var ym = f.from || end;
      for (var k = 0; ym <= end && k < 36; k++, ym = addMonths(ym, 1)) {
        if (f.months && f.months.length && f.months.indexOf(+ym.slice(5)) < 0) continue;
        if ((f.skip || []).indexOf(ym) >= 0) continue;
        var id = 'f-' + f.id + '-' + ym;
        if (have[id]) continue;
        var d = Cal.payDate(+ym.slice(0, 4), +ym.slice(5), f.day, f.shift);
        if (d > tdy) continue;
        var move = f.dir === 'move';
        S.tx.push({
          id: id, d: d, t: '', amt: f.amt, dir: move ? 'move' : f.dir, pay: f.pay || 'bank', shop: f.name, src: 'fixed',
          cat: move ? APP.cats.move : (f.cat || ''), ok: !(f.dir === 'in' && f.ask !== false && ym === end), fixed: f.id, inv: !!f.inv, by: ''
        });
        have[id] = 1; added++;
      }
    });
    if (added) save();
    return added;
  }

  /* メールが来ないカードで、前の月の合計がまだ入っていないもの（知らせが来る日のめやすを過ぎたら） */
  function totalsDue(today) {
    today = today || new Date();
    var prev = addMonths(ymOf(today), -1), out = [];
    S.fixed.forEach(function (f) {
      if (f.mode !== 'total') return;
      if (today.getDate() < (f.day || 1)) return;
      var done = S.tx.some(function (t) { return live(t) && t.total && t.total.f === f.id && t.total.ym === prev; });
      if (!done) out.push({ f: f, ym: prev });
    });
    return out;
  }

  /* まだ「合っていますか？」に答えていない、入るお金（60日以内） */
  function toConfirm(today) {
    today = today || new Date();
    var from = ymdOf(new Date(today.getTime() - 60 * 864e5));
    return S.tx.filter(function (t) { return live(t) && t.dir === 'in' && t.src === 'fixed' && !t.ok && t.d >= from; }).sort(byNew);
  }

  /* 明細のある最初の月（毎月決まったものを「いつから」作るかの、はじめの値） */
  function firstYm() {
    var m = S.tx.filter(function (t) { return live(t) && t.src !== 'fixed'; }).map(function (t) { return t.d.slice(0, 7); }).sort();
    return m.length ? m[0] : nowYm();
  }

  global.Store = {
    load: load, save: save, reset: reset, loadUi: loadUi, saveUi: saveUi,
    get data() { return S; },
    mode: function () { return mode; },
    hasSample: function () { return !!global.Sample; },
    setPays: setPays,
    conn: conn, connect: connect, disconnect: disconnect,
    set onSave(f) { onSave = f; },
    outboxCount: outboxCount, outboxOps: outboxOps, outboxDone: outboxDone, applyRows: applyRows,
    meta: function () { return meta; },
    setMeta: function (patch) { Object.keys(patch).forEach(function (k) { meta[k] = patch[k]; }); write(KEY_META, meta); },
    nowYm: nowYm, addMonths: addMonths, norm: norm, noName: noName, ruleKey: ruleKey, rules: rules, catOf: catOf, isAnnual: isAnnual, isMove: isMove,
    monthTx: monthTx, sums: sums, pendingAll: pendingAll, months: months, averages: averages,
    snapKeys: snapKeys, latestSnap: latestSnap, netOf: netOf, rawPlan: rawPlan,

    tx: function (id) { for (var i = 0; i < S.tx.length; i++) if (S.tx[i].id === id) return S.tx[i]; return null; },
    setCat: function (id, cat, learn) {
      var t = this.tx(id); if (!t) return null;
      t.cat = cat; t.by = 'mine';
      // 「移動」にしたものは、使ったお金に数えない。ほかの分類に戻したら元の向きに戻す
      if (cat === APP.cats.move) { if (!t.dir0) t.dir0 = t.dir; t.dir = 'move'; }
      else if (t.dir0) { t.dir = t.dir0; delete t.dir0; }
      var added = null;
      if (learn && t.shop && !noName(t.shop)) {
        var k = ruleKey(t.shop), n = norm(k);
        S.rules = S.rules.filter(function (r) { return !(r.by === 'mine' && norm(r.k) === n); });
        var ord = S.rules.reduce(function (m, r) { return r.by === 'mine' ? Math.min(m, r.ord) : m; }, 15) - 1;
        added = { k: k, c: cat, by: 'mine', ord: ord };
        S.rules.push(added);
      }
      save();
      return added;
    },
    clearCat: function (id) { var t = this.tx(id); if (t) { t.cat = ''; t.by = ''; if (t.dir0) { t.dir = t.dir0; delete t.dir0; } save(); } },
    delRule: function (k) { S.rules = S.rules.filter(function (r) { return !(r.by === 'mine' && r.k === k); }); save(); },
    addTx: function (o) { o.id = newId('h'); S.tx.push(o); save(); return o; },
    delTx: function (id) {
      var t = this.tx(id);
      if (t && t.fixed) {   // 毎月決まったものから作った明細は、その月をもう作らない
        var f = S.fixed.filter(function (x) { return x.id === t.fixed; })[0];
        var ym = id.slice(-7);
        if (f) { f.skip = (f.skip || []).filter(function (x) { return x !== ym; }).concat([ym]); }
      }
      S.tx = S.tx.filter(function (x) { return x.id !== id; }); save();
    },
    confirmTx: function (id, amt) { var t = this.tx(id); if (t) { t.amt = amt; t.ok = true; save(); } },
    saveSnap: function (ym, v) { S.snaps[ym] = v; save(); },
    addAccount: function (a) { a.id = newId('a'); S.accounts.push(a); save(); return a; },
    saveAccount: function (a) { for (var i = 0; i < S.accounts.length; i++) if (S.accounts[i].id === a.id) { S.accounts[i] = a; save(); return a; } return null; },
    /* 口座を消す。★前の月末の残高（snaps）の中の数字は残す（消すと、過去の純資産が変わってしまう）。数えるのは今ある口座だけ */
    delAccount: function (id) { S.accounts = S.accounts.filter(function (a) { return a.id !== id; }); save(); },
    applyFixed: applyFixed, totalsDue: totalsDue, toConfirm: toConfirm, firstYm: firstYm,
    fixedById: function (id) { return S.fixed.filter(function (f) { return f.id === id; })[0] || null; },
    saveFixed: function (f) {
      if (!f.id) { f.id = newId('f'); S.fixed.push(f); }
      else { for (var i = 0; i < S.fixed.length; i++) if (S.fixed[i].id === f.id) S.fixed[i] = f; }
      save(); applyFixed();
      return f;
    },
    /* 決まったものを消す。★もう作った明細は残す（その月に本当にあったお金なので） */
    delFixed: function (id) { S.fixed = S.fixed.filter(function (f) { return f.id !== id; }); save(); },
    savePlan: function () { save(); }
  };
})(this);

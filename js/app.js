/* Livessa 画面
   受け口につなぐと本物の明細、つながないうちは見本（js/sample.js）。★公開用には見本が入らないので、つなぐまでは空で動く
   画面は4つ：家計簿／分類待ち／残高／ライフプラン（1 価値観マップ・2 収支表とバランスシート・3 ライフイベント表・4 キャッシュフロー表）
   ほかに、下から出る入れ物（明細・手で入れる・設定） */
(function () {
  'use strict';

  var CAT = APP.cats, PAYS = APP.pays, SRCS = APP.srcs;
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var ui = {};

  /* ---------- 小さな道具 ---------- */
  function $(s, r) { return (r || document).querySelector(s); }
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else if (k === 'value') el.value = v;
        else if (k === 'checked') el.checked = !!v;
        else el.setAttribute(k, v === true ? '' : v);
      });
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(function (x) { add(el, x); }); return; }
    el.appendChild(typeof c === 'object' ? c : document.createTextNode(String(c)));
  }
  var MINUS = '−';
  function comma(n) { return Math.round(n).toLocaleString('ja-JP'); }
  function yen(n) { return (n < 0 ? MINUS : '') + comma(Math.abs(n)) + '円'; }
  function sgnYen(n) { return (n > 0 ? '+' : n < 0 ? MINUS : '') + comma(Math.abs(n)) + '円'; }
  function man(v) {   // 万円
    var a = Math.abs(v), s = v < 0 ? MINUS : '';
    if (a >= 10000) return s + (a / 10000).toFixed(2).replace(/\.?0+$/, '') + '億円';
    return s + comma(a) + '万円';
  }
  function manAxis(v) {
    if (Math.abs(v) < 1e-9) return '0';
    var a = Math.abs(v), s = v < 0 ? MINUS : '';
    if (a >= 10000) return s + (a / 10000).toFixed(1).replace(/\.0$/, '') + '億';
    return s + comma(a) + '万';
  }
  function pint(x) { var n = parseInt(String(x).replace(/[^\d-]/g, ''), 10); return isFinite(n) ? n : null; }
  function dLabel(d) {
    var p = d.split('-'), dt = new Date(+p[0], +p[1] - 1, +p[2]);
    return (+p[1]) + '月' + (+p[2]) + '日（' + WD[dt.getDay()] + '）';
  }
  function ymLabel(ym) { return ym.slice(0, 4) + '年' + (+ym.slice(5)) + '月'; }
  function mLabel(ym) { return (+ym.slice(5)) + '月'; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  /* 店の名前を見せる。半角カナだけ全角に直し、ほかは届いたまま（カタカナの「ロ－ソン」のような書き方もそのまま） */
  function shopText(t) { return t.shop && !Store.noName(t.shop) ? t.shop.replace(/[\uFF61-\uFF9F]+/g, function (m) { return m.normalize('NFKC'); }) : ''; }
  function saveUi() { Store.saveUi(ui); }
  // カードの名前がまだ届いていないとき（受け口とつないだ直後など）は「カード」とだけ出す
  function payOf(t) { return PAYS[t.pay] || { label: t.card || 'カード', short: 'カード' }; }
  function payShort(t) { return t.payName || payOf(t).short; }
  function payLabel(t) { return t.payName ? t.payName + '（' + payOf(t).label + '）' : payOf(t).label; }

  var toastTimer = null;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  /* ---------- 下から出る入れ物 ---------- */
  function openSheet(title, body) {
    $('#sheetTitle').textContent = title;
    var b = $('#sheetBody'); b.innerHTML = ''; add(b, body);
    $('#sheet').hidden = false; $('#sheetBg').hidden = false;
    b.scrollTop = 0;
  }
  function closeSheet() { $('#sheet').hidden = true; $('#sheetBg').hidden = true; }

  /* ---------- 画面の切り替え ---------- */
  var VIEWS = { book: renderBook, wait: renderWait, bal: renderBal, plan: renderPlan };
  function show(view) {
    ui.view = view; saveUi();
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) { b.classList.toggle('on', b.getAttribute('data-view') === view); });
    Array.prototype.forEach.call(document.querySelectorAll('.view'), function (s) { s.classList.toggle('on', s.id === 'view-' + view); });
    $('#fab').hidden = view !== 'book';
    render();
    window.scrollTo(0, 0);
  }
  function render() {
    var n = Store.pendingAll().length;
    $('#cntWait').textContent = n ? String(n) : '';
    badge();
    VIEWS[ui.view]();
  }

  /* 見出しの小さな帯。見本のときは「見本」、つないでいるときは受け口との様子 */
  function badge() {
    var b = $('#badge');
    if (Store.mode() !== 'real') { b.textContent = Store.hasSample() ? '見本' : 'つないでいません'; b.className = 'badge'; b.title = 'まだカード会社のメールにはつながっていません'; return; }
    var st = Sync.state();
    var txt = { ok: '同期ずみ', busy: '送り合っています…', pending: '送る ' + st.pending + '件', error: 'つながりません', off: 'つないでいません' }[st.kind];
    b.textContent = txt; b.className = 'badge ' + st.kind; b.title = st.message || '';
  }

  /* 分類のボタン。月の12＋年に何回かの4＋移動 */
  function catChips(cur, onPick, withIncome) {
    var box = h('div');
    var mk = function (c, cls) {
      return h('button', { type: 'button', class: 'chip' + (cls ? ' ' + cls : '') + (c === cur ? ' on' : ''), onclick: function () { onPick(c); } }, c);
    };
    if (withIncome) { box.appendChild(h('div', { class: 'chips' }, CAT.income.map(function (c) { return mk(c); }))); return box; }
    box.appendChild(h('div', { class: 'chips' }, CAT.monthly.map(function (c) { return mk(c); })));
    box.appendChild(h('div', { class: 'chiplbl' }, '年に何回かのもの（特別費）'));
    box.appendChild(h('div', { class: 'chips' }, CAT.annual.map(function (c) { return mk(c, 'sp'); }), mk(CAT.move, 'sp')));
    return box;
  }

  /* ================= 家計簿 ================= */
  function budgetMonthly() {
    var raw = Store.rawPlan();
    return { m: raw.budget.expenses.monthly || {}, fromBook: Store.data.plan.useBook };
  }

  function renderBook() {
    var v = $('#view-book'); v.innerHTML = '';
    var ym = ui.month, now = Store.nowYm(), ms = Store.months();
    if (Store.mode() !== 'real') v.appendChild(h('div', { class: 'sampleband' }, Store.hasSample() ? '見本の数字です（作り物）。まだカード会社のメールにはつながっていません。'
      : 'まだ受け口につないでいません。右上の歯車（設定）→「受け口」に、受け口の URL と合言葉を入れると、カード会社のメールから明細が入ります。'));
    else if (!Store.data.tx.length) v.appendChild(h('div', { class: 'sampleband' }, 'まだ明細がありません。受け口がカード会社のメールを読むと、ここに並びます（15分ごと。設定の「いますぐメールを読む」でもすぐ読めます）。'));
    v.appendChild(h('div', { class: 'monthbar' },
      h('button', { type: 'button', class: 'mbtn', 'aria-label': '前の月', disabled: ym <= ms[0], onclick: function () { ui.month = Store.addMonths(ym, -1); saveUi(); renderBook(); } }, '‹'),
      h('b', null, ymLabel(ym)),
      h('button', { type: 'button', class: 'mbtn', 'aria-label': '次の月', disabled: ym >= now, onclick: function () { ui.month = Store.addMonths(ym, 1); saveUi(); renderBook(); } }, '›')));

    var s = Store.sums(ym), bal = s.inn - s.out;
    v.appendChild(h('div', { class: 'card sum' },
      h('div', { class: 'sum-main' }, h('span', { class: 'lbl' }, ym === now ? '今月 使ったお金' : '使ったお金'), h('b', { class: 'num' }, yen(s.out))),
      h('div', { class: 'sum-sub' },
        h('div', null, h('span', { class: 'lbl' }, '入ったお金'), h('b', { class: 'num plus' }, yen(s.inn))),
        h('div', null, h('span', { class: 'lbl' }, '残ったお金'),
          h('b', { class: 'num ' + (bal >= 0 ? 'plus' : 'minus') }, sgnYen(bal), h('span', { class: 'flag ' + (bal >= 0 ? 'good' : 'bad') }, bal >= 0 ? '黒字' : '赤字')))),
      s.quick ? h('p', { class: 'note' }, '速報 ' + s.quick + '件をふくみます。確定の明細が来たら置きかわります。') : null,
      s.move ? h('p', { class: 'note' }, '口座どうしの移動・積立（' + yen(s.move) + '）は、使ったお金に数えていません。') : null));

    if (ym === now) checks(v);

    // 分類ごと
    var bm = budgetMonthly();
    v.appendChild(h('div', { class: 'sec' }, h('h2', null, '分類ごと'), h('small', null, bm.fromBook ? 'めやすは、ふだんの月（直近6か月の平均）' : 'めやすは、収支表の数字')));
    var cats = h('div', { class: 'card cats' });
    if (s.pending) {
      cats.appendChild(h('div', { class: 'catrow pend', role: 'button', tabindex: '0', onclick: function () { show('wait'); } },
        h('span', { class: 'nm' }, '分類待ち ' + s.pending + '件 ›'), h('span', { class: 'am num' }, yen(s.pendingAmt))));
    }
    var rows = 0;
    CAT.monthly.forEach(function (c) {
      var spent = s.byCat[c] || 0, bud = bm.m[c] || 0;
      if (!spent && !bud) return;
      rows++;
      var over = bud && spent > bud;
      cats.appendChild(h('div', { class: 'catrow' + (over ? ' over' : '') },
        h('span', { class: 'nm' }, c), h('span', { class: 'am num' }, yen(spent)),
        h('div', { class: 'meter' }, h('i', { style: 'width:' + (bud ? Math.min(100, spent / bud * 100) : 100).toFixed(1) + '%' })),
        h('span', { class: 'bud num' }, !bud ? 'めやすなし'
          : over ? '⚠ めやす ' + yen(bud) + ' を ' + yen(spent - bud) + ' 超えています'
          : 'めやす ' + yen(bud) + '・あと ' + yen(bud - spent))));
    });
    if (!rows && !s.pending) cats.appendChild(h('p', { class: 'empty' }, 'この月の明細はありません'));
    v.appendChild(cats);
    var sp = CAT.annual.filter(function (c) { return s.byCat[c]; });
    if (sp.length) {
      v.appendChild(h('div', { class: 'sec' }, h('h2', null, '年に何回かのもの'), h('small', null, '特別費')));
      v.appendChild(h('div', { class: 'card cats' }, sp.map(function (c) {
        return h('div', { class: 'catrow' }, h('span', { class: 'nm' }, c), h('span', { class: 'am num' }, yen(s.byCat[c])));
      })));
    }

    // 明細
    var list = Store.monthTx(ym);
    v.appendChild(h('div', { class: 'sec' }, h('h2', null, '明細'), h('small', null, list.length + '件')));
    var day = '', box = null;
    list.forEach(function (t) {
      if (t.d !== day) {
        day = t.d;
        v.appendChild(h('div', { class: 'day' }, dLabel(t.d)));
        box = h('div', { class: 'card txlist' });
        v.appendChild(box);
      }
      box.appendChild(txRow(t));
    });
  }

  function txRow(t) {
    var c = Store.catOf(t).cat, shop = shopText(t);
    return h('button', { type: 'button', class: 'tx', onclick: function () { openTx(t.id); } },
      h('span', { class: 'pay' }, payShort(t)),
      h('span', { class: 'tx-main' },
        h('span', { class: 'tx-shop' + (shop ? '' : ' none') }, shop || '店名なし'),
        h('span', { class: 'tx-sub' },
          t.t ? h('span', { class: 'num' }, t.t) : null,
          h('span', { class: 'src' }, SRCS[t.src]),
          Store.isMove(t, c) ? h('span', { class: 'chipc' }, '移動・数えない')
            : c ? h('span', { class: 'chipc' }, c) : h('span', { class: 'chipc wait' }, '分類待ち'),
          (t.src === 'fixed' && t.dir === 'in' && !t.ok) ? h('span', { class: 'chipc wait' }, '額を確かめる') : null)),
      h('span', { class: 'tx-amt num' + (t.dir === 'in' ? ' in' : Store.isMove(t, c) ? ' move' : '') },
        (t.dir === 'in' ? '+' : Store.isMove(t, c) ? '→ ' : '') + comma(t.amt) + '円'));
  }

  /* 確かめること（今月だけ） */
  function checks(v) {
    var now = Store.nowYm(), list = [];
    var card = function (ic, text, acts) {
      return h('div', { class: 'card check' }, h('span', { class: 'ic', 'aria-hidden': 'true' }, ic),
        h('div', { class: 'bd' }, h('p', null, text), h('div', { class: 'acts' }, acts)));
    };
    Store.toConfirm().forEach(function (t) {
      list.push(card('💴', dLabel(t.d) + 'は' + t.shop + 'の日です。銀行の知らせには金額が書かれていないので、登録した額 ' + yen(t.amt) + ' で入れています。' + mLabel(t.d.slice(0, 7)) + 'の額は合っていますか？', [
        h('button', { type: 'button', class: 'btn pri', onclick: function () { Store.confirmTx(t.id, t.amt); toast(mLabel(t.d.slice(0, 7)) + 'の' + t.shop + 'を ' + yen(t.amt) + ' で入れました'); render(); } }, '合っている'),
        h('button', { type: 'button', class: 'btn', onclick: function () { fixAmount(t); } }, '金額を直す')
      ]));
    });
    if (Store.mode() === 'real' && !Store.data.fixed.length) {
      list.push(card('📅', '給料・家賃・積立など、毎月決まったものを入れると、その日に家計簿へ入ります（銀行の知らせには金額が無いため）。', [
        h('button', { type: 'button', class: 'btn pri', onclick: openFixedList }, '入れる')
      ]));
    }
    if (Store.mode() === 'real' && Sync.scanError) {
      list.push(card('⚠️', '受け口がカード会社のメールを読めずに止まっています：' + Sync.scanError, [
        h('button', { type: 'button', class: 'btn pri', onclick: openSettings }, '設定を見る')
      ]));
    }
    var pend = Store.pendingAll().length;
    if (pend) {
      list.push(card('🏷', '分類待ちが ' + pend + '件あります。店名が書かれていない明細や、決まりごとに無い店です。', [
        h('button', { type: 'button', class: 'btn pri', onclick: function () { show('wait'); } }, '分ける')
      ]));
    }
    Store.totalsDue().forEach(function (x) {
      list.push(card('💳', x.f.name + 'の' + mLabel(x.ym) + '分の請求が決まるころです。1件ずつのメールは来ないので、' + mLabel(x.ym) + '分の合計を1つ入れてください。', [
        h('button', { type: 'button', class: 'btn pri', onclick: function () { openAdd({ total: x.f, month: x.ym }); } }, '合計を入れる')
      ]));
    });
    if (new Date().getDate() >= 25 && !Store.data.snaps[now]) {
      list.push(card('🏦', mLabel(now) + '末の残高を入れる日が近づいています。銀行・証券のアプリを見て、数字を入れます。', [
        h('button', { type: 'button', class: 'btn', onclick: function () { show('bal'); } }, '残高を入れる')
      ]));
    }
    if (!list.length) return;
    v.appendChild(h('div', { class: 'sec' }, h('h2', null, '確かめること'), h('small', null, list.length + '件')));
    add(v, list);
  }

  function fixAmount(t) {
    var inp = h('input', { type: 'text', inputmode: 'numeric', value: comma(t.amt) });
    openSheet(mLabel(t.d.slice(0, 7)) + 'の' + t.shop + 'の額を直す', [
      h('label', { class: 'field' }, h('span', null, t.dir === 'in' ? '手取りの額（円）' : '額（円）'), h('small', null, 'この月の分だけ直します。毎月の額を変えるときは、設定の「毎月決まったもの」で'), inp),
      h('button', { type: 'button', class: 'btn pri wide', onclick: function () {
        var n = pint(inp.value);
        if (!n || n <= 0) { toast('金額を入れてください'); return; }
        Store.confirmTx(t.id, n); closeSheet(); toast(mLabel(t.d.slice(0, 7)) + 'の' + t.shop + 'を ' + yen(n) + ' で入れました'); render();
      } }, 'この額で入れる')
    ]);
    setTimeout(function () { inp.focus(); inp.select(); }, 50);
  }

  /* 明細を開く */
  var SRC_LONG = {
    mail: 'カード会社の利用通知メール（速報。確定の明細が来たら置きかわります）',
    sure: '確定の形の明細',
    touch: '利用通知メール＋iPhone のタッチの記録（店名はタッチの記録から）',
    fixed: '毎月決まったもの（登録した額）',
    hand: '手で入れたもの',
    total: 'メールが来ないカードの、月の合計'
  };
  function openTx(id) {
    var t = Store.tx(id); if (!t) return;
    var info = Store.catOf(t), shop = shopText(t);
    var learn = null;
    var body = [
      h('p', { class: 'big num' + (t.dir === 'in' ? ' plus' : '') }, (t.dir === 'in' ? '+' : '') + comma(t.amt) + '円'),
      h('dl', { class: 'kv' },
        h('dt', null, '日時'), h('dd', null, dLabel(t.d) + (t.t ? ' ' + t.t : '')),
        h('dt', null, '払い方'), h('dd', null, payLabel(t)),
        h('dt', null, '届き方'), h('dd', null, SRC_LONG[t.src]),
        h('dt', null, '店'), h('dd', null, shop || (t.shop ? '書かれていません（「' + t.shop.normalize('NFKC') + '」としか出ていない）' : '書かれていません')),
        info.why ? h('dt', null, '分類') : null, info.why ? h('dd', null, info.cat + '（' + info.why + '）') : null)
    ];
    if (t.dir === 'move') {
      body.push(h('p', { class: 'note' }, '口座どうしの移動・積立なので、使ったお金にも入ったお金にも数えていません。'));
    } else {
      body.push(h('div', { class: 'field' }, h('span', null, '分類'), catChips(info.cat, function (c) {
        var added = Store.setCat(t.id, c, learn ? learn.checked : false);
        closeSheet();
        toast(c + 'にしました' + (added ? '。「' + added.k + '」は次から自動で' + c + 'に入ります' : ''));
        render();
      }, t.dir === 'in')));
      if (t.dir === 'out' && shop) {
        learn = h('input', { type: 'checkbox', checked: !info.rule });
        body.push(h('label', { class: 'learn' }, learn, '次からも「' + Store.ruleKey(t.shop) + '」はこの分類にする'));
      }
    }
    if (t.by === 'mine' && t.src !== 'hand' && t.src !== 'total') {
      body.push(h('button', { type: 'button', class: 'btn wide', style: 'margin-top:14px', onclick: function () { Store.clearCat(t.id); closeSheet(); toast('自分で分けたのをやめました'); render(); } }, '自分で分けたのをやめる（決まりごとに任せる）'));
    }
    if (t.src === 'fixed') {
      var f = t.fixed ? Store.fixedById(t.fixed) : null;
      body.push(h('p', { class: 'note' }, f ? '毎月決まったもの「' + f.name + '」から作った明細です。' : '毎月決まったものから作った明細です（もとは消してあります）。'));
      body.push(h('div', { class: 'acts', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' },
        h('button', { type: 'button', class: 'btn', onclick: function () { fixAmount(t); } }, 'この月の額を直す'),
        t.fixed ? h('button', { type: 'button', class: 'btn dng', onclick: function () {
          if (!confirm(mLabel(t.d.slice(0, 7)) + 'の「' + t.shop + '」を消します。この月はもう作りません。よいですか？')) return;
          Store.delTx(t.id); closeSheet(); toast('消しました（この月はもう作りません）'); render();
        } }, 'この月はなかった') : null));
    }
    if (t.src === 'hand' || t.src === 'total') {
      body.push(h('button', { type: 'button', class: 'btn dng wide', style: 'margin-top:14px', onclick: function () { Store.delTx(t.id); closeSheet(); toast('消しました'); render(); } }, 'この明細を消す'));
    }
    openSheet('明細', body);
  }

  /* 手で入れる（現金・PayPay）と、メールが来ないカードの月の合計（o.total に毎月決まったもの、o.month に年月） */
  function openAdd(o) {
    o = o || {};
    var tot = o.total || null, pay = 'cash';
    var amt = h('input', { type: 'text', inputmode: 'numeric', placeholder: '0' });
    var what = h('input', { type: 'text', placeholder: tot ? tot.name + '（' + mLabel(o.month) + '分の合計）' : '例）ランチ' });
    var date = h('input', { type: 'date', value: tot ? lastDay(o.month) : today() });
    var cat = h('select', null, CAT.monthly.concat(CAT.annual).map(function (c) { return h('option', { value: c }, c); }));
    if (tot) cat.value = 'その他';
    var seg = h('div', { class: 'seg' });
    var setPay = function (p) {
      pay = p;
      Array.prototype.forEach.call(seg.children, function (b) { b.classList.toggle('on', b.getAttribute('data-p') === p); });
    };
    ['cash', 'paypay'].forEach(function (p) {
      seg.appendChild(h('button', { type: 'button', 'data-p': p, onclick: function () { setPay(p); } }, PAYS[p].label));
    });
    openSheet(tot ? tot.name + 'の' + mLabel(o.month) + '分の合計' : '手で入れる', [
      tot ? h('p', { class: 'note' }, tot.name + 'は1件ずつのメールが来ないので、請求の知らせ（またはカード会社のアプリ）を見て、' + mLabel(o.month) + '分の合計を1つ入れます。') : h('div', { class: 'field' }, h('span', null, '払い方'), seg),
      h('label', { class: 'field' }, h('span', null, '金額（円）'), amt),
      h('label', { class: 'field' }, h('span', null, '何に'), what),
      h('label', { class: 'field' }, h('span', null, '分類'), tot ? h('small', null, '月の合計は中身が分からないので、一番多いものか「その他」に') : null, cat),
      h('label', { class: 'field' }, h('span', null, '日付'), date),
      h('button', { type: 'button', class: 'btn pri wide', onclick: function () {
        var n = pint(amt.value);
        if (!n || n <= 0) { toast('金額を入れてください'); return; }
        var rec = { d: date.value || today(), t: '', amt: n, dir: 'out', pay: tot ? 'card' : pay, shop: what.value.trim() || what.placeholder.replace('例）', ''), src: tot ? 'total' : 'hand', cat: cat.value, by: 'mine' };
        if (tot) { rec.payName = tot.name; rec.total = { f: tot.id, ym: o.month }; }
        Store.addTx(rec);
        closeSheet(); toast('入れました'); render();
      } }, '入れる')
    ]);
    setPay(pay);
    setTimeout(function () { amt.focus(); }, 50);
  }
  function lastDay(ym) { var d = new Date(+ym.slice(0, 4), +ym.slice(5), 0); return ym + '-' + ('0' + d.getDate()).slice(-2); }

  /* ================= 分類待ち ================= */
  function renderWait() {
    var v = $('#view-wait'); v.innerHTML = '';
    var list = Store.pendingAll();
    v.appendChild(h('p', { class: 'note' }, '店の名前から分類が決まらなかった明細です。分類を選ぶと、ここから消えます。'));
    if (!list.length) { v.appendChild(h('div', { class: 'card empty' }, '分類待ちはありません')); return; }
    if (list.some(function (t) { return !shopText(t); })) {
      v.appendChild(h('div', { class: 'hint card' }, '「店名なし」は、利用通知に店名が書かれていなかった分です（カードによっては「Mastercard加盟店」「UCS加盟店利用」としか出ないことがある）。時刻と金額で思い出して分けてください。Apple Pay でタッチした支払いなら、iPhone のショートカット「取引」で店名が埋まるようにします（はじめの一歩の3）。'));
    }
    list.forEach(function (t) {
      var shop = shopText(t), learn = null;
      var c = h('div', { class: 'card wcard' },
        h('div', { class: 'wtop' },
          h('span', { class: 'wmeta' }, dLabel(t.d) + (t.t ? ' ' + t.t : '') + '・' + payLabel(t) + '・' + SRCS[t.src]),
          h('span', { class: 'wamt num' }, comma(t.amt) + '円')),
        h('div', { class: 'wshop' + (shop ? '' : ' none') }, shop || '店名なし'),
        shop ? h('div', { class: 'hint' }, '決まりごとに無い店です。分けると、次からは自動で分かれます。') : null,
        catChips('', function (cat) {
          var added = Store.setCat(t.id, cat, learn ? learn.checked : false);
          toast(cat + 'にしました' + (added ? '。「' + added.k + '」は次から自動で' + cat + 'に入ります' : ''));
          render();
        }));
      if (shop) {
        learn = h('input', { type: 'checkbox', checked: true });
        c.appendChild(h('label', { class: 'learn' }, learn, '次からも「' + Store.ruleKey(t.shop) + '」はこの分類にする'));
      }
      v.appendChild(c);
    });
  }

  /* ================= 残高 ================= */
  var KINDS = [['cash', '現預金'], ['inv', '投資'], ['other', 'その他の資産（売れる値段のめやす）'], ['debt', '借入（残り）']];
  function renderBal() {
    var v = $('#view-bal'); v.innerHTML = '';
    var D = Store.data, now = Store.nowYm(), keys = Store.snapKeys();
    var prevKey = keys.filter(function (k) { return k < now; }).pop();
    var cur = D.snaps[now], prev = prevKey ? D.snaps[prevKey] : {};
    var inputs = {};
    var form = h('div', { class: 'card' },
      h('div', { class: 'sec', style: 'margin-top:0' }, h('h2', null, mLabel(now) + '末の残高'), h('small', null, cur ? '入れてあります' : 'まだ入れていません')),
      h('p', { class: 'note', style: 'margin-top:-4px' }, '月末に、銀行・証券のアプリを見て入れます（メールでは取れません）。ライフプランのバランスシートに使います。口座の名前を押すと、直したり消したりできます。'));
    if (!D.accounts.length) {
      form.appendChild(h('div', { class: 'hint card' }, 'まず、銀行・証券・借入（ローンなど）を「＋ 口座・借入を足す」で足してください。★口座番号は書かず、「銀行（給料の口座）」のような名前にします。'));
    }
    KINDS.forEach(function (kd) {
      var acs = D.accounts.filter(function (a) { return a.kind === kd[0]; });
      if (!acs.length) return;
      var g = h('div', { class: 'balgrp' }, h('h3', null, kd[1]));
      acs.forEach(function (a) {
        var inp = h('input', { type: 'text', inputmode: 'numeric', value: cur && cur[a.id] !== undefined ? comma(cur[a.id]) : '', placeholder: prev[a.id] !== undefined ? comma(prev[a.id]) : '0',
          onblur: function () { var n = pint(inp.value); inp.value = n === null ? '' : comma(n); } });
        inputs[a.id] = inp;
        g.appendChild(h('div', { class: 'balrow' },
          h('button', { type: 'button', class: 'nm linkish', onclick: function () { openAccount(a); } }, a.name, a.kind === 'debt' && a.repay ? h('small', { class: 'note', style: 'display:block;margin:0' }, '年に ' + a.repay + '万円 返す') : null),
          h('span', { class: 'yen' }, inp, h('span', null, '円')),
          prevKey && prev[a.id] !== undefined ? h('span', { class: 'was num' }, mLabel(prevKey) + '末 ' + yen(prev[a.id])) : null));
      });
      form.appendChild(g);
    });
    if (D.accounts.length) form.appendChild(h('div', { class: 'acts', style: 'display:flex;gap:8px;margin-top:12px' },
      h('button', { type: 'button', class: 'btn', disabled: !prevKey, onclick: function () {
        Object.keys(inputs).forEach(function (id) { if (prev[id] !== undefined) inputs[id].value = comma(prev[id]); });
      } }, '前の月末と同じにする'),
      h('button', { type: 'button', class: 'btn pri', style: 'flex:1', onclick: function () {
        var val = {}, miss = 0;
        Object.keys(inputs).forEach(function (id) {
          var n = pint(inputs[id].value);
          if (n === null) { if (prev[id] !== undefined) n = prev[id]; else { n = 0; miss++; } }
          val[id] = n;
        });
        Store.saveSnap(now, val);
        toast(mLabel(now) + '末の残高を入れました' + (miss ? '（空のところは0にしました）' : ''));
        render();
      } }, 'この数字で入れる')));
    v.appendChild(form);

    var last = Store.latestSnap();
    if (last) {
      var t = Store.netOf(last.v);
      v.appendChild(h('div', { class: 'sec' }, h('h2', null, '純資産'), h('small', null, mLabel(last.ym) + '末')));
      v.appendChild(h('div', { class: 'card totals' },
        h('div', null, h('small', null, '資産'), h('b', { class: 'num' }, man(Math.round((t.cash + t.inv + t.other) / 10000)))),
        h('div', null, h('small', null, '借入'), h('b', { class: 'num' }, man(Math.round(t.debt / 10000)))),
        h('div', null, h('small', null, '純資産'), h('b', { class: 'num ' + (t.net >= 0 ? 'plus' : 'minus') }, man(Math.round(t.net / 10000))))));
      var ks = Store.snapKeys();
      if (ks.length >= 2) {
        var box = h('div', { class: 'card' });
        v.appendChild(h('div', { class: 'sec' }, h('h2', null, '純資産の移り変わり'), h('small', null, '月末・万円')));
        v.appendChild(box);
        var nets = ks.map(function (k) { return Store.netOf(Store.data.snaps[k]); });
        Chart.line(box, {
          label: '純資産の移り変わり', height: 180, zero: false,
          xs: ks, xLabel: function (i) { return ymLabel(ks[i]) + '末'; }, xTick: function (i) { return mLabel(ks[i]); },
          yFmt: function (x) { return manAxis(x); },
          series: [{ name: '純資産', cls: 'acc', values: nets.map(function (n) { return Math.round(n.net / 10000); }) }],
          tip: function (i) { var n = nets[i]; return [['純資産', man(Math.round(n.net / 10000)), 'acc'], ['資産', man(Math.round((n.cash + n.inv + n.other) / 10000))], ['借入', man(Math.round(n.debt / 10000))]]; }
        });
      }
    }
    v.appendChild(h('button', { type: 'button', class: 'btn wide', style: 'margin-top:4px', onclick: function () { openAccount(null); } }, '＋ 口座・借入を足す'));
  }

  /* 口座・借入を足す・直す・消す（a が null なら足す） */
  function openAccount(a) {
    var edit = !!a;
    a = a || { name: '', kind: 'cash' };
    var name = h('input', { type: 'text', value: a.name, placeholder: '例）銀行（旅行の口座）' });
    var kind = a.kind, seg = h('div', { class: 'seg' });
    var repay = h('input', { type: 'number', inputmode: 'numeric', value: a.repay || '', placeholder: '24' });
    var inB = h('input', { type: 'checkbox', checked: a.inBudget !== false });
    var debtBox = h('div', { hidden: kind !== 'debt' },
      h('label', { class: 'field' }, h('span', null, '年に返す額（万円）'), repay),
      h('label', { class: 'learn' }, inB, '返す額は、家計簿の支出に入っている（口座から落ちる・カードで払う。毎月決まったものに入れた）'));
    KINDS.forEach(function (kd) {
      seg.appendChild(h('button', { type: 'button', 'data-k': kd[0], class: kd[0] === kind ? 'on' : '', onclick: function () {
        kind = kd[0];
        Array.prototype.forEach.call(seg.children, function (b) { b.classList.toggle('on', b.getAttribute('data-k') === kind); });
        debtBox.hidden = kind !== 'debt';
      } }, kd[1].replace(/（.*）/, '')));
    });
    openSheet(edit ? '口座・借入を直す' : '口座・借入を足す', [
      h('div', { class: 'field' }, h('span', null, '種類'), seg),
      h('label', { class: 'field' }, h('span', null, '名前'), h('small', null, '★口座番号は書かない。「銀行（給料の口座）」のように'), name),
      debtBox,
      h('button', { type: 'button', class: 'btn pri wide', onclick: function () {
        if (!name.value.trim()) { toast('名前を入れてください'); return; }
        var x = { id: a.id, name: name.value.trim(), kind: kind };
        if (kind === 'debt') { x.repay = +repay.value || 0; x.inBudget = inB.checked; }
        if (edit) Store.saveAccount(x); else Store.addAccount(x);
        closeSheet(); toast(edit ? '直しました' : '足しました'); render();
      } }, edit ? '直す' : '足す'),
      edit ? h('button', { type: 'button', class: 'btn dng wide', style: 'margin-top:8px', onclick: function () {
        if (!confirm('「' + a.name + '」を消します。前の月末に入れた数字は残りますが、これからの純資産には数えません。よいですか？')) return;
        Store.delAccount(a.id); closeSheet(); toast('消しました'); render();
      } }, 'この口座を消す') : null
    ]);
  }

  /* ================= 毎月決まったもの ================= */
  var FDIR = [['in', '入るお金', '給料・賞与など'], ['out', '出るお金', '家賃・保険など（口座から落ちるもの）'], ['move', '移動', '積立・口座どうしの移動']];
  var SHIFT = [['before', '前の平日'], ['after', '次の平日'], ['none', 'ずらさない']];
  function fixedWhen(f) {
    var d = f.day === 31 ? '末日' : f.day + '日';
    var m = f.months && f.months.length ? f.months.join('・') + '月の' : '毎月';
    var sh = f.shift === 'none' ? '' : '（休みの日は' + (f.shift === 'before' ? '前' : '次') + 'の平日）';
    return m + d + sh;
  }
  function openFixedList() {
    var D = Store.data, list = [];
    FDIR.forEach(function (fd) {
      var items = D.fixed.filter(function (f) { return f.mode !== 'total' && f.dir === fd[0]; });
      if (!items.length) return;
      list.push(h('div', { class: 'sec' }, h('h2', null, fd[1]), h('small', null, fd[2])));
      list.push(h('div', { class: 'card txlist' }, items.map(function (f) {
        return h('button', { type: 'button', class: 'tx', onclick: function () { openFixed(f); } },
          h('span', { class: 'pay' }, payOf(f).short),
          h('span', { class: 'tx-main' }, h('span', { class: 'tx-shop' }, f.name), h('span', { class: 'tx-sub' }, fixedWhen(f) + (f.cat && f.dir !== 'move' ? '・' + f.cat : ''))),
          h('span', { class: 'tx-amt num' + (f.dir === 'in' ? ' in' : f.dir === 'move' ? ' move' : '') }, (f.dir === 'in' ? '+' : f.dir === 'move' ? '→ ' : '') + comma(f.amt) + '円'));
      })));
    });
    var cards = D.fixed.filter(function (f) { return f.mode === 'total'; });
    list.push(h('div', { class: 'sec' }, h('h2', null, 'メールが来ないカード'), h('small', null, '月の合計を入れる')));
    list.push(cards.length ? h('div', { class: 'card txlist' }, cards.map(function (f) {
      return h('button', { type: 'button', class: 'tx', onclick: function () { openCard(f); } },
        h('span', { class: 'pay' }, 'カード'),
        h('span', { class: 'tx-main' }, h('span', { class: 'tx-shop' }, f.name), h('span', { class: 'tx-sub' }, '毎月' + (f.day || 1) + '日ごろに、前の月の合計を聞きます')));
    })) : h('p', { class: 'note' }, 'まだありません。1件ずつの利用通知メールが来ないカードを足すと、毎月「前の月の合計」を聞きます。'));
    openSheet('毎月決まったもの', [
      h('p', { class: 'note' }, '銀行の知らせには金額が書かれていないので、給料・家賃・積立などは、ここに入れた額で、その日に家計簿へ入ります。★カードで払うものは、カードのメールで入るので、ここには入れません（二重になります）。'),
      list,
      h('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:14px' },
        h('button', { type: 'button', class: 'btn pri wide', onclick: function () { openFixed(null); } }, '＋ 給料・家賃・積立などを足す'),
        h('button', { type: 'button', class: 'btn wide', onclick: function () { openCard(null); } }, '＋ メールが来ないカードを足す'))
    ]);
  }

  function openFixed(f) {
    var edit = !!f;
    f = f ? JSON.parse(JSON.stringify(f)) : { name: '', amt: 0, dir: 'in', day: 25, shift: 'before', months: [], pay: 'bank', cat: '給料', ask: true, from: Store.firstYm() };
    var dir = f.dir, shift = f.shift || 'none', months = (f.months || []).slice();
    var name = h('input', { type: 'text', value: f.name, placeholder: '例）給料（手取り）' });
    var amt = h('input', { type: 'text', inputmode: 'numeric', value: f.amt ? comma(f.amt) : '', placeholder: '0',
      onblur: function () { var n = pint(amt.value); amt.value = n === null ? '' : comma(n); } });
    var day = h('select', null, Array.apply(null, Array(31)).map(function (_, i) { var d = i + 1; return h('option', { value: String(d) }, d === 31 ? '末日' : d + '日'); }));
    day.value = String(f.day || 25);
    var cat = h('select');
    var fillCat = function () {
      cat.innerHTML = '';
      var opts = dir === 'in' ? CAT.income : dir === 'move' ? [CAT.move] : CAT.monthly.concat(CAT.annual);
      opts.forEach(function (c) { cat.appendChild(h('option', { value: c }, c)); });
      cat.value = opts.indexOf(f.cat) >= 0 ? f.cat : opts[0];
    };
    var ask = h('input', { type: 'checkbox', checked: f.ask !== false });
    var inv = h('input', { type: 'checkbox', checked: !!f.inv });
    var from = h('input', { type: 'month', value: f.from || Store.nowYm() });
    var askBox = h('label', { class: 'learn' }, ask, '毎月「額は合っていますか？」と聞く（手取りが月によって違うとき）');
    var invBox = h('label', { class: 'learn' }, inv, '投資の積立（ライフプランの「投資の積立」に入れる）');
    var segDir = h('div', { class: 'seg' }), segShift = h('div', { class: 'seg' });
    var setDir = function (k) {
      dir = k;
      Array.prototype.forEach.call(segDir.children, function (b) { b.classList.toggle('on', b.getAttribute('data-k') === k); });
      askBox.hidden = k !== 'in'; invBox.hidden = k !== 'move';
      fillCat();
    };
    FDIR.forEach(function (fd) { segDir.appendChild(h('button', { type: 'button', 'data-k': fd[0], onclick: function () { setDir(fd[0]); } }, fd[1])); });
    SHIFT.forEach(function (sh) {
      segShift.appendChild(h('button', { type: 'button', 'data-k': sh[0], class: sh[0] === shift ? 'on' : '', onclick: function () {
        shift = sh[0]; Array.prototype.forEach.call(segShift.children, function (b) { b.classList.toggle('on', b.getAttribute('data-k') === shift); });
      } }, sh[1]));
    });
    var mchips = h('div', { class: 'chips' });
    var drawMonths = function () {
      mchips.innerHTML = '';
      mchips.appendChild(h('button', { type: 'button', class: 'chip' + (months.length ? '' : ' on'), onclick: function () { months = []; drawMonths(); } }, '毎月'));
      for (var m = 1; m <= 12; m++) (function (m) {
        mchips.appendChild(h('button', { type: 'button', class: 'chip' + (months.indexOf(m) >= 0 ? ' on' : ''), onclick: function () {
          var i = months.indexOf(m); if (i >= 0) months.splice(i, 1); else months.push(m); months.sort(function (a, b) { return a - b; }); drawMonths();
        } }, m + '月'));
      })(m);
    };
    drawMonths();
    openSheet(edit ? '毎月決まったものを直す' : '毎月決まったものを足す', [
      h('div', { class: 'field' }, h('span', null, '種類'), segDir),
      h('label', { class: 'field' }, h('span', null, '名前'), name),
      h('label', { class: 'field' }, h('span', null, '金額（円）'), h('small', null, '給料は手取り（口座に入る額）'), amt),
      h('div', { class: 'grid2' },
        h('label', { class: 'field' }, h('span', null, '日'), day),
        h('label', { class: 'field' }, h('span', null, 'いつから'), h('small', null, 'さかのぼると、その月から入る'), from)),
      h('div', { class: 'field' }, h('span', null, '土日・祝日・年末年始に当たったら'), segShift),
      h('div', { class: 'field' }, h('span', null, '月'), h('small', null, '賞与のように決まった月だけなら、その月を選ぶ'), mchips),
      h('label', { class: 'field' }, h('span', null, '分類'), cat),
      askBox, invBox,
      h('button', { type: 'button', class: 'btn pri wide', style: 'margin-top:12px', onclick: function () {
        var n = pint(amt.value);
        if (!name.value.trim()) { toast('名前を入れてください'); return; }
        if (!n || n <= 0) { toast('金額を入れてください'); return; }
        if (!/^\d{4}-\d{2}$/.test(from.value)) { toast('いつからを入れてください'); return; }
        var x = { id: f.id, name: name.value.trim(), amt: n, dir: dir, day: +day.value, shift: shift, months: months, pay: 'bank', cat: cat.value,
          ask: dir === 'in' ? ask.checked : false, inv: dir === 'move' ? inv.checked : false, from: from.value, skip: f.skip || [] };
        var before = Store.data.tx.length;
        Store.saveFixed(x);
        var made = Store.data.tx.length - before;
        closeSheet(); render();
        toast((edit ? '直しました' : '足しました') + (made ? '（' + made + 'か月分を家計簿に入れました）' : '（その日になったら家計簿に入ります）'));
      } }, edit ? '直す' : '足す'),
      edit ? h('p', { class: 'note' }, '直すと、これから作る月の額が変わります。もう入っている月は、その明細を開いて「この月の額を直す」で。') : null,
      edit ? h('button', { type: 'button', class: 'btn dng wide', style: 'margin-top:8px', onclick: function () {
        if (!confirm('「' + f.name + '」を消します。もう家計簿に入っている月は残ります。よいですか？')) return;
        Store.delFixed(f.id); closeSheet(); toast('消しました'); render();
      } }, 'これを消す') : null
    ]);
    setDir(dir);
  }

  /* メールが来ないカード（毎月、前の月の合計を聞く） */
  function openCard(f) {
    var edit = !!f;
    f = f || { name: '', mode: 'total', day: 5 };
    var name = h('input', { type: 'text', value: f.name, placeholder: '例）メールが来ないカードの名前' });
    var day = h('select', null, Array.apply(null, Array(28)).map(function (_, i) { return h('option', { value: String(i + 1) }, (i + 1) + '日'); }));
    day.value = String(f.day || 5);
    openSheet(edit ? 'メールが来ないカードを直す' : 'メールが来ないカードを足す', [
      h('p', { class: 'note' }, '1件ずつの利用通知メールが来ないカードです。毎月、決めた日から「前の月の合計を入れてください」と家計簿に出します。明細の中身は分かりませんが、月の合計だけでも家計簿とライフプランに入ります。'),
      h('label', { class: 'field' }, h('span', null, '名前'), h('small', null, '★カード番号は書かない'), name),
      h('label', { class: 'field' }, h('span', null, '請求が決まる日のめやす'), h('small', null, 'カード会社から「請求が確定しました」の知らせが来るころ'), day),
      h('button', { type: 'button', class: 'btn pri wide', onclick: function () {
        if (!name.value.trim()) { toast('名前を入れてください'); return; }
        Store.saveFixed({ id: f.id, name: name.value.trim(), mode: 'total', day: +day.value });
        closeSheet(); toast(edit ? '直しました' : '足しました'); render();
      } }, edit ? '直す' : '足す'),
      edit ? h('button', { type: 'button', class: 'btn dng wide', style: 'margin-top:8px', onclick: function () {
        if (!confirm('「' + f.name + '」を消します。もう入れた月の合計は残ります。よいですか？')) return;
        Store.delFixed(f.id); closeSheet(); toast('消しました'); render();
      } }, 'これを消す') : null
    ]);
  }

  /* ================= ライフプラン ================= */
  var STEPS = [['1', '価値観'], ['2', '収支表'], ['3', 'できごと'], ['4', '見通し']];
  function renderPlan() {
    var v = $('#view-plan'); v.innerHTML = '';
    var step = ui.step || 1;
    v.appendChild(h('div', { class: 'steps', role: 'tablist' }, STEPS.map(function (s, i) {
      return h('button', { type: 'button', class: 'stp' + (step === i + 1 ? ' on' : ''), onclick: function () { ui.step = i + 1; saveUi(); renderPlan(); window.scrollTo(0, 0); } }, h('b', null, s[0]), s[1]);
    })));
    [renderValues, renderBudget, renderEvents, renderCF][step - 1](v);
  }

  /* 1 価値観マップ */
  var VALUES = [
    ['dream', '人生の夢・目標', '遠慮せず「欲望全開」で。お金が足りないと分かったら、そのとき稼ぎ方や時期を考えればいい'],
    ['work', '仕事・キャリア', '今の仕事について／独立・起業・転職の希望（いつ頃・どんな形で）／何歳まで働きたいか'],
    ['home', '住まい', '住みたい町・地域／住みたい家（賃貸か購入か、広さ、いつ頃）'],
    ['family', '家族・パートナー', '結婚・パートナーとの暮らし／子ども／親のこと（サポート・介護など）'],
    ['spend', 'お金をかけたいこと', '旅行／車・趣味／学び・自己投資'],
    ['retire', 'リタイア後・老後の暮らし', '何歳でリタイアしたいか／どんな暮らしがしたいか']
  ];
  var saveSoon = null;
  function savePlanSoon() { clearTimeout(saveSoon); saveSoon = setTimeout(function () { Store.savePlan(); }, 400); }
  function renderValues(v) {
    var val = Store.data.plan.values;
    v.appendChild(h('p', { class: 'note' }, 'どう生きたいかを1枚に。ここに書いたことを、3 で「いつ・いくら」に変えます。'));
    var c = h('div', { class: 'card' });
    VALUES.forEach(function (x) {
      c.appendChild(h('label', { class: 'field' }, h('span', null, x[1]), h('small', null, x[2]),
        h('textarea', { value: val[x[0]] || '', oninput: function (e) { val[x[0]] = e.target.value; savePlanSoon(); } })));
    });
    v.appendChild(c);
    var t = h('div', { class: 'card' }, h('div', { class: 'field' }, h('span', null, '大事にしたい価値観（お金の使い方の優先順位）'), h('small', null, '最後に、トップ3を自分で決めます')));
    [0, 1, 2].forEach(function (i) {
      t.appendChild(h('label', { class: 'field' }, h('small', null, (i + 1) + '番め'),
        h('input', { type: 'text', value: val.top[i] || '', oninput: function (e) { val.top[i] = e.target.value; savePlanSoon(); } })));
    });
    v.appendChild(t);
  }

  /* 2 収支表とバランスシート */
  function renderBudget(v) {
    var p = Store.data.plan, a = Store.averages(6), raw = Store.rawPlan(), b = raw.budget;
    var span = a.months.length ? mLabel(a.months[0]) + '〜' + mLabel(a.months[a.months.length - 1]) + 'の' + a.months.length + 'か月' : 'まだ明細がありません';
    v.appendChild(h('div', { class: 'card' },
      h('label', { class: 'toggle' }, h('span', null, '家計簿の数字をそのまま使う'),
        h('input', { type: 'checkbox', checked: p.useBook, onchange: function (e) {
          if (!e.target.checked) seedBudget(p, a);
          p.useBook = e.target.checked; Store.savePlan(); renderPlan();
        } })),
      h('p', { class: 'note' }, '平均は ' + span + '。' + (a.pendingAmt ? '分類待ちの分（月 ' + yen(a.pendingAmt) + '）は入っていません。' : '') + (p.useBook ? '' : '切ったので、右の列を手で直せます。'))));

    var cell = function (path, value) {
      if (p.useBook) return h('td', { class: 'num' }, comma(value));
      return h('td', null, h('input', { type: 'text', inputmode: 'numeric', value: comma(value), onchange: function (e) {
        var n = pint(e.target.value) || 0; path(n); Store.savePlan(); renderPlan();
      } }));
    };
    var bud = p.budget;
    var inc = h('table', { class: 'btable num' },
      h('tr', null, h('th', null, '収入（円）'), h('th', null, '家計簿の平均'), h('th', null, '収支表')),
      h('tr', null, h('td', null, '給料（手取り）／月'), h('td', null, comma(a.salary)), cell(function (n) { bud.income.monthly[0].amount = n; }, b.income.monthly[0].amount)),
      h('tr', null, h('td', null, '賞与（手取り）／年'), h('td', null, comma(a.bonusYear)), cell(function (n) { bud.income.annual[0].amount = n; }, b.income.annual[0].amount)));
    var mon = h('table', { class: 'btable num' }, h('tr', null, h('th', null, '毎月の支出（円／月）'), h('th', null, '家計簿の平均'), h('th', null, '収支表')));
    var tm = 0, ta = 0, tma = 0, taa = 0;
    CAT.monthly.forEach(function (c) {
      var used = b.expenses.monthly[c] || 0; tm += used; tma += a.monthly[c];
      mon.appendChild(h('tr', null, h('td', null, c), h('td', null, comma(a.monthly[c])), cell(function (n) { bud.expenses.monthly[c] = n; }, used)));
    });
    mon.appendChild(h('tr', { class: 'tot' }, h('td', null, '合計'), h('td', null, comma(tma)), h('td', null, comma(tm))));
    var ann = h('table', { class: 'btable num' }, h('tr', null, h('th', null, '特別費（円／年）'), h('th', null, '家計簿から'), h('th', null, '収支表')));
    CAT.annual.forEach(function (c) {
      var used = b.expenses.annual[c] || 0; ta += used; taa += a.annual[c];
      ann.appendChild(h('tr', null, h('td', null, c), h('td', null, comma(a.annual[c])), cell(function (n) { bud.expenses.annual[c] = n; }, used)));
    });
    ann.appendChild(h('tr', { class: 'tot' }, h('td', null, '合計'), h('td', null, comma(taa)), h('td', null, comma(ta))));
    var sav = h('table', { class: 'btable num' },
      h('tr', null, h('th', null, '投資の積立（円／月）'), h('th', null, '家計簿の平均'), h('th', null, '収支表')),
      h('tr', null, h('td', null, '証券へ積立'), h('td', null, comma(a.invest)), cell(function (n) { bud.savings.monthly_investment = n; }, b.savings.monthly_investment)));
    v.appendChild(h('div', { class: 'sec' }, h('h2', null, '収支表'), h('small', null, '手取り・実際に出ていく額')));
    v.appendChild(h('div', { class: 'card' }, inc));
    v.appendChild(h('div', { class: 'card' }, mon));
    v.appendChild(h('div', { class: 'card' }, ann, h('p', { class: 'note' }, '家計簿からの数字は、6か月分を1年分に直したもの。年に1回のもの（車検など）は、6か月だと入らないことがあります。')));
    v.appendChild(h('div', { class: 'card' }, sav));

    // 診断
    var incM = b.income.monthly[0].amount + b.income.annual[0].amount / 12;
    var outM = tm + ta / 12;
    var bal = Math.round(incM - outM);
    var res = Plan.load(raw), net = null;
    if (res.ok) {
      var pl = res.plan;
      net = pl.cash + pl.investments + pl.other_assets - pl.loans.reduce(function (s, l) { return s + l.balance; }, 0);
    }
    var good = bal >= 0 && (net === null || net >= 0);
    v.appendChild(h('div', { class: 'sec' }, h('h2', null, '診断')));
    v.appendChild(h('div', { class: 'card diag' },
      h('div', null, h('span', null, '毎月の収支（賞与・特別費を12で割って入れる）'), h('b', { class: 'num ' + (bal >= 0 ? 'plus' : 'minus') }, sgnYen(bal), h('span', { class: 'flag ' + (bal >= 0 ? 'good' : 'bad') }, bal >= 0 ? '黒字' : '赤字'))),
      net !== null ? h('div', null, h('span', null, '純資産'), h('b', { class: 'num ' + (net >= 0 ? 'plus' : 'minus') }, man(Math.round(net)), h('span', { class: 'flag ' + (net >= 0 ? 'good' : 'bad') }, net >= 0 ? 'プラス' : 'マイナス'))) : null,
      h('p', { class: 'note', style: 'margin:4px 0 0' }, good ? '毎月黒字で、純資産もプラスです。3 のできごとに進めます。'
        : '赤字か、純資産がマイナスです。3 に進む前に、どこを直すかを考えます（お金の世界では、すでに遭難している状態です）。')));

    // バランスシート
    var bs = raw.bs, snap = Store.latestSnap();
    v.appendChild(h('div', { class: 'sec' }, h('h2', null, 'バランスシート'), h('small', null, '万円')));
    var bsCard = h('div', { class: 'card' },
      h('label', { class: 'toggle' }, h('span', null, '残高の画面の数字を使う' + (snap ? '（' + mLabel(snap.ym) + '末）' : '')),
        h('input', { type: 'checkbox', checked: p.useBal, disabled: !snap, onchange: function (e) { p.useBal = e.target.checked; Store.savePlan(); renderPlan(); } })));
    var rowsOf = function (label, list, f) {
      if (!list || !list.length) return null;
      return [h('tr', null, h('th', { colspan: '2' }, label))].concat(list.map(function (x) { return h('tr', null, h('td', null, x.name), h('td', null, f(x))); }));
    };
    var asum = function (l) { return (l || []).reduce(function (s, x) { return s + (+x.amount || 0); }, 0); };
    var totalA = asum(bs.assets.cash) + asum(bs.assets.investments) + asum(bs.assets.others);
    var totalD = (bs.liabilities || []).reduce(function (s, x) { return s + (+x.balance || 0); }, 0);
    bsCard.appendChild(h('table', { class: 'btable num', style: 'margin-top:8px' },
      rowsOf('現預金', bs.assets.cash, function (x) { return man(x.amount); }),
      rowsOf('投資（想定の利回りで増える）', bs.assets.investments, function (x) { return man(x.amount); }),
      rowsOf('その他の資産（計算では増えも減りもしない）', bs.assets.others, function (x) { return man(x.amount); }),
      rowsOf('借入', bs.liabilities, function (x) { return man(x.balance) + '（年 ' + man(x.annual_repayment) + ' 返す' + (x.included_in_budget ? '・家計簿に入っている' : '') + '）'; }),
      h('tr', { class: 'tot' }, h('td', null, '資産 − 借入 ＝ 純資産'), h('td', null, man(Math.round((totalA - totalD) * 10) / 10)))));
    if (!p.useBal) bsCard.appendChild(h('p', { class: 'note' }, 'いまはキットの見本の数字です。手で直す画面は、あとで作ります。'));
    v.appendChild(bsCard);
  }
  function seedBudget(p, a) {   // 家計簿の数字を切ったとき、いまの平均から始める
    p.budget = {
      income: { monthly: [{ name: '本人 給与（手取り）', member: p.assumptions.members[0].name, amount: a.salary }], annual: [{ name: '本人 賞与（手取り・年合計）', member: p.assumptions.members[0].name, amount: a.bonusYear }] },
      expenses: { monthly: JSON.parse(JSON.stringify(a.monthly)), annual: JSON.parse(JSON.stringify(a.annual)) },
      savings: { monthly_investment: a.invest }
    };
  }

  /* 3 ライフイベント表 */
  function evYear(e, me) { return e.year ? +e.year : e.age ? me.birth_year + (+e.age) : null; }
  function renderEvents(v) {
    var p = Store.data.plan, me = p.assumptions.members[0];
    v.appendChild(h('p', { class: 'note' }, '1 に書いたことを「いつ・いくら」に。金額は今の物価で、万円で入れます。足りないと分かったら、4 で稼ぎ方・時期・順番を考えればいい。'));
    var list = p.events.map(function (e, i) { return { e: e, i: i, y: evYear(e, me) }; })
      .sort(function (x, y) { return (x.y || 0) - (y.y || 0) || x.i - y.i; });
    list.forEach(function (x) {
      var e = x.e, tags = [];
      var ot = +e.one_time_cost || 0, ic = +e.income_change || 0, ec = +e.expense_change || 0;
      if (ot > 0) tags.push(h('span', { class: 'tag' }, '一時の支出 ' + man(ot)));
      if (ot < 0) tags.push(h('span', { class: 'tag' }, '一時の収入 ' + man(-ot)));
      var dur = e.years ? '・' + e.years + '年間' : '';
      if (ic) tags.push(h('span', { class: 'tag' }, '収入 ' + (ic > 0 ? '+' : MINUS) + man(Math.abs(ic)) + '／年' + (dur || '・ずっと')));
      if (ec) tags.push(h('span', { class: 'tag' }, '支出 ' + (ec > 0 ? '+' : MINUS) + man(Math.abs(ec)) + '／年' + (dur || '・ずっと')));
      tags.push(h('span', { class: 'tag sc' }, e.scenario ? 'シナリオ：' + e.scenario : '全部のシナリオ'));
      v.appendChild(h('button', { type: 'button', class: 'ev', onclick: function () { openEvent(x.i); } },
        h('div', { class: 'when num' }, x.y ? x.y + '年（' + (e.member || me.name) + ' ' + (x.y - me.birth_year) + '歳）' : '時期が入っていません'),
        h('div', { class: 'what' }, e.event),
        h('div', { class: 'tags' }, tags),
        e.memo ? h('p', { class: 'note', style: 'margin:6px 0 0' }, e.memo) : null));
    });
    v.appendChild(h('button', { type: 'button', class: 'btn pri wide', onclick: function () { openEvent(-1); } }, '＋ できごとを足す'));
  }

  function openEvent(i) {
    var p = Store.data.plan, e = i >= 0 ? p.events[i] : { year: '', age: '', member: p.assumptions.members[0].name, event: '', category: '', one_time_cost: '', income_change: '', expense_change: '', years: '', scenario: '', memo: '' };
    var by = e.age && !e.year ? 'age' : 'year';
    var when = h('input', { type: 'number', inputmode: 'numeric', value: by === 'age' ? e.age : e.year, placeholder: by === 'age' ? '60' : '2030' });
    var seg = h('div', { class: 'seg' });
    ['year', 'age'].forEach(function (k) {
      seg.appendChild(h('button', { type: 'button', class: k === by ? 'on' : '', onclick: function () {
        by = k; Array.prototype.forEach.call(seg.children, function (b, j) { b.classList.toggle('on', (j === 0) === (k === 'year')); });
        when.placeholder = k === 'age' ? '60' : '2030';
      } }, k === 'year' ? '西暦' : '年齢'));
    });
    var f = function (val, ph) { return h('input', { type: 'text', inputmode: 'decimal', value: val, placeholder: ph || '' }); };
    var name = h('input', { type: 'text', value: e.event, placeholder: '例）車の買い替え' });
    var cat = h('input', { type: 'text', value: e.category, placeholder: '例）車' });
    var ot = f(e.one_time_cost, '例）250（一時の収入はマイナス）');
    var ic = f(e.income_change, '例）−60');
    var ec = f(e.expense_change, '例）24');
    var yrs = f(e.years, '空なら、ずっと（収入は退職まで）');
    var sc = h('select', null, h('option', { value: '' }, '全部のシナリオ'), p.assumptions.scenarios.map(function (s) { return h('option', { value: s }, s); }));
    sc.value = e.scenario || '';
    var memo = h('input', { type: 'text', value: e.memo, placeholder: '根拠や「概算」など' });
    var num = function (el) { return el.value.normalize('NFKC').trim().replace(/[−ー－]/g, '-'); };
    openSheet(i >= 0 ? 'できごとを直す' : 'できごとを足す', [
      h('div', { class: 'field' }, h('span', null, 'いつ'), seg, h('div', { style: 'height:6px' }), when),
      h('label', { class: 'field' }, h('span', null, 'できごと'), name),
      h('label', { class: 'field' }, h('span', null, '分類'), cat),
      h('label', { class: 'field' }, h('span', null, '一時の支出（万円）'), h('small', null, '退職金・家の売却など、一時の収入はマイナスで'), ot),
      h('label', { class: 'field' }, h('span', null, '毎年の収入の増減（万円／年・手取り）'), ic),
      h('label', { class: 'field' }, h('span', null, '毎年の支出の増減（万円／年）'), h('small', null, '子どもの学費・家賃の変化など'), ec),
      h('label', { class: 'field' }, h('span', null, '何年続くか'), yrs),
      h('label', { class: 'field' }, h('span', null, 'シナリオ'), sc),
      h('label', { class: 'field' }, h('span', null, 'メモ'), memo),
      h('button', { type: 'button', class: 'btn pri wide', onclick: function () {
        if (!name.value.trim()) { toast('できごとを入れてください'); return; }
        if (!when.value) { toast('いつかを入れてください'); return; }
        var ne = { year: by === 'year' ? when.value : '', age: by === 'age' ? when.value : '', member: e.member, event: name.value.trim(), category: cat.value.trim(),
          one_time_cost: num(ot), income_change: num(ic), expense_change: num(ec), years: num(yrs), scenario: sc.value, memo: memo.value.trim() };
        var test = JSON.parse(JSON.stringify(Store.rawPlan()));
        if (i >= 0) test.events[i] = ne; else test.events.push(ne);
        var r = Plan.load(test);
        if (!r.ok) { toast(r.error); return; }
        if (i >= 0) p.events[i] = ne; else p.events.push(ne);
        Store.savePlan(); closeSheet(); toast(i >= 0 ? '直しました' : '足しました'); renderPlan();
      } }, i >= 0 ? '直す' : '足す'),
      i >= 0 ? h('button', { type: 'button', class: 'btn dng wide', style: 'margin-top:8px', onclick: function () {
        p.events.splice(i, 1); Store.savePlan(); closeSheet(); toast('消しました'); renderPlan();
      } }, 'このできごとを消す') : null
    ]);
  }

  /* 4 キャッシュフロー表 */
  function renderCF(v) {
    if (!Store.data.plan.assumptions.members[0].birth_year) {
      v.appendChild(h('div', { class: 'card err' }, 'まず下の「前提」で、生まれ年・年金の見込みなどを入れてください。'));
      assumptions(v, true); return;
    }
    var res = Plan.load(Store.rawPlan());
    if (!res.ok) { v.appendChild(h('div', { class: 'card err' }, '計算できません：' + res.error)); assumptions(v); return; }
    var plan = res.plan, me = plan.me, key = 'age:' + me.name;
    var sc = plan.scenarios.slice(0, 3);
    var all = sc.map(function (s, i) {
      var rows = Plan.simulate(plan, s);
      return { name: s, cls: 's' + (i + 1), rows: rows, sum: Plan.summarize(plan, rows) };
    });
    v.appendChild(h('p', { class: 'note' }, '1〜3 をもとにした、毎年のお金の見通しです。生活費・できごとの費用は物価上昇率で、手取りは収入の上昇率で、毎年ふえます（入れるのは今の値段）。'));

    // 要点（シナリオを横に並べて比べる）
    var cps = all[0].sum.checkpoints.map(function (c) { return c.age; });
    var rowsK = cps.map(function (age) {
      return [(age === me.retirement_age ? '退職の年（' + age + '歳）' : age + '歳') + 'の純資産', function (x) {
        var c = x.sum.checkpoints.filter(function (q) { return q.age === age; })[0];
        return c ? h('td', { class: 'num' + (c.net_worth < 0 ? ' neg' : '') }, man(Math.round(c.net_worth))) : h('td', null, '—');
      }];
    }).concat([
      ['お金が足りなくなる年', function (x) { var f = x.sum.shortfall; return h('td', { class: f ? 'neg' : '' }, f ? '⚠ ' + f.year + '年（' + f[key] + '歳）' : 'なし'); }],
      ['赤字の年', function (x) { return h('td', null, x.sum.deficit_years.length ? x.sum.deficit_years.length + '年' : 'なし'); }],
      ['投資を取り崩し始める年', function (x) { var f = x.sum.first_withdrawal; return h('td', null, f ? f.year + '年（' + f[key] + '歳）' : 'なし'); }]
    ]);
    v.appendChild(h('div', { class: 'card' }, h('table', { class: 'btable cmp' },
      h('tr', null, h('th', null, '要点'), all.map(function (x) { return h('th', null, all.length > 1 ? h('i', { class: 'sw ' + x.cls }) : null, x.name); })),
      rowsK.map(function (r) { return h('tr', null, h('td', null, r[0]), all.map(r[1])); }))));
    if (plan.scenarios.length > 3) v.appendChild(h('p', { class: 'note' }, 'シナリオが4つ以上あるので、はじめの3つだけを出しています。'));

    // グラフ
    var years = all[0].rows.map(function (r) { return r.year; });
    v.appendChild(h('div', { class: 'sec' }, h('h2', null, '純資産の見通し'), h('small', null, '年末・万円')));
    var box = h('div', { class: 'card' });
    v.appendChild(box);
    Chart.line(box, {
      label: '純資産の見通し', height: 230,
      xs: years, xLabel: function (i) { return years[i] + '年（' + all[0].rows[i][key] + '歳）'; },
      xTick: function (i) { var a = all[0].rows[i][key]; return a % 10 === 0 ? a + '歳' : ''; },
      yFmt: manAxis,
      series: all.map(function (x) { return { name: x.name, cls: x.cls, values: x.rows.map(function (r) { return Math.round(r.net_worth); }) }; }),
      tip: function (i) {
        var out = all.map(function (x) { return [x.name, man(Math.round(x.rows[i].net_worth)), x.cls]; });
        var ev = all.map(function (x) { return x.rows[i].events; }).filter(function (s, j, a) { return s && a.indexOf(s) === j; }).join('／');
        if (ev) out.push(['できごと', ev]);
        return out;
      }
    });

    // 表
    var cur = sc.indexOf(ui.scen) >= 0 ? ui.scen : sc[0];
    var x = all[sc.indexOf(cur)];
    v.appendChild(h('div', { class: 'sec' }, h('h2', null, 'キャッシュフロー表'), h('small', null, '万円')));
    if (sc.length > 1) {
      v.appendChild(h('div', { class: 'seg', style: 'margin-bottom:8px' }, sc.map(function (s) {
        return h('button', { type: 'button', class: s === cur ? 'on' : '', onclick: function () { ui.scen = s; saveUi(); renderPlan(); } }, s);
      })));
    }
    var tb = h('table', null, h('thead', null, h('tr', null, ['年', '歳', '収入', '支出', '収支', '現預金', '投資', '純資産', 'できごと'].map(function (t) { return h('th', null, t); }))));
    var body = h('tbody');
    x.rows.forEach(function (r) {
      var f = function (n) { var m = Math.round(n); return h('td', { class: 'num' + (m < 0 ? ' neg' : '') }, (m < 0 ? MINUS : '') + comma(Math.abs(m))); };
      body.appendChild(h('tr', { class: me.retirement_age && r[key] === me.retirement_age ? 'retire' : '' },
        h('td', { class: 'num' }, r.year), h('td', { class: 'num' }, r[key]), f(r.income_total), f(r.expense_total), f(r.balance), f(r.cash), f(r.investments), f(r.net_worth),
        h('td', { class: 'evn' }, r.events || '')));
    });
    tb.appendChild(body);
    v.appendChild(h('div', { class: 'cftable' }, tb));
    v.appendChild(h('p', { class: 'note' }, '色の付いた行が退職の年です。'));

    assumptions(v);
    v.appendChild(h('p', { class: 'note' }, '税金・社会保険料の細かい計算はしない、簡易の計算です（もとにしたキットと同じ）。保険・税金・投資の判断は、FP などの専門家にも相談してください。'));
    v.appendChild(h('p', { class: 'note' }, '計算は、もとにしたキットの Python と同じ答えが出ることを確かめてあります。'));
  }

  function assumptions(v, open) {
    var p = Store.data.plan, a = p.assumptions, m = a.members[0], r = a.rates;
    var put = function () { Store.savePlan(); renderPlan(); };
    var numF = function (label, get, set, step, small) {
      return h('label', { class: 'field' }, h('span', null, label), small ? h('small', null, small) : null,
        h('input', { type: 'number', step: step || '1', value: get(), onchange: function (e) { var n = parseFloat(e.target.value); if (isFinite(n)) { set(n); put(); } } }));
    };
    var pct = function (label, k) {
      return numF(label + '（%）', function () { return Math.round(r[k] * 1000) / 10; }, function (n) { r[k] = n / 100; }, '0.1');
    };
    v.appendChild(h('details', { class: 'card', open: !!open }, h('summary', null, '前提（退職年齢・年金・物価上昇率など）'),
      h('div', { class: 'grid2' },
        numF('表の始まりの年', function () { return a.start_year; }, function (n) { a.start_year = Math.trunc(n); }),
        numF('何歳まで計算するか', function () { return a.end_age; }, function (n) { a.end_age = Math.trunc(n); }),
        numF('生まれ年', function () { return m.birth_year; }, function (n) { m.birth_year = Math.trunc(n); }),
        numF('退職する年齢', function () { return m.retirement_age; }, function (n) { m.retirement_age = Math.trunc(n); }),
        numF('年金を受け取り始める年齢', function () { return m.pension_start_age; }, function (n) { m.pension_start_age = Math.trunc(n); }),
        numF('年金の見込み（万円／年）', function () { return m.pension_annual; }, function (n) { m.pension_annual = n; }, '1', 'ねんきん定期便の数字を'),
        numF('生活防衛資金（万円）', function () { return a.min_cash; }, function (n) { a.min_cash = n; }, '10', '現預金がこれを下回りそうな年は、積立を減らす'),
        numF('退職後の生活費（倍）', function () { return a.retired_expense_ratio; }, function (n) { a.retired_expense_ratio = n; }, '0.05'),
        pct('物価上昇率', 'inflation'), pct('手取りの上昇率', 'income_growth'),
        pct('年金の上昇率', 'pension_growth'), pct('投資の想定利回り', 'investment_return'),
        pct('預金金利', 'cash_interest')),
      h('p', { class: 'note' }, 'シナリオ：' + a.scenarios.join('・') + '（名前を変える・増やす画面は、あとで作ります）')));
  }

  /* ================= 設定 ================= */
  function openSettings() {
    var D = Store.data, real = Store.mode() === 'real';
    var mine = Store.rules().filter(function (r) { return r.by === 'mine'; });
    var built = Store.rules().filter(function (r) { return r.by !== 'mine'; });
    openSheet('設定', [
      real || !Store.hasSample() ? null : h('div', { class: 'card' }, h('b', null, '見本'), h('p', { class: 'note' }, 'いまの数字はすべて作り物です。分けたり入れたりしたものは、この端末の中にだけ残ります。下の「受け口」でつなぐと、本物の明細に切り替わります（見本とは混ざりません）。'),
        h('button', { type: 'button', class: 'btn', onclick: function () { if (confirm('見本の数字を作り直します。分けたり入れたりしたものは消えます。よいですか？')) { Store.reset(); closeSheet(); toast('見本を作り直しました'); ui.month = Store.nowYm(); saveUi(); render(); } } }, '見本に戻す')),
      real ? connCard() : connectForm(),
      h('div', { class: 'card' }, h('b', null, '読むもの'), h('ul', { class: 'list' }, Object.keys(PAYS).map(function (k) {
        return h('li', null, h('span', null, PAYS[k].label, h('small', null, PAYS[k].note)));
      })), h('p', { class: 'note' }, 'iPhone のショートカット「取引」（Apple Pay のタッチで店名を埋める）は、まだです（はじめの一歩の3）。')),
      h('div', { class: 'card' }, h('b', null, '毎月決まったもの'),
        h('p', { class: 'note' }, D.fixed.length ? D.fixed.map(function (f) { return f.name; }).join('・') : 'まだありません。給料・家賃・積立など、銀行から入る・出るお金を入れます。'),
        h('button', { type: 'button', class: 'btn', onclick: openFixedList }, D.fixed.length ? '見る・直す・足す' : '入れる')),
      h('div', { class: 'card' }, h('b', null, '分類の決まりごと'),
        h('p', { class: 'note' }, '上から順に見て、最初に当たったもので決めます。自分で決めたものが、用意したものより先です。'),
        mine.length ? h('ul', { class: 'list' }, mine.map(function (r) {
          return h('li', null, h('span', null, shopText({ shop: r.k }) + ' → ' + r.c, h('small', null, '自分で決めた')),
            h('button', { type: 'button', class: 'btn dng', onclick: function () { Store.delRule(r.k); openSettings(); render(); } }, '消す'));
        })) : h('p', { class: 'note' }, '自分で決めたものは、まだありません。分類待ちを分けると増えます。'),
        h('details', null, h('summary', { class: 'note' }, '用意したもの（' + built.length + '本）'), h('ul', { class: 'list' }, built.map(function (r) {
          return h('li', null, h('span', null, r.k + ' → ' + r.c));
        })))),
      h('p', { class: 'note' }, 'Livessa ' + APP.version)
    ]);
  }

  /* つなぐ前：URL と合言葉を入れて、確かめてからつなぐ */
  function connectForm() {
    var url = h('input', { type: 'url', placeholder: 'https://script.google.com/macros/s/…/exec', value: APP.syncUrl || '', autocomplete: 'off' });
    var pin = h('input', { type: 'password', placeholder: '受け口の setup で出た合言葉', autocomplete: 'off' });
    var go = h('button', { type: 'button', class: 'btn pri wide', onclick: function () {
      var u = url.value.trim(), p = pin.value.trim();
      if (!/^https?:\/\//.test(u)) { toast('受け口の URL を入れてください（…/exec で終わるもの）'); return; }
      if (p.length < 16) { toast('合言葉は16文字以上です'); return; }
      go.disabled = true; go.textContent = '確かめています…';
      var got = null;
      Sync.test(u, p).then(function (res) {
        Store.connect(u, p);
        Sync.version = res.version || ''; Sync.lastScan = res.lastScan || 0; Sync.scanError = res.lastError || '';
        return Sync.run(true);
      }).then(function (r) {
        got = r; Sync.start();
        return got;
      }).then(function (r) {
        closeSheet(); ui.month = Store.nowYm(); saveUi(); render();
        toast('受け口とつながりました' + (r && r.pulled ? '（明細など ' + r.pulled + '件を受け取りました）' : ''));
      }).catch(function (e) {
        go.disabled = false; go.textContent = 'つなぐ';
        toast(e.message || String(e));
      });
    } }, 'つなぐ');
    return h('div', { class: 'card' }, h('b', null, '受け口'),
      h('p', { class: 'note' }, 'まだつないでいません。個人の Google アカウントに受け口（Apps Script）を置くと、カード会社のメールを15分ごとに読んで、明細が自動で入ります。作りかたは「受け口の作りかた.md」。'),
      h('label', { class: 'field' }, h('span', null, '受け口の URL'), url),
      h('label', { class: 'field' }, h('span', null, '合言葉'), h('small', null, '★人に見せない。この端末の中にだけ残ります'), pin),
      go);
  }

  /* つないだあと：様子・いますぐ読む・読んだメール・切る */
  function connCard() {
    var c = Store.conn(), st = Sync.state();
    var old = APP.gasVersion && Sync.version && Sync.version !== APP.gasVersion;
    var mails = h('div', { class: 'note' }, '読んだメールを数えています…');
    Sync.call('mails').then(function (r) {
      if (r.lastScan) Sync.lastScan = r.lastScan;
      Sync.scanError = r.lastError || '';
      if (r.lastError) mails.appendChild(h('p', { class: 'note minus' }, '★メールを読めずに止まっています：' + r.lastError));
      mails.innerHTML = '';
      var ul = h('ul', { class: 'list' });
      Object.keys(r.sources).forEach(function (k) {
        var x = r.sources[k];
        ul.appendChild(h('li', null, h('span', null, x.name, h('small', null, 'メール ' + x.read + '通 → 明細 ' + x.items + '件')),
          x.bad ? h('span', { class: 'minus' }, '読めなかった ' + x.bad + '通') : h('span', { class: 'plus' }, 'すべて読めた')));
      });
      mails.appendChild(ul);
      var bad = r.bad || [];
      if (bad.length) mails.appendChild(h('p', { class: 'note minus' }, '読めなかったメールは、受け口のシートの「読んだメール」タブにあります（金額は書いていません）。形が変わったのかもしれないので、Claude に「Livessa の読めなかったメールを見て」と頼んでください。'));
    }).catch(function (e) { mails.textContent = '数えられませんでした：' + (e.message || e); });
    var showPin = h('button', { type: 'button', class: 'btn', onclick: function () { showPin.replaceWith(h('code', null, c.pin)); } }, '合言葉を見る');
    var scanBtn = h('button', { type: 'button', class: 'btn pri', onclick: function () {
      scanBtn.disabled = true; scanBtn.textContent = '読んでいます…';
      Sync.scan().then(function (r) {
        toast('メールを読みました：新しい明細 ' + (r.added || 0) + '件' + (r.bad ? '・読めなかったメール ' + r.bad + '通' : ''));
        closeSheet(); render();
      }).catch(function (e) { scanBtn.disabled = false; scanBtn.textContent = 'いますぐメールを読む'; toast(e.message || String(e)); });
    } }, 'いますぐメールを読む');
    return h('div', { class: 'card' }, h('b', null, '受け口'),
      h('dl', { class: 'kv' },
        h('dt', null, '様子'), h('dd', null, { ok: 'つながっています（同期ずみ）', busy: '送り合っています', pending: 'まだ送っていない直しが ' + st.pending + '件', error: 'つながりません：' + (st.message || ''), off: 'つないでいません' }[st.kind]),
        h('dt', null, 'メールを読んだ'), h('dd', null, Sync.lastScan ? new Date(Sync.lastScan).toLocaleString('ja-JP') : 'まだ／分かりません'),
        h('dt', null, '受け口の版'), h('dd', { class: old ? 'minus' : '' }, (Sync.version || '分かりません') + (old ? '（★コードが古いままです。デプロイし直してください）' : '')),
        h('dt', null, 'URL'), h('dd', { style: 'word-break:break-all' }, c.url.replace(/^(https:\/\/script\.google\.com\/macros\/s\/.{8}).*(\/exec)$/, '$1…$2'))),
      h('div', { class: 'acts', style: 'display:flex;gap:8px;flex-wrap:wrap' }, scanBtn,
        h('button', { type: 'button', class: 'btn', onclick: function () { Sync.run(true).then(function (r) { toast(r && r.pulled ? r.pulled + '件を受け取りました' : '送り合いました'); render(); openSettings(); }).catch(function (e) { toast(e.message || String(e)); }); } }, 'いま送り合う'),
        showPin),
      h('div', { class: 'sec' }, h('h2', null, '読んだメール')), mails,
      h('button', { type: 'button', class: 'btn dng wide', style: 'margin-top:12px', onclick: function () {
        var n = Store.outboxCount();
        if (!confirm((n ? '★まだ送っていない直しが ' + n + '件あります。切ると消えます。\n' : '') + 'つなぎを切ります。この端末の中の控えは消えますが、受け口のシートの中身は消えません（つなぎ直せば戻ります）。よいですか？')) return;
        Sync.stop(); Store.disconnect(); closeSheet(); ui.month = Store.nowYm(); saveUi(); render(); toast(Store.hasSample() ? 'つなぎを切りました。見本に戻っています' : 'つなぎを切りました');
      } }, 'つなぎを切る（この端末だけ）'));
  }

  /* ---------- はじめ ---------- */
  function init() {
    var how = Store.load();
    ui = Store.loadUi();
    if (!VIEWS[ui.view]) ui.view = 'book';
    var ms = Store.months();
    if (!ui.month || ms.indexOf(ui.month) < 0) ui.month = Store.nowYm();
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.addEventListener('click', function () { show(b.getAttribute('data-view')); });
    });
    $('#setBtn').addEventListener('click', openSettings);
    $('#badge').addEventListener('click', function () {
      if (Store.mode() !== 'real') { openSettings(); return; }
      Sync.run(true).then(function (r) { toast(r && r.pulled ? r.pulled + '件を受け取りました' : '送り合いました'); }).catch(function (e) { toast(e.message || String(e)); });
    });
    $('#fab').addEventListener('click', function () { openAdd(); });
    $('#sheetX').addEventListener('click', closeSheet);
    $('#sheetBg').addEventListener('click', closeSheet);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
    var rz = null;
    window.addEventListener('resize', function () {
      clearTimeout(rz);
      rz = setTimeout(function () { if (ui.view === 'bal' || (ui.view === 'plan' && ui.step === 4)) render(); }, 200);
    });
    Store.onSave = function () { Sync.soon(); badge(); };
    var lastErr = '';
    Sync.onChange = function () { badge(); if (Sync.scanError !== lastErr) { lastErr = Sync.scanError; if (ui.view === 'book') render(); } };
    Sync.onData = function () { Store.applyFixed(); render(); };
    Store.applyFixed();   // 毎月決まったもの（給料など）で、その日になったものを家計簿に入れる
    document.addEventListener('visibilitychange', function () { if (!document.hidden && Store.applyFixed()) render(); });
    show(ui.view);
    if (how === 'made') toast('見本の数字を作りました（作り物です）');
    if (Store.mode() === 'real') Sync.start();
    if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});
  }

  init();
})();

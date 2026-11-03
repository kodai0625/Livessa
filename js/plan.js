/* Livessa キャッシュフロー表の計算
   ライフプランキット/scripts/build_cashflow.py の load_plan・simulate・summarize を、そのまま JavaScript に移したもの。
   ★直したら test/計算を突き合わせる.sh を動かして、キットの Python と同じ答えが出るかを確かめること
     （写し間違いは目では見つからない。Flight Board の検算と同じ考え）

   入力の形はキットのファイルのまま（単位もキットのまま。収支表だけ円、ほかは万円）。
     raw = {
       assumptions: 04_assumptions.yaml の中身,
       budget:      02_budget.yaml の中身,
       bs:          02_balance_sheet.yaml の中身,
       events:      03_life_events.csv の1行ずつ（列の名前はキットと同じ。値は文字でも数でもよい）
     }
   Plan.load(raw) が { ok:true, plan } か { ok:false, error } を返し、
   Plan.simulate(plan, シナリオ名) が1年1行の表を、Plan.summarize(plan, rows) が要点を返す。 */
(function (global) {
  'use strict';

  var YEN_PER_MAN = 10000;

  function InputError(msg) { this.message = msg; }

  function toNum(value, where, dflt) {
    if (dflt === undefined) dflt = 0;
    if (value === null || value === undefined) return dflt;
    if (typeof value === 'boolean') throw new InputError(where + ': 数値ではなく ' + value + ' になっています');
    if (typeof value === 'number') return value;
    var text = String(value).trim().replace(/,/g, '').replace(/万円/g, '').replace(/円/g, '');
    if (text === '') return dflt;
    var n = Number(text);
    if (!isFinite(n)) throw new InputError(where + ': 「' + value + '」を数値として読めません');
    return n;
  }

  /* {名前: 金額} の辞書、または [{name, amount, member}] の並びを [名前, 金額, member] にそろえる */
  function itemsOf(section, where) {
    if (!section) return [];
    if (Array.isArray(section)) {
      return section.map(function (item, i) {
        if (!item || typeof item !== 'object') throw new InputError(where + '[' + i + ']: name と amount を持つ形で書いてください');
        var name = String(item.name !== undefined ? item.name : where + '[' + i + ']');
        return [name, toNum(item.amount, where + '.' + name), item.member === undefined ? null : item.member];
      });
    }
    if (typeof section === 'object') {
      return Object.keys(section).map(function (k) { return [String(k), toNum(section[k], where + '.' + k), null]; });
    }
    throw new InputError(where + ': 形式が読めません');
  }

  function sum(list, f) { var s = 0; for (var i = 0; i < list.length; i++) s += f(list[i]); return s; }

  function Member(o) {
    this.name = o.name; this.birth_year = o.birth_year; this.retirement_age = o.retirement_age;
    this.pension_start_age = o.pension_start_age; this.pension_annual = o.pension_annual;
  }
  Member.prototype.age = function (year) { return year - this.birth_year; };
  Member.prototype.works = function (year) { return this.retirement_age !== null && this.age(year) < this.retirement_age; };

  function Event(o) { for (var k in o) this[k] = o[k]; }
  Event.prototype.appliesTo = function (scenario) { return this.scenario === '' || this.scenario === scenario; };
  Event.prototype._active = function (year, stopAtRetirement) {
    if (year < this.year) return false;
    if (this.years !== null) return year < this.year + this.years;
    if (stopAtRetirement) return this.member.works(year);
    return true;
  };
  /* 期間の指定がない収入の増減は、退職前に始まったものは退職まで、退職後に始まったものは最後まで続く */
  Event.prototype.incomeActive = function (year) { return this._active(year, this.member.works(this.year)); };
  Event.prototype.expenseActive = function (year) { return this._active(year, false); };

  function intOrNull(v, where) { return v === null || v === undefined || v === '' ? null : Math.trunc(toNum(v, where)); }

  function load(raw) {
    try { return { ok: true, plan: load_(raw) }; }
    catch (e) {
      if (e instanceof InputError) return { ok: false, error: e.message };
      throw e;
    }
  }

  function load_(raw) {
    var a = raw.assumptions || {}, budget = raw.budget || {}, bs = raw.bs || {};

    // --- 前提条件
    var rawMembers = a.members || [];
    if (!rawMembers.length) throw new InputError('前提条件: 少なくとも「本人」を1人入れてください');
    var members = rawMembers.map(function (m, i) {
      var where = '前提条件 members[' + i + ']';
      if (m.name === undefined || m.birth_year === undefined) throw new InputError(where + ': 名前と生まれ年は必須です');
      return new Member({
        name: String(m.name),
        birth_year: Math.trunc(toNum(m.birth_year, where + '.birth_year')),
        retirement_age: intOrNull(m.retirement_age, where + '.retirement_age'),
        pension_start_age: intOrNull(m.pension_start_age, where + '.pension_start_age'),
        pension_annual: toNum(m.pension_annual, where + '.pension_annual')
      });
    });
    var byName = {};
    members.forEach(function (m) { byName[m.name] = m; });
    if (Object.keys(byName).length !== members.length) throw new InputError('前提条件: 名前が重なっている人がいます');

    var startYear = Math.trunc(toNum(a.start_year, '前提条件 start_year'));
    var endAge = Math.trunc(toNum(a.end_age, '前提条件 end_age', 95));
    var endYear = members[0].birth_year + endAge;
    if (endYear < startYear) throw new InputError('前提条件: 何歳まで計算するかが小さすぎて、計算する年がありません');

    var r = a.rates || {};
    var rates = {
      inflation: toNum(r.inflation, 'rates.inflation', 0),
      income_growth: toNum(r.income_growth, 'rates.income_growth', 0),
      pension_growth: toNum(r.pension_growth, 'rates.pension_growth', 0),
      investment_return: toNum(r.investment_return, 'rates.investment_return', 0),
      cash_interest: toNum(r.cash_interest, 'rates.cash_interest', 0)
    };
    Object.keys(rates).forEach(function (k) {
      if (Math.abs(rates[k]) >= 0.5) throw new InputError('rates.' + k + ' が ' + rates[k] + ' になっています。率は小数で入れてください（1.5% → 0.015）');
    });

    var scenarios = (a.scenarios && a.scenarios.length ? a.scenarios : ['基本']).map(String);

    // --- 収支表（円 → 万円）
    var inc = budget.income || {};
    var baseIncome = {};
    members.forEach(function (m) { baseIncome[m.name] = 0; });
    var incomeItems = [];
    [['monthly', 12], ['annual', 1]].forEach(function (lm) {
      itemsOf(inc[lm[0]], '収支表 income.' + lm[0]).forEach(function (it) {
        var name = it[0], amount = it[1];
        var member = it[2] ? String(it[2]) : members[0].name;
        if (!byName[member]) throw new InputError('収支表「' + name + '」の人「' + member + '」が、前提条件の人の中にいません');
        if (byName[member].retirement_age === null) {
          throw new InputError('収支表「' + name + '」: ' + member + ' に収入があるので、前提条件で ' + member + ' の退職年齢（何歳まで働くか）を入れてください');
        }
        var yearly = amount * lm[1] / YEN_PER_MAN;
        baseIncome[member] += yearly;
        incomeItems.push([name, yearly, member]);
      });
    });

    var exp = budget.expenses || {};
    var livingMonthly = itemsOf(exp.monthly, '収支表 expenses.monthly');
    var livingAnnual = itemsOf(exp.annual, '収支表 expenses.annual');
    var baseLiving = (sum(livingMonthly, function (x) { return x[1]; }) * 12 + sum(livingAnnual, function (x) { return x[1]; })) / YEN_PER_MAN;
    var sav = budget.savings || {};
    var investmentAnnual = toNum(sav.monthly_investment, 'savings.monthly_investment') * 12 / YEN_PER_MAN;

    // --- バランスシート（万円）
    var assets = bs.assets || {};
    var val = function (x) { return x[1]; };
    var cash = sum(itemsOf(assets.cash, 'バランスシート assets.cash'), val);
    var investments = sum(itemsOf(assets.investments, 'バランスシート assets.investments'), val);
    var otherAssets = sum(itemsOf(assets.others, 'バランスシート assets.others'), val);
    var loans = (bs.liabilities || []).map(function (l, i) {
      var where = 'バランスシート liabilities[' + i + ']';
      return {
        name: String(l.name !== undefined ? l.name : '負債' + (i + 1)),
        balance: toNum(l.balance, where + '.balance'),
        annual_repayment: toNum(l.annual_repayment, where + '.annual_repayment'),
        included_in_budget: l.included_in_budget === undefined ? true : !!l.included_in_budget
      };
    });

    var events = loadEvents(raw.events || [], byName, members[0], scenarios);

    var ratio = toNum(a.retired_expense_ratio, 'retired_expense_ratio', 1.0);
    if (!(ratio > 0 && ratio <= 2)) throw new InputError('前提条件: 退職後の生活費は 0.8 のような倍率で入れてください');

    return {
      start_year: startYear, end_year: endYear, min_cash: toNum(a.min_cash, 'min_cash', 0),
      retired_expense_ratio: ratio, members: members, me: members[0], rates: rates, scenarios: scenarios,
      base_income: baseIncome, income_items: incomeItems, living_monthly: livingMonthly, living_annual: livingAnnual,
      base_living: baseLiving, investment_annual: investmentAnnual,
      cash: cash, investments: investments, other_assets: otherAssets, loans: loans, events: events
    };
  }

  function str(v) { return v === null || v === undefined ? '' : String(v).trim(); }

  function loadEvents(rows, byName, me, scenarios) {
    var events = [];
    rows.forEach(function (row0, idx) {
      var row = {};
      Object.keys(row0).forEach(function (k) { row[String(k).trim()] = str(row0[k]); });
      var name = row.event || '';
      if (!name || (row.year || '').charAt(0) === '#') return;
      var where = 'ライフイベント表 ' + (idx + 2) + '行目「' + name + '」';
      var member = byName[row.member || me.name];
      if (!member) throw new InputError(where + ': 人「' + row.member + '」が、前提条件の人の中にいません');
      var year;
      if (row.year) year = Math.trunc(toNum(row.year, where + ' year'));
      else if (row.age) year = member.birth_year + Math.trunc(toNum(row.age, where + ' age'));
      else throw new InputError(where + ': 西暦か年齢のどちらかを入れてください');
      var scenario = row.scenario || '';
      if (scenario && scenarios.indexOf(scenario) < 0) throw new InputError(where + ': シナリオ「' + scenario + '」が、前提条件のシナリオにありません');
      events.push(new Event({
        year: year, member: member, name: name, category: row.category || '',
        one_time: toNum(row.one_time_cost, where + ' one_time_cost'),
        income_change: toNum(row.income_change, where + ' income_change'),
        expense_change: toNum(row.expense_change, where + ' expense_change'),
        years: row.years ? Math.trunc(toNum(row.years, where + ' years')) : null,
        scenario: scenario, memo: row.memo || '', order: events.length
      }));
    });
    // Python の sorted と同じく、同じ年の中では元の順を保つ
    return events.sort(function (x, y) { return x.year - y.year || x.order - y.order; });
  }

  function simulate(plan, scenario) {
    var rt = plan.rates;
    var cash = plan.cash, inv = plan.investments;
    var loans = plan.loans.map(function (l) { return { name: l.name, balance: l.balance, annual_repayment: l.annual_repayment, included_in_budget: l.included_in_budget }; });
    var events = plan.events.filter(function (e) { return e.appliesTo(scenario); });
    var rows = [];

    for (var year = plan.start_year; year <= plan.end_year; year++) {
      var t = year - plan.start_year;
      var fInf = Math.pow(1 + rt.inflation, t);
      var fInc = Math.pow(1 + rt.income_growth, t);
      var fPen = Math.pow(1 + rt.pension_growth, t);
      var row = { year: year };
      plan.members.forEach(function (m) { row['age:' + m.name] = m.age(year); });

      // 収入
      var salaryTotal = 0, pensionTotal = 0;
      plan.members.forEach(function (m) {
        var s = m.works(year) ? plan.base_income[m.name] * fInc : 0;
        var p = (m.pension_start_age !== null && m.age(year) >= m.pension_start_age) ? m.pension_annual * fPen : 0;
        row['salary:' + m.name] = s;
        row['pension:' + m.name] = p;
        salaryTotal += s;
        pensionTotal += p;
      });
      var evIncome = sum(events, function (e) {
        return (e.income_change && e.incomeActive(year)) ? e.income_change * (e.member.works(year) ? fInc : fPen) : 0;
      });
      var lumpIncome = sum(events, function (e) { return (e.year === year && e.one_time < 0) ? -e.one_time : 0; });
      var incomeTotal = salaryTotal + pensionTotal + evIncome + lumpIncome;

      // 支出
      var living = plan.base_living * fInf * (plan.me.works(year) ? 1.0 : plan.retired_expense_ratio);
      var evExpense = sum(events, function (e) { return (e.expense_change && e.expenseActive(year)) ? e.expense_change * fInf : 0; });
      var lumpExpense = sum(events, function (e) { return (e.year === year && e.one_time > 0) ? e.one_time * fInf : 0; });
      var loanOutside = 0;
      loans.forEach(function (l) {
        var pay = Math.min(l.balance, l.annual_repayment);
        l.balance -= pay;
        if (!l.included_in_budget) loanOutside += pay;
      });
      var expenseTotal = living + evExpense + lumpExpense + loanOutside;
      var balance = incomeTotal - expenseTotal;

      // 資産：積立は本人の退職まで。現預金が下限を割りそうな年は積立を減らし、それでも足りなければ投資を取り崩す
      cash = cash * (1 + rt.cash_interest) + balance;
      var planned = plan.me.works(year) ? plan.investment_annual : 0;
      var contribution = Math.min(planned, Math.max(0, cash - plan.min_cash));
      cash -= contribution;
      inv = inv * (1 + rt.investment_return) + contribution;
      var withdrawal = 0;
      if (cash < plan.min_cash && inv > 0) {
        withdrawal = Math.min(plan.min_cash - cash, inv);
        inv -= withdrawal;
        cash += withdrawal;
      }
      var debt = sum(loans, function (l) { return l.balance; });

      row.events = events.filter(function (e) { return e.year === year; }).map(function (e) { return e.name; }).join('／');
      row.event_income = evIncome; row.lump_income = lumpIncome; row.income_total = incomeTotal;
      row.living = living; row.event_expense = evExpense; row.lump_expense = lumpExpense;
      row.loan_outside = loanOutside; row.expense_total = expenseTotal; row.balance = balance;
      row.contribution = contribution; row.withdrawal = withdrawal;
      row.cash = cash; row.investments = inv; row.other_assets = plan.other_assets; row.debt = debt;
      row.net_worth = cash + inv + plan.other_assets - debt;
      rows.push(row);
    }
    return rows;
  }

  function summarize(plan, rows) {
    var me = plan.me, key = 'age:' + me.name;
    var first = function (f) { for (var i = 0; i < rows.length; i++) if (f(rows[i])) return rows[i]; return null; };
    var low = rows[0], peak = rows[0];
    rows.forEach(function (r) { if (r.cash < low.cash) low = r; if (r.net_worth > peak.net_worth) peak = r; });
    var ages = [75, 85, rows[rows.length - 1][key]];
    if (me.retirement_age) ages.push(me.retirement_age);
    ages = ages.filter(function (v, i, s) { return s.indexOf(v) === i; }).sort(function (x, y) { return x - y; });
    var checkpoints = [];
    ages.forEach(function (age) {
      var r = first(function (r) { return r[key] === age; });
      if (r) checkpoints.push({ age: age, year: r.year, net_worth: r.net_worth });
    });
    return {
      deficit_years: rows.filter(function (r) { return r.balance < 0; }).map(function (r) { return r.year; }),
      shortfall: first(function (r) { return r.cash < 0; }),
      first_withdrawal: first(function (r) { return r.withdrawal > 0; }),
      lowest_cash: low,
      peak: peak,
      checkpoints: checkpoints,
      final: rows[rows.length - 1]
    };
  }

  /* 2020, 2021, 2022, 2025 → 「2020〜2022、2025」（キットの year_ranges と同じ） */
  function yearRanges(years) {
    if (!years.length) return 'なし';
    var parts = [], start = years[0], prev = years[0];
    for (var i = 1; i <= years.length; i++) {
      var y = i < years.length ? years[i] : null;
      if (y !== null && y === prev + 1) { prev = y; continue; }
      parts.push(start === prev ? String(start) : start + '〜' + prev);
      if (y !== null) { start = prev = y; }
    }
    return parts.join('、');
  }

  global.Plan = { load: load, simulate: simulate, summarize: summarize, yearRanges: yearRanges, YEN_PER_MAN: YEN_PER_MAN };
})(this);

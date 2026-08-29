"use strict";

/* ============================================================
   ДВИЖОК ИГРЫ

   Состояние стола = свёртка журнала событий. Нигде не хранится
   ни пассивный доход, ни общий расход, ни денежный поток — всё
   это каждый раз выводится из списка активов и пассивов.
   ============================================================ */

function blankPlayer(id, name, prof){
  return {
    id, name,
    professionId: prof.id,
    professionTitle: prof.title,
    salary: prof.salary,
    perChild: prof.perChild,
    savings: prof.savings,
    expenses: Object.assign({}, prof.expenses),
    liabilities: Object.assign({}, prof.liabilities),
    bankLoan: 0,
    children: 0,
    cash: 0,
    stocks: [],   // {id, symbol, qty, price, div}
    props:  [],   // {id, name, kind, down, price, mortgage, cashflow}
    charityTurns: 0,
    skipTurns: 0,
    dream: null,  // {name, base, tokens, bought} — выбирается в начале партии
    otherDreams: [], // [{ownerId, ownerName, name, price}]
    ft: null,       // {startIncome, target, businesses, charity}
    options: []     // [{id,symbol,type,strike,premium,qty,remaining,sourceMode}]
  };
}

/* Производные цифры финансового отчёта в крысиных бегах. */
function derive(p){
  const dividends = p.stocks.reduce((s,h) => s + h.qty * h.div, 0);
  const realty    = p.props.reduce((s,a) => s + a.cashflow, 0);
  const passive   = dividends + realty;
  const totalIncome = p.salary + passive;

  const childExp = p.children * p.perChild;
  const bankPay  = p.bankLoan * 0.1;   // только проценты, долг не уменьшают
  const e = p.expenses;
  const totalExpenses = e.taxes + e.mortgage + e.school + e.car + e.card +
                        e.retail + e.other + childExp + bankPay;

  return {
    dividends, realty, passive, totalIncome,
    childExp, bankPay, totalExpenses,
    cashflow: totalIncome - totalExpenses,
    canEscape: passive > totalExpenses
  };
}

/* Производные цифры на скоростной дорожке. */
function deriveFT(p){
  const biz = p.ft.businesses.reduce((s,b) => s + b.cashflow, 0);
  const income = p.ft.startIncome + biz;
  const bought = !!(p.dream && p.dream.bought);
  const otherDreams = Array.isArray(p.otherDreams) ? p.otherDreams.length : 0;
  return {
    biz, income,
    target: p.ft.target,
    left: Math.max(0, p.ft.target - income),
    dreamBought: bought,
    otherDreamsBought: otherDreams,
    /* Побеждает только тот, кто купил СВОЮ мечту, либо первым набрал
       нужный пассивный доход, либо имеет 2 чужие мечты. */
    won: income >= p.ft.target || bought || otherDreams >= 2
  };
}

/* Цена своей Мечты растёт на 100 % от первоначальной стоимости за каждый
   чужой жетон, поставленный на её поле (правила, стр. 12). */
function dreamPrice(p){
  if(!p.dream) return 0;
  return p.dream.base * (1 + p.dream.tokens);
}

function optionPayout(option, marketPrice){
  if(!option || !Number.isFinite(option.strike) || !Number.isFinite(option.qty) || !Number.isFinite(marketPrice)){
    return 0;
  }
  if(option.type === "call") return Math.max(0, (marketPrice - option.strike) * option.qty);
  if(option.type === "put") return Math.max(0, (option.strike - marketPrice) * option.qty);
  return 0;
}

/* Стартовые наличные: месячный денежный поток плюс сбережения (правила, стр. 2). */
function startingCash(p){ return derive(p).cashflow + p.savings; }

function normalizePortfolioValue(n){
  return Number.isFinite(n) ? n : 0;
}

function addInitialPortfolio(np, profPortfolio, addedPortfolio){
  const p = Object.assign({cash:0, stocks:[], properties:[]}, profPortfolio || {}, addedPortfolio || {});
  (p.stocks || []).forEach((s, idx) => {
    if(!s || !s.symbol) return;
    np.stocks.push({
      id: "ip-stock-" + np.id + "-" + idx,
      symbol: s.symbol,
      qty: Math.max(0, normalizePortfolioValue(s.qty)),
      price: Math.max(0, normalizePortfolioValue(s.price)),
      div: Math.max(0, normalizePortfolioValue(s.div))
    });
  });
  (p.properties || []).forEach((a, idx) => {
    if(!a || !a.name) return;
    const price = Math.max(0, normalizePortfolioValue(a.price));
    const down = Math.max(0, normalizePortfolioValue(a.down));
    np.props.push({
      id: "ip-prop-" + np.id + "-" + idx,
      name: a.name,
      kind: a.kind || "property",
      down,
      price,
      mortgage: a.mortgage != null ? Math.max(0, normalizePortfolioValue(a.mortgage)) : Math.max(0, price - down),
      cashflow: Math.max(0, normalizePortfolioValue(a.cashflow))
    });
  });
  np.cash += Math.max(0, normalizePortfolioValue(p.cash));
}

/* Подъёмные при выходе на дорожку: пассивный доход, округлённый
   до ближайшей тысячи, умноженный на сто (правила, стр. 11). */
function liftoff(passive){ return Math.round(passive / 1000) * 1000 * 100; }

/* ---------- применение одного события ---------- */

function apply(state, ev){
  if(ev.type === "ADD_PLAYER"){
    const prof = PROFESSIONS.find(x => x.id === ev.professionId);
    if(!prof || state.players.some(x => x.id === ev.playerId)) return;
    const np = blankPlayer(ev.playerId, ev.name, prof);
    addInitialPortfolio(np, prof.initialPortfolio, ev.initialPortfolio);
    np.cash += startingCash(np);
    state.players.push(np);
    return;
  }

  if(ev.type === "OPTION_ROUND"){
    state.players.forEach(p => {
      p.options = p.options.filter(opt => {
        const remaining = Number.isFinite(Number(opt.remaining)) ? Number(opt.remaining) : 3;
        if(remaining <= 1) return false;
        opt.remaining = remaining - 1;
        return true;
      });
    });
    return;
  }

  /* Рыночное дробление относится к бумаге, а не к отдельной записи игрока.
     Старое SPLIT ниже оставлено для точного воспроизведения старых журналов. */
  if(ev.type === "MARKET_SPLIT"){
    const ratio = Number(ev.ratio);
    if(!ev.symbol || !Number.isFinite(ratio) || ratio <= 0) return;
    state.players.forEach(player => player.stocks.forEach(h => {
      if(h.symbol === ev.symbol){
        h.qty *= ratio;
        h.price /= ratio;
      }
    }));
    return;
  }

  const p = state.players.find(x => x.id === ev.playerId);
  if(!p) return;

  switch(ev.type){

    case "PAYDAY":
      p.cash += derive(p).cashflow;
      return;

    case "BUY_STOCK":
      p.cash -= ev.price * ev.qty;
      p.stocks.push({id: ev.assetId, symbol: ev.symbol, qty: ev.qty, price: ev.price, div: ev.div});
      return;

    case "SELL_STOCK": {
      const h = p.stocks.find(x => x.id === ev.assetId);
      if(!h) return;
      const qty = Math.min(ev.qty, h.qty);
      p.cash += qty * ev.price;
      h.qty -= qty;
      if(h.qty <= 0) p.stocks = p.stocks.filter(x => x.id !== h.id);
      return;
    }

    case "SPLIT": {
      const h = p.stocks.find(x => x.id === ev.assetId);
      if(!h) return;
      if(ev.direction === "split"){ h.qty = h.qty * 2; h.price = h.price / 2; }
      else { h.qty = Math.floor(h.qty / 2); h.price = h.price * 2; }
      if(h.qty <= 0) p.stocks = p.stocks.filter(x => x.id !== h.id);
      return;
    }

    case "BUY_OPTION":
      p.options.push({
        id: ev.optionId,
        symbol: ev.symbol,
        type: ev.typeOpt,
        strike: ev.strike,
        premium: ev.premium,
        qty: ev.qty,
        remaining: Number.isFinite(ev.remaining) ? Number(ev.remaining) : 3,
        sourceMode: ev.sourceMode
      });
      p.cash -= ev.premium;
      return;

    case "EXERCISE_OPTION": {
      const i = p.options.findIndex(x => x.id === ev.optionId);
      if(i === -1) return;
      const option = p.options[i];
      p.cash += optionPayout(option, ev.marketPrice);
      p.options = p.options.filter(x => x.id !== option.id);
      return;
    }

    /* Наличными платится только первый взнос. Выплаты по ипотеке уже учтены
       в денежном потоке карточки и в колонку «Расходы» не вносятся (стр. 6). */
    case "BUY_PROPERTY":
      p.cash -= ev.down;
      p.props.push({
        id: ev.assetId, name: ev.name, kind: ev.kind,
        down: ev.down, price: ev.price,
        mortgage: ev.price - ev.down,
        cashflow: ev.cashflow
      });
      return;

    /* Финансовый результат = цена продажи − ипотечный кредит (стр. 7). */
    case "SELL_PROPERTY": {
      const a = p.props.find(x => x.id === ev.assetId);
      if(!a) return;
      p.cash += ev.price - a.mortgage;
      p.props = p.props.filter(x => x.id !== a.id);
      return;
    }

    case "TAKE_LOAN":
      p.cash += ev.amount;
      p.bankLoan += ev.amount;
      return;

    case "REPAY_BANK": {
      const amt = Math.min(ev.amount, p.bankLoan);
      p.cash -= amt;
      p.bankLoan -= amt;
      return;
    }

    /* Личные долги гасятся только целиком; выплата по ним обнуляется.
       Налоги, прочие расходы и расходы на детей уменьшать нельзя (стр. 9). */
    case "REPAY_DEBT": {
      if(!DEBTS.some(d => d.k === ev.debt)) return;
      p.cash -= p.liabilities[ev.debt];
      p.liabilities[ev.debt] = 0;
      p.expenses[ev.debt] = 0;
      return;
    }

    case "CHILD":
      if(p.children >= 3) return;
      p.children += 1;
      return;

    case "DOODAD":
      p.cash -= ev.amount;
      return;

    case "CHARITY":
      p.cash -= Math.round(derive(p).totalIncome * 0.1);
      p.charityTurns = 3;
      return;

    /* Увольнение отменяет привилегии благотворительности (стр. 4). */
    case "DOWNSIZED":
      p.cash -= derive(p).totalExpenses;
      p.skipTurns = 2;
      p.charityTurns = 0;
      return;

    case "TICK_CHARITY": p.charityTurns = Math.max(0, p.charityTurns - 1); return;
    case "TICK_SKIP":    p.skipTurns    = Math.max(0, p.skipTurns - 1);    return;

    case "CASH_IN":  p.cash += ev.amount; return;
    case "CASH_OUT": p.cash -= ev.amount; return;

    /* Выход на дорожку: всё сдано банкиру, подъёмные выданы сразу. */
    case "ENTER_FT": {
      const start = liftoff(derive(p).passive);
      p.ft = {startIncome: start, target: start + 50000, businesses: [], charity: false};
      p.cash = start;
      return;
    }

    case "FT_PAYDAY":
      if(p.ft) p.cash += deriveFT(p).income;
      return;

    case "FT_BUY_BIZ":
      if(!p.ft) return;
      p.cash -= ev.down;
      p.ft.businesses.push({id: ev.assetId, name: ev.name, down: ev.down, cashflow: ev.cashflow});
      return;

    /* Благотворительность на дорожке: не обязательна, действует до конца
       игры — можно выбрасывать одну, две или три кости (стр. 12). */
    case "FT_CHARITY":
      if(!p.ft) return;
      p.cash -= ev.amount;
      p.ft.charity = true;
      return;

    /* Мечта выбирается в начале партии, ещё до крысиных бегов (стр. 2). */
    case "SET_DREAM":
      p.dream = {name: ev.name, base: ev.price, tokens: 0, bought: false};
      return;

    /* Чужой игрок попал на поле Мечты и поставил жетон: он ничего не платит,
       но цена Мечты для владельца растёт (стр. 12). */
    case "DREAM_TOKEN":
      if(!p.dream) return;
      p.dream.tokens += 1;
      return;

    /* Покупка СВОЕЙ Мечты — это победа. */
    case "FT_DREAM":
      if(!p.ft) return;
      if(!p.dream){
        p.dream = {name: ev.name || "Мечта", base: ev.price || 0, tokens: 0, bought: false};
      }
      p.cash -= dreamPrice(p);
      p.dream.bought = true;
      return;

    /* Покупка другой мечты на скоростной. Можно купить несколько разных. */
    case "FT_OTHER_DREAM": {
      if(!p.ft) return;
      if(p.id === ev.ownerId) return;
      const owner = state.players.find(x => x.id === ev.ownerId);
      if(!owner || !owner.dream || owner.dream.bought) return;
      if((owner.dream.otherBoughtBy || []).includes(p.id)) return;
      owner.dream.otherBoughtBy = owner.dream.otherBoughtBy || [];
      owner.dream.otherBoughtBy.push(p.id);
      p.cash -= dreamPrice(owner);
      p.otherDreams.push({
        ownerId: owner.id,
        ownerName: owner.name,
        name: owner.dream.name,
        price: dreamPrice(owner)
      });
      return;
    }

    case "FT_LOSE":
      p.cash = ev.share === "all" ? 0 : Math.round(p.cash / 2);
      return;
  }
}

function reduceEvents(events){
  const state = {players: []};
  for(const ev of events){
    try { apply(state, ev); } catch(e){ /* битое событие пропускаем, партия не падает */ }
  }
  return state;
}

/* Предупреждения по игроку: что приложение обязано заметить само. */
function warnings(p){
  const out = [];
  if(p.ft){
    const f = deriveFT(p);
    if(f.won) out.push({level:"good", text:
      f.dreamBought
        ? "Своя Мечта куплена — победа!"
        : f.otherDreamsBought >= 2
          ? "2 чужие мечты куплены — победа!"
          : "Цель по пассивному доходу достигнута — победа!"});
    if(!p.dream) out.push({level:"warn", text:
      "Мечту не выбрала. Задай её кнопкой «Моя мечта» или покупай чужие мечты."});
    if(p.cash < 0) out.push({level:"bad", text:"Наличные ушли в минус."});
    return out;
  }

  const d = derive(p);
  if(p.cash < 0){
    out.push({level:"bad", text:"Наличные в минусе. Возьми кредит в банке или продай актив."});
  }
  if(d.cashflow < 0 && p.cash + d.cashflow < 0){
    out.push({level:"bad", text:
      "Банкротство: поток отрицательный и наличных не хватит на получку. " +
      "По правилам (стр. 10) продай банку активы за половину первого взноса и пропусти три хода."});
  } else if(d.cashflow < 0){
    out.push({level:"warn", text:"Месячный денежный поток отрицательный."});
  }
  if(d.canEscape){
    out.push({level:"good", text:"Пассивный доход перевесил расходы — можно выходить на скоростную дорожку."});
  }
  return out;
}

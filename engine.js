"use strict";

/* ============================================================
   ДВИЖОК ИГРЫ

   Состояние стола = свёртка журнала событий. Нигде не хранится
   ни пассивный доход, ни общий расход, ни денежный поток — всё
   это каждый раз выводится из списка активов и пассивов.
   Поэтому цифры физически не могут разойтись между собой,
   а удаление любой строки журнала честно пересчитывает партию.
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
    options: [],  // {id, type, symbol, qty, strike, premiumPerShare, premiumTotal, remaining}
    shorts: [],   // {id, symbol, qty, openPrice, proceedsEnvelope, mustClose, closePrice}
    props:  [],   // {id, name, kind, down, price, mortgage, cashflow}
    otherAssets: [],       // {id, name, cost, income}
    otherLiabilities: [],  // {id, name, balance, expense}
    charityTurns: 0,
    skipTurns: 0,
    dream: null,  // {name, base, tokens, bought} — выбирается в начале партии
    ft: null      // {startIncome, target, businesses, charity}
  };
}

/* Производные цифры финансового отчёта в крысиных бегах. */
function derive(p){
  const dividends = p.stocks.reduce((s,h) => s + h.qty * h.div, 0);
  const realty    = p.props.reduce((s,a) => s + a.cashflow, 0);
  const otherIncome = p.otherAssets.reduce((s,a) => s + a.income, 0);
  const otherExpenses = p.otherLiabilities.reduce((s,l) => s + l.expense, 0);
  const passive   = dividends + realty + otherIncome;
  const totalIncome = p.salary + passive;

  const childExp = p.children * p.perChild;
  const bankPay  = p.bankLoan * 0.1;   // только проценты, долг не уменьшают
  const e = p.expenses;
  const totalExpenses = e.taxes + e.mortgage + e.school + e.car + e.card +
                        e.retail + e.other + childExp + bankPay + otherExpenses;

  return {
    dividends, realty, otherIncome, passive, totalIncome,
    childExp, bankPay, otherExpenses, totalExpenses,
    cashflow: totalIncome - totalExpenses,
    canEscape: passive > totalExpenses
  };
}

/* Производные цифры на скоростной дорожке. */
function deriveFT(p){
  const biz = p.ft.businesses.reduce((s,b) => s + b.cashflow, 0);
  const income = p.ft.startIncome + biz;
  const bought = !!(p.dream && p.dream.bought);
  return {
    biz, income,
    target: p.ft.target,
    left: Math.max(0, p.ft.target - income),
    dreamBought: bought,
    /* Побеждает только тот, кто купил СВОЮ Мечту, либо первым набрал
       нужный пассивный доход (правила, стр. 1). */
    won: income >= p.ft.target || bought
  };
}

/* Цена своей Мечты растёт на 100 % от первоначальной стоимости за каждый
   чужой жетон, поставленный на её поле (правила, стр. 12). */
function dreamPrice(p){
  if(!p.dream) return 0;
  return p.dream.base * (1 + p.dream.tokens);
}

/* Стартовые наличные: месячный денежный поток плюс сбережения (правила, стр. 2). */
function startingCash(p){ return derive(p).cashflow + p.savings; }

function finiteNumber(value){
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function applyInitialPortfolio(p, portfolio){
  if(!portfolio || typeof portfolio !== "object") return;
  const source = "initial-portfolio";
  p.stocks = (Array.isArray(portfolio.stocks) ? portfolio.stocks : []).map((stock, index) => ({
    id: stock.id || p.id + "-initial-stock-" + index,
    symbol: stock.symbol,
    qty: finiteNumber(stock.qty),
    price: finiteNumber(stock.price),
    div: finiteNumber(stock.div),
    source
  }));
  p.props = (Array.isArray(portfolio.properties) ? portfolio.properties : []).map((property, index) => {
    const price = finiteNumber(property.price);
    const down = finiteNumber(property.down);
    return {
      id: property.id || p.id + "-initial-property-" + index,
      name: property.name,
      kind: property.kind || "property",
      price,
      down,
      mortgage: property.mortgage === undefined || property.mortgage === ""
        ? price - down
        : finiteNumber(property.mortgage),
      cashflow: finiteNumber(property.cashflow),
      source
    };
  });
  p.otherAssets = (Array.isArray(portfolio.otherAssets) ? portfolio.otherAssets : []).map((asset, index) => ({
    id: asset.id || p.id + "-initial-other-asset-" + index,
    name: asset.name,
    cost: finiteNumber(asset.cost),
    income: finiteNumber(asset.income),
    source
  }));
  p.otherLiabilities = (Array.isArray(portfolio.otherLiabilities) ? portfolio.otherLiabilities : []).map((liability, index) => ({
    id: liability.id || p.id + "-initial-other-liability-" + index,
    name: liability.name,
    balance: finiteNumber(liability.balance),
    expense: finiteNumber(liability.expense),
    source
  }));
}

/* Подъёмные при выходе на дорожку: пассивный доход, округлённый
   до ближайшей тысячи, умноженный на сто (правила, стр. 11). */
function liftoff(passive){ return Math.round(passive / 1000) * 1000 * 100; }

/* ---------- применение одного события ---------- */

function configuredOptionRounds(config, ev, legacy){
  const recorded = Number(ev.remaining);
  if(legacy && Number.isInteger(recorded) && recorded >= 1) return recorded;
  return typeof optionRoundLimit === "function" ? optionRoundLimit(config) : 3;
}

function valid202PositionEvent(ev, config){
  const strict = config?.settings?.strictLots === true;
  if(!ev.symbol || !validateLot(ev.qty, strict)) return false;
  if(config?.mode === "202-standard" && ev.symbol !== "OK4U" && ev.symbol !== "MYT4U") return false;
  return config?.mode !== "202-custom" || validateLot(ev.qty, true) || ev.nonstandardLotConfirmed === true;
}

function adjustedQuantity(qty, ratio){
  const next = qty * ratio;
  return ratio < 1 ? Math.floor(next) : next;
}

function lockedShorts(player){
  return (player?.shorts || []).filter(position => position.mustClose);
}

function needsShortLossCover(player){
  const result = lockedShorts(player).reduce((sum, position) =>
    sum + shortResult(position, position.closePrice), 0);
  return result < 0 && player.cash + result < 0;
}

function eventAllowedDuringShortClose(state, ev){
  const owners = state.players.filter(player => lockedShorts(player).length);
  if(!owners.length) return true;
  const owner = owners.find(player => player.id === ev.playerId);
  if(!owner) return false;
  if(ev.type === "CLOSE_SHORT"){
    return lockedShorts(owner).some(position => position.id === ev.shortId);
  }
  if(ev.type === "SELL_STOCK" || ev.type === "SELL_PROPERTY"){
    return needsShortLossCover(owner);
  }
  return ev.type === "DECLARE_202_BANKRUPTCY" && ev.reason === "short-loss" &&
    needsShortLossCover(owner);
}

function apply(state, ev, config){
  if(!eventAllowedDuringShortClose(state, ev)) return;

  if(ev.type === "ADD_PLAYER"){
    const prof = ev.profession && ev.profession.id === ev.professionId
      ? ev.profession
      : PROFESSIONS.find(x => x.id === ev.professionId);
    if(!prof || state.players.some(x => x.id === ev.playerId)) return;
    const np = blankPlayer(ev.playerId, ev.name, prof);
    applyInitialPortfolio(np, ev.initialPortfolio);
    if(ev.dream && ev.dream.name){
      np.dream = {name: ev.dream.name, base: finiteNumber(ev.dream.price ?? ev.dream.base), tokens:0, bought:false};
    }
    np.cash = startingCash(np) + finiteNumber(ev.initialPortfolio?.cash);
    state.players.push(np);
    return;
  }

  /* Старый OPTION_ROUND снимал один тур сразу у всех опционов. Новые игры
     используют ADJUST_OPTION_ROUNDS для одной карточки, но старые журналы
     должны воспроизводиться без изменений. */
  if(ev.type === "OPTION_ROUND"){
    state.players.forEach(player => {
      player.options = player.options.filter(option => {
        const remaining = Number.isFinite(Number(option.remaining)) ? Number(option.remaining) : 3;
        if(remaining <= 1) return false;
        option.remaining = remaining - 1;
        return true;
      });
    });
    return;
  }

  if(ev.type === "MARKET_PRICE"){
    const price = Number(ev.price);
    if(!ev.symbol || !Number.isFinite(price) || price < 0) return;
    state.marketPrices[ev.symbol] = price;
    state.players.forEach(player => player.shorts.forEach(position => {
      if(position.symbol === ev.symbol && !position.mustClose){
        position.mustClose = true;
        position.closePrice = price;
      }
    }));
    return;
  }

  if(ev.type === "COMPANY_BANKRUPTCY"){
    if(!ev.symbol) return;
    state.marketPrices[ev.symbol] = 0;
    state.players.forEach(player => {
      player.stocks = player.stocks.filter(stock => stock.symbol !== ev.symbol);
      player.options = player.options.filter(option => {
        if(option.symbol !== ev.symbol) return true;
        if(option.remaining > 0 && option.type === "put") player.cash += optionPayout(option, 0);
        return false;
      });
      player.shorts = player.shorts.filter(position => {
        if(position.symbol !== ev.symbol) return true;
        player.cash += shortResult(position, 0);
        return false;
      });
    });
    return;
  }

  /* Рыночное дробление относится к бумаге, а не к отдельной записи игрока.
     Старое SPLIT ниже оставлено для точного воспроизведения старых журналов. */
  if(ev.type === "MARKET_SPLIT"){
    const ratio = Number(ev.ratio);
    if(!ev.symbol || !Number.isFinite(ratio) || ratio <= 0) return;
    state.players.forEach(player => {
      player.stocks.forEach(h => {
        if(h.symbol === ev.symbol){
          h.qty = adjustedQuantity(h.qty, ratio);
          h.price /= ratio;
        }
      });
      player.stocks = player.stocks.filter(h => h.symbol !== ev.symbol || h.qty > 0);
      player.options.forEach(option => {
        if(option.symbol === ev.symbol){
          option.qty = adjustedQuantity(option.qty, ratio);
          option.strike /= ratio;
          option.premiumPerShare /= ratio;
        }
      });
      player.options = player.options.filter(option => option.symbol !== ev.symbol || option.qty > 0);
      player.shorts.forEach(position => {
        if(position.symbol === ev.symbol){
          position.qty = adjustedQuantity(position.qty, ratio);
          position.openPrice /= ratio;
          position.proceedsEnvelope = position.qty * position.openPrice;
          if(position.mustClose) position.closePrice /= ratio;
        }
      });
      player.shorts = player.shorts.filter(position => position.symbol !== ev.symbol || position.qty > 0);
    });
    if(Object.prototype.hasOwnProperty.call(state.marketPrices, ev.symbol)){
      state.marketPrices[ev.symbol] /= ratio;
    }
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

    case "BUY_OPTION": {
      const legacy = ev.premium !== undefined && ev.premiumPerShare === undefined && ev.premiumTotal === undefined;
      if((!legacy && p.ft) || (!legacy && !valid202PositionEvent(ev, config))) return;
      const qty = Number(ev.qty);
      const strike = Number(ev.strike);
      if(!ev.symbol || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(strike) || strike <= 0) return;
      const premiumPerShare = legacy ? finiteNumber(ev.premium) / qty : finiteNumber(ev.premiumPerShare);
      if(!legacy && premiumPerShare < 0) return;
      const premiumTotal = legacy ? finiteNumber(ev.premium) : qty * premiumPerShare;
      const roundLimit = configuredOptionRounds(config, ev, legacy);
      p.options.push({
        id:ev.optionId, type:ev.optionType || ev.typeOpt || "call", symbol:ev.symbol,
        qty, strike, premiumPerShare, premiumTotal,
        remaining:roundLimit, roundLimit, active:true, sourceMode:ev.sourceMode || config?.mode
      });
      p.cash -= premiumTotal;
      return;
    }

    case "ADJUST_OPTION_ROUNDS": {
      const option = p.options.find(item => item.id === ev.optionId);
      const delta = Number(ev.delta);
      if(!option || !Number.isInteger(delta) || Math.abs(delta) !== 1) return;
      const roundLimit = Number.isInteger(option.roundLimit) && option.roundLimit >= 1
        ? option.roundLimit
        : configuredOptionRounds(config, option, true);
      option.roundLimit = roundLimit;
      option.remaining = Math.min(roundLimit, Math.max(0, option.remaining + delta));
      option.active = option.remaining > 0;
      return;
    }

    case "EXERCISE_OPTION": {
      const option = p.options.find(item => item.id === ev.optionId);
      if(!option || option.remaining <= 0 || option.active === false) return;
      const recorded = Number(ev.marketPrice);
      const marketPrice = Number.isFinite(recorded) ? recorded : state.marketPrices[option.symbol];
      if(!Number.isFinite(marketPrice)) return;
      p.cash += optionPayout(option, marketPrice);
      p.options = p.options.filter(item => item.id !== option.id);
      return;
    }

    case "OPEN_SHORT": {
      if(!valid202PositionEvent(ev, config)) return;
      const qty = Number(ev.qty);
      const openPrice = Number(ev.openPrice);
      if(!Number.isFinite(openPrice) || openPrice <= 0) return;
      p.shorts.push({
        id:ev.shortId, symbol:ev.symbol, qty, openPrice,
        proceedsEnvelope:qty * openPrice, mustClose:false, closePrice:null
      });
      return;
    }

    case "CLOSE_SHORT": {
      const position = p.shorts.find(item => item.id === ev.shortId);
      if(!position) return;
      const recorded = Number(ev.marketPrice);
      const marketPrice = position.mustClose ? position.closePrice : recorded;
      if(!Number.isFinite(marketPrice)) return;
      const result = shortResult(position, marketPrice);
      if(result < 0 && p.cash + result < 0) return;
      p.cash += result;
      p.shorts = p.shorts.filter(item => item.id !== position.id);
      return;
    }

    case "DECLARE_202_BANKRUPTCY": {
      if(ev.reason !== "short-loss" || !needsShortLossCover(p)) return;
      const locked = lockedShorts(p);
      const result = locked.reduce((sum, position) => sum + shortResult(position, position.closePrice), 0);
      p.cash = Math.max(0, p.cash + result);
      p.shorts = p.shorts.filter(position => !position.mustClose);
      p.skipTurns = Math.max(p.skipTurns, 3);
      return;
    }

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
      if(p.children >= 3) return;   // лимит игры — трое детей
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
      if(!p.dream){   // журнал, записанный прежней версией приложения
        p.dream = {name: ev.name || "Мечта", base: ev.price || 0, tokens: 0, bought: false};
      }
      p.cash -= dreamPrice(p);
      p.dream.bought = true;
      return;

    case "FT_LOSE":
      p.cash = ev.share === "all" ? 0 : Math.round(p.cash / 2);
      return;
  }
}

function reduceEvents(events, config){
  const state = {players: [], marketPrices:{}};
  for(const ev of events){
    try { apply(state, ev, config); } catch(e){ /* битое событие пропускаем, партия не падает */ }
  }
  return state;
}

/* Предупреждения по игроку: что приложение обязано заметить само. */
function warnings(p){
  const out = [];
  const mandatoryShorts = (p.shorts || []).filter(position => position.mustClose);
  mandatoryShorts.forEach(position => {
    const result = shortResult(position, position.closePrice);
    const cover = result < 0 && p.cash + result < 0
      ? " Продай активы или объяви личное банкротство; банковский кредит для убытка по шорту недоступен."
      : "";
    out.push({level:"bad", text:"Короткая позиция " + position.symbol + " должна быть закрыта: " + result + " $" + cover});
  });
  if(p.ft){
    const f = deriveFT(p);
    if(f.won) out.push({level:"good", text:
      f.dreamBought ? "Своя Мечта куплена — победа!" : "Цель по пассивному доходу достигнута — победа!"});
    if(!p.dream) out.push({level:"warn", text:
      "Мечта не выбрана. Задай её кнопкой «Моя мечта» — иначе победу по Мечте не отследить."});
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

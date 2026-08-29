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
    otherExpenses: [],     // {id, name, amount, active}
    cardCounters: [],      // {id, name, remaining, expired}
    d2yCards: [],
    realEstateOptions: [],
    insurance: null,
    creditRestricted: false,
    gameMode: "101",
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
  const d2yMonthly = typeof d2yIncome === "function" ? d2yIncome(p.d2yCards || []) : 0;
  const otherIncome = p.otherAssets.reduce((s,a) => s + a.income, 0) + d2yMonthly;
  const otherExpenses = p.otherLiabilities.reduce((s,l) => s + l.expense, 0);
  const recurringExpenses = (p.otherExpenses || []).reduce((s,item) => s + (item.active ? item.amount : 0), 0);
  const insuranceMonthly = typeof insuranceExpense === "function" ? insuranceExpense(p) : 0;
  const passive   = dividends + realty + otherIncome;
  const totalIncome = p.salary + passive;

  const childExp = p.children * p.perChild;
  const bankPay  = p.bankLoan * 0.1;   // только проценты, долг не уменьшают
  const e = p.expenses;
  const totalExpenses = e.taxes + e.mortgage + e.school + e.car + e.card +
                        e.retail + e.other + childExp + bankPay + otherExpenses +
                        recurringExpenses + insuranceMonthly;

  return {
    dividends, realty, d2yIncome:d2yMonthly, otherIncome, passive, totalIncome,
    childExp, bankPay, otherExpenses, recurringExpenses,
    insuranceExpense:insuranceMonthly, totalExpenses,
    cashflow: totalIncome - totalExpenses,
    canEscape: passive > totalExpenses
  };
}

/* Производные цифры на скоростной дорожке. */
function deriveFT(p){
  const biz = p.ft.businesses.reduce((s,b) => s + b.cashflow, 0);
  const recurringExpenses = (p.otherExpenses || []).reduce((s,item) => s + (item.active ? item.amount : 0), 0);
  const insuranceMonthly = typeof insuranceExpense === "function" ? insuranceExpense(p) : 0;
  const income = p.ft.startIncome + biz - recurringExpenses - insuranceMonthly;
  const bought = !!(p.dream && p.dream.bought);
  return {
    biz, recurringExpenses, insuranceExpense:insuranceMonthly, income,
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
      ...(property.acres === undefined ? {} : {acres:finiteNumber(property.acres)}),
      ...((property.removeCashflowOnSplit || property.removeCashflow || property.cashflowEndsOnSplit)
        ? {removeCashflowOnSplit:true} : {}),
      source
    };
  });
  p.otherAssets = (Array.isArray(portfolio.otherAssets) ? portfolio.otherAssets : []).map((asset, index) => ({
    id: asset.id || p.id + "-initial-other-asset-" + index,
    name: asset.name,
    cost: finiteNumber(asset.cost),
    income: finiteNumber(asset.income),
    kind: asset.kind || "royalty",
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

function is202Config(config){
  return config?.mode === "202-standard" || config?.mode === "202-custom";
}

function allows202Event(config){
  return !config?.mode || is202Config(config);
}

function propertyFromEvent(source, fallbackId){
  if(!source || typeof source !== "object") return null;
  const price = finiteNumber(source.price);
  const down = finiteNumber(source.down);
  return {
    id:source.assetId || source.id || fallbackId,
    name:source.name || "Недвижимость",
    kind:source.kind || "property",
    down, price,
    mortgage:source.mortgage === undefined ? price - down : finiteNumber(source.mortgage),
    cashflow:finiteNumber(source.cashflow),
    ...(source.acres === undefined ? {} : {acres:finiteNumber(source.acres)}),
    ...(source.bookValue === undefined ? {} : {bookValue:finiteNumber(source.bookValue)}),
    ...((source.removeCashflowOnSplit || source.removeCashflow || source.cashflowEndsOnSplit)
      ? {removeCashflowOnSplit:true} : {}),
    ...(source.jointId ? {jointId:source.jointId} : {})
  };
}

function patchOwnedCard(player, ev){
  const collections = {
    stock:[player.stocks, ["symbol", "qty", "price", "div"]],
    property:[player.props, ["name", "price", "down", "mortgage", "cashflow", "acres", "bookValue"]],
    otherAsset:[player.otherAssets, ["name", "cost", "income"]],
    otherLiability:[player.otherLiabilities, ["name", "balance", "expense"]],
    otherExpense:[player.otherExpenses, ["name", "amount"]],
    ftBusiness:[player.ft?.businesses || [], ["name", "down", "price", "cashflow"]]
  };
  const entry = collections[ev.cardType];
  if(!entry || !ev.patch || typeof ev.patch !== "object") return;
  const card = entry[0].find(item => item.id === ev.cardId);
  if(!card) return;
  entry[1].forEach(key => {
    if(!Object.prototype.hasOwnProperty.call(ev.patch, key)) return;
    card[key] = key === "name" || key === "symbol"
      ? String(ev.patch[key])
      : finiteNumber(ev.patch[key]);
  });
}

function oldestRealEstateOption(state){
  let oldest = null;
  state.players.forEach(owner => owner.realEstateOptions.forEach(option => {
    if(!oldest || option.order < oldest.option.order) oldest = {owner, option};
  }));
  return oldest;
}

function immediateRealEstateOption(state){
  for(const owner of state.players){
    const option = owner.realEstateOptions.find(item => item.mustUseImmediately);
    if(option) return {owner, option};
  }
  return null;
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

function eventAllowedDuringImmediateOption(state, ev){
  const pending = immediateRealEstateOption(state);
  if(!pending) return true;
  return ev.type === "RESOLVE_REAL_ESTATE_OPTION" && ev.playerId === pending.owner.id &&
    (ev.optionId || ev.assetId) === pending.option.id;
}

function apply(state, ev, config){
  if(!eventAllowedDuringShortClose(state, ev) || !eventAllowedDuringImmediateOption(state, ev)) return;

  if(ev.type === "ADD_PLAYER"){
    const prof = ev.profession && ev.profession.id === ev.professionId
      ? ev.profession
      : PROFESSIONS.find(x => x.id === ev.professionId);
    if(!prof || state.players.some(x => x.id === ev.playerId)) return;
    const np = blankPlayer(ev.playerId, ev.name, prof);
    np.gameMode = config?.mode || "101";
    applyInitialPortfolio(np, ev.initialPortfolio);
    if(ev.dream && ev.dream.name){
      np.dream = {name: ev.dream.name, base: finiteNumber(ev.dream.price ?? ev.dream.base), tokens:0, bought:false};
    }
    np.cash = startingCash(np) + finiteNumber(ev.initialPortfolio?.cash);
    state.players.push(np);
    return;
  }

  if(ev.type === "INSURED_PROPERTY_EVENT" || ev.type === "INSURED_EVENT"){
    const ids = Array.isArray(ev.playerIds) ? ev.playerIds : [ev.playerId];
    const amount = Math.max(0, finiteNumber(ev.amount));
    ids.forEach(playerId => {
      const owner = state.players.find(player => player.id === playerId);
      if(!owner) return;
      const ownsProperty = owner.props.some(asset => asset.id === ev.assetId || asset.jointId === ev.assetId);
      if(ownsProperty && !owner.insurance) owner.cash -= amount;
    });
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
      if(ev.reason === "short-loss"){
        if(!needsShortLossCover(p)) return;
        const locked = lockedShorts(p);
        const result = locked.reduce((sum, position) => sum + shortResult(position, position.closePrice), 0);
        p.cash = Math.max(0, p.cash + result);
        p.shorts = p.shorts.filter(position => !position.mustClose);
        p.skipTurns = Math.max(p.skipTurns, 3);
        return;
      }
      if(!allows202Event(config)) return;
      const proceeds = Math.max(0, finiteNumber(ev.proceeds ?? ev.bankProceeds));
      const paidToBank = Math.min(proceeds, p.bankLoan);
      const remainder = proceeds - paidToBank;
      p.bankLoan = 0; // uncovered bank credit is written off by the official procedure
      p.cash += remainder;
      p.props = [];
      p.stocks = [];
      p.options = [];
      p.realEstateOptions = [];
      p.skipTurns = Math.max(p.skipTurns, 3);
      p.creditRestricted = true;
      return;
    }

    case "DECLARE_101_BANKRUPTCY": {
      if(is202Config(config)) return;
      const proceeds = p.props.reduce((sum, asset) => sum + finiteNumber(asset.down) / 2, 0) +
        p.otherAssets.reduce((sum, asset) => sum + finiteNumber(asset.cost) / 2, 0);
      p.cash += proceeds;
      p.props = [];
      p.otherAssets = [];
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
    case "BUY_PROPERTY": {
      const asset = propertyFromEvent(ev, ev.assetId);
      if(!asset) return;
      p.cash -= asset.down;
      p.props.push(asset);
      return;
    }

    /* Финансовый результат = цена продажи − ипотечный кредит (стр. 7). */
    case "SELL_PROPERTY": {
      const a = p.props.find(x => x.id === ev.assetId);
      if(!a) return;
      p.cash += ev.price - a.mortgage;
      p.props = p.props.filter(x => x.id !== a.id);
      return;
    }

    case "TAKE_LOAN":
      if(p.creditRestricted && !["mandatory", "mandatory-cost", "mandatoryExpense", "downsized", "downsizing"].includes(ev.purpose)) return;
      p.cash += ev.amount;
      p.bankLoan += ev.amount;
      return;

    case "REPAY_PROPERTY_MORTGAGE": {
      const asset = p.props.find(item => item.id === ev.assetId);
      if(!asset || asset.mortgage <= 0 || p.cash < asset.mortgage) return;
      p.cash -= asset.mortgage;
      asset.mortgage = 0;
      return;
    }

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

    case "REMOVE_CHILD":
      p.children = Math.max(0, p.children - 1);
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

    case "ADD_OTHER_EXPENSE": {
      const amount = Math.max(0, finiteNumber(ev.amount));
      const cadence = ev.cadence || ev.frequency || ev.mode;
      const expenseId = ev.expenseId || ev.cardId || ev.id;
      if(cadence === "monthly"){
        if(p.otherExpenses.some(item => item.id === expenseId)) return;
        p.otherExpenses.push({id:expenseId, name:ev.name || "Прочий расход", amount, active:true});
      } else {
        p.cash -= amount;
      }
      return;
    }

    case "END_OTHER_EXPENSE": {
      const expense = p.otherExpenses.find(item => item.id === (ev.expenseId || ev.cardId));
      if(expense) expense.active = false;
      return;
    }

    case "ADD_CARD_COUNTER": {
      const remaining = Number(ev.remaining ?? ev.turns);
      const counterId = ev.counterId || ev.cardId;
      if(!counterId || !Number.isInteger(remaining) || remaining < 0 ||
         p.cardCounters.some(counter => counter.id === counterId)) return;
      p.cardCounters.push({id:counterId, name:ev.name || "Счётчик", remaining, expired:remaining === 0});
      return;
    }

    case "ADJUST_CARD_COUNTER": {
      const counter = p.cardCounters.find(item => item.id === (ev.counterId || ev.cardId));
      const delta = Number(ev.delta);
      if(!counter || !Number.isInteger(delta) || Math.abs(delta) !== 1) return;
      counter.remaining = Math.max(0, counter.remaining + delta);
      counter.expired = counter.remaining === 0;
      return;
    }

    case "LOSE_CASH_SHARE":
      if(p.cash > 0) p.cash = ev.share === "all" ? 0 : ev.share === "half" ? Math.round(p.cash / 2) : p.cash;
      return;

    case "BUY_REAL_ESTATE_OPTION":
      if(!allows202Event(config) || !(ev.optionId || ev.assetId) ||
         p.realEstateOptions.some(option => option.id === (ev.optionId || ev.assetId))) return;
      if(p.cash < Math.max(0, finiteNumber(ev.cost ?? ev.price))) return;
      p.cash -= Math.max(0, finiteNumber(ev.cost ?? ev.price));
      state.realEstateOptionSequence = (state.realEstateOptionSequence || 0) + 1;
      p.realEstateOptions.push({id:ev.optionId || ev.assetId, order:state.realEstateOptionSequence});
      return;

    case "RESOLVE_REAL_ESTATE_OPTION": {
      if(!allows202Event(config)) return;
      const optionId = ev.optionId || ev.assetId;
      const action = ev.action || ev.decision;
      const pending = oldestRealEstateOption(state);
      if(!pending || pending.owner.id !== p.id || pending.option.id !== optionId) return;
      if(action === "refuse" || action === "decline"){
        p.realEstateOptions = p.realEstateOptions.filter(option => option.id !== optionId);
        return;
      }
      const propertyEvent = ev.property || ev.asset || ev;
      const asset = propertyFromEvent(propertyEvent, propertyEvent.assetId);
      if(!asset) return;
      if(action === "buy"){
        if(p.cash < asset.down) return;
        p.cash -= asset.down;
        p.props.push(asset);
      } else if(action === "sell"){
        const buyer = state.players.find(player => player.id === (ev.buyerId || ev.toPlayerId) && player.id !== p.id);
        if(!buyer) return;
        const salePrice = Math.max(0, finiteNumber(ev.salePrice));
        if(buyer.cash < salePrice + asset.down) return;
        p.cash += salePrice;
        buyer.cash -= salePrice + asset.down;
        buyer.props.push(asset);
      } else return;
      p.realEstateOptions = p.realEstateOptions.filter(option => option.id !== optionId);
      return;
    }

    case "TRANSFER_202_ASSET": {
      if(!allows202Event(config)) return;
      const buyer = state.players.find(player => player.id === (ev.toPlayerId || ev.buyerId) && player.id !== p.id);
      if(!buyer) return;
      const price = Math.max(0, finiteNumber(ev.price));
      if(buyer.cash < price) return;
      let asset = null;
      const assetType = ev.assetType || ev.cardType;
      if(assetType === "property" || assetType === "realEstate"){
        asset = p.props.find(item => item.id === ev.assetId);
        if(asset && !ev.joint) p.props = p.props.filter(item => item.id !== asset.id);
        if(asset){
          const jointId = ev.joint ? (asset.jointId || asset.id) : asset.jointId;
          if(ev.joint) asset.jointId = jointId;
          buyer.props.push({...asset, ...(jointId ? {jointId} : {})});
        }
      } else if(assetType === "royalty"){
        asset = p.otherAssets.find(item => item.id === ev.assetId);
        if(asset) p.otherAssets = p.otherAssets.filter(item => item.id !== asset.id);
        if(asset) buyer.otherAssets.push({...asset});
      } else if(assetType === "realEstateOption" || assetType === "real-estate-option"){
        const oldest = oldestRealEstateOption(state);
        asset = p.realEstateOptions.find(item => item.id === ev.assetId);
        if(asset && oldest?.option.id === asset.id){
          p.realEstateOptions = p.realEstateOptions.filter(item => item.id !== asset.id);
          buyer.realEstateOptions.push({...asset, mustUseImmediately:true});
        } else asset = null;
      }
      if(!asset) return;
      p.cash += price;
      buyer.cash -= price;
      return;
    }

    case "ADD_D2Y": {
      if(!allows202Event(config)) return;
      const number = Number(ev.number ?? ev.cardNumber);
      if(!Number.isInteger(number) || number < 1 || number > 3) return;
      if((number === 1 || number === 3) && p.d2yCards.some(card => card.number === number)) return;
      const cost = Math.max(0, finiteNumber(ev.cost ?? ev.price));
      if(p.cash < cost) return;
      p.cash -= cost;
      p.d2yCards.push({id:ev.cardId || ev.assetId, number, income:finiteNumber(ev.income), cost});
      return;
    }

    case "BUY_INSURANCE":
      if(!allows202Event(config) || p.insurance) return;
      p.insurance = {id:ev.policyId || ev.assetId, expense:Math.max(0, finiteNumber(ev.expense ?? ev.monthlyExpense ?? ev.amount))};
      return;

    case "SPLIT_LAND": {
      if(!allows202Event(config) || typeof splitLand !== "function") return;
      const index = p.props.findIndex(item => item.id === ev.assetId);
      if(index < 0) return;
      const result = splitLand(p.props[index], ev.acresSold, ev.salePrice);
      if(!result) return;
      p.props[index] = result.asset;
      p.cash += result.proceeds;
      return;
    }

    case "EXCHANGE_PROPERTY": {
      if(!allows202Event(config)) return;
      const index = p.props.findIndex(item => item.id === ev.assetId);
      if(index < 0) return;
      const replacementEvent = ev.replacement || ev.newAsset || ev.property;
      const replacement = propertyFromEvent(replacementEvent, replacementEvent?.assetId);
      if(!replacement || replacement.kind !== p.props[index].kind) return;
      p.props[index] = replacement;
      return;
    }

    case "UPDATE_OWNED_CARD":
      patchOwnedCard(p, {
        ...ev,
        cardType:ev.cardType || ev.assetType,
        cardId:ev.cardId || ev.assetId,
        patch:ev.patch || ev.changes
      });
      return;

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
  const state = {players: [], marketPrices:{}, realEstateOptionSequence:0};
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
    out.push({level:"bad", text:p.creditRestricted
      ? "Наличные в минусе. После банкротства кредит разрешён только на обязательные расходы и увольнение; продай актив."
      : "Наличные в минусе. Возьми кредит в банке или продай актив."});
  }
  if(d.cashflow < 0 && p.cash + d.cashflow < 0){
    out.push({level:"bad", text:(p.gameMode === "202-standard" || p.gameMode === "202-custom")
      ? "Банкротство 202: поток отрицательный и наличных не хватит на следующую получку. Продай разрешённые активы Банку или объяви личное банкротство."
      : "Банкротство: поток отрицательный и наличных не хватит на получку. По правилам (стр. 10) продай банку активы за половину первого взноса и пропусти три хода."});
  } else if(d.cashflow < 0){
    out.push({level:"warn", text:"Месячный денежный поток отрицательный."});
  }
  if(d.canEscape){
    out.push({level:"good", text:"Пассивный доход перевесил расходы — можно выходить на скоростную дорожку."});
  }
  return out;
}

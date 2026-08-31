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
    otherDreams: [], // [{fieldId, name, price}] — невыбранные Мечты Скоростной дорожки 202
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
  const otherDreams = Array.isArray(p.otherDreams) ? p.otherDreams : [];
  const official202 = p.gameMode === "202-standard" || p.gameMode === "202-custom";
  const victoryDreams = official202
    ? otherDreams.filter(dream => dream && dream.kind !== "legacy-selected")
    : otherDreams;
  const distinctOtherDreams = new Set(victoryDreams.map((dream, index) =>
    dream && (dream.fieldId ?? dream.id ?? dream.ownerId ?? dream.name) || index)).size;
  const legacySelectedDreams = new Set(otherDreams.filter(dream => dream && dream.kind === "legacy-selected")
    .map((dream, index) => dream.fieldId ?? dream.id ?? dream.ownerId ?? dream.name ?? index)).size;
  const won202 = typeof hasWon202 === "function"
    ? hasWon202(p)
    : biz >= 50000 && (bought || distinctOtherDreams >= 2);
  return {
    biz, recurringExpenses, insuranceExpense:insuranceMonthly, income,
    target: p.ft.target,
    left: official202 ? Math.max(0, 50000 - biz) : Math.max(0, p.ft.target - income),
    dreamBought: bought,
    otherDreamsBought: distinctOtherDreams,
    /* 101 сохраняет прежнее условие. В 202 расчёт передан отдельным
       официальным правилам с обязательной связкой дохода и Мечты. */
    won: official202 ? won202 : income >= p.ft.target || bought || legacySelectedDreams >= 2
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

function otherAssetKind(value){
  return value === "royalty" ? "royalty" : "other";
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
    kind: otherAssetKind(asset.kind),
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

function is202Player(player){
  return player?.gameMode === "202-standard" || player?.gameMode === "202-custom";
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
    otherAsset:[player.otherAssets, ["name", "kind", "cost", "income"]],
    otherLiability:[player.otherLiabilities, ["name", "balance", "expense"]],
    otherExpense:[player.otherExpenses, ["name", "amount"]],
    ftBusiness:[player.ft?.businesses || [], ["name", "price", "down", "mortgage", "cashflow"]]
  };
  const entry = collections[ev.cardType];
  if(!entry || !ev.patch || typeof ev.patch !== "object") return;
  const card = entry[0].find(item => item.id === ev.cardId);
  if(!card) return;
  entry[1].forEach(key => {
    if(!Object.prototype.hasOwnProperty.call(ev.patch, key)) return;
    card[key] = key === "kind" ? otherAssetKind(ev.patch[key])
      : key === "name" || key === "symbol" ? String(ev.patch[key])
      : finiteNumber(ev.patch[key]);
  });
  if(ev.cardType === "ftBusiness" && is202Player(player)){
    if(Object.prototype.hasOwnProperty.call(ev.patch, "price")) card.basePrice = card.price;
    if(Object.prototype.hasOwnProperty.call(ev.patch, "cashflow")){
      card.baseCashflow = finiteNumber(ev.patch.cashflow);
      const franchiseCount = Array.isArray(card.franchises) ? card.franchises.length : 0;
      card.cashflow = card.baseCashflow * (1 + franchiseCount);
    }
  }
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

function addProperty(player, asset){
  if(!asset || player.cash < asset.down) return false;
  player.cash -= asset.down;
  player.props.push({...asset});
  return true;
}

/* Диагностика журнала проверяет только форму записанного события и ссылки
   на игроков. Игровые условия (например, уже проданный актив) остаются в
   apply: старое корректное событие может законно ничего не изменить. */
function eventText(value){ return typeof value === "string" && value.trim() !== ""; }
function eventNumber(value){
  return value !== null && value !== "" && Number.isFinite(Number(value));
}
function eventPositive(value){ return eventNumber(value) && Number(value) > 0; }
function eventNonNegative(value){ return eventNumber(value) && Number(value) >= 0; }
function eventObject(value){ return !!value && typeof value === "object" && !Array.isArray(value); }
function eventAny(ev, keys){ return keys.some(key => ev[key] !== undefined && ev[key] !== null && ev[key] !== ""); }
function eventOptionalNumber(ev, key){ return ev[key] === undefined || eventNumber(ev[key]); }
function eventId(ev, keys){ return keys.some(key => eventText(ev[key])); }

const EVENT_DIAGNOSTICS = Object.freeze({
  ADD_PLAYER:{valid:ev => eventText(ev.playerId) && eventText(ev.professionId)},
  INSURED_PROPERTY_EVENT:{valid:ev => eventId(ev, ["assetId"]) && eventNonNegative(ev.amount) &&
    ((Array.isArray(ev.playerIds) && ev.playerIds.length > 0 && ev.playerIds.every(eventText)) || eventText(ev.playerId)),
    references:ev => Array.isArray(ev.playerIds) ? ev.playerIds : [ev.playerId]},
  INSURED_EVENT:{valid:ev => eventId(ev, ["assetId"]) && eventNonNegative(ev.amount) &&
    ((Array.isArray(ev.playerIds) && ev.playerIds.length > 0 && ev.playerIds.every(eventText)) || eventText(ev.playerId)),
    references:ev => Array.isArray(ev.playerIds) ? ev.playerIds : [ev.playerId]},
  OPTION_ROUND:{},
  MARKET_PRICE:{valid:ev => eventText(ev.symbol) && eventNonNegative(ev.price)},
  COMPANY_BANKRUPTCY:{valid:ev => eventText(ev.symbol)},
  MARKET_SPLIT:{valid:ev => eventText(ev.symbol) && eventPositive(ev.ratio)},

  PAYDAY:{player:true},
  BUY_STOCK:{player:true, valid:ev => eventText(ev.symbol) && eventNumber(ev.qty) &&
    eventNumber(ev.price) && eventNumber(ev.div),
    compatibilityWarning:ev => Number(ev.qty) <= 0 || Number(ev.price) < 0 || Number(ev.div) < 0},
  BUY_OPTION:{player:true, valid:ev => {
    const legacy = ev.premium !== undefined && ev.premiumPerShare === undefined && ev.premiumTotal === undefined;
    return eventText(ev.symbol) && eventPositive(ev.qty) && eventPositive(ev.strike) &&
      (legacy ? eventNumber(ev.premium) : eventNonNegative(ev.premiumPerShare));
  }, compatibilityWarning:ev => ev.premium !== undefined && ev.premiumPerShare === undefined &&
    ev.premiumTotal === undefined && Number(ev.premium) < 0},
  ADJUST_OPTION_ROUNDS:{player:true, valid:ev => eventId(ev, ["optionId"]) &&
    Number.isInteger(Number(ev.delta)) && Math.abs(Number(ev.delta)) === 1},
  EXERCISE_OPTION:{player:true, valid:ev => eventId(ev, ["optionId"]) && eventOptionalNumber(ev, "marketPrice")},
  OPEN_SHORT:{player:true, valid:ev => eventId(ev, ["shortId"]) && eventText(ev.symbol) &&
    eventPositive(ev.qty) && eventPositive(ev.openPrice)},
  CLOSE_SHORT:{player:true, valid:ev => eventId(ev, ["shortId"]) && eventOptionalNumber(ev, "marketPrice")},
  DECLARE_202_BANKRUPTCY:{player:true, valid:ev => eventOptionalNumber(ev, "proceeds") && eventOptionalNumber(ev, "bankProceeds")},
  DECLARE_101_BANKRUPTCY:{player:true},
  SELL_STOCK:{player:true, valid:ev => eventId(ev, ["assetId"]) && eventNumber(ev.qty) && eventNumber(ev.price),
    compatibilityWarning:ev => Number(ev.qty) <= 0 || Number(ev.price) < 0},
  SPLIT:{player:true, valid:ev => eventId(ev, ["assetId"])},
  BUY_PROPERTY:{player:true, valid:ev => eventId(ev, ["assetId", "id"]) && eventText(ev.name) &&
    eventNumber(ev.price) && eventNumber(ev.down) && eventNumber(ev.cashflow) && eventOptionalNumber(ev, "mortgage"),
    compatibilityWarning:ev => Number(ev.price) < 0 || Number(ev.down) < 0 ||
      (ev.mortgage !== undefined && Number(ev.mortgage) < 0)},
  SELL_PROPERTY:{player:true, valid:ev => eventId(ev, ["assetId"]) && eventNumber(ev.price),
    compatibilityWarning:ev => Number(ev.price) < 0},
  TAKE_LOAN:{player:true, valid:ev => eventNumber(ev.amount), compatibilityWarning:ev => Number(ev.amount) <= 0},
  REPAY_PROPERTY_MORTGAGE:{player:true, valid:ev => eventId(ev, ["assetId"])},
  REPAY_BANK:{player:true, valid:ev => eventNumber(ev.amount), compatibilityWarning:ev => Number(ev.amount) <= 0},
  REPAY_DEBT:{player:true, valid:ev => eventText(ev.debt)},
  CHILD:{player:true},
  REMOVE_CHILD:{player:true},
  DOODAD:{player:true, valid:ev => eventNumber(ev.amount), compatibilityWarning:ev => Number(ev.amount) < 0},
  CHARITY:{player:true},
  DOWNSIZED:{player:true},
  TICK_CHARITY:{player:true},
  TICK_SKIP:{player:true},
  ADD_OTHER_EXPENSE:{player:true, valid:ev => eventNonNegative(ev.amount) &&
    ((ev.cadence || ev.frequency || ev.mode) !== "monthly" || eventId(ev, ["expenseId", "cardId", "id"]))},
  END_OTHER_EXPENSE:{player:true, valid:ev => eventId(ev, ["expenseId", "cardId"])},
  ADD_CARD_COUNTER:{player:true, valid:ev => eventId(ev, ["counterId", "cardId"]) &&
    Number.isInteger(Number(ev.remaining ?? ev.turns)) && Number(ev.remaining ?? ev.turns) >= 0},
  ADJUST_CARD_COUNTER:{player:true, valid:ev => eventId(ev, ["counterId", "cardId"]) &&
    Number.isInteger(Number(ev.delta)) && Math.abs(Number(ev.delta)) === 1},
  LOSE_CASH_SHARE:{player:true, valid:ev => ev.share === "all" || ev.share === "half"},
  BUY_REAL_ESTATE_OPTION:{player:true, valid:ev => eventId(ev, ["optionId", "assetId"]) &&
    (eventAny(ev, ["cost", "price"]) ? eventNonNegative(ev.cost ?? ev.price) : true)},
  OFFER_REAL_ESTATE:{player:true, valid:ev => {
    const property = ev.property || ev.asset;
    return eventObject(property) && eventId(property, ["assetId", "id"]) && eventText(property.name) &&
      eventNonNegative(property.price) && eventNonNegative(property.down) && eventNumber(property.cashflow) &&
      eventOptionalNumber(property, "mortgage") && eventId(ev, ["dealId", "assetId"]);
  }},
  RESOLVE_REAL_ESTATE_OPTION:{player:true, valid:ev => {
    const action = ev.action || ev.decision;
    return eventId(ev, ["optionId", "assetId"]) && ["buy", "refuse", "decline", "transfer", "sell"].includes(action) &&
      (!["transfer", "sell"].includes(action) || (eventId(ev, ["buyerId", "toPlayerId"]) && eventNonNegative(ev.salePrice)));
  }, references:ev => ["transfer", "sell"].includes(ev.action || ev.decision) ? [ev.buyerId || ev.toPlayerId] : []},
  RESOLVE_EXTERNAL_REAL_ESTATE_OPTION:{player:true, valid:ev => {
    const action = ev.action || ev.decision;
    if(!eventId(ev, ["optionId", "assetId"]) || !["buy", "transfer", "refuse"].includes(action)) return false;
    if(action === "buy"){
      const property = ev.property || ev.asset;
      return eventObject(property) && eventId(property, ["assetId", "id"]) && eventText(property.name) &&
        eventNonNegative(property.price) && eventNonNegative(property.down) && eventNumber(property.cashflow) &&
        eventOptionalNumber(property, "mortgage");
    }
    return action !== "transfer" || (eventNonNegative(ev.salePrice) && eventText(ev.counterpartyName));
  }},
  CONTINUE_REAL_ESTATE_DEAL:{player:true},
  TRANSFER_202_ASSET:{player:true, valid:ev => eventId(ev, ["toPlayerId", "buyerId"]) && eventId(ev, ["assetId"]) &&
    ["property", "realEstate", "royalty", "realEstateOption", "real-estate-option"].includes(ev.assetType || ev.cardType) &&
    (ev.price === undefined || eventNonNegative(ev.price)), references:ev => [ev.toPlayerId || ev.buyerId]},
  TRANSFER_EXTERNAL_202_ASSET:{player:true, valid:ev => {
    const direction = ev.direction;
    const assetType = ev.assetType || ev.cardType;
    if(!["sell", "buy"].includes(direction) || !["property", "royalty"].includes(assetType) ||
       !eventNonNegative(ev.price)) return false;
    if(direction === "sell") return eventId(ev, ["assetId"]);
    const asset = ev.asset;
    return eventObject(asset) && eventId(asset, ["id", "assetId"]) && eventText(asset.name);
  }},
  ADD_D2Y:{player:true, valid:ev => Number.isInteger(Number(ev.number ?? ev.cardNumber)) &&
    Number(ev.number ?? ev.cardNumber) >= 1 && Number(ev.number ?? ev.cardNumber) <= 3 &&
    eventOptionalNumber(ev, "cost") && eventOptionalNumber(ev, "price") && eventOptionalNumber(ev, "income")},
  BUY_INSURANCE:{player:true, valid:ev => ["expense", "monthlyExpense", "amount"].every(key => eventOptionalNumber(ev, key))},
  SPLIT_LAND:{player:true, valid:ev => eventId(ev, ["assetId"]) && eventPositive(ev.acresSold) && eventNumber(ev.salePrice)},
  EXCHANGE_PROPERTY:{player:true, valid:ev => eventId(ev, ["assetId"]) && eventObject(ev.replacement || ev.newAsset || ev.property)},
  UPDATE_OWNED_CARD:{player:true, valid:ev => eventId(ev, ["cardId", "assetId"]) &&
    eventText(ev.cardType || ev.assetType) && eventObject(ev.patch || ev.changes)},
  CASH_IN:{player:true, valid:ev => eventNumber(ev.amount)},
  CASH_OUT:{player:true, valid:ev => eventNumber(ev.amount)},
  ENTER_FT:{player:true},
  FT_PAYDAY:{player:true},
  FT_BUY_BIZ:{player:true, valid:ev => eventId(ev, ["assetId"]) && eventText(ev.name) &&
    eventNumber(ev.down) && eventNumber(ev.cashflow) && eventOptionalNumber(ev, "price") && eventOptionalNumber(ev, "mortgage"),
    compatibilityWarning:ev => Number(ev.down) < 0 || (ev.price !== undefined && Number(ev.price) < 0) ||
      (ev.mortgage !== undefined && Number(ev.mortgage) < 0)},
  FT_TRANSFER_BUSINESS:{player:true, valid:ev => eventId(ev, ["businessId", "assetId"]),
    references:ev => eventText(ev.fromPlayerId) ? [ev.fromPlayerId] : []},
  FT_TRANSFER_EXTERNAL_BUSINESS:{player:true, valid:ev => {
    if(!["buy", "sell"].includes(ev.direction) || !eventText(ev.counterpartyName)) return false;
    if(ev.direction === "sell") return eventId(ev, ["businessId", "assetId"]);
    const business = ev.business;
    return eventObject(business) && eventId(business, ["id", "assetId"]) && eventText(business.name) &&
      eventPositive(business.basePrice) && eventNonNegative(business.baseCashflow) &&
      eventPositive(business.ownershipTokens);
  }},
  FT_ADD_FRANCHISE:{player:true, valid:ev => eventId(ev, ["businessId", "assetId"]) && eventText(ev.landingId)},
  FT_CHARITY:{player:true, valid:ev => eventOptionalNumber(ev, "amount") && eventOptionalNumber(ev, "dice")},
  FT_CHOOSE_DICE:{player:true, valid:ev => eventNumber(ev.dice)},
  SET_DREAM:{player:true, valid:ev => eventText(ev.name) && eventNumber(ev.price),
    compatibilityWarning:ev => Number(ev.price) < 0},
  DREAM_TOKEN:{player:true},
  RECEIVE_EXTERNAL_DREAM_TOKEN:{player:true, valid:ev => eventText(ev.byPlayerName)},
  FT_DREAM:{player:true, valid:ev => eventOptionalNumber(ev, "price")},
  FT_OTHER_DREAM:{player:true, valid:ev => eventText(ev.ownerId), references:ev => [ev.ownerId]},
  FT_BUY_OTHER_DREAM:{player:true, valid:ev => eventAny(ev, ["fieldId", "dreamId", "assetId", "name"]) && eventOptionalNumber(ev, "price")},
  FT_LOSE:{player:true, valid:ev => ev.share === undefined || ev.share === "all" || ev.share === "half"}
});

function diagnoseEvent(state, ev){
  if(!ev || typeof ev !== "object" || typeof ev.type !== "string" || !ev.type.trim()){
    return {reason:"invalid-event"};
  }
  if(!Object.prototype.hasOwnProperty.call(EVENT_DIAGNOSTICS, ev.type)) return {reason:"unknown-event"};
  const rule = EVENT_DIAGNOSTICS[ev.type];
  if((rule.player && !eventText(ev.playerId)) || (rule.valid && !rule.valid(ev))){
    return {reason:"invalid-event-shape"};
  }
  const references = (rule.player ? [ev.playerId] : []).concat(rule.references ? rule.references(ev) : []);
  const missingPlayerId = references.find(playerId => !state.players.some(player => player.id === playerId));
  if(missingPlayerId) return {reason:"missing-player", referencedPlayerId:missingPlayerId};
  return rule.compatibilityWarning && rule.compatibilityWarning(ev)
    ? {reason:"legacy-invalid-value", applied:true}
    : null;
}

function setSkipCounter(player, ev, turns, keepLonger){
  const remaining = keepLonger ? Math.max(player.skipTurns, turns) : turns;
  player.skipTurns = remaining;
  if(!ev.counterId) return;
  const existing = player.cardCounters.find(counter => counter.id === ev.counterId);
  if(existing){
    existing.name = ev.counterName || "Пропуск ходов";
    existing.kind = "skip";
    existing.remaining = remaining;
    existing.expired = remaining === 0;
  } else {
    player.cardCounters.push({id:ev.counterId, name:ev.counterName || "Пропуск ходов",
      kind:"skip", remaining, expired:remaining === 0});
  }
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
      np.dream = {
        fieldId:String(ev.dream.fieldId || ev.dream.id || ev.dream.name),
        name:ev.dream.name,
        base:finiteNumber(ev.dream.price ?? ev.dream.base),
        tokens:0,
        bought:false
      };
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
      if(!position || !position.mustClose) return;
      const marketPrice = position.closePrice;
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
        setSkipCounter(p, ev, 3, true);
        return;
      }
      if(!allows202Event(config)) return;
      const proceeds = ev.calculationVersion >= 2 && typeof bankruptcy202Breakdown === "function"
        ? bankruptcy202Breakdown(p).total
        : Math.max(0, finiteNumber(ev.proceeds ?? ev.bankProceeds));
      const paidToBank = Math.min(proceeds, p.bankLoan);
      const remainder = proceeds - paidToBank;
      p.bankLoan = 0; // uncovered bank credit is written off by the official procedure
      p.cash += remainder;
      p.props = [];
      p.stocks = [];
      p.options = [];
      p.realEstateOptions = [];
      p.otherAssets = p.otherAssets.filter(asset => asset.kind === "royalty");
      setSkipCounter(p, ev, 3, true);
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
      setSkipCounter(p, ev, 3, true);
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
      if(allows202Event(config) && asset.kind !== "business" &&
         (state.pendingRealEstateDeal || oldestRealEstateOption(state))) return;
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
      setSkipCounter(p, ev, 2, false);
      p.charityTurns = 0;
      return;

    case "TICK_CHARITY": p.charityTurns = Math.max(0, p.charityTurns - 1); return;
    case "TICK_SKIP":
      p.skipTurns = Math.max(0, p.skipTurns - 1);
      p.cardCounters.filter(counter => counter.kind === "skip").forEach(counter => {
        counter.remaining = p.skipTurns;
        counter.expired = p.skipTurns === 0;
      });
      return;

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
      if(counter.kind === "skip") p.skipTurns = counter.remaining;
      return;
    }

    case "LOSE_CASH_SHARE":
      if(p.cash > 0) p.cash = ev.share === "all" ? 0 : ev.share === "half" ? Math.round(p.cash / 2) : p.cash;
      return;

    case "BUY_REAL_ESTATE_OPTION":
      if(!allows202Event(config) || !(ev.optionId || ev.assetId) ||
         state.pendingRealEstateDeal ||
         p.realEstateOptions.some(option => option.id === (ev.optionId || ev.assetId))) return;
      if(p.cash < Math.max(0, finiteNumber(ev.cost ?? ev.price))) return;
      p.cash -= Math.max(0, finiteNumber(ev.cost ?? ev.price));
      state.realEstateOptionSequence = (state.realEstateOptionSequence || 0) + 1;
      p.realEstateOptions.push({id:ev.optionId || ev.assetId, order:state.realEstateOptionSequence,
        cost:Math.max(0, finiteNumber(ev.cost ?? ev.price))});
      return;

    case "OFFER_REAL_ESTATE": {
      if(!allows202Event(config) || state.pendingRealEstateDeal || !oldestRealEstateOption(state)) return;
      const asset = propertyFromEvent(ev.property || ev.asset, ev.dealId || ev.assetId);
      const dealId = ev.dealId || asset?.id;
      if(!asset || !asset.id || !dealId) return;
      state.pendingRealEstateDeal = {
        id:dealId,
        originalPlayerId:p.id,
        property:{...asset}
      };
      return;
    }

    case "RESOLVE_REAL_ESTATE_OPTION": {
      if(!allows202Event(config)) return;
      const optionId = ev.optionId || ev.assetId;
      const action = ev.action || ev.decision;
      const pendingOption = oldestRealEstateOption(state);
      const pendingDeal = state.pendingRealEstateDeal;
      if(!pendingDeal || !pendingOption || pendingOption.owner.id !== p.id ||
         pendingOption.option.id !== optionId) return;
      if(action === "refuse" || action === "decline"){
        p.realEstateOptions = p.realEstateOptions.filter(option => option.id !== optionId);
        return;
      }
      const asset = pendingDeal.property;
      if(action === "buy"){
        if(!addProperty(p, asset)) return;
        p.realEstateOptions = p.realEstateOptions.filter(option => option.id !== optionId);
        state.pendingRealEstateDeal = null;
      } else if(action === "transfer" || action === "sell"){
        const buyer = state.players.find(player => player.id === (ev.buyerId || ev.toPlayerId) && player.id !== p.id);
        if(!buyer) return;
        const salePrice = Math.max(0, finiteNumber(ev.salePrice));
        if(buyer.cash < salePrice || buyer.realEstateOptions.some(option => option.id === optionId)) return;
        p.cash += salePrice;
        buyer.cash -= salePrice;
        p.realEstateOptions = p.realEstateOptions.filter(option => option.id !== optionId);
        buyer.realEstateOptions.push({...pendingOption.option, mustUseImmediately:true});
      } else return;
      return;
    }

    case "CONTINUE_REAL_ESTATE_DEAL": {
      if(!allows202Event(config)) return;
      const pendingDeal = state.pendingRealEstateDeal;
      if(!pendingDeal || pendingDeal.originalPlayerId !== p.id ||
         (ev.dealId && ev.dealId !== pendingDeal.id) || oldestRealEstateOption(state)) return;
      if(addProperty(p, pendingDeal.property)) state.pendingRealEstateDeal = null;
      return;
    }

    case "TRANSFER_202_ASSET": {
      if(!allows202Event(config)) return;
      const buyer = state.players.find(player => player.id === (ev.toPlayerId || ev.buyerId) && player.id !== p.id);
      if(!buyer) return;
      let price = Math.max(0, finiteNumber(ev.price));
      let asset = null;
      const assetType = ev.assetType || ev.cardType;
      if(assetType === "property" || assetType === "realEstate"){
        asset = p.props.find(item => item.id === ev.assetId);
        let transferredTerms = null;
        if(asset && ev.totalPrice !== undefined){
          const settlement = propertyTransferSettlement(ev.totalPrice, asset.mortgage);
          if(!settlement) return;
          price = settlement[2];
          transferredTerms = {price:settlement[0], down:settlement[2], mortgage:settlement[1]};
        }
        if(buyer.cash < price) return;
        if(asset && !ev.joint) p.props = p.props.filter(item => item.id !== asset.id);
        if(asset){
          const jointId = ev.joint ? (asset.jointId || asset.id) : asset.jointId;
          if(ev.joint) asset.jointId = jointId;
          buyer.props.push({...asset, ...(transferredTerms || {}), ...(jointId ? {jointId} : {})});
        }
      } else if(assetType === "royalty"){
        if(buyer.cash < price) return;
        asset = p.otherAssets.find(item => item.id === ev.assetId && item.kind === "royalty");
        if(asset) p.otherAssets = p.otherAssets.filter(item => item.id !== asset.id);
        if(asset) buyer.otherAssets.push({...asset});
      } else if(assetType === "realEstateOption" || assetType === "real-estate-option"){
        if(buyer.cash < price) return;
        const oldest = oldestRealEstateOption(state);
        asset = p.realEstateOptions.find(item => item.id === ev.assetId);
        if(state.pendingRealEstateDeal && asset && oldest?.option.id === asset.id){
          p.realEstateOptions = p.realEstateOptions.filter(item => item.id !== asset.id);
          buyer.realEstateOptions.push({...asset, mustUseImmediately:true});
        } else asset = null;
      }
      if(!asset) return;
      p.cash += price;
      buyer.cash -= price;
      return;
    }

    case "RESOLVE_EXTERNAL_REAL_ESTATE_OPTION": {
      if(!allows202Event(config) || state.pendingRealEstateDeal) return;
      const optionId = ev.optionId || ev.assetId;
      const option = p.realEstateOptions.find(item => item.id === optionId);
      const oldest = oldestRealEstateOption(state);
      if(!option || !oldest || oldest.owner.id !== p.id || oldest.option.id !== optionId) return;
      const action = ev.action || ev.decision;
      if(action === "refuse"){
        p.realEstateOptions = p.realEstateOptions.filter(item => item.id !== optionId);
        return;
      }
      if(action === "transfer"){
        p.cash += Math.max(0, finiteNumber(ev.salePrice));
        p.realEstateOptions = p.realEstateOptions.filter(item => item.id !== optionId);
        return;
      }
      if(action !== "buy") return;
      const asset = propertyFromEvent(ev.property || ev.asset, ev.property?.assetId || ev.property?.id);
      if(!asset || p.cash < asset.down || !addProperty(p, asset)) return;
      p.realEstateOptions = p.realEstateOptions.filter(item => item.id !== optionId);
      return;
    }

    case "TRANSFER_EXTERNAL_202_ASSET": {
      if(!allows202Event(config)) return;
      const direction = ev.direction;
      const assetType = ev.assetType || ev.cardType;
      let price = Math.max(0, finiteNumber(ev.price));
      if(direction === "sell"){
        let asset = null;
        if(assetType === "property"){
          asset = p.props.find(item => item.id === ev.assetId);
          if(asset && ev.totalPrice !== undefined){
            const settlement = propertyTransferSettlement(ev.totalPrice, asset.mortgage);
            if(!settlement) return;
            price = settlement[2];
          }
          if(asset) p.props = p.props.filter(item => item.id !== asset.id);
        } else if(assetType === "royalty"){
          asset = p.otherAssets.find(item => item.id === ev.assetId && item.kind === "royalty");
          if(asset) p.otherAssets = p.otherAssets.filter(item => item.id !== asset.id);
        }
        if(asset) p.cash += price;
        return;
      }
      if(direction !== "buy" || !ev.asset) return;
      if(assetType === "property"){
        if(ev.totalPrice !== undefined){
          const settlement = propertyTransferSettlement(ev.totalPrice, ev.asset.mortgage);
          if(!settlement) return;
          price = settlement[2];
        }
        if(p.cash < price) return;
        const asset = propertyFromEvent(ev.asset, ev.asset.id || ev.asset.assetId);
        if(!asset?.id || p.props.some(item => item.id === asset.id)) return;
        p.props.push(asset);
      } else if(assetType === "royalty"){
        if(p.cash < price) return;
        const id = ev.asset.id || ev.asset.assetId;
        if(!id || p.otherAssets.some(item => item.id === id)) return;
        p.otherAssets.push({
          id,
          name:String(ev.asset.name || "Авторский доход"),
          kind:"royalty",
          cost:Math.max(0, finiteNumber(ev.asset.cost)),
          income:finiteNumber(ev.asset.income)
        });
      } else return;
      p.cash -= price;
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

    case "FT_BUY_BIZ": {
      if(!p.ft) return;
      const down = finiteNumber(ev.down);
      const price = ev.price === undefined ? down : finiteNumber(ev.price);
      const mortgage = ev.mortgage === undefined ? Math.max(0, price - down) : finiteNumber(ev.mortgage);
      const cashflow = finiteNumber(ev.cashflow);
      const official202 = is202Config(config) || is202Player(p);
      p.cash -= official202 ? price : down;
      const business = {
        id:ev.assetId,
        name:String(ev.name || "Бизнес"),
        price,
        down,
        mortgage,
        cashflow
      };
      if(official202){
        business.basePrice = price;
        business.baseCashflow = cashflow;
        business.ownershipTokens = 1;
        business.franchises = [];
      }
      p.ft.businesses.push(business);
      return;
    }

    case "FT_TRANSFER_BUSINESS": {
      if(!p.ft || !(is202Config(config) || is202Player(p))) return;
      const owner = ev.fromPlayerId
        ? state.players.find(player => player.id === ev.fromPlayerId)
        : state.players.find(player => player.id !== p.id && player.ft?.businesses.some(business =>
          business.id === (ev.businessId || ev.assetId)));
      if(!owner || owner.id === p.id || !owner.ft) return;
      const businessId = ev.businessId || ev.assetId;
      const index = owner.ft.businesses.findIndex(business => business.id === businessId);
      if(index < 0) return;
      const business = owner.ft.businesses[index];
      const ownershipTokens = Math.max(1, finiteNumber(business.ownershipTokens || business.tokens || 1)) + 1;
      const transferred = {
        ...business,
        basePrice:finiteNumber(business.basePrice ?? business.price ?? business.down),
        baseCashflow:finiteNumber(business.baseCashflow ?? business.cashflow),
        ownershipTokens,
        franchises:Array.isArray(business.franchises) ? business.franchises.map(franchise => ({...franchise})) : []
      };
      const price = typeof fastTrackBusinessPrice === "function"
        ? fastTrackBusinessPrice(transferred)
        : transferred.basePrice * ownershipTokens;
      owner.ft.businesses.splice(index, 1);
      owner.cash += price;
      p.cash -= price;
      p.ft.businesses.push(transferred);
      return;
    }

    case "FT_TRANSFER_EXTERNAL_BUSINESS": {
      if(!p.ft || !(is202Config(config) || is202Player(p))) return;
      if(ev.direction === "sell"){
        const businessId = ev.businessId || ev.assetId;
        const index = p.ft.businesses.findIndex(business => business.id === businessId);
        if(index < 0) return;
        const business = p.ft.businesses[index];
        const nextTokens = Math.max(1, finiteNumber(business.ownershipTokens || business.tokens || 1)) + 1;
        const price = finiteNumber(business.basePrice ?? business.price ?? business.down) * nextTokens;
        p.ft.businesses.splice(index, 1);
        p.cash += price;
        return;
      }
      if(ev.direction !== "buy" || !ev.business) return;
      const source = ev.business;
      const basePrice = Math.max(0, finiteNumber(source.basePrice ?? source.price));
      const baseCashflow = Math.max(0, finiteNumber(source.baseCashflow ?? source.cashflow));
      const oldTokens = Math.max(1, Math.round(finiteNumber(source.ownershipTokens || source.tokens || 1)));
      const ownershipTokens = oldTokens + 1;
      const franchiseCount = Math.max(0, Math.round(finiteNumber(source.franchiseCount)));
      const price = basePrice * ownershipTokens;
      const id = source.id || source.assetId;
      if(!id || p.cash < price || p.ft.businesses.some(business => business.id === id)) return;
      p.cash -= price;
      p.ft.businesses.push({
        id, name:String(source.name || "Бизнес"), price:basePrice, down:basePrice, mortgage:0,
        basePrice, baseCashflow, ownershipTokens,
        franchises:Array.from({length:franchiseCount}, (_, index) => ({landingId:"external-" + index})),
        cashflow:baseCashflow * (1 + franchiseCount)
      });
      return;
    }

    case "FT_ADD_FRANCHISE": {
      if(!p.ft || !(is202Config(config) || is202Player(p))) return;
      const business = p.ft.businesses.find(item => item.id === (ev.businessId || ev.assetId));
      const landingId = String(ev.landingId || "");
      if(!business || !landingId) return;
      business.franchises = Array.isArray(business.franchises) ? business.franchises : [];
      if(business.franchises.some(franchise => franchise.landingId === landingId)) return;
      business.basePrice = finiteNumber(business.basePrice ?? business.price ?? business.down);
      business.baseCashflow = finiteNumber(business.baseCashflow ?? business.cashflow);
      business.ownershipTokens = Math.max(1,
        finiteNumber(business.ownershipTokens || business.tokens || 1)) + 1;
      business.franchises.push({landingId});
      business.cashflow += business.baseCashflow;
      p.cash -= business.basePrice;
      return;
    }

    /* Благотворительность на дорожке: не обязательна, действует до конца
       игры — можно выбрасывать одну, две или три кости (стр. 12). */
    case "FT_CHARITY":
      if(!p.ft) return;
      if((is202Config(config) || is202Player(p)) && p.ft.charity) return;
      p.cash -= is202Config(config) || is202Player(p) ? 100000 : ev.amount;
      p.ft.charity = true;
      if(is202Config(config) || is202Player(p)){
        p.ft.dice = Math.min(3, Math.max(1, Math.round(finiteNumber(ev.dice) || 1)));
      }
      return;

    case "FT_CHOOSE_DICE":
      if(!p.ft || !p.ft.charity || !(is202Config(config) || is202Player(p))) return;
      p.ft.dice = Math.min(3, Math.max(1, Math.round(finiteNumber(ev.dice) || 1)));
      return;

    /* Мечта выбирается в начале партии, ещё до крысиных бегов (стр. 2). */
    case "SET_DREAM":
      p.dream = {
        fieldId:String(ev.fieldId || ev.dreamId || ev.assetId || ev.name),
        name:ev.name,
        base:ev.price,
        tokens:0,
        bought:false
      };
      return;

    /* Чужой игрок попал на поле Мечты и поставил жетон: он ничего не платит,
       но цена Мечты для владельца растёт (стр. 12). */
    case "DREAM_TOKEN":
      if(!p.dream) return;
      p.dream.tokens += 1;
      return;

    case "RECEIVE_EXTERNAL_DREAM_TOKEN":
      if(!p.dream || p.dream.bought || !(is202Config(config) || is202Player(p))) return;
      p.dream.tokens += 1;
      return;

    /* Покупка СВОЕЙ Мечты — это победа. */
    case "FT_DREAM":
      if(!p.ft) return;
      if(!p.dream){   // журнал, записанный прежней версией приложения
        p.dream = {
          fieldId:String(ev.fieldId || ev.dreamId || ev.assetId || ev.name || "Мечта"),
          name:ev.name || "Мечта",
          base:ev.price || 0,
          tokens:0,
          bought:false
        };
      }
      p.cash -= dreamPrice(p);
      p.dream.bought = true;
      return;

    /* Старые журналы могли покупать выбранную Мечту другого игрока. Новая
       версия больше не создаёт такие события, но воспроизводит их как раньше. */
    case "FT_OTHER_DREAM": {
      if(!p.ft || p.id === ev.ownerId) return;
      const owner = state.players.find(player => player.id === ev.ownerId);
      if(!owner || !owner.dream || owner.dream.bought) return;
      owner.dream.otherBoughtBy = Array.isArray(owner.dream.otherBoughtBy)
        ? owner.dream.otherBoughtBy : [];
      if(owner.dream.otherBoughtBy.includes(p.id)) return;
      const price = dreamPrice(owner);
      owner.dream.otherBoughtBy.push(p.id);
      p.cash -= price;
      p.otherDreams.push({
        kind:"legacy-selected",
        fieldId:String(owner.dream.fieldId || owner.id),
        ownerId:owner.id,
        ownerName:owner.name,
        name:owner.dream.name,
        price
      });
      return;
    }

    case "FT_BUY_OTHER_DREAM": {
      if(!p.ft || !(is202Config(config) || is202Player(p))) return;
      const fieldId = String(ev.fieldId || ev.dreamId || ev.assetId || ev.name || "").trim();
      if(!fieldId) return;
      const dreamName = String(ev.name || "").trim();
      const selected = state.players.some(player => player.dream && (
        String(player.dream.fieldId || player.dream.name) === fieldId ||
        (dreamName && String(player.dream.name).trim() === dreamName)
      ));
      const sold = state.players.some(player => (player.otherDreams || []).some(dream =>
        String(dream.fieldId || dream.id || dream.name) === fieldId));
      if(selected || sold) return;
      const price = Math.max(0, finiteNumber(ev.price));
      p.cash -= price;
      p.otherDreams.push({kind:"unselected", fieldId, name:String(ev.name || "Мечта"), price});
      return;
    }

    case "FT_LOSE":
      p.cash = ev.share === "all" ? 0 : Math.round(p.cash / 2);
      return;
  }
}

function reduceEvents(events, config){
  const state = {
    players: [], marketPrices:{}, realEstateOptionSequence:0,
    pendingRealEstateDeal:null, eventWarnings:[]
  };
  for(const [index, ev] of events.entries()){
    const diagnostic = diagnoseEvent(state, ev);
    if(diagnostic){
      state.eventWarnings.push({
        operationNumber:index + 1,
        eventId:ev && typeof ev === "object" ? ev.id || null : null,
        eventType:ev && typeof ev === "object" ? ev.type || null : null,
        ...diagnostic
      });
      if(!diagnostic.applied) continue;
    }
    try { apply(state, ev, config); }
    catch(error){
      state.eventWarnings.push({
        operationNumber:index + 1,
        eventId:ev.id || null,
        eventType:ev.type || null,
        reason:error && error.name ? error.name : "replay-error"
      });
    }
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
    if(f.won){
      const official202 = is202Player(p);
      out.push({level:"good", text:official202
        ? (f.dreamBought
            ? "Прирост дохода $50 000 и своя Мечта — победа!"
            : "Прирост дохода $50 000 и две другие Мечты — победа!")
        : (f.dreamBought
            ? "Своя Мечта куплена — победа!"
            : "Цель по пассивному доходу достигнута — победа!")});
    }
    if(!p.dream) out.push({level:"warn", text:
      "Мечта не выбрана. В новой партии выбери её при создании игрока; на Скоростной дорожке используй «Купить мечту»."});
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
  const canExit = is202Player(p)
    ? (typeof canEscape202 === "function"
        ? canEscape202(d)
        : d.passive >= 2 * d.totalExpenses)
    : d.canEscape;
  if(canExit){
    out.push({level:"good", text:is202Player(p)
      ? "Пассивный доход не меньше двойного расхода — можно выходить на скоростную дорожку."
      : "Пассивный доход перевесил расходы — можно выходить на скоростную дорожку."});
  }
  return out;
}

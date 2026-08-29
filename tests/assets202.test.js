const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { assert } = require("./helpers");

const ROOT = path.join(__dirname, "..");

function runFile(context, name){
  const file = path.join(ROOT, name);
  if(fs.existsSync(file)) vm.runInContext(fs.readFileSync(file, "utf8"), context);
}

function loadEngine(){
  const context = {};
  vm.createContext(context);
  runFile(context, "game-config.js");
  runFile(context, "professions.js");
  runFile(context, "market202.js");
  runFile(context, "assets202.js");
  runFile(context, "engine.js");
  vm.runInContext(
    "globalThis.task5Engine = {" +
      "reduceEvents, derive, deriveFT, warnings," +
      "d2yIncome:typeof d2yIncome === 'function' ? d2yIncome : null," +
      "splitLand:typeof splitLand === 'function' ? splitLand : null," +
      "insuranceExpense:typeof insuranceExpense === 'function' ? insuranceExpense : null," +
      "createGameConfig" +
    "};",
    context
  );
  return context.task5Engine;
}

function loadUI(){
  const captured = {forms:[], events:[], alerts:[]};
  const context = {
    document:{addEventListener() {}},
    alert:message => captured.alerts.push(message),
    confirm:() => true
  };
  vm.createContext(context);
  runFile(context, "game-config.js");
  runFile(context, "save.js");
  runFile(context, "professions.js");
  runFile(context, "market202.js");
  runFile(context, "assets202.js");
  runFile(context, "engine.js");
  runFile(context, "ui.js");
  vm.runInContext(
    "globalThis.task5UI = {" +
      "setGame(game){G=game;}, setState(state){S=state;}," +
      "actionsFor(player){const ft=!!player.ft;return tableActions(player,ft,ft?deriveFT(player):derive(player));}," +
      "reportRatRace:typeof reportRatRace === 'function' ? reportRatRace : null," +
      "renderCardCounters:typeof renderCardCounters === 'function' ? renderCardCounters : null," +
      "actInsurance:typeof actInsurance === 'function' ? actInsurance : null" +
    "};",
    context
  );
  context.openForm = config => captured.forms.push(config);
  context.push = event => captured.events.push(event);
  return {
    captured,
    ui:context.task5UI,
    submit(values){
      const form = captured.forms[captured.forms.length - 1];
      const error = form.validate ? form.validate(values) : null;
      if(!error) form.submit(values);
      return error;
    }
  };
}

function addPlayer(playerId, initialPortfolio){
  return {type:"ADD_PLAYER", playerId, name:playerId, professionId:"nurse", initialPortfolio};
}

function config(mode = "202-standard"){
  return loadEngine().createGameConfig(mode, mode === "202-custom" ? {optionRounds:5} : {});
}

function game(events, mode = "202-standard"){
  const engine = loadEngine();
  return engine.reduceEvents(events, engine.createGameConfig(mode, mode === "202-custom" ? {optionRounds:5} : {}));
}

function property(overrides = {}){
  return {assetId:"home", name:"Дом", kind:"property", price:1000, down:100, mortgage:900, cashflow:100, ...overrides};
}

test("real-estate options resolve in purchase order and deleting resolution restores the option", () => {
  const events = [
    addPlayer("p1"), addPlayer("p2"),
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"p1", optionId:"first", cost:0},
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"p2", optionId:"second", cost:0},
    {type:"RESOLVE_REAL_ESTATE_OPTION", playerId:"p2", optionId:"second", action:"refuse"},
    {type:"RESOLVE_REAL_ESTATE_OPTION", playerId:"p1", optionId:"first", action:"refuse"},
    {type:"RESOLVE_REAL_ESTATE_OPTION", playerId:"p2", optionId:"second", action:"buy", property:property()}
  ];

  const resolved = game(events);
  const restored = game(events.slice(0, -1));

  assert.equal(resolved.players[0].realEstateOptions.length, 0);
  assert.equal(resolved.players[1].realEstateOptions.length, 0);
  assert.equal(resolved.players[1].props[0].id, "home");
  assert.equal(resolved.players[1].cash, 1500);
  assert.equal(restored.players[1].realEstateOptions[0].id, "second");
  assert.equal(restored.players[1].props.length, 0);
});

test("selling a real-estate option makes the buyer use it in the same event", () => {
  const state = game([
    addPlayer("seller"), addPlayer("buyer"),
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"seller", optionId:"option", cost:0},
    {type:"RESOLVE_REAL_ESTATE_OPTION", playerId:"seller", optionId:"option", action:"sell",
      buyerId:"buyer", salePrice:100, property:property({down:200})}
  ]);
  const seller = state.players[0];
  const buyer = state.players[1];

  assert.equal(seller.cash, 1700);
  assert.equal(buyer.cash, 1300);
  assert.equal(buyer.props[0].id, "home");
  assert.equal(seller.realEstateOptions.length + buyer.realEstateOptions.length, 0);
});

test("D2Y 3 pays only with 1 and at least one 2", () => {
  const { d2yIncome } = loadEngine();
  assert.equal(typeof d2yIncome, "function");
  assert.equal(d2yIncome([{number:3,income:5000}]), 0);
  assert.equal(d2yIncome([{number:1},{number:2,income:1000},{number:3,income:5000}]), 6000);
});

test("D2Y limits cards 1 and 3 while card 2 remains unlimited", () => {
  const p = game([
    addPlayer("p"),
    {type:"ADD_D2Y", playerId:"p", cardId:"one", number:1, income:100, cost:0},
    {type:"ADD_D2Y", playerId:"p", cardId:"one-again", number:1, income:999, cost:0},
    {type:"ADD_D2Y", playerId:"p", cardId:"two-a", number:2, income:1000, cost:0},
    {type:"ADD_D2Y", playerId:"p", cardId:"two-b", number:2, income:2000, cost:0},
    {type:"ADD_D2Y", playerId:"p", cardId:"three", number:3, income:5000, cost:0},
    {type:"ADD_D2Y", playerId:"p", cardId:"three-again", number:3, income:999, cost:0}
  ]).players[0];

  assert.deepEqual(Array.from(p.d2yCards, card => card.number), [1, 2, 2, 3]);
  assert.equal(loadEngine().derive(p).d2yIncome, 8100);
});

test("insurance is a permanent monthly expense and protects every joint owner independently", () => {
  const state = game([
    addPlayer("insured"), addPlayer("uninsured"),
    {type:"BUY_PROPERTY", playerId:"insured", ...property({assetId:"joint", down:0})},
    {type:"BUY_PROPERTY", playerId:"uninsured", ...property({assetId:"joint", down:0})},
    {type:"BUY_INSURANCE", playerId:"insured", policyId:"policy", expense:75},
    {type:"INSURED_PROPERTY_EVENT", playerIds:["insured", "uninsured"], assetId:"joint", amount:500}
  ]);
  const insured = state.players[0];
  const uninsured = state.players[1];

  assert.equal(loadEngine().insuranceExpense(insured), 75);
  assert.equal(loadEngine().derive(insured).insuranceExpense, 75);
  assert.equal(insured.cash, 1600);
  assert.equal(uninsured.cash, 1100);
});

test("land must be mortgage-free before a proportional split", () => {
  const { splitLand } = loadEngine();
  assert.equal(splitLand({acres:10, price:1000, down:200, mortgage:800, cashflow:100}, 4, 500), null);
  const result = splitLand({acres:10, price:1000, down:200, mortgage:0, cashflow:100,
    removeCashflowOnSplit:true}, 4, 500);

  assert.equal(result.proceeds, 500);
  assert.deepEqual(
    [result.asset.acres, result.asset.price, result.asset.down, result.asset.cashflow],
    [6, 600, 120, 0]
  );
});

test("repaying a land mortgage then splitting it changes area, book value, cashflow and cash", () => {
  const p = game([
    addPlayer("p"),
    {type:"BUY_PROPERTY", playerId:"p", ...property({assetId:"land", name:"Земля", kind:"land",
      down:0, mortgage:1000, acres:10, removeCashflowOnSplit:true})},
    {type:"SPLIT_LAND", playerId:"p", assetId:"land", acresSold:4, salePrice:500},
    {type:"REPAY_PROPERTY_MORTGAGE", playerId:"p", assetId:"land"},
    {type:"SPLIT_LAND", playerId:"p", assetId:"land", acresSold:4, salePrice:500}
  ]).players[0];

  assert.deepEqual([p.props[0].acres, p.props[0].price, p.props[0].cashflow], [6, 600, 0]);
  assert.equal(p.cash, 1100);
});

test("property exchange is atomic, same-type and cash-neutral", () => {
  const events = [
    addPlayer("p"),
    {type:"BUY_PROPERTY", playerId:"p", ...property()},
    {type:"EXCHANGE_PROPERTY", playerId:"p", assetId:"home", replacement:
      property({assetId:"new-home", name:"Новый дом", price:2000, down:200, mortgage:1500, cashflow:300})}
  ];
  const exchanged = game(events).players[0];
  const wrongType = game(events.slice(0, -1).concat({
    type:"EXCHANGE_PROPERTY", playerId:"p", assetId:"home",
    replacement:property({assetId:"shop", kind:"business"})
  })).players[0];

  assert.equal(exchanged.cash, 1500);
  assert.deepEqual([exchanged.props[0].id, exchanged.props[0].mortgage, exchanged.props[0].cashflow],
    ["new-home", 1500, 300]);
  assert.equal(wrongType.props[0].id, "home");
});

test("one-time and monthly other expenses have distinct reversible effects", () => {
  const events = [
    addPlayer("p"),
    {type:"ADD_OTHER_EXPENSE", playerId:"p", expenseId:"once", name:"Разово", cadence:"once", amount:200},
    {type:"ADD_OTHER_EXPENSE", playerId:"p", expenseId:"monthly", name:"Сервис", cadence:"monthly", amount:300},
    {type:"END_OTHER_EXPENSE", playerId:"p", expenseId:"monthly"}
  ];
  const ended = game(events).players[0];
  const active = game(events.slice(0, -1)).players[0];

  assert.equal(ended.cash, 1400);
  assert.equal(loadEngine().derive(ended).cashflow, 1120);
  assert.equal(active.cash, 1400);
  assert.equal(loadEngine().derive(active).cashflow, 820);
  assert.equal(active.otherExpenses[0].active, true);
});

test("a recurring expense edit is a patch event and undo restores its earlier amount", () => {
  const events = [
    addPlayer("p"),
    {type:"ADD_OTHER_EXPENSE", playerId:"p", expenseId:"monthly", name:"Сервис", cadence:"monthly", amount:300},
    {type:"UPDATE_OWNED_CARD", playerId:"p", cardType:"otherExpense", cardId:"monthly", patch:{name:"Подписка", amount:400}}
  ];
  const edited = game(events).players[0];
  const restored = game(events.slice(0, -1)).players[0];

  assert.equal(edited.otherExpenses[0].name, "Подписка");
  assert.equal(loadEngine().derive(edited).cashflow, 720);
  assert.equal(restored.otherExpenses[0].amount, 300);
});

test("card counters adjust independently, expire at zero and undo by replay", () => {
  const events = [
    addPlayer("p"),
    {type:"ADD_CARD_COUNTER", playerId:"p", counterId:"a", name:"Благотворительность", remaining:2},
    {type:"ADD_CARD_COUNTER", playerId:"p", counterId:"b", name:"Стихийное бедствие", remaining:3},
    {type:"ADJUST_CARD_COUNTER", playerId:"p", counterId:"a", delta:-1},
    {type:"ADJUST_CARD_COUNTER", playerId:"p", counterId:"b", delta:1},
    {type:"ADJUST_CARD_COUNTER", playerId:"p", counterId:"a", delta:-1}
  ];
  const expired = game(events).players[0];
  const restored = game(events.slice(0, -1)).players[0];

  assert.deepEqual(Array.from(expired.cardCounters, counter => counter.remaining), [0, 4]);
  assert.equal(expired.cardCounters[0].expired, true);
  assert.deepEqual(Array.from(restored.cardCounters, counter => counter.remaining), [1, 4]);
});

test("Downsized cancels Rat Race charity and starts two skipped turns", () => {
  const p = game([
    addPlayer("p"),
    {type:"CHARITY", playerId:"p"},
    {type:"DOWNSIZED", playerId:"p"}
  ], "101").players[0];

  assert.equal(p.charityTurns, 0);
  assert.equal(p.skipTurns, 2);
});

test("cash-share losses work in 101 and 202 without creating bank credit", () => {
  for(const mode of ["101", "202-standard"]){
    const half = game([
      addPlayer("p"), {type:"CASH_IN", playerId:"p", amount:400},
      {type:"LOSE_CASH_SHARE", playerId:"p", share:"half"}
    ], mode).players[0];
    const all = game([
      addPlayer("p"), {type:"CASH_IN", playerId:"p", amount:400},
      {type:"LOSE_CASH_SHARE", playerId:"p", share:"all"}
    ], mode).players[0];

    assert.equal(half.cash, 1000);
    assert.equal(all.cash, 0);
    assert.equal(half.bankLoan + all.bankLoan, 0);
  }
});

test("REMOVE_CHILD updates expenses, clamps at zero and is undone by deleting its event", () => {
  const events = [
    addPlayer("p"),
    {type:"CHILD", playerId:"p"},
    {type:"REMOVE_CHILD", playerId:"p"}
  ];
  const removed = game(events, "101").players[0];
  const restored = game(events.slice(0, -1), "101").players[0];
  const clamped = game(events.concat({type:"REMOVE_CHILD", playerId:"p"}), "101").players[0];

  assert.equal(removed.children, 0);
  assert.equal(loadEngine().derive(removed).childExp, 0);
  assert.equal(restored.children, 1);
  assert.equal(clamped.children, 0);
});

test("negative monthly cashflow stays negative, PAYDAY subtracts it and warnings identify bankruptcy", () => {
  for(const mode of ["101", "202-standard"]){
    const engine = loadEngine();
    const state = engine.reduceEvents([
      addPlayer("p"),
      {type:"BUY_PROPERTY", playerId:"p", ...property({assetId:"loss", down:0, cashflow:-100})},
      {type:"ADD_OTHER_EXPENSE", playerId:"p", expenseId:"monthly", name:"Убыток", cadence:"monthly", amount:2000},
      {type:"PAYDAY", playerId:"p"}
    ], engine.createGameConfig(mode));
    const p = state.players[0];
    const derived = engine.derive(p);

    assert.equal(derived.cashflow, -980);
    assert.equal(p.cash, 620);
    assert.match(engine.warnings(p).map(item => item.text).join(" "), /Банкротство/);
  }
});

test("official 202 bankruptcy sells eligible assets, protects D2Y and royalties, and restricts later credit", () => {
  const p = game([
    addPlayer("p", {cash:0, stocks:[], properties:[],
      otherAssets:[{id:"royalty", name:"Роялти", cost:1000, income:200}], otherLiabilities:[]}),
    {type:"TAKE_LOAN", playerId:"p", amount:5000},
    {type:"BUY_PROPERTY", playerId:"p", ...property()},
    {type:"BUY_STOCK", playerId:"p", assetId:"stock", symbol:"OK4U", qty:100, price:10, div:0},
    {type:"BUY_OPTION", playerId:"p", optionId:"option", optionType:"call", symbol:"OK4U",
      qty:100, strike:20, premiumPerShare:1},
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"p", optionId:"property-option", cost:0},
    {type:"ADD_D2Y", playerId:"p", cardId:"d2y", number:1, income:100, cost:0},
    {type:"DECLARE_202_BANKRUPTCY", playerId:"p", reason:"personal", proceeds:3000},
    {type:"TAKE_LOAN", playerId:"p", amount:1000, purpose:"deal"},
    {type:"TAKE_LOAN", playerId:"p", amount:1000, purpose:"mandatory"},
    {type:"TAKE_LOAN", playerId:"p", amount:1000, purpose:"downsized"}
  ]).players[0];

  assert.equal(p.props.length + p.stocks.length + p.options.length + p.realEstateOptions.length, 0);
  assert.equal(p.d2yCards.length, 1);
  assert.equal(p.otherAssets[0].id, "royalty");
  assert.equal(p.bankLoan, 2000);
  assert.equal(p.creditRestricted, true);
  assert.equal(p.skipTurns, 3);
});

test("101 bankruptcy remains a separate procedure", () => {
  const p = game([
    addPlayer("p"),
    {type:"BUY_PROPERTY", playerId:"p", ...property({down:200})},
    {type:"DECLARE_101_BANKRUPTCY", playerId:"p"}
  ], "101").players[0];

  assert.equal(p.props.length, 0);
  assert.equal(p.cash, 1500);
  assert.equal(p.skipTurns, 3);
  assert.equal(p.creditRestricted, false);
});

test("transfers allow property and royalties but reject market positions and D2Y", () => {
  const state = game([
    addPlayer("seller", {cash:0, stocks:[], properties:[],
      otherAssets:[{id:"royalty", name:"Роялти", cost:1000, income:200}], otherLiabilities:[]}),
    addPlayer("buyer"),
    {type:"TAKE_LOAN", playerId:"seller", amount:1000},
    {type:"BUY_PROPERTY", playerId:"seller", ...property()},
    {type:"BUY_STOCK", playerId:"seller", assetId:"stock", symbol:"OK4U", qty:100, price:1, div:0},
    {type:"ADD_D2Y", playerId:"seller", cardId:"d2y", number:1, income:100, cost:0},
    {type:"TRANSFER_202_ASSET", playerId:"seller", toPlayerId:"buyer", assetType:"stock", assetId:"stock", price:10},
    {type:"TRANSFER_202_ASSET", playerId:"seller", toPlayerId:"buyer", assetType:"d2y", assetId:"d2y", price:10},
    {type:"TRANSFER_202_ASSET", playerId:"seller", toPlayerId:"buyer", assetType:"property", assetId:"home", price:500},
    {type:"TRANSFER_202_ASSET", playerId:"seller", toPlayerId:"buyer", assetType:"royalty", assetId:"royalty", price:100}
  ]);
  const seller = state.players[0];
  const buyer = state.players[1];

  assert.equal(seller.bankLoan, 1000);
  assert.equal(seller.stocks.length, 1);
  assert.equal(seller.d2yCards.length, 1);
  assert.equal(seller.props.length + seller.otherAssets.length, 0);
  assert.equal(buyer.props[0].id, "home");
  assert.equal(buyer.otherAssets[0].id, "royalty");
});

test("UPDATE_OWNED_CARD patches a property without rewriting its purchase and undo restores it", () => {
  const events = [
    addPlayer("p"),
    {type:"BUY_PROPERTY", playerId:"p", ...property()},
    {type:"UPDATE_OWNED_CARD", playerId:"p", cardType:"property", cardId:"home",
      patch:{name:"Исправленный дом", mortgage:700, cashflow:-50}}
  ];
  const edited = game(events).players[0];
  const restored = game(events.slice(0, -1)).players[0];

  assert.deepEqual([edited.props[0].name, edited.props[0].mortgage, edited.props[0].cashflow],
    ["Исправленный дом", 700, -50]);
  assert.deepEqual([restored.props[0].name, restored.props[0].mortgage, restored.props[0].cashflow],
    ["Дом", 900, 100]);
  assert.equal(events[1].name, "Дом");
});

test("UI exposes correction tools in both modes and asset tools only in 202", () => {
  const harness = loadUI();
  const state101 = game([addPlayer("p")], "101");
  harness.ui.setGame({mode:"101", settings:{optionRounds:3, strictLots:false}, events:[]});
  harness.ui.setState(state101);
  const labels101 = harness.ui.actionsFor(state101.players[0]).map(action => action[1]);

  const state202 = game([addPlayer("p")]);
  harness.ui.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});
  harness.ui.setState(state202);
  const labels202 = harness.ui.actionsFor(state202.players[0]).map(action => action[1]);

  for(const labels of [labels101, labels202]){
    assert.equal(labels.includes("Прочий расход"), true);
    assert.equal(labels.includes("Счётчики карточек"), true);
    assert.equal(labels.includes("Налоги / Суд"), true);
    assert.equal(labels.includes("Развод"), true);
  }
  assert.equal(labels101.includes("Страховка"), false);
  assert.equal(labels202.includes("Страховка"), true);
  assert.equal(labels202.includes("D2Y"), true);
  assert.equal(labels202.includes("Опцион на недвижимость"), true);
});

test("UI report renders editable owned cards, recurring expense controls and counter states", () => {
  const harness = loadUI();
  const p = game([
    addPlayer("p"),
    {type:"BUY_PROPERTY", playerId:"p", ...property()},
    {type:"ADD_OTHER_EXPENSE", playerId:"p", expenseId:"monthly", name:"Сервис", cadence:"monthly", amount:300},
    {type:"ADD_CARD_COUNTER", playerId:"p", counterId:"warning", name:"Один ход", remaining:1},
    {type:"ADD_CARD_COUNTER", playerId:"p", counterId:"expired", name:"Истёк", remaining:0}
  ]).players[0];
  const report = harness.ui.reportRatRace(p);
  const counters = harness.ui.renderCardCounters(p);

  assert.match(report, /data-edit-card="property:home"/);
  assert.match(report, /data-edit-card="otherExpense:monthly"/);
  assert.match(report, /data-end-expense="monthly"/);
  assert.match(counters, /instrument warn[^]*Один ход/);
  assert.match(counters, /instrument bad[^]*Истёк/);
  assert.match(counters, /data-counter-minus="warning"[^]*data-counter-plus="warning"/);
});

test("insurance has a usable UI action that records a monthly policy expense", () => {
  const harness = loadUI();
  assert.equal(typeof harness.ui.actInsurance, "function");
  harness.ui.actInsurance(game([addPlayer("p")]).players[0]);

  const error = harness.submit({expense:75});

  assert.equal(error, null);
  assert.equal(harness.captured.events[0].type, "BUY_INSURANCE");
  assert.equal(harness.captured.events[0].expense, 75);
});

test("negative-cashflow tables keep sale and mode-specific bankruptcy actions available", () => {
  for(const mode of ["101", "202-standard"]){
    const harness = loadUI();
    const state = game([
      addPlayer("p"),
      {type:"BUY_PROPERTY", playerId:"p", ...property({assetId:"loss", down:0, cashflow:-100})},
      {type:"ADD_OTHER_EXPENSE", playerId:"p", expenseId:"monthly", name:"Убыток", cadence:"monthly", amount:2000},
      {type:"PAYDAY", playerId:"p"}
    ], mode);
    harness.ui.setGame({mode, settings:{optionRounds:3, strictLots:mode === "202-standard"}, events:[]});
    harness.ui.setState(state);
    const labels = harness.ui.actionsFor(state.players[0]).map(action => action[1]);

    assert.equal(labels.includes("Продать актив"), true);
    assert.equal(labels.includes("Личное банкротство"), true);
  }
});

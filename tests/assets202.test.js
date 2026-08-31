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
  runFile(context, "fast-track202.js");
  runFile(context, "engine.js");
  vm.runInContext(
    "globalThis.task5Engine = {" +
      "reduceEvents, derive, deriveFT, warnings," +
      "d2yIncome:typeof d2yIncome === 'function' ? d2yIncome : null," +
      "splitLand:typeof splitLand === 'function' ? splitLand : null," +
      "insuranceExpense:typeof insuranceExpense === 'function' ? insuranceExpense : null," +
      "propertyTransferSettlement:typeof propertyTransferSettlement === 'function' ? propertyTransferSettlement : null," +
      "bankruptcy202Breakdown:typeof bankruptcy202Breakdown === 'function' ? bankruptcy202Breakdown : null," +
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
  runFile(context, "fast-track202.js");
  runFile(context, "engine.js");
  runFile(context, "ui.js");
  vm.runInContext(
    "globalThis.task5UI = {" +
      "setGame(game){G=game;}, setState(state){S=state;}," +
      "actionsFor(player){const ft=!!player.ft;return tableActions(player,ft,ft?deriveFT(player):derive(player));}," +
      "buildAddPlayerEvent:typeof buildAddPlayerEvent === 'function' ? buildAddPlayerEvent : null," +
      "portfolioRow:typeof portfolioRow === 'function' ? portfolioRow : null," +
      "reportRatRace:typeof reportRatRace === 'function' ? reportRatRace : null," +
      "reportFT:typeof reportFT === 'function' ? reportFT : null," +
      "renderCardCounters:typeof renderCardCounters === 'function' ? renderCardCounters : null," +
      "actInsurance:typeof actInsurance === 'function' ? actInsurance : null," +
      "actEditOwnedCard:typeof actEditOwnedCard === 'function' ? actEditOwnedCard : null," +
      "actDownsized:typeof actDownsized === 'function' ? actDownsized : null," +
      "actRealEstateOption:typeof actRealEstateOption === 'function' ? actRealEstateOption : null," +
      "actBankruptcy:typeof actBankruptcy === 'function' ? actBankruptcy : null" +
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

test("one pending deal blocks BUY_PROPERTY and every option holder resolves the same snapshot in order", () => {
  const events = [
    addPlayer("p1"), addPlayer("p2"), addPlayer("drawer"),
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"p1", optionId:"first", cost:0},
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"p2", optionId:"second", cost:0},
    {type:"BUY_PROPERTY", playerId:"drawer", ...property({assetId:"pre-offer-bypass", name:"Обход до предложения"})},
    {type:"OFFER_REAL_ESTATE", playerId:"drawer", dealId:"deal", property:property({assetId:"offered", name:"Один и тот же дом"})},
    {type:"RESOLVE_REAL_ESTATE_OPTION", playerId:"p2", optionId:"second", action:"refuse"},
    {type:"BUY_PROPERTY", playerId:"drawer", ...property({assetId:"bypass", name:"Обход"})},
    {type:"RESOLVE_REAL_ESTATE_OPTION", playerId:"p1", optionId:"first", action:"refuse"},
    {type:"RESOLVE_REAL_ESTATE_OPTION", playerId:"p2", optionId:"second", action:"buy",
      property:property({assetId:"replacement", name:"Подмена"})}
  ];

  const resolved = game(events);
  const restored = game(events.slice(0, -1));

  assert.equal(resolved.players[0].realEstateOptions.length, 0);
  assert.equal(resolved.players[1].realEstateOptions.length, 0);
  assert.deepEqual([resolved.players[1].props[0].id, resolved.players[1].props[0].name],
    ["offered", "Один и тот же дом"]);
  assert.equal(resolved.players[1].cash, 1500);
  assert.equal(resolved.players[2].props.length, 0);
  assert.equal(resolved.pendingRealEstateDeal, null);
  assert.equal(restored.players[1].realEstateOptions[0].id, "second");
  assert.equal(restored.players[1].props.length, 0);
  assert.equal(restored.pendingRealEstateDeal.id, "deal");
  assert.equal(restored.pendingRealEstateDeal.property.id, "offered");
});

test("all option refusals leave the same deal for its original player to continue explicitly", () => {
  const state = game([
    addPlayer("first"), addPlayer("second"), addPlayer("drawer"),
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"first", optionId:"first-option", cost:0},
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"second", optionId:"second-option", cost:0},
    {type:"OFFER_REAL_ESTATE", playerId:"drawer", dealId:"deal", property:property({assetId:"offered"})},
    {type:"RESOLVE_REAL_ESTATE_OPTION", playerId:"first", optionId:"first-option", action:"refuse"},
    {type:"RESOLVE_REAL_ESTATE_OPTION", playerId:"second", optionId:"second-option", action:"refuse"},
    {type:"BUY_PROPERTY", playerId:"drawer", ...property({assetId:"new-card"})},
    {type:"CONTINUE_REAL_ESTATE_DEAL", playerId:"drawer", dealId:"deal"}
  ]);
  const drawer = state.players[2];

  assert.deepEqual(Array.from(drawer.props, asset => asset.id), ["offered"]);
  assert.equal(drawer.cash, 1500);
  assert.equal(state.pendingRealEstateDeal, null);
});

test("transferred option must be used immediately against the pending deal snapshot", () => {
  const state = game([
    addPlayer("seller"), addPlayer("buyer"), addPlayer("drawer"),
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"seller", optionId:"option", cost:0},
    {type:"OFFER_REAL_ESTATE", playerId:"drawer", dealId:"deal",
      property:property({assetId:"offered", down:200})},
    {type:"RESOLVE_REAL_ESTATE_OPTION", playerId:"seller", optionId:"option", action:"transfer",
      buyerId:"buyer", salePrice:100},
    {type:"CASH_IN", playerId:"buyer", amount:5000},
    {type:"RESOLVE_REAL_ESTATE_OPTION", playerId:"buyer", optionId:"option", action:"buy",
      property:property({assetId:"replacement"})}
  ]);
  const seller = state.players[0];
  const buyer = state.players[1];

  assert.equal(seller.cash, 1700);
  assert.equal(buyer.cash, 1300);
  assert.equal(buyer.props[0].id, "offered");
  assert.equal(seller.realEstateOptions.length + buyer.realEstateOptions.length, 0);
  assert.equal(state.pendingRealEstateDeal, null);
});

test("UI hides ordinary real-estate purchase while an option deal is pending", () => {
  const harness = loadUI();
  const state = game([
    addPlayer("holder"), addPlayer("drawer"),
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"holder", optionId:"option", cost:0},
    {type:"OFFER_REAL_ESTATE", playerId:"drawer", dealId:"deal", property:property({assetId:"offered"})}
  ]);
  harness.ui.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});
  harness.ui.setState(state);
  const labels = harness.ui.actionsFor(state.players[1]).map(action => action[1]);

  assert.equal(labels.includes("Недвижимость"), false);
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

test("new Downsized events expose an adjustable two-turn skip counter", () => {
  const events = [
    addPlayer("p"),
    {type:"DOWNSIZED", playerId:"p", counterId:"skip-turns"},
    {type:"ADJUST_CARD_COUNTER", playerId:"p", counterId:"skip-turns", delta:-1}
  ];
  const adjusted = game(events).players[0];
  const restored = game(events.slice(0, -1)).players[0];

  assert.equal(adjusted.skipTurns, 1);
  assert.equal(adjusted.cardCounters.find(counter => counter.id === "skip-turns").remaining, 1);
  assert.equal(restored.skipTurns, 2);
  assert.equal(restored.cardCounters.find(counter => counter.id === "skip-turns").remaining, 2);
});

test("legacy TICK_SKIP keeps a new visible skip counter synchronized", () => {
  const p = game([
    addPlayer("p"),
    {type:"DOWNSIZED", playerId:"p", counterId:"skip-turns"},
    {type:"TICK_SKIP", playerId:"p"}
  ]).players[0];

  assert.equal(p.skipTurns, 1);
  assert.equal(p.cardCounters.find(counter => counter.id === "skip-turns").remaining, 1);
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
      otherAssets:[{id:"royalty", name:"Роялти", kind:"royalty", cost:1000, income:200}], otherLiabilities:[]}),
    {type:"TAKE_LOAN", playerId:"p", amount:5000},
    {type:"BUY_PROPERTY", playerId:"p", ...property()},
    {type:"BUY_STOCK", playerId:"p", assetId:"stock", symbol:"OK4U", qty:100, price:10, div:0},
    {type:"BUY_OPTION", playerId:"p", optionId:"option", optionType:"call", symbol:"OK4U",
      qty:100, strike:20, premiumPerShare:1},
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"p", optionId:"property-option", cost:0},
    {type:"ADD_D2Y", playerId:"p", cardId:"d2y", number:1, income:100, cost:0},
    {type:"DECLARE_202_BANKRUPTCY", playerId:"p", reason:"personal", proceeds:3000,
      counterId:"skip-turns"},
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
  assert.equal(p.cardCounters.find(counter => counter.id === "skip-turns").remaining, 3);
});

test("101 bankruptcy remains a separate procedure", () => {
  const p = game([
    addPlayer("p"),
    {type:"BUY_PROPERTY", playerId:"p", ...property({down:200})},
    {type:"DECLARE_101_BANKRUPTCY", playerId:"p", counterId:"skip-turns"}
  ], "101").players[0];

  assert.equal(p.props.length, 0);
  assert.equal(p.cash, 1500);
  assert.equal(p.skipTurns, 3);
  assert.equal(p.cardCounters.find(counter => counter.id === "skip-turns").remaining, 3);
  assert.equal(p.creditRestricted, false);
});

test("transfers allow property and royalties but reject market positions and D2Y", () => {
  const state = game([
    addPlayer("seller", {cash:0, stocks:[], properties:[],
      otherAssets:[{id:"royalty", name:"Роялти", kind:"royalty", cost:1000, income:200}], otherLiabilities:[]}),
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

test("new 202 bankruptcy calculates every permitted liquidation value instead of trusting manual proceeds", () => {
  const beforeEvents = [
    addPlayer("p", {cash:0, stocks:[], properties:[], otherLiabilities:[], otherAssets:[
      {id:"generic", name:"Прочий актив", kind:"other", cost:600, income:0},
      {id:"royalty", name:"Роялти", kind:"royalty", cost:1000, income:0}
    ]}),
    {type:"BUY_PROPERTY", playerId:"p", ...property()},
    {type:"BUY_STOCK", playerId:"p", assetId:"stock", symbol:"OK4U", qty:100, price:10, div:0},
    {type:"BUY_OPTION", playerId:"p", optionId:"option", optionType:"call", symbol:"OK4U",
      qty:100, strike:20, premiumPerShare:1},
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"p", optionId:"property-option", cost:200},
    {type:"TAKE_LOAN", playerId:"p", amount:700}
  ];
  const engine = loadEngine();
  const before = game(beforeEvents).players[0];
  const breakdown = engine.bankruptcy202Breakdown(before);
  const after = game(beforeEvents.concat({
    type:"DECLARE_202_BANKRUPTCY", playerId:"p", reason:"personal", calculationVersion:2,
    proceeds:999999, counterId:"skip-turns"
  })).players[0];

  assert.equal(breakdown.total, 1000);
  assert.deepEqual(Array.from(breakdown.rows, row => [row.kind, row.proceeds]), [
    ["property", 50], ["stock", 500], ["option", 50],
    ["real-estate-option", 100], ["other", 300]
  ]);
  assert.equal(after.cash, 1200);
  assert.equal(after.bankLoan, 0);
  assert.equal(after.otherAssets[0].id, "royalty");
});

test("202 bankruptcy UI presents an automatic asset-by-asset calculation", () => {
  const harness = loadUI();
  const state = game([
    addPlayer("p"),
    {type:"BUY_PROPERTY", playerId:"p", ...property()},
    {type:"BUY_STOCK", playerId:"p", assetId:"stock", symbol:"OK4U", qty:100, price:1, div:0}
  ]);
  harness.ui.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});
  harness.ui.setState(state);

  harness.ui.actBankruptcy(state.players[0], "202");
  const form = harness.captured.forms.at(-1);
  assert.equal(form.fields.length, 0);
  assert.match(form.intro, /Дом[^]*\$50[^]*OK4U[^]*\$50/);
  form.submit({});
  assert.equal(harness.captured.events[0].calculationVersion, 2);
});

test("an option holder can resolve a property card drawn on another device", () => {
  const events = [
    addPlayer("holder"),
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"holder", optionId:"option", cost:0},
    {type:"RESOLVE_EXTERNAL_REAL_ESTATE_OPTION", playerId:"holder", optionId:"option",
      action:"buy", dealRef:"RE-1234", sourcePlayerName:"Другой телефон",
      property:property({assetId:"external-house", down:200, cashflow:150})}
  ];
  const resolved = game(events).players[0];
  const restored = game(events.slice(0, -1)).players[0];

  assert.equal(resolved.realEstateOptions.length, 0);
  assert.equal(resolved.props[0].id, "external-house");
  assert.equal(resolved.cash, 1400);
  assert.equal(restored.realEstateOptions[0].id, "option");
  assert.equal(restored.props.length, 0);
});

test("an externally transferred or refused real-estate option is consumed reversibly", () => {
  const transferred = game([
    addPlayer("holder"),
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"holder", optionId:"option", cost:0},
    {type:"RESOLVE_EXTERNAL_REAL_ESTATE_OPTION", playerId:"holder", optionId:"option",
      action:"transfer", salePrice:300, counterpartyName:"Игрок на планшете"}
  ]).players[0];
  const refused = game([
    addPlayer("holder"),
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"holder", optionId:"option", cost:0},
    {type:"RESOLVE_EXTERNAL_REAL_ESTATE_OPTION", playerId:"holder", optionId:"option", action:"refuse"}
  ]).players[0];

  assert.equal(transferred.cash, 1900);
  assert.equal(transferred.realEstateOptions.length, 0);
  assert.equal(refused.realEstateOptions.length, 0);
});

test("an external property card can resolve only the oldest known real-estate option", () => {
  const events = [
    addPlayer("holder"),
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"holder", optionId:"first", cost:0},
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"holder", optionId:"second", cost:0}
  ];
  const skipped = game(events.concat({
    type:"RESOLVE_EXTERNAL_REAL_ESTATE_OPTION", playerId:"holder", optionId:"second", action:"refuse"
  })).players[0];
  const resolved = game(events.concat({
    type:"RESOLVE_EXTERNAL_REAL_ESTATE_OPTION", playerId:"holder", optionId:"first", action:"refuse"
  })).players[0];

  assert.deepEqual(Array.from(skipped.realEstateOptions, option => option.id), ["first", "second"]);
  assert.deepEqual(Array.from(resolved.realEstateOptions, option => option.id), ["second"]);
});

test("real-estate option UI accepts a card from another device instead of showing an alert", () => {
  const harness = loadUI();
  const state = game([
    addPlayer("holder"),
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"holder", optionId:"option", cost:0}
  ]);
  harness.ui.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});
  harness.ui.setState(state);

  harness.ui.actRealEstateOption(state.players[0]);
  const form = harness.captured.forms.at(-1);
  assert.equal(harness.captured.alerts.length, 0);
  assert.match(form.intro, /другом устройстве/);
  assert.equal(form.validate({optionId:"option", action:"buy", sourcePlayerName:"Другой телефон",
    counterpartyName:"", salePrice:0, name:"Дом", kind:"property", price:1000,
    down:200, mortgage:800, cashflow:150, acres:0, removeCashflow:"keep"}), null);
  form.submit({optionId:"option", action:"buy", sourcePlayerName:"Другой телефон",
    counterpartyName:"", salePrice:0, name:"Дом", kind:"property", price:1000,
    down:200, mortgage:800, cashflow:150, acres:0, removeCashflow:"keep"});
  assert.equal(harness.captured.events[0].type, "RESOLVE_EXTERNAL_REAL_ESTATE_OPTION");
  assert.equal(harness.captured.events[0].property.name, "Дом");
});

test("external property-card UI offers only the oldest known option", () => {
  const harness = loadUI();
  const state = game([
    addPlayer("holder"),
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"holder", optionId:"first", cost:0},
    {type:"BUY_REAL_ESTATE_OPTION", playerId:"holder", optionId:"second", cost:0}
  ]);
  harness.ui.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});
  harness.ui.setState(state);

  harness.ui.actRealEstateOption(state.players[0]);
  const optionField = harness.captured.forms.at(-1).fields.find(field => field.k === "optionId");
  assert.deepEqual(Array.from(optionField.options, option => option.v), ["first"]);
});

test("an external sale works with one local player and undo restores the asset", () => {
  const events = [
    addPlayer("seller", {cash:0, stocks:[], properties:[], otherLiabilities:[], otherAssets:[
      {id:"royalty", name:"Роялти", kind:"royalty", cost:1000, income:200}
    ]}),
    {type:"TRANSFER_EXTERNAL_202_ASSET", playerId:"seller", direction:"sell",
      assetType:"royalty", assetId:"royalty", price:500, counterpartyName:"Игрок на телефоне"}
  ];
  const sold = game(events).players[0];
  const restored = game(events.slice(0, -1)).players[0];

  assert.equal(sold.cash, 2300);
  assert.equal(sold.otherAssets.length, 0);
  assert.equal(restored.cash, 1800);
  assert.equal(restored.otherAssets[0].id, "royalty");
});

test("an external purchase records a property without a second local player", () => {
  const p = game([
    addPlayer("buyer"),
    {type:"TRANSFER_EXTERNAL_202_ASSET", playerId:"buyer", direction:"buy",
      assetType:"property", price:400, counterpartyName:"Игрок на планшете", asset:{
        id:"external-home", name:"Дом", kind:"property", price:1000, down:400,
        mortgage:600, cashflow:150
      }}
  ]).players[0];

  assert.equal(p.cash, 1200);
  assert.deepEqual(Array.from(p.props, asset => [asset.id, asset.name, asset.mortgage, asset.cashflow]),
    [["external-home", "Дом", 600, 150]]);
});

test("a new property transfer treats the agreed price as total value and mortgage as assumed debt", () => {
  const engine = loadEngine();
  assert.deepEqual(Array.from(engine.propertyTransferSettlement(60000, 57000)), [60000, 57000, 3000]);

  const seller = game([
    addPlayer("seller"),
    {type:"BUY_PROPERTY", playerId:"seller", ...property({
      assetId:"house", price:65000, down:8000, mortgage:57000, cashflow:300
    })},
    {type:"TRANSFER_EXTERNAL_202_ASSET", playerId:"seller", direction:"sell",
      assetType:"property", assetId:"house", totalPrice:60000, mortgage:57000,
      price:3000, dealRef:"CF-1234", counterpartyName:"Покупатель"}
  ]).players[0];

  assert.equal(seller.cash, -3400);
  assert.equal(seller.props.length, 0);
});

test("a local property buyer records the new agreed value and paid equity", () => {
  const state = game([
    addPlayer("seller"),
    addPlayer("buyer"),
    {type:"TAKE_LOAN", playerId:"seller", amount:8000, purpose:"deal"},
    {type:"BUY_PROPERTY", playerId:"seller", ...property({
      assetId:"house", price:65000, down:8000, mortgage:57000, cashflow:300
    })},
    {type:"TAKE_LOAN", playerId:"buyer", amount:3000, purpose:"deal"},
    {type:"TRANSFER_202_ASSET", playerId:"seller", toPlayerId:"buyer",
      assetType:"property", assetId:"house", totalPrice:60000, price:3000}
  ]);
  const buyer = state.players.find(player => player.id === "buyer");

  assert.deepEqual(Array.from(buyer.props, asset => [asset.price, asset.down, asset.mortgage]),
    [[60000, 3000, 57000]]);
});

test("an external property buyer pays only equity and records the agreed value", () => {
  const buyer = game([
    addPlayer("buyer"),
    {type:"TAKE_LOAN", playerId:"buyer", amount:3000, purpose:"deal"},
    {type:"TRANSFER_EXTERNAL_202_ASSET", playerId:"buyer", direction:"buy",
      assetType:"property", totalPrice:60000, mortgage:57000, price:3000,
      dealRef:"CF-1234", counterpartyName:"Продавец", asset:{
        id:"house", name:"Дом", kind:"property", price:60000, down:3000,
        mortgage:57000, cashflow:300
      }}
  ]).players[0];

  assert.equal(buyer.cash, 1600);
  assert.deepEqual(Array.from(buyer.props, asset => [asset.price, asset.down, asset.mortgage]),
    [[60000, 3000, 57000]]);
});

test("a new property transfer is rejected when total price does not exceed the mortgage", () => {
  const seller = game([
    addPlayer("seller"),
    {type:"BUY_PROPERTY", playerId:"seller", ...property({assetId:"house", mortgage:900})},
    {type:"TRANSFER_EXTERNAL_202_ASSET", playerId:"seller", direction:"sell",
      assetType:"property", assetId:"house", totalPrice:900, mortgage:900, price:0,
      counterpartyName:"Покупатель"}
  ]).players[0];

  assert.equal(seller.props.length, 1);
});

test("setup and replay preserve explicit other-asset kind while missing kind defaults to other", () => {
  const harness = loadUI();
  const event = harness.ui.buildAddPlayerEvent("202-standard", {
    playerId:"p", name:"p", professionId:"nurse", dream:{name:"Мечта", price:100000},
    portfolio:{cash:0, stocks:[], properties:[], otherLiabilities:[], otherAssets:[
      {name:"Авторские права", kind:"royalty", cost:1000, income:100},
      {name:"Прочий актив", kind:"other", cost:500, income:50},
      {name:"Старое сохранение", cost:250, income:25}
    ]}
  });
  const replayed = game([event]).players[0];

  assert.deepEqual(Array.from(event.initialPortfolio.otherAssets, asset => asset.kind),
    ["royalty", "other", "other"]);
  assert.deepEqual(Array.from(replayed.otherAssets, asset => asset.kind),
    ["royalty", "other", "other"]);
});

test("only royalties transfer and survive official 202 bankruptcy", () => {
  const state = game([
    addPlayer("seller", {cash:0, stocks:[], properties:[], otherLiabilities:[], otherAssets:[
      {id:"royalty-move", name:"Передаваемое роялти", kind:"royalty", cost:1000, income:100},
      {id:"royalty-keep", name:"Сохраняемое роялти", kind:"royalty", cost:800, income:80},
      {id:"generic", name:"Прочий актив", kind:"other", cost:600, income:60},
      {id:"legacy", name:"Без вида", cost:400, income:40}
    ]}),
    addPlayer("buyer"),
    {type:"TRANSFER_202_ASSET", playerId:"seller", toPlayerId:"buyer", assetType:"royalty", assetId:"generic", price:0},
    {type:"TRANSFER_202_ASSET", playerId:"seller", toPlayerId:"buyer", assetType:"royalty", assetId:"legacy", price:0},
    {type:"TRANSFER_202_ASSET", playerId:"seller", toPlayerId:"buyer", assetType:"royalty", assetId:"royalty-move", price:0},
    {type:"DECLARE_202_BANKRUPTCY", playerId:"seller", reason:"personal", proceeds:0}
  ]);

  assert.deepEqual(Array.from(state.players[0].otherAssets, asset => [asset.id, asset.kind]),
    [["royalty-keep", "royalty"]]);
  assert.deepEqual(Array.from(state.players[1].otherAssets, asset => [asset.id, asset.kind]),
    [["royalty-move", "royalty"]]);
});

test("setup UI offers an explicit royalty or other kind choice", () => {
  const html = loadUI().ui.portfolioRow("otherAssets", {});

  assert.match(html, /select[^>]+data-portfolio-field="kind"/);
  assert.match(html, /value="other"/);
  assert.match(html, /value="royalty"/);
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

test("Fast Track business stores and patches all financial fields while undo restores its purchase", () => {
  const events = [
    addPlayer("p"),
    {type:"ENTER_FT", playerId:"p"},
    {type:"CASH_IN", playerId:"p", amount:100000},
    {type:"FT_BUY_BIZ", playerId:"p", assetId:"biz", name:"Сеть кофеен", price:100000,
      down:10000, mortgage:90000, cashflow:5000},
    {type:"UPDATE_OWNED_CARD", playerId:"p", cardType:"ftBusiness", cardId:"biz",
      patch:{name:"Сеть пекарен", price:120000, down:20000, mortgage:100000, cashflow:7000, tokens:9}}
  ];
  const edited = game(events).players[0].ft.businesses[0];
  const restored = game(events.slice(0, -1)).players[0].ft.businesses[0];

  assert.deepEqual([edited.name, edited.price, edited.down, edited.mortgage, edited.cashflow],
    ["Сеть пекарен", 120000, 20000, 100000, 7000]);
  assert.equal(Object.hasOwn(edited, "tokens"), false);
  assert.deepEqual([restored.name, restored.price, restored.down, restored.mortgage, restored.cashflow],
    ["Сеть кофеен", 100000, 10000, 90000, 5000]);
});

test("legacy FT_BUY_BIZ events without price and mortgage replay compatibly", () => {
  const business = game([
    addPlayer("p"),
    {type:"ENTER_FT", playerId:"p"},
    {type:"FT_BUY_BIZ", playerId:"p", assetId:"legacy-biz", name:"Старая карточка", down:5000, cashflow:1000}
  ]).players[0].ft.businesses[0];

  assert.deepEqual([business.price, business.down, business.mortgage, business.cashflow], [5000, 5000, 0, 1000]);
});

test("owned Fast Track business edit form includes every required field", () => {
  const harness = loadUI();
  const p = game([
    addPlayer("p"),
    {type:"ENTER_FT", playerId:"p"},
    {type:"FT_BUY_BIZ", playerId:"p", assetId:"biz", name:"Бизнес", price:10000,
      down:1000, mortgage:9000, cashflow:500}
  ]).players[0];

  harness.ui.actEditOwnedCard(p, "ftBusiness", "biz");
  assert.deepEqual(Array.from(harness.captured.forms[0].fields, field => field.k),
    ["name", "price", "down", "mortgage", "cashflow"]);
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
    assert.equal(labels.includes("Развод"), false);
    assert.equal(labels.includes("Увольнение"), false);
    assert.equal(labels.includes("Налоги / Суд"), false);
    assert.equal(labels.includes("Моя мечта"), false);
  }
  assert.equal(labels101.includes("Страховка"), false);
  assert.equal(labels202.includes("Страховка"), true);
  assert.equal(labels202.includes("D2Y"), true);
  assert.equal(labels202.includes("Опцион на недвижимость"), true);

  const fastTrack = game([addPlayer("ft"), {type:"ENTER_FT", playerId:"ft"}]).players[0];
  harness.ui.setState({players:[fastTrack], marketPrices:{}});
  const fastTrackLabels = harness.ui.actionsFor(fastTrack).map(action => action[1]);
  assert.equal(fastTrackLabels.includes("Увольнение"), true);
  assert.equal(fastTrackLabels.includes("Налоги / Суд"), true);
  assert.equal(fastTrackLabels.includes("Моя мечта"), false);
  assert.equal(fastTrackLabels.includes("Купить мечту"), true);
});

test("Divorce is Fast Track-only and the child action clearly supports add and remove", () => {
  const harness = loadUI();
  const ratRace = game([addPlayer("p"), {type:"CHILD", playerId:"p"}], "101").players[0];
  harness.ui.setState({players:[ratRace], marketPrices:{}});
  harness.ui.setGame({mode:"101", settings:{}, events:[]});
  const ratRaceActions = harness.ui.actionsFor(ratRace);

  assert.equal(ratRaceActions.some(action => action[1] === "Развод"), false);
  const childAction = ratRaceActions.find(action => action[1] === "Добавить / убрать ребёнка");
  assert.ok(childAction);
  childAction[2]();
  assert.deepEqual(Array.from(harness.captured.forms.at(-1).fields[0].options, option => option.v),
    ["add", "remove"]);

  const fastTrack = game([addPlayer("ft"), {type:"ENTER_FT", playerId:"ft"}], "101").players[0];
  harness.ui.setState({players:[fastTrack], marketPrices:{}});
  assert.equal(harness.ui.actionsFor(fastTrack).some(action => action[1] === "Развод"), true);
});

test("starting-portfolio property rows preserve land and business card details", () => {
  const harness = loadUI();
  const html = harness.ui.portfolioRow("properties", {
    name:"Участок", kind:"land", price:10000, down:1000, mortgage:9000,
    cashflow:-100, acres:20, removeCashflowOnSplit:true
  }, 0);
  const event = harness.ui.buildAddPlayerEvent("202-standard", {
    playerId:"p", name:"p", professionId:"nurse", dream:{name:"Мечта", price:100000},
    portfolio:{cash:0, stocks:[], otherAssets:[], otherLiabilities:[], properties:[{
      name:"Участок", kind:"land", price:10000, down:1000, mortgage:9000,
      cashflow:-100, acres:20, removeCashflowOnSplit:true
    }]}
  });
  const replayed = game([event]).players[0].props[0];

  assert.match(html, /Тип объекта[^]*Земля[^]*Площадь/);
  assert.equal(event.initialPortfolio.properties[0].kind, "land");
  assert.equal(event.initialPortfolio.properties[0].acres, 20);
  assert.equal(event.initialPortfolio.properties[0].removeCashflowOnSplit, true);
  assert.deepEqual([replayed.kind, replayed.acres, replayed.cashflow], ["land", 20, -100]);
});

test("starting-portfolio land-only fields are hidden for ordinary property cards", () => {
  const html = loadUI().ui.portfolioRow("properties", {
    name:"Дом", kind:"property", price:65000, down:8000, mortgage:57000, cashflow:300
  }, 0);

  assert.match(html, /data-portfolio-land-only hidden/);
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
  assert.match(counters, /data-counter-minus="warning"[^]*aria-label="Уменьшить счётчик Один ход на один ход"/);
  assert.match(counters, /data-counter-plus="warning"[^]*aria-label="Увеличить счётчик Один ход на один ход"/);
});

test("owned-card editor rejects negative financial values but allows negative cashflow", () => {
  const harness = loadUI();
  const p = game([
    addPlayer("p"),
    {type:"BUY_PROPERTY", playerId:"p", ...property()}
  ]).players[0];
  harness.ui.actEditOwnedCard(p, "property", "home");

  assert.match(harness.submit({name:"Дом", price:1000, down:100, mortgage:-1, cashflow:100}), /Ипотека/);
  assert.equal(harness.submit({name:"Дом", price:1000, down:100, mortgage:900, cashflow:-250}), null);
});

test("owned-card editor rejects a negative other-asset income", () => {
  const harness = loadUI();
  const p = game([addPlayer("p", {cash:0, stocks:[], properties:[],
    otherAssets:[{id:"royalty", name:"Роялти", kind:"royalty", cost:100, income:50}],
    otherLiabilities:[]})]).players[0];
  harness.ui.actEditOwnedCard(p, "otherAsset", "royalty");

  assert.match(harness.submit({name:"Роялти", kind:"royalty", cost:100, income:-50}), /Доход/);
  assert.equal(harness.captured.events.length, 0);
});

test("Downsized UI records the adjustable skip counter identifier", () => {
  const harness = loadUI();
  harness.ui.actDownsized(game([addPlayer("p")]).players[0]);

  const error = harness.submit({});

  assert.equal(error, null);
  assert.equal(harness.captured.events[0].type, "DOWNSIZED");
  assert.equal(harness.captured.events[0].counterId, "skip-turns");
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

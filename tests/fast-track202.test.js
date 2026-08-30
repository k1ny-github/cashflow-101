const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { assert } = require("./helpers");
const { canEscape202, hasWon202, fastTrackBusinessPrice } = require("../fast-track202.js");

const ROOT = path.join(__dirname, "..");

function runFile(context, name){
  vm.runInContext(fs.readFileSync(path.join(ROOT, name), "utf8"), context);
}

function loadEngine(){
  const context = {};
  vm.createContext(context);
  runFile(context, "game-config.js");
  runFile(context, "professions.js");
  runFile(context, "fast-track202.js");
  runFile(context, "engine.js");
  vm.runInContext(
    "globalThis.fastTrackEngine = {reduceEvents, derive, deriveFT, warnings, createGameConfig};",
    context
  );
  return context.fastTrackEngine;
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
    "globalThis.fastTrackUI = {" +
      "setGame(game){G=game;},setState(state){S=state;}," +
      "actionsFor(player){const ft=!!player.ft;return tableActions(player,ft,ft?deriveFT(player):derive(player));}," +
      "actFTBiz,actFTDream,actFTCharity,actEditOwnedCard," +
      "actFTTransferBusiness:typeof actFTTransferBusiness === 'function' ? actFTTransferBusiness : null," +
      "actFTFranchise:typeof actFTFranchise === 'function' ? actFTFranchise : null," +
      "reportFT,renderCardCounters,render202Tools" +
    "};",
    context
  );
  context.openForm = form => captured.forms.push(form);
  context.push = event => captured.events.push(event);
  return {
    captured,
    ui:context.fastTrackUI,
    submit(values){
      const form = captured.forms[captured.forms.length - 1];
      const error = form.validate ? form.validate(values) : null;
      if(!error) form.submit(values);
      return error;
    }
  };
}

function config(mode = "202-standard"){
  return loadEngine().createGameConfig(mode, mode === "202-custom" ? {optionRounds:5} : {});
}

function game(events, mode = "202-standard"){
  const engine = loadEngine();
  return engine.reduceEvents(events, engine.createGameConfig(mode,
    mode === "202-custom" ? {optionRounds:5} : {}));
}

function addPlayer(playerId, dreamName = playerId + " dream"){
  return {
    type:"ADD_PLAYER", playerId, name:playerId, professionId:"nurse",
    dream:{fieldId:"selected-" + playerId, name:dreamName, price:100000},
    initialPortfolio:{cash:0, stocks:[], properties:[], otherAssets:[], otherLiabilities:[]}
  };
}

function enterWithCash(playerId, amount = 1000000){
  return [
    {type:"ENTER_FT", playerId},
    {type:"CASH_IN", playerId, amount}
  ];
}

test("202 requires passive income at least twice expenses", () => {
  assert.equal(canEscape202({passive:1999, totalExpenses:1000}), false);
  assert.equal(canEscape202({passive:2000, totalExpenses:1000}), true);
});

function fastTrackPlayer({businessIncome = 0, ownDream = false, otherDreams = []} = {}){
  return {
    dream:{bought:ownDream},
    otherDreams,
    ft:{businesses:[{cashflow:businessIncome}]}
  };
}

test("202 income growth or Dreams alone do not win", () => {
  assert.equal(hasWon202(fastTrackPlayer({businessIncome:50000})), false);
  assert.equal(hasWon202(fastTrackPlayer({ownDream:true})), false);
  assert.equal(hasWon202(fastTrackPlayer({
    otherDreams:[{fieldId:"dream-a"}, {fieldId:"dream-b"}]
  })), false);
});

test("202 wins with 50000 business-income growth and the selected Dream", () => {
  assert.equal(hasWon202(fastTrackPlayer({businessIncome:49999, ownDream:true})), false);
  assert.equal(hasWon202(fastTrackPlayer({businessIncome:50000, ownDream:true})), true);
});

test("202 wins with 50000 business-income growth and two distinct unselected Dreams", () => {
  const duplicate = [{fieldId:"dream-a"}, {fieldId:"dream-a"}];
  const distinct = [{fieldId:"dream-a"}, {fieldId:"dream-b"}, {fieldId:"dream-c"}];

  assert.equal(hasWon202(fastTrackPlayer({businessIncome:50000, otherDreams:duplicate})), false);
  assert.equal(hasWon202(fastTrackPlayer({businessIncome:50000, otherDreams:distinct})), true);
});

test("Fast Track business price multiplies base price by ownership tokens", () => {
  assert.equal(fastTrackBusinessPrice({basePrice:100000, ownershipTokens:1}), 100000);
  assert.equal(fastTrackBusinessPrice({basePrice:100000, ownershipTokens:3}), 300000);
});

test("202 buys a Fast Track business at full price and stores official ownership state", () => {
  const before = game([addPlayer("p"), ...enterWithCash("p")]).players[0];
  const after = game([
    addPlayer("p"), ...enterWithCash("p"),
    {type:"FT_BUY_BIZ", playerId:"p", assetId:"biz", name:"Сеть", price:100000,
      down:10000, mortgage:90000, cashflow:20000}
  ]).players[0];

  assert.equal(after.cash, before.cash - 100000);
  assert.deepEqual(
    [after.ft.businesses[0].basePrice, after.ft.businesses[0].ownershipTokens,
      after.ft.businesses[0].franchises.length],
    [100000, 1, 0]
  );
});

test("101 keeps legacy Fast Track business down-payment purchase results", () => {
  const before = game([addPlayer("p"), ...enterWithCash("p")], "101").players[0];
  const after = game([
    addPlayer("p"), ...enterWithCash("p"),
    {type:"FT_BUY_BIZ", playerId:"p", assetId:"biz", name:"Сеть", price:100000,
      down:10000, mortgage:90000, cashflow:20000}
  ], "101").players[0];

  assert.equal(after.cash, before.cash - 10000);
  assert.equal(Object.hasOwn(after.ft.businesses[0], "ownershipTokens"), false);
});

test("a recorded landing transfers another player's business at the post-transfer token price", () => {
  const purchase = [
    addPlayer("owner"), addPlayer("buyer"),
    ...enterWithCash("owner"), ...enterWithCash("buyer"),
    {type:"FT_BUY_BIZ", playerId:"owner", assetId:"biz", name:"Сеть", price:100000,
      down:10000, mortgage:90000, cashflow:20000}
  ];
  const before = game(purchase);
  const after = game(purchase.concat({
    type:"FT_TRANSFER_BUSINESS", playerId:"buyer", fromPlayerId:"owner",
    businessId:"biz", landingId:"landing-1"
  }));

  assert.equal(after.players[0].ft.businesses.length, 0);
  assert.equal(after.players[1].ft.businesses[0].ownershipTokens, 2);
  assert.equal(after.players[0].cash, before.players[0].cash + 200000);
  assert.equal(after.players[1].cash, before.players[1].cash - 200000);
  assert.equal(game(purchase).players[0].ft.businesses.length, 1);
});

test("an owner adds at most one franchise for the same recorded landing", () => {
  const purchase = [
    addPlayer("p"), ...enterWithCash("p"),
    {type:"FT_BUY_BIZ", playerId:"p", assetId:"biz", name:"Сеть", price:100000,
      down:10000, mortgage:90000, cashflow:20000}
  ];
  const once = game(purchase.concat({
    type:"FT_ADD_FRANCHISE", playerId:"p", businessId:"biz", landingId:"landing-2"
  })).players[0];
  const twice = game(purchase.concat([
    {type:"FT_ADD_FRANCHISE", playerId:"p", businessId:"biz", landingId:"landing-2"},
    {type:"FT_ADD_FRANCHISE", playerId:"p", businessId:"biz", landingId:"landing-2"}
  ])).players[0];

  assert.deepEqual(
    [once.ft.businesses[0].ownershipTokens, once.ft.businesses[0].franchises.length,
      once.ft.businesses[0].cashflow],
    [2, 1, 40000]
  );
  assert.equal(twice.cash, once.cash);
  assert.equal(twice.ft.businesses[0].franchises.length, 1);
});

test("editing a 202 Fast Track business updates its bases, aggregate income and victory, and is undoable", () => {
  const beforeEdit = [
    addPlayer("owner"), ...enterWithCash("owner"),
    {type:"FT_BUY_BIZ", playerId:"owner", assetId:"biz", name:"Сеть", price:100000,
      down:10000, mortgage:90000, cashflow:10000},
    {type:"FT_ADD_FRANCHISE", playerId:"owner", businessId:"biz", landingId:"landing-1"},
    {type:"FT_DREAM", playerId:"owner"}
  ];
  const edit = {type:"UPDATE_OWNED_CARD", playerId:"owner", cardType:"ftBusiness", cardId:"biz",
    patch:{price:120000, cashflow:25000}};
  const editedPlayer = game(beforeEdit.concat(edit)).players[0];
  const restoredBusiness = game(beforeEdit).players[0].ft.businesses[0];
  const editedBusiness = editedPlayer.ft.businesses[0];

  assert.deepEqual(
    [editedBusiness.price, editedBusiness.basePrice, editedBusiness.baseCashflow, editedBusiness.cashflow],
    [120000, 120000, 25000, 50000]
  );
  assert.equal(loadEngine().deriveFT(editedPlayer).biz, 50000);
  assert.equal(loadEngine().deriveFT(editedPlayer).won, true);
  assert.deepEqual(
    [restoredBusiness.price, restoredBusiness.basePrice, restoredBusiness.baseCashflow, restoredBusiness.cashflow],
    [100000, 100000, 10000, 20000]
  );
});

test("edited 202 business bases drive later transfer price and franchise income", () => {
  const editedEvents = [
    addPlayer("owner"), addPlayer("buyer"),
    ...enterWithCash("owner"), ...enterWithCash("buyer"),
    {type:"FT_BUY_BIZ", playerId:"owner", assetId:"biz", name:"Сеть", price:100000,
      down:10000, mortgage:90000, cashflow:10000},
    {type:"FT_ADD_FRANCHISE", playerId:"owner", businessId:"biz", landingId:"landing-1"},
    {type:"UPDATE_OWNED_CARD", playerId:"owner", cardType:"ftBusiness", cardId:"biz",
      patch:{price:120000, cashflow:25000}}
  ];
  const beforeTransfer = game(editedEvents);
  const transferEvents = editedEvents.concat({
    type:"FT_TRANSFER_BUSINESS", playerId:"buyer", fromPlayerId:"owner",
    businessId:"biz", landingId:"landing-transfer"
  });
  const transferred = game(transferEvents);
  const franchised = game(transferEvents.concat({
    type:"FT_ADD_FRANCHISE", playerId:"buyer", businessId:"biz", landingId:"landing-2"
  }));

  assert.equal(transferred.players[0].cash, beforeTransfer.players[0].cash + 360000);
  assert.equal(transferred.players[1].cash, beforeTransfer.players[1].cash - 360000);
  assert.deepEqual(
    [transferred.players[1].ft.businesses[0].basePrice,
      transferred.players[1].ft.businesses[0].baseCashflow,
      transferred.players[1].ft.businesses[0].cashflow],
    [120000, 25000, 50000]
  );
  assert.equal(franchised.players[1].ft.businesses[0].cashflow, 75000);
  assert.equal(franchised.players[1].cash, transferred.players[1].cash - 120000);
});

test("101 Fast Track business edits retain direct legacy field semantics", () => {
  const business = game([
    addPlayer("p"), ...enterWithCash("p"),
    {type:"FT_BUY_BIZ", playerId:"p", assetId:"biz", name:"Сеть", price:100000,
      down:10000, mortgage:90000, cashflow:10000},
    {type:"UPDATE_OWNED_CARD", playerId:"p", cardType:"ftBusiness", cardId:"biz",
      patch:{price:120000, cashflow:25000}}
  ], "101").players[0].ft.businesses[0];

  assert.deepEqual([business.price, business.cashflow], [120000, 25000]);
  assert.equal(Object.hasOwn(business, "basePrice"), false);
  assert.equal(Object.hasOwn(business, "baseCashflow"), false);
});

test("unselected Dreams sell once table-wide while a player may buy more than two", () => {
  const start = [
    addPlayer("p1"), addPlayer("p2"), ...enterWithCash("p1"), ...enterWithCash("p2")
  ];
  const events = start.concat([
    {type:"FT_BUY_OTHER_DREAM", playerId:"p1", fieldId:"free-a", name:"Мечта A", price:10000},
    {type:"FT_BUY_OTHER_DREAM", playerId:"p2", fieldId:"free-a", name:"Мечта A", price:10000},
    {type:"FT_BUY_OTHER_DREAM", playerId:"p1", fieldId:"free-b", name:"Мечта B", price:20000},
    {type:"FT_BUY_OTHER_DREAM", playerId:"p1", fieldId:"free-c", name:"Мечта C", price:30000}
  ]);
  const state = game(events);

  assert.deepEqual(Array.from(state.players[0].otherDreams, dream => dream.fieldId),
    ["free-a", "free-b", "free-c"]);
  assert.equal(state.players[1].otherDreams.length, 0);
  assert.equal(game(events.slice(0, -1)).players[0].otherDreams.length, 2);
});

test("a selected Dream can receive tokens but cannot be bought as an unselected Dream", () => {
  const state = game([
    addPlayer("owner", "Остров"), addPlayer("buyer"),
    ...enterWithCash("owner"), ...enterWithCash("buyer"),
    {type:"DREAM_TOKEN", playerId:"owner", byPlayerId:"buyer"},
    {type:"FT_BUY_OTHER_DREAM", playerId:"buyer", fieldId:"selected-owner",
      name:"Остров", price:100000}
  ]);

  assert.equal(state.players[0].dream.tokens, 1);
  assert.equal(state.players[1].otherDreams.length, 0);
});

test("a selected Dream cannot be bought under a different field ID with the same name", () => {
  const state = game([
    addPlayer("owner", "Остров"), addPlayer("buyer"),
    ...enterWithCash("owner"), ...enterWithCash("buyer"),
    {type:"FT_BUY_OTHER_DREAM", playerId:"buyer", fieldId:"different-id",
      name:"Остров", price:100000}
  ]);

  assert.equal(state.players[1].otherDreams.length, 0);
});

test("legacy FT_OTHER_DREAM journals still replay without changing their event", () => {
  const events = [
    addPlayer("owner", "Остров"), addPlayer("buyer"),
    ...enterWithCash("owner"), ...enterWithCash("buyer"),
    {type:"FT_OTHER_DREAM", playerId:"buyer", ownerId:"owner"}
  ];
  const state = game(events, "101");

  assert.equal(state.players[1].otherDreams.length, 1);
  assert.equal(state.players[1].otherDreams[0].ownerId, "owner");
  assert.deepEqual(events[events.length - 1],
    {type:"FT_OTHER_DREAM", playerId:"buyer", ownerId:"owner"});
});

test("202 does not count two legacy selected-Dream purchases toward victory", () => {
  const events = [
    addPlayer("owner-a", "Остров"), addPlayer("owner-b", "Самолёт"), addPlayer("buyer"),
    ...enterWithCash("owner-a"), ...enterWithCash("owner-b"), ...enterWithCash("buyer"),
    {type:"FT_BUY_BIZ", playerId:"buyer", assetId:"biz", name:"Сеть", price:100000,
      down:10000, mortgage:90000, cashflow:50000},
    {type:"FT_OTHER_DREAM", playerId:"buyer", ownerId:"owner-a"},
    {type:"FT_OTHER_DREAM", playerId:"buyer", ownerId:"owner-b"}
  ];
  const player = game(events).players[2];
  const result = loadEngine().deriveFT(player);

  assert.equal(player.otherDreams.length, 2);
  assert.equal(result.otherDreamsBought, 0);
  assert.equal(result.won, false);
});

test("101 keeps the legacy two-selected-Dream Fast Track result", () => {
  const events = [
    addPlayer("owner-a", "Остров"), addPlayer("owner-b", "Самолёт"), addPlayer("buyer"),
    ...enterWithCash("owner-a"), ...enterWithCash("owner-b"), ...enterWithCash("buyer"),
    {type:"FT_OTHER_DREAM", playerId:"buyer", ownerId:"owner-a"},
    {type:"FT_OTHER_DREAM", playerId:"buyer", ownerId:"owner-b"}
  ];
  const result = loadEngine().deriveFT(game(events, "101").players[2]);

  assert.equal(result.otherDreamsBought, 2);
  assert.equal(result.won, true);
});

test("deriveFT applies the strict 202 victory AND while 101 keeps its current OR result", () => {
  const purchase = {type:"FT_BUY_BIZ", playerId:"p", assetId:"biz", name:"Сеть",
    price:100000, down:10000, mortgage:90000, cashflow:50000};
  const common = [addPlayer("p"), ...enterWithCash("p"), purchase];
  const incomeOnly202 = game(common).players[0];
  const completed202 = game(common.concat({type:"FT_DREAM", playerId:"p"})).players[0];
  const incomeOnly101 = game(common, "101").players[0];

  assert.equal(loadEngine().deriveFT(incomeOnly202).won, false);
  assert.equal(loadEngine().deriveFT(completed202).won, true);
  assert.equal(loadEngine().deriveFT(incomeOnly101).won, true);
});

test("202 victory growth and remaining target use business income before unrelated expenses", () => {
  const p = game([
    addPlayer("p"), ...enterWithCash("p"),
    {type:"FT_BUY_BIZ", playerId:"p", assetId:"biz", name:"Сеть", price:100000,
      down:10000, mortgage:90000, cashflow:50000},
    {type:"FT_DREAM", playerId:"p"},
    {type:"ADD_OTHER_EXPENSE", playerId:"p", expenseId:"expense", name:"Расход",
      cadence:"monthly", amount:10000}
  ]).players[0];
  const result = loadEngine().deriveFT(p);

  assert.equal(result.won, true);
  assert.equal(result.left, 0);
});

test("202 Fast Track charity always costs 100000 and records a 1 to 3 dice choice", () => {
  const before = game([addPlayer("p"), ...enterWithCash("p")]).players[0];
  const after = game([
    addPlayer("p"), ...enterWithCash("p"),
    {type:"FT_CHARITY", playerId:"p", amount:1, dice:3}
  ]).players[0];

  assert.equal(after.cash, before.cash - 100000);
  assert.equal(after.ft.charity, true);
  assert.equal(after.ft.dice, 3);
});

test("202 Fast Track charity dice can change later without another charge and journal deletion undoes it", () => {
  const activationEvents = [
    addPlayer("p"), ...enterWithCash("p"),
    {type:"FT_CHARITY", playerId:"p", amount:1, dice:1}
  ];
  const activated = game(activationEvents).players[0];
  const changed = game(activationEvents.concat(
    {type:"FT_CHOOSE_DICE", playerId:"p", dice:3}
  )).players[0];
  const duplicateActivation = game(activationEvents.concat(
    {type:"FT_CHARITY", playerId:"p", amount:100000, dice:2}
  )).players[0];

  assert.equal(changed.cash, activated.cash);
  assert.equal(changed.ft.dice, 3);
  assert.equal(game(activationEvents).players[0].ft.dice, 1);
  assert.equal(duplicateActivation.cash, activated.cash);
  assert.equal(duplicateActivation.ft.dice, 1);
});

test("202 exit action requires twice expenses while 101 retains passive greater than expenses", () => {
  const p = game([addPlayer("p")]).players[0];
  p.otherAssets.push({id:"income", name:"Income", cost:0, income:3000});
  const state = {players:[p], marketPrices:{}};
  const ui = loadUI();
  ui.ui.setState(state);

  ui.ui.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});
  const labels202 = ui.ui.actionsFor(p).map(action => action[1]);
  ui.ui.setGame({mode:"101", settings:{optionRounds:3, strictLots:false}, events:[]});
  const labels101 = ui.ui.actionsFor(p).map(action => action[1]);

  assert.equal(labels202.includes("Выйти на дорожку"), false);
  assert.equal(labels101.includes("Выйти на дорожку"), true);
});

test("202 business purchase form requires full-price cash", () => {
  const p = game([addPlayer("p"), ...enterWithCash("p", 50)]).players[0];
  const ui = loadUI();
  ui.ui.setState({players:[p], marketPrices:{}});
  ui.ui.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});
  ui.ui.actFTBiz(p);

  const error202 = ui.submit({name:"Сеть", price:100, down:10, mortgage:90, cashflow:20});

  assert.match(error202, /не хватает/i);
  assert.equal(ui.captured.events.length, 0);
});

test("202 Dream form starts with own or other choice and emits the new unselected-Dream event", () => {
  const p = game([addPlayer("p"), ...enterWithCash("p")]).players[0];
  const ui = loadUI();
  ui.ui.setState({players:[p], marketPrices:{}});
  ui.ui.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});
  ui.ui.actFTDream(p);

  const firstField = ui.captured.forms[0].fields[0];
  assert.equal(firstField.k, "kind");
  assert.deepEqual(Array.from(firstField.options, option => option.v), ["own", "other"]);
  assert.equal(ui.submit({kind:"other", fieldId:"free-a", name:"Мечта A", price:10000}), null);
  assert.equal(ui.captured.events[0].type, "FT_BUY_OTHER_DREAM");
  assert.equal(ui.captured.events[0].fieldId, "free-a");
});

test("202 UI emits mandatory business transfer and one franchise event per form landing", () => {
  const state = game([
    addPlayer("owner"), addPlayer("buyer"),
    ...enterWithCash("owner"), ...enterWithCash("buyer"),
    {type:"FT_BUY_BIZ", playerId:"owner", assetId:"biz", name:"Сеть", price:100000,
      down:10000, mortgage:90000, cashflow:20000}
  ]);
  const ui = loadUI();
  ui.ui.setState(state);
  ui.ui.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});

  ui.ui.actFTTransferBusiness(state.players[1]);
  const transferChoice = ui.captured.forms[0].fields[0].options[0].v;
  assert.equal(ui.submit({business:transferChoice}), null);
  assert.equal(ui.captured.events[0].type, "FT_TRANSFER_BUSINESS");

  ui.ui.actFTFranchise(state.players[0]);
  const franchiseChoice = ui.captured.forms[1].fields[0].options[0].v;
  assert.equal(ui.submit({business:franchiseChoice}), null);
  assert.equal(ui.captured.events[1].type, "FT_ADD_FRANCHISE");
  assert.ok(ui.captured.events[1].landingId);
});

test("202 business edit form shows base values instead of franchise aggregate income", () => {
  const p = game([
    addPlayer("p"), ...enterWithCash("p"),
    {type:"FT_BUY_BIZ", playerId:"p", assetId:"biz", name:"Сеть", price:100000,
      down:10000, mortgage:90000, cashflow:10000},
    {type:"FT_ADD_FRANCHISE", playerId:"p", businessId:"biz", landingId:"landing-edit-form"}
  ]).players[0];
  const ui = loadUI();
  ui.ui.setState({players:[p], marketPrices:{}});
  ui.ui.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});
  ui.ui.actEditOwnedCard(p, "ftBusiness", "biz");
  const values = Object.fromEntries(Array.from(ui.captured.forms[0].fields, field => [field.k, field.value]));

  assert.equal(values.price, 100000);
  assert.equal(values.cashflow, 10000);
});

test("202 Fast Track hides Rat Race counters and market tools", () => {
  const p = game([
    addPlayer("p"), ...enterWithCash("p"),
    {type:"ADD_CARD_COUNTER", playerId:"p", counterId:"counter", name:"Test", remaining:2}
  ]).players[0];
  const ui = loadUI();
  ui.ui.setState({players:[p], marketPrices:{}});
  ui.ui.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});
  const labels = ui.ui.actionsFor(p).map(action => action[1]);

  assert.equal(labels.includes("Счётчики карточек"), false);
  assert.equal(labels.includes("Рынок 202"), false);
  assert.equal(ui.ui.renderCardCounters(p), "");
  assert.equal(ui.ui.render202Tools(p), "");
});

test("202 warnings use the twice-expenses exit threshold while 101 keeps its warning", () => {
  const engine = loadEngine();
  const p = game([addPlayer("p")]).players[0];
  p.otherAssets.push({id:"income", name:"Income", cost:0, income:3000});
  const warning202 = engine.warnings(p).map(item => item.text).join(" ");
  p.gameMode = "101";
  const warning101 = engine.warnings(p).map(item => item.text).join(" ");

  assert.doesNotMatch(warning202, /можно выходить/);
  assert.match(warning101, /можно выходить/);
});

test("Fast Track report shows ownership tokens, franchises and purchased unselected Dreams", () => {
  const p = game([
    addPlayer("p"), ...enterWithCash("p"),
    {type:"FT_BUY_BIZ", playerId:"p", assetId:"biz", name:"Сеть", price:100000,
      down:10000, mortgage:90000, cashflow:20000},
    {type:"FT_ADD_FRANCHISE", playerId:"p", businessId:"biz", landingId:"landing-report"},
    {type:"FT_BUY_OTHER_DREAM", playerId:"p", fieldId:"free-a", name:"Мечта A", price:10000}
  ]).players[0];
  const ui = loadUI();
  ui.ui.setState({players:[p], marketPrices:{}});
  ui.ui.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});
  const html = ui.ui.reportFT(p);

  assert.match(html, /Жетонов владения/);
  assert.match(html, /Франшиз/);
  assert.match(html, /Мечта A/);
});

test("202 charity UI fixes the cost and offers one, two or three dice", () => {
  const p = game([addPlayer("p"), ...enterWithCash("p")]).players[0];
  const ui = loadUI();
  ui.ui.setState({players:[p], marketPrices:{}});
  ui.ui.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});
  ui.ui.actFTCharity(p);

  assert.deepEqual(Array.from(ui.captured.forms[0].fields[0].options, option => option.v), [1, 2, 3]);
  assert.equal(ui.submit({dice:2}), null);
  assert.equal(ui.captured.events[0].amount, 100000);
  assert.equal(ui.captured.events[0].dice, 2);
});

test("202 charity UI shows the current choice and emits a free later dice-choice event", () => {
  const p = game([
    addPlayer("p"), ...enterWithCash("p"),
    {type:"FT_CHARITY", playerId:"p", amount:100000, dice:1}
  ]).players[0];
  const ui = loadUI();
  ui.ui.setState({players:[p], marketPrices:{}});
  ui.ui.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});

  assert.match(ui.ui.reportFT(p), /Костей на текущем ходу[^]*1/);
  ui.ui.actFTCharity(p);

  assert.equal(ui.captured.forms.length, 1);
  assert.equal(ui.submit({dice:3}), null);
  assert.equal(ui.captured.events[0].type, "FT_CHOOSE_DICE");
  assert.equal(ui.captured.events[0].dice, 3);
  assert.equal(Object.hasOwn(ui.captured.events[0], "amount"), false);
});

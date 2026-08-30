const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { assert } = require("./helpers");

const ROOT = path.join(__dirname, "..");
const SCRIPT_ORDER = [
  "professions.js",
  "game-config.js",
  "market202.js",
  "assets202.js",
  "fast-track202.js",
  "engine.js",
  "save.js"
];

function runFile(context, name){
  vm.runInContext(fs.readFileSync(path.join(ROOT, name), "utf8"), context, {filename:name});
}

function loadCore(){
  const context = {};
  vm.createContext(context);
  SCRIPT_ORDER.forEach(name => runFile(context, name));
  vm.runInContext(
    "globalThis.integrationCore = {" +
      "reduceEvents,derive,deriveFT,warnings,createGameConfig," +
      "normalizeGameSave,serializeGameSave" +
    "};",
    context
  );
  return context.integrationCore;
}

class FakeElement {
  constructor(id){
    this.id = id;
    this.value = "";
    this.innerHTML = "";
    this.textContent = "";
    this.disabled = false;
    this.onclick = null;
    this.options = [];
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = {
      toggle:(name, force) => force ? this.classes.add(name) : this.classes.delete(name),
      contains:name => this.classes.has(name)
    };
  }
  addEventListener(type, listener){
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  dispatch(type){
    for(const listener of this.listeners.get(type) || []) listener({target:this});
  }
  querySelector(){ return null; }
  querySelectorAll(){ return []; }
  close(){}
  showModal(){}
}

function fakeDocument(){
  const elements = new Map();
  const documentListeners = new Map();
  const get = selector => {
    const id = String(selector).replace(/^#/, "");
    if(!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };
  const document = {
    querySelector:get,
    querySelectorAll(){ return []; },
    addEventListener(type, listener){ documentListeners.set(type, listener); },
    createElement(){ return new FakeElement("created"); }
  };
  get("np-mode").value = "101";
  get("np-rounds").value = "3";
  get("np-portfolio-cash").value = "0";
  get("np-dream-price").value = "";
  return {document, get, ready(){ documentListeners.get("DOMContentLoaded")?.(); }};
}

function loadUI({initialize = false} = {}){
  const dom = fakeDocument();
  const stored = new Map();
  const captured = {forms:[], events:[], alerts:[]};
  const context = {
    document:dom.document,
    localStorage:{
      getItem:key => stored.has(key) ? stored.get(key) : null,
      setItem:(key, value) => stored.set(key, value)
    },
    location:{pathname:"/index.html", href:""},
    alert:message => captured.alerts.push(message),
    confirm:() => true,
    Blob:function(){},
    URL:{createObjectURL:() => "blob:test"},
    FileReader:function(){}
  };
  vm.createContext(context);
  SCRIPT_ORDER.forEach(name => runFile(context, name));
  runFile(context, "ui.js");
  vm.runInContext(
    "globalThis.integrationUI = {" +
      "setGame(game){G=game;},getGame(){return G;}," +
      "setState(state){S=state;},getState(){return S;}," +
      "prepareImportedGame,reportRatRace,reportFT,renderCardCounters,render202Tools," +
      "renderTable,renderLog,tableActions,deltaPreview," +
      "actD2Y,actProperty202,actTransfer202,actEditOwnedCard" +
    "};",
    context
  );
  context.openForm = form => captured.forms.push(form);
  context.push = event => captured.events.push(event);
  if(initialize) dom.ready();
  return {context, dom, captured, ui:context.integrationUI, stored};
}

function config(core, mode, optionRounds = 3){
  return core.createGameConfig(mode, {optionRounds});
}

function reduce(core, events, mode = "202-standard", optionRounds = 3){
  return core.reduceEvents(events, config(core, mode, optionRounds));
}

function addPlayer(playerId = "p", extra = {}){
  return {type:"ADD_PLAYER", id:"add-" + playerId, playerId, name:playerId,
    professionId:"nurse", ...extra};
}

function optionEvents(playerId, optionId, rounds){
  return [
    {type:"BUY_OPTION", id:"buy-" + optionId, playerId, optionId,
      optionType:"call", symbol:"OK4U", qty:100, strike:10,
      premiumPerShare:1, premiumTotal:100, remaining:rounds},
    ...Array.from({length:rounds}, (_, index) => ({
      type:"ADJUST_OPTION_ROUNDS", id:"round-" + optionId + "-" + index,
      playerId, optionId, delta:-1
    }))
  ];
}

function setIntegratedGame(harness, core, events, mode = "202-standard", optionRounds = 3){
  const game = {...config(core, mode, optionRounds), events, current:"p", screen:"table"};
  const state = reduce(core, events, mode, optionRounds);
  harness.ui.setGame(game);
  harness.ui.setState(state);
  return {game, state, player:state.players.find(item => item.id === "p")};
}

test("101 event log keeps its established report totals", () => {
  const core = loadCore();
  const events = [
    addPlayer(),
    {type:"BUY_PROPERTY", playerId:"p", assetId:"home", name:"Дом", kind:"property",
      price:10000, down:1000, cashflow:300},
    {type:"BUY_STOCK", playerId:"p", assetId:"stock", symbol:"OK4U", qty:10, price:10, div:1},
    {type:"TAKE_LOAN", playerId:"p", amount:1000},
    {type:"PAYDAY", playerId:"p"}
  ];
  const player = reduce(core, events, "101").players[0];
  const report = loadUI().ui;
  report.setGame({...config(core, "101"), events, current:"p", screen:"table"});
  report.setState({players:[player], marketPrices:{}});

  assert.deepEqual(
    {cash:player.cash, cashflow:core.derive(player).cashflow,
      passive:core.derive(player).passive, expenses:core.derive(player).totalExpenses},
    {cash:2830, cashflow:1330, passive:310, expenses:2080}
  );
  assert.match(report.reportRatRace(player), /Общий доход[^]*\$3.?410/);
  assert.match(report.reportRatRace(player), /Общий расход[^]*\$2.?080/);
});

test("Standard expires options after three rounds and Custom uses its configured limit", () => {
  const core = loadCore();
  const standardBeforeLast = reduce(core, [addPlayer(), ...optionEvents("p", "std", 3).slice(0, -1)]);
  const standardExpired = reduce(core, [addPlayer(), ...optionEvents("p", "std", 3)]);
  const customBeforeLast = reduce(core,
    [addPlayer(), ...optionEvents("p", "custom", 5).slice(0, -1)], "202-custom", 5);
  const customExpired = reduce(core,
    [addPlayer(), ...optionEvents("p", "custom", 5)], "202-custom", 5);

  assert.equal(standardBeforeLast.players[0].options[0].remaining, 1);
  assert.deepEqual(
    [standardExpired.players[0].options[0].remaining, standardExpired.players[0].options[0].active],
    [0, false]
  );
  assert.equal(customBeforeLast.players[0].options[0].remaining, 1);
  assert.deepEqual(
    [customExpired.players[0].options[0].remaining, customExpired.players[0].options[0].active],
    [0, false]
  );
});

test("export and import round-trip schema metadata, mode, settings, events, current and setup portfolio", () => {
  const core = loadCore();
  const raw = {
    mode:"202-custom", settings:{optionRounds:7, strictLots:false},
    events:[addPlayer("p")], current:"p",
    setupPortfolio:{cash:"500", stocks:[{symbol:"OK4U", qty:"100"}],
      properties:[], otherAssets:[], otherLiabilities:[]}
  };
  const serialized = core.serializeGameSave(raw);
  const imported = loadUI().ui.prepareImportedGame(JSON.parse(serialized));

  assert.equal(imported.schemaVersion, 2);
  assert.equal(imported.mode, "202-custom");
  assert.deepEqual(JSON.parse(JSON.stringify(imported.settings)), {optionRounds:7, strictLots:false});
  assert.deepEqual(JSON.parse(JSON.stringify(imported.events)), raw.events);
  assert.equal(imported.current, "p");
  assert.deepEqual(JSON.parse(JSON.stringify(imported.setupPortfolio)), raw.setupPortfolio);
  assert.equal(imported.screen, "table");
});

test("a damaged operation stays in the journal, leaves replay usable, and renders a numbered warning", () => {
  const core = loadCore();
  const events = [addPlayer(), null, {type:"CASH_IN", id:"cash", playerId:"p", amount:250}];
  const state = reduce(core, events);
  const harness = loadUI();
  const game = {...config(core, "202-standard"), events, current:"p", screen:"table"};
  harness.ui.setGame(game);
  harness.ui.setState(state);

  assert.equal(state.players[0].cash, 1850);
  assert.equal(state.eventWarnings[0].operationNumber, 2);
  assert.equal(game.events.length, 3);
  assert.equal(game.events[1], null);
  assert.doesNotThrow(() => harness.ui.renderTable());
  assert.match(harness.dom.get("alerts").innerHTML, /операц(?:ия|ии)\s*№\s*2/i);
  assert.doesNotThrow(() => harness.ui.renderLog());
  assert.equal(harness.ui.getGame().events[1], null);
  assert.equal(JSON.parse(core.serializeGameSave(game)).events[1], null);
});

test("negative cashflow survives reload and replay with report, warnings and undo intact", () => {
  const core = loadCore();
  const events = [
    addPlayer(),
    {type:"ADD_OTHER_EXPENSE", id:"expense", playerId:"p", expenseId:"rent",
      name:"Дополнительная аренда", cadence:"monthly", amount:2000},
    {type:"PAYDAY", id:"payday", playerId:"p"}
  ];
  const saved = core.serializeGameSave({...config(core, "202-standard"), events, current:"p"});
  const reloaded = JSON.parse(saved);
  const player = reduce(core, reloaded.events).players[0];
  const harness = loadUI();
  harness.ui.setGame({...reloaded, screen:"table"});
  harness.ui.setState({players:[player], marketPrices:{}, eventWarnings:[]});

  assert.equal(player.cash, 720);
  assert.equal(core.derive(player).cashflow, -880);
  assert.equal(core.derive(player).totalExpenses, 3980);
  assert.match(harness.ui.reportRatRace(player), /Общий расход[^]*\$3.?980/);
  assert.match(core.warnings(player).map(item => item.text).join(" "), /Банкротство 202/);

  const undone = reduce(core, reloaded.events.slice(0, -1)).players[0];
  assert.equal(undone.cash, 1600);
  assert.equal(core.derive(undone).cashflow, -880);
  assert.doesNotMatch(core.warnings(undone).map(item => item.text).join(" "), /не хватит на следующую получку/);
});

test("owned-card edits and independent counters undo by replay", () => {
  const core = loadCore();
  const beforeEdit = [
    addPlayer(),
    {type:"BUY_PROPERTY", id:"buy-home", playerId:"p", assetId:"home", name:"Дом",
      kind:"property", price:1000, down:100, cashflow:100}
  ];
  const edit = {type:"UPDATE_OWNED_CARD", id:"edit-home", playerId:"p",
    cardType:"property", cardId:"home",
    patch:{name:"Дом после правки", price:1200, down:200, mortgage:1000, cashflow:250}};
  const edited = reduce(core, beforeEdit.concat(edit)).players[0].props[0];
  const restored = reduce(core, beforeEdit).players[0].props[0];

  assert.deepEqual(
    [edited.name, edited.price, edited.down, edited.mortgage, edited.cashflow],
    ["Дом после правки", 1200, 200, 1000, 250]
  );
  assert.deepEqual(
    [restored.name, restored.price, restored.down, restored.mortgage, restored.cashflow],
    ["Дом", 1000, 100, 900, 100]
  );

  const counterEvents = [addPlayer(),
    {type:"ADD_CARD_COUNTER", playerId:"p", counterId:"one", name:"Первый", remaining:2},
    {type:"ADD_CARD_COUNTER", playerId:"p", counterId:"two", name:"Второй", remaining:1},
    {type:"ADJUST_CARD_COUNTER", playerId:"p", counterId:"one", delta:-1},
    {type:"ADJUST_CARD_COUNTER", playerId:"p", counterId:"two", delta:1}
  ];
  const counters = reduce(core, counterEvents).players[0];
  const countersUndone = reduce(core, counterEvents.slice(0, -1)).players[0];
  const harness = loadUI();
  harness.ui.setGame({...config(core, "202-standard"), events:counterEvents, current:"p", screen:"table"});

  assert.deepEqual(Array.from(counters.cardCounters, item => [item.id, item.remaining]),
    [["one", 1], ["two", 2]]);
  assert.deepEqual(Array.from(countersUndone.cardCounters, item => [item.id, item.remaining]),
    [["one", 1], ["two", 1]]);
  assert.match(harness.ui.renderCardCounters(counters), /data-counter-minus="one"[^]*data-counter-plus="one"/);
  assert.match(harness.ui.renderCardCounters(counters), /data-counter-minus="two"[^]*data-counter-plus="two"/);
  assert.match(harness.ui.renderCardCounters(counters), /Первый[^]*1 ход(?:<|\.)/);
  assert.match(harness.ui.renderCardCounters(counters), /Второй[^]*2 хода/);
});

test("both official 202 victory halves are required and both Dream paths can satisfy the second half", () => {
  const core = loadCore();
  const start = [
    addPlayer("p", {dream:{fieldId:"selected-p", name:"Остров", price:100000}}),
    {type:"ENTER_FT", playerId:"p"},
    {type:"CASH_IN", playerId:"p", amount:1000000},
    {type:"FT_BUY_BIZ", playerId:"p", assetId:"biz", name:"Сеть",
      price:100000, down:10000, mortgage:90000, cashflow:50000}
  ];
  const incomeOnly = reduce(core, start).players[0];
  const ownDream = reduce(core, start.concat({type:"FT_DREAM", playerId:"p"})).players[0];
  const twoDreams = reduce(core, start.concat([
    {type:"FT_BUY_OTHER_DREAM", playerId:"p", fieldId:"free-a", name:"Самолёт", price:10000},
    {type:"FT_BUY_OTHER_DREAM", playerId:"p", fieldId:"free-b", name:"Яхта", price:10000}
  ])).players[0];

  assert.equal(core.deriveFT(incomeOnly).won, false);
  assert.equal(core.deriveFT(ownDream).won, true);
  assert.equal(core.deriveFT(twoDreams).won, true);
});

test("101 hides 202 controls and a setup mode change updates the header immediately", () => {
  const core = loadCore();
  const initialized = loadUI({initialize:true});
  assert.equal(initialized.dom.get("np-rounds-wrap").classList.contains("hide"), true);
  assert.equal(initialized.dom.get("np-portfolio").classList.contains("hide"), true);

  initialized.dom.get("np-rounds").value = "6";
  initialized.dom.get("np-mode").value = "202-custom";
  initialized.dom.get("np-mode").dispatch("change");
  assert.match(initialized.dom.get("hdr-sub").textContent, /Cashflow 202 Custom/);

  const harness = loadUI();
  const events = [addPlayer()];
  const player = setIntegratedGame(harness, core, events, "101").player;
  const labels = Array.from(harness.ui.tableActions(player, false, core.derive(player)), action => action[1]);
  assert.equal(labels.includes("Рынок 202"), false);
  assert.equal(labels.includes("Купить опцион"), false);
  assert.equal(labels.includes("D2Y"), false);
  assert.equal(harness.ui.render202Tools(player), "");
});

test("202 Fast Track report describes 50000 business growth instead of the legacy income target", () => {
  const core = loadCore();
  const events = [
    addPlayer(),
    {type:"BUY_PROPERTY", playerId:"p", assetId:"income", name:"Доход", kind:"property",
      price:1000, down:0, cashflow:3000},
    {type:"ENTER_FT", playerId:"p"}
  ];
  const harness = loadUI();
  const {player} = setIntegratedGame(harness, core, events);
  const html = harness.ui.reportFT(player);

  assert.match(html, /Рост бизнес-дохода/);
  assert.match(html, /\$50.?000/);
  assert.doesNotMatch(html, /\$350.?000/);
});

test("202 pre-exit ratio turns green only at the official twice-expenses threshold", () => {
  const core = loadCore();
  const harness = loadUI();
  const events = [addPlayer("p", {initialPortfolio:{cash:0, stocks:[], properties:[],
    otherAssets:[{name:"Доход", kind:"royalty", cost:0, income:2500}], otherLiabilities:[]}})];
  const {state} = setIntegratedGame(harness, core, events);
  assert.equal(core.derive(state.players[0]).canEscape, true);
  assert.equal(core.derive(state.players[0]).passive < 2 * core.derive(state.players[0]).totalExpenses, true);

  harness.ui.renderTable();
  assert.doesNotMatch(harness.dom.get("big").innerHTML,
    /Пассивный доход против общего расхода[^]*<b class="pos"/);

  state.players[0].otherAssets[0].income = 4000;
  harness.ui.renderTable();
  assert.match(harness.dom.get("big").innerHTML,
    /Пассивный доход против общего расхода[^]*<b class="pos"/);
});

test("complex financial dialogs preview resulting cash and monthly-flow change", () => {
  const core = loadCore();

  const d2yHarness = loadUI();
  const d2yGame = setIntegratedGame(d2yHarness, core, [addPlayer()]);
  d2yHarness.ui.actD2Y(d2yGame.player);
  const d2yPreview = d2yHarness.captured.forms.at(-1).preview({number:"1", cost:100, income:200});
  assert.match(d2yPreview, /Наличные/);
  assert.match(d2yPreview, /Изменение[^]*\+\$200/);

  const propertyEvents = [addPlayer(),
    {type:"BUY_PROPERTY", playerId:"p", assetId:"home", name:"Дом", kind:"property",
      price:1000, down:100, cashflow:100}
  ];
  const propertyHarness = loadUI();
  const propertyGame = setIntegratedGame(propertyHarness, core, propertyEvents);
  propertyHarness.ui.actProperty202(propertyGame.player);
  const propertyForm = propertyHarness.captured.forms.at(-1);
  assert.equal(typeof propertyForm.preview, "function");
  assert.match(propertyForm.preview({operation:"repay", assetId:"home", acresSold:0, salePrice:0,
    name:"", kind:"property", price:0, down:0, mortgage:0, cashflow:0, acres:0,
    removeCashflow:"keep"}), /Наличные/);

  const transferEvents = [
    addPlayer("p", {initialPortfolio:{cash:0, stocks:[], properties:[],
      otherAssets:[{name:"Роялти", kind:"royalty", cost:100, income:50}], otherLiabilities:[]}}),
    addPlayer("buyer")
  ];
  const transferHarness = loadUI();
  const transferGame = setIntegratedGame(transferHarness, core, transferEvents);
  transferHarness.ui.actTransfer202(transferGame.player);
  const transferForm = transferHarness.captured.forms.at(-1);
  assert.equal(typeof transferForm.preview, "function");
  assert.match(transferForm.preview({asset:"royalty:p-initial-other-0", buyerId:"buyer", price:100}), /Изменение/);

  const editHarness = loadUI();
  const editGame = setIntegratedGame(editHarness, core, propertyEvents);
  editHarness.ui.actEditOwnedCard(editGame.player, "property", "home");
  const editForm = editHarness.captured.forms.at(-1);
  assert.equal(typeof editForm.preview, "function");
  assert.match(editForm.preview({name:"Дом", price:1000, down:100, mortgage:900, cashflow:250}),
    /Изменение[^]*\+\$150/);
});

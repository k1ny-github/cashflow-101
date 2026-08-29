const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { assert } = require("./helpers");

function loadEngine(){
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "professions.js"), "utf8"), context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "engine.js"), "utf8") +
      "\nglobalThis.engine101 = { reduceEvents, derive, deriveFT };",
    context
  );
  return context.engine101;
}

function loadUI(){
  const captured = {forms: [], events: [], alerts: []};
  const context = {
    document: { addEventListener() {} },
    alert: message => captured.alerts.push(message)
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "professions.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "engine.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8"), context);
  context.openForm = config => captured.forms.push(config);
  context.push = event => captured.events.push(event);
  return {
    captured,
    actCash: context.actCash,
    actDoodad: context.actDoodad,
    actSetDream: context.actSetDream,
    validatePositiveMoney: context.validatePositiveMoney,
    submit(values){
      const form = captured.forms[captured.forms.length - 1];
      const error = form.validate ? form.validate(values) : null;
      if(!error) form.submit(values);
      return error;
    }
  };
}

function game(events){ return loadEngine().reduceEvents(events); }

test("doctor starts with cashflow plus savings", () => {
  const { derive } = loadEngine();
  const p = game([{type:"ADD_PLAYER", playerId:"p", name:"Марк", professionId:"doctor"}]).players[0];

  assert.equal(derive(p).cashflow, 3550);
  assert.equal(p.cash, 3950);
});

test("nurse starts with cashflow plus savings", () => {
  const { derive } = loadEngine();
  const p = game([{type:"ADD_PLAYER", playerId:"p", name:"Анна", professionId:"nurse"}]).players[0];

  assert.equal(derive(p).cashflow, 1120);
  assert.equal(p.cash, 1600);
});

test("legacy SPLIT still changes only its recorded holding", () => {
  const s = game([
    {type:"ADD_PLAYER", playerId:"p1", name:"Марк", professionId:"doctor"},
    {type:"ADD_PLAYER", playerId:"p2", name:"Анна", professionId:"nurse"},
    {type:"BUY_STOCK", playerId:"p1", assetId:"p1-ok4u", symbol:"OK4U", qty:100, price:10, div:1},
    {type:"BUY_STOCK", playerId:"p2", assetId:"p2-ok4u", symbol:"OK4U", qty:200, price:10, div:1},
    {type:"SPLIT", playerId:"p1", assetId:"p1-ok4u", direction:"split"}
  ]);

  assert.deepEqual(Array.from(s.players, p => p.stocks[0].qty), [200, 200]);
});

test("market split adjusts every holder", () => {
  const s = game([
    {type:"ADD_PLAYER", playerId:"p1", name:"Марк", professionId:"doctor"},
    {type:"ADD_PLAYER", playerId:"p2", name:"Анна", professionId:"nurse"},
    {type:"BUY_STOCK", playerId:"p1", assetId:"p1-ok4u", symbol:"OK4U", qty:100, price:10, div:1},
    {type:"BUY_STOCK", playerId:"p2", assetId:"p2-ok4u", symbol:"OK4U", qty:200, price:10, div:1},
    {type:"MARKET_SPLIT", symbol:"OK4U", ratio:2}
  ]);

  assert.deepEqual(Array.from(s.players, p => p.stocks[0].qty), [200, 400]);
  assert.deepEqual(Array.from(s.players, p => p.stocks[0].price), [5, 5]);
});

test("reverse market split floors odd share quantities", () => {
  const s = game([
    {type:"ADD_PLAYER", playerId:"p", name:"Марк", professionId:"doctor"},
    {type:"BUY_STOCK", playerId:"p", assetId:"p-ok4u", symbol:"OK4U", qty:3, price:10, div:1},
    {type:"MARKET_SPLIT", symbol:"OK4U", ratio:0.5}
  ]);

  assert.equal(s.players[0].stocks[0].qty, 1);
  assert.equal(s.players[0].stocks[0].price, 20);
});

test("positive-money validation rejects negative and zero values", () => {
  const { validatePositiveMoney } = loadUI();

  assert.equal(validatePositiveMoney(-1, "Цена"), "Цена: укажи положительное число");
  assert.equal(validatePositiveMoney(0, "Цена"), "Цена: укажи положительное число");
  assert.equal(validatePositiveMoney(100, "Цена"), null);
});

test("doodad does not append an event when Rat Race cash is insufficient", () => {
  const ui = loadUI();
  ui.actDoodad({id:"p", cash:50, ft:null});

  const error = ui.submit({title:"Катер", amount:100});

  assert.match(error, /сначала возьми кредит/);
  assert.equal(ui.captured.events.length, 0);
});

test("manual Rat Race cash-out does not append an event when cash is insufficient", () => {
  const ui = loadUI();
  ui.actCash({id:"p", cash:50, ft:null}, "out");

  const error = ui.submit({title:"Расход", amount:100});

  assert.match(error, /сначала возьми кредит/);
  assert.equal(ui.captured.events.length, 0);
});

test("manual Fast Track cash-out blocks without suggesting a loan", () => {
  const ui = loadUI();
  ui.actCash({
    id:"p",
    cash:50,
    dream:null,
    ft:{startIncome:0, target:50000, businesses:[]}
  }, "out");

  const error = ui.submit({title:"Расход", amount:100});
  const preview = ui.captured.forms[0].preview({title:"Расход", amount:100});

  assert.match(error, /Наличными не хватает/);
  assert.doesNotMatch(error, /возьми кредит/);
  assert.doesNotMatch(preview, /понадобится кредит|возьми кредит/);
  assert.equal(ui.captured.events.length, 0);
});

test("an existing dream cannot be replaced or appended again", () => {
  const ui = loadUI();
  ui.actSetDream({
    id:"p",
    dream:{name:"Остров", base:100000, tokens:1, bought:false}
  });

  assert.equal(ui.captured.forms.length, 0);
  assert.equal(ui.captured.events.length, 0);
  assert.match(ui.captured.alerts[0], /нельзя менять/);
});

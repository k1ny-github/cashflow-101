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

function loadValidation(){
  const context = { document: { addEventListener() {} } };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8"), context);
  return context.validatePositiveMoney;
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

test("positive-money validation rejects negative and zero values", () => {
  const validatePositiveMoney = loadValidation();

  assert.equal(validatePositiveMoney(-1, "Цена"), "Цена: укажи положительное число");
  assert.equal(validatePositiveMoney(0, "Цена"), "Цена: укажи положительное число");
  assert.equal(validatePositiveMoney(100, "Цена"), null);
});

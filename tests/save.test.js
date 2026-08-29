const test = require("node:test");
const { assert } = require("./helpers");
const { normalizeGameSave } = require("../save");

test("legacy save migrates to 101", () => {
  const save = normalizeGameSave({events:[{type:"ADD_PLAYER"}], current:"p1"});
  assert.equal(save.mode, "101");
  assert.equal(save.schemaVersion, 2);
  assert.deepEqual(save.events, [{type:"ADD_PLAYER"}]);
});

test("custom 202 save uses safe custom settings", () => {
  const save = normalizeGameSave({
    mode: "202-custom",
    settings: {optionRounds: 0, strictLots: true},
    events: [],
    current: null
  });

  assert.deepEqual(save.settings, {optionRounds: 3, strictLots: false});
});

test("custom 202 save falls back for infinite option rounds", () => {
  const save = normalizeGameSave({
    mode: "202-custom",
    settings: {optionRounds: Infinity}
  });

  assert.equal(save.settings.optionRounds, 3);
});

test("custom 202 save falls back for fractional option rounds", () => {
  const save = normalizeGameSave({
    mode: "202-custom",
    settings: {optionRounds: 2.5}
  });

  assert.equal(save.settings.optionRounds, 3);
});

test("serializes the normalized game save", () => {
  const { serializeGameSave } = require("../save");

  assert.deepEqual(JSON.parse(serializeGameSave({
    mode: "202-standard",
    events: [{type: "ADD_PLAYER"}],
    current: "p1"
  })), {
    schemaVersion: 2,
    mode: "202-standard",
    settings: {optionRounds: 3, strictLots: true},
    events: [{type: "ADD_PLAYER"}],
    current: "p1"
  });
});

test("preserves an unfinished 202 setup portfolio across normalization and serialization", () => {
  const { serializeGameSave } = require("../save");
  const draft = {
    cash: 500,
    stocks: [{symbol:"OK4U", qty:100, price:10, div:1}],
    properties: [{name:"Дом", price:65000, down:8000, mortgage:57000, cashflow:300}],
    otherAssets: [{name:"Роялти", cost:1000, income:75}],
    otherLiabilities: [{name:"Долг", balance:250, expense:25}]
  };

  const normalized = normalizeGameSave({
    mode:"202-custom", settings:{optionRounds:6}, events:[], current:null,
    setupPortfolio:draft
  });

  assert.deepEqual(normalized.setupPortfolio, draft);
  assert.deepEqual(JSON.parse(serializeGameSave(normalized)).setupPortfolio, draft);
});

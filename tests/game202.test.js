const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { assert } = require("./helpers");

function loadEngine(){
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "professions.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "fast-track202.js"), "utf8"), context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "engine.js"), "utf8") +
      "\nglobalThis.engine202 = { reduceEvents, derive, PROFESSIONS };",
    context
  );
  return context.engine202;
}

function game202(events){ return loadEngine().reduceEvents(events); }

function nurseSnapshot(){
  return JSON.parse(JSON.stringify(loadEngine().PROFESSIONS.find(p => p.id === "nurse")));
}

function loadSetupUI(){
  const context = {document:{addEventListener() {}}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "game-config.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "save.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "professions.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "fast-track202.js"), "utf8"), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "engine.js"), "utf8"), context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, "..", "ui.js"), "utf8") +
      "\nglobalThis.setup202 = { buildAddPlayerEvent, prepareImportedGame };",
    context
  );
  return context.setup202;
}

test("202 starting cash includes portfolio cash and passive income", () => {
  const p = game202([{type:"ADD_PLAYER", playerId:"p", name:"Анна", professionId:"nurse",
    profession:nurseSnapshot(),
    initialPortfolio:{cash:500, stocks:[], properties:[
      {name:"Дом", price:65000, down:8000, mortgage:57000, cashflow:300}
    ], otherAssets:[], otherLiabilities:[]}
  }]).players[0];

  assert.equal(p.cash, 2400); // 1120 + 300 cashflow + 480 savings + 500 cash
});

test("202 portfolio records its source and respects an explicit mortgage", () => {
  const p = game202([{type:"ADD_PLAYER", playerId:"p", name:"Анна", professionId:"nurse",
    profession:nurseSnapshot(),
    dream:{name:"Остров", price:100000},
    initialPortfolio:{cash:0,
      stocks:[{symbol:"OK4U", qty:100, price:10, div:1}],
      properties:[{name:"Дом", price:65000, down:8000, mortgage:56000, cashflow:-150}],
      otherAssets:[{name:"Роялти", cost:1000, income:200}],
      otherLiabilities:[{name:"Личный долг", balance:500, expense:75}]}
  }]).players[0];

  assert.equal(p.props[0].mortgage, 56000);
  assert.equal(p.props[0].cashflow, -150);
  assert.equal(p.stocks[0].source, "initial-portfolio");
  assert.equal(p.props[0].source, "initial-portfolio");
  assert.equal(p.otherAssets[0].source, "initial-portfolio");
  assert.equal(p.otherLiabilities[0].source, "initial-portfolio");
  assert.equal(p.dream.name, "Остров");
  assert.equal(p.dream.base, 100000);
  assert.equal(p.dream.tokens, 0);
  assert.equal(p.dream.bought, false);
  assert.equal(loadEngine().derive(p).cashflow, 1195);
});

test("one atomic 202 ADD_PLAYER event creates the complete starting portfolio", () => {
  const event = {type:"ADD_PLAYER", playerId:"p", name:"Анна", professionId:"nurse",
    profession:nurseSnapshot(), dream:{name:"Остров", price:100000},
    initialPortfolio:{cash:50,
      stocks:[{symbol:"OK4U", qty:100, price:10, div:1}],
      properties:[{name:"Дом", price:65000, down:8000, cashflow:300}],
      otherAssets:[{name:"Роялти", cost:1000, income:75}],
      otherLiabilities:[{name:"Личный долг", balance:500, expense:25}]}
  };
  const state = game202([event]);

  assert.equal(state.players.length, 1);
  assert.equal(state.players[0].stocks.length, 1);
  assert.equal(state.players[0].props.length, 1);
  assert.equal(state.players[0].otherAssets.length, 1);
  assert.equal(state.players[0].otherLiabilities.length, 1);
  assert.equal(state.players[0].dream.name, "Остров");
  assert.equal(event.type, "ADD_PLAYER");
});

test("202 setup writes a profession snapshot, selected Dream, and portfolio into one ADD_PLAYER event", () => {
  const event = loadSetupUI().buildAddPlayerEvent("202-standard", {
    playerId:"p", name:"Анна", professionId:"nurse",
    dream:{name:"Остров", price:100000},
    portfolio:{cash:500, stocks:[], properties:[], otherAssets:[], otherLiabilities:[]}
  });

  assert.equal(event.type, "ADD_PLAYER");
  assert.equal(event.profession.id, "nurse");
  assert.equal(event.profession.salary, 3100);
  assert.equal(event.dream.name, "Остров");
  assert.equal(event.dream.price, 100000);
  assert.equal(event.initialPortfolio.cash, 500);
  assert.equal(Object.keys(event).includes("purchaseEvents"), false);
});

test("import preparation retains the selected player and unfinished portfolio", () => {
  const game = loadSetupUI().prepareImportedGame({
    mode:"202-custom", settings:{optionRounds:6}, current:"p2", events:[],
    setupPortfolio:{cash:"500", stocks:[], properties:[], otherAssets:[], otherLiabilities:[]}
  });

  assert.equal(game.mode, "202-custom");
  assert.equal(game.settings.optionRounds, 6);
  assert.equal(game.current, "p2");
  assert.equal(game.setupPortfolio.cash, "500");
});

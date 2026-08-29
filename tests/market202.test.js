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

function loadMarket(){
  const context = {};
  vm.createContext(context);
  runFile(context, "market202.js");
  return context;
}

function loadEngine(){
  const context = {};
  vm.createContext(context);
  runFile(context, "game-config.js");
  runFile(context, "professions.js");
  runFile(context, "market202.js");
  runFile(context, "engine.js");
  vm.runInContext(
    "globalThis.engine202 = { reduceEvents, createGameConfig, optionRoundLimit };",
    context
  );
  return context.engine202;
}

function loadUI(){
  const captured = {forms:[], events:[], alerts:[], confirms:[]};
  const context = {
    document:{addEventListener() {}},
    alert:message => captured.alerts.push(message),
    confirm:message => { captured.confirms.push(message); return true; }
  };
  vm.createContext(context);
  runFile(context, "game-config.js");
  runFile(context, "save.js");
  runFile(context, "professions.js");
  runFile(context, "market202.js");
  runFile(context, "engine.js");
  runFile(context, "ui.js");
  vm.runInContext(
    "globalThis.marketUI = {" +
      "actBuyOption:typeof actBuyOption === 'function' ? actBuyOption : null," +
      "actCloseShort:typeof actCloseShort === 'function' ? actCloseShort : null," +
      "setGame(game){ G = game; }," +
      "setState(state){ S = state; }," +
      "recompute:typeof recompute === 'function' ? recompute : null," +
      "getGame(){ return G; }," +
      "getState(){ return S; }," +
      "renderTools(player){ return typeof render202Tools === 'function' ? render202Tools(player) : null; }," +
      "actionsFor(player){" +
        "if(typeof tableActions !== 'function') return null;" +
        "const ft = !!player.ft;" +
        "return tableActions(player, ft, ft ? deriveFT(player) : derive(player));" +
      "}" +
    "};",
    context
  );
  context.openForm = config => captured.forms.push(config);
  context.push = event => captured.events.push(event);
  return {
    captured,
    marketUI:context.marketUI,
    setConfirm(value){ context.confirm = message => { captured.confirms.push(message); return value; }; },
    submit(values){
      const form = captured.forms[captured.forms.length - 1];
      const error = form.validate ? form.validate(values) : null;
      if(!error) form.submit(values);
      return error;
    }
  };
}

function addPlayer(playerId, professionId = "nurse"){
  return {type:"ADD_PLAYER", playerId, name:playerId, professionId};
}

function buyOption(playerId, optionId, overrides = {}){
  return {
    type:"BUY_OPTION", playerId, optionId,
    optionType:"call", symbol:"OK4U", qty:200, strike:20,
    premiumPerShare:2, premiumTotal:400,
    ...overrides
  };
}

function game(events, mode = "202-standard", settings = {}){
  const engine = loadEngine();
  return engine.reduceEvents(events, engine.createGameConfig(mode, settings));
}

test("call payout excludes the premium already paid", () => {
  const { optionPayout } = loadMarket();
  assert.equal(typeof optionPayout, "function");
  assert.equal(optionPayout({type:"call", strike:20, qty:200}, 40), 4000);
});

test("put payout follows the book example", () => {
  const { optionPayout } = loadMarket();
  assert.equal(typeof optionPayout, "function");
  assert.equal(optionPayout({type:"put", strike:30, qty:200}, 20), 2000);
});

test("a call and put on the same shares form a straddle and charge each premium once", () => {
  const p = game([
    addPlayer("p"),
    buyOption("p", "call"),
    buyOption("p", "put", {optionType:"put", strike:30, premiumPerShare:1, premiumTotal:200})
  ]).players[0];

  assert.deepEqual(Array.from(p.options, option => option.type), ["call", "put"]);
  assert.equal(p.cash, 1000); // nurse $1600 − $400 − $200
});

test("legacy BUY_OPTION premium remains an already-total premium", () => {
  const p = game([
    addPlayer("p"),
    {type:"BUY_OPTION", playerId:"p", optionId:"legacy", typeOpt:"call",
      symbol:"ALT", qty:75, strike:20, premium:75, remaining:3}
  ]).players[0];

  assert.equal(p.cash, 1525);
  assert.equal(p.options[0].premiumTotal, 75);
});

test("new BUY_OPTION derives and deducts premiumTotal instead of trusting the event copy", () => {
  const p = game([
    addPlayer("p"),
    buyOption("p", "o", {qty:200, premiumPerShare:2, premiumTotal:1})
  ]).players[0];

  assert.equal(p.options[0].premiumTotal, 400);
  assert.equal(p.cash, 1200);
});

test("standard lots are restricted to 100–5000 in steps of 100", () => {
  const { validateLot } = loadMarket();
  assert.equal(typeof validateLot, "function");
  assert.equal(validateLot(100, true), true);
  assert.equal(validateLot(5000, true), true);
  assert.equal(validateLot(50, true), false);
  assert.equal(validateLot(5100, true), false);
  assert.equal(validateLot(250, true), false);
  assert.equal(validateLot(250, false), true);
});

test("standard options start at three rounds and Custom uses its configured duration", () => {
  const standard = game([addPlayer("s"), buyOption("s", "o", {remaining:99})]).players[0].options[0];
  const custom = game([addPlayer("c"), buyOption("c", "o", {remaining:1})], "202-custom", {optionRounds:7})
    .players[0].options[0];

  assert.equal(standard.remaining, 3);
  assert.equal(standard.roundLimit, 3);
  assert.equal(custom.remaining, 7);
  assert.equal(custom.roundLimit, 7);
});

test("ADJUST_OPTION_ROUNDS changes only its option and +1 repairs a manual decrement", () => {
  const p = game([
    addPlayer("p"), buyOption("p", "a"), buyOption("p", "b"),
    {type:"ADJUST_OPTION_ROUNDS", playerId:"p", optionId:"a", delta:-1},
    {type:"ADJUST_OPTION_ROUNDS", playerId:"p", optionId:"a", delta:1}
  ]).players[0];

  assert.deepEqual(Array.from(p.options, option => option.remaining), [3, 3]);
});

test("final per-option decrement makes it inactive and deleting that event restores it", () => {
  const events = [
    addPlayer("p"), buyOption("p", "a", {remaining:1}),
    {type:"ADJUST_OPTION_ROUNDS", playerId:"p", optionId:"a", delta:-1}
  ];

  const expired = game(events, "202-custom", {optionRounds:1}).players[0].options[0];
  const restored = game(events.slice(0, -1), "202-custom", {optionRounds:1}).players[0].options[0];
  assert.equal(expired.remaining, 0);
  assert.equal(expired.active, false);
  assert.equal(restored.remaining, 1);
  assert.equal(restored.active, true);
});

test("+1 can repair an accidental final per-option decrement", () => {
  const p = game([
    addPlayer("p"), buyOption("p", "a", {remaining:1}),
    {type:"ADJUST_OPTION_ROUNDS", playerId:"p", optionId:"a", delta:-1},
    {type:"ADJUST_OPTION_ROUNDS", playerId:"p", optionId:"a", delta:1}
  ], "202-custom", {optionRounds:1}).players[0];

  assert.equal(p.options[0].remaining, 1);
  assert.equal(p.options[0].active, true);
});

test("+1 cannot extend Standard or Custom options beyond their original configured duration", () => {
  const standard = game([
    addPlayer("s"), buyOption("s", "o"),
    {type:"ADJUST_OPTION_ROUNDS", playerId:"s", optionId:"o", delta:1}
  ]).players[0].options[0];
  const custom = game([
    addPlayer("c"), buyOption("c", "o"),
    {type:"ADJUST_OPTION_ROUNDS", playerId:"c", optionId:"o", delta:1}
  ], "202-custom", {optionRounds:7}).players[0].options[0];

  assert.equal(standard.remaining, 3);
  assert.equal(custom.remaining, 7);
});

test("option card disables +1 at the configured duration cap", () => {
  const ui = loadUI();
  const state = game([addPlayer("p"), buyOption("p", "o")]);
  ui.marketUI.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});
  ui.marketUI.setState(state);

  const html = ui.marketUI.renderTools(state.players[0]);

  assert.match(html, /data-option-plus="o" disabled/);
});

test("legacy OPTION_ROUND still decrements every open option", () => {
  const p = game([
    addPlayer("p"),
    {type:"BUY_OPTION", playerId:"p", optionId:"a", typeOpt:"call", symbol:"OK4U",
      qty:200, strike:20, premium:0, remaining:3},
    {type:"BUY_OPTION", playerId:"p", optionId:"b", typeOpt:"put", symbol:"OK4U",
      qty:200, strike:20, premium:0, remaining:1},
    {type:"OPTION_ROUND"}
  ]).players[0];

  assert.equal(p.options.length, 1);
  assert.equal(p.options[0].id, "a");
  assert.equal(p.options[0].remaining, 2);
});

test("short result is positive on a fall and negative on a rise", () => {
  const { shortResult } = loadMarket();
  assert.equal(typeof shortResult, "function");
  assert.equal(shortResult({qty:200, openPrice:30}, 20), 2000);
  assert.equal(shortResult({qty:200, openPrice:30}, 40), -2000);
});

test("opening a short keeps proceeds in an envelope instead of free cash", () => {
  const p = game([
    addPlayer("p"),
    {type:"OPEN_SHORT", playerId:"p", shortId:"sh", symbol:"OK4U", qty:200, openPrice:30}
  ]).players[0];

  assert.equal(p.cash, 1600);
  assert.equal(p.shorts[0].proceedsEnvelope, 6000);
});

test("the next matching market price locks a mandatory short close", () => {
  const p = game([
    addPlayer("p"),
    {type:"OPEN_SHORT", playerId:"p", shortId:"sh", symbol:"OK4U", qty:200, openPrice:30},
    {type:"MARKET_PRICE", symbol:"MYT4U", price:50},
    {type:"MARKET_PRICE", symbol:"OK4U", price:20},
    {type:"MARKET_PRICE", symbol:"OK4U", price:10}
  ]).players[0];

  assert.equal(p.shorts[0].mustClose, true);
  assert.equal(p.shorts[0].closePrice, 20);
});

test("closing a mandatory short realizes its locked result", () => {
  const profit = game([
    addPlayer("p"),
    {type:"OPEN_SHORT", playerId:"p", shortId:"sh", symbol:"OK4U", qty:200, openPrice:30},
    {type:"MARKET_PRICE", symbol:"OK4U", price:20},
    {type:"CLOSE_SHORT", playerId:"p", shortId:"sh", marketPrice:20}
  ]).players[0];
  const loss = game([
    addPlayer("p"),
    {type:"CASH_IN", playerId:"p", amount:1000},
    {type:"OPEN_SHORT", playerId:"p", shortId:"sh", symbol:"OK4U", qty:200, openPrice:30},
    {type:"MARKET_PRICE", symbol:"OK4U", price:40},
    {type:"CLOSE_SHORT", playerId:"p", shortId:"sh", marketPrice:40}
  ]).players[0];

  assert.equal(profit.cash, 3600);
  assert.equal(profit.shorts.length, 0);
  assert.equal(loss.cash, 600);
});

test("locked short ignores company bankruptcy until the locking price event is removed", () => {
  const events = [
    addPlayer("p"),
    {type:"OPEN_SHORT", playerId:"p", shortId:"sh", symbol:"OK4U", qty:200, openPrice:30},
    {type:"MARKET_PRICE", symbol:"OK4U", price:40},
    {type:"COMPANY_BANKRUPTCY", symbol:"OK4U"}
  ];

  const locked = game(events);
  const replayWithoutLock = game(events.filter(event => event.type !== "MARKET_PRICE"));

  assert.equal(locked.marketPrices.OK4U, 40);
  assert.equal(locked.players[0].cash, 1600);
  assert.equal(locked.players[0].shorts[0].closePrice, 40);
  assert.equal(replayWithoutLock.marketPrices.OK4U, 0);
  assert.equal(replayWithoutLock.players[0].cash, 7600);
  assert.equal(replayWithoutLock.players[0].shorts.length, 0);
});

test("locked short ignores later market prices and splits without rewriting its terms", () => {
  const state = game([
    addPlayer("p"),
    {type:"OPEN_SHORT", playerId:"p", shortId:"sh", symbol:"OK4U", qty:200, openPrice:30},
    {type:"MARKET_PRICE", symbol:"OK4U", price:40},
    {type:"MARKET_PRICE", symbol:"OK4U", price:10},
    {type:"MARKET_SPLIT", symbol:"OK4U", ratio:2}
  ]);
  const position = state.players[0].shorts[0];

  assert.equal(state.marketPrices.OK4U, 40);
  assert.deepEqual([position.qty, position.openPrice, position.closePrice], [200, 30, 40]);
});

test("locked short blocks ordinary actions and bank credit but permits asset sale then close", () => {
  const p = game([
    addPlayer("p"),
    {type:"BUY_STOCK", playerId:"p", assetId:"stock", symbol:"MYT4U", qty:100, price:1, div:0},
    {type:"OPEN_SHORT", playerId:"p", shortId:"sh", symbol:"OK4U", qty:200, openPrice:30},
    {type:"MARKET_PRICE", symbol:"OK4U", price:40},
    {type:"TAKE_LOAN", playerId:"p", amount:1000},
    {type:"PAYDAY", playerId:"p"},
    {type:"CASH_IN", playerId:"p", amount:5000},
    {type:"SELL_STOCK", playerId:"p", assetId:"stock", qty:100, price:10},
    {type:"CLOSE_SHORT", playerId:"p", shortId:"sh", marketPrice:0}
  ]).players[0];

  assert.equal(p.bankLoan, 0);
  assert.equal(p.cash, 500); // $1600 − $100 stock + $1000 sale − $2000 locked short loss
  assert.equal(p.stocks.length, 0);
  assert.equal(p.shorts.length, 0);
});

test("underfunded locked short cannot close into negative free cash", () => {
  const p = game([
    addPlayer("p"),
    {type:"OPEN_SHORT", playerId:"p", shortId:"sh", symbol:"OK4U", qty:200, openPrice:30},
    {type:"MARKET_PRICE", symbol:"OK4U", price:40},
    {type:"CLOSE_SHORT", playerId:"p", shortId:"sh", marketPrice:0}
  ]).players[0];

  assert.equal(p.cash, 1600);
  assert.equal(p.shorts[0].closePrice, 40);
});

test("asset sales stay blocked when a locked short does not need loss coverage", () => {
  const p = game([
    addPlayer("p"),
    {type:"BUY_STOCK", playerId:"p", assetId:"stock", symbol:"MYT4U", qty:100, price:1, div:0},
    {type:"OPEN_SHORT", playerId:"p", shortId:"sh", symbol:"OK4U", qty:200, openPrice:30},
    {type:"MARKET_PRICE", symbol:"OK4U", price:20},
    {type:"SELL_STOCK", playerId:"p", assetId:"stock", qty:100, price:10},
    {type:"CLOSE_SHORT", playerId:"p", shortId:"sh", marketPrice:0}
  ]).players[0];

  assert.equal(p.cash, 3500); // $1600 − $100 stock + $2000 short profit
  assert.equal(p.stocks[0].qty, 100);
  assert.equal(p.shorts.length, 0);
});

test("short-loss personal bankruptcy resolves every locked short without bank credit", () => {
  const p = game([
    addPlayer("p"),
    {type:"OPEN_SHORT", playerId:"p", shortId:"sh", symbol:"OK4U", qty:200, openPrice:30},
    {type:"MARKET_PRICE", symbol:"OK4U", price:40},
    {type:"DECLARE_202_BANKRUPTCY", playerId:"p", reason:"short-loss"}
  ]).players[0];

  assert.equal(p.cash, 0);
  assert.equal(p.bankLoan, 0);
  assert.equal(p.skipTurns, 3);
  assert.equal(p.shorts.length, 0);
});

test("UI moves to the affected player and exposes only short-resolution actions", () => {
  const ui = loadUI();
  ui.marketUI.setGame({
    mode:"202-standard", settings:{optionRounds:3, strictLots:true}, current:"p1", screen:"table",
    events:[
      addPlayer("p1"), addPlayer("p2"),
      {type:"BUY_STOCK", playerId:"p2", assetId:"stock", symbol:"MYT4U", qty:100, price:1, div:0},
      {type:"OPEN_SHORT", playerId:"p2", shortId:"sh", symbol:"OK4U", qty:200, openPrice:30},
      {type:"MARKET_PRICE", playerId:"p1", symbol:"OK4U", price:40}
    ]
  });

  ui.marketUI.recompute();
  const state = ui.marketUI.getState();
  const affected = state.players.find(player => player.id === "p2");
  const labels = ui.marketUI.actionsFor(affected).map(action => action[1]);

  assert.equal(ui.marketUI.getGame().current, "p2");
  assert.deepEqual(Array.from(labels), ["Закрыть шорт OK4U", "Продать актив", "Личное банкротство"]);
  assert.equal(labels.includes("Взять кредит"), false);
  assert.equal(labels.includes("Рынок 202"), false);
});

test("UI disables unrelated option and unlocked-short controls during mandatory close", () => {
  const ui = loadUI();
  const state = game([
    addPlayer("p"),
    buyOption("p", "option"),
    {type:"OPEN_SHORT", playerId:"p", shortId:"locked", symbol:"OK4U", qty:200, openPrice:30},
    {type:"OPEN_SHORT", playerId:"p", shortId:"other", symbol:"MYT4U", qty:200, openPrice:30},
    {type:"MARKET_PRICE", symbol:"OK4U", price:40}
  ]);
  ui.marketUI.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});
  ui.marketUI.setState(state);

  const html = ui.marketUI.renderTools(state.players[0]);

  assert.match(html, /data-option-minus="option" disabled/);
  assert.match(html, /data-option-exercise="option" disabled/);
  assert.match(html, /data-short-close="other" disabled/);
  assert.doesNotMatch(html, /data-short-close="locked" disabled/);
});

test("market effects expose stock, active options and shorts for all players", () => {
  const market = loadMarket();
  assert.equal(typeof market.marketEffects, "function");
  const state = game([
    addPlayer("p1"), addPlayer("p2"),
    {type:"BUY_STOCK", playerId:"p1", assetId:"stock", symbol:"OK4U", qty:100, price:10, div:0},
    buyOption("p2", "put", {optionType:"put", strike:30}),
    {type:"OPEN_SHORT", playerId:"p2", shortId:"sh", symbol:"OK4U", qty:200, openPrice:30}
  ]);

  const effects = market.marketEffects(state, "OK4U", 20);
  assert.equal(effects.stocks.length, 1);
  assert.equal(effects.options.length, 1);
  assert.equal(effects.options[0].payout, 2000);
  assert.equal(effects.shorts.length, 1);
  assert.equal(effects.shorts[0].result, 2000);
  assert.deepEqual(Array.from(effects.affectedPlayers, player => player.playerId), ["p1", "p2"]);
});

test("Custom reducer requires explicit confirmation for every new nonstandard lot", () => {
  const rejectedOption = game([
    addPlayer("p"), buyOption("p", "o", {qty:250, premiumTotal:500})
  ], "202-custom").players[0];
  const acceptedOption = game([
    addPlayer("p"), buyOption("p", "o", {qty:250, premiumTotal:500,
      nonstandardLotConfirmed:true})
  ], "202-custom").players[0];
  const rejectedShort = game([
    addPlayer("p"),
    {type:"OPEN_SHORT", playerId:"p", shortId:"sh", symbol:"ALT", qty:250, openPrice:30,
      nonstandardLotConfirmed:"true"}
  ], "202-custom").players[0];
  const acceptedShort = game([
    addPlayer("p"),
    {type:"OPEN_SHORT", playerId:"p", shortId:"sh", symbol:"ALT", qty:250, openPrice:30,
      nonstandardLotConfirmed:true}
  ], "202-custom").players[0];

  assert.equal(rejectedOption.options.length, 0);
  assert.equal(rejectedOption.cash, 1600);
  assert.equal(acceptedOption.options.length, 1);
  assert.equal(rejectedShort.shorts.length, 0);
  assert.equal(acceptedShort.shorts.length, 1);
});

test("global split adjusts stocks, options and shorts across every player", () => {
  const state = game([
    addPlayer("p1"), addPlayer("p2"),
    {type:"BUY_STOCK", playerId:"p1", assetId:"stock", symbol:"OK4U", qty:101, price:10, div:0},
    buyOption("p2", "option", {qty:201, strike:20, premiumPerShare:2, premiumTotal:402,
      nonstandardLotConfirmed:true}),
    {type:"OPEN_SHORT", playerId:"p2", shortId:"short", symbol:"OK4U", qty:301, openPrice:30,
      nonstandardLotConfirmed:true},
    {type:"MARKET_SPLIT", symbol:"OK4U", ratio:2}
  ], "202-custom");
  const p1 = state.players[0];
  const p2 = state.players[1];

  assert.deepEqual([p1.stocks[0].qty, p1.stocks[0].price], [202, 5]);
  assert.deepEqual(
    [p2.options[0].qty, p2.options[0].strike, p2.options[0].premiumPerShare, p2.options[0].premiumTotal],
    [402, 10, 1, 402]
  );
  assert.deepEqual([p2.shorts[0].qty, p2.shorts[0].openPrice], [602, 15]);
});

test("reverse split floors every odd quantity and removes zero positions", () => {
  const state = game([
    addPlayer("p"),
    {type:"BUY_STOCK", playerId:"p", assetId:"stock", symbol:"OK4U", qty:3, price:10, div:0},
    buyOption("p", "option", {qty:3, strike:20, premiumPerShare:2, premiumTotal:6,
      nonstandardLotConfirmed:true}),
    {type:"OPEN_SHORT", playerId:"p", shortId:"short", symbol:"OK4U", qty:1, openPrice:30,
      nonstandardLotConfirmed:true},
    {type:"MARKET_SPLIT", symbol:"OK4U", ratio:0.5}
  ], "202-custom");
  const p = state.players[0];

  assert.deepEqual([p.stocks[0].qty, p.stocks[0].price], [1, 20]);
  assert.deepEqual([p.options[0].qty, p.options[0].strike, p.options[0].premiumPerShare], [1, 40, 4]);
  assert.equal(p.shorts.length, 0);
});

test("company bankruptcy previews affected players and settles puts and shorts at zero", () => {
  const before = game([
    addPlayer("p1"), addPlayer("p2"),
    {type:"BUY_STOCK", playerId:"p1", assetId:"stock", symbol:"OK4U", qty:100, price:10, div:0},
    buyOption("p1", "call", {optionType:"call", strike:20}),
    buyOption("p2", "put", {optionType:"put", strike:30}),
    {type:"OPEN_SHORT", playerId:"p2", shortId:"short", symbol:"OK4U", qty:200, openPrice:30}
  ]);
  const { marketEffects } = loadMarket();
  const preview = marketEffects(before, "OK4U", 0);
  const after = game([
    addPlayer("p1"), addPlayer("p2"),
    {type:"BUY_STOCK", playerId:"p1", assetId:"stock", symbol:"OK4U", qty:100, price:10, div:0},
    buyOption("p1", "call", {optionType:"call", strike:20}),
    buyOption("p2", "put", {optionType:"put", strike:30}),
    {type:"OPEN_SHORT", playerId:"p2", shortId:"short", symbol:"OK4U", qty:200, openPrice:30},
    {type:"COMPANY_BANKRUPTCY", symbol:"OK4U"}
  ]);

  assert.deepEqual(Array.from(preview.affectedPlayers, player => player.playerId), ["p1", "p2"]);
  assert.equal(after.marketPrices.OK4U, 0);
  assert.equal(after.players[0].stocks.length, 0);
  assert.equal(after.players[0].options.length, 0);
  assert.equal(after.players[1].options.length, 0);
  assert.equal(after.players[1].shorts.length, 0);
  assert.equal(after.players[1].cash, 13200); // $1600 − $400 premium + $6000 put + $6000 short
});

test("new options are blocked on the Fast Track", () => {
  const ui = loadUI();
  assert.equal(typeof ui.marketUI.actBuyOption, "function");
  ui.marketUI.setGame({mode:"202-standard", settings:{optionRounds:3, strictLots:true}, events:[]});

  ui.marketUI.actBuyOption({id:"p", cash:10000, ft:{}});

  assert.equal(ui.captured.forms.length, 0);
  assert.match(ui.captured.alerts[0], /скоростной дорожке/i);
});

test("Custom records explicit confirmation before accepting a nonstandard option lot", () => {
  const ui = loadUI();
  assert.equal(typeof ui.marketUI.actBuyOption, "function");
  ui.marketUI.setGame({mode:"202-custom", settings:{optionRounds:6, strictLots:false}, events:[]});
  ui.marketUI.actBuyOption({id:"p", cash:10000, ft:null});

  const error = ui.submit({optionType:"call", symbol:"ALT", strike:20, premiumPerShare:2, qty:250});

  assert.equal(error, null);
  assert.equal(ui.captured.confirms.length, 1);
  assert.equal(ui.captured.events[0].nonstandardLotConfirmed, true);
  assert.equal(ui.captured.events[0].remaining, 6);
  assert.equal(ui.captured.events[0].premiumTotal, 500);
});

test("a short loss that exceeds cash offers asset sale or personal bankruptcy, never bank credit", () => {
  const ui = loadUI();
  assert.equal(typeof ui.marketUI.actCloseShort, "function");
  const position = {id:"sh", symbol:"OK4U", qty:200, openPrice:30, mustClose:true, closePrice:40};

  ui.marketUI.actCloseShort({id:"p", cash:100, ft:null}, position);
  const preview = ui.captured.forms[0].preview({});
  const error = ui.submit({});

  assert.match(error, /продай активы|личное банкротство/i);
  assert.doesNotMatch(error, /кредит/i);
  assert.match(preview, /продай активы|личное банкротство/i);
  assert.doesNotMatch(preview, /кредит/i);
  assert.equal(ui.captured.events.length, 0);
});

const test = require("node:test");
const { assert } = require("./helpers");
const { createGameConfig, is202, optionRoundLimit } = require("../game-config");

test("standard is fixed at three strict rounds", () => {
  assert.deepEqual(createGameConfig("202-standard", {optionRounds:9}), {
    mode:"202-standard", settings:{optionRounds:3, strictLots:true}
  });
});

test("custom keeps a positive whole option-round choice with soft lots", () => {
  const config = createGameConfig("202-custom", {optionRounds:7});

  assert.equal(is202(config), true);
  assert.equal(optionRoundLimit(config), 7);
  assert.deepEqual(config.settings, {optionRounds:7, strictLots:false});
});

test("101 is the safe default and has no 202 option duration", () => {
  const config = createGameConfig("not-a-mode", {optionRounds:9});

  assert.deepEqual(config, {mode:"101", settings:{optionRounds:3, strictLots:false}});
  assert.equal(is202(config), false);
  assert.equal(optionRoundLimit(config), 0);
});

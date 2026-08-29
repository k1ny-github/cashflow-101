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

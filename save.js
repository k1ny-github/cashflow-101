(function(root){
  function normalizeGameSave(raw){
    const fallbackConfig = (mode, input) => {
      const selected = ["101", "202-standard", "202-custom"].includes(mode) ? mode : "101";
      const rounds = Number(input?.optionRounds);
      return {
        mode: selected,
        settings: selected === "202-custom"
          ? {optionRounds: Number.isInteger(rounds) && rounds >= 1 ? rounds : 3, strictLots:false}
          : {optionRounds:3, strictLots:selected === "202-standard"}
      };
    };
    const config = (root.createGameConfig || fallbackConfig)(raw?.mode, raw?.settings);
    const save = {
      schemaVersion: 2,
      mode: config.mode,
      settings: config.settings,
      events: Array.isArray(raw?.events) ? raw.events : [],
      current: raw?.current || null
    };
    if(Object.prototype.hasOwnProperty.call(raw || {}, "setupPortfolio")){
      save.setupPortfolio = raw.setupPortfolio;
    }
    return save;
  }

  function serializeGameSave(game){
    return JSON.stringify(normalizeGameSave(game));
  }

  root.normalizeGameSave = normalizeGameSave;
  root.serializeGameSave = serializeGameSave;

  if(typeof module !== "undefined"){
    module.exports = { normalizeGameSave, serializeGameSave };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

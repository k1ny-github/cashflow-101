(function(root){
  function normalizeGameSave(raw){
    const mode = ["101","202-standard","202-custom"].includes(raw && raw.mode) ? raw.mode : "101";
    return {
      schemaVersion: 2,
      mode,
      settings: mode === "202-custom"
        ? {optionRounds: Math.max(1, Number(raw?.settings?.optionRounds) || 3), strictLots:false}
        : {optionRounds:3, strictLots:mode === "202-standard"},
      events: Array.isArray(raw?.events) ? raw.events : [],
      current: raw?.current || null
    };
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

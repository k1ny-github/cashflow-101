(function(root){
  const MODES = ["101", "202-standard", "202-custom"];

  function createGameConfig(mode, input){
    const selected = MODES.includes(mode) ? mode : "101";
    const rounds = Number(input?.optionRounds);
    return {
      mode: selected,
      settings: selected === "202-custom"
        ? {optionRounds: Number.isInteger(rounds) && rounds >= 1 ? rounds : 3, strictLots:false}
        : {optionRounds:3, strictLots:selected === "202-standard"}
    };
  }

  function is202(config){
    return config?.mode === "202-standard" || config?.mode === "202-custom";
  }

  function optionRoundLimit(config){
    return is202(config) ? config.settings.optionRounds : 0;
  }

  root.createGameConfig = createGameConfig;
  root.is202 = is202;
  root.optionRoundLimit = optionRoundLimit;

  if(typeof module !== "undefined"){
    module.exports = { createGameConfig, is202, optionRoundLimit };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

(function(root){
  "use strict";

  function finite(value){
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function optionPayout(option, marketPrice){
    const qty = Math.max(0, finite(option?.qty));
    const strike = finite(option?.strike);
    const price = finite(marketPrice);
    const intrinsic = option?.type === "put"
      ? Math.max(0, strike - price)
      : Math.max(0, price - strike);
    return intrinsic * qty;
  }

  function shortResult(position, marketPrice){
    return Math.max(0, finite(position?.qty)) *
      (finite(position?.openPrice) - finite(marketPrice));
  }

  function validateLot(qty, strict){
    const amount = Number(qty);
    if(!Number.isInteger(amount) || amount <= 0) return false;
    return !strict || (amount >= 100 && amount <= 5000 && amount % 100 === 0);
  }

  function marketEffects(state, symbol, price){
    const effects = {symbol, price:finite(price), stocks:[], options:[], shorts:[], affectedPlayers:[]};
    for(const player of state?.players || []){
      const stocks = (player.stocks || []).filter(stock => stock.symbol === symbol && stock.qty > 0)
        .map(stock => ({playerId:player.id, playerName:player.name, holdingId:stock.id,
          qty:stock.qty, price:effects.price}));
      const options = (player.options || []).filter(option =>
        option.symbol === symbol && option.remaining > 0
      ).map(option => ({playerId:player.id, playerName:player.name, optionId:option.id,
        type:option.type, qty:option.qty, strike:option.strike,
        payout:optionPayout(option, effects.price), remaining:option.remaining}));
      const shorts = (player.shorts || []).filter(position => position.symbol === symbol)
        .map(position => ({playerId:player.id, playerName:player.name, shortId:position.id,
          qty:position.qty, openPrice:position.openPrice,
          result:shortResult(position, effects.price), mustClose:true}));
      effects.stocks.push(...stocks);
      effects.options.push(...options);
      effects.shorts.push(...shorts);
      if(stocks.length || options.length || shorts.length){
        effects.affectedPlayers.push({
          playerId:player.id, playerName:player.name,
          stocks:stocks.length, options:options.length, shorts:shorts.length
        });
      }
    }
    return effects;
  }

  root.optionPayout = optionPayout;
  root.shortResult = shortResult;
  root.validateLot = validateLot;
  root.marketEffects = marketEffects;

  if(typeof module !== "undefined"){
    module.exports = {optionPayout, shortResult, validateLot, marketEffects};
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

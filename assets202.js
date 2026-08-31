"use strict";

/* Pure calculations for Cashflow 202 asset cards.  The reducer owns all
   mutation; these helpers deliberately return new values. */

function assetNumber(value){
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function d2yIncome(cards){
  const list = Array.isArray(cards) ? cards : [];
  const hasOne = list.some(card => Number(card.number) === 1);
  const hasTwo = list.some(card => Number(card.number) === 2);
  let paidOne = false;
  let paidThree = false;
  return list.reduce((sum, card) => {
    const number = Number(card.number);
    if(number === 1 && !paidOne){ paidOne = true; return sum + assetNumber(card.income); }
    if(number === 2 && hasOne) return sum + assetNumber(card.income);
    if(number === 3 && hasOne && hasTwo && !paidThree){ paidThree = true; return sum + assetNumber(card.income); }
    return sum;
  }, 0);
}

function splitLand(asset, acresSold, salePrice){
  if(!asset || assetNumber(asset.mortgage) !== 0) return null;
  const acres = assetNumber(asset.acres);
  const sold = assetNumber(acresSold);
  const proceeds = assetNumber(salePrice);
  if(acres <= 0 || sold <= 0 || sold >= acres || proceeds < 0) return null;
  const remainingShare = (acres - sold) / acres;
  const next = {...asset, acres:acres - sold, mortgage:0};
  if(Object.prototype.hasOwnProperty.call(asset, "price")) next.price = assetNumber(asset.price) * remainingShare;
  if(Object.prototype.hasOwnProperty.call(asset, "bookValue")) next.bookValue = assetNumber(asset.bookValue) * remainingShare;
  if(Object.prototype.hasOwnProperty.call(asset, "down")) next.down = assetNumber(asset.down) * remainingShare;
  if(asset.removeCashflowOnSplit || asset.removeCashflow || asset.cashflowEndsOnSplit) next.cashflow = 0;
  return {asset:next, proceeds};
}

function insuranceExpense(player){
  if(!player) return 0;
  if(Array.isArray(player.insurancePolicies)){
    return player.insurancePolicies.reduce((sum, policy) => sum + Math.max(0,
      assetNumber(policy.expense ?? policy.monthlyExpense ?? policy.amount)), 0);
  }
  if(!player.insurance) return Math.max(0, assetNumber(player.insuranceExpense));
  return Math.max(0, assetNumber(player.insurance.expense ?? player.insurance.monthlyExpense ?? player.insurance.amount));
}

/* Returns [agreed total price, assumed mortgage, cash settlement].  A new
   player-to-player property sale is only valid when the agreed value is
   strictly above the mortgage. */
function propertyTransferSettlement(totalPrice, mortgage){
  const total = assetNumber(totalPrice);
  const debt = Math.max(0, assetNumber(mortgage));
  if(total <= debt) return null;
  return [total, debt, total - debt];
}

function bankruptcy202Breakdown(player){
  const rows = [];
  const add = (kind, id, name, basis) => {
    const safeBasis = Math.max(0, assetNumber(basis));
    rows.push({kind, id, name, basis:safeBasis, proceeds:safeBasis / 2});
  };
  (player?.props || []).forEach(asset => add("property", asset.id, asset.name || "Недвижимость", asset.down));
  (player?.stocks || []).forEach(asset => add("stock", asset.id, asset.symbol || "Акции",
    assetNumber(asset.qty) * assetNumber(asset.price)));
  (player?.options || []).forEach(asset => add("option", asset.id,
    (asset.type === "put" ? "PUT " : "CALL ") + (asset.symbol || "Опцион"),
    asset.premiumTotal ?? assetNumber(asset.premiumPerShare) * assetNumber(asset.qty)));
  (player?.realEstateOptions || []).forEach(asset => add("real-estate-option", asset.id,
    "Опцион на недвижимость", asset.cost));
  (player?.otherAssets || []).filter(asset => asset.kind !== "royalty")
    .forEach(asset => add("other", asset.id, asset.name || "Прочий актив", asset.cost));
  return {rows, total:rows.reduce((sum, row) => sum + row.proceeds, 0)};
}

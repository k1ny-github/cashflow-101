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

"use strict";

(function(root){
  function canEscape202(player){
    return Number(player?.passive) >= 2 * Number(player?.totalExpenses);
  }

  function hasWon202(player){
    const businesses = Array.isArray(player?.ft?.businesses) ? player.ft.businesses : [];
    const growth = Number.isFinite(Number(player?.businessIncomeGrowth))
      ? Number(player.businessIncomeGrowth)
      : businesses.reduce((sum, business) => sum + (Number(business?.cashflow) || 0), 0);
    const dreams = Array.isArray(player?.otherDreams)
      ? player.otherDreams
      : Array.isArray(player?.ft?.otherDreams) ? player.ft.otherDreams : [];
    const distinctDreams = new Set(dreams.filter(dream => dream?.kind !== "legacy-selected").map((dream, index) =>
      dream?.fieldId ?? dream?.id ?? dream?.ownerId ?? dream?.name ?? index));
    const dreamGoal = !!player?.dream?.bought || distinctDreams.size >= 2;
    return growth >= 50000 && dreamGoal;
  }

  function fastTrackBusinessPrice(business){
    const basePrice = Number(business?.basePrice ?? business?.price ?? business?.down) || 0;
    const ownershipTokens = Number(business?.ownershipTokens ?? business?.tokens ?? 1) || 1;
    return basePrice * Math.max(1, ownershipTokens);
  }

  root.canEscape202 = canEscape202;
  root.hasWon202 = hasWon202;
  root.fastTrackBusinessPrice = fastTrackBusinessPrice;
  if(typeof module !== "undefined" && module.exports){
    module.exports = {canEscape202, hasWon202, fastTrackBusinessPrice};
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

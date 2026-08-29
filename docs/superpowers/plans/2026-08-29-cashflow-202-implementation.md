# Cashflow 202 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Добавить официальную надстройку Cashflow 202 и Custom-срок опционов, не изменив результаты существующих партий Cashflow 101.

**Architecture:** Сохранить событийный движок и разделить общие правила, правила 101 и правила 202 на небольшие модули. Сохранение версии 2 хранит режим и настройки отдельно от неизменяемого журнала; старый формат мигрирует в 101 при чтении. Интерфейс остаётся статическим vanilla JavaScript-приложением для GitHub Pages.

**Tech Stack:** HTML5, CSS, vanilla JavaScript без сборки, Node.js `node:test`, localStorage, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-29-cashflow-202-design.md`

## Global Constraints

- Старое сохранение без `mode` всегда читается как Cashflow 101 без изменения событий.
- Режим начатой партии не переключается.
- Cashflow 202 Standard: 3 тура, строгие лоты 100–5000.
- Cashflow 202 Custom: срок задаётся перед игрой, нарушение лота требует подтверждения.
- Синхронизация устройств не добавляется.
- Любое новое действие записывается событием и отменяется удалением этого события.
- GitHub Pages остаётся без сборки и внешних runtime-зависимостей.

---

### Task 1: Тестовый каркас и версия сохранения

**Files:**
- Create: `tests/helpers.js`
- Create: `tests/save.test.js`
- Create: `save.js`
- Modify: `index.html`
- Modify: `ui.js`

**Interfaces:**
- Produces: `normalizeGameSave(raw) -> GameSaveV2`, `serializeGameSave(game) -> string`.
- `GameSaveV2`: `{schemaVersion, mode, settings, events, current}`.

- [ ] **Step 1: Write the failing migration tests**

```js
test("legacy save migrates to 101", () => {
  const save = normalizeGameSave({events:[{type:"ADD_PLAYER"}], current:"p1"});
  assert.equal(save.mode, "101");
  assert.equal(save.schemaVersion, 2);
  assert.deepEqual(save.events, [{type:"ADD_PLAYER"}]);
});
```

- [ ] **Step 2: Run the test and verify `normalizeGameSave` is missing**

Run: `node --test tests/save.test.js`

- [ ] **Step 3: Implement normalization and serialization in `save.js`**

```js
function normalizeGameSave(raw){
  const mode = ["101","202-standard","202-custom"].includes(raw && raw.mode) ? raw.mode : "101";
  return {
    schemaVersion: 2,
    mode,
    settings: mode === "202-custom"
      ? {optionRounds: Math.max(1, Number(raw.settings?.optionRounds) || 3), strictLots:false}
      : {optionRounds:3, strictLots:mode === "202-standard"},
    events: Array.isArray(raw?.events) ? raw.events : [],
    current: raw?.current || null
  };
}
```

- [ ] **Step 4: Wire localStorage/import/export through the normalizer**

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/save.test.js`

Commit: `test: зафиксировать миграцию сохранений`

### Task 2: Регрессия и исправления Cashflow 101

**Files:**
- Create: `tests/engine101.test.js`
- Modify: `engine.js`
- Modify: `ui.js`

**Interfaces:**
- Consumes: существующие `reduceEvents`, `derive`, `deriveFT`.
- Produces: `validatePositiveMoney(value, label)`, глобальное событие `MARKET_SPLIT`.

- [ ] **Step 1: Port the existing 101 examples into `node:test`**

```js
test("doctor starts with cashflow plus savings", () => {
  const p = game([{type:"ADD_PLAYER",playerId:"p",name:"Марк",professionId:"doctor"}]).players[0];
  assert.equal(derive(p).cashflow, 3550);
  assert.equal(p.cash, 3950);
});
```

- [ ] **Step 2: Add failing tests for global split and legacy replay**

```js
test("market split adjusts every holder", () => {
  const s = game(twoHolders.concat({type:"MARKET_SPLIT",symbol:"OK4U",ratio:2}));
  assert.deepEqual(s.players.map(p=>p.stocks[0].qty), [200,400]);
});
```

- [ ] **Step 3: Implement global split while preserving old `SPLIT` events**

- [ ] **Step 4: Add UI validation for negative values and insufficient cash**

Purchases unavailable on the Fast Track and debt repayments must fail before appending an event when cash is insufficient. Rat Race purchases may direct the player to take a bank loan first.

- [ ] **Step 5: Prevent dream replacement after the game starts or tokens exist**

- [ ] **Step 6: Run the complete 101 suite and commit**

Run: `node --test tests/engine101.test.js tests/save.test.js`

Commit: `fix: закрыть ошибки расчётов Cashflow 101`

### Task 3: Режимы новой партии

**Files:**
- Create: `game-config.js`
- Create: `tests/config.test.js`
- Modify: `save.js`
- Modify: `tests/save.test.js`
- Modify: `engine.js`
- Modify: `index.html`
- Modify: `ui.js`

**Interfaces:**
- Produces: `createGameConfig(mode, input)`, `is202(config)`, `optionRoundLimit(config)`.
- Extends `ADD_PLAYER` with an atomic snapshot of profession, selected Dream and
  `initialPortfolio: {cash, stocks, properties, otherAssets, otherLiabilities}`.
- Extends `GameSaveV2` with temporary `setupPortfolio` while keeping the same
  localStorage key and `schemaVersion: 2`.

- [ ] **Step 1: Write failing configuration tests**

```js
test("standard is fixed at three strict rounds", () => {
  assert.deepEqual(createGameConfig("202-standard", {optionRounds:9}), {
    mode:"202-standard", settings:{optionRounds:3, strictLots:true}
  });
});
```

- [ ] **Step 2: Implement the configuration helpers**

- [ ] **Step 3: Add the pre-game selector and Custom round field**

The selector locks after the first `ADD_PLAYER` event. Existing games show 101 without prompting.

- [ ] **Step 4: Add the Cashflow 202 initial-portfolio setup step**

The step appears only in 202 and supports repeated stock, real-estate/business,
other-asset and other-liability rows. Stock fields are symbol, quantity, price
and dividend. Property fields are name, price, down payment, explicit mortgage
and monthly cashflow. Other assets contain name, cost and monthly income; other
liabilities contain name, balance and monthly expense.

The engine expands the portfolio atomically when applying `ADD_PLAYER`; all
created holdings carry `source:"initial-portfolio"`. No purchase events are
created for these entries. The card's down payment is recorded as invested
capital and is not deducted from cash a second time. Mortgage defaults to
`price - down`, but an explicitly entered mortgage is authoritative. Negative
starting-asset cashflow is valid and must not be clamped.

Starting cash equals profession cashflow after adding portfolio income and
portfolio expenses, plus profession savings and portfolio cash. The complete
profession snapshot, portfolio and selected Dream are stored in the single
`ADD_PLAYER` event.

```js
test("202 starting cash includes portfolio cash and passive income", () => {
  const p = game202([{type:"ADD_PLAYER", playerId:"p", professionId:"nurse",
    initialPortfolio:{cash:500, stocks:[], properties:[
      {name:"Дом", price:65000, down:8000, mortgage:57000, cashflow:300}
    ]}}]).players[0];
  assert.equal(p.cash, 2400); // 1120 + 300 cashflow + 480 savings + 500 cash
});
```

Add tests for negative portfolio cashflow, an explicit mortgage differing
from `price - down`, other assets/liabilities, source tags, atomic Dream and
the absence of purchase events.

- [ ] **Step 5: Make the setup draft lossless and reload-safe**

Update portfolio cash on every `input`, read it directly from the field again
immediately before adding the player, and save the draft after every change.
Changing profession must preserve a non-empty portfolio unless the user
explicitly confirms clearing it. Reload/import/export retain `mode`,
`settings`, `events`, `current` and temporary `setupPortfolio`.

- [ ] **Step 6: Render the active mode in the header/menu**

- [ ] **Step 7: Run tests and commit**

Commit: `feat: добавить режимы 101 и 202`

### Task 4: Биржевые опционы, цены and короткие позиции

**Files:**
- Create: `market202.js`
- Create: `tests/market202.test.js`
- Modify: `engine.js`
- Modify: `ui.js`
- Modify: `index.html`

**Interfaces:**
- Produces: `optionPayout(option, marketPrice)`, `shortResult(position, marketPrice)`, `validateLot(qty, strict)`, `marketEffects(state, symbol, price)`.
- New events: `BUY_OPTION`, `ADJUST_OPTION_ROUNDS`, `EXERCISE_OPTION`,
  `MARKET_PRICE`, `MARKET_SPLIT`, `COMPANY_BANKRUPTCY`, `OPEN_SHORT`,
  `CLOSE_SHORT`. Legacy `OPTION_ROUND` remains replay-only.

New `BUY_OPTION` stores `premiumPerShare` and `premiumTotal`; a legacy
`BUY_OPTION.premium` is interpreted as the already-total premium so old games
do not change.

- [ ] **Step 1: Write failing tests for call, put, straddle and premium**

```js
test("call payout excludes the premium already paid", () => {
  assert.equal(optionPayout({type:"call", strike:20, qty:200}, 40), 4000);
});
test("put payout follows the book example", () => {
  assert.equal(optionPayout({type:"put", strike:30, qty:200}, 20), 2000);
});
```

- [ ] **Step 2: Write failing tests for three rounds and Custom rounds**

At `remaining:1`, a new per-option `ADJUST_OPTION_ROUNDS` decrement makes that
option inactive. Removing the adjustment event restores it. Incrementing by
one repairs an accidental manual decrement. Legacy `OPTION_ROUND` is tested
only for unchanged replay.

- [ ] **Step 3: Write failing tests for short profit, loss and mandatory close**

- [ ] **Step 4: Implement pure market calculations in `market202.js`**

Standard accepts only OK4U/MYT4U and quantities 100–5000 in steps of 100.
Custom uses its configured duration and allows a nonstandard lot only after a
visible confirmation. Premium is labeled per share and acquisition deducts
`qty * premiumPerShare` exactly once. Calls and puts pay intrinsic value only;
premium is neither deducted nor returned at exercise. New options cannot be
opened on the Fast Track.

- [ ] **Step 5: Apply market events atomically to all players**

A global price event exposes profitable active options, ordinary stock and
shorts that must close. A 2:1 split adjusts every player's stocks, options and
shorts, doubling quantities and halving price, strike and per-share premium.
A reverse split performs the inverse with one documented integer rule for odd
quantities. Company bankruptcy zeroes stock and calls while puts and shorts
settle against market price 0; all affected players are previewed before the
event is confirmed.

Opening a short stores symbol, quantity and opening price. Sale proceeds stay
in a bank envelope and never increase free cash. The next matching market
price requires close with `qty * (openPrice - buybackPrice)`. A short loss may
not use a bank loan; offer asset sale or personal bankruptcy instead.

- [ ] **Step 6: Add `Инструменты 202` cards and market dialogs**

Each option shows call/put, ticker, premium, strike, quantity, remaining rounds, `−1`, `+1`, and contextual exercise action. Each short shows entry price and the next matching market event requires close confirmation.
Profit is green, a final option round is yellow, and expiry or mandatory short
closure is red.

- [ ] **Step 7: Run tests and commit**

Run: `node --test tests/market202.test.js tests/engine101.test.js`

Commit: `feat: добавить опционы и короткие позиции 202`

### Task 5: Недвижимость, D2Y, страховка и банкротство 202

**Files:**
- Create: `assets202.js`
- Create: `tests/assets202.test.js`
- Modify: `engine.js`
- Modify: `ui.js`

**Interfaces:**
- Produces: `d2yIncome(cards)`, `splitLand(asset, acresSold, salePrice)`, `insuranceExpense(player)`.
- New events: `BUY_REAL_ESTATE_OPTION`, `RESOLVE_REAL_ESTATE_OPTION`, `TRANSFER_202_ASSET`, `ADD_D2Y`, `BUY_INSURANCE`, `SPLIT_LAND`, `EXCHANGE_PROPERTY`, `DECLARE_202_BANKRUPTCY`, `UPDATE_OWNED_CARD`.
- Cross-mode expense events: `ADD_OTHER_EXPENSE`, `END_OTHER_EXPENSE`.

- [ ] **Step 1: Write failing tests for real-estate option priority and expiry**

The option applies to the next real-estate card. Multiple holders resolve in
purchase order. A holder buys the object, sells the option to another player
who must use it immediately, or refuses and loses the option.

- [ ] **Step 2: Write failing tests for D2Y card limits and income activation**

```js
test("D2Y 3 pays only with 1 and at least one 2", () => {
  assert.equal(d2yIncome([{number:3,income:5000}]), 0);
  assert.equal(d2yIncome([{number:1},{number:2,income:1000},{number:3,income:5000}]), 6000);
});
```

- [ ] **Step 3: Write failing tests for insurance, land split and exchange**

Insurance is a permanent monthly expense and protects all real estate,
including jointly held property; insured loss is a separate event. Land may
be split only when its mortgage has first been fully repaid, then remaining
area and book value reduce proportionally and obsolete cashflow is removed
when the card says so. Exchange atomically replaces property with the same
type, removes old mortgage/cashflow, writes the new values and moves no cash.
Also test `Прочий расход`: `once` reduces cash exactly once, while `monthly`
creates a named recurring expense that reduces every derived monthly cashflow
without an immediate duplicate cash charge. Ending the recurring expense is a
separate reversible journal event.

- [ ] **Step 4: Write failing tests for 202 bankruptcy restrictions**

202 personal bankruptcy sells permitted assets to the Bank, directs proceeds
to bank credit first, writes off the uncovered remainder, applies three
skipped turns, and blocks credit for deals while retaining it only for
mandatory costs and downsizing. D2Y and royalties are excluded. Keep the 101
procedure separately testable and do not reinterpret old journals.

- [ ] **Step 5: Implement the asset calculations and events**

Player-to-player deals may transfer real estate, royalties and an unused real
estate option, but not shares, stock options, shorts or D2Y. The seller's bank
loan never transfers. D2Y #1 and #3 are limited to one, #2 is unlimited; #2
income requires #1 and #3 income requires #1 plus at least one #2. D2Y cannot
be transferred or sold in bankruptcy.

- [ ] **Step 6: Add focused UI forms and report rows**

У каждой принадлежащей игроку карточки актива есть действие `Изменить`.
Для недвижимости и бизнеса редактируются название, цена, первый взнос,
ипотека и денежный поток; для акций — символ, количество, цена и дивиденд;
для прочих активов и пассивов — их финансовые поля. Изменение хранится
отдельным событием `UPDATE_OWNED_CARD`, поэтому удаление этой строки журнала
возвращает прежние данные. Биржевые опционы, шорты и срок их действия через
эту общую форму не редактируются — для них остаются специализированные действия.

The `Прочий расход` form is available in both 101 and 202 and asks whether the
expense is one-time or monthly. A monthly expense appears as its own report
row, can be edited as an owned expense card, and can be ended without deleting
its history; deleting the end event restores it.

- [ ] **Step 7: Run tests and commit**

Commit: `feat: добавить стратегии активов Cashflow 202`

### Task 6: Скоростная дорожка 202

**Files:**
- Create: `fast-track202.js`
- Create: `tests/fast-track202.test.js`
- Modify: `engine.js`
- Modify: `ui.js`

**Interfaces:**
- Produces: `canEscape202(player)`, `hasWon202(player)`, `fastTrackBusinessPrice(business)`.
- New events: `FT_BUY_OTHER_DREAM`, `FT_TRANSFER_BUSINESS`, `FT_ADD_FRANCHISE`.

- [ ] **Step 1: Write failing exit-condition tests**

```js
test("202 requires passive income at least twice expenses", () => {
  assert.equal(canEscape202({passive:1999,totalExpenses:1000}), false);
  assert.equal(canEscape202({passive:2000,totalExpenses:1000}), true);
});
```

- [ ] **Step 2: Write failing tests for both official victory paths**

Neither +50,000 alone nor dreams alone wins. +50,000 plus own dream wins; +50,000 plus two other dreams wins.

- [ ] **Step 3: Write failing tests for business resale multiplier and franchise**

Fast Track businesses store base price, cashflow, ownership tokens and
franchises. Purchase uses full price. Another player's landing forces a sale
at the token-adjusted price. An owner landing again may create at most one
franchise during that turn.

- [ ] **Step 4: Implement the pure calculations and events**

In 202 entry closes the Rat Race report and tools. In 101 retain the existing
escape condition and result. The 202 victory condition is an AND: business
income growth of at least $50,000 plus either the player's selected Dream or
two distinct unselected Dreams.

- [ ] **Step 5: Add Fast Track UI for unselected dreams, resale and franchise**

`Купить мечту` opens a first choice between `Моя мечта` and `Другая мечта`.
Other Dreams are stored as a list; the same board field cannot be sold twice,
and buying more than two distinct other Dreams remains allowed.
Another player's selected Dream can receive a token but can never be bought.
Only the owner may buy a selected Dream, for `base * (1 + foreignTokens)`.
An unselected Dream is purchased by the first player who lands there and then
becomes unavailable table-wide. Keep the house-rule Fast Track charity at
$100,000 with selectable 1, 2 or 3 dice through the end of the game.

- [ ] **Step 6: Run tests and commit**

Commit: `feat: реализовать Скоростную дорожку 202`

### Task 7: Интеграция, доступность и документация

**Files:**
- Create: `tests/integration.test.js`
- Modify: `index.html`
- Modify: `ui.js`
- Modify: `README.md`

**Interfaces:**
- Consumes all previous modules and events.
- Produces a single deployable static application.

- [ ] **Step 1: Write an end-to-end event-log test for each mode**

The 101 fixture must equal its pre-change report. Standard must expire at 3;
Custom at its configured limit. Import/export round-trips mode, settings,
events, current and unfinished setupPortfolio. A damaged event keeps the game
loadable but produces a clear warning with its operation number instead of
being swallowed silently.

- [ ] **Step 2: Add versioned script tags and update `APP_VERSION`**

- [ ] **Step 3: Verify all forms at 375px viewport**

Check setup, option cards, market modal, short close, property option, D2Y and Fast Track victory without clipped controls or horizontal scrolling.

Cashflow 101 hides every 202 control. The header updates mode immediately.
Before each financial operation show resulting cash and monthly-flow change;
fix labels and word forms, especially down payment versus mortgage. Include
the owned-card edit and undo flow in desktop and mobile checks.

- [ ] **Step 4: Update README with official 202 behavior and limitations**

Document the official rules, the $100,000 charity house rule, lack of
multi-device synchronization, and that unsupported physical cards remain
manual rather than coming from a complete card database.

- [ ] **Step 5: Run syntax, unit and integration checks**

Run: `node --check *.js`

Run: `node --test tests/*.test.js`

- [ ] **Step 6: Commit**

Commit: `docs: описать режимы и правила Cashflow 202`

### Task 8: Финальная проверка без публикации

**Files:**
- Modify only if verification reveals a defect.

- [ ] **Step 1: Replay a legacy production save and compare every 101 total**

- [ ] **Step 2: Run the full automated suite from a clean checkout**

- [ ] **Step 3: Test the local application in the browser at mobile and desktop widths**

- [ ] **Step 4: Review the diff for unrelated or destructive changes**

- [ ] **Step 5: Stop with the verified isolated branch and present release options**

Do not merge, push or publish as part of implementation. Those are separate
side effects to perform only after the user chooses the release option.

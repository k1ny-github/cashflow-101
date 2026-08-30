"use strict";

/* ============================================================
   ИНТЕРФЕЙС
   ============================================================ */

const KEY = "cashflow-bankir-v1";

/* Версия приложения. При каждом обновлении сайта поднимай её здесь И в номерах
   ?v= у всех локальных тегов script в index.html — иначе браузер до десяти минут будет
   показывать старые файлы из кэша (GitHub Pages отдаёт Cache-Control: max-age=600). */
const APP_VERSION = "6 — 30 августа 2026";

let G = { mode: "101", settings: {optionRounds:3, strictLots:false}, events: [], current: null, screen: "setup" };
let S = { players: [] };            // производное состояние

/* ---------- мелочи ---------- */

const $ = sel => document.querySelector(sel);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function money(n){
  const v = Math.round(n);
  const s = Math.abs(v).toLocaleString("ru-RU");
  return (v < 0 ? "−$" : "$") + s;
}
function signed(n){
  const v = Math.round(n);
  return (v > 0 ? "+" : v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("ru-RU");
}
function cls(n){ return n > 0 ? "pos" : n < 0 ? "neg" : ""; }

function counted(n, one, few, many){
  const value = Math.abs(Math.trunc(Number(n) || 0));
  const lastTwo = value % 100;
  const last = value % 10;
  const word = lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
  return value + " " + word;
}

function validatePositiveMoney(value, label, allowZero){
  if(!Number.isFinite(value) || value < 0 || (!allowZero && value === 0)){
    return label + ": укажи положительное число";
  }
  return null;
}

function validateAvailableCash(p, amount){
  if(p.cash >= amount) return null;
  return p.ft
    ? "Наличными не хватает — кредит на дорожке недоступен."
    : "Наличными не хватает — сначала возьми кредит.";
}

function player(){ return S.players.find(p => p.id === G.current) || null; }

function modeTitle(mode){
  return mode === "202-standard" ? "Cashflow 202 Standard" :
    mode === "202-custom" ? "Cashflow 202 Custom" : "Cashflow 101";
}

function emptyPortfolioDraft(){
  return {cash:"", dream:{name:"", price:""}, stocks:[], properties:[], otherAssets:[], otherLiabilities:[]};
}

function finiteInput(value){
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function portfolioForEvent(draft){
  const rows = (key, fields) => (Array.isArray(draft?.[key]) ? draft[key] : []).map(row => {
    const out = {};
    fields.forEach(field => out[field] = field === "name" || field === "symbol"
      ? String(row[field] || "").trim()
      : finiteInput(row[field]));
    return out;
  });
  return {
    cash: finiteInput(draft?.cash),
    stocks: rows("stocks", ["symbol", "qty", "price", "div"]),
    properties: (Array.isArray(draft?.properties) ? draft.properties : []).map(row => {
      const property = {
        name:String(row.name || "").trim(), price:finiteInput(row.price), down:finiteInput(row.down),
        cashflow:finiteInput(row.cashflow)
      };
      if(String(row.mortgage ?? "").trim() !== "") property.mortgage = finiteInput(row.mortgage);
      return property;
    }),
    otherAssets: (Array.isArray(draft?.otherAssets) ? draft.otherAssets : []).map(row => ({
      name:String(row.name || "").trim(), kind:row.kind === "royalty" ? "royalty" : "other",
      cost:finiteInput(row.cost), income:finiteInput(row.income)
    })),
    otherLiabilities: rows("otherLiabilities", ["name", "balance", "expense"])
  };
}

function buildAddPlayerEvent(mode, input){
  const prof = PROFESSIONS.find(p => p.id === input.professionId);
  if(!prof) return null;
  const event = {
    type:"ADD_PLAYER", playerId:input.playerId, name:input.name, professionId:prof.id,
    label:"В игру вошёл " + input.name + " — " + prof.title
  };
  if(is202({mode})){
    event.profession = JSON.parse(JSON.stringify(prof));
    event.dream = {name:input.dream.name, price:input.dream.price};
    event.initialPortfolio = portfolioForEvent(input.portfolio);
  }
  return event;
}

function portfolioRow(kind, row, index = 0){
  const controlId = key => "np-portfolio-" + kind + "-" + index + "-" + key;
  const field = (key, label, options) => '<div class="f"><label for="' + controlId(key) + '">' + label +
    '</label><input id="' + controlId(key) + '" data-portfolio-field="' + key +
    '" type="' + (options?.text ? "text" : "number") + '"' +
    (options?.text ? "" : ' step="1" inputmode="numeric"') +
    ' value="' + esc(row[key] ?? "") + '"' + (options?.placeholder ? ' placeholder="' + esc(options.placeholder) + '"' : "") + "></div>";
  const fields = kind === "stocks"
    ? field("symbol", "Символ", {text:true, placeholder:"OK4U"}) + field("qty", "Количество") + field("price", "Цена, $") + field("div", "Дивиденд / мес, $")
    : kind === "properties"
      ? field("name", "Название", {text:true}) + field("price", "Цена, $") + field("down", "Первоначальный взнос, $") + field("mortgage", "Ипотека, $ (необязательно)") + field("cashflow", "Денежный поток / мес, $")
      : kind === "otherAssets"
        ? field("name", "Название", {text:true}) + '<div class="f"><label for="' + controlId("kind") +
          '">Вид актива</label><select id="' + controlId("kind") + '" data-portfolio-field="kind">' +
          '<option value="other"' + (row.kind === "royalty" ? "" : " selected") + '>Прочий актив</option>' +
          '<option value="royalty"' + (row.kind === "royalty" ? " selected" : "") + '>Роялти / авторский доход</option></select></div>' +
          field("cost", "Стоимость, $") + field("income", "Доход / мес, $")
        : field("name", "Название", {text:true}) + field("balance", "Остаток долга, $") + field("expense", "Расход / мес, $");
  return '<div class="card" data-portfolio-row="' + kind + '" style="padding:10px;margin:8px 0"><div class="big">' + fields +
    '</div><button class="btn danger" type="button" data-remove-portfolio>Удалить</button></div>';
}

function readPortfolioRows(kind){
  const ids = {stocks:"#np-stocks", properties:"#np-properties", otherAssets:"#np-other-assets", otherLiabilities:"#np-other-liabilities"};
  const keys = kind === "stocks" ? ["symbol", "qty", "price", "div"] :
    kind === "properties" ? ["name", "price", "down", "mortgage", "cashflow"] :
    kind === "otherAssets" ? ["name", "kind", "cost", "income"] : ["name", "balance", "expense"];
  return Array.from($(ids[kind]).querySelectorAll("[data-portfolio-row]")).map(row => {
    const item = {};
    keys.forEach(key => item[key] = row.querySelector('[data-portfolio-field="' + key + '"]').value);
    return item;
  });
}

function readSetupPortfolio(){
  return {
    cash: $("#np-portfolio-cash").value,
    dream:{name:$("#np-dream-name").value, price:$("#np-dream-price").value},
    stocks: readPortfolioRows("stocks"),
    properties: readPortfolioRows("properties"),
    otherAssets: readPortfolioRows("otherAssets"),
    otherLiabilities: readPortfolioRows("otherLiabilities")
  };
}

function captureSetupPortfolio(){
  if(!$("#np-portfolio")) return;
  G.setupPortfolio = readSetupPortfolio();
  save();
}

function renderPortfolioRows(){
  const draft = G.setupPortfolio || emptyPortfolioDraft();
  G.setupPortfolio = draft;
  $("#np-portfolio-cash").value = draft.cash ?? "";
  $("#np-dream-name").value = draft.dream?.name ?? "";
  $("#np-dream-price").value = draft.dream?.price ?? "";
  $("#np-stocks").innerHTML = (draft.stocks || []).map((row, index) => portfolioRow("stocks", row, index)).join("");
  $("#np-properties").innerHTML = (draft.properties || []).map((row, index) => portfolioRow("properties", row, index)).join("");
  $("#np-other-assets").innerHTML = (draft.otherAssets || []).map((row, index) => portfolioRow("otherAssets", row, index)).join("");
  $("#np-other-liabilities").innerHTML = (draft.otherLiabilities || []).map((row, index) => portfolioRow("otherLiabilities", row, index)).join("");
  $("#np-portfolio").querySelectorAll("input,select").forEach(el => el.addEventListener("input", captureSetupPortfolio));
  $("#np-portfolio").querySelectorAll("[data-remove-portfolio]").forEach(button => button.onclick = () => {
    const row = button.closest("[data-portfolio-row]");
    const kind = row.dataset.portfolioRow;
    const index = Array.from(row.parentElement.querySelectorAll("[data-portfolio-row]")).indexOf(row);
    captureSetupPortfolio();
    G.setupPortfolio[kind].splice(index, 1);
    save(); renderPortfolioRows();
  });
}

function validateSetupNumber(value, label, allowZero, allowEmpty){
  if(allowEmpty && String(value).trim() === "") return null;
  if(String(value).trim() === "") return label + ": укажи число";
  return validatePositiveMoney(Number(value), label, allowZero);
}

function validateSetupPortfolio(draft){
  let error = validateSetupNumber(draft.cash, "Наличные портфеля", true, true);
  if(error) return error;
  for(const stock of draft.stocks){
    if(!stock.symbol.trim()) return "Акции: укажи символ";
    error = validateSetupNumber(stock.qty, "Количество акций", false) ||
      validateSetupNumber(stock.price, "Цена акции", false) ||
      validateSetupNumber(stock.div, "Дивиденд", true);
    if(error) return error;
  }
  for(const property of draft.properties){
    if(!property.name.trim()) return "Недвижимость: укажи название";
    error = validateSetupNumber(property.price, "Цена объекта", false) ||
      validateSetupNumber(property.down, "Первый взнос", true) ||
      validateSetupNumber(property.mortgage, "Ипотека", true, true);
    if(error) return error;
    if(finiteInput(property.price) < finiteInput(property.down)) return "Цена объекта меньше первого взноса";
    if(String(property.cashflow).trim() === "" || !Number.isFinite(Number(property.cashflow))){
      return "Денежный поток: укажи число; отрицательное значение допустимо";
    }
  }
  for(const asset of draft.otherAssets){
    if(!asset.name.trim()) return "Прочий актив: укажи название";
    error = validateSetupNumber(asset.cost, "Стоимость актива", true) || validateSetupNumber(asset.income, "Доход актива", true);
    if(error) return error;
  }
  for(const liability of draft.otherLiabilities){
    if(!liability.name.trim()) return "Прочий пассив: укажи название";
    error = validateSetupNumber(liability.balance, "Остаток пассива", true) || validateSetupNumber(liability.expense, "Расход пассива", true);
    if(error) return error;
  }
  return null;
}

/* ---------- хранение ---------- */

function save(){
  try { localStorage.setItem(KEY, serializeGameSave(G)); }
  catch(e){ /* приватный режим — играем без автосохранения */ }
}
function load(){
  try {
    const raw = localStorage.getItem(KEY);
    if(!raw) return;
    const d = normalizeGameSave(JSON.parse(raw));
    G = {...d, screen: G.screen};
  } catch(e){ /* битое сохранение игнорируем */ }
}

function prepareImportedGame(raw){
  return {...normalizeGameSave(raw), screen:"table"};
}

function recompute(){
  S = reduceEvents(G.events, G);
  const mandatoryOwner = S.players.find(p => lockedShorts(p).length);
  const mandatoryOption = immediateRealEstateOption(S);
  if(mandatoryOwner) G.current = mandatoryOwner.id;
  else if(mandatoryOption) G.current = mandatoryOption.owner.id;
  else if(!S.players.some(p => p.id === G.current)) G.current = S.players.length ? S.players[0].id : null;
  G.screen = S.players.length ? (G.screen === "setup" ? "table" : G.screen) : "setup";
}

function push(ev){
  if(!eventAllowedDuringShortClose(S, ev)){
    alert("Сначала закрой обязательную короткую позицию по зафиксированной цене.");
    return;
  }
  if(!eventAllowedDuringImmediateOption(S, ev)){
    alert("Переданный опцион нужно разрешить немедленно.");
    return;
  }
  ev.id = uid();
  G.events.push(ev);
  save(); recompute(); render();
}

function removeEvent(id){
  const ev = G.events.find(e => e && e.id === id);
  if(!ev) return;
  if(ev.type === "ADD_PLAYER"){
    if(!confirm("Удалить игрока вместе со всеми его операциями?")) return;
    G.events = G.events.filter(e => !e || e.playerId !== ev.playerId);
  } else {
    G.events = G.events.filter(e => !e || e.id !== id);
  }
  save(); recompute(); render();
}

/* ---------- диалог с формой ---------- */

function openForm(cfg){
  const dlg = $("#dlg"), body = $("#dlg-body");
  const fields = cfg.fields || [];

  body.innerHTML =
    '<h3 id="dlg-title">' + esc(cfg.title) + "</h3>" +
    (cfg.intro ? '<p style="margin:-4px 0 12px;color:var(--muted);font-size:14px">' + cfg.intro + "</p>" : "") +
    fields.map(f => {
      const id = "f-" + f.k;
      if(f.type === "select"){
        return '<div class="f"><label for="' + id + '">' + esc(f.label) + "</label>" +
          '<select id="' + id + '" data-k="' + f.k + '">' +
          f.options.map(o => '<option value="' + esc(o.v) + '"' +
            (String(o.v) === String(f.value) ? " selected" : "") + '>' + esc(o.t) + "</option>").join("") +
          "</select>" + (f.hint ? '<div class="hint">' + f.hint + "</div>" : "") + "</div>";
      }
      const num = f.type !== "text";
      return '<div class="f"><label for="' + id + '">' + esc(f.label) + "</label>" +
        '<input id="' + id + '" data-k="' + f.k + '" type="' + (num ? "number" : "text") + '"' +
        (num ? ' inputmode="numeric" step="' + (f.step || 1) + '"' : "") +
        ' value="' + (f.value !== undefined ? esc(f.value) : "") + '"' +
        (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : "") + ">" +
        (f.hint ? '<div class="hint">' + f.hint + "</div>" : "") + "</div>";
    }).join("") +
    '<div class="prev" id="dlg-prev"></div>' +
    '<div class="dlg-btns">' +
      '<button class="btn" id="dlg-cancel">Отмена</button>' +
      '<button class="btn primary" id="dlg-ok">' + esc(cfg.ok || "Записать") + "</button>" +
    "</div>";

  const read = () => {
    const v = {};
    for(const f of fields){
      const el = body.querySelector('[data-k="' + f.k + '"]');
      v[f.k] = f.type === "text" || f.type === "select" ? el.value : Number(el.value || 0);
    }
    return v;
  };

  const refresh = () => {
    $("#dlg-prev").innerHTML = cfg.preview ? cfg.preview(read()) : "";
  };

  body.querySelectorAll("input,select").forEach(el => {
    el.addEventListener("input", refresh);
    el.addEventListener("change", refresh);
  });
  refresh();

  $("#dlg-cancel").onclick = () => dlg.close();
  $("#dlg-ok").onclick = () => {
    const v = read();
    const err = cfg.validate ? cfg.validate(v) : null;
    if(err){ alert(err); return; }
    dlg.close();
    cfg.submit(v);
  };
  dlg.showModal();
}

/* Предпросмотр «было → стало» для наличных и потока. */
function deltaPreview(p, dCash, dFlow, beforeOverride, insufficientHint){
  const showFlowTotal = beforeOverride !== null;
  const before = showFlowTotal
    ? (beforeOverride === undefined ? (p.ft ? deriveFT(p).income : derive(p).cashflow) : beforeOverride)
    : 0;
  const after = before + (dFlow || 0);
  let h = '<div class="row"><span class="k">Наличные</span><span class="v">' +
    money(p.cash) + " → <b class=\"" + cls(p.cash + dCash) + "\">" + money(p.cash + dCash) + "</b></span></div>";
  if(dFlow !== undefined && dFlow !== null){
    h += '<div class="row"><span class="k">Изменение за месяц</span><span class="v ' + cls(dFlow) + '">' +
      signed(dFlow) + "/мес</span></div>";
    if(showFlowTotal){
      h += '<div class="row"><span class="k">' + (p.ft ? "Доход в День CASHFLOW" : "Денежный поток") +
        '</span><span class="v">' + money(before) + " → <b class=\"" + cls(after) + "\">" + money(after) + "</b></span></div>";
    }
  }
  if(p.cash + dCash < 0 && insufficientHint !== ""){
    const hint = insufficientHint || (p.ft
      ? "Наличных не хватает — операция на дорожке недоступна"
      : "Наличных не хватает — понадобится кредит");
    h += '<div class="row"><span class="k" style="color:var(--bad)">' + hint + '</span><span class="v"></span></div>';
  }
  return h;
}

/* ---------- действия ---------- */

function actPayday(p){
  const d = derive(p);
  openForm({
    title: "Получка", ok: "Получить",
    preview: () => deltaPreview(p, d.cashflow, 0),
    submit: () => push({type:"PAYDAY", playerId:p.id, label:"Получка " + signed(d.cashflow)})
  });
}

function actBuyStock(p){
  openForm({
    title: "Покупка акций, фондов, депозитов",
    intro: "Оплачивается полностью наличными.",
    fields: [
      {k:"symbol", type:"text", label:"Символ или название", placeholder:"OK4U"},
      {k:"price",  label:"Цена за акцию, $", value:0},
      {k:"qty",    label:"Количество", value:0},
      {k:"div",    label:"Дивиденд на акцию в месяц, $", value:0,
       hint:"Если карточка не платит дивиденды — оставь ноль."}
    ],
    validate: v => (!v.symbol.trim() ? "Укажи символ" :
      validatePositiveMoney(v.price, "Цена") ||
      validatePositiveMoney(v.qty, "Количество") ||
      validatePositiveMoney(v.div, "Дивиденд", true) ||
      (p.cash < v.price * v.qty ? "Наличными не хватает — сначала возьми кредит." : null)),
    preview: v => '<div class="row"><span class="k">Стоимость покупки</span><span class="v">' +
        money(v.price * v.qty) + "</span></div>" + deltaPreview(p, -v.price * v.qty, v.div * v.qty),
    submit: v => push({type:"BUY_STOCK", playerId:p.id, assetId:uid(),
      symbol:v.symbol.trim(), price:v.price, qty:v.qty, div:v.div,
      label:"Куплено " + v.qty + " × " + v.symbol.trim() + " по " + money(v.price)})
  });
}

function actBuyProp(p, kind){
  const isBiz = kind === "business";
  const landFields = !isBiz && is202(G) ? [
    {k:"assetKind", type:"select", label:"Тип объекта", options:[
      {v:"property", t:"Недвижимость"}, {v:"land", t:"Земельный участок"}
    ]},
    {k:"acres", label:"Площадь участка, акров", value:0,
      hint:"Для обычной недвижимости оставь ноль."},
    {k:"removeCashflow", type:"select", label:"Поток после продажи части земли", options:[
      {v:"keep", t:"Сохраняется"}, {v:"remove", t:"Удаляется по карточке"}
    ]}
  ] : [];
  openForm({
    title: isBiz ? "Покупка бизнеса" : "Покупка недвижимости",
    intro: "Наличными платится только первоначальный взнос. Ипотека — это цена минус первоначальный взнос; её выплаты уже учтены в денежном потоке карточки.",
    fields: [
      {k:"name",     type:"text", label:"Название", placeholder: isBiz ? "Автомойка" : "Дом 3/2"},
      {k:"down",     label:"Первоначальный взнос, $", value:0},
      {k:"price",    label:"Цена, $", value:0},
      {k:"cashflow", label:"Денежный поток в месяц, $", value:0},
      ...landFields
    ],
    validate: v => (!v.name.trim() ? "Укажи название" :
      validatePositiveMoney(v.down, "Первоначальный взнос", true) ||
      validatePositiveMoney(v.price, "Цена") ||
      (!Number.isFinite(v.cashflow) ? "Денежный поток: укажи число" : null) ||
      (v.price < v.down ? "Цена меньше первоначального взноса" : null) ||
      (v.assetKind === "land" ? validatePositiveMoney(v.acres, "Площадь участка") : null) ||
      (p.cash < v.down ? "Наличными не хватает — сначала возьми кредит." : null)),
    preview: v => '<div class="row"><span class="k">Ипотека (пассив)</span><span class="v">' +
        money(v.price - v.down) + "</span></div>" +
        '<div class="row"><span class="k">ROI за год</span><span class="v">' +
        (v.down > 0 ? Math.round(v.cashflow * 12 / v.down * 100) + " %" : "—") + "</span></div>" +
        deltaPreview(p, -v.down, v.cashflow),
    submit: v => push({type:"BUY_PROPERTY", playerId:p.id, assetId:uid(), kind:v.assetKind || kind,
      name:v.name.trim(), down:v.down, price:v.price, cashflow:v.cashflow,
      ...(v.assetKind === "land" ? {acres:v.acres, removeCashflowOnSplit:v.removeCashflow === "remove"} : {}),
      label:(isBiz ? "Куплен бизнес " : "Куплена недвижимость ") + v.name.trim() +
            " (взнос " + money(v.down) + ", поток " + signed(v.cashflow) + ")"})
  });
}

function actSell(p){
  const opts = []
    .concat(p.stocks.map(h => ({v:"s:" + h.id, t:h.symbol + " — " + h.qty + " шт по " + money(h.price)})))
    .concat(p.props.map(a => ({v:"p:" + a.id, t:a.name + " — ипотека " + money(a.mortgage)})));
  if(!opts.length){ alert("Продавать пока нечего."); return; }

  openForm({
    title: "Продажа актива",
    fields: [
      {k:"sel", type:"select", label:"Что продаём", options:opts},
      {k:"price", label:"Цена продажи, $", value:0, hint:"Для акций — цена за одну акцию."},
      {k:"qty", label:"Количество (для акций)", value:0, hint:"Ноль или больше остатка — продаём всё."}
    ],
    preview: v => {
      const [t, id] = v.sel.split(":");
      if(t === "s"){
        const h = p.stocks.find(x => x.id === id); if(!h) return "";
        const qty = v.qty > 0 ? Math.min(v.qty, h.qty) : h.qty;
        return '<div class="row"><span class="k">Объём продаж</span><span class="v">' +
          qty + " × " + money(v.price) + " = " + money(qty * v.price) + "</span></div>" +
          deltaPreview(p, qty * v.price, -qty * h.div);
      }
      const a = p.props.find(x => x.id === id); if(!a) return "";
      const res = v.price - a.mortgage;
      return '<div class="row"><span class="k">Финансовый результат</span><span class="v">' +
        money(v.price) + " − " + money(a.mortgage) + " = <b class=\"" + cls(res) + "\">" + money(res) + "</b></span></div>" +
        deltaPreview(p, res, -a.cashflow);
    },
      validate: v => validatePositiveMoney(v.price, "Цена продажи") ||
        (v.qty < 0 ? "Количество не может быть отрицательным" : null),
      submit: v => {
      const [t, id] = v.sel.split(":");
      if(t === "s"){
        const h = p.stocks.find(x => x.id === id); if(!h) return;
        const qty = v.qty > 0 ? Math.min(v.qty, h.qty) : h.qty;
        push({type:"SELL_STOCK", playerId:p.id, assetId:id, qty, price:v.price,
          label:"Продано " + qty + " × " + h.symbol + " по " + money(v.price)});
      } else {
        const a = p.props.find(x => x.id === id); if(!a) return;
        push({type:"SELL_PROPERTY", playerId:p.id, assetId:id, price:v.price,
          label:"Продано: " + a.name + " за " + money(v.price)});
      }
    }
  });
}

function actSplit(p){
  const symbols = Array.from(new Set(S.players.flatMap(x => x.stocks.map(h => h.symbol))));
  if(!symbols.length){ alert("Нет акций."); return; }
  openForm({
    title: "Рыночное дробление акций",
    intro: "Изменит количество и цену этой бумаги у всех игроков, которые ей владеют.",
    fields: [
      {k:"symbol", type:"select", label:"Бумага",
       options:symbols.map(symbol => ({v:symbol, t:symbol}))},
      {k:"dir", type:"select", label:"Тип",
       options:[{v:"split", t:"Сплит 2:1 — акций вдвое больше"},
                {v:"reverse", t:"Обратный сплит 1:2 — акций вдвое меньше"}]}
      ],
      preview: v => {
        const ratio = v.dir === "split" ? 2 : 0.5;
        const holdings = S.players.flatMap(x => x.stocks.filter(h => h.symbol === v.symbol));
        return '<div class="row"><span class="k">Затронуто пакетов</span><span class="v">' +
          holdings.length + "</span></div>" + holdings.map(h =>
            '<div class="row"><span class="k">Станет</span><span class="v">' +
            (ratio < 1 ? Math.floor(h.qty * ratio) : h.qty * ratio) +
            " шт по " + money(h.price / ratio) + "</span></div>"
          ).join("");
      },
      submit: v => {
        push({type:"MARKET_SPLIT", playerId:p.id, symbol:v.symbol,
          ratio:v.dir === "split" ? 2 : 0.5,
          label:(v.dir === "split" ? "Сплит 2:1 — " : "Обратный сплит 1:2 — ") + v.symbol});
      }
  });
}

function actDoodad(p){
  openForm({
    title: "Всякая всячина",
    intro: "Отказаться нельзя. Если наличных мало — сначала возьми кредит.",
    fields: [
      {k:"title", type:"text", label:"Что купили", placeholder:"Новый катер"},
      {k:"amount", label:"Сумма, $", value:0}
    ],
    validate: v => validatePositiveMoney(v.amount, "Сумма") ||
      validateAvailableCash(p, v.amount),
    preview: v => deltaPreview(p, -v.amount, 0),
    submit: v => push({type:"DOODAD", playerId:p.id, amount:v.amount,
      label:"Всякая всячина: " + (v.title.trim() || "трата") + " " + money(-v.amount)})
  });
}

function actCharity(p){
  const sum = Math.round(derive(p).totalIncome * 0.1);
  openForm({
    title: "Благотворительность",
    intro: "10 % общего дохода. Даёт три хода с двумя костями.",
    preview: () => '<div class="row"><span class="k">Пожертвование</span><span class="v">' +
      money(sum) + "</span></div>" + deltaPreview(p, -sum, 0),
    submit: () => push({type:"CHARITY", playerId:p.id, label:"Благотворительность " + money(-sum)})
  });
}

function actChild(p){
  openForm({
    title: "Ребёнок",
    fields:[{k:"operation", type:"select", label:"Действие", options:
      (p.children < 3 ? [{v:"add", t:"Добавить ребёнка"}] : []).concat(
        p.children > 0 ? [{v:"remove", t:"Убрать ребёнка"}] : [])}],
    preview: v => {
      const add = v.operation === "add";
      const next = Math.max(0, p.children + (add ? 1 : -1));
      return '<div class="row"><span class="k">Детей станет</span><span class="v">' +
        next + "</span></div>" + deltaPreview(p, 0, add ? -p.perChild : p.perChild);
    },
    submit: v => push({type:v.operation === "add" ? "CHILD" : "REMOVE_CHILD", playerId:p.id,
      label:(v.operation === "add" ? "Добавлен ребёнок — расходы " + signed(-p.perChild) :
        "Убран ребёнок — расходы " + signed(p.perChild)) + "/мес"})
  });
}

function actDownsized(p){
  const sum = derive(p).totalExpenses;
  openForm({
    title: "Увольнение",
    intro: "Платишь банку сумму общего расхода и пропускаешь два хода. Привилегии благотворительности сгорают.",
    preview: () => deltaPreview(p, -sum, 0),
    submit: () => push({type:"DOWNSIZED", playerId:p.id, counterId:"skip-turns",
      counterName:"Пропуск ходов", label:"Увольнение " + money(-sum)})
  });
}

function actLoan(p){
  const fields = [{k:"amount", label:"Сумма, $", value:1000, step:1000}];
  if(p.creditRestricted){
    fields.push({k:"purpose", type:"select", label:"Разрешённая цель", options:[
      {v:"mandatory", t:"Обязательный расход"},
      {v:"downsized", t:"Увольнение"}
    ]});
  }
  openForm({
    title: "Кредит в банке",
    intro: p.creditRestricted
      ? "После личного банкротства кредит разрешён только на обязательные расходы и увольнение."
      : "Кратно $1000 под 10 % в месяц. Выплаты — только проценты, тело долга они не уменьшают.",
    fields,
    validate: v => (v.amount <= 0 || v.amount % 1000 !== 0 ? "Сумма должна быть кратна $1000" : null),
    preview: v => '<div class="row"><span class="k">Расход вырастет на</span><span class="v">' +
      money(v.amount * 0.1) + "/мес</span></div>" + deltaPreview(p, v.amount, -v.amount * 0.1),
    submit: v => push({type:"TAKE_LOAN", playerId:p.id, amount:v.amount, purpose:v.purpose,
      label:"Взят кредит " + money(v.amount)})
  });
}

function actRepay(p){
  const opts = DEBTS.filter(d => p.liabilities[d.k] > 0)
    .map(d => ({v:"d:" + d.k, t:d.n + " — " + money(p.liabilities[d.k]) + " (целиком)"}));
  if(p.bankLoan > 0) opts.unshift({v:"bank", t:"Кредит банка — " + money(p.bankLoan) + " (частями по $1000)"});
  if(!opts.length){ alert("Долгов нет."); return; }

  openForm({
    title: "Погашение долга",
    intro: "Личные долги гасятся целиком, банковский — частями, кратными $1000.",
    fields: [
      {k:"sel", type:"select", label:"Долг", options:opts},
      {k:"amount", label:"Сумма для банковского кредита, $", value:1000, step:1000}
    ],
    validate: v => {
      if(v.sel === "bank"){
        if(validatePositiveMoney(v.amount, "Сумма") || v.amount % 1000 !== 0) return "Сумма должна быть кратна $1000";
        if(v.amount > p.bankLoan) return "Больше, чем сам долг";
        if(v.amount > p.cash) return "Наличными не хватает для погашения кредита.";
        return null;
      }
      const k = v.sel.slice(2);
      if(p.cash < p.liabilities[k]) return "Наличными не хватает для погашения долга.";
      return null;
    },
    preview: v => {
      if(v.sel === "bank"){
        const amt = Math.min(v.amount, p.bankLoan);
        return '<div class="row"><span class="k">Расход уменьшится на</span><span class="v">' +
          money(amt * 0.1) + "/мес</span></div>" + deltaPreview(p, -amt, amt * 0.1);
      }
      const k = v.sel.slice(2);
      return '<div class="row"><span class="k">Расход уменьшится на</span><span class="v">' +
        money(p.expenses[k]) + "/мес</span></div>" + deltaPreview(p, -p.liabilities[k], p.expenses[k]);
    },
    submit: v => {
      if(v.sel === "bank"){
        push({type:"REPAY_BANK", playerId:p.id, amount:v.amount,
          label:"Погашен кредит банка " + money(v.amount)});
      } else {
        const k = v.sel.slice(2), d = DEBTS.find(x => x.k === k);
        push({type:"REPAY_DEBT", playerId:p.id, debt:k,
          label:"Погашен долг: " + d.n + " " + money(-p.liabilities[k])});
      }
    }
  });
}

function marketSymbol(value){ return String(value || "").trim().toUpperCase(); }

function validate202Symbol(symbol){
  if(!symbol) return "Укажи тикер";
  if(G.mode === "202-standard" && symbol !== "OK4U" && symbol !== "MYT4U"){
    return "В Standard доступны только OK4U и MYT4U";
  }
  return null;
}

function positionSymbolField(){
  return G.mode === "202-standard"
    ? {k:"symbol", type:"select", label:"Тикер", options:[
      {v:"OK4U", t:"OK4U"}, {v:"MYT4U", t:"MYT4U"}
    ]}
    : {k:"symbol", type:"text", label:"Тикер", placeholder:"OK4U"};
}

function confirmCustomLot(qty){
  if(G.mode !== "202-custom" || validateLot(qty, true)) return true;
  return confirm("Объём " + qty + " не соответствует стандартному лоту 100–5000 с шагом 100. Подтвердить нестандартный лот Custom?");
}

function actBuyOption(p){
  if(!is202(G)){ alert("Биржевые опционы доступны только в Cashflow 202."); return; }
  if(p.ft){ alert("Новый опцион нельзя открыть на скоростной дорожке."); return; }
  const rounds = optionRoundLimit(G);
  openForm({
    title:"Купить биржевой опцион", ok:"Купить",
    intro:"Премия указана за одну акцию и оплачивается один раз. При исполнении выплачивается только внутренняя стоимость.",
    fields:[
      {k:"optionType", type:"select", label:"Тип", options:[
        {v:"call", t:"Call — рост"}, {v:"put", t:"Put — падение"}
      ]},
      positionSymbolField(),
      {k:"strike", label:"Страйк, $ за акцию", value:0},
      {k:"premiumPerShare", label:"Премия, $ за акцию", value:0},
      {k:"qty", label:"Количество акций", value:100, step:100,
        hint:G.mode === "202-standard" ? "От 100 до 5000, шаг 100." : "Нестандартный лот потребует подтверждения."}
    ],
    validate:v => {
      const symbol = marketSymbol(v.symbol);
      const strict = G.settings.strictLots === true;
      return validate202Symbol(symbol) ||
        validatePositiveMoney(v.strike, "Страйк") ||
        validatePositiveMoney(v.premiumPerShare, "Премия", true) ||
        (!validateLot(v.qty, strict) ? (strict
          ? "В Standard количество должно быть от 100 до 5000 с шагом 100"
          : "Количество должно быть положительным целым числом") : null) ||
        validateAvailableCash(p, v.qty * v.premiumPerShare);
    },
    preview:v => {
      const total = v.qty * v.premiumPerShare;
      return '<div class="row"><span class="k">Премия всего</span><span class="v">' +
        v.qty + " × " + money(v.premiumPerShare) + " = " + money(total) + "</span></div>" +
        '<div class="row"><span class="k">Срок</span><span class="v">' + counted(rounds, "тур", "тура", "туров") + "</span></div>" +
        deltaPreview(p, -total, 0);
    },
    submit:v => {
      if(!confirmCustomLot(v.qty)) return;
      const symbol = marketSymbol(v.symbol);
      const premiumTotal = v.qty * v.premiumPerShare;
      push({type:"BUY_OPTION", playerId:p.id, optionId:uid(), optionType:v.optionType,
        symbol, strike:v.strike, premiumPerShare:v.premiumPerShare, premiumTotal,
        qty:v.qty, remaining:rounds, sourceMode:G.mode,
        nonstandardLotConfirmed:!validateLot(v.qty, true),
        label:"Куплен " + v.optionType.toUpperCase() + " " + symbol + " × " + v.qty +
          ", премия " + money(premiumTotal)});
    }
  });
}

function actAdjustOption(p, option, delta){
  push({type:"ADJUST_OPTION_ROUNDS", playerId:p.id, optionId:option.id, delta,
    label:(delta < 0 ? "−1 тур: " : "+1 тур: ") + option.type.toUpperCase() + " " + option.symbol});
}

function actExerciseOption(p, option){
  const price = S.marketPrices[option.symbol];
  const payout = optionPayout(option, price);
  if(!Number.isFinite(price)){ alert("Сначала запиши рыночную цену " + option.symbol + "."); return; }
  if(payout <= 0){ alert("Опцион пока не приносит выплату. Можно ждать до следующей цены или последнего тура."); return; }
  openForm({
    title:"Исполнить " + option.type.toUpperCase() + " " + option.symbol, ok:"Исполнить",
    intro:"Премия уже уплачена и повторно не вычитается.",
    preview:() => '<div class="row"><span class="k">Рыночная цена</span><span class="v">' + money(price) +
      '</span></div><div class="row total"><span class="k">Выплата</span><span class="v pos">' +
      money(payout) + "</span></div>" + deltaPreview(p, payout, 0),
    submit:() => push({type:"EXERCISE_OPTION", playerId:p.id, optionId:option.id, marketPrice:price,
      label:"Исполнен " + option.type.toUpperCase() + " " + option.symbol + ": " + signed(payout)})
  });
}

function actOpenShort(p){
  if(!is202(G) || p.ft){ alert("Короткую позицию можно открыть только в Cashflow 202 на Крысиных бегах."); return; }
  openForm({
    title:"Открыть короткую позицию", ok:"Открыть",
    intro:"Выручка останется в банковском конверте и не увеличит свободные наличные. Следующая цена этой акции потребует закрытия.",
    fields:[positionSymbolField(),
      {k:"openPrice", label:"Цена продажи, $ за акцию", value:0},
      {k:"qty", label:"Количество акций", value:100, step:100,
        hint:G.mode === "202-standard" ? "От 100 до 5000, шаг 100." : "Нестандартный лот потребует подтверждения."}
    ],
    validate:v => validate202Symbol(marketSymbol(v.symbol)) ||
      validatePositiveMoney(v.openPrice, "Цена продажи") ||
      (!validateLot(v.qty, G.settings.strictLots === true) ? (G.settings.strictLots
        ? "В Standard количество должно быть от 100 до 5000 с шагом 100"
        : "Количество должно быть положительным целым числом") : null),
    preview:v => '<div class="row"><span class="k">Банковский конверт</span><span class="v">' +
      money(v.qty * v.openPrice) + "</span></div>" + deltaPreview(p, 0, 0, null),
    submit:v => {
      if(!confirmCustomLot(v.qty)) return;
      const symbol = marketSymbol(v.symbol);
      push({type:"OPEN_SHORT", playerId:p.id, shortId:uid(), symbol, qty:v.qty, openPrice:v.openPrice,
        nonstandardLotConfirmed:!validateLot(v.qty, true),
        label:"Открыт шорт " + symbol + " × " + v.qty + " по " + money(v.openPrice)});
    }
  });
}

function actCloseShort(p, position){
  if(!position.mustClose){ alert("Шорт закрывается только при следующем событии цены этой акции."); return; }
  const price = position.closePrice;
  const result = shortResult(position, price);
  openForm({
    title:"Закрыть шорт " + position.symbol, ok:"Закрыть",
    intro:position.mustClose ? "Закрытие обязательно по первой появившейся цене." : "Закрытие короткой позиции.",
    validate:() => result < 0 && p.cash + result < 0
      ? "Наличных не хватает: продай активы или объяви личное банкротство. Банковский заём здесь недоступен."
      : null,
    preview:() => '<div class="row"><span class="k">Цена открытия → выкупа</span><span class="v">' +
      money(position.openPrice) + " → " + money(price) + '</span></div><div class="row total"><span class="k">Результат</span><span class="v ' +
      cls(result) + '">' + signed(result) + "</span></div>" + deltaPreview(p, result, 0, null, "") +
      (result < 0 && p.cash + result < 0
        ? '<div class="row"><span class="k neg">Продай активы или объяви личное банкротство</span><span class="v"></span></div>'
        : ""),
    submit:() => push({type:"CLOSE_SHORT", playerId:p.id, shortId:position.id, marketPrice:price,
      label:"Закрыт шорт " + position.symbol + ": " + signed(result)})
  });
}

function actShortBankruptcy(p){
  const result = lockedShorts(p).reduce((sum, position) =>
    sum + shortResult(position, position.closePrice), 0);
  if(!needsShortLossCover(p)) return;
  if(!confirm("Объявить личное банкротство из-за убытка по короткой позиции " +
    signed(result) + "? Непокрытый остаток будет списан, игрок пропустит три хода.")) return;
  push({type:"DECLARE_202_BANKRUPTCY", playerId:p.id, reason:"short-loss",
    counterId:"skip-turns", counterName:"Пропуск ходов",
    label:"Личное банкротство из-за убытка по короткой позиции"});
}

function pendingShortFor(symbol){
  return S.players.some(owner => owner.shorts.some(position => position.symbol === symbol && position.mustClose));
}

function marketAffectedPreview(effects){
  let html = '<div class="row"><span class="k">Затронуто игроков</span><span class="v">' +
    effects.affectedPlayers.length + "</span></div>";
  effects.affectedPlayers.forEach(affected => {
    html += '<div class="row"><span class="k">' + esc(affected.playerName) + '</span><span class="v">акции ' +
      affected.stocks + " · опционы " + affected.options + " · шорты " + affected.shorts + "</span></div>";
  });
  effects.options.forEach(option => {
    html += '<div class="row"><span class="k">' + esc(option.playerName) + " · " + option.type.toUpperCase() +
      '</span><span class="v ' + cls(option.payout) + '">' + money(option.payout) + "</span></div>";
  });
  effects.shorts.forEach(position => {
    html += '<div class="row"><span class="k">' + esc(position.playerName) + " · шорт" +
      '</span><span class="v ' + cls(position.result) + '">' + signed(position.result) + "</span></div>";
  });
  return html;
}

function actMarket202(p){
  openForm({
    title:"Рынок 202", ok:"Записать событие",
    intro:"Цена, дробление и банкротство компании действуют на всех игроков.",
    fields:[
      {k:"operation", type:"select", label:"Событие", options:[
        {v:"price", t:"Новая рыночная цена"},
        {v:"split", t:"Сплит 2:1"},
        {v:"reverse", t:"Обратный сплит 1:2"},
        {v:"bankruptcy", t:"Банкротство компании"}
      ]},
      positionSymbolField(),
      {k:"price", label:"Новая цена, $ за акцию", value:0,
        hint:"Для дробления и банкротства поле не используется."}
    ],
    validate:v => {
      const symbol = marketSymbol(v.symbol);
      return validate202Symbol(symbol) ||
        (v.operation === "price" ? validatePositiveMoney(v.price, "Рыночная цена") : null) ||
        (v.operation === "price" && pendingShortFor(symbol)
          ? "Сначала закрой обязательные короткие позиции по предыдущей цене " + symbol
          : null);
    },
    preview:v => {
      const symbol = marketSymbol(v.symbol);
      const price = v.operation === "bankruptcy" ? 0 : v.price;
      const effects = marketEffects(S, symbol, price);
      let html = marketAffectedPreview(effects);
      if(v.operation === "reverse"){
        html += '<div class="row"><span class="k">Нечётные количества</span><span class="v">округляются вниз</span></div>';
      }
      if(v.operation === "price" && effects.shorts.length){
        html += '<div class="row"><span class="k neg">Шорты</span><span class="v neg">потребуют закрытия</span></div>';
      }
      return html;
    },
    submit:v => {
      const symbol = marketSymbol(v.symbol);
      if(v.operation === "bankruptcy"){
        const affected = marketEffects(S, symbol, 0).affectedPlayers.map(item => item.playerName).join(", ") || "никого";
        if(!confirm("Банкротство " + symbol + " затронет: " + affected + ". Акции и коллы обнулятся, путы и шорты рассчитаются по цене $0. Продолжить?")) return;
        push({type:"COMPANY_BANKRUPTCY", playerId:p.id, symbol,
          label:"Банкротство компании " + symbol});
      } else if(v.operation === "price"){
        push({type:"MARKET_PRICE", playerId:p.id, symbol, price:v.price,
          label:"Новая цена " + symbol + ": " + money(v.price)});
      } else {
        const ratio = v.operation === "split" ? 2 : 0.5;
        push({type:"MARKET_SPLIT", playerId:p.id, symbol, ratio,
          label:(ratio === 2 ? "Сплит 2:1 — " : "Обратный сплит 1:2 — ") + symbol});
      }
    }
  });
}

function actCash(p, dir){
  const inc = dir === "in";
  openForm({
    title: inc ? "Разовый доход" : "Разовый расход",
    fields: [
      {k:"title", type:"text", label:"Описание", placeholder: inc ? "Продажа права на сделку" : "Прочее"},
      {k:"amount", label:"Сумма, $", value:0}
    ],
    validate: v => validatePositiveMoney(v.amount, "Сумма") ||
      (!inc ? validateAvailableCash(p, v.amount) : null),
    preview: v => deltaPreview(p, inc ? v.amount : -v.amount, 0),
    submit: v => push({type: inc ? "CASH_IN" : "CASH_OUT", playerId:p.id, amount:v.amount,
      label:(v.title.trim() || (inc ? "Разовый доход" : "Разовый расход")) + " " +
            signed(inc ? v.amount : -v.amount)})
  });
}

function actEnterFT(p){
  const d = derive(p);
  const start = liftoff(d.passive);
  openForm({
    title: "Выход на скоростную дорожку", ok: "Выйти",
    intro: "Всё заработанное сдаётся банкиру, отчёт крысиных бегов закрывается.",
    preview: () =>
      '<div class="row"><span class="k">Пассивный доход</span><span class="v">' + money(d.passive) + "</span></div>" +
      '<div class="row"><span class="k">Округлённый до тысяч × 100</span><span class="v"><b>' + money(start) + "</b></span></div>" +
      (is202(G)
        ? '<div class="row total"><span class="k">Рост бизнес-дохода для победы</span><span class="v">' + money(50000) + "/мес</span></div>"
        : '<div class="row total"><span class="k">Цель для победы</span><span class="v">' + money(start + 50000) + "/мес</span></div>") +
      deltaPreview(p, start - p.cash, start - d.cashflow),
    submit: () => push({type:"ENTER_FT", playerId:p.id,
      label:"Вышел на скоростную дорожку, подъёмные " + money(start)})
  });
}

function actFTPayday(p){
  const f = deriveFT(p);
  openForm({
    title: "День CASHFLOW",
    preview: () => deltaPreview(p, f.income, 0),
    submit: () => push({type:"FT_PAYDAY", playerId:p.id, label:"День CASHFLOW " + signed(f.income)})
  });
}

function actFTBiz(p){
  const official202 = is202(G);
  openForm({
    title: "Инвестиция в бизнес",
    intro: official202
      ? "В Cashflow 202 с наличных списывается полная цена. Первоначальный взнос и ипотека сохраняются как данные карточки."
      : "С наличных списывается первоначальный взнос; ипотека остаётся в данных карточки.",
    fields: [
      {k:"name", type:"text", label:"Название бизнеса"},
      {k:"price", label:"Цена, $", value:0},
      {k:"down", label:"Первоначальный взнос с карточки, $", value:0},
      {k:"mortgage", label:"Ипотека с карточки, $", value:0},
      {k:"cashflow", label:"Денежный поток в месяц, $", value:0}
    ],
    validate: v => (!v.name.trim() ? "Укажи название" :
      validatePositiveMoney(v.price, "Цена") ||
      validatePositiveMoney(v.down, "Первоначальный взнос", true) ||
      validatePositiveMoney(v.mortgage, "Ипотека", true) ||
      validatePositiveMoney(v.cashflow, "Денежный поток", true) ||
      (p.cash < (official202 ? v.price : v.down)
        ? "Наличными не хватает — кредит на дорожке недоступен." : null)),
    preview: v => deltaPreview(p, -(official202 ? v.price : v.down), v.cashflow),
    submit: v => push({type:"FT_BUY_BIZ", playerId:p.id, assetId:uid(),
      name:v.name.trim(), price:v.price, down:v.down, mortgage:v.mortgage, cashflow:v.cashflow,
      label:"Бизнес на дорожке: " + v.name.trim() + " (" + signed(v.cashflow) + "/мес)"})
  });
}

function actFTCharity(p){
  const official202 = is202(G);
  if(p.ft.charity && !official202){ alert("Благотворительность уже действует до конца игры."); return; }
  const choosingDice = official202 && p.ft.charity;
  const fixedAmount = 100000;
  openForm({
    title: choosingDice ? "Кости на этом ходу" : "Благотворительность",
    intro: choosingDice
      ? "Благотворительность уже оплачена. Выбери одну, две или три кости на этот ход."
      : "Не обязательна. Действует до конца игры: на каждом ходу выбираешь, кидать одну, две или три кости.",
    fields: official202
      ? [{k:"dice", type:"select", label:"Костей на этом ходу", options:[
          {v:1, t:"1 кость"}, {v:2, t:"2 кости"}, {v:3, t:"3 кости"}
        ], value:p.ft.dice || 1}]
      : [{k:"amount", label:"Сумма с карточки, $", value:fixedAmount, step:1000}],
    validate: v => official202
      ? (!choosingDice && p.cash < fixedAmount ? "Наличными не хватает — кредит на дорожке недоступен." : null)
      : validatePositiveMoney(v.amount, "Сумма") ||
        (p.cash < v.amount ? "Наличными не хватает — кредит на дорожке недоступен." : null),
    preview: v => deltaPreview(p, choosingDice ? 0 : -(official202 ? fixedAmount : v.amount), 0),
    submit: v => {
      if(choosingDice){
        push({type:"FT_CHOOSE_DICE", playerId:p.id, dice:Number(v.dice),
          label:"Выбрано костей на этом ходу: " + Number(v.dice)});
        return;
      }
      const amount = official202 ? fixedAmount : v.amount;
      push({type:"FT_CHARITY", playerId:p.id, amount,
        ...(official202 ? {dice:Number(v.dice)} : {}),
        label:"Благотворительность на дорожке " + money(-amount) + " — 1–3 кости до конца игры"});
    }
  });
}

function actSetDream(p){
  if(p.dream){ alert("Мечту нельзя менять после начала партии или появления жетонов."); return; }
  openForm({
    title: "Моя мечта",
    intro: "Мечта выбирается в начале партии — на неё ставится Сыр. Купить её сможешь только ты, и это победа.",
    fields: [
      {k:"name", type:"text", label:"Название с розового поля",
       value: "", placeholder:"Кругосветное путешествие"},
      {k:"price", label:"Первоначальная стоимость, $", value:0, step:1000}
    ],
    validate: v => (!v.name.trim() ? "Укажи мечту" : validatePositiveMoney(v.price, "Стоимость")),
    preview: v => '<div class="row"><span class="k">Цена, пока жетонов нет</span><span class="v">' + money(v.price) + "</span></div>",
    submit: v => push({type:"SET_DREAM", playerId:p.id, name:v.name.trim(), price:v.price,
      label:"Мечта: " + v.name.trim() + " за " + money(v.price)})
  });
}

function actDreamToken(p){
  const others = S.players.filter(x => x.id !== p.id && x.dream && !x.dream.bought);
  if(!others.length){ alert("Не на чью Мечту ставить жетон — у остальных она не задана."); return; }
  openForm({
    title: "Жетон на чужую Мечту",
    intro: "Ты попал на розовое поле чужой Мечты. Платить не надо, но её цена для владельца вырастет на 100 % от первоначальной.",
    fields: [{k:"who", type:"select", label:"Чья Мечта",
      options: others.map(x => ({v:x.id, t:x.name + " — " + x.dream.name}))}],
    preview: v => {
      const o = others.find(x => x.id === v.who); if(!o) return "";
      const now = dreamPrice(o), next = o.dream.base * (2 + o.dream.tokens);
      return '<div class="row"><span class="k">Жетонов станет</span><span class="v">' + (o.dream.tokens + 1) + "</span></div>" +
        '<div class="row"><span class="k">' + esc(o.name) + " заплатит</span><span class=\"v\">" +
        money(now) + " → <b>" + money(next) + "</b></span></div>";
    },
    submit: v => {
      const o = others.find(x => x.id === v.who); if(!o) return;
      push({type:"DREAM_TOKEN", playerId:o.id, byPlayerId:p.id,
        label:"Жетон от " + p.name + " на Мечту «" + o.dream.name + "» — цена стала " +
              money(o.dream.base * (2 + o.dream.tokens))});
    }
  });
}

function actFTDream(p){
  if(is202(G)){
    const unavailable = new Set();
    const selectedNames = new Set();
    S.players.forEach(player => {
      if(player.dream){
        unavailable.add(String(player.dream.fieldId || player.dream.name));
        selectedNames.add(String(player.dream.name).trim());
      }
      (player.otherDreams || []).forEach(dream =>
        unavailable.add(String(dream.fieldId || dream.id || dream.name)));
    });
    openForm({
      title:"Купить мечту",
      ok:"Купить",
      intro:"Сначала выбери свою Мечту или свободное невыбранное поле Мечты.",
      fields:[
        {k:"kind", type:"select", label:"Какую Мечту", options:[
          {v:"own", t:"Моя мечта"}, {v:"other", t:"Другая мечта"}
        ]},
        {k:"fieldId", type:"text", label:"Номер / ID другого поля"},
        {k:"name", type:"text", label:"Название другой Мечты"},
        {k:"price", label:"Цена другой Мечты, $", value:0, step:1000}
      ],
      validate:v => {
        if(v.kind === "own"){
          if(!p.dream) return "Своя Мечта не выбрана.";
          if(p.dream.bought) return "Своя Мечта уже куплена.";
          return validateAvailableCash(p, dreamPrice(p));
        }
        const fieldId = v.fieldId.trim();
        if(!fieldId) return "Укажи номер или ID поля Мечты.";
        if(unavailable.has(fieldId)) return "Это поле Мечты уже выбрано или продано.";
        if(!v.name.trim()) return "Укажи название Мечты.";
        if(selectedNames.has(v.name.trim())) return "Эта Мечта уже выбрана игроком и не продаётся.";
        return validatePositiveMoney(v.price, "Цена") || validateAvailableCash(p, v.price);
      },
      preview:v => v.kind === "own"
        ? (p.dream ? deltaPreview(p, -dreamPrice(p), 0) : "")
        : deltaPreview(p, -v.price, 0),
      submit:v => {
        if(v.kind === "own"){
          push({type:"FT_DREAM", playerId:p.id,
            label:"Куплена своя Мечта «" + p.dream.name + "» за " + money(dreamPrice(p))});
          return;
        }
        push({type:"FT_BUY_OTHER_DREAM", playerId:p.id, fieldId:v.fieldId.trim(),
          name:v.name.trim(), price:v.price,
          label:"Куплена другая Мечта «" + v.name.trim() + "» за " + money(v.price)});
      }
    });
    return;
  }
  if(!p.dream){ actSetDream(p); return; }
  if(p.dream.bought){ alert("Мечта уже куплена."); return; }
  const price = dreamPrice(p);
  openForm({
    title: "Купить свою Мечту", ok: "Купить",
    intro: "Покупка своей Мечты — это победа.",
    validate: () => p.cash < price ? "Наличными не хватает — кредит на дорожке недоступен." : null,
    preview: () =>
      '<div class="row"><span class="k">' + esc(p.dream.name) + "</span><span class=\"v\"></span></div>" +
      '<div class="row"><span class="k">Первоначальная стоимость</span><span class="v">' + money(p.dream.base) + "</span></div>" +
      '<div class="row"><span class="k">Чужих жетонов</span><span class="v">' + p.dream.tokens + "</span></div>" +
      '<div class="row total"><span class="k">К оплате</span><span class="v">' + money(price) + "</span></div>" +
      deltaPreview(p, -price, 0),
    submit: () => push({type:"FT_DREAM", playerId:p.id,
      label:"Куплена своя Мечта «" + p.dream.name + "» за " + money(price) + " — победа"})
  });
}

/* ---------- отрисовка ---------- */

function renderChips(){
  const box = $("#chips");
  if(!S.players.length){ box.innerHTML = ""; return; }
  box.innerHTML = S.players.map(p => {
    const flow = p.ft ? deriveFT(p).income : derive(p).cashflow;
    return '<button class="chip' + (p.id === G.current ? " on" : "") + '" data-p="' + p.id + '">' +
      "<b>" + esc(p.name) + "</b>" +
      '<span class="cf ' + cls(flow) + '">' + signed(flow) + "</span>" +
      "<span>" + money(p.cash) + (p.ft ? " · дорожка" : "") + "</span></button>";
  }).join("") +
  '<button class="chip" data-p="+" style="min-width:56px;text-align:center"><b style="font-size:20px">+</b><span>игрок</span></button>';

  box.querySelectorAll("[data-p]").forEach(el => el.onclick = () => {
    if(el.dataset.p === "+"){ G.screen = "setup"; }
    else { G.current = el.dataset.p; G.screen = "table"; }
    render();
  });
}

function renderSetup(){
  const sel = $("#np-prof");
  const mode = $("#np-mode");
  if(!sel.options.length){
    sel.innerHTML = PROFESSIONS.map(p => '<option value="' + p.id + '">' + esc(p.title) + "</option>").join("");
  }
  mode.value = G.mode;
  const hasPlayerEvent = G.events.some(ev => ev && ev.type === "ADD_PLAYER");
  mode.disabled = hasPlayerEvent;
  $("#np-mode-hint").textContent = hasPlayerEvent
    ? "Режим зафиксирован после добавления первого игрока: " + modeTitle(G.mode) + "."
    : modeTitle(G.mode) + ".";
  const custom = G.mode === "202-custom";
  $("#np-rounds-wrap").classList.toggle("hide", !custom);
  $("#np-rounds").value = G.settings.optionRounds;
  const portfolio = $("#np-portfolio");
  portfolio.classList.toggle("hide", !is202(G));
  if(is202(G)) renderPortfolioRows();
  const prof = PROFESSIONS.find(x => x.id === sel.value) || PROFESSIONS[0];
  const tmp = blankPlayer("tmp", "tmp", prof);
  const d = derive(tmp);
  $("#np-hint").innerHTML =
    "Зарплата " + money(prof.salary) + " · расход " + money(d.totalExpenses) +
    " · поток <b class=\"" + cls(d.cashflow) + "\">" + signed(d.cashflow) + "</b>" +
    " · на старте " + money(startingCash(tmp));

  const list = $("#setup-list");
  $("#setup-warnings").innerHTML = eventWarningsHTML();
  $("#setup-list-card").classList.toggle("hide", !S.players.length);
  list.innerHTML = S.players.map(p =>
    '<div class="row"><span class="k">' + esc(p.name) + " — " + esc(p.professionTitle) +
    '</span><span class="v">' + money(p.cash) + "</span></div>").join("") +
    (S.players.length ? '<button class="btn primary" id="np-go" style="width:100%;padding:13px;margin-top:12px">Начать игру</button>' : "");
  const go = $("#np-go");
  if(go) go.onclick = () => { G.screen = "table"; render(); };
}

function reportRatRace(p){
  const d = derive(p);
  const e = p.expenses, l = p.liabilities;
  const edit = (type, id) => ' <button class="btn" data-edit-card="' + esc(type + ":" + id) + '">Изменить</button>';
  const row = (k, v, extra, action) => '<div class="row' + (extra || "") + (action ? " actions" : "") + '"><span class="k">' + k +
    '</span><span class="v">' + v + (action || "") + "</span></div>";

  let h = '<div class="sub">Доходы</div>';
  h += row("Заработок", money(p.salary));
  h += row("Проценты и дивиденды", money(d.dividends));
  p.props.forEach(a => h += row(esc(a.name), money(a.cashflow)));
  p.otherAssets.forEach(a => h += row(esc(a.name), money(a.income)));
  h += row("Общий доход", money(d.totalIncome), " total");

  h += '<div class="sub">Расходы</div>';
  h += row("Налоги", money(e.taxes));
  h += row("Ипотека на дом", money(e.mortgage));
  h += row("Кредит на образование", money(e.school));
  h += row("Кредит на машину", money(e.car));
  h += row("Кредитные карточки", money(e.card));
  h += row("Мелкие кредиты", money(e.retail));
  h += row("Прочие расходы", money(e.other));
  p.otherLiabilities.forEach(a => h += row(esc(a.name), money(a.expense)));
  p.otherExpenses.filter(item => item.active).forEach(item => h += row(esc(item.name), money(item.amount) + "/мес", "",
    edit("otherExpense", item.id) + ' <button class="btn danger" data-end-expense="' + esc(item.id) + '">Завершить</button>'));
  if(d.insuranceExpense > 0) h += row("Страховка недвижимости", money(d.insuranceExpense) + "/мес");
  h += row("Расходы на детей (" + p.children + ")", money(d.childExp));
  h += row("Кредит банка", money(d.bankPay));
  h += row("Общий расход", money(d.totalExpenses), " total");

  h += '<div class="sub">Активы</div>';
  h += row("Сбережения", money(p.savings));
  p.stocks.forEach(s => h += row(esc(s.symbol) + " × " + s.qty, money(s.price) + " / шт", "", edit("stock", s.id)));
  p.props.forEach(a => h += row(esc(a.name), "первоначальный взнос " + money(a.down) + " · цена " + money(a.price), "", edit("property", a.id)));
  p.otherAssets.forEach(a => h += row(esc(a.name), money(a.cost), "", edit("otherAsset", a.id)));
  p.d2yCards.forEach(card => h += row("D2Y №" + card.number, signed(card.income) + "/мес"));

  h += '<div class="sub">Пассивы</div>';
  DEBTS.forEach(dd => { if(l[dd.k] > 0) h += row(dd.n, money(l[dd.k])); });
  p.props.forEach(a => { if(a.mortgage > 0) h += row("Ипотека: " + esc(a.name), money(a.mortgage)); });
  p.otherLiabilities.forEach(a => h += row(esc(a.name), money(a.balance), "", edit("otherLiability", a.id)));
  if(p.bankLoan > 0) h += row("Кредит банка", money(p.bankLoan));

  return h;
}

function reportFT(p){
  const f = deriveFT(p);
  const edit = (type, id) => ' <button class="btn" data-edit-card="' + esc(type + ":" + id) + '">Изменить</button>';
  const row = (k, v, extra, action) => '<div class="row' + (extra || "") + (action ? " actions" : "") + '"><span class="k">' + k +
    '</span><span class="v">' + v + (action || "") + "</span></div>";
  let h = '<div class="sub">Доход в День CASHFLOW</div>';
  h += row("Начальный пассивный доход", money(p.ft.startIncome));
  p.ft.businesses.forEach(b => {
    const details = is202(G)
      ? signed(b.cashflow) + " · базовая цена " + money(b.basePrice ?? b.price) +
        " · Жетонов владения: " + (b.ownershipTokens || 1) +
        " · Франшиз: " + (Array.isArray(b.franchises) ? b.franchises.length : 0)
      : signed(b.cashflow) + " · цена " + money(b.price) +
        " · первоначальный взнос " + money(b.down) + " · ипотека " + money(b.mortgage);
    h += row(esc(b.name), details, "", edit("ftBusiness", b.id));
  });
  p.otherExpenses.filter(item => item.active).forEach(item => h += row(esc(item.name), money(-item.amount) + "/мес", "",
    edit("otherExpense", item.id) + ' <button class="btn danger" data-end-expense="' + esc(item.id) + '">Завершить</button>'));
  h += row("Итого доход", money(f.income), " total");
  h += '<div class="sub">Победа</div>';
  if(is202(G)){
    h += row("Рост бизнес-дохода", money(50000));
    h += row("Осталось увеличить", money(f.left));
  } else {
    h += row("Цель", money(f.target));
    h += row("Осталось набрать", money(f.left));
  }
  if(p.ft.charity && is202(G)) h += row("Костей на текущем ходу", String(p.ft.dice || 1));
  if(p.dream){
    h += '<div class="sub">Мечта</div>';
    h += row(esc(p.dream.name), p.dream.bought ? "куплена" : money(dreamPrice(p)));
    h += row("Первоначальная стоимость", money(p.dream.base));
    h += row("Чужих жетонов", String(p.dream.tokens));
  }
  if(Array.isArray(p.otherDreams) && p.otherDreams.length){
    h += '<div class="sub">Другие Мечты</div>';
    p.otherDreams.forEach(dream => h += row(esc(dream.name), money(dream.price)));
  }
  return h;
}

function eventDeltaPreview(p, event){
  const nextState = reduceEvents(G.events.concat(event), G);
  const next = nextState.players.find(item => item.id === p.id);
  if(!next) return deltaPreview(p, 0, 0);
  const beforeFlow = p.ft ? deriveFT(p).income : derive(p).cashflow;
  const afterFlow = next.ft ? deriveFT(next).income : derive(next).cashflow;
  return deltaPreview(p, next.cash - p.cash, afterFlow - beforeFlow);
}

function eventWarningsHTML(){
  return (S.eventWarnings || []).map(w =>
    '<div class="note warn">Операция № ' + w.operationNumber +
    (w.applied
      ? " содержит старое недопустимое значение, но применена по прежним правилам. Запись сохранена без изменений.</div>"
      : " повреждена и не применена при расчёте. Запись сохранена в журнале без изменений.</div>")).join("");
}

function renderCardCounters(p){
  if(p.ft && is202(G)) return "";
  let html = '<div class="sub tools202-title">Счётчики карточек</div>';
  if(!p.cardCounters.length) return html + '<div class="empty tools202-empty">Счётчиков пока нет.</div>';
  p.cardCounters.forEach(counter => {
    const tone = counter.remaining === 0 ? " bad" : counter.remaining === 1 ? " warn" : "";
    html += '<div class="instrument' + tone + '"><div class="instrument-head"><b>' + esc(counter.name) +
      '</b><span>' + (counter.remaining === 0 ? "истёк" : counted(counter.remaining, "ход", "хода", "ходов")) + '</span></div>' +
      '<div class="instrument-actions"><button class="btn" data-counter-minus="' + esc(counter.id) + '"' +
      ' aria-label="Уменьшить счётчик ' + esc(counter.name) + ' на один ход"' +
      (counter.remaining === 0 ? " disabled" : "") + '>−1</button><button class="btn" data-counter-plus="' +
      esc(counter.id) + '" aria-label="Увеличить счётчик ' + esc(counter.name) + ' на один ход">+1</button></div></div>';
  });
  return html;
}

function render202Tools(p){
  if(!is202(G) || p.ft) return "";
  const forcedShortClose = S.players.some(owner => lockedShorts(owner).length);
  let html = '<div class="sub tools202-title">Инструменты 202</div>';
  p.d2yCards.forEach(card => {
    const active = card.number === 1 || (card.number === 2 && p.d2yCards.some(item => item.number === 1)) ||
      (card.number === 3 && p.d2yCards.some(item => item.number === 1) && p.d2yCards.some(item => item.number === 2));
    html += '<div class="instrument' + (active ? " good" : " warn") + '"><div class="instrument-head"><b>D2Y №' +
      card.number + '</b><span>' + (active ? "доход активен" : "ждёт связку") + '</span></div><div class="row"><span class="k">Доход</span><span class="v">' +
      signed(card.income) + "/мес</span></div></div>";
  });
  if(p.insurance){
    html += '<div class="instrument good"><div class="instrument-head"><b>Страховка недвижимости</b><span>постоянно</span></div>' +
      '<div class="row"><span class="k">Расход</span><span class="v">' + money(p.insurance.expense) + "/мес</span></div></div>";
  }
  p.realEstateOptions.forEach(option => {
    html += '<div class="instrument warn"><div class="instrument-head"><b>Опцион на недвижимость</b><span>очередь №' +
      option.order + '</span></div></div>';
  });
  if(!p.options.length && !p.shorts.length && !p.d2yCards.length && !p.insurance && !p.realEstateOptions.length){
    return html + '<div class="empty tools202-empty">Инструментов 202 пока нет.</div>';
  }
  p.options.forEach(option => {
    const price = S.marketPrices[option.symbol];
    const payout = Number.isFinite(price) ? optionPayout(option, price) : 0;
    const tone = option.remaining <= 0 ? " bad" : payout > 0 ? " good" : option.remaining === 1 ? " warn" : "";
    html += '<div class="instrument' + tone + '"><div class="instrument-head"><b>' +
      esc(option.type.toUpperCase() + " · " + option.symbol) + '</b><span>' + option.remaining +
      ' тур.</span></div><div class="row"><span class="k">Страйк · количество</span><span class="v">' +
      money(option.strike) + " · " + option.qty + '</span></div><div class="row"><span class="k">Премия за акцию · всего</span><span class="v">' +
      money(option.premiumPerShare) + " · " + money(option.premiumTotal) + "</span></div>" +
      (Number.isFinite(price) ? '<div class="row"><span class="k">Рынок · выплата</span><span class="v ' + cls(payout) + '">' +
        money(price) + " · " + money(payout) + "</span></div>" : "") +
      '<div class="instrument-actions"><button class="btn" data-option-minus="' + esc(option.id) + '"' +
      ' aria-label="Уменьшить срок ' + esc(option.type.toUpperCase() + " " + option.symbol) + ' на один тур"' +
      (forcedShortClose || option.remaining <= 0 ? " disabled" : "") + ">−1</button>" +
      '<button class="btn" data-option-plus="' + esc(option.id) + '"' +
      ' aria-label="Увеличить срок ' + esc(option.type.toUpperCase() + " " + option.symbol) + ' на один тур"' +
      (forcedShortClose || option.remaining >= option.roundLimit ? " disabled" : "") + ">+1</button>" +
      (Number.isFinite(price) ? '<button class="btn primary" data-option-exercise="' + esc(option.id) + '"' +
        (forcedShortClose || payout <= 0 || option.remaining <= 0 ? " disabled" : "") + ">" +
        (option.remaining <= 0 ? "Истёк" : payout > 0 ? "Исполнить " + signed(payout) : "Ждать") + "</button>" : "") +
      "</div></div>";
  });
  p.shorts.forEach(position => {
    const result = position.mustClose ? shortResult(position, position.closePrice) : null;
    html += '<div class="instrument' + (position.mustClose ? " bad" : "") +
      '"><div class="instrument-head"><b>Шорт · ' + esc(position.symbol) + '</b><span>' +
      (position.mustClose ? "закрыть сейчас" : "открыт") + '</span></div><div class="row"><span class="k">Цена входа · количество</span><span class="v">' +
      money(position.openPrice) + " · " + position.qty + '</span></div><div class="row"><span class="k">Банковский конверт</span><span class="v">' +
      money(position.proceedsEnvelope) + "</span></div>" +
      (position.mustClose ? '<div class="row"><span class="k">Обязательный выкуп · результат</span><span class="v ' + cls(result) + '">' +
        money(position.closePrice) + " · " + signed(result) + "</span></div>" : "") +
      (position.mustClose
        ? '<div class="instrument-actions"><button class="btn danger" data-short-close="' + esc(position.id) +
          '">Подтвердить закрытие</button></div>'
        : '<div class="note warn">Ждёт следующую цену этой акции</div>') + "</div>";
  });
  return html;
}

function bind202Tools(p){
  $("#report").querySelectorAll("[data-option-minus]").forEach(button => button.onclick = () => {
    const option = p.options.find(item => item.id === button.dataset.optionMinus);
    if(option) actAdjustOption(p, option, -1);
  });
  $("#report").querySelectorAll("[data-option-plus]").forEach(button => button.onclick = () => {
    const option = p.options.find(item => item.id === button.dataset.optionPlus);
    if(option) actAdjustOption(p, option, 1);
  });
  $("#report").querySelectorAll("[data-option-exercise]").forEach(button => button.onclick = () => {
    const option = p.options.find(item => item.id === button.dataset.optionExercise);
    if(option) actExerciseOption(p, option);
  });
  $("#report").querySelectorAll("[data-short-close]").forEach(button => button.onclick = () => {
    const position = p.shorts.find(item => item.id === button.dataset.shortClose);
    if(position) actCloseShort(p, position);
  });
}

function transferableFastTrackBusinesses(p){
  const out = [];
  S.players.forEach(owner => {
    if(owner.id === p.id || !owner.ft) return;
    owner.ft.businesses.forEach(business => {
      const ownershipTokens = Math.max(1, Number(business.ownershipTokens || business.tokens || 1)) + 1;
      const price = fastTrackBusinessPrice({...business, ownershipTokens});
      out.push({owner, business, price});
    });
  });
  return out;
}

function actFTTransferBusiness(p){
  const businesses = transferableFastTrackBusinesses(p);
  if(!businesses.length){ alert("У других игроков нет бизнеса для обязательного выкупа."); return; }
  openForm({
    title:"Выкупить бизнес игрока",
    ok:"Передать бизнес",
    intro:"При попадании на чужой бизнес передача обязательна. Цена учитывает новый жетон владения.",
    fields:[{k:"business", type:"select", label:"Бизнес", options:businesses.map((item, index) => ({
      v:String(index), t:item.owner.name + " · " + item.business.name + " · " + money(item.price)
    }))}],
    validate:v => {
      const item = businesses[Number(v.business)];
      return !item ? "Выбери бизнес" : validateAvailableCash(p, item.price);
    },
    preview:v => {
      const item = businesses[Number(v.business)];
      if(!item) return "";
      const event = {type:"FT_TRANSFER_BUSINESS", playerId:p.id, fromPlayerId:item.owner.id,
        businessId:item.business.id, landingId:"preview"};
      return '<div class="row"><span class="k">Жетонов владения станет</span><span class="v">' +
        (Math.max(1, Number(item.business.ownershipTokens || item.business.tokens || 1)) + 1) +
        '</span></div><div class="sub">Продавец · ' + esc(item.owner.name) + "</div>" +
        eventDeltaPreview(item.owner, event) + '<div class="sub">Покупатель · ' + esc(p.name) + "</div>" +
        eventDeltaPreview(p, event);
    },
    submit:v => {
      const item = businesses[Number(v.business)];
      if(!item) return;
      push({type:"FT_TRANSFER_BUSINESS", playerId:p.id, fromPlayerId:item.owner.id,
        businessId:item.business.id, landingId:uid(),
        label:"Обязательный выкуп бизнеса «" + item.business.name + "» у " + item.owner.name +
          " за " + money(item.price)});
    }
  });
}

function actFTFranchise(p){
  if(!p.ft.businesses.length){ alert("Сначала купи бизнес на Скоростной дорожке."); return; }
  openForm({
    title:"Добавить франшизу",
    ok:"Добавить",
    intro:"Повторное попадание владельца добавляет не больше одной франшизы за это попадание.",
    fields:[{k:"business", type:"select", label:"Свой бизнес", options:p.ft.businesses.map((business, index) => ({
      v:String(index), t:business.name + " · " + money(business.basePrice ?? business.price)
    }))}],
    validate:v => {
      const business = p.ft.businesses[Number(v.business)];
      return !business ? "Выбери бизнес" : validateAvailableCash(p, business.basePrice ?? business.price);
    },
    preview:v => {
      const business = p.ft.businesses[Number(v.business)];
      if(!business) return "";
      const price = business.basePrice ?? business.price;
      const flow = business.baseCashflow ?? business.cashflow;
      return deltaPreview(p, -price, flow);
    },
    submit:v => {
      const business = p.ft.businesses[Number(v.business)];
      if(!business) return;
      push({type:"FT_ADD_FRANCHISE", playerId:p.id, businessId:business.id, landingId:uid(),
        label:"Франшиза бизнеса «" + business.name + "»"});
    }
  });
}

function bindOwnedCardTools(p){
  $("#report").querySelectorAll("[data-edit-card]").forEach(button => button.onclick = () => {
    const separator = button.dataset.editCard.indexOf(":");
    actEditOwnedCard(p, button.dataset.editCard.slice(0, separator), button.dataset.editCard.slice(separator + 1));
  });
  $("#report").querySelectorAll("[data-end-expense]").forEach(button => button.onclick = () => {
    const expense = p.otherExpenses.find(item => item.id === button.dataset.endExpense);
    if(expense) push({type:"END_OTHER_EXPENSE", playerId:p.id, expenseId:expense.id,
      label:"Завершён расход: " + expense.name});
  });
  $("#report").querySelectorAll("[data-counter-minus]").forEach(button => button.onclick = () =>
    push({type:"ADJUST_CARD_COUNTER", playerId:p.id, counterId:button.dataset.counterMinus, delta:-1,
      label:"−1 ход счётчика"}));
  $("#report").querySelectorAll("[data-counter-plus]").forEach(button => button.onclick = () =>
    push({type:"ADJUST_CARD_COUNTER", playerId:p.id, counterId:button.dataset.counterPlus, delta:1,
      label:"+1 ход счётчика"}));
}

function actOtherExpense(p){
  openForm({
    title:"Прочий расход",
    fields:[
      {k:"cadence", type:"select", label:"Периодичность", options:[
        {v:"once", t:"Один раз"}, {v:"monthly", t:"Ежемесячно"}
      ]},
      {k:"name", type:"text", label:"Название", placeholder:"Страховой взнос"},
      {k:"amount", label:"Сумма, $", value:0}
    ],
    validate:v => (!v.name.trim() ? "Укажи название" : validatePositiveMoney(v.amount, "Сумма")) ||
      (v.cadence === "once" ? validateAvailableCash(p, v.amount) : null),
    preview:v => deltaPreview(p, v.cadence === "once" ? -v.amount : 0,
      v.cadence === "monthly" ? -v.amount : 0),
    submit:v => push({type:"ADD_OTHER_EXPENSE", playerId:p.id, expenseId:uid(),
      name:v.name.trim(), cadence:v.cadence, amount:v.amount,
      label:v.name.trim() + (v.cadence === "monthly" ? " " + money(-v.amount) + "/мес" : " " + money(-v.amount))})
  });
}

function actCardCounter(p){
  openForm({
    title:"Счётчики карточек",
    fields:[
      {k:"preset", type:"select", label:"Карточка", options:[
        {v:"Благотворительность", t:"Благотворительность"},
        {v:"Увольнение / пропуск", t:"Увольнение / пропуск"},
        {v:"Стихийное бедствие", t:"Стихийное бедствие"},
        {v:"custom", t:"Другое название"}
      ]},
      {k:"name", type:"text", label:"Своё название", placeholder:"Используется для «Другое»"},
      {k:"remaining", label:"Осталось ходов", value:1}
    ],
    validate:v => (!Number.isInteger(v.remaining) || v.remaining < 0 ? "Остаток должен быть целым неотрицательным числом" :
      (v.preset === "custom" && !v.name.trim() ? "Укажи название" : null)),
    preview:v => '<div class="row"><span class="k">Осталось</span><span class="v">' + counted(v.remaining, "ход", "хода", "ходов") + "</span></div>",
    submit:v => {
      const name = v.preset === "custom" ? v.name.trim() : v.preset;
      push({type:"ADD_CARD_COUNTER", playerId:p.id, counterId:uid(), name, remaining:v.remaining,
        label:"Счётчик «" + name + "»: " + v.remaining});
    }
  });
}

function actLoseCash(p, share, title){
  const available = Math.max(0, p.cash);
  const loss = share === "all" ? available : available - Math.round(available / 2);
  openForm({
    title,
    intro:"Банковский кредит для этой потери не создаётся.",
    preview:() => deltaPreview(p, -loss, 0),
    submit:() => push({type:"LOSE_CASH_SHARE", playerId:p.id, share,
      label:title + " " + money(-loss)})
  });
}

function actInsurance(p){
  if(p.insurance){ alert("Страховка уже действует постоянно на всю недвижимость игрока."); return; }
  openForm({
    title:"Страховка недвижимости", ok:"Купить",
    intro:"Постоянный ежемесячный расход защищает всю недвижимость, включая совместную.",
    fields:[{k:"expense", label:"Ежемесячный расход, $", value:0}],
    validate:v => validatePositiveMoney(v.expense, "Расход"),
    preview:v => deltaPreview(p, 0, -v.expense),
    submit:v => push({type:"BUY_INSURANCE", playerId:p.id, policyId:uid(), expense:v.expense,
      label:"Куплена страховка недвижимости " + money(-v.expense) + "/мес"})
  });
}

function actD2Y(p){
  openForm({
    title:"Карточка D2Y", ok:"Добавить",
    fields:[
      {k:"number", type:"select", label:"Номер", options:[
        {v:"1", t:"D2Y №1"}, {v:"2", t:"D2Y №2"}, {v:"3", t:"D2Y №3"}
      ]},
      {k:"cost", label:"Стоимость, $", value:0},
      {k:"income", label:"Доход в месяц, $", value:0}
    ],
    validate:v => validatePositiveMoney(v.cost, "Стоимость", true) ||
      validatePositiveMoney(v.income, "Доход", true) ||
      (p.cash < v.cost ? "Наличными не хватает — сначала возьми кредит." : null) ||
      ((Number(v.number) === 1 || Number(v.number) === 3) && p.d2yCards.some(card => card.number === Number(v.number))
        ? "Такая карточка D2Y уже есть" : null),
    preview:v => {
      const before = d2yIncome(p.d2yCards || []);
      const after = d2yIncome((p.d2yCards || []).concat({number:Number(v.number), income:v.income}));
      return deltaPreview(p, -v.cost, after - before);
    },
    submit:v => push({type:"ADD_D2Y", playerId:p.id, cardId:uid(), number:Number(v.number),
      cost:v.cost, income:v.income, label:"Добавлена D2Y №" + v.number + " · " + signed(v.income) + "/мес"})
  });
}

function optionPropertyFields(){
  return [
    {k:"name", type:"text", label:"Объект", placeholder:"Дом 3/2"},
    {k:"kind", type:"select", label:"Тип", options:[
      {v:"property", t:"Недвижимость"}, {v:"land", t:"Земля"}
    ]},
    {k:"price", label:"Цена, $", value:0},
    {k:"down", label:"Первоначальный взнос, $", value:0},
    {k:"mortgage", label:"Ипотека, $", value:0},
    {k:"cashflow", label:"Денежный поток / мес, $", value:0},
    {k:"acres", label:"Площадь земли, акров", value:0},
    {k:"removeCashflow", type:"select", label:"Поток после продажи части земли", options:[
      {v:"keep", t:"Сохраняется"}, {v:"remove", t:"Удаляется"}
    ]}
  ];
}

function actOfferRealEstateDeal(p){
  openForm({
    title:"Следующая сделка с недвижимостью", ok:"Предложить",
    intro:"Объект фиксируется для всех опционов. Владельцы решают по порядку покупки.",
    fields:optionPropertyFields(),
    validate:v => !v.name.trim() ? "Укажи объект" :
      (!Number.isFinite(v.cashflow) ? "Денежный поток: укажи число" :
        validatePositiveMoney(v.price, "Цена") || validatePositiveMoney(v.down, "Первый взнос", true) ||
        validatePositiveMoney(v.mortgage, "Ипотека", true) ||
        (v.kind === "land" ? validatePositiveMoney(v.acres, "Площадь участка") : null)),
    submit:v => {
      const dealId = uid();
      push({type:"OFFER_REAL_ESTATE", playerId:p.id, dealId,
        property:{assetId:uid(), name:v.name.trim(), kind:v.kind, price:v.price, down:v.down,
          mortgage:v.mortgage, cashflow:v.cashflow,
          ...(v.kind === "land" ? {acres:v.acres, removeCashflowOnSplit:v.removeCashflow === "remove"} : {})},
        label:"Предложена сделка с недвижимостью: " + v.name.trim()});
    }
  });
}

function actContinueRealEstateDeal(p){
  const deal = S.pendingRealEstateDeal;
  if(!deal || deal.originalPlayerId !== p.id) return;
  const event = {type:"CONTINUE_REAL_ESTATE_DEAL", playerId:p.id, dealId:deal.id,
    label:"Куплена исходная сделка: " + deal.property.name};
  openForm({
    title:"Продолжить исходную сделку", ok:"Купить объект",
    intro:"Все опционы сгорели. Покупка исходного объекта «" + deal.property.name +
      "» спишет первоначальный взнос " + money(deal.property.down) + ".",
    validate:() => p.cash < deal.property.down ? "Наличными не хватает на первоначальный взнос" : null,
    preview:() => eventDeltaPreview(p, event),
    submit:() => push(event)
  });
}

function actRealEstateOption(p){
  const deal = S.pendingRealEstateDeal;
  if(!deal){
    if(p.realEstateOptions.length){
      alert("Сначала другой игрок должен открыть следующую сделку с недвижимостью.");
      return;
    }
    openForm({
      title:"Купить опцион на недвижимость", ok:"Купить",
      fields:[{k:"cost", label:"Стоимость опциона, $", value:0}],
      validate:v => validatePositiveMoney(v.cost, "Стоимость", true) || validateAvailableCash(p, v.cost),
      preview:v => deltaPreview(p, -v.cost, 0),
      submit:v => push({type:"BUY_REAL_ESTATE_OPTION", playerId:p.id, optionId:uid(), cost:v.cost,
        label:"Куплен опцион на следующую недвижимость"})
    });
    return;
  }
  const oldest = oldestRealEstateOption(S);
  if(!oldest){
    alert("Все владельцы отказались. Исходный игрок должен продолжить эту же сделку.");
    return;
  }
  if(oldest.owner.id !== p.id){
    alert("Сначала решение принимает " + oldest.owner.name + " — его опцион куплен раньше.");
    return;
  }
  const option = oldest.option;
  const buyers = S.players.filter(player => player.id !== p.id);
  openForm({
    title:"Использовать опцион на недвижимость", ok:"Решить",
    intro:"Зафиксирован объект «" + deal.property.name + "». Переданный опцион используется покупателем сразу.",
    fields:[
      {k:"action", type:"select", label:"Решение", options:[
        {v:"buy", t:"Купить объект"},
        ...(buyers.length ? [{v:"transfer", t:"Передать опцион для немедленного решения"}] : []),
        {v:"refuse", t:"Отказаться — опцион сгорает"}
      ]},
      ...(buyers.length ? [{k:"buyerId", type:"select", label:"Покупатель опциона",
        options:buyers.map(player => ({v:player.id, t:player.name}))}] : []),
      {k:"salePrice", label:"Цена передачи опциона, $", value:0}
    ],
    validate:v => {
      if(v.action === "refuse") return null;
      if(v.action === "buy") return p.cash < deal.property.down ? "Наличными не хватает на первоначальный взнос" : null;
      const buyer = buyers.find(player => player.id === v.buyerId);
      return validatePositiveMoney(v.salePrice, "Цена опциона", true) ||
        (buyer && buyer.cash < v.salePrice ? "У покупателя не хватает наличных" : null);
    },
    preview:v => v.action === "refuse" ? '<div class="row"><span class="k">Опцион</span><span class="v neg">сгорит</span></div>' :
      deltaPreview(p, v.action === "transfer" ? v.salePrice : -deal.property.down,
        v.action === "buy" ? deal.property.cashflow : 0),
    submit:v => push({type:"RESOLVE_REAL_ESTATE_OPTION", playerId:p.id, optionId:option.id,
      action:v.action, buyerId:v.buyerId, salePrice:v.salePrice,
      label:v.action === "refuse" ? "Отказ от опциона на недвижимость" :
        (v.action === "transfer" ? "Опцион передан для немедленного решения" : "Опцион использован: " + deal.property.name)})
  });
}

function transferable202Assets(p){
  return []
    .concat(p.props.map(asset => ({v:"property:" + asset.id, t:"Недвижимость · " + asset.name})))
    .concat(p.otherAssets.filter(asset => asset.kind === "royalty")
      .map(asset => ({v:"royalty:" + asset.id, t:"Авторский доход · " + asset.name})));
}

function actTransfer202(p){
  const assets = transferable202Assets(p);
  const buyers = S.players.filter(player => player.id !== p.id);
  if(!assets.length || !buyers.length){ alert("Для сделки нужен разрешённый актив и другой игрок."); return; }
  openForm({
    title:"Сделка с игроком",
    intro:"Передаются недвижимость и авторские доходы. Кредит банка продавца не переходит.",
    fields:[
      {k:"asset", type:"select", label:"Актив", options:assets},
      {k:"buyerId", type:"select", label:"Покупатель", options:buyers.map(player => ({v:player.id, t:player.name}))},
      {k:"price", label:"Цена сделки, $", value:0}
    ],
    validate:v => validatePositiveMoney(v.price, "Цена", true) ||
      (buyers.find(player => player.id === v.buyerId)?.cash < v.price ? "У покупателя не хватает наличных" : null),
    preview:v => {
      const [assetType, assetId] = v.asset.split(":");
      const event = {type:"TRANSFER_202_ASSET", playerId:p.id, toPlayerId:v.buyerId,
        assetType, assetId, price:v.price};
      const buyer = buyers.find(player => player.id === v.buyerId);
      return '<div class="sub">Продавец · ' + esc(p.name) + "</div>" + eventDeltaPreview(p, event) +
        (buyer ? '<div class="sub">Покупатель · ' + esc(buyer.name) + "</div>" + eventDeltaPreview(buyer, event) : "");
    },
    submit:v => {
      const [assetType, assetId] = v.asset.split(":");
      push({type:"TRANSFER_202_ASSET", playerId:p.id, toPlayerId:v.buyerId, assetType, assetId,
        price:v.price, label:"Актив передан игроку за " + money(v.price)});
    }
  });
}

function actProperty202(p){
  if(!p.props.length){ alert("Недвижимости пока нет."); return; }
  openForm({
    title:"Операции с недвижимостью",
    fields:[
      {k:"operation", type:"select", label:"Операция", options:[
        {v:"repay", t:"Погасить ипотеку полностью"},
        {v:"split", t:"Продать часть земли"},
        {v:"exchange", t:"Обменять на объект того же типа"},
        {v:"insured", t:"Страховое событие"}
      ]},
      {k:"assetId", type:"select", label:"Объект", options:p.props.map(asset => ({v:asset.id, t:asset.name}))},
      {k:"acresSold", label:"Продано акров", value:0},
      {k:"salePrice", label:"Выручка / убыток, $", value:0},
      ...optionPropertyFields()
    ],
    validate:v => {
      const asset = p.props.find(item => item.id === v.assetId);
      if(!asset) return "Объект не найден";
      if(v.operation === "repay") return p.cash < asset.mortgage ? "Наличными не хватает для погашения ипотеки" : null;
      if(v.operation === "split"){
        if(asset.kind !== "land" || !Number.isFinite(Number(asset.acres)) || Number(asset.acres) <= 0){
          return "Для дробления выбери земельный участок с указанной площадью";
        }
        if(Number(asset.mortgage) !== 0) return "Сначала полностью погаси ипотеку участка";
        const error = validatePositiveMoney(v.acresSold, "Акры") ||
          validatePositiveMoney(v.salePrice, "Выручка", true);
        if(error) return error;
        return Number(v.acresSold) >= Number(asset.acres)
          ? "Проданная площадь должна быть меньше " + asset.acres + " акров"
          : null;
      }
      if(v.operation === "insured") return validatePositiveMoney(v.salePrice, "Убыток");
      return !v.name.trim() ? "Укажи новый объект" : validatePositiveMoney(v.price, "Цена") ||
        (asset.kind === "land" ? validatePositiveMoney(v.acres, "Площадь участка") : null);
    },
    preview:v => {
      const asset = p.props.find(item => item.id === v.assetId); if(!asset) return "";
      let event;
      if(v.operation === "repay"){
        event = {type:"REPAY_PROPERTY_MORTGAGE", playerId:p.id, assetId:asset.id};
      } else if(v.operation === "split"){
        event = {type:"SPLIT_LAND", playerId:p.id, assetId:asset.id,
          acresSold:v.acresSold, salePrice:v.salePrice};
      } else if(v.operation === "insured"){
        const jointKey = asset.jointId || asset.id;
        const playerIds = S.players.filter(owner => owner.props.some(item =>
          item.id === jointKey || item.jointId === jointKey)).map(owner => owner.id);
        event = {type:"INSURED_PROPERTY_EVENT", playerId:p.id, playerIds,
          assetId:jointKey, amount:v.salePrice};
      } else {
        event = {type:"EXCHANGE_PROPERTY", playerId:p.id, assetId:asset.id,
          replacement:{assetId:"preview", name:v.name.trim(), kind:asset.kind,
            price:v.price, down:v.down, mortgage:v.mortgage, cashflow:v.cashflow,
            ...(asset.kind === "land" ? {acres:v.acres,
              removeCashflowOnSplit:v.removeCashflow === "remove"} : {})}};
      }
      return eventDeltaPreview(p, event);
    },
    submit:v => {
      const asset = p.props.find(item => item.id === v.assetId); if(!asset) return;
      if(v.operation === "repay"){
        push({type:"REPAY_PROPERTY_MORTGAGE", playerId:p.id, assetId:asset.id,
          label:"Погашена ипотека: " + asset.name});
      } else if(v.operation === "split"){
        push({type:"SPLIT_LAND", playerId:p.id, assetId:asset.id, acresSold:v.acresSold, salePrice:v.salePrice,
          label:"Продана часть земли: " + v.acresSold + " акр."});
      } else if(v.operation === "insured"){
        const jointKey = asset.jointId || asset.id;
        const playerIds = S.players.filter(owner => owner.props.some(item =>
          item.id === jointKey || item.jointId === jointKey)).map(owner => owner.id);
        push({type:"INSURED_PROPERTY_EVENT", playerId:p.id, playerIds, assetId:jointKey, amount:v.salePrice,
          label:"Страховое событие: " + asset.name});
      } else {
        push({type:"EXCHANGE_PROPERTY", playerId:p.id, assetId:asset.id,
          replacement:{assetId:uid(), name:v.name.trim(), kind:asset.kind, price:v.price, down:v.down,
            mortgage:v.mortgage, cashflow:v.cashflow,
            ...(asset.kind === "land" ? {acres:v.acres, removeCashflowOnSplit:v.removeCashflow === "remove"} : {})},
          label:"Обмен недвижимости: " + asset.name + " → " + v.name.trim()});
      }
    }
  });
}

function actBankruptcy(p, mode){
  if(mode === "101"){
    if(!confirm("Объявить банкротство 101? Активы продаются Банку за половину первого взноса, затем пропускаются три хода.")) return;
    push({type:"DECLARE_101_BANKRUPTCY", playerId:p.id, counterId:"skip-turns",
      counterName:"Пропуск ходов", label:"Банкротство Cashflow 101"});
    return;
  }
  openForm({
    title:"Личное банкротство 202", ok:"Объявить",
    intro:"Банк выкупает недвижимость, акции, биржевые опционы и прочие активы. D2Y и роялти сохраняются.",
    fields:[{k:"proceeds", label:"Выручка Банка по официальным правилам, $", value:0}],
    validate:v => validatePositiveMoney(v.proceeds, "Выручка", true),
    preview:v => '<div class="row"><span class="k">Сначала в кредит банка</span><span class="v">' +
      money(Math.min(v.proceeds, p.bankLoan)) + '</span></div><div class="row"><span class="k">Непокрытый кредит</span><span class="v">будет списан</span></div>' +
      eventDeltaPreview(p, {type:"DECLARE_202_BANKRUPTCY", playerId:p.id,
        reason:"personal", proceeds:v.proceeds}),
    submit:v => push({type:"DECLARE_202_BANKRUPTCY", playerId:p.id, reason:"personal", proceeds:v.proceeds,
      counterId:"skip-turns", counterName:"Пропуск ходов",
      label:"Личное банкротство Cashflow 202"})
  });
}

function ownedCard(p, type, id){
  if(type === "stock") return p.stocks.find(item => item.id === id);
  if(type === "property") return p.props.find(item => item.id === id);
  if(type === "otherAsset") return p.otherAssets.find(item => item.id === id);
  if(type === "otherLiability") return p.otherLiabilities.find(item => item.id === id);
  if(type === "otherExpense") return p.otherExpenses.find(item => item.id === id);
  if(type === "ftBusiness") return p.ft?.businesses.find(item => item.id === id);
  return null;
}

function actEditOwnedCard(p, type, id){
  const card = ownedCard(p, type, id); if(!card) return;
  const officialFTBusiness = type === "ftBusiness" && is202(G);
  const specs = {
    stock:[["symbol", "Символ", "text"], ["qty", "Количество"], ["price", "Цена, $"], ["div", "Дивиденд / мес, $"]],
    property:[["name", "Название", "text"], ["price", "Цена, $"], ["down", "Первоначальный взнос, $"],
      ["mortgage", "Ипотека, $"], ["cashflow", "Денежный поток / мес, $"]],
    otherAsset:[["name", "Название", "text"], ["kind", "Вид актива", "kind"], ["cost", "Стоимость, $"], ["income", "Доход / мес, $"]],
    otherLiability:[["name", "Название", "text"], ["balance", "Остаток, $"], ["expense", "Расход / мес, $"]],
    otherExpense:[["name", "Название", "text"], ["amount", "Расход / мес, $"]],
    ftBusiness:[["name", "Название", "text"], ["price", "Цена, $"], ["down", "Первоначальный взнос, $"],
      ["mortgage", "Ипотека, $"], ["cashflow", "Доход / мес, $"]]
  };
  const fields = (specs[type] || []).map(([k, label, fieldType]) => {
    const franchiseCount = Array.isArray(card.franchises) ? card.franchises.length : 0;
    const value = officialFTBusiness && k === "price" ? card.basePrice ?? card.price
      : officialFTBusiness && k === "cashflow"
        ? card.baseCashflow ?? finiteNumber(card.cashflow) / (1 + franchiseCount)
        : card[k];
    return fieldType === "kind"
    ? {k, label, type:"select", value, options:[
      {v:"other", t:"Прочий актив"}, {v:"royalty", t:"Роялти / авторский доход"}
    ]}
    : {k, label, type:fieldType, value};
  });
  openForm({
    title:"Изменить карточку", fields,
    validate:v => {
      const textKey = type === "stock" ? "symbol" : "name";
      if(!String(v[textKey] || "").trim()) return "Укажи название";
      if(type === "stock") return validatePositiveMoney(v.qty, "Количество") ||
        (!Number.isInteger(Number(v.qty)) ? "Количество: укажи целое число" : null) ||
        validatePositiveMoney(v.price, "Цена", true) || validatePositiveMoney(v.div, "Дивиденд", true);
      if(type === "property" || type === "ftBusiness") return (
        validatePositiveMoney(v.price, "Цена", true) ||
        validatePositiveMoney(v.down, "Первоначальный взнос", true) ||
        validatePositiveMoney(v.mortgage, "Ипотека", true) ||
        (!Number.isFinite(Number(v.cashflow)) ? "Денежный поток: укажи число" : null) ||
        (Number(v.price) < Number(v.down) ? "Цена меньше первоначального взноса" : null));
      if(type === "otherAsset") return validatePositiveMoney(v.cost, "Стоимость", true) ||
        validatePositiveMoney(v.income, "Доход", true);
      if(type === "otherLiability") return validatePositiveMoney(v.balance, "Остаток", true) ||
        validatePositiveMoney(v.expense, "Расход", true);
      if(type === "otherExpense") return validatePositiveMoney(v.amount, "Расход", true);
      return null;
    },
    preview:v => eventDeltaPreview(p, {type:"UPDATE_OWNED_CARD", playerId:p.id,
      cardType:type, cardId:id, patch:v}),
    submit:v => push({type:"UPDATE_OWNED_CARD", playerId:p.id, cardType:type, cardId:id, patch:v,
      label:"Изменена карточка: " + (v.name || v.symbol)})
  });
}

function tableActions(p, ft, d){
  const mandatoryOwners = S.players.filter(owner => lockedShorts(owner).length);
  if(mandatoryOwners.length){
    const positions = lockedShorts(p);
    if(!positions.length) return [];
    const actions = positions.map(position =>
      ["📉", "Закрыть шорт " + position.symbol, () => actCloseShort(p, position), true]);
    if(needsShortLossCover(p)){
      if(p.stocks.length || p.props.length){
        actions.push(["💰", "Продать актив", () => actSell(p)]);
      }
      actions.push(["⚠️", "Личное банкротство", () => actShortBankruptcy(p)]);
    }
    return actions;
  }

  const actions = ft ? [
    ["💵","День CASHFLOW", () => actFTPayday(p), true],
    ["🏢","Купить бизнес", () => actFTBiz(p)],
    ["❤️","Благотворительность", () => actFTCharity(p)],
    ["⭐","Купить свою Мечту", () => actFTDream(p)],
    ["🔖","Жетон на чужую Мечту", () => actDreamToken(p)],
    ["✏️","Моя мечта", () => actSetDream(p)],
    ["🧾","Налоги / Суд", () => actLoseCash(p, "half", "Налоги / Суд")],
    ["💔","Развод", () => actLoseCash(p, "all", "Развод")],
    ["🧮","Счётчики карточек", () => actCardCounter(p)],
    ["➕","Разовый доход", () => actCash(p, "in")],
    ["➖","Прочий расход", () => actOtherExpense(p)]
  ] : [
    ["💵","Получка", () => actPayday(p), true],
    ["📈","Акции и фонды", () => actBuyStock(p)],
    ["🏠","Недвижимость", () => actBuyProp(p, "property")],
    ["🏢","Бизнес", () => actBuyProp(p, "business")],
    ["💰","Продать актив", () => actSell(p)],
    ["🔀","Дробление акций", () => actSplit(p)],
    ["🛍","Всякая всячина", () => actDoodad(p)],
    ["❤️","Благотворительность", () => actCharity(p)],
    ["👶","Ребёнок", () => actChild(p)],
    ["📉","Увольнение", () => actDownsized(p)],
    ["🏦","Взять кредит", () => actLoan(p)],
    ["✅","Погасить долг", () => actRepay(p)],
    ["🧾","Налоги / Суд", () => actLoseCash(p, "half", "Налоги / Суд")],
    ["💔","Развод", () => actLoseCash(p, "all", "Развод")],
    ["🧮","Счётчики карточек", () => actCardCounter(p)],
    ["➕","Разовый доход", () => actCash(p, "in")],
    ["➖","Прочий расход", () => actOtherExpense(p)],
    ["✏️","Моя мечта", () => actSetDream(p)]
  ];
  if(ft && is202(G)){
    const dreamAction = actions.find(action => action[1] === "Купить свою Мечту");
    if(dreamAction) dreamAction[1] = "Купить мечту";
    const businessAction = actions.find(action => action[1] === "Купить бизнес");
    const insertAt = businessAction ? actions.indexOf(businessAction) + 1 : 1;
    actions.splice(insertAt, 0,
      ["🔄","Выкупить бизнес", () => actFTTransferBusiness(p)],
      ["🏪","Добавить франшизу", () => actFTFranchise(p)]);
    const counters = actions.find(action => action[1] === "Счётчики карточек");
    if(counters) actions.splice(actions.indexOf(counters), 1);
  }
  if(is202(G)){
    if(!ft){
      const propertyAction = actions.find(action => action[1] === "Недвижимость");
      if(propertyAction){
        if(S.pendingRealEstateDeal){
          actions.splice(actions.indexOf(propertyAction), 1);
        } else if(oldestRealEstateOption(S)){
          propertyAction[1] = "Открыть сделку недвижимости";
          propertyAction[2] = () => actOfferRealEstateDeal(p);
        }
      }
      if(S.pendingRealEstateDeal && !oldestRealEstateOption(S) &&
         S.pendingRealEstateDeal.originalPlayerId === p.id){
        actions.push(["🏠", "Продолжить сделку недвижимости", () => actContinueRealEstateDeal(p), true]);
      }
      actions.push(["🎯","Купить опцион", () => actBuyOption(p)]);
      actions.push(["📉","Открыть шорт", () => actOpenShort(p)]);
      if(!S.pendingRealEstateDeal || p.realEstateOptions.length){
        actions.push(["🏘","Опцион на недвижимость", () => actRealEstateOption(p)]);
      }
      actions.push(["🔢","D2Y", () => actD2Y(p)]);
      actions.push(["🛡","Страховка", () => actInsurance(p)]);
      actions.push(["🏗","Операции с недвижимостью", () => actProperty202(p)]);
      actions.push(["🤝","Сделка с игроком", () => actTransfer202(p)]);
    }
    if(!ft) actions.push(["🌐","Рынок 202", () => actMarket202(p)]);
  }
  if(!ft && d.cashflow < 0 && p.cash + d.cashflow < 0){
    actions.push(["⚠️","Личное банкротство", () => actBankruptcy(p, is202(G) ? "202" : "101"), true]);
  }
  if(!ft && (is202(G) ? canEscape202(d) : d.canEscape)){
    actions.push(["🚀","Выйти на дорожку", () => actEnterFT(p), true]);
  }
  return actions;
}

function renderTable(){
  const p = player();
  if(!p) return;
  const ft = !!p.ft;
  const d = ft ? deriveFT(p) : derive(p);
  const flow = ft ? d.income : d.cashflow;

  $("#hdr-sub").textContent = modeTitle(G.mode) + " · " + p.name + " · " + (ft ? "скоростная дорожка" : p.professionTitle);

  $("#alerts").innerHTML = eventWarningsHTML() + warnings(p)
    .map(w => '<div class="note ' + w.level + '">' + w.text + "</div>").join("");

  $("#big").innerHTML =
    '<div><span>' + (ft ? "Доход в День CASHFLOW" : "Денежный поток") + '</span><b class="' + cls(flow) + '">' + signed(flow) + "</b></div>" +
    "<div><span>Наличные</span><b class=\"" + cls(p.cash) + "\">" + money(p.cash) + "</b></div>" +
    (ft
      ? '<div style="grid-column:1/-1"><span>До победы</span><b>' + money(d.left) + "/мес</b></div>"
      : '<div style="grid-column:1/-1"><span>Пассивный доход против общего расхода</span><b class="' +
        ((is202(G) ? canEscape202(d) : d.canEscape) ? "pos" : "") + '">' + money(d.passive) + " / " + money(d.totalExpenses) + "</b></div>");

  const badges = [];
  if(ft){
    if(p.ft.charity) badges.push('<span class="badge">🎲 Благотворительность: ' +
      (is202(G) ? "сейчас " + (p.ft.dice || 1) + " из 1–3 костей" : "1–3 кости до конца игры") + "</span>");
  } else {
    if(p.charityTurns > 0) badges.push('<span class="badge">🎲 Благотворительность: ' + counted(p.charityTurns, "ход", "хода", "ходов") + "</span>");
    if(p.skipTurns > 0)    badges.push('<span class="badge">⏭ Пропуск: ' + counted(p.skipTurns, "ход", "хода", "ходов") + "</span>");
    if(p.children > 0)     badges.push('<span class="badge">👶 Детей: ' + p.children + "</span>");
  }
  if(p.dream){
    badges.push('<span class="badge">⭐ ' + esc(p.dream.name) + ": " + money(dreamPrice(p)) +
      (p.dream.tokens ? " · жетонов " + p.dream.tokens : "") +
      (p.dream.bought ? " · куплена" : "") + "</span>");
  }
  $("#badges").innerHTML = badges.join("");

  const acts = tableActions(p, ft, d);

  $("#acts").innerHTML = acts.map((a, i) =>
    '<button class="act' + (a[3] ? " go" : "") + '" data-a="' + i + '"><i aria-hidden="true">' + a[0] + "</i>" + a[1] + "</button>").join("");
  $("#acts").querySelectorAll("[data-a]").forEach(el =>
    el.onclick = () => acts[Number(el.dataset.a)][2]());

  $("#report").innerHTML = "<h2>Финансовый отчёт</h2>" + (ft ? reportFT(p) : reportRatRace(p)) +
    renderCardCounters(p) + render202Tools(p);
  bind202Tools(p);
  bindOwnedCardTools(p);
}

function renderLog(){
  const names = {};
  S.players.forEach(p => names[p.id] = p.name);
  const items = G.events.slice().reverse();
  $("#log").innerHTML = items.length ? items.map((ev, reverseIndex) => {
    const operationNumber = G.events.length - reverseIndex;
    if(!ev || typeof ev !== "object"){
      return '<li><span class="t">Повреждённая операция № ' + operationNumber +
        "<em>Запись сохранена без изменений</em></span></li>";
    }
    return '<li><span class="t">' + esc(ev.label || ev.type || ("Повреждённая операция № " + operationNumber)) +
      "<em>" + esc(names[ev.playerId] || "—") + "</em></span>" +
      (ev.id ? '<button class="x" aria-label="Удалить операцию" data-del="' + esc(ev.id) + '">✕</button>' : "") + "</li>";
  }).join("")
    : '<li class="empty">Пока пусто.</li>';
  $("#log").querySelectorAll("[data-del]").forEach(el =>
    el.onclick = () => removeEvent(el.dataset.del));
}

function render(){
  renderChips();
  $("#scr-setup").classList.toggle("hide", G.screen !== "setup");
  $("#scr-table").classList.toggle("hide", G.screen !== "table");
  $("#scr-log").classList.toggle("hide", G.screen !== "log");
  $("#nav-log").textContent = G.screen === "log" ? "Назад" : "Журнал";

  if(G.screen === "setup"){ $("#hdr-sub").textContent = "новая партия · " + modeTitle(G.mode); renderSetup(); }
  else if(G.screen === "table") renderTable();
  else renderLog();
}

/* ---------- меню и запуск ---------- */

function menu(){
  openForm({
    title: "Партия",
    intro: "Версия " + esc(APP_VERSION) + " · " + modeTitle(G.mode),
    fields: [{k:"a", type:"select", label:"Что сделать", options:[
      {v:"export", t:"Выгрузить игру в файл"},
      {v:"import", t:"Загрузить игру из файла"},
      {v:"update", t:"Обновить приложение — забрать свежую версию"},
      {v:"reset",  t:"Начать новую партию"}
    ]}],
    ok: "Выполнить",
    submit: v => {
      if(v.a === "update"){
        // Обходим кэш: новый адрес заставляет браузер сходить на сервер.
        // Партия хранится отдельно и не теряется.
        location.href = location.pathname + "?obn=" + Date.now();
        return;
      }
      if(v.a === "export"){
        const blob = new Blob([serializeGameSave(G)], {type:"application/json"});
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "cashflow-partiya.json";
        a.click();
      } else if(v.a === "import"){
        const inp = document.createElement("input");
        inp.type = "file"; inp.accept = "application/json";
        inp.onchange = () => {
          const f = inp.files[0]; if(!f) return;
          const r = new FileReader();
          r.onload = () => {
            try {
              G = prepareImportedGame(JSON.parse(r.result));
              save(); recompute(); render();
            } catch(e){ alert("Не похоже на файл партии."); }
          };
          r.readAsText(f);
        };
        inp.click();
      } else if(v.a === "reset"){
        if(!confirm("Стереть партию и начать заново?")) return;
        G = {mode:"101", settings:{optionRounds:3, strictLots:false}, events:[], current:null, screen:"setup"};
        save(); recompute(); render();
      }
    }
  });
}

function init(){
  load();
  recompute();

  $("#np-mode").addEventListener("change", () => {
    if(G.events.some(ev => ev.type === "ADD_PLAYER")) return;
    captureSetupPortfolio();
    const config = createGameConfig($("#np-mode").value, {optionRounds:$("#np-rounds").value});
    G.mode = config.mode;
    G.settings = config.settings;
    save(); render();
  });
  $("#np-rounds").addEventListener("input", () => {
    if(G.mode !== "202-custom") return;
    const config = createGameConfig(G.mode, {optionRounds:$("#np-rounds").value});
    G.settings = config.settings;
    save();
  });
  $("#np-prof").addEventListener("change", () => {
    if(is202(G)) captureSetupPortfolio();
    renderSetup();
  });
  document.querySelectorAll("[data-add-portfolio]").forEach(button => button.onclick = () => {
    captureSetupPortfolio();
    const key = button.dataset.addPortfolio;
    G.setupPortfolio = G.setupPortfolio || emptyPortfolioDraft();
    G.setupPortfolio[key].push({});
    save(); renderPortfolioRows();
  });
  $("#np-add").onclick = () => {
    const name = $("#np-name").value.trim();
    if(!name){ alert("Как зовут игрока?"); return; }
    const id = uid();
    const professionId = $("#np-prof").value;
    let event;
    if(is202(G)){
      const portfolio = readSetupPortfolio(); // Берём свежий ввод, даже если сохранение ещё не завершилось.
      const error = validateSetupPortfolio(portfolio);
      if(error){ alert(error); return; }
      const dream = {name:$("#np-dream-name").value.trim(), price:Number($("#np-dream-price").value)};
      if(!dream.name){ alert("Для Cashflow 202 выбери свою Мечту."); return; }
      const dreamError = validatePositiveMoney(dream.price, "Стоимость Мечты");
      if(dreamError){ alert(dreamError); return; }
      event = buildAddPlayerEvent(G.mode, {playerId:id, name, professionId, dream, portfolio});
    } else {
      event = buildAddPlayerEvent(G.mode, {playerId:id, name, professionId});
    }
    push(event);
    delete G.setupPortfolio;
    $("#np-name").value = "";
    G.current = id; G.screen = "setup";
    save(); render();
  };
  $("#nav-log").onclick = () => { G.screen = G.screen === "log" ? "table" : "log"; render(); };
  $("#nav-menu").onclick = menu;

  render();
}

document.addEventListener("DOMContentLoaded", init);

"use strict";

/* ============================================================
   ИНТЕРФЕЙС
   ============================================================ */

const KEY = "cashflow-bankir-v1";

/* Версия приложения. При каждом обновлении сайта поднимай её здесь И в номерах
   ?v= у трёх тегов script в index.html — иначе браузер до десяти минут будет
   показывать старые файлы из кэша (GitHub Pages отдаёт Cache-Control: max-age=600). */
const APP_VERSION = "4 — 24 августа 2026";

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
    otherAssets: rows("otherAssets", ["name", "cost", "income"]),
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

function portfolioRow(kind, row){
  const field = (key, label, options) => '<div class="f"><label>' + label + '</label><input data-portfolio-field="' + key +
    '" type="' + (options?.text ? "text" : "number") + '"' +
    (options?.text ? "" : ' step="1" inputmode="numeric"') +
    ' value="' + esc(row[key] ?? "") + '"' + (options?.placeholder ? ' placeholder="' + esc(options.placeholder) + '"' : "") + "></div>";
  const fields = kind === "stocks"
    ? field("symbol", "Символ", {text:true, placeholder:"OK4U"}) + field("qty", "Количество") + field("price", "Цена, $") + field("div", "Дивиденд / мес, $")
    : kind === "properties"
      ? field("name", "Название", {text:true}) + field("price", "Цена, $") + field("down", "Первый взнос, $") + field("mortgage", "Ипотека, $ (необязательно)") + field("cashflow", "Денежный поток / мес, $")
      : kind === "otherAssets"
        ? field("name", "Название", {text:true}) + field("cost", "Стоимость, $") + field("income", "Доход / мес, $")
        : field("name", "Название", {text:true}) + field("balance", "Остаток долга, $") + field("expense", "Расход / мес, $");
  return '<div class="card" data-portfolio-row="' + kind + '" style="padding:10px;margin:8px 0"><div class="big">' + fields +
    '</div><button class="btn danger" type="button" data-remove-portfolio>Удалить</button></div>';
}

function readPortfolioRows(kind){
  const ids = {stocks:"#np-stocks", properties:"#np-properties", otherAssets:"#np-other-assets", otherLiabilities:"#np-other-liabilities"};
  const keys = kind === "stocks" ? ["symbol", "qty", "price", "div"] :
    kind === "properties" ? ["name", "price", "down", "mortgage", "cashflow"] :
    kind === "otherAssets" ? ["name", "cost", "income"] : ["name", "balance", "expense"];
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
  $("#np-stocks").innerHTML = (draft.stocks || []).map(row => portfolioRow("stocks", row)).join("");
  $("#np-properties").innerHTML = (draft.properties || []).map(row => portfolioRow("properties", row)).join("");
  $("#np-other-assets").innerHTML = (draft.otherAssets || []).map(row => portfolioRow("otherAssets", row)).join("");
  $("#np-other-liabilities").innerHTML = (draft.otherLiabilities || []).map(row => portfolioRow("otherLiabilities", row)).join("");
  $("#np-portfolio").querySelectorAll("input").forEach(el => el.addEventListener("input", captureSetupPortfolio));
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
  if(!S.players.some(p => p.id === G.current)) G.current = S.players.length ? S.players[0].id : null;
  G.screen = S.players.length ? (G.screen === "setup" ? "table" : G.screen) : "setup";
}

function push(ev){
  ev.id = uid();
  G.events.push(ev);
  save(); recompute(); render();
}

function removeEvent(id){
  const ev = G.events.find(e => e.id === id);
  if(!ev) return;
  if(ev.type === "ADD_PLAYER"){
    if(!confirm("Удалить игрока вместе со всеми его операциями?")) return;
    G.events = G.events.filter(e => e.playerId !== ev.playerId);
  } else {
    G.events = G.events.filter(e => e.id !== id);
  }
  save(); recompute(); render();
}

/* ---------- диалог с формой ---------- */

function openForm(cfg){
  const dlg = $("#dlg"), body = $("#dlg-body");
  const fields = cfg.fields || [];

  body.innerHTML =
    "<h3>" + esc(cfg.title) + "</h3>" +
    (cfg.intro ? '<p style="margin:-4px 0 12px;color:var(--muted);font-size:14px">' + cfg.intro + "</p>" : "") +
    fields.map(f => {
      const id = "f-" + f.k;
      if(f.type === "select"){
        return '<div class="f"><label for="' + id + '">' + esc(f.label) + "</label>" +
          '<select id="' + id + '" data-k="' + f.k + '">' +
          f.options.map(o => '<option value="' + esc(o.v) + '">' + esc(o.t) + "</option>").join("") +
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
function deltaPreview(p, dCash, dFlow){
  const before = p.ft ? deriveFT(p).income : derive(p).cashflow;
  const after = before + (dFlow || 0);
  let h = '<div class="row"><span class="k">Наличные</span><span class="v">' +
    money(p.cash) + " → <b class=\"" + cls(p.cash + dCash) + "\">" + money(p.cash + dCash) + "</b></span></div>";
  if(dFlow !== undefined && dFlow !== null){
    h += '<div class="row"><span class="k">' + (p.ft ? "Доход в День CASHFLOW" : "Денежный поток") +
      '</span><span class="v">' + money(before) + " → <b class=\"" + cls(after) + "\">" + money(after) + "</b></span></div>";
  }
  if(p.cash + dCash < 0){
    const hint = p.ft
      ? "Наличных не хватает — операция на дорожке недоступна"
      : "Наличных не хватает — понадобится кредит";
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
  openForm({
    title: isBiz ? "Покупка бизнеса" : "Покупка недвижимости",
    intro: "Наличными платится только первый взнос. Выплаты по ипотеке уже сидят в денежном потоке карточки.",
    fields: [
      {k:"name",     type:"text", label:"Название", placeholder: isBiz ? "Автомойка" : "Дом 3/2"},
      {k:"down",     label:"Первый взнос, $", value:0},
      {k:"price",    label:"Цена, $", value:0},
      {k:"cashflow", label:"Денежный поток в месяц, $", value:0}
    ],
    validate: v => (!v.name.trim() ? "Укажи название" :
      validatePositiveMoney(v.down, "Первый взнос") ||
      validatePositiveMoney(v.price, "Цена") ||
      validatePositiveMoney(v.cashflow, "Денежный поток", true) ||
      (v.price < v.down ? "Цена меньше первого взноса" : null) ||
      (p.cash < v.down ? "Наличными не хватает — сначала возьми кредит." : null)),
    preview: v => '<div class="row"><span class="k">Ипотека (пассив)</span><span class="v">' +
        money(v.price - v.down) + "</span></div>" +
        '<div class="row"><span class="k">ROI за год</span><span class="v">' +
        (v.down > 0 ? Math.round(v.cashflow * 12 / v.down * 100) + " %" : "—") + "</span></div>" +
        deltaPreview(p, -v.down, v.cashflow),
    submit: v => push({type:"BUY_PROPERTY", playerId:p.id, assetId:uid(), kind,
      name:v.name.trim(), down:v.down, price:v.price, cashflow:v.cashflow,
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
  if(p.children >= 3){ alert("Лимит игры — трое детей."); return; }
  openForm({
    title: "Родился ребёнок",
    preview: () => '<div class="row"><span class="k">Детей станет</span><span class="v">' +
      (p.children + 1) + "</span></div>" + deltaPreview(p, 0, -p.perChild),
    submit: () => push({type:"CHILD", playerId:p.id,
      label:"Родился ребёнок — расходы " + signed(-p.perChild) + "/мес"})
  });
}

function actDownsized(p){
  const sum = derive(p).totalExpenses;
  openForm({
    title: "Увольнение",
    intro: "Платишь банку сумму общего расхода и пропускаешь два хода. Привилегии благотворительности сгорают.",
    preview: () => deltaPreview(p, -sum, 0),
    submit: () => push({type:"DOWNSIZED", playerId:p.id, label:"Увольнение " + money(-sum)})
  });
}

function actLoan(p){
  openForm({
    title: "Кредит в банке",
    intro: "Кратно $1000 под 10 % в месяц. Выплаты — только проценты, тело долга они не уменьшают.",
    fields: [{k:"amount", label:"Сумма, $", value:1000, step:1000}],
    validate: v => (v.amount <= 0 || v.amount % 1000 !== 0 ? "Сумма должна быть кратна $1000" : null),
    preview: v => '<div class="row"><span class="k">Расход вырастет на</span><span class="v">' +
      money(v.amount * 0.1) + "/мес</span></div>" + deltaPreview(p, v.amount, -v.amount * 0.1),
    submit: v => push({type:"TAKE_LOAN", playerId:p.id, amount:v.amount,
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
        '<div class="row"><span class="k">Срок</span><span class="v">' + rounds + " тур.</span></div>" +
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
      money(v.qty * v.openPrice) + '</span></div><div class="row"><span class="k">Свободные наличные</span><span class="v">без изменений</span></div>',
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
  const price = position.mustClose ? position.closePrice : S.marketPrices[position.symbol];
  const result = shortResult(position, price);
  openForm({
    title:"Закрыть шорт " + position.symbol, ok:"Закрыть",
    intro:position.mustClose ? "Закрытие обязательно по первой появившейся цене." : "Закрытие короткой позиции.",
    validate:() => result < 0 && p.cash + result < 0
      ? "Наличных не хватает: продай активы или объяви личное банкротство. Банковский заём здесь недоступен."
      : null,
    preview:() => '<div class="row"><span class="k">Цена открытия → выкупа</span><span class="v">' +
      money(position.openPrice) + " → " + money(price) + '</span></div><div class="row total"><span class="k">Результат</span><span class="v ' +
      cls(result) + '">' + signed(result) + '</span></div><div class="row"><span class="k">Наличные</span><span class="v">' +
      money(p.cash) + " → <b class=\"" + cls(p.cash + result) + "\">" + money(p.cash + result) + "</b></span></div>" +
      (result < 0 && p.cash + result < 0
        ? '<div class="row"><span class="k neg">Продай активы или объяви личное банкротство</span><span class="v"></span></div>'
        : ""),
    submit:() => push({type:"CLOSE_SHORT", playerId:p.id, shortId:position.id, marketPrice:price,
      label:"Закрыт шорт " + position.symbol + ": " + signed(result)})
  });
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
      '<div class="row"><span class="k">Подъёмные наличными</span><span class="v">' + money(start) + "</span></div>" +
      '<div class="row total"><span class="k">Цель для победы</span><span class="v">' + money(start + 50000) + "/мес</span></div>",
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
  openForm({
    title: "Инвестиция в бизнес",
    fields: [
      {k:"name", type:"text", label:"Название бизнеса"},
      {k:"down", label:"Первый взнос, $", value:0},
      {k:"cashflow", label:"Денежный поток в месяц, $", value:0}
    ],
    validate: v => (!v.name.trim() ? "Укажи название" :
      validatePositiveMoney(v.down, "Первый взнос") ||
      validatePositiveMoney(v.cashflow, "Денежный поток", true) ||
      (p.cash < v.down ? "Наличными не хватает — кредит на дорожке недоступен." : null)),
    preview: v => deltaPreview(p, -v.down, v.cashflow),
    submit: v => push({type:"FT_BUY_BIZ", playerId:p.id, assetId:uid(),
      name:v.name.trim(), down:v.down, cashflow:v.cashflow,
      label:"Бизнес на дорожке: " + v.name.trim() + " (" + signed(v.cashflow) + "/мес)"})
  });
}

function actFTCharity(p){
  if(p.ft.charity){ alert("Благотворительность уже действует до конца игры."); return; }
  openForm({
    title: "Благотворительность",
    intro: "Не обязательна. Действует до конца игры: на каждом ходу выбираешь, кидать одну, две или три кости.",
    fields: [{k:"amount", label:"Сумма с карточки, $", value:100000, step:1000}],
    validate: v => validatePositiveMoney(v.amount, "Сумма") ||
      (p.cash < v.amount ? "Наличными не хватает — кредит на дорожке недоступен." : null),
    preview: v => deltaPreview(p, -v.amount, 0),
    submit: v => push({type:"FT_CHARITY", playerId:p.id, amount:v.amount,
      label:"Благотворительность на дорожке " + money(-v.amount) + " — 1–3 кости до конца игры"})
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

function actFTLose(p, share, title){
  openForm({
    title,
    preview: () => deltaPreview(p, share === "all" ? -p.cash : -Math.round(p.cash / 2), 0),
    submit: () => push({type:"FT_LOSE", playerId:p.id, share,
      label:title + " " + money(share === "all" ? -p.cash : -Math.round(p.cash / 2))})
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
  const hasPlayerEvent = G.events.some(ev => ev.type === "ADD_PLAYER");
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
  const row = (k, v, extra) => '<div class="row' + (extra || "") + '"><span class="k">' + k +
    '</span><span class="v">' + v + "</span></div>";

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
  h += row("Расходы на детей (" + p.children + ")", money(d.childExp));
  h += row("Кредит банка", money(d.bankPay));
  h += row("Общий расход", money(d.totalExpenses), " total");

  h += '<div class="sub">Активы</div>';
  h += row("Сбережения", money(p.savings));
  p.stocks.forEach(s => h += row(esc(s.symbol) + " × " + s.qty, money(s.price) + " / шт"));
  p.props.forEach(a => h += row(esc(a.name), "взнос " + money(a.down) + " · цена " + money(a.price)));
  p.otherAssets.forEach(a => h += row(esc(a.name), money(a.cost)));

  h += '<div class="sub">Пассивы</div>';
  DEBTS.forEach(dd => { if(l[dd.k] > 0) h += row(dd.n, money(l[dd.k])); });
  p.props.forEach(a => { if(a.mortgage > 0) h += row("Ипотека: " + esc(a.name), money(a.mortgage)); });
  p.otherLiabilities.forEach(a => h += row(esc(a.name), money(a.balance)));
  if(p.bankLoan > 0) h += row("Кредит банка", money(p.bankLoan));

  return h;
}

function reportFT(p){
  const f = deriveFT(p);
  const row = (k, v, extra) => '<div class="row' + (extra || "") + '"><span class="k">' + k +
    '</span><span class="v">' + v + "</span></div>";
  let h = '<div class="sub">Доход в День CASHFLOW</div>';
  h += row("Начальный пассивный доход", money(p.ft.startIncome));
  p.ft.businesses.forEach(b => h += row(esc(b.name), signed(b.cashflow)));
  h += row("Итого доход", money(f.income), " total");
  h += '<div class="sub">Победа</div>';
  h += row("Цель", money(f.target));
  h += row("Осталось набрать", money(f.left));
  if(p.dream){
    h += '<div class="sub">Мечта</div>';
    h += row(esc(p.dream.name), p.dream.bought ? "куплена" : money(dreamPrice(p)));
    h += row("Первоначальная стоимость", money(p.dream.base));
    h += row("Чужих жетонов", String(p.dream.tokens));
  }
  return h;
}

function render202Tools(p){
  if(!is202(G)) return "";
  let html = '<div class="sub tools202-title">Инструменты 202</div>';
  if(!p.options.length && !p.shorts.length){
    return html + '<div class="empty tools202-empty">Открытых биржевых опционов и коротких позиций нет.</div>';
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
      (option.remaining <= 0 ? " disabled" : "") + ">−1</button>" +
      '<button class="btn" data-option-plus="' + esc(option.id) + '">+1</button>' +
      (Number.isFinite(price) ? '<button class="btn primary" data-option-exercise="' + esc(option.id) + '"' +
        (payout <= 0 || option.remaining <= 0 ? " disabled" : "") + ">" +
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
      '<div class="instrument-actions"><button class="btn ' + (position.mustClose ? "danger" : "") +
      '" data-short-close="' + esc(position.id) + '">' + (position.mustClose ? "Подтвердить закрытие" : "Закрыть") + "</button></div></div>";
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

function renderTable(){
  const p = player();
  if(!p) return;
  const ft = !!p.ft;
  const d = ft ? deriveFT(p) : derive(p);
  const flow = ft ? d.income : d.cashflow;

  $("#hdr-sub").textContent = modeTitle(G.mode) + " · " + p.name + " · " + (ft ? "скоростная дорожка" : p.professionTitle);

  $("#alerts").innerHTML = warnings(p)
    .map(w => '<div class="note ' + w.level + '">' + w.text + "</div>").join("");

  $("#big").innerHTML =
    '<div><span>' + (ft ? "Доход в День CASHFLOW" : "Денежный поток") + '</span><b class="' + cls(flow) + '">' + signed(flow) + "</b></div>" +
    "<div><span>Наличные</span><b class=\"" + cls(p.cash) + "\">" + money(p.cash) + "</b></div>" +
    (ft
      ? '<div style="grid-column:1/-1"><span>До победы</span><b>' + money(d.left) + "/мес</b></div>"
      : '<div style="grid-column:1/-1"><span>Пассивный доход против общего расхода</span><b class="' +
        (d.canEscape ? "pos" : "") + '">' + money(d.passive) + " / " + money(d.totalExpenses) + "</b></div>");

  const badges = [];
  if(ft){
    if(p.ft.charity) badges.push('<span class="badge">🎲 Благотворительность: 1–3 кости до конца игры</span>');
  } else {
    if(p.charityTurns > 0) badges.push('<button class="badge" data-tick="charity">🎲 Благотворительность: ' + p.charityTurns + " хода — снять</button>");
    if(p.skipTurns > 0)    badges.push('<button class="badge" data-tick="skip">⏭ Пропуск ходов: ' + p.skipTurns + " — снять</button>");
    if(p.children > 0)     badges.push('<span class="badge">👶 Детей: ' + p.children + "</span>");
  }
  if(p.dream){
    badges.push('<span class="badge">⭐ ' + esc(p.dream.name) + ": " + money(dreamPrice(p)) +
      (p.dream.tokens ? " · жетонов " + p.dream.tokens : "") +
      (p.dream.bought ? " · куплена" : "") + "</span>");
  }
  $("#badges").innerHTML = badges.join("");
  $("#badges").querySelectorAll("[data-tick]").forEach(el => el.onclick = () => {
    push({type: el.dataset.tick === "charity" ? "TICK_CHARITY" : "TICK_SKIP", playerId:p.id,
      label: el.dataset.tick === "charity" ? "Ход с благотворительностью" : "Пропущен ход"});
  });

  const acts = ft ? [
    ["💵","День CASHFLOW", () => actFTPayday(p), true],
    ["🏢","Купить бизнес", () => actFTBiz(p)],
    ["❤️","Благотворительность", () => actFTCharity(p)],
    ["⭐","Купить свою Мечту", () => actFTDream(p)],
    ["🔖","Жетон на чужую Мечту", () => actDreamToken(p)],
    ["✏️","Моя мечта", () => actSetDream(p)],
    ["🧾","Налоговая проверка", () => actFTLose(p, "half", "Налоговая проверка")],
    ["⚖️","Судебный иск", () => actFTLose(p, "half", "Судебный иск")],
    ["💔","Развод", () => actFTLose(p, "all", "Развод")],
    ["➕","Разовый доход", () => actCash(p, "in")],
    ["➖","Разовый расход", () => actCash(p, "out")]
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
    ["➕","Разовый доход", () => actCash(p, "in")],
    ["➖","Разовый расход", () => actCash(p, "out")],
    ["✏️","Моя мечта", () => actSetDream(p)]
  ];
  if(is202(G)){
    if(!ft){
      acts.push(["🎯","Купить опцион", () => actBuyOption(p)]);
      acts.push(["📉","Открыть шорт", () => actOpenShort(p)]);
    }
    acts.push(["🌐","Рынок 202", () => actMarket202(p)]);
  }
  if(!ft && d.canEscape) acts.push(["🚀","Выйти на дорожку", () => actEnterFT(p), true]);

  $("#acts").innerHTML = acts.map((a, i) =>
    '<button class="act' + (a[3] ? " go" : "") + '" data-a="' + i + '"><i>' + a[0] + "</i>" + a[1] + "</button>").join("");
  $("#acts").querySelectorAll("[data-a]").forEach(el =>
    el.onclick = () => acts[Number(el.dataset.a)][2]());

  $("#report").innerHTML = "<h2>Финансовый отчёт</h2>" + (ft ? reportFT(p) : reportRatRace(p)) + render202Tools(p);
  bind202Tools(p);
}

function renderLog(){
  const names = {};
  S.players.forEach(p => names[p.id] = p.name);
  const items = G.events.slice().reverse();
  $("#log").innerHTML = items.length ? items.map(ev =>
    '<li><span class="t">' + esc(ev.label || ev.type) +
    "<em>" + esc(names[ev.playerId] || "—") + "</em></span>" +
    '<button class="x" data-del="' + ev.id + '">✕</button></li>').join("")
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
    save(); renderSetup();
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

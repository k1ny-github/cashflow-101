"use strict";

/* ============================================================
   ИНТЕРФЕЙС
   ============================================================ */

const KEY = "cashflow-bankir-v1";

/* Версия приложения. При каждом обновлении сайта поднимай её здесь И в номерах
   ?v= у трёх тегов script в index.html — иначе браузер до десяти минут будет
   показывать старые файлы из кэша (GitHub Pages отдаёт Cache-Control: max-age=600). */
const APP_VERSION = "5 — 29 августа 2026";

const GAME_MODES = [
  {v:"101", t:"Cashflow 101"},
  {v:"202-standard", t:"Cashflow 202 (стандарт)"},
  {v:"202-custom", t:"Cashflow 202 (кастомный)"}
];

function normalizeMode(mode){
  return (GAME_MODES.some(m => m.v === mode) ? mode : "101");
}

function normalizeOptionRounds(v){
  const n = Number(v);
  if(!Number.isFinite(n)) return 3;
  return Math.max(1, Math.round(n));
}

function modeSettings(mode, raw){
  if(mode === "202-standard") return {optionRounds:3, strictLots:true};
  if(mode === "202-custom"){
    return {optionRounds: normalizeOptionRounds(raw && raw.optionRounds), strictLots:false};
  }
  return {optionRounds:3, strictLots:false};
}

function defaultConfig(){
  return {mode:"101", settings:{optionRounds:3, strictLots:false}};
}

let G = {
  events: [],
  current: null,
  screen: "setup",
  ...defaultConfig()
};
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

function player(){ return S.players.find(p => p.id === G.current) || null; }

function isMode202(){ return G.mode !== "101"; }
function optionRoundLimit(){ return G.settings && Number.isFinite(G.settings.optionRounds) ? Number(G.settings.optionRounds) : 3; }
function modeTitle(mode){
  const m = GAME_MODES.find(x => x.v === mode);
  return m ? m.t : "Cashflow 101";
}

/* ---------- хранение ---------- */

function save(){
  try {
    localStorage.setItem(KEY, JSON.stringify({
      schemaVersion: 2,
      mode: G.mode,
      settings: G.settings,
      events: G.events,
      current: G.current
    }));
  }
  catch(e){ /* приватный режим — играем без автосохранения */ }
}

function normalizeSavedGame(d){
  const rawMode = normalizeMode(d && d.mode);
  return {
    mode: rawMode,
    settings: modeSettings(rawMode, d && d.settings),
    events: Array.isArray(d && d.events) ? d.events : [],
    current: d && d.current ? d.current : null
  };
}

function load(){
  try {
    const raw = localStorage.getItem(KEY);
    if(!raw) return;
    const d = JSON.parse(raw);
    const norm = normalizeSavedGame(d);
    G.mode = norm.mode;
    G.settings = norm.settings;
    G.events = norm.events;
    G.current = norm.current;
  } catch(e){ /* битое сохранение игнорируем */ }
}

function recompute(){
  S = reduceEvents(G.events);
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
    h += '<div class="row"><span class="k" style="color:var(--bad)">Наличных не хватает — понадобится кредит</span><span class="v"></span></div>';
  }
  return h;
}

function totalOpenOptions(){
  return S.players.reduce((s, p) => s + (Array.isArray(p.options) ? p.options.length : 0), 0);
}

function optionLabel(opt){
  const type = opt.type === "put" ? "пут" : "колл";
  return type + " " + esc(opt.symbol) + " K " + money(opt.strike) + " x" + opt.qty +
    (Number.isFinite(opt.remaining) ? " (× " + opt.remaining + ")" : "");
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
    validate: v => (!v.symbol.trim() ? "Укажи символ" : v.qty <= 0 ? "Количество должно быть больше нуля" : null),
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
    validate: v => (!v.name.trim() ? "Укажи название" : v.price < v.down ? "Цена меньше первого взноса" : null),
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
  if(!p.stocks.length){ alert("Нет акций."); return; }
  openForm({
    title: "Дробление акций",
    fields: [
      {k:"sel", type:"select", label:"Бумага",
       options:p.stocks.map(h => ({v:h.id, t:h.symbol + " — " + h.qty + " шт по " + money(h.price)}))},
      {k:"dir", type:"select", label:"Тип",
       options:[{v:"split", t:"Сплит 2:1 — акций вдвое больше"},
                {v:"reverse", t:"Обратный сплит 1:2 — акций вдвое меньше"}]}
    ],
    preview: v => {
      const h = p.stocks.find(x => x.id === v.sel); if(!h) return "";
      const q = v.dir === "split" ? h.qty * 2 : Math.floor(h.qty / 2);
      const pr = v.dir === "split" ? h.price / 2 : h.price * 2;
      return '<div class="row"><span class="k">Станет</span><span class="v">' +
        q + " шт по " + money(pr) + "</span></div>";
    },
    submit: v => {
      const h = p.stocks.find(x => x.id === v.sel); if(!h) return;
      push({type:"SPLIT", playerId:p.id, assetId:v.sel, direction:v.dir,
        label:(v.dir === "split" ? "Сплит 2:1 — " : "Обратный сплит 1:2 — ") + h.symbol});
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

function actBuyOption(p){
  if(!isMode202()){
    alert("Опционы в этой надстройке только для Cashflow 202.");
    return;
  }
  const remainingDefault = optionRoundLimit();
  openForm({
    title: "Покупка опциона",
    intro: "Оплата = премия сразу. Срок действия в раундах из настроек партии. " +
      "Используй «Снять раунд по опционам», когда наступает следующий круг игры.",
    fields: [
      {k:"type", type:"select", label:"Тип опциона", options:[
        {v:"call", t:"Call (покупка вверх)"},
        {v:"put", t:"Put (покупка вниз)"}
      ]},
      {k:"symbol", type:"text", label:"Тикер", placeholder:"AAPL"},
      {k:"strike", label:"Страйк/цена исполнения, $", value:0},
      {k:"premium", label:"Премия (разово), $", value:0},
      {k:"qty", label:"Количество", value:100}
    ],
    validate: v => (
      (!v.symbol.trim() ? "Укажи тикер" :
      v.strike <= 0 ? "Страйк должен быть больше 0" :
      v.premium < 0 ? "Премия не может быть отрицательной" :
      v.qty <= 0 ? "Количество должно быть больше 0" : null)
    ),
    preview: v => {
      return '<div class="row"><span class="k">Будет списано</span><span class="v">' +
        money(-Math.max(0, v.premium || 0)) + "</span></div>" +
        '<div class="row"><span class="k">Срок</span><span class="v">до ' +
        remainingDefault + " раундов</span></div>";
    },
    submit: v => {
      const premium = Math.max(0, v.premium || 0);
      if(premium > p.cash && !confirm("Недостаточно наличных для премии. Продолжить и уйти в минус, или добавить кредит?")){
        return;
      }
      push({type:"BUY_OPTION", playerId:p.id, optionId:uid(), symbol:v.symbol.trim(), typeOpt:v.type,
        strike:v.strike, premium, qty:v.qty, remaining:remainingDefault, sourceMode:G.mode,
        label:"Опцион " + (v.type === "call" ? "Call" : "Put") + " " + v.symbol.trim() + " — " + money(v.premium)});
    }
  });
}

function actExerciseOption(p){
  const options = Array.isArray(p.options) ? p.options : [];
  if(!options.length){ alert("У этого игрока нет открытых опционов."); return; }

  openForm({
    title: "Использование опциона",
    intro: "Задай рыночную цену для выбранного контракта.",
    fields: [
      {k:"optionId", type:"select", label:"Опцион", options:options.map(o => ({v:o.id, t:optionLabel(o)}))},
      {k:"marketPrice", label:"Текущая цена", value:0}
    ],
    preview: v => {
      const opt = options.find(x => x.id === v.optionId);
      if(!opt) return "";
      const payout = optionPayout(opt, v.marketPrice);
      return '<div class="row"><span class="k">Премия уже оплачена</span><span class="v">' +
        money(-opt.premium) + "</span></div>" +
        '<div class="row"><span class="k">Результат</span><span class="v">' +
        (payout > 0 ? "+" : "") + money(payout) + "</span></div>";
    },
    validate: v => (v.marketPrice <= 0 ? "Цена рынка должна быть больше 0" : null),
    submit: v => {
      const opt = options.find(x => x.id === v.optionId);
      if(!opt) return;
      push({type:"EXERCISE_OPTION", playerId:p.id, optionId:v.optionId, marketPrice:v.marketPrice,
        label:"Использован опцион " + optionPayout(opt, v.marketPrice) + " по " + money(v.marketPrice)});
    }
  });
}

function actRoundOptions(){
  if(!isMode202() || totalOpenOptions() === 0){ alert("Открытых опционов нет."); return; }
  push({type:"OPTION_ROUND", label:"Тик-округ по опционам"});
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
      if(v.sel !== "bank") return null;
      if(v.amount <= 0 || v.amount % 1000 !== 0) return "Сумма должна быть кратна $1000";
      if(v.amount > p.bankLoan) return "Больше, чем сам долг";
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

function actCash(p, dir){
  const inc = dir === "in";
  openForm({
    title: inc ? "Разовый доход" : "Разовый расход",
    fields: [
      {k:"title", type:"text", label:"Описание", placeholder: inc ? "Продажа права на сделку" : "Прочее"},
      {k:"amount", label:"Сумма, $", value:0}
    ],
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
    validate: v => (!v.name.trim() ? "Укажи название" : null),
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
    validate: v => (v.amount <= 0 ? "Укажи сумму" : null),
    preview: v => deltaPreview(p, -v.amount, 0),
    submit: v => push({type:"FT_CHARITY", playerId:p.id, amount:v.amount,
      label:"Благотворительность на дорожке " + money(-v.amount) + " — 1–3 кости до конца игры"})
  });
}

function actSetDream(p){
  openForm({
    title: p.dream ? "Сменить мечту" : "Моя мечта",
    intro: "Мечта выбирается в начале партии — на неё ставится Сыр. Купить её сможешь только ты, и это победа.",
    fields: [
      {k:"name", type:"text", label:"Название с розового поля",
       value: p.dream ? p.dream.name : "", placeholder:"Кругосветное путешествие"},
      {k:"price", label:"Первоначальная стоимость, $", value: p.dream ? p.dream.base : 0, step:1000}
    ],
    validate: v => (!v.name.trim() ? "Укажи мечту" : v.price <= 0 ? "Укажи стоимость" : null),
    preview: v => (p.dream && p.dream.tokens > 0
      ? '<div class="row"><span class="k">Жетоны обнулятся</span><span class="v">сейчас их ' + p.dream.tokens + "</span></div>"
      : '<div class="row"><span class="k">Цена, пока жетонов нет</span><span class="v">' + money(v.price) + "</span></div>"),
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
  const own = p.dream ? {id:"own", name:p.dream.name, owner:p, price: dreamPrice(p), own:true} : null;
  const others = S.players
    .filter(x => x.id !== p.id && x.dream && !x.dream.bought)
    .map(x => ({id:x.id, name:x.name, owner:x, price:dreamPrice(x), own:false}));

  const options = [];
  if(own && !own.owner.dream.bought) options.push({v:own.id, t:"Своя: " + esc(own.name) + " — " + money(own.price), data:own});
  others.forEach(x => options.push({v:x.id, t:"Чужая: " + esc(x.owner.name) + " — " + esc(x.name) + " — " + money(x.price), data:x}));

  if(!options.length){
    if(!p.dream){
      alert("Сначала задай свою мечту, потом можно будет покупать и чужие.");
      actSetDream(p);
    } else {
      alert("Сейчас нельзя купить ни одной мечты.");
    }
    return;
  }

  openForm({
    title: "Купить мечту",
    intro: "В 202 можно купить свою мечту или любую чужую (до покупки). Для победы нужно 2 чужие мечты или своя.",
    fields: [{k:"target", type:"select", label:"Что покупаем", options:options.map(x => ({v:x.v, t:x.t}))}],
    preview: v => {
      const item = options.find(x => x.v === v.target);
      if(!item) return "";
      const data = item.data;
      const price = data.price;
      return '<div class="row"><span class="k">К оплате</span><span class="v">' + money(price) + "</span></div>" +
        (data.own ? "" : '<div class="row"><span class="k">Владелец</span><span class="v">' + esc(data.owner.name) + "</span></div>") +
        deltaPreview(p, -price, 0);
    },
    submit: v => {
      if(v.target === "own"){
        const price = dreamPrice(p);
        if(p.dream.bought){ alert("Свою мечту уже купили."); return; }
        push({type:"FT_DREAM", playerId:p.id, label:"Куплена своя Мечта «" + p.dream.name + "» за " + money(price) + " — победа"});
        return;
      }
      const chosen = others.find(x => x.id === v.target);
      if(!chosen) return;
      push({type:"FT_OTHER_DREAM", playerId:p.id, ownerId:chosen.owner.id,
        label:"Куплена чужая мечта «" + chosen.owner.dream.name + "» игрока «" + chosen.owner.name + "» за " + money(chosen.price)});
    }
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
  const modeSel = $("#np-mode");
  const modeRound = $("#np-option-rounds");
  const modeRoundWrap = $("#np-option-rounds-wrap");

  if(!modeSel.options.length){
    modeSel.innerHTML = GAME_MODES.map(m => '<option value="' + m.v + '">' + esc(m.t) + "</option>").join("");
  }
  modeSel.value = G.mode || "101";

  if(!sel.options.length){
    sel.innerHTML = PROFESSIONS.map(p => '<option value="' + p.id + '">' + esc(p.title) + "</option>").join("");
  }
  $("#setup-mode-hint").textContent = modeTitle(G.mode) + (G.mode === "202-custom" ? ", " + optionRoundLimit() + " раундов опционов" : "");
  const prof = PROFESSIONS.find(x => x.id === sel.value) || PROFESSIONS[0];
  const tmp = blankPlayer("tmp", "tmp", prof);
  const d = derive(tmp);
  const hasPortfolio = ((prof.initialPortfolio && (
    (Array.isArray(prof.initialPortfolio.stocks) && prof.initialPortfolio.stocks.length) ||
    (Array.isArray(prof.initialPortfolio.properties) && prof.initialPortfolio.properties.length) ||
    Number(prof.initialPortfolio.cash || 0) !== 0
  )) ? true : false);
  $("#np-hint").innerHTML =
    "Зарплата " + money(prof.salary) + " · расход " + money(d.totalExpenses) +
    " · поток <b class=\"" + cls(d.cashflow) + "\">" + signed(d.cashflow) + "</b>" +
    " · на старте " + money(startingCash(tmp)) +
    (hasPortfolio ? "<br>Включён начальный инвестиционный портфель профессии" : "");

  modeRoundWrap.classList.toggle("hide", G.mode !== "202-custom");
  modeRound.value = optionRoundLimit();
  const locked = S.players.length > 0;
  modeSel.disabled = locked;
  modeRound.disabled = locked;

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
  h += row("Общий доход", money(d.totalIncome), " total");

  h += '<div class="sub">Расходы</div>';
  h += row("Налоги", money(e.taxes));
  h += row("Ипотека на дом", money(e.mortgage));
  h += row("Кредит на образование", money(e.school));
  h += row("Кредит на машину", money(e.car));
  h += row("Кредитные карточки", money(e.card));
  h += row("Мелкие кредиты", money(e.retail));
  h += row("Прочие расходы", money(e.other));
  h += row("Расходы на детей (" + p.children + ")", money(d.childExp));
  h += row("Кредит банка", money(d.bankPay));
  h += row("Общий расход", money(d.totalExpenses), " total");

  h += '<div class="sub">Активы</div>';
  h += row("Сбережения", money(p.savings));
  p.stocks.forEach(s => h += row(esc(s.symbol) + " × " + s.qty, money(s.price) + " / шт"));
  p.props.forEach(a => h += row(esc(a.name), "взнос " + money(a.down) + " · цена " + money(a.price)));

  h += '<div class="sub">Пассивы</div>';
  DEBTS.forEach(dd => { if(l[dd.k] > 0) h += row(dd.n, money(l[dd.k])); });
  p.props.forEach(a => { if(a.mortgage > 0) h += row("Ипотека: " + esc(a.name), money(a.mortgage)); });
  if(p.bankLoan > 0) h += row("Кредит банка", money(p.bankLoan));
  if(p.options && p.options.length){
    h += '<div class="sub">Открытые опционы</div>';
    p.options.forEach(o => {
      const payoutText = "остаток " + o.remaining + " · " + (o.type === "call" ? "Call" : "Put") +
        " " + esc(o.symbol) + ", K=" + money(o.strike) + ", x" + o.qty;
      h += row("Опцион", payoutText);
    });
  }

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
    if(Array.isArray(p.otherDreams) && p.otherDreams.length){
      h += row("Чужие мечты куплены", String(p.otherDreams.length));
      p.otherDreams.forEach(od => {
        h += row("— " + esc(od.name), "с игроком " + esc(od.ownerName) + " за " + money(od.price));
      });
    }
  }
  if(p.options && p.options.length){
    h += '<div class="sub">Открытые опционы</div>';
    p.options.forEach(o => {
      const payoutText = "остаток " + o.remaining + " · " + (o.type === "call" ? "Call" : "Put") +
        " " + esc(o.symbol) + ", K=" + money(o.strike) + ", x" + o.qty;
      h += row("Опцион", payoutText);
    });
  }
  return h;
}

function renderTable(){
  const p = player();
  if(!p) return;
  const ft = !!p.ft;
  const d = ft ? deriveFT(p) : derive(p);
  const flow = ft ? d.income : d.cashflow;

  $("#hdr-sub").textContent = p.name + " · " + (ft ? "скоростная дорожка" : p.professionTitle) +
    " · " + modeTitle(G.mode);

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
  if(totalOpenOptions() > 0){
    badges.push('<button class="badge" data-tick="optionsRound">📆 Опционных раундов: в игре ' +
      totalOpenOptions() + " · снять 1 для всех</button>");
  }
  $("#badges").innerHTML = badges.join("");
  $("#badges").querySelectorAll("[data-tick]").forEach(el => el.onclick = () => {
    if(el.dataset.tick === "charity"){
      push({type:"TICK_CHARITY", playerId:p.id, label:"Ход с благотворительностью"});
    } else if(el.dataset.tick === "skip"){
      push({type:"TICK_SKIP", playerId:p.id, label:"Пропущен ход"});
    } else if(el.dataset.tick === "optionsRound"){
      actRoundOptions();
    }
  });

  const acts = ft ? [
    ["💵","День CASHFLOW", () => actFTPayday(p), true],
    ["🏢","Купить бизнес", () => actFTBiz(p)],
    ["❤️","Благотворительность", () => actFTCharity(p)],
    ["⭐","Купить мечту", () => actFTDream(p)],
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
  if(isMode202()){
    if(ft){
      acts.splice(1, 0, ["📈","Купить опцион", () => actBuyOption(p)]);
      acts.splice(2, 0, ["⚖️","Использовать опцион", () => actExerciseOption(p)]);
    } else {
      acts.splice(3, 0, ["📊","Купить опцион", () => actBuyOption(p)]);
      acts.splice(4, 0, ["⚖️","Использовать опцион", () => actExerciseOption(p)]);
    }
  }
  if(!ft && d.canEscape) acts.push(["🚀","Выйти на дорожку", () => actEnterFT(p), true]);

  $("#acts").innerHTML = acts.map((a, i) =>
    '<button class="act' + (a[3] ? " go" : "") + '" data-a="' + i + '"><i>' + a[0] + "</i>" + a[1] + "</button>").join("");
  $("#acts").querySelectorAll("[data-a]").forEach(el =>
    el.onclick = () => acts[Number(el.dataset.a)][2]());

  $("#report").innerHTML = "<h2>Финансовый отчёт</h2>" + (ft ? reportFT(p) : reportRatRace(p));
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
    intro: "Версия " + esc(APP_VERSION),
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
        const blob = new Blob([JSON.stringify({
          schemaVersion: 2,
          mode: G.mode,
          settings: G.settings,
          events: G.events
        }, null, 2)], {type:"application/json"});
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
                const d = JSON.parse(r.result);
                const norm = normalizeSavedGame(d);
                if(!Array.isArray(norm.events)) throw 0;
                G.events = norm.events;
                G.current = norm.current;
                G.mode = norm.mode;
                G.settings = norm.settings;
                G.screen = "table";
                save(); recompute(); render();
              } catch(e){ alert("Не похоже на файл партии."); }
            };
          r.readAsText(f);
        };
        inp.click();
      } else if(v.a === "reset"){
        if(!confirm("Стереть партию и начать заново?")) return;
        G = {events:[], current:null, screen:"setup", ...defaultConfig()};
        save(); recompute(); render();
      }
    }
  });
}

function init(){
  load();
  recompute();

  $("#np-prof").addEventListener("change", renderSetup);
  $("#np-mode").addEventListener("change", () => {
    if(S.players.length) return;
    const sel = normalizeMode($("#np-mode").value);
    G.mode = sel;
    G.settings = modeSettings(sel, {optionRounds: normalizeOptionRounds($("#np-option-rounds").value)});
    save(); renderSetup();
  });
  $("#np-option-rounds").addEventListener("change", () => {
    if(S.players.length || G.mode !== "202-custom") return;
    G.settings = modeSettings(G.mode, {optionRounds: normalizeOptionRounds($("#np-option-rounds").value)});
    save(); renderSetup();
  });
  $("#np-add").onclick = () => {
    const name = $("#np-name").value.trim();
    if(!name){ alert("Как зовут игрока?"); return; }
    const prof = PROFESSIONS.find(x => x.id === $("#np-prof").value) || {};
    const id = uid();
    push({type:"ADD_PLAYER", playerId:id, name, professionId:$("#np-prof").value,
      initialPortfolio: prof.initialPortfolio || {},
      label:"В игру вошёл " + name + " — " + (prof.title || "").trim()});
    $("#np-name").value = "";
    G.current = id; G.screen = "setup";
    render();
  };
  $("#nav-log").onclick = () => { G.screen = G.screen === "log" ? "table" : "log"; render(); };
  $("#nav-menu").onclick = menu;

  render();
}

document.addEventListener("DOMContentLoaded", init);

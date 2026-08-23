"use strict";

/* Карточки профессий CASHFLOW 101.
   Врач сверен с карточкой из книги правил: доход 13 200, расход 9 650, поток 3 550.
   Остальные перенесены из прототипа cashflow_bankir и требуют сверки с карточками.
   Медсестры пока нет — карточка не найдена. */

const PROFESSIONS = [
  {id:"doctor", title:"Врач", salary:13200, savings:400, perChild:640,
   expenses:{taxes:3420, mortgage:1900, school:750, car:380, card:270, retail:50, other:2880},
   liabilities:{mortgage:202000, school:150000, car:19000, card:9000, retail:1000}},

  {id:"pilot", title:"Пилот авиалиний", salary:9500, savings:400, perChild:480,
   expenses:{taxes:2350, mortgage:1330, school:0, car:300, card:660, retail:50, other:2210},
   liabilities:{mortgage:143000, school:0, car:15000, card:22000, retail:1000}},

  {id:"lawyer", title:"Адвокат", salary:7500, savings:400, perChild:380,
   expenses:{taxes:1830, mortgage:1100, school:390, car:220, card:180, retail:50, other:1650},
   liabilities:{mortgage:115000, school:78000, car:11000, card:6000, retail:1000}},

  {id:"engineer", title:"Инженер", salary:4900, savings:400, perChild:250,
   expenses:{taxes:1050, mortgage:700, school:60, car:140, card:120, retail:50, other:1090},
   liabilities:{mortgage:75000, school:12000, car:7000, card:4000, retail:1000}},

  {id:"manager", title:"Менеджер", salary:4600, savings:400, perChild:240,
   expenses:{taxes:910, mortgage:700, school:60, car:120, card:90, retail:50, other:1000},
   liabilities:{mortgage:75000, school:12000, car:6000, card:3000, retail:1000}},

  {id:"teacher", title:"Учитель", salary:3300, savings:400, perChild:180,
   expenses:{taxes:630, mortgage:500, school:60, car:100, card:90, retail:50, other:760},
   liabilities:{mortgage:50000, school:12000, car:5000, card:3000, retail:1000}},

  {id:"police", title:"Офицер полиции", salary:3000, savings:520, perChild:160,
   expenses:{taxes:580, mortgage:400, school:0, car:100, card:60, retail:50, other:690},
   liabilities:{mortgage:46000, school:0, car:5000, card:2000, retail:1000}},

  {id:"truck", title:"Водитель грузовика", salary:2500, savings:750, perChild:140,
   expenses:{taxes:460, mortgage:400, school:0, car:80, card:60, retail:50, other:570},
   liabilities:{mortgage:38000, school:0, car:4000, card:2000, retail:1000}},

  {id:"secretary", title:"Секретарь", salary:2500, savings:710, perChild:140,
   expenses:{taxes:460, mortgage:400, school:0, car:80, card:60, retail:50, other:570},
   liabilities:{mortgage:38000, school:0, car:4000, card:2000, retail:1000}},

  {id:"mechanic", title:"Автомеханик", salary:2000, savings:670, perChild:110,
   expenses:{taxes:360, mortgage:300, school:0, car:60, card:60, retail:50, other:450},
   liabilities:{mortgage:31000, school:0, car:3000, card:2000, retail:1000}},

  {id:"janitor", title:"Дворник", salary:1600, savings:560, perChild:70,
   expenses:{taxes:280, mortgage:200, school:0, car:60, card:60, retail:50, other:300},
   liabilities:{mortgage:20000, school:0, car:4000, card:2000, retail:1000}}
];

/* Личные долги: ключ пассива, ключ расхода, название. */
const DEBTS = [
  {k:"mortgage", n:"Ипотека на дом"},
  {k:"school",   n:"Кредит на образование"},
  {k:"car",      n:"Кредит на машину"},
  {k:"card",     n:"Кредитные карточки"},
  {k:"retail",   n:"Мелкие кредиты"}
];

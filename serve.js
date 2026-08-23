/* Локальный сервер, чтобы зайти в приложение с телефона по Wi-Fi.
   Запуск:  node serve.js
   Ноутбук и телефон должны быть в одной сети. */

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = Number(process.argv[2]) || 8123;
const ROOT = __dirname;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md":   "text/markdown; charset=utf-8"
};

http.createServer((req, res) => {
  let name = decodeURIComponent(req.url.split("?")[0]);
  if(name === "/") name = "/index.html";

  const file = path.join(ROOT, name.replace(/^\/+/, ""));
  if(!file.startsWith(ROOT)){ res.writeHead(403); res.end("403"); return; }

  fs.readFile(file, (err, data) => {
    if(err){ res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, {"Content-Type": TYPES[path.extname(file)] || "application/octet-stream"});
    res.end(data);
  });
}).listen(PORT, "0.0.0.0", () => {
  const addrs = [];
  for(const list of Object.values(os.networkInterfaces())){
    for(const i of list || []){
      if(i.family === "IPv4" && !i.internal) addrs.push(i.address);
    }
  }
  console.log("На этом компьютере:  http://localhost:" + PORT);
  addrs.forEach(a => console.log("С телефона в той же сети:  http://" + a + ":" + PORT));
});

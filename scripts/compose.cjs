/* staves.html — the whole app in one file: the core bundled for the browser + the app script. */
const fs = require("fs");
const m = fs.readFileSync("dist/app2.js", "utf8");
const js = JSON.parse(m.match(/APP2_JS = ("[\s\S]*?");\nexport const APP2_HTML/)[1]);
const html = JSON.parse(m.match(/APP2_HTML = ("[\s\S]*?");\n/)[1]);
const bundle = fs.readFileSync("/tmp/standalone.js", "utf8");
const out = html
  .replace('<script src="./app2.js"></script>', () => "<script>" + bundle + "</script>\n<script>" + js.replace(/<\/script/g, "<\\/script") + "</script>")
  .replace("<title>staves</title>", () => "<title>staves — open this file</title>");
fs.writeFileSync("staves.html", out);
console.log((out.length / 1024 | 0) + " KB");

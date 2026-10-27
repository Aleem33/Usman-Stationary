const path = require("node:path"),
  fs = require("node:fs");
const root = path.join(__dirname, "..");
require("esbuild").buildSync({
  entryPoints: [path.join(root, "scripts/xlsx-browser.mjs")],
  bundle: true,
  format: "esm",
  platform: "browser",
  minify: true,
  legalComments: "eof",
  outfile: path.join(root, "server/public/xlsx-reader.mjs"),
});
fs.copyFileSync(
  path.join(root, "node_modules/read-excel-file/LICENSE"),
  path.join(root, "server/public/XLSX-LICENSE.txt"),
);

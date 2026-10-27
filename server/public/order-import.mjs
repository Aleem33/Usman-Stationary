export function csvRows(text) {
  const rows = [],
    row = [];
  let cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.trim())) rows.push([...row]);
      row.length = 0;
      cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("Unclosed quote in CSV file");
  row.push(cell);
  if (row.some((v) => v.trim())) rows.push(row);
  return rows;
}
export function matchRows(rows, items) {
  if (!rows.length || rows.length > 501)
    throw Error("Use a header and up to 500 product rows");
  const header = rows[0].map((v) =>
      String(v || "")
        .replace(/^\uFEFF/, "")
        .trim()
        .toLowerCase(),
    ),
    sku = header.findIndex((v) =>
      ["sku", "barcode", "product", "name"].includes(v),
    ),
    q = header.findIndex((v) => ["quantity", "qty"].includes(v)),
    u = header.indexOf("unit");
  if (sku < 0 || q < 0)
    throw Error(
      "Required columns: SKU (or name), quantity, unit (piece, pack or carton)",
    );
  const lines = [],
    errors = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i].some((v) => v != null && v !== "")) continue;
    const key = String(rows[i][sku] ?? "")
        .trim()
        .toLowerCase(),
      qty = Number(rows[i][q]),
      unit = String(u < 0 ? "piece" : rows[i][u] || "piece")
        .trim()
        .toLowerCase();
    const matches = items.filter(
      (p) => p.barcode.toLowerCase() === key || p.name.toLowerCase() === key,
    );
    if (
      matches.length !== 1 ||
      !Number.isFinite(qty) ||
      qty <= 0 ||
      !["piece", "pack", "carton"].includes(unit)
    ) {
      errors.push(
        "Row " +
          (i + 1) +
          ": " +
          (matches.length !== 1
            ? "unknown or ambiguous SKU/name " + key
            : "invalid quantity or unit"),
      );
      continue;
    }
    lines.push({ id: matches[0].id, qty, package: unit });
  }
  if (errors.length)
    throw Error(
      errors.slice(0, 12).join("\n") +
        (errors.length > 12 ? "\nMore rows need correction." : ""),
    );
  if (!lines.length) throw Error("No product rows found");
  return lines;
}
export async function importFile(file, items) {
  if (file.size > 1024 * 1024) throw Error("Use a file smaller than 1 MB");
  let rows;
  if (/\.xlsx$/i.test(file.name)) {
    const bytes = new Uint8Array(await file.arrayBuffer()),
      v = new DataView(bytes.buffer);
    let size = 0,
      count = 0;
    for (let i = 0; i + 46 < bytes.length; i++)
      if (v.getUint32(i, true) === 0x02014b50) {
        size += v.getUint32(i + 24, true);
        count++;
        if (size > 10 * 1024 * 1024 || count > 1000)
          throw Error(
            "Spreadsheet is too large when expanded. Use a smaller file.",
          );
        i +=
          45 +
          v.getUint16(i + 28, true) +
          v.getUint16(i + 30, true) +
          v.getUint16(i + 32, true);
      }
    const { readSheet } = await import("./xlsx-reader.mjs");
    rows = await readSheet(bytes.buffer);
  } else if (/\.csv$/i.test(file.name)) rows = csvRows(await file.text());
  else
    throw Error(
      "Choose a CSV or XLSX file. Keep SKU columns formatted as text.",
    );
  return matchRows(rows, items);
}

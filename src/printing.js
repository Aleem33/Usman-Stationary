import { emitToast } from "./toasts";
import { pkr, label, download } from "./api";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function page(content, paper = "A4") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>@page{size:${paper === "A4" ? "A4" : paper === "58mm" ? "58mm 250mm" : "80mm 297mm"};margin:${paper === "A4" ? "15mm" : "3mm"}}body{font:12px Arial;color:#111;max-width:${paper === "A4" ? "180mm" : paper === "58mm" ? "52mm" : "74mm"};margin:auto}h1{font-size:22px}h2{font-size:17px}p{line-height:1.6}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{padding:7px 3px;text-align:left;border-bottom:1px solid #ddd;overflow-wrap:anywhere}th{font-size:10px}.right{text-align:right}.totals{margin-left:auto;max-width:260px}.muted{color:#555}.label{display:inline-block;width:48mm;text-align:center;break-inside:avoid;margin:3mm}.label img{width:44mm;height:18mm}</style></head><body>${content}</body></html>`;
}
export function invoiceHTML(d, s = {}, paper = "A4") {
  return page(
    `<h1>${esc(s.business_name || "Usman Stationary")}</h1><p>${esc(s.address || "")}<br>${esc(s.phone || "")}</p><h2>${esc(label(d.type))} · ${esc(d.number)}</h2><p>${esc(d.date)}<br>Bill to: <b>${esc(d.party_name || "Walk-in customer")}</b><br>${esc(d.address || "")}<br>${esc(d.phone || "")}</p><table><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Total</th></tr></thead><tbody>${d.lines.map((l) => `<tr><td>${esc(l.name)}${l.discount ? "<br>Disc " + esc(pkr(l.discount)) : ""}${l.tax ? "<br>Tax " + esc(pkr(l.tax)) : ""}</td><td>${l.qty}</td><td>${esc(pkr(l.price))}</td><td>${esc(pkr(l.total))}</td></tr>`).join("")}</tbody></table><table class="totals">${[
      ["Subtotal", d.subtotal],
      ["Discount", -d.discount],
      ["Tax", d.tax],
      ["Total (PKR)", d.total],
      ["Paid / refunded", d.paid],
      ["Balance", d.total - d.paid],
    ]
      .map(
        ([k, v]) =>
          `<tr><td>${k}</td><td class="right">${esc(pkr(v))}</td></tr>`,
      )
      .join(
        "",
      )}</table><p>${esc(d.notes)}</p><p class="muted">${esc(s.invoice_footer || "Thank you for your business.")}</p>`,
    paper,
  );
}
export async function barcodeHTML(items, copies = 1) {
  const { default: bwipjs } = await import("bwip-js/browser");
  return page(
    items
      .flatMap((item) =>
        Array.from({ length: copies }, () => {
          const canvas = document.createElement("canvas");
          bwipjs.toCanvas(canvas, {
            bcid: "code128",
            text: item.barcode,
            scale: 3,
            height: 10,
            includetext: true,
            textxalign: "center",
          });
          return `<div class="label"><b>${esc(item.name)}</b><br><img src="${canvas.toDataURL()}"/><br>${esc(pkr(item.price))}</div>`;
        }),
      )
      .join(""),
  );
}
export async function printHTML(html, options = {}) {
  if (window.desktop) {
    const result = await window.desktop.print({ html, ...options });
    if (result?.saved) emitToast("PDF saved: " + result.path);
    else if (result?.printed) emitToast("Print job sent to the printer");
    else if (result?.canceled)
      emitToast("Printing or PDF export canceled", "info");
    return result;
  }
  const w = window.open("", "_blank");
  if (!w) throw Error("Allow pop-ups to print");
  w.document.write(html);
  w.document.close();
  emitToast("Print preview opened", "info");
  setTimeout(() => w.print(), 500);
  return { preview: true };
}
export function reportHTML(r, s) {
  return page(
    `<h1>${esc(s.business_name || "Usman Stationary")}</h1><h2>${esc(r.name)}</h2><p>${esc(r.from)} — ${esc(r.to)}</p><p>${esc(r.note)}</p><table><tr>${Object.keys(
      r.rows[0] || {},
    )
      .map((k) => `<th>${esc(k)}</th>`)
      .join("")}</tr>${r.rows
      .map(
        (row) =>
          "<tr>" +
          Object.values(row)
            .map(
              (v) =>
                `<td>${esc(typeof v === "number" ? v.toLocaleString("en-PK", { maximumFractionDigits: 2 }) : v)}</td>`,
            )
            .join("") +
          "</tr>",
      )
      .join("")}</table>`,
  );
}
export function exportCSV(r) {
  const safe = (v) => {
    const s = String(v ?? "");
    return (
      '"' + (/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') + '"'
    );
  };
  download(
    r.name + ".csv",
    "\uFEFF" +
      [Object.keys(r.rows[0] || {}), ...r.rows.map(Object.values)]
        .map((row) => row.map(safe).join(","))
        .join("\r\n"),
    "text/csv;charset=utf-8",
  );
  emitToast("Report CSV download started");
}

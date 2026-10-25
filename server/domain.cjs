const { reports } = require("./catalog.cjs");
const types = [
  "sale",
  "sale_return",
  "quotation",
  "sale_order",
  "purchase",
  "purchase_return",
  "purchase_order",
  "expense",
  "receipt",
  "payment",
  "transfer",
  "opening",
];
const prefixes = {
  sale: "INV",
  sale_return: "SR",
  quotation: "QT",
  sale_order: "SO",
  purchase: "PUR",
  purchase_return: "PR",
  purchase_order: "PO",
  expense: "EXP",
  receipt: "REC",
  payment: "PAY",
  transfer: "TRF",
  opening: "OB",
};
const money = (n) => {
  if (!Number.isFinite(Number(n)) || Number(n) < 0 || Number(n) > 1e10)
    throw Error("Enter a valid non-negative amount");
  return Math.round(Number(n) * 100);
};
const num = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) throw Error("Invalid number");
  return v;
};
function text(v, max = 200) {
  if (typeof v !== "string" || !v.trim() || v.length > max)
    throw Error("A valid value is required");
  return v.trim();
}
function date(v) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(v) ||
    new Date(v).toISOString().slice(0, 10) !== v
  )
    throw Error("Invalid date");
  return v;
}
async function transaction(db, fn) {
  return db.transaction(fn);
}
async function post(db, b) {
  return await transaction(db, async () => {
    if (!types.includes(b.type)) throw Error("Invalid document type");
    date(b.date);
    const type = b.type,
      account = b.account || "Cash";
    if (!["Cash", "Bank"].includes(account)) throw Error("Invalid account");
    const party = b.party_id
      ? await db
          .prepare("SELECT * FROM parties WHERE id=?")
          .get(Number(b.party_id))
      : null;
    if (b.party_id && !party) throw Error("Party not found");
    const financial = [
      "expense",
      "receipt",
      "payment",
      "transfer",
      "opening",
    ].includes(type);
    const isSale = ["sale", "sale_return"].includes(type),
      isPurchase = ["purchase", "purchase_return"].includes(type);
    const isReturn = type.endsWith("_return");
    const sign = isReturn ? -1 : 1;
    let reference = null;
    if (isReturn) {
      reference = await db
        .prepare("SELECT * FROM documents WHERE id=?")
        .get(Number(b.reference_id));
      if (!reference || reference.type !== (isSale ? "sale" : "purchase"))
        throw Error("Select the original invoice for this return");
      if ((party?.id || null) !== reference.party_id)
        throw Error("Return party must match original invoice");
    }
    let lines = [],
      subtotal = 0,
      discount = 0,
      tax = 0,
      cost = 0;
    if (!financial) {
      if (!Array.isArray(b.lines) || !b.lines.length || b.lines.length > 300)
        throw Error("Add at least one item (maximum 300)");
      const seen = new Set();
      for (const input of b.lines) {
        const item = await db
          .prepare("SELECT * FROM items WHERE id=?")
          .get(Number(input.item_id));
        if (!item) throw Error("Item not found");
        if (seen.has(item.id))
          throw Error("Combine duplicate items into one row");
        seen.add(item.id);
        const qty = num(input.qty);
        if (qty <= 0 || qty > 1e7) throw Error("Quantity must be positive");
        if (Math.abs(qty * 1000 - Math.round(qty * 1000)) > 0.000001)
          throw Error("Quantity supports at most three decimal places");
        let price = money(input.price),
          unitCost = item.cost;
        if (isReturn) {
          const original = await db
            .prepare("SELECT * FROM lines WHERE document_id=? AND item_id=?")
            .get(reference.id, item.id);
          if (!original) throw Error("Item is not on original invoice");
          const returned = (
            await db
              .prepare(
                "SELECT COALESCE(SUM(l.qty),0) qty FROM lines l JOIN documents d ON d.id=l.document_id WHERE d.reference_id=? AND d.type=? AND l.item_id=?",
              )
              .get(reference.id, type, item.id)
          ).qty;
          if (qty + returned > original.qty + 0.000001)
            throw Error("Return exceeds original quantity");
          price = original.price;
          unitCost = Math.round(original.cost / original.qty);
        }
        const base = Math.round(qty * price);
        if (!Number.isSafeInteger(base))
          throw Error("Line amount is too large");
        let disc, tx;
        if (isReturn) {
          const original = await db
            .prepare("SELECT * FROM lines WHERE document_id=? AND item_id=?")
            .get(reference.id, item.id);
          disc = Math.round((original.discount * qty) / original.qty);
          tx = Math.round((original.tax * qty) / original.qty);
        } else {
          const dv = num(input.discount || 0),
            tv = num(input.tax || 0);
          if (dv < 0 || tv < 0 || tv > 10000)
            throw Error("Invalid tax or discount");
          if (input.discount_mode === "percent" && dv > 100)
            throw Error("Discount cannot exceed 100%");
          disc =
            input.discount_mode === "percent"
              ? Math.round((base * dv) / 100)
              : money(dv);
          if (disc > base) throw Error("Discount exceeds line amount");
          tx =
            input.tax_mode === "amount"
              ? money(tv)
              : Math.round(((base - disc) * tv) / 100);
        }
        let lineCost = Math.round(
          qty * (isPurchase && !isReturn ? price : unitCost),
        );
        if (type === "sale_return") {
          const original = await db
            .prepare("SELECT * FROM lines WHERE document_id=? AND item_id=?")
            .get(reference.id, item.id);
          lineCost = Math.round((original.cost * qty) / original.qty);
        }
        if (type === "purchase_return") lineCost = Math.round(qty * item.cost);
        lines.push({
          item,
          qty,
          price,
          cost: lineCost,
          discount: disc,
          tax: tx,
          total: base - disc + tx,
        });
        subtotal += base;
        discount += disc;
        tax += tx;
        cost += lineCost;
      }
    }
    const total = financial ? money(b.amount) : subtotal - discount + tax;
    if (financial && total <= 0)
      throw Error("Amount must be greater than zero");
    const informational = [
      "quotation",
      "sale_order",
      "purchase_order",
    ].includes(type);
    const paid = financial ? total : informational ? 0 : money(b.paid || 0);
    if (!Number.isSafeInteger(total) || !Number.isSafeInteger(cost))
      throw Error("Document amount is too large");
    if (paid > total) throw Error("Paid amount exceeds total");
    if (!financial && !informational && total > paid && !party)
      throw Error("Select a party for a credit transaction");
    if (["receipt", "payment"].includes(type) && !party)
      throw Error("Select a party");
    if (
      type === "transfer" &&
      (!["Cash", "Bank"].includes(b.to_account) || b.to_account === account)
    )
      throw Error("Choose a different destination account");
    const last = await db
      .prepare("SELECT number FROM documents ORDER BY id DESC LIMIT 1")
      .get();
    const next = last
      ? Number(last.number.slice(last.number.lastIndexOf("-") + 1)) + 1
      : 1;
    if (!Number.isSafeInteger(next) || next < 1)
      throw Error("Invalid document number sequence");
    const number = prefixes[type] + "-" + String(next).padStart(6, "0");
    const id = Number(
      (
        await db
          .prepare(
            "INSERT INTO documents(number,type,date,party_id,account,subtotal,discount,tax,total,paid,cost,notes,category,reference_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            number,
            type,
            b.date,
            party?.id || null,
            account,
            subtotal,
            discount,
            tax,
            total,
            paid,
            cost,
            String(b.notes || "").slice(0, 1000),
            String(b.category || "General").slice(0, 100),
            reference?.id || null,
          )
      ).lastInsertRowid,
    );
    async function ledger(acc, debit, credit) {
      if (debit < 0) {
        credit -= debit;
        debit = 0;
      }
      if (credit < 0) {
        debit -= credit;
        credit = 0;
      }
      if (debit || credit)
        await db
          .prepare(
            "INSERT INTO ledger(document_id,date,account,debit,credit,party_id,memo) VALUES(?,?,?,?,?,?,?)",
          )
          .run(id, b.date, acc, debit, credit, party?.id || null, number);
    }
    for (const l of lines) {
      await db
        .prepare(
          "INSERT INTO lines(document_id,item_id,name,category,qty,price,cost,discount,tax,total,batch,serial) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          l.item.id,
          l.item.name,
          l.item.category,
          l.qty,
          l.price,
          l.cost,
          l.discount,
          l.tax,
          l.total,
          l.item.batch,
          l.item.serial,
        );
      if (isSale || isPurchase) {
        const change = (isSale ? -1 : 1) * sign * l.qty;
        if (l.item.stock + change < -0.000001)
          throw Error("Insufficient stock: " + l.item.name);
        let newCost = l.item.cost;
        if (type === "purchase" && l.item.stock + l.qty > 0)
          newCost = Math.round(
            (l.item.stock * l.item.cost + l.cost - l.discount) /
              (l.item.stock + l.qty),
          );
        if (type === "sale_return" && l.item.stock + l.qty > 0)
          newCost = Math.round(
            (l.item.stock * l.item.cost + l.cost) / (l.item.stock + l.qty),
          );
        await db
          .prepare("UPDATE items SET stock=stock+?,cost=? WHERE id=?")
          .run(change, newCost, l.item.id);
        await db
          .prepare(
            "INSERT INTO movements(document_id,item_id,date,qty,cost) VALUES(?,?,?,?,?)",
          )
          .run(id, l.item.id, b.date, change, l.cost);
      }
    }
    if (isSale) {
      await ledger(account, sign * paid, 0);
      await ledger("Accounts receivable", sign * (total - paid), 0);
      await ledger("Sales", 0, sign * (subtotal - discount));
      await ledger("Tax payable", 0, sign * tax);
      await ledger("Cost of goods sold", sign * cost, 0);
      await ledger("Inventory", 0, sign * cost);
    }
    if (isPurchase) {
      await ledger(
        "Inventory",
        sign * (isReturn ? cost : subtotal - discount),
        0,
      );
      if (isReturn)
        await ledger("Purchase price variance", 0, subtotal - discount - cost);
      await ledger("Tax recoverable", sign * tax, 0);
      await ledger(account, 0, sign * paid);
      await ledger("Accounts payable", 0, sign * (total - paid));
    }
    if (type === "expense") {
      await ledger("Expenses", total, 0);
      await ledger(account, 0, total);
    }
    if (type === "receipt") {
      await ledger(account, total, 0);
      await ledger("Accounts receivable", 0, total);
    }
    if (type === "payment") {
      await ledger("Accounts payable", total, 0);
      await ledger(account, 0, total);
    }
    if (type === "transfer") {
      await ledger(account, 0, total);
      await ledger(b.to_account, total, 0);
    }
    if (type === "opening") {
      await ledger(account, total, 0);
      await ledger("Opening equity", 0, total);
    }
    const balance = (
      await db
        .prepare(
          "SELECT COALESCE(SUM(debit-credit),0) n FROM ledger WHERE document_id=?",
        )
        .get(id)
    ).n;
    if (balance !== 0) throw Error("Accounting entries do not balance");
    await db
      .prepare("INSERT INTO audit(action,detail) VALUES(?,?)")
      .run("document.created", number);
    return await getDocument(db, id);
  });
}
async function getDocument(db, id) {
  const d = await db
    .prepare(
      "SELECT d.*,p.name party_name,p.phone,p.address FROM documents d LEFT JOIN parties p ON p.id=d.party_id WHERE d.id=?",
    )
    .get(Number(id));
  if (!d) throw Error("Document not found");
  return {
    ...d,
    lines: await db
      .prepare("SELECT * FROM lines WHERE document_id=?")
      .all(d.id),
  };
}
async function saveItem(db, b) {
  return await transaction(db, async () => {
    const name = text(b.name),
      barcode = text(b.barcode || String(Date.now())),
      category = text(b.category || "General"),
      cost = money(b.cost),
      price = money(b.price),
      stock = num(b.stock || 0),
      min = num(b.min_stock ?? 5);
    if (stock < 0 || min < 0) throw Error("Stock cannot be negative");
    if (
      [stock, min].some(
        (q) => Math.abs(q * 1000 - Math.round(q * 1000)) > 0.000001,
      )
    )
      throw Error("Stock supports at most three decimal places");
    if (
      stock > 1e7 ||
      min > 1e7 ||
      !Number.isSafeInteger(Math.round(stock * cost))
    )
      throw Error("Stock value is too large");
    if (!/^[\x20-\x7e]{1,80}$/.test(barcode))
      throw Error("Use 1–80 printable ASCII characters for Code 128 barcodes");
    if (b.id) {
      const old = await db
        .prepare("SELECT * FROM items WHERE id=?")
        .get(Number(b.id));
      if (!old) throw Error("Item not found");
      await db
        .prepare(
          "UPDATE items SET name=?,barcode=?,category=?,unit=?,price=?,min_stock=?,batch=?,serial=? WHERE id=?",
        )
        .run(
          name,
          barcode,
          category,
          text(b.unit || "pcs"),
          price,
          min,
          String(b.batch || ""),
          String(b.serial || ""),
          old.id,
        );
      return old.id;
    }
    const id = Number(
      (
        await db
          .prepare(
            "INSERT INTO items(name,barcode,category,unit,cost,price,stock,min_stock,batch,serial) VALUES(?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            name,
            barcode,
            category,
            text(b.unit || "pcs"),
            cost,
            price,
            stock,
            min,
            String(b.batch || ""),
            String(b.serial || ""),
          )
      ).lastInsertRowid,
    );
    if (stock) {
      const day = new Date().toLocaleDateString("en-CA", {
          timeZone: "Asia/Karachi",
        }),
        value = Math.round(stock * cost);
      await db
        .prepare("INSERT INTO movements(item_id,date,qty,cost) VALUES(?,?,?,?)")
        .run(id, day, stock, value);
      await db
        .prepare(
          "INSERT INTO ledger(date,account,debit,credit,memo) VALUES(?,?,?,?,?)",
        )
        .run(day, "Inventory", value, 0, "Opening stock");
      await db
        .prepare(
          "INSERT INTO ledger(date,account,debit,credit,memo) VALUES(?,?,?,?,?)",
        )
        .run(day, "Opening equity", 0, value, "Opening stock");
    }
    return id;
  });
}
module.exports = {
  post,
  getDocument,
  saveItem,
  money,
  text,
  date,
  transaction,
  types,
  reports,
};

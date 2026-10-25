const { reports } = require("./catalog.cjs");
async function report(db, name, f = {}) {
  if (!Object.values(reports).flat().includes(name))
    throw Error("Unknown report");
  const from = f.from || "0001-01-01",
    to = f.to || "9999-12-31",
    party = Number(f.party_id) || null,
    item = Number(f.item_id) || null;
  const docs = await db
    .prepare(
      "SELECT d.*,COALESCE(p.name,'Walk-in') party FROM documents d LEFT JOIN parties p ON p.id=d.party_id WHERE d.date BETWEEN ? AND ? AND (? IS NULL OR d.party_id=?) ORDER BY d.date DESC,d.id DESC",
    )
    .all(from, to, party, party);
  const lines = await db
    .prepare(
      "SELECT l.*,d.number,d.type,d.date,d.party_id,COALESCE(p.name,'Walk-in') party FROM lines l JOIN documents d ON d.id=l.document_id LEFT JOIN parties p ON p.id=d.party_id WHERE d.date BETWEEN ? AND ? AND (? IS NULL OR d.party_id=?) AND (? IS NULL OR l.item_id=?)",
    )
    .all(from, to, party, party, item, item);
  const entries = await db
    .prepare(
      "SELECT l.*,COALESCE(p.name,'—') party FROM ledger l LEFT JOIN parties p ON p.id=l.party_id WHERE l.date BETWEEN ? AND ? AND (? IS NULL OR l.party_id=?) ORDER BY l.date,l.id",
    )
    .all(from, to, party, party);
  const allEntries = await db
    .prepare("SELECT * FROM ledger WHERE date<=?")
    .all(to);
  const items = await db
    .prepare("SELECT * FROM items WHERE (? IS NULL OR id=?)")
    .all(item, item);
  const sgn = (t) => (t.endsWith("_return") ? -1 : 1);
  const trade = (t) =>
    ["sale", "purchase", "sale_return", "purchase_return"].includes(t);
  const sales = (t) => ["sale", "sale_return"].includes(t);
  const docRows = (list) =>
    list.map((d) => ({
      Date: d.date,
      Number: d.number,
      Type: d.type,
      Party: d.party,
      Account: d.account,
      Net: d.subtotal / 100,
      Discount: d.discount / 100,
      Tax: d.tax / 100,
      Total: d.total / 100,
      Paid: d.paid / 100,
    }));
  const lineRows = (list) =>
    list.map((l) => ({
      Date: l.date,
      Number: l.number,
      Party: l.party,
      Item: l.name,
      Category: l.category,
      Quantity: l.qty,
      Rate: l.price / 100,
      Discount: l.discount / 100,
      Tax: l.tax / 100,
      Total: l.total / 100,
    }));
  function group(list, key, values) {
    const out = new Map();
    for (const r of list) {
      const label = key(r);
      if (!out.has(label))
        out.set(label, {
          Group: label,
          ...Object.fromEntries(Object.keys(values).map((k) => [k, 0])),
        });
      for (const [k, fn] of Object.entries(values)) out.get(label)[k] += fn(r);
    }
    return [...out.values()].map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k,
          typeof v === "number" ? Math.round(v * 100) / 100 : v,
        ]),
      ),
    );
  }
  const accounts = (list) =>
    group(list, (r) => r.account, {
      Debit: (r) => r.debit / 100,
      Credit: (r) => r.credit / 100,
      Balance: (r) => (r.debit - r.credit) / 100,
    });
  const profit = (list) =>
    group(list, (l) => l.name, {
      Quantity: (l) => sgn(l.type) * l.qty,
      Sales: (l) => (sgn(l.type) * (l.total - l.tax)) / 100,
      Cost: (l) => (sgn(l.type) * l.cost) / 100,
      Profit: (l) => (sgn(l.type) * (l.total - l.tax - l.cost)) / 100,
    });
  let rows = [];
  let note =
    "Amounts in PKR. Dates use the business date entered on each document.";
  switch (name) {
    case "Sale Report":
      rows = docRows(docs.filter((d) => sales(d.type)));
      break;
    case "Purchase Report":
      rows = docRows(
        docs.filter((d) => ["purchase", "purchase_return"].includes(d.type)),
      );
      break;
    case "Day Book":
    case "All Transactions":
      rows = entries.map((e) => ({
        Date: e.date,
        Reference: e.memo,
        Account: e.account,
        Party: e.party,
        Debit: e.debit / 100,
        Credit: e.credit / 100,
      }));
      break;
    case "Bill Wise Profit":
      rows = docs
        .filter((d) => sales(d.type))
        .map((d) => ({
          Date: d.date,
          Invoice: d.number,
          Party: d.party,
          Revenue: (sgn(d.type) * (d.total - d.tax)) / 100,
          Cost: (sgn(d.type) * d.cost) / 100,
          Profit: (sgn(d.type) * (d.total - d.tax - d.cost)) / 100,
        }));
      break;
    case "Profit & Loss": {
      const sum = (a) =>
        entries
          .filter((e) => e.account === a)
          .reduce((n, e) => n + e.debit - e.credit, 0) / 100;
      const revenue = -sum("Sales"),
        cost = sum("Cost of goods sold") + sum("Purchase price variance"),
        expenses = sum("Expenses");
      rows = [
        {
          Account: "Net sales",
          Amount: revenue,
        },
        {
          Account: "Cost of goods sold",
          Amount: -cost,
        },
        {
          Account: "Gross profit",
          Amount: revenue - cost,
        },
        {
          Account: "Expenses",
          Amount: -expenses,
        },
        {
          Account: "Net profit",
          Amount: revenue - cost - expenses,
        },
      ];
      break;
    }
    case "Cashflow":
      rows = accounts(
        entries.filter((e) => ["Cash", "Bank"].includes(e.account)),
      );
      break;
    case "Trial Balance":
      rows = accounts(allEntries);
      note =
        "Cumulative through the end date; Balance = debit − credit. Total balance must be zero.";
      break;
    case "Balance Sheet": {
      rows = accounts(allEntries).filter(
        (r) =>
          ![
            "Sales",
            "Expenses",
            "Cost of goods sold",
            "Purchase price variance",
          ].includes(r.Group),
      );
      const result =
        allEntries
          .filter((e) =>
            [
              "Sales",
              "Expenses",
              "Cost of goods sold",
              "Purchase price variance",
            ].includes(e.account),
          )
          .reduce((n, e) => n + e.debit - e.credit, 0) / 100;
      rows.push({
        Group: "Current earnings (credit)",
        Debit: 0,
        Credit: -result,
        Balance: result,
      });
      note =
        "Cumulative through end date. Assets are debit balances; liabilities and equity are credit balances.";
      break;
    }
    case "Party Statement": {
      const relevant = entries.filter((e) =>
        ["Accounts receivable", "Accounts payable"].includes(e.account),
      );
      let balance =
        (
          await db
            .prepare(
              "SELECT COALESCE(SUM(debit-credit),0) n FROM ledger WHERE date<? AND account IN ('Accounts receivable','Accounts payable') AND (? IS NULL OR party_id=?)",
            )
            .get(from, party, party)
        ).n / 100;
      rows = [
        {
          Date: from,
          Party: "Opening balance",
          Reference: "",
          Debit: 0,
          Credit: 0,
          Balance: balance,
        },
        ...relevant.map((e) => ({
          Date: e.date,
          Party: e.party,
          Reference: e.memo,
          Debit: e.debit / 100,
          Credit: e.credit / 100,
          Balance: (balance += (e.debit - e.credit) / 100),
        })),
      ];
      break;
    }
    case "Party Wise Profit & Loss":
      rows = group(
        lines.filter((l) => sales(l.type)),
        (l) => l.party,
        {
          Revenue: (l) => (sgn(l.type) * (l.total - l.tax)) / 100,
          Cost: (l) => (sgn(l.type) * l.cost) / 100,
          Profit: (l) => (sgn(l.type) * (l.total - l.tax - l.cost)) / 100,
        },
      );
      break;
    case "All Parties Report":
      rows = (await db.prepare("SELECT * FROM parties").all()).map((p) => ({
        Name: p.name,
        Type: p.kind,
        Phone: p.phone,
        Receivable:
          allEntries
            .filter(
              (e) => e.party_id === p.id && e.account === "Accounts receivable",
            )
            .reduce((n, e) => n + e.debit - e.credit, 0) / 100,
        Payable:
          allEntries
            .filter(
              (e) => e.party_id === p.id && e.account === "Accounts payable",
            )
            .reduce((n, e) => n + e.credit - e.debit, 0) / 100,
      }));
      break;
    case "Party Report by Items":
    case "Item Report by Party":
      rows = group(
        lines.filter((l) => trade(l.type)),
        (l) => `${l.party} / ${l.name} / ${l.type}`,
        {
          Quantity: (l) => sgn(l.type) * l.qty,
          Total: (l) => (sgn(l.type) * l.total) / 100,
        },
      );
      break;
    case "Sale/Purchase by Party":
      rows = group(
        docs.filter((d) => trade(d.type)),
        (d) => d.party,
        {
          Sales: (d) => (sales(d.type) ? (sgn(d.type) * d.total) / 100 : 0),
          Purchases: (d) =>
            !sales(d.type) ? (sgn(d.type) * d.total) / 100 : 0,
        },
      );
      break;
    case "Stock Summary Report":
    case "Low Stock Summary Report":
    case "Item Detail Report":
    case "Item Batch Report":
    case "Item Serial Report": {
      const movements = await db
        .prepare("SELECT * FROM movements WHERE date<=?")
        .all(to);
      rows = items
        .map((i) => ({
          ...i,
          stock: movements
            .filter((m) => m.item_id === i.id)
            .reduce((n, m) => n + m.qty, 0),
        }))
        .filter(
          (i) => name !== "Low Stock Summary Report" || i.stock <= i.min_stock,
        )
        .map((i) => ({
          Item: i.name,
          Barcode: i.barcode,
          Category: i.category,
          Unit: i.unit,
          Stock: i.stock,
          "Current cost": i.cost / 100,
          "Stock value": (i.stock * i.cost) / 100,
          "Sale price": i.price / 100,
          Minimum: i.min_stock,
          ...(name === "Item Batch Report"
            ? {
                Batch: i.batch || "Unassigned",
              }
            : {}),
          ...(name === "Item Serial Report"
            ? {
                Serial: i.serial || "Unassigned",
              }
            : {}),
        }));
      note =
        "Stock quantity is as of end date; valuation uses the current weighted average cost. Batch and serial values are item-level identifiers.";
      break;
    }
    case "Item Wise Profit & Loss":
      rows = profit(lines.filter((l) => sales(l.type)));
      break;
    case "Stock Detail Report":
      rows = (
        await db
          .prepare(
            "SELECT m.date,i.name,d.number,m.qty,m.cost FROM movements m JOIN items i ON i.id=m.item_id LEFT JOIN documents d ON d.id=m.document_id WHERE m.date BETWEEN ? AND ? AND (? IS NULL OR i.id=?) ORDER BY m.date,m.id",
          )
          .all(from, to, item, item)
      ).map((m) => ({
        Date: m.date,
        Item: m.name,
        Reference: m.number || "Opening stock",
        Quantity: m.qty,
        Cost: m.cost / 100,
      }));
      break;
    case "Sale/Purchase By Item Category":
      rows = group(
        lines.filter((l) => trade(l.type)),
        (l) => l.category,
        {
          Sales: (l) => (sales(l.type) ? (sgn(l.type) * l.total) / 100 : 0),
          Purchases: (l) =>
            !sales(l.type) ? (sgn(l.type) * l.total) / 100 : 0,
        },
      );
      break;
    case "Stock summary By Item Category":
      rows = group(items, (l) => l.category, {
        Quantity: (l) => l.stock,
        Value: (l) => (l.stock * l.cost) / 100,
      });
      note = "Current stock at current weighted average cost.";
      break;
    case "Item Wise Discount":
      rows = group(
        lines.filter((l) => trade(l.type)),
        (l) => l.name,
        {
          Discount: (l) => (sgn(l.type) * l.discount) / 100,
        },
      );
      break;
    case "Bank Statement": {
      let balance =
        allEntries
          .filter((e) => e.account === "Bank" && e.date < from)
          .reduce((n, e) => n + e.debit - e.credit, 0) / 100;
      rows = [
        {
          Date: from,
          Reference: "Opening balance",
          Deposit: 0,
          Withdrawal: 0,
          Balance: balance,
        },
        ...entries
          .filter((e) => e.account === "Bank")
          .map((e) => ({
            Date: e.date,
            Reference: e.memo,
            Deposit: e.debit / 100,
            Withdrawal: e.credit / 100,
            Balance: (balance += (e.debit - e.credit) / 100),
          })),
      ];
      break;
    }
    case "Discount Report":
      rows = docRows(docs.filter((d) => trade(d.type) && d.discount > 0));
      break;
    case "Tax Report":
      rows = docs
        .filter((d) => trade(d.type))
        .map((d) => ({
          Date: d.date,
          Reference: d.number,
          Type: d.type,
          Party: d.party,
          Taxable: (sgn(d.type) * (d.subtotal - d.discount)) / 100,
          Tax: (sgn(d.type) * d.tax) / 100,
        }));
      break;
    case "Tax Rate Report":
      rows = group(
        lines.filter((l) => trade(l.type)),
        (l) =>
          `${l.type}: ${l.price * l.qty - l.discount ? ((l.tax / (l.price * l.qty - l.discount)) * 100).toFixed(2) : "0"}% effective`,
        {
          Taxable: (l) => (sgn(l.type) * (l.qty * l.price - l.discount)) / 100,
          Tax: (l) => (sgn(l.type) * l.tax) / 100,
        },
      );
      note = "Effective rates include fixed amount taxes.";
      break;
    case "Expense Transaction Report":
      rows = docRows(docs.filter((d) => d.type === "expense"));
      break;
    case "Expense Category Report":
      rows = group(
        docs.filter((d) => d.type === "expense"),
        (d) => d.category,
        {
          Amount: (d) => d.total / 100,
          Transactions: () => 1,
        },
      );
      break;
    case "Expense Item Report":
      rows = docs
        .filter((d) => d.type === "expense")
        .map((d) => ({
          Date: d.date,
          Number: d.number,
          Category: d.category,
          Description: d.notes || "Expense",
          Account: d.account,
          Amount: d.total / 100,
        }));
      break;
    case "Sale/Purchase Order Transaction Report":
      rows = docRows(
        docs.filter((d) => ["sale_order", "purchase_order"].includes(d.type)),
      );
      break;
    case "Sale/Purchase Order Item Report":
      rows = lineRows(
        lines.filter((l) => ["sale_order", "purchase_order"].includes(l.type)),
      );
      break;
  }
  return {
    name,
    rows,
    note,
    from,
    to,
  };
}
module.exports = {
  report,
};

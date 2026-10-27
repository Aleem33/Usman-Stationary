const { money } = require("./domain.cjs");
const GROUPS = ["public", "retailer", "school", "large_buyer"];
const defaults = () => ({
  headline: "Everyday essentials.\nExceptional possibilities.",
  subtitle:
    "Stationery, school supplies and office essentials, thoughtfully stocked for your next big idea.",
  announcement: "Retail & wholesale · Orders reviewed personally by our team",
  banner_title: "Stock up. Spend smarter.",
  banner_text:
    "Build your order by the piece, pack or carton. Explore quantity pricing across the catalog.",
  products: {},
  groups: {},
  bulk: { min_total: 0, percent: 0 },
});
const number = (v, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max)
    throw Error("Enter a valid value between " + min + " and " + max);
  return n;
};
const image = (v) => {
  if (!v) return "";
  const u = new URL(v);
  if (u.protocol !== "https:") throw Error("Use an HTTPS image URL");
  return u.href.slice(0, 1000);
};
async function config(db) {
  const row = await db
    .prepare("SELECT payload FROM store_settings WHERE id=1")
    .get();
  return row ? { ...defaults(), ...JSON.parse(row.payload) } : defaults();
}
function validateConfig(b) {
  const c = defaults();
  for (const k of [
    "headline",
    "subtitle",
    "announcement",
    "banner_title",
    "banner_text",
  ])
    c[k] = String(b[k] ?? c[k])
      .trim()
      .slice(0, 300);
  if (Object.keys(b.products || {}).length > 10000)
    throw Error("Too many product rules");
  for (const [id, p] of Object.entries(b.products || {})) {
    if (!/^\d+$/.test(id)) throw Error("Invalid product");
    const pack_size = number(p.pack_size ?? 1, 1, 100000),
      carton_size = number(p.carton_size ?? 1, 1, 100000),
      min_qty = number(p.min_qty ?? 0.001, 0.001, 100000);
    if (
      !Number.isInteger(pack_size) ||
      !Number.isInteger(carton_size) ||
      Math.abs(min_qty * 1000 - Math.round(min_qty * 1000)) > 0.000001
    )
      throw Error(
        "Use whole pack/carton sizes and up to three decimals for minimum quantities",
      );
    if (carton_size > 1 && (carton_size < pack_size || carton_size % pack_size))
      throw Error("Carton size must be a multiple of pack size");
    const tiers = (p.tiers || [])
      .map((t) => ({
        min_qty: number(t.min_qty, 1, 100000),
        price: money(t.price),
      }))
      .sort((a, b) => a.min_qty - b.min_qty);
    if (
      tiers.length > 20 ||
      new Set(tiers.map((t) => t.min_qty)).size !== tiers.length
    )
      throw Error("Use up to 20 unique quantity breaks");
    c.products[id] = {
      pack_size,
      carton_size,
      min_qty,
      featured: !!p.featured,
      new_arrival: !!p.new_arrival,
      image: image(p.image),
      tiers,
    };
  }
  for (const g of GROUPS.filter((g) => g !== "public")) {
    const v = b.groups?.[g] || {};
    const prices = {};
    for (const [id, rate] of Object.entries(v.prices || {})) {
      if (!/^\d+$/.test(id)) throw Error("Invalid price-list product");
      prices[id] = money(rate);
    }
    c.groups[g] = { discount: number(v.discount || 0, 0, 100), prices };
  }
  c.bulk = {
    min_total: money(b.bulk?.min_total || 0),
    percent: number(b.bulk?.percent || 0, 0, 100),
  };
  if (c.bulk.percent && !c.bulk.min_total)
    throw Error("Set a minimum subtotal for the bulk discount");
  return c;
}
function editable(c) {
  return {
    ...c,
    products: Object.fromEntries(
      Object.entries(c.products).map(([id, p]) => [
        id,
        { ...p, tiers: p.tiers.map((t) => ({ ...t, price: t.price / 100 })) },
      ]),
    ),
    groups: Object.fromEntries(
      Object.entries(c.groups).map(([g, p]) => [
        g,
        {
          ...p,
          prices: Object.fromEntries(
            Object.entries(p.prices || {}).map(([id, price]) => [
              id,
              price / 100,
            ]),
          ),
        },
      ]),
    ),
    bulk: { ...c.bulk, min_total: c.bulk.min_total / 100 },
  };
}
function rule(c, id) {
  return {
    pack_size: 1,
    carton_size: 1,
    min_qty: 0.001,
    tiers: [],
    ...(c.products[id] || {}),
  };
}
function rate(item, c, customer, qty) {
  const p = rule(c, item.id);
  let price = item.price;
  for (const t of p.tiers) if (qty >= t.min_qty) price = t.price;
  const group =
    customer?.status === "active" ? c.groups[customer.segment] : null;
  if (group) {
    if (group.prices?.[item.id] != null)
      price = Math.min(price, group.prices[item.id]);
    price = Math.round(price * (1 - (group.discount || 0) / 100));
  }
  return price;
}
function product(item, c, customer) {
  const p = rule(c, item.id);
  const tiers = [...new Set([1, ...p.tiers.map((t) => t.min_qty)])]
    .sort((a, b) => a - b)
    .map((min_qty) => ({ min_qty, price: rate(item, c, customer, min_qty) }));
  return {
    ...item,
    price: rate(item, c, customer, 1),
    retail_price: item.price,
    min_qty: p.min_qty,
    pack_size: p.pack_size,
    carton_size: p.carton_size,
    pack_price: rate(item, c, customer, p.pack_size) * p.pack_size,
    carton_price: rate(item, c, customer, p.carton_size) * p.carton_size,
    tiers,
    featured: !!p.featured,
    new_arrival: !!p.new_arrival,
    image: p.image || "",
  };
}
function priceLines(items, inputs, c, customer, role) {
  let subtotal = 0;
  const lines = inputs.map((l) => {
    const item = items.find((i) => i.id === l.item_id);
    if (!item)
      throw Error(
        "A selected product is no longer available. Refresh the catalog.",
      );
    const p = rule(c, item.id),
      unit = l.package || "piece";
    if (!["piece", "pack", "carton"].includes(unit))
      throw Error("Invalid packaging option");
    const size =
      unit === "pack" ? p.pack_size : unit === "carton" ? p.carton_size : 1;
    if (unit !== "piece" && (size <= 1 || !Number.isInteger(l.qty)))
      throw Error(
        "Choose an available pack/carton option and whole package quantities",
      );
    const qty = l.qty * size;
    if (
      !Number.isFinite(qty) ||
      qty > 100000 ||
      Math.abs(qty * 1000 - Math.round(qty * 1000)) > 0.000001
    )
      throw Error("Quantity is too large or too precise");
    if (role === "customer" && qty < p.min_qty)
      throw Error(
        item.name + ": minimum order is " + p.min_qty + " " + item.unit,
      );
    const price = role === "supplier" ? l.price : rate(item, c, customer, qty),
      total = Math.round(qty * price);
    subtotal += total;
    return {
      item_id: item.id,
      name: item.name,
      barcode: item.barcode,
      unit: item.unit,
      qty,
      price,
      total,
      discount: 0,
      package: unit,
      package_qty: l.qty,
      package_size: size,
    };
  });
  if (!Number.isSafeInteger(subtotal) || subtotal > 1e12)
    throw Error("Request value is too large");
  let discount =
      role === "customer" && c.bulk.percent && subtotal >= c.bulk.min_total
        ? Math.round((subtotal * c.bulk.percent) / 100)
        : 0,
    allocated = 0;
  const denominator = BigInt(subtotal || 1),
    remainders = new Map();
  lines.forEach((l) => {
    const weighted = BigInt(discount) * BigInt(l.total);
    l.discount = Number(weighted / denominator);
    remainders.set(l, weighted % denominator);
    allocated += l.discount;
  });
  const ranked = [...lines].sort((a, b) =>
    remainders.get(a) === remainders.get(b)
      ? 0
      : remainders.get(a) > remainders.get(b)
        ? -1
        : 1,
  );
  for (const line of ranked) {
    if (allocated >= discount) break;
    if (line.discount < line.total) {
      line.discount++;
      allocated++;
    }
  }
  lines.forEach((l) => {
    l.total -= l.discount;
  });
  return { lines, subtotal, discount, total: subtotal - discount };
}
module.exports = {
  GROUPS,
  defaults,
  config,
  validateConfig,
  editable,
  rule,
  rate,
  product,
  priceLines,
};

import { importFile } from "./order-import.mjs";
const $ = (id) => document.getElementById(id),
  rs = (n) =>
    "Rs " +
    (Number(n) / 100).toLocaleString("en-PK", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }),
  cart = new Map(),
  quick = new Map();
let items = [],
  data = null,
  sending = false,
  authMode = "login",
  noticeTimer;
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const itemBy = (id) => items.find((i) => i.id === id),
  size = (i, u) =>
    u === "pack" ? i.pack_size : u === "carton" ? i.carton_size : 1,
  base = (i, l) => Number(l.qty) * size(i, l.package),
  rate = (i, q) => {
    let p = i.price;
    for (const t of i.tiers) if (q >= t.min_qty) p = t.price;
    return p;
  };
async function request(path, body) {
  const r = await fetch("/api/storefront/" + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  let d;
  try {
    d = await r.json();
  } catch {
    throw Error("The store is temporarily unavailable. Please try again.");
  }
  if (!r.ok) throw Error(d.error || "Unable to complete this request");
  return d;
}
function notice(message) {
  $("notice").textContent = message;
  $("notice").hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => ($("notice").hidden = true), 4500);
}
function view(name, scroll = true) {
  $("home-content").hidden = name !== "home";
  $("catalog").hidden = name === "quick";
  $("quick-order").hidden = name !== "quick";
  if (name === "quick") renderQuick();
  if (scroll)
    (name === "home"
      ? $("home-content")
      : name === "quick"
        ? $("quick-order")
        : $("catalog")
    ).scrollIntoView({ block: "start" });
}
function options(i, value, change, label) {
  const s = el("select");
  s.setAttribute("aria-label", label);
  for (const [u, n] of [
    ["piece", "Piece / " + i.unit],
    ["pack", "Pack (" + i.pack_size + " pcs)"],
    ["carton", "Carton (" + i.carton_size + " pcs)"],
  ])
    if (u === "piece" || size(i, u) > 1) s.append(new Option(n, u));
  s.value = value;
  s.disabled = sending;
  s.addEventListener("change", () => change(s.value));
  return s;
}
function check(lines) {
  const totals = new Map();
  for (const l of lines) {
    const i = itemBy(l.id);
    if (!i) throw Error("A product is no longer available");
    if (
      !["piece", "pack", "carton"].includes(l.package) ||
      !Number.isFinite(Number(l.qty)) ||
      Number(l.qty) <= 0 ||
      (l.package !== "piece" &&
        (size(i, l.package) <= 1 || !Number.isInteger(Number(l.qty))))
    )
      throw Error(i.name + ": enter a valid quantity and packaging option");
    const q = base(i, l);
    totals.set(i.id, (totals.get(i.id) || 0) + q);
  }
  for (const [id, q] of totals) {
    const i = itemBy(id),
      existing = cart.get(id),
      all = q + (existing ? base(i, existing) : 0);
    if (
      all > 100000 ||
      Math.abs(all * 1000 - Math.round(all * 1000)) > 0.000001
    )
      throw Error(i.name + ": quantity is too large or too precise");
    if ($("role").value === "customer" && all < i.min_qty)
      throw Error(i.name + ": minimum order is " + i.min_qty + " " + i.unit);
  }
  if (new Set([...cart.keys(), ...totals.keys()]).size > 100)
    throw Error("Use up to 100 different products per order");
  return totals;
}
function addLines(lines) {
  check(lines);
  for (const l of lines) {
    const i = itemBy(l.id),
      old = cart.get(l.id);
    if (!old)
      cart.set(i.id, { qty: Number(l.qty), package: l.package, price: "" });
    else if (old.package === l.package)
      old.qty = Number(old.qty) + Number(l.qty);
    else {
      old.qty = Number((base(i, old) + base(i, l)).toFixed(3));
      old.package = "piece";
    }
  }
  renderCart();
  renderProducts();
  notice(
    lines.length === 1
      ? "Added to your request"
      : "Selected products added to your request",
  );
}
function card(i) {
  const card = el("article", "product"),
    picture = el("div", "product-image"),
    img = el("img");
  img.src = i.image || "/usmanstationary/essentials.svg";
  img.alt = i.image ? i.name : "Stationery illustration";
  img.loading = "lazy";
  if (!i.image) img.className = "fallback";
  img.addEventListener("error", () => {
    if (!img.classList.contains("fallback")) {
      img.className = "fallback";
      img.src = "/usmanstationary/essentials.svg";
    }
  });
  picture.append(img);
  const best = data.best_sellers.includes(i.id),
    isNew = newIds().includes(i.id);
  if (best || i.featured || isNew)
    picture.append(
      el(
        "span",
        "product-badge",
        best ? "BEST SELLER" : i.featured ? "FEATURED" : "NEW ARRIVAL",
      ),
    );
  const info = el("div", "product-info");
  info.append(
    el("p", "product-meta", i.category),
    el("h3", "", i.name),
    el(
      "p",
      "product-meta",
      i.barcode +
        " · " +
        (i.available ? "Available to request" : "Ask about availability"),
    ),
  );
  const price = el("div", "product-price");
  if (i.retail_price > i.price)
    price.append(el("span", "retail-price", rs(i.retail_price)));
  price.append(
    document.createTextNode(rs(i.price) + " "),
    el("small", "", "/ " + i.unit),
  );
  info.append(price);
  const packaging = [];
  if (i.pack_size > 1)
    packaging.push(rs(i.pack_price) + " / pack of " + i.pack_size);
  if (i.carton_size > 1)
    packaging.push(rs(i.carton_price) + " / carton of " + i.carton_size);
  if (packaging.length)
    info.append(el("div", "pack-prices", packaging.join(" · ")));
  if (i.min_qty > 1)
    info.append(el("div", "tier-note", "Minimum " + i.min_qty + " " + i.unit));
  if (i.tiers.length > 1) {
    const details = el("details"),
      list = el("div", "tier-list");
    details.append(el("summary", "", "View quantity prices"));
    i.tiers.forEach((t, j) => {
      const row = el("span");
      row.append(
        el(
          "span",
          "",
          t.min_qty +
            (i.tiers[j + 1] ? "–" + (i.tiers[j + 1].min_qty - 1) : "+") +
            " " +
            i.unit,
        ),
        el("b", "", rs(t.price) + " each"),
      );
      list.append(row);
    });
    details.append(list);
    info.append(details);
  }
  const add = el(
    "button",
    "",
    cart.has(i.id) ? "Add another +" : "Add to request +",
  );
  add.type = "button";
  add.disabled = sending;
  add.setAttribute("aria-label", "Add " + i.name);
  add.addEventListener("click", () => {
    try {
      addLines([{ id: i.id, qty: Math.max(1, i.min_qty), package: "piece" }]);
    } catch (e) {
      notice(e.message);
    }
  });
  info.append(add);
  card.append(picture, info);
  return card;
}
const newIds = () =>
  [...items]
    .sort(
      (a, b) => Number(b.new_arrival) - Number(a.new_arrival) || b.id - a.id,
    )
    .slice(0, 8)
    .map((i) => i.id);
function renderCollections() {
  const categories = [...new Set(items.map((i) => i.category))].sort();
  $("category").replaceChildren(new Option("All categories", ""));
  $("category-tiles").replaceChildren();
  categories.forEach((name, index) => {
    const count = items.filter((i) => i.category === name).length,
      tile = el("button", "category-tile");
    tile.append(
      el("span", "", ["▤", "✎", "▧", "▱", "▥", "✳"][index % 6]),
      el("b", "", name),
      el("small", "", count + " products"),
    );
    tile.addEventListener("click", () => {
      $("category").value = name;
      view("catalog");
      renderProducts();
    });
    $("category-tiles").append(tile);
    $("category").append(new Option(name, name));
  });
  for (const [id, list] of [
    [
      "featured-products",
      items.some((i) => i.featured)
        ? items.filter((i) => i.featured)
        : items.slice(0, 4),
    ],
    ["new-products", newIds().map(itemBy)],
    ["best-products", data.best_sellers.map(itemBy).filter(Boolean)],
  ]) {
    $(id).replaceChildren(...list.slice(0, 4).map(card));
  }
  $("best-empty").hidden = !!data.best_sellers.length;
}
function renderProducts() {
  const q = $("search").value.toLowerCase(),
    c = $("category").value,
    collection = $("collection").value;
  let shown = items.filter(
    (i) =>
      (!c || i.category === c) &&
      (!q ||
        (i.name + " " + i.barcode + " " + i.category)
          .toLowerCase()
          .includes(q)) &&
      (!$("available-only").checked || i.available) &&
      (!$("min-price").value ||
        i.price >= Number($("min-price").value) * 100) &&
      (!$("max-price").value ||
        i.price <= Number($("max-price").value) * 100) &&
      (!collection ||
        (collection === "featured" && i.featured) ||
        (collection === "new" && newIds().includes(i.id)) ||
        (collection === "best" && data.best_sellers.includes(i.id)) ||
        (collection === "bulk" && i.tiers.length > 1)),
  );
  const sort = $("sort").value;
  shown.sort((a, b) =>
    sort === "price-low"
      ? a.price - b.price
      : sort === "price-high"
        ? b.price - a.price
        : sort === "new"
          ? b.id - a.id
          : sort === "best"
            ? (data.best_sellers.indexOf(a.id) < 0
                ? 999
                : data.best_sellers.indexOf(a.id)) -
              (data.best_sellers.indexOf(b.id) < 0
                ? 999
                : data.best_sellers.indexOf(b.id))
            : a.name.localeCompare(b.name),
  );
  $("products").replaceChildren(...shown.map(card));
  $("item-count").textContent = shown.length + " products";
  $("load-status").textContent = shown.length
    ? ""
    : items.length
      ? "No products match these filters."
      : "The store has not added products yet. Please check back soon.";
}
function totals() {
  let subtotal = 0;
  for (const [id, l] of cart) {
    const i = itemBy(id),
      q = base(i, l);
    subtotal += Math.round(
      q *
        ($("role").value === "supplier"
          ? Math.round(Number(l.price || 0) * 100)
          : rate(i, q)),
    );
  }
  const discount =
    $("role").value === "customer" &&
    data?.bulk.percent &&
    subtotal >= data.bulk.min_total
      ? Math.round((subtotal * data.bulk.percent) / 100)
      : 0;
  return { subtotal, discount, total: subtotal - discount };
}
function updateTotal() {
  const t = totals();
  $("cart-count").textContent = cart.size;
  $("mobile-count").textContent = cart.size;
  $("subtotal").textContent = rs(t.subtotal);
  $("discount").textContent = "− " + rs(t.discount);
  $("discount-row").hidden = !t.discount;
  $("total").textContent = rs(t.total);
  $("mobile-total").textContent = rs(t.total);
  $("submit").disabled = sending || !cart.size;
}
function renderCart() {
  const supplier = $("role").value === "supplier";
  $("cart").replaceChildren();
  if (!cart.size)
    $("cart").append(
      el(
        "p",
        "cart-empty",
        "A little inspiration? Add your favourites from the collection.",
      ),
    );
  for (const [id, l] of cart) {
    const i = itemBy(id);
    if (!i) {
      cart.delete(id);
      continue;
    }
    const row = el("div", "cart-line"),
      controls = el("div", "cart-controls"),
      label = el("label", "", "Quantity"),
      buttons = el("div", "qty-buttons"),
      minus = el("button", "", "−"),
      plus = el("button", "", "+"),
      qty = el("input");
    Object.assign(qty, {
      type: "number",
      min: l.package === "piece" ? ".001" : "1",
      step: l.package === "piece" ? ".001" : "1",
      max: "100000",
      value: l.qty,
      required: true,
      disabled: sending,
    });
    qty.setAttribute("aria-label", "Quantity for " + i.name);
    qty.addEventListener("input", () => {
      l.qty = Number(qty.value);
      updateTotal();
      const q = base(i, l);
      row.querySelector(".cart-rate").textContent =
        q +
        " " +
        i.unit +
        " · " +
        rs(supplier ? Math.round(Number(l.price || 0) * 100) : rate(i, q)) +
        " per piece";
    });
    minus.type = plus.type = "button";
    minus.disabled = plus.disabled = sending;
    minus.setAttribute("aria-label", "Decrease " + i.name);
    plus.setAttribute("aria-label", "Increase " + i.name);
    minus.onclick = () => {
      l.qty = Math.max(1, Number(l.qty) - 1);
      renderCart();
    };
    plus.onclick = () => {
      l.qty = Number(l.qty) + 1;
      renderCart();
    };
    buttons.append(minus, qty, plus);
    label.append(buttons);
    const unitLabel = el("label", "", "Unit");
    unitLabel.append(
      options(
        i,
        l.package,
        (u) => {
          l.package = u;
          l.qty = Math.max(
            1,
            Math.ceil(
              ($("role").value === "supplier" ? 1 : i.min_qty) / size(i, u),
            ),
          );
          renderCart();
        },
        "Packaging for " + i.name,
      ),
    );
    controls.append(label, unitLabel);
    const remove = el("button", "remove", "×");
    remove.type = "button";
    remove.disabled = sending;
    remove.setAttribute("aria-label", "Remove " + i.name);
    remove.onclick = () => {
      cart.delete(id);
      renderCart();
      renderProducts();
    };
    controls.append(remove);
    row.append(el("b", "", i.name), controls);
    if (supplier) {
      const offerLabel = el("label", "", "Your offered price per piece (PKR)"),
        offer = el("input");
      Object.assign(offer, {
        type: "number",
        min: "0",
        step: ".01",
        value: l.price,
        required: true,
        disabled: sending,
      });
      offer.setAttribute("aria-label", "Offered price for " + i.name);
      offer.oninput = () => {
        l.price = offer.value;
        updateTotal();
      };
      offerLabel.append(offer);
      row.append(offerLabel);
    }
    const q = base(i, l);
    row.append(
      el(
        "div",
        "cart-rate",
        q +
          " " +
          i.unit +
          " · " +
          rs(supplier ? Math.round(Number(l.price || 0) * 100) : rate(i, q)) +
          " per piece",
      ),
    );
    if (!supplier && q < i.min_qty)
      row.append(el("p", "error", "Minimum " + i.min_qty + " " + i.unit));
    $("cart").append(row);
  }
  updateTotal();
}
function renderQuick() {
  const q = $("quick-search").value.toLowerCase();
  const shown = items
    .filter(
      (i) =>
        (i.name + " " + i.barcode).toLowerCase().includes(q) ||
        (quick.has(i.id) && quick.get(i.id).qty > 0),
    )
    .sort(
      (a, b) =>
        Number((quick.get(b.id)?.qty || 0) > 0) -
        Number((quick.get(a.id)?.qty || 0) > 0),
    )
    .slice(0, 100);
  $("quick-rows").replaceChildren();
  for (const i of shown) {
    const l = quick.get(i.id) || { qty: 0, package: "piece" },
      tr = el("tr"),
      name = el("td");
    name.append(el("b", "", i.name), el("small", "", i.barcode));
    const qtyCell = el("td"),
      qty = el("input");
    Object.assign(qty, {
      type: "number",
      min: "0",
      max: "100000",
      step: ".001",
      value: l.qty || "",
    });
    qty.setAttribute("aria-label", "Quick quantity " + i.barcode);
    const unit = el("td"),
      price = el("td", "", rs(rate(i, base(i, l)))),
      total = el("td", "", rs(Math.round(base(i, l) * rate(i, base(i, l)))));
    qty.oninput = () => {
      l.qty = Number(qty.value);
      quick.set(i.id, l);
      price.textContent = rs(rate(i, base(i, l)));
      total.textContent = rs(Math.round(base(i, l) * rate(i, base(i, l))));
      updateQuickCount();
    };
    qtyCell.append(qty);
    unit.append(
      options(
        i,
        l.package,
        (u) => {
          l.package = u;
          quick.set(i.id, l);
          renderQuick();
        },
        "Quick packaging " + i.barcode,
      ),
    );
    tr.append(name, qtyCell, unit, price, total);
    $("quick-rows").append(tr);
  }
  updateQuickCount();
}
function updateQuickCount() {
  $("quick-count").textContent =
    [...quick.values()].filter((l) => l.qty > 0).length + " products selected";
}
function showError(message) {
  $("form-error").textContent = message;
  $("form-error").hidden = false;
}
async function load() {
  try {
    data = await request("catalog");
    items = data.items;
    $("retry").hidden = true;
    for (const id of ["business-name", "footer-name"])
      $(id).textContent = data.business.name;
    document.title = data.business.name + " · Retail & Wholesale";
    $("business-contact").textContent = [
      data.business.phone,
      data.business.address,
    ]
      .filter(Boolean)
      .join(" · ");
    for (const [key, id] of [
      ["headline", "headline"],
      ["subtitle", "subtitle"],
      ["announcement", "announcement"],
      ["banner_title", "banner-title"],
      ["banner_text", "banner-text"],
    ])
      $(id).textContent = data.design[key];
    $("price-label").textContent =
      data.customer?.status === "active" && data.customer.segment !== "public"
        ? "Your " + data.customer.segment.replaceAll("_", " ") + " prices"
        : "Public prices";
    $("account-button").textContent = data.customer
      ? data.customer.name.split(" ")[0]
      : "Account";
    if (data.customer && !$("name").value) {
      $("name").value = data.customer.name;
      $("phone").value = data.customer.phone;
    }
    renderCollections();
    renderProducts();
    renderCart();
  } catch (e) {
    $("load-status").textContent = e.message;
    $("retry").hidden = false;
  }
}
document.querySelectorAll("[data-view]").forEach((link) =>
  link.addEventListener("click", (e) => {
    e.preventDefault();
    view(link.dataset.view);
    if (link.getAttribute("href") === "#categories")
      $("categories").scrollIntoView();
  }),
);
$("search").oninput = () => {
  view("catalog", false);
  renderProducts();
  if (
    !$("catalog").getBoundingClientRect().top ||
    $("catalog").getBoundingClientRect().top > innerHeight
  )
    $("catalog").scrollIntoView();
};
for (const id of [
  "category",
  "collection",
  "sort",
  "min-price",
  "max-price",
  "available-only",
])
  $(id).addEventListener(
    id.includes("price") ? "input" : "change",
    renderProducts,
  );
$("clear-filters").onclick = () => {
  for (const id of [
    "search",
    "category",
    "collection",
    "min-price",
    "max-price",
  ])
    $(id).value = "";
  $("available-only").checked = false;
  $("sort").value = "name";
  renderProducts();
};
$("retry").onclick = load;
$("quick-search").oninput = renderQuick;
$("quick-add").onclick = () => {
  try {
    const lines = [...quick]
      .filter(([, l]) => l.qty > 0)
      .map(([id, l]) => ({ id, ...l }));
    if (!lines.length)
      throw Error("Enter quantities or import a product list first");
    addLines(lines);
    quick.clear();
    renderQuick();
    $("import-status").textContent = "Selection added to your bag.";
  } catch (e) {
    $("import-error").textContent = e.message;
    $("import-error").hidden = false;
  }
};
$("order-file").onchange = async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  $("import-error").hidden = true;
  try {
    const lines = await importFile(file, items);
    check(lines);
    const combined = new Map();
    for (const l of lines) {
      const i = itemBy(l.id),
        old = combined.get(i.id);
      combined.set(i.id, {
        qty: Number(((old?.qty || 0) + base(i, l)).toFixed(3)),
        package: "piece",
      });
    }
    quick.clear();
    for (const [id, l] of combined) quick.set(id, l);
    renderQuick();
    $("import-status").textContent =
      lines.length +
      " rows matched. Review quantities and add your selection to the bag.";
  } catch (error) {
    $("import-error").textContent = error.message;
    $("import-error").hidden = false;
  }
};
$("template").onclick = () => {
  const url = URL.createObjectURL(
      new Blob(["sku,quantity,unit\r\n"], { type: "text/csv;charset=utf-8" }),
    ),
    a = el("a");
  a.href = url;
  a.download = "usman-quick-order-template.csv";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$("role").onchange = () => {
  $("role-help").textContent =
    $("role").value === "supplier"
      ? "Choose products you can supply and enter your offered prices. The store will review your purchase order request."
      : "Choose products to send a sales order request to Usman Stationary.";
  $("submit").textContent =
    $("role").value === "supplier"
      ? "Send supplier offer"
      : "Send order request";
  renderCart();
};
$("order-form").onsubmit = async (e) => {
  e.preventDefault();
  if (sending || !cart.size) return;
  $("form-error").hidden = true;
  try {
    const saved = new Map(cart);
    cart.clear();
    try {
      check([...saved].map(([id, l]) => ({ id, ...l })));
    } finally {
      for (const [id, l] of saved) cart.set(id, l);
    }
  } catch (error) {
    showError(error.message);
    return;
  }
  const payload = {
      role: $("role").value,
      name: $("name").value,
      phone: $("phone").value,
      address: $("address").value,
      notes: $("notes").value,
      website: $("website").value,
      lines: [...cart].map(([item_id, l]) => ({
        item_id,
        qty: l.qty,
        package: l.package,
        ...($("role").value === "supplier" ? { price: l.price } : {}),
      })),
    },
    serialized = JSON.stringify({
      ...payload,
      customer: data.customer?.id || null,
    });
  let previous;
  try {
    previous = JSON.parse(sessionStorage.getItem("store-request-attempt"));
  } catch {}
  const submission_key =
    previous?.payload === serialized ? previous.key : crypto.randomUUID();
  try {
    sessionStorage.setItem(
      "store-request-attempt",
      JSON.stringify({ key: submission_key, payload: serialized }),
    );
  } catch {}
  sending = true;
  renderCart();
  renderProducts();
  for (const c of $("order-form").querySelectorAll("input,textarea,select"))
    c.disabled = true;
  try {
    const result = await request("requests", { ...payload, submission_key });
    $("reference").textContent = result.code;
    $("order-form").hidden = true;
    $("confirmation").hidden = false;
    $("confirmation").scrollIntoView({ block: "center" });
  } catch (error) {
    showError(
      ["TypeError", "TimeoutError"].includes(error.name)
        ? "Could not confirm your request. Submit again with the same details; it will not be duplicated."
        : error.message,
    );
  } finally {
    sending = false;
    for (const c of $("order-form").querySelectorAll("input,textarea,select"))
      c.disabled = false;
    renderCart();
    renderProducts();
  }
};
$("new-request").onclick = () => {
  cart.clear();
  try {
    sessionStorage.removeItem("store-request-attempt");
  } catch {}
  $("order-form").reset();
  $("order-form").hidden = false;
  $("confirmation").hidden = true;
  $("form-error").hidden = true;
  $("role").dispatchEvent(new Event("change"));
  renderProducts();
};
async function openAccount() {
  $("account-error").hidden = true;
  $("signed-out").hidden = !!data?.customer;
  $("signed-in").hidden = !data?.customer;
  $("account-dialog").showModal();
  if (data?.customer) {
    $("account-summary").textContent =
      data.customer.name +
      " · " +
      (data.customer.status === "active"
        ? data.customer.segment.replaceAll("_", " ") + " pricing"
        : "Awaiting owner approval · public prices");
    $("order-history").textContent = "Loading purchases…";
    try {
      const orders = await request("account/orders");
      $("order-history").replaceChildren();
      if (!orders.length)
        $("order-history").append(
          el("p", "muted", "No completed purchases for this account yet."),
        );
      for (const order of orders) {
        const row = el("div", "history-card"),
          caption = el("div");
        caption.append(
          el("b", "", order.number),
          el(
            "small",
            "",
            order.code + " · " + order.lines.length + " products",
          ),
        );
        const reorder = el("button", "secondary", "Reorder");
        reorder.onclick = () => {
          try {
            addLines(
              order.lines.map((l) => ({
                id: l.item_id,
                qty: l.qty,
                package: "piece",
              })),
            );
            $("account-dialog").close();
            $("your-request").scrollIntoView();
          } catch (error) {
            notice("Could not reorder: " + error.message);
          }
        };
        row.append(caption, reorder);
        $("order-history").append(row);
      }
    } catch (error) {
      $("order-history").textContent = error.message;
    }
  }
}
for (const id of ["account-button", "footer-account", "history-button"])
  $(id).onclick = openAccount;
$("close-account").onclick = () => $("account-dialog").close();
document.querySelectorAll("[data-auth]").forEach(
  (b) =>
    (b.onclick = () => {
      authMode = b.dataset.auth;
      $("register-fields").hidden = authMode !== "register";
      $("account-name").required = $("account-phone").required =
        authMode === "register";
      $("account-submit").textContent =
        authMode === "register" ? "Request account" : "Sign in";
      $("account-error").hidden = true;
    }),
);
$("account-form").onsubmit = async (e) => {
  e.preventDefault();
  $("account-error").hidden = true;
  $("account-submit").disabled = true;
  try {
    const result = await request("account/" + authMode, {
      login: $("account-login").value,
      password: $("account-password").value,
      name: $("account-name").value,
      phone: $("account-phone").value,
    });
    $("account-password").value = "";
    if (authMode === "register") {
      notice(result.message);
      authMode = "login";
      $("register-fields").hidden = true;
      $("account-name").required = $("account-phone").required = false;
      $("account-submit").textContent = "Sign in";
    } else {
      await load();
      $("account-dialog").close();
      await openAccount();
      notice("Signed in. Your current prices are ready.");
    }
  } catch (error) {
    $("account-error").textContent = error.message;
    $("account-error").hidden = false;
  } finally {
    $("account-submit").disabled = false;
  }
};
$("logout").onclick = async () => {
  try {
    await request("account/logout", {});
    $("account-dialog").close();
    await load();
    notice("Signed out");
  } catch (e) {
    notice(e.message);
  }
};
load();

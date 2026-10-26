"use strict";
const $ = (id) => document.getElementById(id);
const rs = (amount) =>
  "Rs " +
  (Number(amount) / 100).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const cart = new Map();
let items = [],
  sending = false;
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
async function request(path, body) {
  const response = await fetch("/api/storefront/" + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  });
  let data;
  try {
    data = await response.json();
  } catch {
    throw Error("The store is temporarily unavailable. Please try again.");
  }
  if (!response.ok) throw Error(data.error || "Unable to send your request");
  return data;
}
function renderProducts() {
  const search = $("search").value.toLowerCase(),
    category = $("category").value;
  const shown = items.filter(
    (i) =>
      (!category || i.category === category) &&
      (i.name + " " + i.barcode + " " + i.category)
        .toLowerCase()
        .includes(search),
  );
  $("products").replaceChildren();
  $("item-count").textContent = shown.length + " products";
  $("load-status").textContent = shown.length
    ? ""
    : items.length
      ? "No products match your search."
      : "The store has not added products yet. Please check back soon.";
  for (const item of shown) {
    const card = element("article", "product");
    card.append(
      element("span", "product-mark", "▥"),
      element("p", "", item.category),
      element("h3", "", item.name),
      element("p", "", item.barcode + " · " + item.unit),
      element(
        "span",
        "availability" + (item.available ? "" : " backorder"),
        item.available ? "Available to request" : "Ask about availability",
      ),
      element("span", "price", rs(item.price)),
    );
    const add = element(
      "button",
      "",
      cart.has(item.id) ? "Add another" : "Add to request",
    );
    add.type = "button";
    add.disabled = sending;
    add.setAttribute("aria-label", "Add " + item.name);
    add.addEventListener("click", () => {
      if (!cart.has(item.id) && cart.size >= 100)
        return showError("You can choose up to 100 products per request.");
      const previous = cart.get(item.id);
      cart.set(item.id, {
        qty: Math.min(100000, (previous?.qty || 0) + 1),
        price: previous?.price ?? "",
      });
      renderCart();
      renderProducts();
    });
    card.append(add);
    $("products").append(card);
  }
}
function updateTotal() {
  $("cart-count").textContent = cart.size;
  let total = 0;
  for (const [id, line] of cart)
    total += Math.round(
      line.qty *
        ($("role").value === "supplier"
          ? Math.round(Number(line.price || 0) * 100)
          : items.find((i) => i.id === id).price),
    );
  $("total").textContent = rs(total);
  $("submit").disabled = sending || !cart.size;
}
function renderCart() {
  $("cart").replaceChildren();
  const supplier = $("role").value === "supplier";
  if (!cart.size)
    $("cart").append(
      element(
        "p",
        "cart-empty",
        "Add products from the catalog to get started.",
      ),
    );
  for (const [id, line] of cart) {
    const item = items.find((i) => i.id === id),
      row = element("div", "cart-line"),
      controls = element("div", "cart-controls");
    row.append(element("b", "", item.name));
    const qtyLabel = element("label", "", "Quantity (" + item.unit + ")"),
      qty = element("input");
    Object.assign(qty, {
      type: "number",
      min: "0.001",
      max: "100000",
      step: "0.001",
      value: line.qty,
      required: true,
      disabled: sending,
    });
    qty.setAttribute("aria-label", "Quantity for " + item.name);
    qty.addEventListener("input", () => {
      line.qty = Number(qty.value);
      updateTotal();
    });
    qtyLabel.append(qty);
    controls.append(qtyLabel);
    if (supplier) {
      const priceLabel = element("label", "", "Your offer / unit (PKR)"),
        price = element("input");
      Object.assign(price, {
        type: "number",
        min: "0",
        max: "10000000000",
        step: "0.01",
        value: line.price,
        required: true,
        disabled: sending,
      });
      price.setAttribute("aria-label", "Offered price for " + item.name);
      price.addEventListener("input", () => {
        line.price = price.value;
        updateTotal();
      });
      priceLabel.append(price);
      controls.append(priceLabel);
    }
    const remove = element("button", "", "×");
    remove.type = "button";
    remove.disabled = sending;
    remove.setAttribute("aria-label", "Remove " + item.name);
    remove.addEventListener("click", () => {
      cart.delete(id);
      renderCart();
      renderProducts();
    });
    controls.append(remove);
    row.append(controls);
    $("cart").append(row);
  }
  updateTotal();
}
function showError(message) {
  $("form-error").textContent = message;
  $("form-error").hidden = false;
}
async function load() {
  $("retry").hidden = true;
  $("load-status").textContent = "Loading products…";
  try {
    const data = await request("catalog");
    items = data.items;
    $("business-name").textContent = data.business.name;
    $("footer-name").textContent = data.business.name;
    document.title = data.business.name + " · Product store";
    $("business-contact").textContent = [
      data.business.phone,
      data.business.address,
    ]
      .filter(Boolean)
      .join(" · ");
    $("category").replaceChildren(new Option("All categories", ""));
    for (const category of [...new Set(items.map((i) => i.category))].sort())
      $("category").append(new Option(category, category));
    renderProducts();
    renderCart();
  } catch (error) {
    $("load-status").textContent = error.message;
    $("retry").hidden = false;
  }
}
$("search").addEventListener("input", renderProducts);
$("category").addEventListener("change", renderProducts);
$("retry").addEventListener("click", load);
$("role").addEventListener("change", () => {
  $("role-help").textContent =
    $("role").value === "supplier"
      ? "Choose products you can supply and enter your offered prices. The store will review your purchase order request."
      : "Choose products to send a sales order request to Usman Stationary.";
  $("submit").textContent =
    $("role").value === "supplier"
      ? "Send supplier offer"
      : "Send order request";
  renderCart();
});
$("order-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (sending || !cart.size) return;
  $("form-error").hidden = true;
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
      ...($("role").value === "supplier" ? { price: l.price } : {}),
    })),
  };
  const serialized = JSON.stringify(payload);
  let previous;
  try {
    previous = JSON.parse(
      sessionStorage.getItem("store-request-attempt") || "null",
    );
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
  for (const control of $("order-form").querySelectorAll(
    "input,textarea,select",
  ))
    control.disabled = true;
  try {
    const result = await request("requests", { ...payload, submission_key });
    $("reference").textContent = result.code;
    $("order-form").hidden = true;
    $("confirmation").hidden = false;
    $("confirmation").scrollIntoView({ block: "center" });
  } catch (error) {
    showError(
      error.name === "TimeoutError" || error.name === "TypeError"
        ? "Could not confirm your request. Please submit again with the same details; it will not be duplicated."
        : error.message,
    );
  } finally {
    sending = false;
    for (const control of $("order-form").querySelectorAll(
      "input,textarea,select",
    ))
      control.disabled = false;
    renderCart();
    renderProducts();
  }
});
$("new-request").addEventListener("click", () => {
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
});
load();

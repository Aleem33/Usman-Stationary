import React, { useState } from "react";
import { api } from "./api";
export function StoreManager({ state, run }) {
  const [open, setOpen] = useState(false),
    [config, setConfig] = useState(null),
    [customers, setCustomers] = useState([]),
    [tab, setTab] = useState("Branding"),
    [item, setItem] = useState(String(state.items[0]?.id || "")),
    [group, setGroup] = useState("retailer"),
    [busy, setBusy] = useState(false);
  async function load() {
    setBusy(true);
    const result = await run(async () => ({
      config: await api("/storefront/config"),
      customers: await api("/storefront/customers"),
    }));
    if (result) {
      setConfig(result.config);
      setCustomers(result.customers);
    }
    setBusy(false);
  }
  const product = config?.products[item] || {
    pack_size: 1,
    carton_size: 1,
    min_qty: 0.001,
    featured: false,
    new_arrival: false,
    image: "",
    tiers: [],
  };
  const updateProduct = (key, value) =>
    setConfig((c) => ({
      ...c,
      products: { ...c.products, [item]: { ...product, [key]: value } },
    }));
  const profile = config?.groups[group] || { discount: 0, prices: {} };
  const updateGroup = (key, value) =>
    setConfig((c) => ({
      ...c,
      groups: { ...c.groups, [group]: { ...profile, [key]: value } },
    }));
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    const result = await run(
      () => api("/storefront/config", { method: "PUT", body: config }),
      "Online store settings saved",
    );
    if (result) await load();
    setBusy(false);
  }
  const field = (caption, control) => (
    <label className="field" key={caption}>
      <span>{caption}</span>
      {React.cloneElement(control, {
        "aria-label": control.props["aria-label"] || caption,
      })}
    </label>
  );
  return (
    <section className="panel settings-card store-manager">
      <h2>Online store & wholesale pricing</h2>
      <p>
        Manage banners, product display, quantity prices, packaging and private
        customer price lists. Existing prices stay in effect until you save
        rules.
      </p>
      <button
        className="secondary"
        onClick={() => {
          setOpen(!open);
          if (!open) load();
        }}
      >
        {open ? "Close store management" : "Manage online store"}
      </button>
      {open && (
        <>
          <div className="store-manager-tabs">
            {["Branding", "Products", "Price groups", "Customers"].map((t) => (
              <button
                key={t}
                type="button"
                className={tab === t ? "" : "secondary"}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
          </div>
          {!config ? (
            <p>Loading store settings…</p>
          ) : (
            <>
              {tab !== "Customers" ? (
                <form onSubmit={save}>
                  {tab === "Branding" && (
                    <>
                      {[
                        ["headline", "Homepage headline"],
                        ["subtitle", "Homepage description"],
                        ["announcement", "Announcement bar"],
                        ["banner_title", "Promotional banner title"],
                        ["banner_text", "Promotional banner description"],
                      ].map(([key, title]) =>
                        field(
                          title,
                          <textarea
                            rows="2"
                            maxLength="300"
                            value={config[key]}
                            onChange={(e) =>
                              setConfig({ ...config, [key]: e.target.value })
                            }
                          />,
                        ),
                      )}
                    </>
                  )}
                  {tab === "Products" && (
                    <>
                      {field(
                        "Choose product",
                        <select
                          value={item}
                          onChange={(e) => setItem(e.target.value)}
                        >
                          {state.items.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name} · {i.barcode}
                            </option>
                          ))}
                        </select>,
                      )}
                      {item ? (
                        <>
                          <div className="form-grid">
                            {[
                              ["min_qty", "Minimum pieces / base units", 0.001],
                              ["pack_size", "Pieces per pack", 1],
                              ["carton_size", "Pieces per carton", 1],
                            ].map(([key, title, min]) =>
                              field(
                                title,
                                <input
                                  type="number"
                                  min={min}
                                  step={min}
                                  max="100000"
                                  required
                                  value={product[key]}
                                  onChange={(e) =>
                                    updateProduct(key, e.target.value)
                                  }
                                />,
                              ),
                            )}
                          </div>
                          {field(
                            "Product image URL (HTTPS, optional)",
                            <input
                              type="url"
                              value={product.image}
                              placeholder="https://…"
                              onChange={(e) =>
                                updateProduct("image", e.target.value)
                              }
                            />,
                          )}
                          <label className="check-field">
                            <input
                              type="checkbox"
                              checked={product.featured}
                              onChange={(e) =>
                                updateProduct("featured", e.target.checked)
                              }
                            />
                            Featured product
                          </label>
                          <label className="check-field">
                            <input
                              type="checkbox"
                              checked={product.new_arrival}
                              onChange={(e) =>
                                updateProduct("new_arrival", e.target.checked)
                              }
                            />
                            Highlight as new arrival
                          </label>
                          <h3>Quantity pricing · PKR per base unit</h3>
                          <p className="footnote">
                            The normal item selling price applies before the
                            first break. A break at 10 applies to 10–49 when the
                            next break is 50. Packaging quantities count as
                            pieces.
                          </p>
                          {product.tiers.map((tier, index) => (
                            <div className="form-grid" key={index}>
                              {field(
                                "From quantity",
                                <input
                                  aria-label={"Tier minimum " + index}
                                  type="number"
                                  min="1"
                                  max="100000"
                                  required
                                  value={tier.min_qty}
                                  onChange={(e) =>
                                    updateProduct(
                                      "tiers",
                                      product.tiers.map((t, j) =>
                                        j === index
                                          ? { ...t, min_qty: e.target.value }
                                          : t,
                                      ),
                                    )
                                  }
                                />,
                              )}
                              {field(
                                "Price per piece (PKR)",
                                <input
                                  aria-label={"Tier price " + index}
                                  type="number"
                                  min="0"
                                  step=".01"
                                  required
                                  value={tier.price}
                                  onChange={(e) =>
                                    updateProduct(
                                      "tiers",
                                      product.tiers.map((t, j) =>
                                        j === index
                                          ? { ...t, price: e.target.value }
                                          : t,
                                      ),
                                    )
                                  }
                                />,
                              )}
                              <button
                                type="button"
                                className="text-button"
                                onClick={() =>
                                  updateProduct(
                                    "tiers",
                                    product.tiers.filter((_, j) => j !== index),
                                  )
                                }
                              >
                                Remove break
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="secondary"
                            disabled={product.tiers.length >= 20}
                            onClick={() =>
                              updateProduct("tiers", [
                                ...product.tiers,
                                {
                                  min_qty: product.tiers.length
                                    ? Number(product.tiers.at(-1).min_qty) + 40
                                    : 10,
                                  price:
                                    (state.items.find(
                                      (i) => String(i.id) === item,
                                    )?.price || 0) / 100,
                                },
                              ])
                            }
                          >
                            Add quantity break
                          </button>
                        </>
                      ) : (
                        <p>Add products to your inventory first.</p>
                      )}
                    </>
                  )}
                  {tab === "Price groups" && (
                    <>
                      {field(
                        "Private customer group",
                        <select
                          value={group}
                          onChange={(e) => setGroup(e.target.value)}
                        >
                          <option value="retailer">Retailers</option>
                          <option value="school">Schools</option>
                          <option value="large_buyer">Large buyers</option>
                        </select>,
                      )}
                      {field(
                        "Group discount (%)",
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step=".01"
                          value={profile.discount}
                          onChange={(e) =>
                            updateGroup("discount", e.target.value)
                          }
                        />,
                      )}
                      <p className="footnote">
                        The group discount applies to the lower of a
                        product-specific group rate and the applicable public
                        quantity price. Only approved, signed-in members see
                        these prices.
                      </p>
                      {field(
                        "Product-specific rate",
                        <select
                          value={item}
                          onChange={(e) => setItem(e.target.value)}
                        >
                          {state.items.map((i) => (
                            <option key={i.id} value={i.id}>
                              {i.name}
                            </option>
                          ))}
                        </select>,
                      )}
                      {field(
                        "Special base-unit price (PKR; blank uses public price)",
                        <input
                          type="number"
                          min="0"
                          step=".01"
                          value={profile.prices[item] ?? ""}
                          onChange={(e) => {
                            const prices = { ...profile.prices };
                            if (e.target.value === "") delete prices[item];
                            else prices[item] = e.target.value;
                            updateGroup("prices", prices);
                          }}
                        />,
                      )}
                      <h3>Order-wide bulk discount</h3>
                      <p className="footnote">
                        Applies to customer orders after quantity and group
                        pricing, before taxes. Supplier offers are excluded.
                      </p>
                      {field(
                        "Minimum order subtotal (PKR)",
                        <input
                          type="number"
                          min="0"
                          step=".01"
                          value={config.bulk.min_total}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              bulk: {
                                ...config.bulk,
                                min_total: e.target.value,
                              },
                            })
                          }
                        />,
                      )}
                      {field(
                        "Order discount (%)",
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step=".01"
                          value={config.bulk.percent}
                          onChange={(e) =>
                            setConfig({
                              ...config,
                              bulk: { ...config.bulk, percent: e.target.value },
                            })
                          }
                        />,
                      )}
                    </>
                  )}
                  <div className="modal-actions">
                    <button disabled={busy}>
                      {busy ? "Saving…" : "Save store settings"}
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <p className="footnote">
                    Verify customer details before granting special prices.
                    Pending accounts use public prices. Blocking removes access;
                    changing a password signs the customer out.
                  </p>
                  <button className="secondary" disabled={busy} onClick={load}>
                    Refresh customer accounts
                  </button>
                  {!customers.length && (
                    <p>No customer accounts requested yet.</p>
                  )}
                  {customers.map((c, index) => (
                    <div className="store-customer-card" key={c.id}>
                      <h3>{c.name}</h3>
                      <p>
                        {c.login} · {c.phone}
                      </p>
                      <div className="form-grid">
                        {field(
                          "Account status",
                          <select
                            value={c.status}
                            onChange={(e) =>
                              setCustomers(
                                customers.map((v, i) =>
                                  i === index
                                    ? { ...v, status: e.target.value }
                                    : v,
                                ),
                              )
                            }
                          >
                            <option value="pending">Pending review</option>
                            <option value="active">Approved</option>
                            <option value="blocked">Blocked</option>
                          </select>,
                        )}
                        {field(
                          "Price group",
                          <select
                            value={c.segment}
                            onChange={(e) =>
                              setCustomers(
                                customers.map((v, i) =>
                                  i === index
                                    ? { ...v, segment: e.target.value }
                                    : v,
                                ),
                              )
                            }
                          >
                            <option value="public">Public prices</option>
                            <option value="retailer">Retailer</option>
                            <option value="school">School</option>
                            <option value="large_buyer">Large buyer</option>
                          </select>,
                        )}
                        {field(
                          "Reset password (optional, 6+ characters)",
                          <input
                            type="password"
                            minLength="6"
                            value={c.password || ""}
                            onChange={(e) =>
                              setCustomers(
                                customers.map((v, i) =>
                                  i === index
                                    ? { ...v, password: e.target.value }
                                    : v,
                                ),
                              )
                            }
                          />,
                        )}
                      </div>
                      <button
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          const result = await run(
                            () =>
                              api("/storefront/customers/" + c.id, {
                                method: "PUT",
                                body: c,
                              }),
                            "Customer account updated",
                          );
                          if (result) await load();
                          setBusy(false);
                        }}
                      >
                        Save customer access
                      </button>
                    </div>
                  ))}
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}

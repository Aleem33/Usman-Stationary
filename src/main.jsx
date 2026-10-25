import React, { useState, useEffect, useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  LayoutDashboard,
  ShoppingCart,
  FileText,
  Package,
  Users,
  Wallet,
  ChartNoAxesCombined,
  Settings,
  Search,
  Plus,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowRight,
  ChevronRight,
  LogOut,
  Printer,
  Download,
  Send,
  X,
  Trash2,
  ScanBarcode,
  Check,
  RefreshCw,
  Store,
  ReceiptText,
  ShoppingBag,
  SlidersHorizontal,
  Activity,
  Banknote,
  AlertCircle,
} from "lucide-react";
import { api, apiBase, pkr, today, label, download } from "./api";
import {
  invoiceHTML,
  barcodeHTML,
  printHTML,
  reportHTML,
  exportCSV,
} from "./printing";
import "./style.css";
const IconButton = ({ children, ...props }) => (
  <button className="icon-button" {...props}>
    {children}
  </button>
);
function Field({ label: caption, children, ...props }) {
  return (
    <label className="field">
      <span>{caption}</span>
      {children || <input {...props} />}
    </label>
  );
}
function Modal({ title, subtitle, children, onClose, wide = false }) {
  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section className={"modal " + (wide ? "wide" : "")}>
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <IconButton aria-label="Close" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>
        {children}
      </section>
    </div>
  );
}
function Empty({
  title = "Nothing here yet",
  text = "Create your first record to get started.",
}) {
  return (
    <div className="empty">
      <Package size={30} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function Badge({ children, tone = "" }) {
  return <span className={"badge " + tone}>{children}</span>;
}
function App() {
  const [logged, setLogged] = useState(!!sessionStorage.getItem("token")),
    [state, setState] = useState(null),
    [page, setPage] = useState("Dashboard"),
    [search, setSearch] = useState(""),
    [modal, setModal] = useState(null),
    [toast, setToast] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const notify = (message) => {
    setToast(message);
    setTimeout(() => setToast(""), 6000);
  };
  const refresh = async () => {
    try {
      setState(await api("/state"));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    if (!logged) return;
    refresh();
    const onFocus = () => refresh();
    const timer = setInterval(refresh, 60000);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [logged]);
  useEffect(() => {
    const fn = () => {
      setLogged(false);
      setState(null);
    };
    window.addEventListener("auth-expired", fn);
    return () => window.removeEventListener("auth-expired", fn);
  }, []);
  async function run(fn, success) {
    setBusy(true);
    setError("");
    try {
      const r = await fn();
      if (success) notify(success);
      await refresh();
      return r;
    } catch (e) {
      setError(e.message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  const close = () => {
    setModal(null);
    setError("");
  };
  if (!logged) return <Login onLogin={() => setLogged(true)} />;
  if (!state)
    return (
      <div className="loading">
        <Store />
        <h2>Opening your store…</h2>
        {error && (
          <>
            <p>{error}</p>
            <button onClick={refresh}>Try again</button>
            <button onClick={() => setLogged(false)}>
              Connection settings
            </button>
          </>
        )}
      </div>
    );
  const nav = [
    ["Dashboard", LayoutDashboard],
    ["Point of Sale", ShoppingCart],
    ["Sales", ReceiptText],
    ["Purchases", ShoppingBag],
    ["Items & Stock", Package],
    ["Customers & Suppliers", Users],
    ["Expenses", Wallet],
    ["Cash & Bank", Banknote],
    ["Reports", ChartNoAxesCombined],
    ["Settings", Settings],
  ];
  function create(type) {
    setModal({ kind: "document", type });
    setError("");
  }
  async function view(d) {
    const full = await run(() => api("/documents/" + d.id));
    if (full) setModal({ kind: "view", document: full });
  }
  const matching = (d) =>
    JSON.stringify(d).toLowerCase().includes(search.toLowerCase());
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Store size={23} />
          </div>
          <div>
            USMAN<span>STATIONARY</span>
          </div>
        </div>
        <div className="workspace">
          <span className="avatar">US</span>
          <div>
            Usman Stationary<small>Distribution workspace</small>
          </div>
          <Check size={14} />
        </div>
        <p className="nav-caption">WORKSPACE</p>
        <nav>
          {nav.map(([name, Icon], i) => (
            <React.Fragment key={name}>
              {i === 8 && <p className="nav-caption">MANAGEMENT</p>}
              <button
                aria-label={name}
                className={page === name ? "active" : ""}
                onClick={() => {
                  setPage(name);
                  setSearch("");
                  setError("");
                }}
              >
                <Icon size={19} />
                <span>{name}</span>
                {name === "Point of Sale" && <small>POS</small>}
              </button>
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="currency">
            <span className="online-dot" /> Connected to store<span>PKR</span>
          </div>
          <button
            className="profile"
            onClick={async () => {
              await api("/logout").catch(() => {});
              sessionStorage.removeItem("token");
              setLogged(false);
            }}
          >
            <span className="avatar pale">A</span>
            <div>
              Administrator<small>Store owner</small>
            </div>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <b>{page}</b>
          </div>
          <div className="top-right">
            <span className="muted">
              {new Date().toLocaleDateString("en-PK", {
                timeZone: "Asia/Karachi",
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <span className="divider" />
            <span className="avatar pale">A</span>
          </div>
        </div>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                USMAN STATIONARY /{" "}
                {page === "Dashboard" ? "OVERVIEW" : page.toUpperCase()}
              </div>
              <h1>{page === "Dashboard" ? "Business overview" : page}</h1>
              <p>
                {
                  {
                    Dashboard:
                      "Your business at a glance. Every sale, every rupee, in one place.",
                    "Point of Sale":
                      "Quick checkout, accurate stock, and invoices ready to go.",
                    Sales:
                      "Manage invoices, quotations, orders, and customer returns.",
                    Purchases:
                      "Keep purchasing and supplier transactions organized.",
                    "Items & Stock":
                      "Your catalog, stock levels, and barcode labels.",
                    "Customers & Suppliers":
                      "Keep your business relationships in one place.",
                    Expenses: "Track where your money goes.",
                    "Cash & Bank":
                      "A clear view of your balances and money movements.",
                    Reports: "The numbers behind better business decisions.",
                    Settings: "Make this workspace work for your business.",
                  }[page]
                }
              </p>
            </div>
            <div className="actions">
              <button className="secondary" onClick={() => create("purchase")}>
                <Plus size={16} /> Purchase
              </button>
              <button onClick={() => create("sale")}>
                <Plus size={16} /> New sale
              </button>
            </div>
          </div>
          {error && (
            <div role="alert" className="error">
              <AlertCircle size={18} />
              {error}
              <button onClick={() => setError("")}>×</button>
            </div>
          )}
          {page === "Dashboard" && (
            <Dashboard
              state={state}
              create={create}
              view={view}
              setPage={setPage}
            />
          )}
          {page === "Point of Sale" && (
            <POS
              state={state}
              run={run}
              onSaved={(d) => setModal({ kind: "view", document: d })}
            />
          )}
          {["Sales", "Purchases", "Expenses"].includes(page) && (
            <DocumentList
              state={state}
              page={page}
              search={search}
              setSearch={setSearch}
              create={create}
              view={view}
              matching={matching}
            />
          )}
          {page === "Items & Stock" && (
            <>
              <div className="toolbar">
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  placeholder="Search item name, category or barcode"
                />
                <div className="actions">
                  <button
                    className="secondary"
                    onClick={() => setModal({ kind: "barcodes" })}
                  >
                    <ScanBarcode size={17} /> Print barcodes
                  </button>
                  <button onClick={() => setModal({ kind: "item" })}>
                    <Plus size={17} /> Add item
                  </button>
                </div>
              </div>
              <div className="panel table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Item / Barcode</th>
                      <th>Category</th>
                      <th>Purchase cost</th>
                      <th>Sale price</th>
                      <th>In stock</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {state.items.filter(matching).map((i) => (
                      <tr key={i.id}>
                        <td>
                          <b>{i.name}</b>
                          <small>{i.barcode}</small>
                        </td>
                        <td>{i.category}</td>
                        <td>{pkr(i.cost)}</td>
                        <td>{pkr(i.price)}</td>
                        <td>
                          {i.stock} <span className="muted">{i.unit}</span>
                        </td>
                        <td>
                          <Badge
                            tone={i.stock <= i.min_stock ? "amber" : "green"}
                          >
                            {i.stock <= i.min_stock ? "Low stock" : "In stock"}
                          </Badge>
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => setModal({ kind: "item", item: i })}
                          >
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!state.items.length && (
                  <Empty
                    title="Build your inventory"
                    text="Add items and opening stock, then start buying and selling."
                  />
                )}
              </div>
            </>
          )}
          {page === "Customers & Suppliers" && (
            <>
              <div className="toolbar">
                <SearchBox
                  value={search}
                  onChange={setSearch}
                  placeholder="Search customers or suppliers"
                />
                <button onClick={() => setModal({ kind: "party" })}>
                  <Plus size={17} /> Add party
                </button>
              </div>
              <div className="party-grid">
                {state.parties.filter(matching).map((p) => (
                  <div className="panel party-card" key={p.id}>
                    <div className="card-top">
                      <span className="avatar pale">
                        {p.name.slice(0, 2).toUpperCase()}
                      </span>
                      <Badge>{label(p.kind)}</Badge>
                    </div>
                    <h3>{p.name}</h3>
                    <p>{p.phone || "No phone added"}</p>
                    <p>{p.address || "No address added"}</p>
                    <button
                      className="text-button"
                      onClick={() => setModal({ kind: "party", party: p })}
                    >
                      Edit details <ArrowRight size={14} />
                    </button>
                  </div>
                ))}
              </div>
              {!state.parties.length && (
                <Empty title="Add your first business contact" />
              )}
            </>
          )}
          {page === "Cash & Bank" && (
            <>
              <div className="stats two">
                {["Cash", "Bank"].map((a) => (
                  <div className="stat panel" key={a}>
                    <div className="stat-label">
                      {a} balance <Wallet size={19} />
                    </div>
                    <h2>
                      {pkr(
                        state.accounts.find((v) => v.account === a)?.balance ||
                          0,
                      )}
                    </h2>
                    <p>Current ledger balance</p>
                  </div>
                ))}
              </div>
              <div className="toolbar">
                <h2>Money movements</h2>
                <div className="actions">
                  {["opening", "receipt", "payment", "transfer"].map((t) => (
                    <button
                      key={t}
                      className={t === "receipt" ? "" : "secondary"}
                      onClick={() => create(t)}
                    >
                      <Plus size={16} />
                      {label(t)}
                    </button>
                  ))}
                </div>
              </div>
              <DocumentTable
                docs={state.documents.filter((d) =>
                  ["receipt", "payment", "transfer", "opening"].includes(
                    d.type,
                  ),
                )}
                view={view}
              />
              <p className="footnote">
                Receipts reduce customer receivables. Payments reduce supplier
                payables. Use Opening for starting cash or bank funds.
              </p>
            </>
          )}
          {page === "Reports" && <Reports state={state} run={run} />}
          {page === "Settings" && (
            <SettingsPage state={state} run={run} notify={notify} />
          )}
          <footer>
            <span>
              Usman Stationary{" "}
              <span className="muted">· Distribution & accounts</span>
            </span>
            <span>
              All amounts in PKR <span className="dot-sep">·</span> v1.0.0
            </span>
          </footer>
        </main>
      </div>
      {modal?.kind === "item" && (
        <ItemModal
          item={modal.item}
          onClose={close}
          busy={busy}
          error={error}
          onSave={(b) =>
            run(
              () => api("/items", { method: "POST", body: b }),
              "Item saved",
            ).then((r) => r && close())
          }
        />
      )}
      {modal?.kind === "party" && (
        <PartyModal
          party={modal.party}
          onClose={close}
          busy={busy}
          error={error}
          onSave={(b) =>
            run(
              () => api("/parties", { method: "POST", body: b }),
              "Party saved",
            ).then((r) => r && close())
          }
        />
      )}
      {modal?.kind === "document" && (
        <Modal title={"New " + label(modal.type)} wide onClose={close}>
          <TransactionForm
            type={modal.type}
            initial={modal.initial}
            state={state}
            busy={busy}
            error={error}
            onSave={(b) =>
              run(
                () => api("/documents", { method: "POST", body: b }),
                "Document saved",
              ).then((d) => d && setModal({ kind: "view", document: d }))
            }
          />
        </Modal>
      )}
      {modal?.kind === "view" && (
        <DocumentView
          document={modal.document}
          state={state}
          onClose={close}
          run={run}
          notify={notify}
          onConvert={(type, d) =>
            setModal({ kind: "document", type, initial: d })
          }
        />
      )}
      {modal?.kind === "barcodes" && (
        <BarcodeModal items={state.items} onClose={close} run={run} />
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}
function SearchBox({ value, onChange, placeholder = "Search transactions…" }) {
  return (
    <div className="search-box">
      <Search size={17} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
function Dashboard({ state, create, view, setPage }) {
  const [range, setRange] = useState("month");
  const current = today();
  const cutoff =
    range === "today"
      ? current
      : range === "month"
        ? current.slice(0, 7) + "-01"
        : "0001-01-01";
  const docs = state.documents.filter(
    (d) => d.date >= cutoff && d.date <= current,
  );
  const sum = (t) =>
    docs.filter((d) => d.type === t).reduce((n, d) => n + d.total, 0);
  const sales = sum("sale") - sum("sale_return"),
    purchase = sum("purchase") - sum("purchase_return"),
    expense = sum("expense");
  const receivable =
    state.accounts.find((a) => a.account === "Accounts receivable")?.balance ||
    0;
  const payable = -(
    state.accounts.find((a) => a.account === "Accounts payable")?.balance || 0
  );
  const low = state.items.filter((i) => i.stock <= i.min_stock);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(current + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() - 6 + i);
    return d.toISOString().slice(0, 10);
  });
  const values = days.map((day) =>
    state.documents
      .filter((d) => d.date === day && ["sale", "sale_return"].includes(d.type))
      .reduce((n, d) => n + (d.type === "sale" ? 1 : -1) * d.total, 0),
  );
  const max = Math.max(...values, 10000);
  const points = values
    .map((v, i) => `${45 + i * 95},${160 - (Math.max(v, 0) / max) * 120}`)
    .join(" ");
  return (
    <>
      <div className="overview-filter">
        <span>
          <span className="online-dot" /> Live business overview
        </span>
        <select
          aria-label="Dashboard date range"
          value={range}
          onChange={(e) => setRange(e.target.value)}
        >
          <option value="today">Today</option>
          <option value="month">This month</option>
          <option value="all">All time</option>
        </select>
      </div>
      <div className="stats">
        {[
          ["Net sales", sales, ShoppingCart, "Sales less returns", "green"],
          [
            "Net purchases",
            purchase,
            ShoppingBag,
            "Purchases less returns",
            "blue",
          ],
          [
            "Receivables",
            receivable,
            ArrowDownLeft,
            "All-time customer balance",
            "amber",
          ],
          [
            "Payables",
            payable,
            ArrowUpRight,
            "All-time supplier balance",
            "purple",
          ],
        ].map(([name, value, Icon, sub, color]) => (
          <div className="stat panel" key={name}>
            <div className="stat-label">
              {name}
              <span className={"stat-icon " + color}>
                <Icon size={18} />
              </span>
            </div>
            <h2>{pkr(value)}</h2>
            <p>{sub}</p>
          </div>
        ))}
      </div>
      <div className="dashboard-middle">
        <section className="panel chart-panel">
          <div className="section-heading">
            <div>
              <h2>Sales performance</h2>
              <p>Your daily sales over the last 7 days</p>
            </div>
            <span className="chart-legend">
              <i /> Net sales
            </span>
          </div>
          <div className="chart-total">
            {pkr(values.reduce((a, b) => a + b, 0))}
            <span>last 7 days</span>
          </div>
          <div className="chart">
            <div className="chart-axis">
              <span>{pkr(max)}</span>
              <span>{pkr(max / 2)}</span>
              <span>Rs 0</span>
            </div>
            <svg
              viewBox="0 0 660 195"
              preserveAspectRatio="none"
              aria-label="Sales for the last seven days"
            >
              <defs>
                <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#167460" stopOpacity=".18" />
                  <stop offset="100%" stopColor="#167460" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[40, 100, 160].map((y) => (
                <line
                  key={y}
                  x1="0"
                  x2="660"
                  y1={y}
                  y2={y}
                  stroke="#e8edea"
                  strokeDasharray="4 5"
                />
              ))}
              <polygon points={`45,160 ${points} 615,160`} fill="url(#fill)" />
              <polyline
                points={points}
                fill="none"
                stroke="#14765e"
                strokeWidth="3"
                strokeLinejoin="round"
              />
              {values.map((v, i) => (
                <circle
                  key={i}
                  cx={45 + i * 95}
                  cy={160 - (Math.max(v, 0) / max) * 120}
                  r="4"
                  fill="white"
                  stroke="#14765e"
                  strokeWidth="2"
                />
              ))}
            </svg>
            <div className="chart-days">
              {days.map((d) => (
                <span key={d}>
                  {new Date(d + "T12:00:00Z").toLocaleDateString("en", {
                    weekday: "short",
                  })}
                </span>
              ))}
            </div>
          </div>
        </section>
        <section className="panel quick-panel">
          <h2>Quick actions</h2>
          <p>A little less clicking. A lot more done.</p>
          {[
            [
              "Create an invoice",
              "Record a sale & print invoice",
              "sale",
              ReceiptText,
            ],
            [
              "New purchase",
              "Bring stock into your store",
              "purchase",
              ShoppingBag,
            ],
            [
              "Create a quotation",
              "Send a customer an estimate",
              "quotation",
              FileText,
            ],
            [
              "Record an expense",
              "Keep your spending in check",
              "expense",
              Wallet,
            ],
          ].map(([title, sub, t, Icon]) => (
            <button className="quick-action" key={t} onClick={() => create(t)}>
              <span>
                <Icon size={19} />
              </span>
              <div>
                <b>{title}</b>
                <small>{sub}</small>
              </div>
              <ChevronRight size={16} />
            </button>
          ))}
        </section>
      </div>
      <div className="dashboard-bottom">
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>Recent transactions</h2>
              <p>The latest activity across your store</p>
            </div>
            <button className="text-button" onClick={() => setPage("Sales")}>
              View all <ArrowRight size={15} />
            </button>
          </div>
          <DocumentTable
            docs={state.documents.slice(0, 5)}
            view={view}
            embedded
          />
        </section>
        <section className="panel low-panel">
          <div className="section-heading">
            <h2>Stock alerts</h2>
            <Badge tone="amber">{low.length} items</Badge>
          </div>
          {low.slice(0, 4).map((i) => (
            <div className="stock-row" key={i.id}>
              <span className="product-icon">
                <Package size={17} />
              </span>
              <div>
                <b>{i.name}</b>
                <small>
                  Min. {i.min_stock} {i.unit}
                </small>
              </div>
              <strong>
                {i.stock}
                <small>left</small>
              </strong>
            </div>
          ))}
          {!low.length && (
            <div className="stock-good">
              <Check size={26} />
              <p>Stock levels look good</p>
            </div>
          )}
          <button
            className="secondary full"
            onClick={() => setPage("Items & Stock")}
          >
            View inventory <ArrowRight size={15} />
          </button>
          <div className="expense-summary">
            <span>Expenses · selected period</span>
            <b>{pkr(expense)}</b>
          </div>
        </section>
      </div>
    </>
  );
}
function DocumentTable({ docs, view, embedded = false }) {
  return (
    <div className={embedded ? "table-wrap" : "panel table-wrap"}>
      <table>
        <thead>
          <tr>
            <th>Document</th>
            <th>Party</th>
            <th>Date</th>
            <th>Amount</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {docs.map((d) => (
            <tr key={d.id}>
              <td>
                <button className="doc-link" onClick={() => view(d)}>
                  {d.number}
                </button>
                <small>{label(d.type)}</small>
              </td>
              <td>{d.party_name || "Walk-in"}</td>
              <td>{d.date}</td>
              <td>
                <b>{pkr(d.total)}</b>
              </td>
              <td>
                <Badge
                  tone={
                    ["quotation", "sale_order", "purchase_order"].includes(
                      d.type,
                    )
                      ? "blue"
                      : d.total === d.paid
                        ? "green"
                        : "amber"
                  }
                >
                  {["quotation", "sale_order", "purchase_order"].includes(
                    d.type,
                  )
                    ? "Draft document"
                    : d.total === d.paid
                      ? "Paid"
                      : "Credit"}
                </Badge>
              </td>
              <td>
                <IconButton
                  aria-label={"Open " + d.number}
                  onClick={() => view(d)}
                >
                  <ArrowUpRight size={17} />
                </IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!docs.length && (
        <Empty
          title="No transactions yet"
          text="Your saved documents will appear here."
        />
      )}
    </div>
  );
}
function DocumentList({
  state,
  page,
  search,
  setSearch,
  create,
  view,
  matching,
}) {
  const types =
    page === "Sales"
      ? ["sale", "sale_order", "sale_return", "quotation"]
      : page === "Purchases"
        ? ["purchase", "purchase_order", "purchase_return"]
        : ["expense"];
  const [tab, setTab] = useState("all");
  useEffect(() => setTab("all"), [page]);
  const docs = state.documents.filter(
    (d) =>
      types.includes(d.type) &&
      matching(d) &&
      (tab === "all" || d.type === tab),
  );
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          {["all", ...types].map((t) => (
            <button
              key={t}
              className={tab === t ? "selected" : ""}
              onClick={() => setTab(t)}
            >
              {label(t)}
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar">
        <SearchBox value={search} onChange={setSearch} />
        <div className="actions">
          {types.map((t) => (
            <button
              key={t}
              className={t === types[0] ? "" : "secondary"}
              onClick={() => create(t)}
            >
              <Plus size={15} />
              {label(t)}
            </button>
          ))}
        </div>
      </div>
      <DocumentTable docs={docs} view={view} />
      <p className="footnote">
        Posted records are preserved. Use a linked return to reverse stock and
        accounting entries.
      </p>
    </>
  );
}
function Login({ onLogin }) {
  const [name, setName] = useState("admin"),
    [password, setPassword] = useState(""),
    [setupKey, setSetupKey] = useState(""),
    [url, setUrl] = useState(apiBase()),
    [setup, setSetup] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api("/health")
      .then((r) => setSetup(r.setup))
      .catch(() => {});
  }, []);
  return (
    <div className="login-page">
      <div className="login-brand">
        <div className="brand-icon">
          <Store size={30} />
        </div>
        <h1>Usman Stationary</h1>
        <p>
          Everything your distribution business needs.
          <br />
          One connected workspace.
        </p>
        <div className="login-detail">
          <Package />
          <span>Inventory that stays in sync</span>
        </div>
        <div className="login-detail">
          <ReceiptText />
          <span>From checkout to your accounts</span>
        </div>
        <div className="login-detail">
          <ChartNoAxesCombined />
          <span>A clearer picture of your business</span>
        </div>
        <small>BUILT FOR YOUR BUSINESS · PKR</small>
      </div>
      <form
        className="login-form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            const u = new URL(url);
            if (
              u.protocol !== "https:" &&
              !["127.0.0.1", "localhost"].includes(u.hostname)
            )
              throw Error("Use HTTPS for your server");
            localStorage.setItem("api", url.replace(/\/$/, ""));
            const r = await api("/auth", {
              method: "POST",
              body: { name, password, setup_key: setupKey },
            });
            sessionStorage.setItem("token", r.token);
            onLogin();
          } catch (e) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className="eyebrow">WELCOME TO YOUR WORKSPACE</span>
        <h1>{setup ? "Set up your store" : "Welcome back"}</h1>
        <p>
          {setup
            ? "Create the administrator account to get started."
            : "Sign in to manage your business."}
        </p>
        <Field
          label="Username"
          autoComplete="username"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label="Password"
          type="password"
          autoComplete={setup ? "new-password" : "current-password"}
          minLength={setup ? 12 : 1}
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {setup && (
          <Field
            label="Server setup key"
            type="password"
            required
            value={setupKey}
            onChange={(e) => setSetupKey(e.target.value)}
          />
        )}
        <details>
          <summary>Server connection & first-time setup</summary>
          <Field
            label="API server"
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Field
            label="Setup key (only required for a new server)"
            type="password"
            value={setupKey}
            onChange={(e) => setSetupKey(e.target.value)}
          />
        </details>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <button disabled={busy} className="full">
          {busy ? "Connecting…" : setup ? "Create account" : "Sign in"}
          <ArrowRight size={17} />
        </button>
        <p className="login-note">Connected accounting. Confident decisions.</p>
      </form>
    </div>
  );
}
function ItemModal({ item, onClose, onSave, busy, error }) {
  const [b, setB] = useState(
    item
      ? { ...item, cost: item.cost / 100, price: item.price / 100 }
      : {
          name: "",
          barcode: "",
          category: "General",
          unit: "pcs",
          cost: 0,
          price: 0,
          stock: 0,
          min_stock: 5,
          batch: "",
          serial: "",
        },
  );
  const f = (k, v) => setB({ ...b, [k]: v });
  return (
    <Modal
      title={item ? "Edit item" : "Add an item"}
      subtitle="Build a catalog that works at the counter."
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(b);
        }}
      >
        <div className="form-grid">
          <Field
            label="Item name"
            required
            value={b.name}
            onChange={(e) => f("name", e.target.value)}
          />
          <div className="field">
            <span>Barcode / SKU</span>
            <div className="input-action">
              <input
                aria-label="Barcode / SKU"
                required
                value={b.barcode}
                onChange={(e) => f("barcode", e.target.value)}
              />
              <button
                type="button"
                className="secondary"
                onClick={() =>
                  f("barcode", "US" + Date.now().toString().slice(-11))
                }
              >
                Generate
              </button>
            </div>
          </div>
          <Field
            label="Category"
            required
            value={b.category}
            onChange={(e) => f("category", e.target.value)}
          />
          <Field
            label="Unit"
            required
            value={b.unit}
            onChange={(e) => f("unit", e.target.value)}
          />
          <Field
            label="Purchase cost (PKR)"
            type="number"
            min="0"
            step="0.01"
            required
            disabled={!!item}
            value={b.cost}
            onChange={(e) => f("cost", e.target.value)}
          />
          <Field
            label="Sale price (PKR)"
            type="number"
            min="0"
            step="0.01"
            required
            value={b.price}
            onChange={(e) => f("price", e.target.value)}
          />
          <Field
            label="Opening stock"
            type="number"
            min="0"
            step="0.001"
            disabled={!!item}
            value={b.stock}
            onChange={(e) => f("stock", e.target.value)}
          />
          <Field
            label="Low stock alert at"
            type="number"
            min="0"
            step="0.001"
            value={b.min_stock}
            onChange={(e) => f("min_stock", e.target.value)}
          />
          <Field
            label="Batch identifier (optional)"
            value={b.batch}
            onChange={(e) => f("batch", e.target.value)}
          />
          <Field
            label="Serial identifier (optional)"
            value={b.serial}
            onChange={(e) => f("serial", e.target.value)}
          />
        </div>
        {item && (
          <p className="footnote">
            Record purchases and returns to change stock. Cost follows the
            weighted average of purchases.
          </p>
        )}
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy}>Save item</button>
        </div>
      </form>
    </Modal>
  );
}
function PartyModal({ party, onClose, onSave, busy, error }) {
  const [b, setB] = useState(
    party || { name: "", kind: "customer", phone: "", address: "" },
  );
  const f = (k, v) => setB({ ...b, [k]: v });
  return (
    <Modal
      title={party ? "Edit contact" : "Add customer / supplier"}
      onClose={onClose}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSave(b);
        }}
      >
        <Field
          label="Name"
          required
          value={b.name}
          onChange={(e) => f("name", e.target.value)}
        />
        <Field label="Type">
          <select value={b.kind} onChange={(e) => f("kind", e.target.value)}>
            <option value="customer">Customer</option>
            <option value="supplier">Supplier</option>
            <option value="both">Customer & supplier</option>
          </select>
        </Field>
        <Field
          label="WhatsApp / phone"
          placeholder="923001234567"
          value={b.phone}
          onChange={(e) => f("phone", e.target.value)}
        />
        <Field
          label="Address"
          value={b.address}
          onChange={(e) => f("address", e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy}>Save contact</button>
        </div>
      </form>
    </Modal>
  );
}
function TransactionForm({
  type,
  state,
  onSave,
  busy,
  error,
  initial,
  compact = false,
}) {
  const financial = [
      "expense",
      "receipt",
      "payment",
      "transfer",
      "opening",
    ].includes(type),
    isReturn = type.endsWith("_return"),
    purchase = type.startsWith("purchase"),
    informational = ["quotation", "sale_order", "purchase_order"].includes(
      type,
    );
  const [b, setB] = useState({
    type,
    date: today(),
    party_id: initial?.party_id || "",
    account: "Cash",
    to_account: "Bank",
    paid: 0,
    amount: "",
    notes: "",
    category: "General",
    reference_id: "",
    lines:
      initial?.lines?.map((l) => ({
        item_id: l.item_id,
        qty: l.qty,
        price: l.price / 100,
        discount: l.discount / 100,
        discount_mode: "amount",
        tax: l.tax / 100,
        tax_mode: "amount",
      })) || [],
  });
  const [q, setQ] = useState(""),
    [allPaid, setAllPaid] = useState(true);
  const f = (k, v) => setB((vb) => ({ ...vb, [k]: v }));
  const line = (idx, k, v) =>
    setB((vb) => ({
      ...vb,
      lines: vb.lines.map((l, i) => {
        if (i !== idx) return l;
        if (isReturn && k === "qty") {
          const ratio = Number(v) / Number(l.qty || 1);
          return {
            ...l,
            qty: v,
            discount: Number(l.discount) * ratio,
            tax: Number(l.tax) * ratio,
          };
        }
        return { ...l, [k]: v };
      }),
    }));
  const add = (item) => {
    setB((vb) => {
      const old = vb.lines.find((l) => l.item_id === item.id);
      return {
        ...vb,
        lines: old
          ? vb.lines.map((l) =>
              l.item_id === item.id ? { ...l, qty: Number(l.qty) + 1 } : l,
            )
          : [
              ...vb.lines,
              {
                item_id: item.id,
                qty: 1,
                price: (purchase ? item.cost : item.price) / 100,
                discount: 0,
                discount_mode: "percent",
                tax: Number(state.settings.default_tax) || 0,
                tax_mode: "percent",
              },
            ],
      };
    });
    setQ("");
  };
  const calc = (l) => {
    const base = Math.round(Number(l.qty) * Math.round(Number(l.price) * 100));
    const discount =
      l.discount_mode === "percent"
        ? Math.round((base * Number(l.discount || 0)) / 100)
        : Math.round(Number(l.discount || 0) * 100);
    const tax =
      l.tax_mode === "amount"
        ? Math.round(Number(l.tax || 0) * 100)
        : Math.round(((base - discount) * Number(l.tax || 0)) / 100);
    return { base, discount, tax, total: base - discount + tax };
  };
  const totals = b.lines.reduce(
    (a, l) => {
      const c = calc(l);
      return {
        base: a.base + c.base,
        discount: a.discount + c.discount,
        tax: a.tax + c.tax,
        total: a.total + c.total,
      };
    },
    { base: 0, discount: 0, tax: 0, total: 0 },
  );
  const filtered = state.items
    .filter((i) =>
      (i.name + " " + i.barcode + " " + i.category)
        .toLowerCase()
        .includes(q.toLowerCase()),
    )
    .slice(0, compact ? 30 : 8);
  async function selectReference(id) {
    f("reference_id", id);
    if (!id) return;
    try {
      const d = await api("/documents/" + id);
      setB((vb) => ({
        ...vb,
        reference_id: id,
        party_id: d.party_id || "",
        lines: d.lines.map((l) => ({
          item_id: l.item_id,
          qty: l.qty,
          price: l.price / 100,
          discount: l.discount / 100,
          discount_mode: "amount",
          tax: l.tax / 100,
          tax_mode: "amount",
        })),
      }));
    } catch (e) {
      f("notes", e.message);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          ...b,
          paid: allPaid && !informational ? totals.total / 100 : b.paid,
        });
      }}
      className={compact ? "pos-form" : ""}
    >
      <div className="form-grid">
        <Field
          label="Business date"
          type="date"
          required
          value={b.date}
          onChange={(e) => f("date", e.target.value)}
        />
        <Field label={purchase ? "Supplier" : "Customer / party"}>
          <select
            value={b.party_id}
            onChange={(e) => f("party_id", e.target.value)}
            required={["receipt", "payment"].includes(type)}
          >
            <option value="">Walk-in / none</option>
            {state.parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {label(p.kind)}
              </option>
            ))}
          </select>
        </Field>
        {isReturn && (
          <Field label="Original invoice">
            <select
              required
              value={b.reference_id}
              onChange={(e) => selectReference(e.target.value)}
            >
              <option value="">Choose original invoice</option>
              {state.documents
                .filter((d) => d.type === (purchase ? "purchase" : "sale"))
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.number} · {d.party_name || "Walk-in"}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field label="Payment account">
          <select
            value={b.account}
            onChange={(e) => f("account", e.target.value)}
          >
            <option>Cash</option>
            <option>Bank</option>
          </select>
        </Field>
        {financial && (
          <Field
            label="Amount (PKR)"
            type="number"
            required
            min="0.01"
            step="0.01"
            value={b.amount}
            onChange={(e) => f("amount", e.target.value)}
          />
        )}{" "}
        {type === "transfer" && (
          <Field label="To account">
            <select
              value={b.to_account}
              onChange={(e) => f("to_account", e.target.value)}
            >
              <option>Bank</option>
              <option>Cash</option>
            </select>
          </Field>
        )}
        {type === "expense" && (
          <Field
            label="Expense category"
            required
            value={b.category}
            onChange={(e) => f("category", e.target.value)}
          />
        )}
      </div>
      {!financial && (
        <>
          <div className="item-picker">
            <div className="search-box">
              <ScanBarcode size={19} />
              <input
                aria-label="Scan barcode or search items"
                placeholder="Scan barcode or search items…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const exact =
                      state.items.find((i) => i.barcode === q) || filtered[0];
                    if (exact && !isReturn) add(exact);
                  }
                }}
              />
            </div>
            {q && !isReturn && (
              <div className="search-results">
                {filtered.map((i) => (
                  <button type="button" key={i.id} onClick={() => add(i)}>
                    <span>
                      <b>{i.name}</b>
                      <small>
                        {i.barcode} · {i.stock} {i.unit} available
                      </small>
                    </span>
                    <b>{pkr(purchase ? i.cost : i.price)}</b>
                    <Plus size={16} />
                  </button>
                ))}
                {!filtered.length && (
                  <p>No items found. Add an item in Items & Stock.</p>
                )}
              </div>
            )}
          </div>
          {compact && !q && (
            <div className="pos-products">
              {filtered.map((i) => (
                <button type="button" key={i.id} onClick={() => add(i)}>
                  <span className="product-icon">
                    <Package size={22} />
                  </span>
                  <b>{i.name}</b>
                  <small>
                    {i.category} · {i.stock} left
                  </small>
                  <strong>
                    {pkr(i.price)} <Plus size={16} />
                  </strong>
                </button>
              ))}
              {!state.items.length && (
                <Empty
                  title="Your catalog is empty"
                  text="Add items in Items & Stock to begin checkout."
                />
              )}
            </div>
          )}
          <div className="table-wrap line-table">
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Rate (PKR)</th>
                  <th>Discount</th>
                  <th>Tax</th>
                  <th>Total</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {b.lines.map((l, idx) => (
                  <tr key={l.item_id}>
                    <td>
                      <b>{state.items.find((i) => i.id === l.item_id)?.name}</b>
                    </td>
                    <td>
                      <input
                        aria-label={"Quantity " + idx}
                        type="number"
                        min="0.001"
                        step="0.001"
                        required
                        value={l.qty}
                        onChange={(e) => line(idx, "qty", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={"Rate " + idx}
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        disabled={isReturn}
                        value={l.price}
                        onChange={(e) => line(idx, "price", e.target.value)}
                      />
                    </td>
                    {["discount", "tax"].map((k) => (
                      <td key={k}>
                        <div className="amount-input">
                          <input
                            aria-label={label(k) + " " + idx}
                            type="number"
                            min="0"
                            step="0.01"
                            disabled={isReturn}
                            value={l[k]}
                            onChange={(e) => line(idx, k, e.target.value)}
                          />
                          <select
                            aria-label={label(k) + " mode " + idx}
                            disabled={isReturn}
                            value={l[k + "_mode"]}
                            onChange={(e) =>
                              line(idx, k + "_mode", e.target.value)
                            }
                          >
                            <option value="percent">%</option>
                            <option value="amount">Rs</option>
                          </select>
                        </div>
                      </td>
                    ))}
                    <td>{pkr(calc(l).total)}</td>
                    <td>
                      <IconButton
                        type="button"
                        aria-label={"Remove item " + idx}
                        onClick={() =>
                          f(
                            "lines",
                            b.lines.filter((_, i) => i !== idx),
                          )
                        }
                      >
                        <Trash2 size={15} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!b.lines.length && (
              <div className="cart-empty">
                <ShoppingCart size={22} /> Scan or search above to add items
              </div>
            )}
          </div>
          <div className="checkout-bottom">
            <div>
              <Field label="Notes / terms">
                <textarea
                  rows="3"
                  value={b.notes}
                  onChange={(e) => f("notes", e.target.value)}
                />
              </Field>
              {!informational && (
                <>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={allPaid}
                      onChange={(e) => setAllPaid(e.target.checked)}
                    />{" "}
                    {isReturn ? "Full refund" : "Fully paid"}
                  </label>
                  {!allPaid && (
                    <Field
                      label={isReturn ? "Refunded now (PKR)" : "Paid now (PKR)"}
                      type="number"
                      min="0"
                      step="0.01"
                      value={b.paid}
                      onChange={(e) => f("paid", e.target.value)}
                    />
                  )}
                </>
              )}
            </div>
            <div className="totals">
              <div>
                <span>Subtotal</span>
                <b>{pkr(totals.base)}</b>
              </div>
              <div>
                <span>Discount</span>
                <b>− {pkr(totals.discount)}</b>
              </div>
              <div>
                <span>Tax</span>
                <b>{pkr(totals.tax)}</b>
              </div>
              <div className="grand-total">
                <span>Total (PKR)</span>
                <strong>{pkr(totals.total)}</strong>
              </div>
            </div>
          </div>
        </>
      )}
      {financial && (
        <Field
          label="Description / reference"
          required={type === "expense"}
          value={b.notes}
          onChange={(e) => f("notes", e.target.value)}
        />
      )}
      {error && <div className="error">{error}</div>}
      <div className="modal-actions">
        <span className="footnote">
          {informational
            ? "Quotations and orders do not change stock or accounts."
            : "Saving posts stock and accounts together."}
        </span>
        <button disabled={busy || (!financial && !b.lines.length)}>
          <Check size={17} />
          {busy ? "Saving…" : "Save " + label(type)}
        </button>
      </div>
    </form>
  );
}
function POS({ state, run, onSaved }) {
  const [key, setKey] = useState(0),
    [busy, setBusy] = useState(false);
  return (
    <div className="panel pos-panel">
      <div className="section-heading">
        <div>
          <h2>Sales counter</h2>
          <p>
            Barcode scanners work just like a keyboard. Scan, review, and save.
          </p>
        </div>
        <Badge tone="green">Ready for checkout</Badge>
      </div>
      <TransactionForm
        key={key}
        compact
        type="sale"
        state={state}
        busy={busy}
        onSave={async (b) => {
          setBusy(true);
          const d = await run(
            () => api("/documents", { method: "POST", body: b }),
            "Sale completed",
          );
          setBusy(false);
          if (d) {
            setKey(key + 1);
            onSaved(d);
          }
        }}
      />
    </div>
  );
}
function DocumentView({ document: d, state, onClose, run, notify, onConvert }) {
  const [paper, setPaper] = useState(state.settings.paper || "A4");
  const s = state.settings;
  async function print(pdf) {
    const result = await run(() =>
      printHTML(invoiceHTML(d, s, paper), {
        pdf,
        paper,
        name: d.number,
        printer: s.printer,
      }),
    );
    if (result?.saved) notify("PDF saved: " + result.path);
  }
  async function whatsapp() {
    let phone = (d.phone || "").replace(/\D/g, "");
    if (phone.startsWith("0")) phone = "92" + phone.slice(1);
    if (!/^\d{7,15}$/.test(phone)) {
      notify("Add a valid WhatsApp phone number to this party first.");
      return;
    }
    const message = `${s.business_name || "Usman Stationary"}\n${label(d.type)} ${d.number}\nDate: ${d.date}\n${d.lines.map((l) => `${l.name} × ${l.qty}: ${pkr(l.total)}`).join("\n")}\nTotal: ${pkr(d.total)}\nPaid: ${pkr(d.paid)}\nBalance: ${pkr(d.total - d.paid)}\n${s.invoice_footer || "Thank you for your business."}`;
    await run(() =>
      window.desktop
        ? window.desktop.whatsapp({ phone, message })
        : Promise.resolve(
            window.open(
              "https://wa.me/" + phone + "?text=" + encodeURIComponent(message),
              "_blank",
              "noopener,noreferrer",
            ),
          ),
    );
    notify(
      "WhatsApp opened with document details. To share the PDF, save it and attach it in WhatsApp.",
    );
  }
  return (
    <Modal
      title={d.number}
      subtitle={label(d.type) + " · " + d.date}
      wide
      onClose={onClose}
    >
      <div className="document-actions">
        <select
          aria-label="Paper size"
          value={paper}
          onChange={(e) => setPaper(e.target.value)}
        >
          <option>A4</option>
          <option>80mm</option>
          <option>58mm</option>
        </select>
        <button className="secondary" onClick={() => print(false)}>
          <Printer size={16} /> Print
        </button>
        <button className="secondary" onClick={() => print(true)}>
          <Download size={16} /> Save PDF
        </button>
        <button onClick={whatsapp}>
          <Send size={16} /> WhatsApp
        </button>
        {["quotation", "sale_order", "purchase_order"].includes(d.type) && (
          <button
            className="secondary"
            onClick={() =>
              onConvert(d.type === "purchase_order" ? "purchase" : "sale", d)
            }
          >
            Use for {d.type === "purchase_order" ? "purchase" : "invoice"}
          </button>
        )}
      </div>
      <div className="invoice-preview">
        <div className="invoice-header">
          <div>
            <h2>{s.business_name || "Usman Stationary"}</h2>
            <p>
              {s.address}
              <br />
              {s.phone}
            </p>
          </div>
          <div>
            <h3>{label(d.type)}</h3>
            <b>{d.number}</b>
            <p>{d.date}</p>
          </div>
        </div>
        <div className="invoice-party">
          <small>BILL TO</small>
          <h3>{d.party_name || "Walk-in customer"}</h3>
          <p>
            {d.address}
            <br />
            {d.phone}
          </p>
        </div>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Rate</th>
              <th>Discount</th>
              <th>Tax</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td>{l.qty}</td>
                <td>{pkr(l.price)}</td>
                <td>{pkr(l.discount)}</td>
                <td>{pkr(l.tax)}</td>
                <td>{pkr(l.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="totals invoice-totals">
          {[
            ["Subtotal", d.subtotal],
            ["Discount", -d.discount],
            ["Tax", d.tax],
            ["Total", d.total],
            ["Paid / refunded", d.paid],
            ["Balance", d.total - d.paid],
          ].map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b>{pkr(v)}</b>
            </div>
          ))}
        </div>
        <p>{d.notes}</p>
        <div className="invoice-footer">
          {s.invoice_footer || "Thank you for your business."}
        </div>
      </div>
    </Modal>
  );
}
function BarcodeModal({ items, onClose, run }) {
  const [selected, setSelected] = useState([]),
    [copies, setCopies] = useState(1),
    [q, setQ] = useState("");
  return (
    <Modal
      title="Print barcode labels"
      subtitle="Code 128 labels · A4 sheet · 48 mm wide"
      onClose={onClose}
    >
      <SearchBox value={q} onChange={setQ} />
      <div className="barcode-items">
        {items
          .filter((i) =>
            (i.name + i.barcode).toLowerCase().includes(q.toLowerCase()),
          )
          .map((i) => (
            <label key={i.id}>
              <input
                type="checkbox"
                checked={selected.includes(i.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, i.id]
                      : selected.filter((id) => id !== i.id),
                  )
                }
              />
              <span>
                <b>{i.name}</b>
                <small>{i.barcode}</small>
              </span>
              <span>{pkr(i.price)}</span>
            </label>
          ))}
      </div>
      <Field
        label="Copies per item"
        type="number"
        min="1"
        max="100"
        value={copies}
        onChange={(e) => setCopies(Number(e.target.value))}
      />
      <div className="modal-actions">
        <button className="secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          disabled={
            !selected.length ||
            copies < 1 ||
            copies > 100 ||
            !Number.isInteger(copies)
          }
          onClick={() =>
            run(async () =>
              printHTML(
                await barcodeHTML(
                  items.filter((i) => selected.includes(i.id)),
                  copies,
                ),
              ),
            )
          }
        >
          <Printer size={16} /> Print labels
        </button>
      </div>
    </Modal>
  );
}
function Reports({ state, run }) {
  const [selected, setSelected] = useState(""),
    [q, setQ] = useState(""),
    [from, setFrom] = useState(today().slice(0, 7) + "-01"),
    [to, setTo] = useState(today()),
    [party, setParty] = useState(""),
    [item, setItem] = useState(""),
    [result, setResult] = useState(null),
    [loading, setLoading] = useState(false);
  async function load(name = selected) {
    setSelected(name);
    setLoading(true);
    const r = await run(() =>
      api(
        "/reports?" +
          new URLSearchParams({
            name,
            from,
            to,
            party_id: party,
            item_id: item,
          }),
      ),
    );
    setResult(r);
    setLoading(false);
  }
  return (
    <>
      {!selected ? (
        <>
          <div className="toolbar">
            <SearchBox value={q} onChange={setQ} placeholder="Find a report…" />
            <span className="muted">
              {Object.values(state.reports).flat().length} business reports
            </span>
          </div>
          <div className="report-grid">
            {Object.entries(state.reports).map(([group, names]) => (
              <section className="panel report-card" key={group}>
                <div className="report-group-title">
                  <span className="product-icon">
                    <ChartNoAxesCombined size={20} />
                  </span>
                  <h2>{group}</h2>
                </div>
                {names
                  .filter((n) => n.toLowerCase().includes(q.toLowerCase()))
                  .map((n) => (
                    <button key={n} onClick={() => load(n)}>
                      {n}
                      <ArrowUpRight size={15} />
                    </button>
                  ))}
              </section>
            ))}
          </div>
        </>
      ) : (
        <>
          <button
            className="text-button back"
            onClick={() => {
              setSelected("");
              setResult(null);
            }}
          >
            ← All reports
          </button>
          <div className="panel report-result">
            <div className="section-heading">
              <h2>{selected}</h2>
              <div className="actions">
                <button
                  className="secondary"
                  disabled={!result?.rows.length}
                  onClick={() => exportCSV(result)}
                >
                  <Download size={16} /> CSV
                </button>
                <button
                  className="secondary"
                  disabled={!result}
                  onClick={() =>
                    run(() =>
                      printHTML(reportHTML(result, state.settings), {
                        pdf: true,
                        name: selected,
                      }),
                    )
                  }
                >
                  <Printer size={16} /> Print / PDF
                </button>
              </div>
            </div>
            <div className="report-filters">
              <Field
                label="From"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <Field
                label="To"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
              <Field label="Party">
                <select
                  value={party}
                  onChange={(e) => setParty(e.target.value)}
                >
                  <option value="">All parties</option>
                  {state.parties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Item">
                <select value={item} onChange={(e) => setItem(e.target.value)}>
                  <option value="">All items</option>
                  {state.items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </Field>
              <button disabled={loading || from > to} onClick={() => load()}>
                <RefreshCw size={16} /> Run report
              </button>
            </div>
            {result && (
              <>
                <p className="report-note">{result.note}</p>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        {Object.keys(result.rows[0] || {}).map((k) => (
                          <th key={k}>{k}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((r, i) => (
                        <tr key={i}>
                          {Object.entries(r).map(([k, v]) => (
                            <td key={k}>
                              {typeof v === "number"
                                ? v.toLocaleString("en-PK", {
                                    maximumFractionDigits: 2,
                                  })
                                : v}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!result.rows.length && (
                    <Empty
                      title="No records for these filters"
                      text="Try a wider date range or record transactions first."
                    />
                  )}
                </div>
                <p className="footnote">
                  {result.rows.length} rows · {result.from} to {result.to} · PKR
                </p>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
function SettingsPage({ state, run, notify }) {
  const [b, setB] = useState({
      business_name: "Usman Stationary",
      address: "",
      phone: "",
      invoice_footer: "Thank you for your business.",
      paper: "A4",
      printer: "",
      default_tax: "0",
      ...state.settings,
    }),
    [printers, setPrinters] = useState([]),
    [updates, setUpdates] = useState(
      "Updates are delivered through GitHub Releases.",
    );
  useEffect(() => {
    window.desktop
      ?.printers()
      .then(setPrinters)
      .catch((e) => notify(e.message));
    return window.desktop?.onUpdate(setUpdates);
  }, []);
  return (
    <div className="settings-grid">
      <form
        className="panel settings-card"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => api("/settings", { method: "PUT", body: b }),
            "Settings saved",
          );
        }}
      >
        <h2>Business & invoice details</h2>
        <p>These details appear on your printed documents.</p>
        {[
          ["business_name", "Business name"],
          ["address", "Address"],
          ["phone", "Phone"],
          ["invoice_footer", "Invoice footer"],
        ].map(([k, title]) => (
          <Field
            key={k}
            label={title}
            required={k === "business_name"}
            value={b[k]}
            onChange={(e) => setB({ ...b, [k]: e.target.value })}
          />
        ))}
        <div className="form-grid">
          <Field
            label="Default tax (%)"
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={b.default_tax}
            onChange={(e) => setB({ ...b, default_tax: e.target.value })}
          />
          <Field label="Default paper">
            <select
              value={b.paper}
              onChange={(e) => setB({ ...b, paper: e.target.value })}
            >
              <option>A4</option>
              <option>80mm</option>
              <option>58mm</option>
            </select>
          </Field>
        </div>
        <Field label="Printer">
          <select
            value={b.printer}
            onChange={(e) => setB({ ...b, printer: e.target.value })}
          >
            <option value="">System default / choose when printing</option>
            {printers.map((p) => (
              <option key={p.name}>{p.name}</option>
            ))}
          </select>
        </Field>
        <button>Save settings</button>
      </form>
      <div>
        <section className="panel settings-card">
          <h2>App updates</h2>
          <p>Installed version 1.0.0</p>
          <div className="notice">{updates}</div>
          <div className="actions">
            <button
              className="secondary"
              onClick={async () =>
                setUpdates(
                  window.desktop
                    ? await window.desktop.checkUpdates()
                    : "Open the Windows desktop app to check for updates.",
                )
              }
            >
              <RefreshCw size={16} /> Check updates
            </button>
            <button
              className="secondary"
              onClick={() =>
                run(() =>
                  window.desktop
                    ? window.desktop.installUpdate()
                    : Promise.reject(Error("Use the installed Windows app")),
                )
              }
            >
              Install update
            </button>
          </div>
          <p className="footnote">
            Updates download automatically. Install when your work is saved.
          </p>
        </section>
        <section className="panel settings-card">
          <h2>Backup & connection</h2>
          <p>
            Download a business data snapshot for safekeeping. Server
            administrators can restore it with the documented backup tool.
          </p>
          <button
            className="secondary"
            onClick={() =>
              run(async () => {
                const data = await api("/backup");
                download(
                  "usman-backup-" + today() + ".json",
                  JSON.stringify(data, null, 2),
                  "application/json",
                );
                return { ok: true };
              }, "Backup downloaded")
            }
          >
            <Download size={16} /> Export backup
          </button>
          <div className="connection-info">
            <small>API SERVER</small>
            <p>{apiBase()}</p>
            <small>CURRENCY</small>
            <p>Pakistani Rupee (PKR)</p>
          </div>
        </section>
      </div>
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);

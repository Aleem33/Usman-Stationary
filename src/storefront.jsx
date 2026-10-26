import React, { useState } from "react";
import { RefreshCw, Store, Copy, X } from "lucide-react";
import { api, apiBase, pkr } from "./api";
import { useToast } from "./toasts";
const requestTime = (value) =>
  new Date(String(value).replace(" ", "T") + "Z").toLocaleString("en-PK", {
    timeZone: "Asia/Karachi",
  });

export function StorefrontInbox({ state, run, onSaved, view, refresh }) {
  const [request, setRequest] = useState(null),
    [party, setParty] = useState(""),
    [filter, setFilter] = useState("open"),
    [busy, setBusy] = useState(false),
    [rejecting, setRejecting] = useState(false);
  const notify = useToast();
  const url = apiBase().replace(/\/$/, "") + "/usmanstationary";
  const rows = state.storefrontRequests || [];
  const shown = rows.filter(
    (r) => filter === "all" || ["pending", "accepted"].includes(r.status),
  );
  const close = () => {
    if (!busy) {
      setRequest(null);
      setRejecting(false);
    }
  };
  async function review(row) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await run(() => api("/storefront/requests/" + row.id));
      if (result) {
        setRequest(result);
        setParty("");
        setRejecting(false);
      }
    } finally {
      setBusy(false);
    }
  }
  async function act(action) {
    if (busy) return;
    setBusy(true);
    try {
      const result = await run(
        () =>
          api(`/storefront/requests/${request.id}/${action}`, {
            method: "POST",
            body: { party_id: party || null },
          }),
        action === "accept"
          ? "Store request accepted as an order"
          : "Store request rejected",
      );
      if (result) {
        setRequest(null);
        setRejecting(false);
        if (action === "accept") onSaved(result);
      }
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      notify("Store link copied. Send it to customers and suppliers.");
    } catch {
      notify("Copy this store link: " + url, "info");
    }
  }
  return (
    <>
      <section
        className="panel storefront-inbox"
        aria-label="Incoming store requests"
      >
        <div className="section-heading">
          <div>
            <h2>
              Online store requests{" "}
              <span className="badge green">
                {rows.filter((r) => r.status === "pending").length} pending
              </span>
            </h2>
            <p>
              Review customer orders and supplier offers, then prepare their
              invoice or purchase.
            </p>
          </div>
          <div className="actions">
            <a
              className="store-link"
              href={url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => {
                if (window.desktop?.openStore) {
                  e.preventDefault();
                  run(() => window.desktop.openStore());
                }
              }}
            >
              <Store size={16} />
              Open store
            </a>
            <button className="secondary" onClick={copy}>
              <Copy size={16} />
              Copy store link
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await refresh();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <RefreshCw size={16} />
              Refresh requests
            </button>
          </div>
        </div>
        <div className="store-request-filter">
          <label>
            Show{" "}
            <select
              aria-label="Store request filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="open">Pending & accepted</option>
              <option value="all">All recent requests</option>
            </select>
          </label>
          <span>
            Up to 500 requests, pending first; accepted orders remain in Sales /
            Purchases history.
          </span>
        </div>
        {state.storefrontRequests == null ? (
          <p className="store-request-empty">
            Update the backend to enable online store requests.
          </p>
        ) : !shown.length ? (
          <p className="store-request-empty">
            No requests to review. Share your store link to start receiving
            orders.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Contact</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <b>{row.code}</b>
                      <small>{requestTime(row.created_at)}</small>
                    </td>
                    <td>
                      <b>{row.contact_name}</b>
                      <small>{row.phone}</small>
                    </td>
                    <td>
                      {row.role === "customer"
                        ? "Customer order"
                        : "Supplier offer"}
                    </td>
                    <td>
                      <span
                        className={
                          "badge " +
                          (row.status === "pending" ? "amber" : "green")
                        }
                      >
                        {row.status}
                      </span>
                    </td>
                    <td>
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => review(row)}
                      >
                        Review request
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {request && (
        <div
          className="overlay"
          onMouseDown={(e) => e.target === e.currentTarget && close()}
        >
          <section
            className="modal wide"
            role="dialog"
            aria-modal="true"
            aria-label="Review store request"
          >
            <header>
              <div>
                <h2>{request.code}</h2>
                <p>
                  {request.role === "customer"
                    ? "Customer order"
                    : "Supplier offer"}{" "}
                  · {request.status}
                </p>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Close request"
                disabled={busy}
                onClick={close}
              >
                <X size={20} />
              </button>
            </header>
            <div className="store-request-detail">
              <div className="store-contact">
                <h3>{request.contact_name}</h3>
                <p>{request.phone}</p>
                <p>{request.address || "No address provided"}</p>
                <p>{request.notes || "No additional notes"}</p>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Requested product</th>
                      <th>Qty</th>
                      <th>
                        {request.role === "supplier" ? "Offered rate" : "Rate"}
                      </th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {request.lines.map((line) => (
                      <tr key={line.item_id}>
                        <td>
                          <b>{line.name}</b>
                          <small>{line.barcode}</small>
                        </td>
                        <td>
                          {line.qty} {line.unit}
                        </td>
                        <td>{pkr(line.price)}</td>
                        <td>{pkr(line.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="store-request-total">
                Requested total <strong>{pkr(request.total)}</strong>
              </p>
              {request.status === "pending" && (
                <>
                  <p className="footnote">
                    These contact details were submitted online and are
                    unverified. Check them before linking to an existing
                    contact. Accepting creates an order; stock and accounts
                    change only when you save the final invoice or purchase.
                  </p>
                  <label className="field">
                    <span>Save under contact</span>
                    <select
                      aria-label="Save under contact"
                      value={party}
                      onChange={(e) => setParty(e.target.value)}
                      disabled={busy}
                    >
                      <option value="">
                        Create new {request.role} from submitted details
                      </option>
                      {state.parties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} · {p.phone || p.kind}
                        </option>
                      ))}
                    </select>
                  </label>
                  {rejecting && (
                    <p className="error">
                      Reject this request? It will remain in request history and
                      will not create a transaction.
                    </p>
                  )}
                  <div className="modal-actions">
                    {rejecting ? (
                      <>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => setRejecting(false)}
                        >
                          Keep request
                        </button>
                        <button disabled={busy} onClick={() => act("reject")}>
                          Confirm rejection
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() => setRejecting(true)}
                        >
                          Reject request
                        </button>
                        <button disabled={busy} onClick={() => act("accept")}>
                          {busy
                            ? "Saving…"
                            : "Accept as " +
                              (request.role === "customer"
                                ? "sale order"
                                : "purchase order")}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
              {["accepted", "fulfilled"].includes(request.status) && (
                <div className="modal-actions">
                  <button
                    disabled={busy}
                    onClick={() => {
                      const id =
                        request.status === "fulfilled"
                          ? request.document_id
                          : request.order_id;
                      setRequest(null);
                      view({ id });
                    }}
                  >
                    {request.status === "fulfilled"
                      ? "View processed transaction"
                      : "Open order to process"}
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}

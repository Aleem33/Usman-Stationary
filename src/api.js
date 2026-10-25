export const DEFAULT_API =
  location.protocol === "file:"
    ? "https://store.aleemcore.com"
    : location.port === "5173"
      ? "http://127.0.0.1:4000"
      : location.origin;
export function apiBase() {
  return localStorage.getItem("api") || DEFAULT_API;
}
export async function api(route, options = {}) {
  const response = await fetch(apiBase() + "/api" + route, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (sessionStorage.getItem("token") || ""),
      ...options.headers,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.json();
  if (!response.ok) {
    if (response.status === 401 && route !== "/auth") {
      sessionStorage.removeItem("token");
      window.dispatchEvent(new Event("auth-expired"));
    }
    throw Error(body.error || "Request failed");
  }
  return body;
}
export const pkr = (n) =>
  "Rs " +
  Number((n || 0) / 100).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
export const today = () =>
  new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
export const label = (s) =>
  s.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
export function download(name, body, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

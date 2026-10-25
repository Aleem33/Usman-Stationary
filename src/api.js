import { requestJson } from "./http.mjs";
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
  const { timeoutMs, ...init } = options;
  const headers = new Headers({
    "Content-Type": "application/json",
    ...options.headers,
  });
  if (!headers.has("Authorization"))
    headers.set(
      "Authorization",
      "Bearer " + (sessionStorage.getItem("token") || ""),
    );
  const token = headers.get("Authorization").replace(/^Bearer /i, "");
  try {
    return await requestJson(
      apiBase() + "/api" + route,
      {
        ...init,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      },
      {
        timeoutMs:
          timeoutMs ??
          (["/restore", "/backup"].includes(route) ? 120000 : 30000),
      },
    );
  } catch (error) {
    if (
      error.status === 401 &&
      error.apiResponse &&
      !["/auth", "/auth/reset-password", "/logout"].includes(route) &&
      token &&
      sessionStorage.getItem("token") === token
    ) {
      sessionStorage.removeItem("token");
      window.dispatchEvent(new Event("auth-expired"));
    }
    throw error;
  }
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

export class ApiError extends Error {
  constructor(
    message,
    {
      status = 0,
      code = "REQUEST_FAILED",
      retryable = false,
      apiResponse = false,
      retryAfter = 0,
    } = {},
  ) {
    super(message);
    this.name = "ApiError";
    Object.assign(this, { status, code, retryable, apiResponse, retryAfter });
  }
}
const temporary = new Set([502, 503, 504]);
function failureMessage(status) {
  if (temporary.has(status))
    return "The server is temporarily unavailable. Please try again shortly.";
  if (status === 401) return "Please sign in again.";
  if (status === 404)
    return "This server endpoint is unavailable. Check the server address or update the app.";
  if (status === 413) return "The uploaded file is too large.";
  if (status === 429) return "Too many requests. Please wait and try again.";
  if (status >= 500)
    return "The server could not complete the request. Please try again.";
  return status >= 400
    ? "The request could not be completed (HTTP " + status + ")."
    : "The server returned an unexpected response. Please try again shortly.";
}
export async function parseResponse(response) {
  const raw = await response.text();
  let body,
    valid = false;
  if (!raw.trim() && [204, 205].includes(response.status)) return {};
  try {
    body = JSON.parse(raw);
    valid = body !== null && typeof body === "object";
  } catch {}
  if (!valid)
    throw new ApiError(failureMessage(response.status), {
      status: response.status,
      code: "INVALID_RESPONSE",
      retryable: temporary.has(response.status) || response.ok,
      retryAfter: Number(response.headers.get("retry-after")) || 0,
    });
  if (!response.ok)
    throw new ApiError(
      typeof body.error === "string"
        ? body.error
        : failureMessage(response.status),
      {
        status: response.status,
        code: "HTTP_ERROR",
        retryable: temporary.has(response.status),
        apiResponse: true,
        retryAfter: Number(response.headers.get("retry-after")) || 0,
      },
    );
  return body;
}
export async function requestJson(url, options = {}, config = {}) {
  const method = (options.method || "GET").toUpperCase();
  const canRetry =
    ["GET", "HEAD"].includes(method) ||
    (method === "POST" && new URL(url).pathname.endsWith("/api/logout"));
  const retries = canRetry ? (config.retries ?? 1) : 0;
  const fetchImpl = config.fetchImpl || globalThis.fetch;
  const timeoutMs = config.timeoutMs ?? 30000;
  for (let attempt = 0; ; attempt++) {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const signal = options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal;
      return await parseResponse(await fetchImpl(url, { ...options, signal }));
    } catch (original) {
      const cancelled = options.signal?.aborted;
      const error =
        original instanceof ApiError
          ? original
          : new ApiError(
              cancelled
                ? "The request was cancelled."
                : controller.signal.aborted
                  ? "The server took too long to respond. Please try again."
                  : "Could not connect to the server. Check your connection and try again.",
              {
                code: cancelled
                  ? "CANCELLED"
                  : controller.signal.aborted
                    ? "TIMEOUT"
                    : "NETWORK_ERROR",
                retryable: !cancelled,
              },
            );
      if (!error.retryable || attempt >= retries) throw error;
      const delay =
        config.retryDelayMs ??
        Math.min(1500, error.retryAfter > 0 ? error.retryAfter * 1000 : 350);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    } finally {
      clearTimeout(timer);
    }
  }
}

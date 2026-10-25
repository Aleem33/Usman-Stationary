import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useCallback,
  useEffect,
} from "react";
import { Check, AlertCircle, Info, X } from "lucide-react";
const ToastContext = createContext(null);
export function emitToast(message, type = "success") {
  window.dispatchEvent(
    new CustomEvent("usman-toast", { detail: { message, type } }),
  );
}
export function useToast() {
  return useContext(ToastContext);
}
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]),
    counter = useRef(0),
    timers = useRef(new Map());
  const dismiss = useCallback((id) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);
  const notify = useCallback(
    (message, type = "success") => {
      if (!message) return;
      const id = ++counter.current,
        kind = ["success", "error", "warning", "info"].includes(type)
          ? type
          : "info";
      setToasts((list) =>
        [
          ...list.filter(
            (t) => t.message !== String(message) || t.type !== kind,
          ),
          { id, message: String(message), type: kind },
        ].slice(-4),
      );
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), kind === "error" ? 9000 : 6000),
      );
    },
    [dismiss],
  );
  useEffect(() => {
    const listener = (e) => notify(e.detail?.message, e.detail?.type);
    let lastInvalid = 0;
    const invalid = (e) => {
      e.preventDefault();
      if (Date.now() - lastInvalid < 100) return;
      lastInvalid = Date.now();
      const field = e.target
        .closest("label")
        ?.querySelector("span")?.textContent;
      notify(
        (field ? field + ": " : "") +
          (e.target.validationMessage || "Check the required fields"),
        "error",
      );
      e.target.focus();
    };
    window.addEventListener("usman-toast", listener);
    document.addEventListener("invalid", invalid, true);
    return () => {
      window.removeEventListener("usman-toast", listener);
      document.removeEventListener("invalid", invalid, true);
      for (const timer of timers.current.values()) clearTimeout(timer);
    };
  }, [notify]);
  return (
    <ToastContext.Provider value={notify}>
      {children}
      <div className="toast-stack" aria-label="Notifications">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={"toast toast-" + t.type}
            role={t.type === "error" ? "alert" : "status"}
            aria-live={t.type === "error" ? "assertive" : "polite"}
          >
            <span className="toast-icon">
              {t.type === "success" ? (
                <Check size={19} />
              ) : t.type === "info" ? (
                <Info size={19} />
              ) : (
                <AlertCircle size={19} />
              )}
            </span>
            <span className="toast-message">{t.message}</span>
            <button
              type="button"
              className="toast-close"
              aria-label="Dismiss notification"
              onClick={() => dismiss(t.id)}
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

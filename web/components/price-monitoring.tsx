"use client";
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { Bell, Trash2 } from "lucide-react";

type Alert = {
  id: string;
  productId: string;
  productName: string;
  targetPrice: number;
  currency: string;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastPrice: number | null;
  lastError: string | null;
};
type Notification = {
  id: string;
  productId: string;
  productName: string;
  price: number;
  currency: string;
  targetPrice: number;
  createdAt: string;
  readAt: string | null;
};
export type PriceMonitoringHandle = { refresh: () => void };
function money(amount: number, currency: string) {
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(
    amount,
  );
}
export const PriceMonitoring = forwardRef<
  PriceMonitoringHandle,
  {
    authenticated: boolean;
    onProduct: (id: string) => void;
    onSignIn: () => void;
  }
>(function PriceMonitoring({ authenticated, onProduct, onSignIn }, ref) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [editing, setEditing] = useState("");
  const [target, setTarget] = useState("");
  const [history, setHistory] = useState<{
    alertId: string;
    observations: { price: number; currency: string; checkedAt: string }[];
  } | null>(null);
  const load = useCallback(async () => {
    if (!authenticated) {
      setAlerts([]);
      setNotifications([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const responses = await Promise.all([
        fetch("/api/alerts", { cache: "no-store" }),
        fetch("/api/notifications", { cache: "no-store" }),
      ]);
      const [alertData, notificationData] = (await Promise.all(
        responses.map((response) => response.json()),
      )) as [
        { error?: string; alerts?: Alert[]; monitoringAvailable?: boolean },
        { error?: string; notifications?: Notification[] },
      ];
      if (!responses[0].ok)
        throw new Error(alertData.error || "Price monitoring is unavailable.");
      setAlerts(alertData.alerts || []);
      setAvailable(alertData.monitoringAvailable === true);
      if (!responses[1].ok)
        throw new Error(
          notificationData.error || "Notifications could not be loaded.",
        );
      setNotifications(notificationData.notifications || []);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Price monitoring is unavailable.",
      );
    } finally {
      setLoading(false);
    }
  }, [authenticated]);
  useEffect(() => {
    void load();
  }, [load]);
  useImperativeHandle(
    ref,
    () => ({
      refresh: () => {
        void load();
      },
    }),
    [load],
  );
  async function mutate(
    path: string,
    method: string,
    body: object,
    id: string,
  ) {
    setBusy(id);
    setError("");
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json()) as {
        error?: string;
        observations?: { price: number; currency: string; checkedAt: string }[];
      };
      if (!response.ok)
        throw new Error(data.error || "Your change could not be saved.");
      setEditing("");
      setHistory(null);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Your change could not be saved.",
      );
    } finally {
      setBusy("");
    }
  }
  async function showHistory(id: string) {
    if (history?.alertId === id) {
      setHistory(null);
      return;
    }
    setBusy(id);
    setError("");
    try {
      const response = await fetch(
        `/api/alerts?history=${encodeURIComponent(id)}`,
        { cache: "no-store" },
      );
      const data = (await response.json()) as {
        error?: string;
        observations?: { price: number; currency: string; checkedAt: string }[];
      };
      if (!response.ok)
        throw new Error(data.error || "Price history is unavailable.");
      setHistory({ alertId: id, observations: data.observations || [] });
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Price history is unavailable.",
      );
    } finally {
      setBusy("");
    }
  }
  return (
    <section
      className="monitoring-section"
      aria-labelledby="monitoring-heading"
    >
      <div className="section-heading">
        <div>
          <h2 id="monitoring-heading">Your price alerts</h2>
          <p>Retailer observations and notifications, saved to your account.</p>
        </div>
        {authenticated && (
          <button className="text-button" disabled={loading} onClick={load}>
            {loading ? "Refreshing…" : "Refresh alerts"}
          </button>
        )}
      </div>
      {!authenticated ? (
        <p className="data-note">
          Sign in to monitor eligible retailer products.{" "}
          <button className="text-button" onClick={onSignIn}>
            Sign in
          </button>
        </p>
      ) : (
        <>
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}
          {loading && <p role="status">Loading price alerts…</p>}
          {!loading && !error && !available && (
            <p className="data-note">
              Monitoring is not configured on this installation. Saved targets
              below remain available.
            </p>
          )}
          {!loading && !error && available && !alerts.length && (
            <p className="data-note">
              Open a retailer product and set a target to create your first
              alert. Sample products cannot be monitored.
            </p>
          )}
          {!!notifications.length && (
            <div className="price-notifications">
              <h3>Recent notifications</h3>
              {notifications.map((notification) => (
                <div className="price-notification" key={notification.id}>
                  <Bell size={18} aria-hidden="true" />
                  <div>
                    <button
                      className="product-name"
                      onClick={() => onProduct(notification.productId)}
                    >
                      {notification.productName}
                    </button>
                    <p>
                      Observed at{" "}
                      {money(notification.price, notification.currency)} ·
                      target{" "}
                      {money(notification.targetPrice, notification.currency)}
                    </p>
                    <small>
                      {new Date(notification.createdAt).toLocaleString()} ·
                      Confirm the current retailer price before buying.
                    </small>
                  </div>
                  {!notification.readAt && (
                    <button
                      className="text-button"
                      disabled={busy === notification.id}
                      onClick={() =>
                        mutate(
                          "/api/notifications",
                          "PATCH",
                          { id: notification.id, read: true },
                          notification.id,
                        )
                      }
                    >
                      Mark read
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {alerts.map((alert) => (
            <div className="monitoring-item" key={alert.id}>
              <div className="monitoring-row">
                <div>
                  <button
                    className="product-name"
                    onClick={() => onProduct(alert.productId)}
                  >
                    {alert.productName}
                  </button>
                  <p>
                    Target {money(alert.targetPrice, alert.currency)}
                    {alert.lastPrice !== null
                      ? ` · Last observed ${money(alert.lastPrice, alert.currency)}`
                      : " · Awaiting first check"}
                  </p>
                  <small>
                    {alert.lastCheckedAt
                      ? `Checked ${new Date(alert.lastCheckedAt).toLocaleString()}`
                      : "No price observation yet"}
                  </small>
                  {alert.lastError && (
                    <p className="form-error">{alert.lastError}</p>
                  )}
                </div>
                <span className="status-pill">
                  {alert.enabled ? "Monitoring enabled" : "Paused"}
                </span>
                <div className="monitoring-actions">
                  <button
                    className="text-button"
                    disabled={busy === alert.id}
                    onClick={() =>
                      mutate(
                        "/api/alerts",
                        "PATCH",
                        { id: alert.id, enabled: !alert.enabled },
                        alert.id,
                      )
                    }
                  >
                    {alert.enabled ? "Pause" : "Resume"}
                  </button>
                  <button
                    className="text-button"
                    onClick={() => {
                      setEditing(alert.id);
                      setTarget(String(alert.targetPrice));
                    }}
                  >
                    Edit target
                  </button>
                  <button
                    className="text-button"
                    disabled={busy === alert.id}
                    onClick={() => showHistory(alert.id)}
                  >
                    Price history
                  </button>
                  <button
                    className="icon-button"
                    aria-label={`Delete alert for ${alert.productName}`}
                    disabled={busy === alert.id}
                    onClick={() =>
                      mutate(
                        "/api/alerts",
                        "DELETE",
                        { id: alert.id },
                        alert.id,
                      )
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </div>
              {editing === alert.id && (
                <form
                  className="target-edit"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void mutate(
                      "/api/alerts",
                      "PATCH",
                      { id: alert.id, targetPrice: Number(target) },
                      alert.id,
                    );
                  }}
                >
                  <label className="setting-field">
                    New target ({alert.currency})
                    <input
                      type="number"
                      min="0.01"
                      max="100000"
                      step="0.01"
                      required
                      value={target}
                      onChange={(event) => setTarget(event.target.value)}
                    />
                  </label>
                  <button
                    className="secondary-button"
                    disabled={busy === alert.id}
                  >
                    Save target
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setEditing("")}
                  >
                    Cancel
                  </button>
                </form>
              )}
              {history?.alertId === alert.id && (
                <div className="observation-history">
                  {history.observations.length ? (
                    <table>
                      <caption>Recorded retailer prices</caption>
                      <thead>
                        <tr>
                          <th scope="col">Checked</th>
                          <th scope="col">Price</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.observations.map((observation, index) => (
                          <tr key={`${observation.checkedAt}-${index}`}>
                            <td>
                              {new Date(observation.checkedAt).toLocaleString()}
                            </td>
                            <td>
                              {money(observation.price, observation.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p>
                      No recorded prices yet. History begins with the first
                      successful scheduled check.
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
          {available && (
            <p className="data-note">
              Checks run on the configured schedule. Delivery is in-app only; no
              notification emails are sent. Prices can change between checks.
            </p>
          )}
        </>
      )}
    </section>
  );
});

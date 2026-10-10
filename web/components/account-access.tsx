"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";

type Session = {
  authAvailable: boolean;
  user: {
    id: string;
    email?: string;
    displayName: string;
    provider?: string;
  } | null;
};
export function AccountAccess({ onChange }: { onChange: () => void }) {
  const [session, setSession] = useState<Session | null>(null);
  const [mode, setMode] = useState<"signin" | "signup" | "recover">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  async function load() {
    try {
      const response = await fetch("/api/auth/session", { cache: "no-store" });
      if (!response.ok) throw new Error("Account service unavailable");
      setSession((await response.json()) as Session);
    } catch {
      setSession({ authAvailable: false, user: null });
    }
  }
  useEffect(() => {
    void load();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    setFailed(false);
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          ...(mode !== "recover" ? { password } : {}),
          ...(mode === "signup" && name ? { displayName: name } : {}),
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        confirmationRequired?: boolean;
      };
      if (!response.ok)
        throw new Error(data.error || "Unable to complete that request.");
      setPassword("");
      setMessage(
        data.message ||
          (data.confirmationRequired
            ? "Check your email to confirm your account."
            : mode === "recover"
              ? "If this address has an account, a recovery email is on its way."
              : "You’re signed in. You can sync your workspace in Settings."),
      );
      await load();
      onChange();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Account service unavailable.",
      );
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/signout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error("Unable to sign out. Try again.");
      await load();
      onChange();
      setMessage("Signed out. Saved finds in this browser are still here.");
    } catch (error) {
      setFailed(true);
      setMessage(
        error instanceof Error ? error.message : "Unable to sign out.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!session) return <p role="status">Checking account availability…</p>;
  if (!session.authAvailable)
    return (
      <p className="data-note">
        Email accounts aren’t enabled on this installation. You can keep
        shopping and saving in this browser.
      </p>
    );
  return (
    <div className="account-access">
      {session.user ? (
        <div className="setting-line">
          <div>
            <strong>{session.user.displayName}</strong>
            <p>{session.user.email}</p>
          </div>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={signOut}
          >
            Sign out
          </button>
        </div>
      ) : (
        <>
          <div className="auth-options" aria-label="Account options">
            <button
              className={mode === "signin" ? "selected" : ""}
              aria-pressed={mode === "signin"}
              onClick={() => {
                setMode("signin");
                setMessage("");
              }}
            >
              Sign in
            </button>
            <button
              className={mode === "signup" ? "selected" : ""}
              aria-pressed={mode === "signup"}
              onClick={() => {
                setMode("signup");
                setMessage("");
              }}
            >
              Create account
            </button>
          </div>
          <form onSubmit={submit} className="auth-form">
            {mode === "recover" && (
              <p>We’ll email you a link to reset your password.</p>
            )}
            {mode === "signup" && (
              <label className="setting-field">
                Your name
                <input
                  autoComplete="name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={80}
                />
              </label>
            )}
            <label className="setting-field">
              Email
              <input
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {mode !== "recover" && (
              <label className="setting-field">
                Password
                <input
                  type="password"
                  autoComplete={
                    mode === "signin" ? "current-password" : "new-password"
                  }
                  required
                  minLength={mode === "signup" ? 12 : 1}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                {mode === "signup" && (
                  <small>Use at least 12 characters.</small>
                )}
              </label>
            )}
            <button className="primary-button" disabled={busy} type="submit">
              {busy
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : mode === "signup"
                    ? "Create account"
                    : "Send recovery link"}
            </button>
            {mode === "signin" && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setMode("recover");
                  setMessage("");
                }}
              >
                Forgot your password?
              </button>
            )}
          </form>
        </>
      )}
      {message && (
        <p
          className={failed ? "form-error" : "data-note"}
          role={failed ? "alert" : "status"}
        >
          {message}
        </p>
      )}
    </div>
  );
}

export function AuthConfirmation() {
  const [status, setStatus] = useState("Confirm this email link to continue.");
  const [verified, setVerified] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const initialized = useRef(false);
  const [link, setLink] = useState<{ tokenHash: string; type: string } | null>(
    null,
  );
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const url = new URL(window.location.href);
    const tokenHash = url.searchParams.get("token_hash");
    const type = url.searchParams.get("type") || "signup";
    // Clear the sensitive one-time token from browser history immediately.
    window.history.replaceState(null, "", "/auth/confirm");
    if (tokenHash && ["signup", "email", "recovery"].includes(type)) {
      setLink({ tokenHash, type });
      setRecovery(type === "recovery");
    } else
      setStatus(
        "This confirmation link is missing or invalid. Request another email from your account settings.",
      );
  }, []);
  async function verify() {
    if (!link) return;
    setBusy(true);
    try {
      const response = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(link),
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        confirmationRequired?: boolean;
      };
      if (!response.ok)
        throw new Error(
          data.error || "This link has expired. Request a new one.",
        );
      setLink(null);
      setVerified(true);
      setStatus(
        recovery
          ? "Choose a new password."
          : "Your email is confirmed. You’re signed in.",
      );
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to confirm this link.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function updatePassword(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json()) as {
        error?: string;
        message?: string;
        confirmationRequired?: boolean;
      };
      if (!response.ok)
        throw new Error(data.error || "Unable to update password.");
      setPassword("");
      setRecovery(false);
      setStatus("Password updated. You can return to your shopping workspace.");
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Unable to update password.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-confirmation">
      <a className="logo" href="/">
        velora.
      </a>
      <h1>{recovery ? "Reset your password" : "Confirm your account"}</h1>
      <p role="status">{status}</p>
      {link && (
        <button className="primary-button" disabled={busy} onClick={verify}>
          {busy ? "Confirming…" : "Confirm email link"}
        </button>
      )}
      {verified && recovery && (
        <form className="auth-form" onSubmit={updatePassword}>
          <label className="setting-field">
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? "Updating…" : "Update password"}
          </button>
        </form>
      )}
      <a className="text-button" href="/settings">
        Return to Velora
      </a>
    </main>
  );
}

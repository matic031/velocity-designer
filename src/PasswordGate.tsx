import React, { useEffect, useState } from "react";

/**
 * Lightweight client-side password gate.
 *
 * IMPORTANT — this is NOT real security. GitHub Pages is static hosting, so
 * there is no server to check a password against. This gate only keeps casual
 * visitors who have the link but not the password from using the deployed
 * site. The repo is public, so anyone who finds the source can read it and run
 * the tool locally regardless. For a "share with a friend" link this is the
 * right level of friction; do not put anything sensitive behind it.
 *
 * We store the SHA-256 hash of the password rather than the plaintext so the
 * literal string never appears in the shipped bundle. A correct unlock is
 * remembered in sessionStorage for the tab session.
 */

// SHA-256 of the shared password.
const PASSWORD_HASH =
  "44f95944bd23ebbc715ddc455240f755037c13b4b1ffc789ebb24537792fe9a2";
const UNLOCK_KEY = "velocity-designer.unlocked.v1";

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function PasswordGate({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [unlocked, setUnlocked] = useState<boolean>(false);
  const [ready, setReady] = useState<boolean>(false);
  const [value, setValue] = useState<string>("");
  const [error, setError] = useState<boolean>(false);
  const [checking, setChecking] = useState<boolean>(false);

  useEffect(() => {
    setUnlocked(sessionStorage.getItem(UNLOCK_KEY) === "1");
    setReady(true);
  }, []);

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setChecking(true);
    setError(false);
    const hash = await sha256Hex(value);
    if (hash === PASSWORD_HASH) {
      sessionStorage.setItem(UNLOCK_KEY, "1");
      setUnlocked(true);
    } else {
      setError(true);
      setValue("");
    }
    setChecking(false);
  }

  // Avoid a flash of the gate before sessionStorage is read.
  if (!ready) return <></>;
  if (unlocked) return <>{children}</>;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#000000",
        fontFamily:
          "Geist, ui-sans-serif, system-ui, -apple-system, sans-serif",
        padding: 24,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "100%",
          maxWidth: 360,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span
            style={{
              color: "#2F7BFF",
              fontWeight: 600,
              fontSize: 13,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Velocity
          </span>
          <h1 style={{ color: "#ffffff", fontSize: 22, fontWeight: 600, margin: 0 }}>
            Social Studio
          </h1>
          <p style={{ color: "#8b8b8b", fontSize: 14, margin: 0 }}>
            Enter the password to continue.
          </p>
        </div>

        <input
          type="password"
          autoFocus
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(false);
          }}
          placeholder="Password"
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "12px 14px",
            borderRadius: 10,
            border: `1px solid ${error ? "#FF4D6A" : "#262626"}`,
            background: "#0a0a0a",
            color: "#ffffff",
            fontSize: 15,
            outline: "none",
          }}
        />

        {error && (
          <span style={{ color: "#FF4D6A", fontSize: 13 }}>
            Incorrect password.
          </span>
        )}

        <button
          type="submit"
          disabled={checking || value.length === 0}
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: 10,
            border: "none",
            background: "#ffffff",
            color: "#000000",
            fontSize: 15,
            fontWeight: 600,
            cursor: checking || value.length === 0 ? "default" : "pointer",
            opacity: checking || value.length === 0 ? 0.6 : 1,
          }}
        >
          {checking ? "Checking..." : "Unlock"}
        </button>
      </form>
    </div>
  );
}

"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { authClient } from "@/app/lib/auth-client";

export default function LoginForm({ initialMode }: { initialMode: "signin" | "signup" }) {
  const [mode, setMode] = useState(initialMode);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") || "").trim();
    const password = String(form.get("password") || "");
    const name = String(form.get("name") || "").trim();
    const result = mode === "signup"
      ? await authClient.signUp.email({ name, email, password })
      : await authClient.signIn.email({ email, password });
    if (result.error) {
      setError(result.error.message || "We could not complete that request.");
      setBusy(false);
      return;
    }
    await fetch("/api/account");
    window.location.assign("/app");
  }

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <Link href="/" className="brand-lockup light-brand"><span>S</span>SCRAPPIFY</Link>
        <div>
          <span className="eyebrow">YOUR COMMERCE CONTROL ROOM</span>
          <h1>Collect. Refine.<br /><em>Publish.</em></h1>
          <p>Real catalog data, multilingual SEO enrichment, and Shopify publishing in one professional workspace.</p>
        </div>
        <small>Secure accounts · Isolated workspaces · Persistent catalogs</small>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="auth-mobile-brand"><Link href="/" className="brand-lockup"><span>S</span>SCRAPPIFY</Link></div>
          <span className="eyebrow">{mode === "signup" ? "CREATE YOUR ACCOUNT" : "WELCOME BACK"}</span>
          <h2>{mode === "signup" ? "Start a workspace." : "Sign in to Scrappify."}</h2>
          <p>{mode === "signup" ? "Your first organization and workspace will be prepared automatically." : "Continue to your catalog operations."}</p>
          <div className="auth-tabs">
            <button className={mode === "signin" ? "active" : ""} onClick={() => { setMode("signin"); setError(""); }}>Sign in</button>
            <button className={mode === "signup" ? "active" : ""} onClick={() => { setMode("signup"); setError(""); }}>Create account</button>
          </div>
          <form onSubmit={submit}>
            {mode === "signup" && <label>Full name<input name="name" autoComplete="name" required placeholder="Your name" /></label>}
            <label>Email address<input name="email" type="email" autoComplete="email" required placeholder="you@company.com" /></label>
            <label>Password<input name="password" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={10} placeholder="At least 10 characters" /></label>
            {error && <div className="auth-error">{error}</div>}
            <button className="landing-button auth-submit" disabled={busy}>
              {busy ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"} <span>→</span>
            </button>
          </form>
          <small className="auth-note">By continuing, you agree to keep source collection compliant with the websites and data you are authorized to process.</small>
        </div>
      </section>
    </main>
  );
}

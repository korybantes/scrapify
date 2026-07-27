"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  Sparkles,
  UserRound,
} from "lucide-react";
import { authClient } from "@/app/lib/auth-client";

function AuthLogo({ light = false }: { light?: boolean }) {
  return (
    <span className={`auth-logo ${light ? "light" : ""}`}>
      <span className="auth-logo-mark" aria-hidden="true"><i /><i /><i /></span>
      <strong>SCRAPPIFY</strong>
    </span>
  );
}

export default function LoginForm({ initialMode }: { initialMode: "signin" | "signup" }) {
  const [mode, setMode] = useState(initialMode);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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

  const switchMode = (nextMode: "signin" | "signup") => {
    setMode(nextMode);
    setError("");
  };

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <div className="auth-brand-top">
          <Link href="/" aria-label="Scrappify home"><AuthLogo light /></Link>
          <Link href="/" className="auth-back"><ArrowLeft size={14} /> Back to website</Link>
        </div>

        <div className="auth-brand-content">
          <span className="auth-brand-kicker"><Sparkles size={13} /> COMMERCE OPERATIONS, SIMPLIFIED</span>
          <h1>From source URL<br />to <em>sell-ready.</em></h1>
          <p>Collect real products, refine the catalog with ScrapifyAI, and publish confidently to Shopify from one focused workspace.</p>

          <div className="auth-flow-card" aria-label="Scrappify workflow">
            <span><i>01</i><strong>Collect</strong><small>Live source data</small></span>
            <ArrowRight size={15} />
            <span><i>02</i><strong>Refine</strong><small>ScrapifyAI copy</small></span>
            <ArrowRight size={15} />
            <span><i>03</i><strong>Publish</strong><small>Shopify-ready</small></span>
          </div>
        </div>

        <div className="auth-brand-footer">
          <span><ShieldCheck size={15} /> Secure accounts · isolated workspaces</span>
          <span><i /> All systems operational</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-mobile-head">
          <Link href="/"><AuthLogo /></Link>
          <Link href="/"><ArrowLeft size={14} /> Home</Link>
        </div>

        <div className="auth-card-shell">
          <div className="auth-secure-chip"><LockKeyhole size={13} /> Secure workspace access</div>
          <span className="eyebrow">{mode === "signup" ? "GET STARTED" : "WELCOME BACK"}</span>
          <h2>{mode === "signup" ? "Create your account" : "Sign in to your workspace"}</h2>
          <p>{mode === "signup"
            ? "Create your organization and first catalog workspace in one step."
            : "Continue managing your catalogs, enrichment runs, and Shopify exports."}</p>

          <div className="auth-tabs" role="tablist" aria-label="Authentication mode">
            <button type="button" role="tab" aria-selected={mode === "signin"} className={mode === "signin" ? "active" : ""} onClick={() => switchMode("signin")}>Sign in</button>
            <button type="button" role="tab" aria-selected={mode === "signup"} className={mode === "signup" ? "active" : ""} onClick={() => switchMode("signup")}>Create account</button>
          </div>

          <form onSubmit={submit}>
            {mode === "signup" && (
              <label>
                Full name
                <span className="auth-input">
                  <UserRound size={16} />
                  <input name="name" autoComplete="name" required placeholder="Your full name" />
                </span>
              </label>
            )}
            <label>
              Work email
              <span className="auth-input">
                <Mail size={16} />
                <input name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
              </span>
            </label>
            <label>
              <span className="auth-label-row"><span>Password</span>{mode === "signin" && <small>Minimum 10 characters</small>}</span>
              <span className="auth-input">
                <LockKeyhole size={16} />
                <input name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={10} placeholder="Enter your password" />
                <button type="button" aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((current) => !current)}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>

            {mode === "signup" && (
              <div className="auth-password-note">
                <Check size={12} /> Use at least 10 characters for a secure account
              </div>
            )}
            {error && <div className="auth-error" role="alert">{error}</div>}
            <button className="auth-submit" disabled={busy}>
              <span>{busy ? "Securing your workspace…" : mode === "signup" ? "Create my workspace" : "Continue to dashboard"}</span>
              {busy ? <i className="auth-spinner" /> : <ArrowRight size={17} />}
            </button>
          </form>

          <div className="auth-trust-row">
            <span><ShieldCheck size={14} /> Encrypted session</span>
            <span><Check size={14} /> Isolated workspace data</span>
          </div>
          <small className="auth-note">By continuing, you agree to process only websites and catalog data you are authorized to access.</small>
        </div>
      </section>
    </main>
  );
}

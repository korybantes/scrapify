"use client";

import Link from "next/link";
import { ArrowRight, Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

export function LandingMobileMenu() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className={`landing-mobile-menu ${open ? "open" : ""}`}>
      <button className="landing-menu-toggle" type="button" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        {open ? <X size={21} /> : <Menu size={21} />}
      </button>
      {open && <button className="landing-menu-backdrop" type="button" aria-label="Close navigation" onClick={close} />}
      <div className="landing-menu-panel">
        <span className="section-label">EXPLORE SCRAPPIFY</span>
        <a href="#platform" onClick={close}>Platform</a>
        <a href="#workflow" onClick={close}>How it works</a>
        <a href="#teams" onClick={close}>For teams</a>
        <div className="landing-menu-actions">
          <Link href="/login" onClick={close}>Sign in</Link>
          <Link href="/login?mode=signup" className="button button-lime" onClick={close}>Start free <ArrowRight size={16} /></Link>
        </div>
      </div>
    </div>
  );
}

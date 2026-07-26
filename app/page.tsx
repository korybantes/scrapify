import Link from "next/link";

const features = [
  {
    icon: "↗",
    title: "Collect real catalog data",
    text: "Run browser-based collection jobs from approved commerce sources and keep every product traceable to its original URL.",
  },
  {
    icon: "✦",
    title: "Write SEO copy in your language",
    text: "Generate factual Shopify-ready descriptions in Turkish, English, German, French, Spanish, Polish, Arabic, or Italian.",
  },
  {
    icon: "⌁",
    title: "Publish with control",
    text: "Review pricing, inventory, images, descriptions, and warnings before exporting CSV or syncing through Shopify Admin API.",
  },
];

export default function LandingPage() {
  return (
    <main className="landing">
      <nav className="landing-nav">
        <Link href="/" className="brand-lockup"><span>S</span>SCRAPPIFY</Link>
        <div className="landing-links">
          <a href="#product">Product</a>
          <a href="#workflow">Workflow</a>
          <a href="#teams">For teams</a>
        </div>
        <div className="landing-actions">
          <Link href="/login">Sign in</Link>
          <Link href="/login?mode=signup" className="landing-button small">Create account</Link>
        </div>
      </nav>

      <section className="hero" id="product">
        <div className="hero-copy">
          <div className="eyebrow"><i /> COMMERCE OPERATIONS, REFINED</div>
          <h1>Your product catalog,<br /><em>ready for Shopify.</em></h1>
          <p>
            Scrappify turns live storefront sources into a clean, reviewable catalog—then
            enriches it with multilingual AI copy and sends it to Shopify.
          </p>
          <div className="hero-actions">
            <Link href="/login?mode=signup" className="landing-button">Start your workspace <span>→</span></Link>
            <a href="#workflow" className="text-button">See how it works</a>
          </div>
          <div className="trust-row">
            <span><b>✓</b> No demo catalog</span>
            <span><b>✓</b> Workspace isolation</span>
            <span><b>✓</b> Draft-first publishing</span>
          </div>
        </div>
        <div className="hero-visual" aria-label="Scrappify product pipeline preview">
          <div className="visual-top"><span>Production workspace</span><i>Live</i></div>
          <div className="visual-flow">
            <div><small>SOURCE</small><strong>Saved collection</strong><span>Reusable settings</span></div>
            <b>→</b>
            <div className="active"><small>COLLECT</small><strong>Browser worker</strong><span>Real product pages</span></div>
            <b>→</b>
            <div><small>ENRICH</small><strong>SEO language</strong><span>Choose per run</span></div>
          </div>
          <div className="visual-table">
            <div className="visual-heading"><span>Catalog review</span><small>Workspace data only</small></div>
            {[["Product identity", "Source linked", "Ready"], ["Price & inventory", "Validated", "Review"], ["SEO description", "English", "Ready"]].map((row) => (
              <div className="visual-row" key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><i>{row[2]}</i></div>
            ))}
          </div>
        </div>
      </section>

      <section className="logo-strip">
        <span>BUILT FOR</span>
        <strong>MERCHANTS</strong><strong>CATALOG TEAMS</strong><strong>AGENCIES</strong><strong>MARKETPLACES</strong>
      </section>

      <section className="feature-section" id="workflow">
        <div className="section-heading">
          <span>ONE CONTROL ROOM</span>
          <h2>From source to storefront,<br />without the spreadsheet maze.</h2>
        </div>
        <div className="feature-grid">
          {features.map((feature, index) => (
            <article key={feature.title}>
              <div className="feature-number">0{index + 1}</div>
              <span className="feature-icon">{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="workspace-story" id="teams">
        <div>
          <span className="eyebrow">DESIGNED FOR MORE THAN ONE CATALOG</span>
          <h2>Organizations for your business.<br />Workspaces for every operation.</h2>
          <p>
            Keep clients, brands, or regions separated. Each workspace owns its saved
            sources, scrape history, product catalog, AI language choices, and exports.
          </p>
        </div>
        <div className="workspace-stack">
          <article><span>ORGANIZATION</span><strong>Northstar Commerce</strong><small>One account, multiple operations</small></article>
          <article><span>WORKSPACE</span><strong>European Catalog</strong><small>Independent products and sources</small></article>
          <article><span>WORKSPACE</span><strong>Client Store</strong><small>Independent products and sources</small></article>
        </div>
      </section>

      <section className="landing-cta">
        <div><span>READY WHEN YOU ARE</span><h2>Build a catalog operation<br />you can actually scale.</h2></div>
        <Link href="/login?mode=signup" className="landing-button light">Create your account <span>→</span></Link>
      </section>

      <footer className="landing-footer">
        <Link href="/" className="brand-lockup"><span>S</span>SCRAPPIFY</Link>
        <p>Product collection and catalog operations for Shopify teams.</p>
        <Link href="/login">Sign in</Link>
      </footer>
    </main>
  );
}

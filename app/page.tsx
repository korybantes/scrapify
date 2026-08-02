import Link from "next/link";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  Globe2,
  Languages,
  Layers3,
  PackageCheck,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  WandSparkles,
} from "lucide-react";
import { LandingMobileMenu } from "./LandingMobileMenu";

const workflow = [
  {
    icon: Globe2,
    step: "01",
    title: "Save a source",
    text: "Add an approved collection URL once. Keep its page range and language settings ready for every run.",
  },
  {
    icon: Database,
    step: "02",
    title: "Collect real products",
    text: "Your private browser worker collects live titles, images, pricing, variants, and source links.",
  },
  {
    icon: WandSparkles,
    step: "03",
    title: "Refine in bulk",
    text: "Review the catalog, bulk edit product fields, and generate SEO copy in eight languages.",
  },
  {
    icon: Store,
    step: "04",
    title: "Publish with control",
    text: "Export a Shopify CSV or sync selected products to Shopify as drafts when they are ready.",
  },
];

const languages = ["TR", "EN", "DE", "FR", "ES", "PL", "AR", "IT"];

function Brand() {
  return (
    <span className="brand-lockup">
      <span className="brand-symbol" aria-hidden="true"><i /><i /><i /></span>
      <strong>SCRAPPIFY</strong>
    </span>
  );
}

export default function LandingPage() {
  return (
    <main className="landing">
      <nav className="landing-nav">
        <Link href="/" aria-label="Scrappify home"><Brand /></Link>
        <div className="landing-links">
          <a href="#platform">Platform</a>
          <a href="#workflow">How it works</a>
          <a href="#teams">For teams</a>
        </div>
        <div className="landing-actions">
          <Link href="/login" className="nav-signin">Sign in</Link>
          <Link href="/login?mode=signup" className="button button-dark">
            Start free <ArrowRight size={16} />
          </Link>
        </div>
        <LandingMobileMenu />
      </nav>

      <section className="hero" id="platform">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-copy">
          <div className="hero-badge">
            <Sparkles size={14} />
            Catalog operations, reimagined
          </div>
          <h1>
            Turn any approved source into a
            <span> Shopify-ready catalog.</span>
          </h1>
          <p>
            Collect real product data, clean it up in one workspace, generate
            multilingual SEO copy, and publish when you are ready.
          </p>
          <div className="hero-actions">
            <Link href="/login?mode=signup" className="button button-lime">
              Create your workspace <ArrowRight size={17} />
            </Link>
            <a href="#workflow" className="button button-ghost">
              See the workflow
            </a>
          </div>
          <div className="hero-proof">
            <span><CheckCircle2 size={16} /> Real source data</span>
            <span><CheckCircle2 size={16} /> No spreadsheet handoffs</span>
            <span><CheckCircle2 size={16} /> Draft-first Shopify sync</span>
          </div>
        </div>

        <div className="product-stage" aria-label="Scrappify product interface preview">
          <div className="stage-window">
            <div className="stage-topbar">
              <Brand />
              <span className="stage-search"><Search size={14} /> Search catalog</span>
              <span className="stage-avatar">ET</span>
            </div>
            <div className="stage-body">
              <aside className="stage-sidebar">
                <span className="stage-workspace">Main workspace</span>
                {[
                  ["Overview", Layers3],
                  ["Products", PackageCheck],
                  ["AI Studio", Sparkles],
                  ["Sources", Globe2],
                ].map(([label, Icon], index) => {
                  const IconComponent = Icon as typeof Layers3;
                  return (
                    <span className={index === 0 ? "active" : ""} key={String(label)}>
                      <IconComponent size={14} /> {String(label)}
                    </span>
                  );
                })}
              </aside>
              <div className="stage-content">
                <div className="stage-heading">
                  <div><small>GOOD MORNING</small><strong>Your catalog is moving.</strong></div>
                  <button><Plus size={14} /> Add source</button>
                </div>
                <div className="stage-stats">
                  <article><small>PRODUCTS</small><strong>48</strong><span>From your live source</span></article>
                  <article><small>AI READY</small><strong>34</strong><span>Descriptions complete</span></article>
                  <article><small>SHOPIFY</small><strong>12</strong><span>Drafts published</span></article>
                </div>
                <div className="stage-table">
                  <div className="stage-table-head"><strong>Catalog review</strong><span>48 products</span></div>
                  {[
                    ["N", "Noa EDT 30 ml", "Cacharel", "₺2,137", "AI ready"],
                    ["O", "Ombre Leather 100 ml", "Tom Ford", "₺9,812", "AI ready"],
                    ["M", "The Most Wanted", "Azzaro", "₺6,860", "Pending"],
                  ].map((row, index) => (
                    <div className="stage-row" key={row[1]}>
                      <span className={`stage-thumb thumb-${index}`}>{row[0]}</span>
                      <span><strong>{row[1]}</strong><small>{row[2]}</small></span>
                      <b>{row[3]}</b>
                      <i className={row[4] === "AI ready" ? "ready" : ""}>{row[4]}</i>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="source-float">
            <span className="float-icon"><Globe2 size={18} /></span>
            <span><small>SOURCE CONNECTED</small><strong>beymen.com / Parfüm</strong></span>
            <Check size={16} />
          </div>
          <div className="ai-float">
            <div><span><Sparkles size={15} /> AI enrichment</span><b>71%</b></div>
            <div className="float-progress"><i /></div>
            <small>34 of 48 products complete</small>
          </div>
        </div>
      </section>

      <section className="landing-trust">
        <span>BUILT FOR MODERN COMMERCE TEAMS</span>
        <div>
          <strong>MERCHANTS</strong>
          <strong>AGENCIES</strong>
          <strong>CATALOG TEAMS</strong>
          <strong>MARKETPLACES</strong>
        </div>
      </section>

      <section className="platform-section">
        <div className="section-intro">
          <span className="section-label">ONE OPERATING SYSTEM</span>
          <h2>The catalog work that used to live in five tools.</h2>
          <p>Scrappify puts collection, review, AI enrichment, exports, and Shopify publishing into one calm workflow.</p>
        </div>
        <div className="bento-grid">
          <article className="bento-card bento-source">
            <div className="bento-icon"><Globe2 size={22} /></div>
            <span className="section-label">SAVED SOURCES</span>
            <h3>Paste once. Run whenever.</h3>
            <p>Turn collection URLs into reusable recipes with page limits, SEO language, and automation preferences.</p>
            <div className="source-demo">
              <span className="source-demo-logo">B</span>
              <span><strong>Luxury fragrance</strong><small>beymen.com · 1–3 pages</small></span>
              <i>Active</i>
            </div>
          </article>

          <article className="bento-card bento-ai">
            <div className="bento-icon dark"><Languages size={22} /></div>
            <span className="section-label">MULTILINGUAL AI</span>
            <h3>Write for every market.</h3>
            <p>Generate factual, Shopify-safe descriptions and watch every selected product complete in real time.</p>
            <div className="language-cloud">
              {languages.map((language, index) => <span className={index === 1 ? "active" : ""} key={language}>{language}</span>)}
            </div>
          </article>

          <article className="bento-card bento-bulk">
            <div className="bento-icon"><Layers3 size={22} /></div>
            <span className="section-label">BULK OPERATIONS</span>
            <h3>Change fifty products like one.</h3>
            <p>Update vendor, category, inventory, publish status, and tags across the products you select.</p>
            <div className="bulk-demo">
              <span><Check size={14} /> 24 selected</span>
              <button>Edit products</button>
              <button><Sparkles size={13} /> Enrich</button>
            </div>
          </article>

          <article className="bento-card bento-security">
            <div className="bento-icon"><ShieldCheck size={22} /></div>
            <span className="section-label">CONTROL BY DESIGN</span>
            <h3>Your clients never overlap.</h3>
            <p>Organizations and workspaces isolate sources, products, credentials, jobs, and Shopify connections.</p>
            <div className="workspace-mini">
              <span><i>NC</i><b>Northstar Commerce</b><small>Organization</small></span>
              <span><i>EU</i><b>European Catalog</b><small>Workspace</small></span>
            </div>
          </article>
        </div>
      </section>

      <section className="workflow-section" id="workflow">
        <div className="section-intro split">
          <div>
            <span className="section-label">THE WORKFLOW</span>
            <h2>Source to storefront, without the mess.</h2>
          </div>
          <p>Every step is visible, reviewable, and scoped to the workspace you are operating.</p>
        </div>
        <div className="workflow-grid">
          {workflow.map(({ icon: Icon, step, title, text }) => (
            <article key={step}>
              <div className="workflow-top"><span>{step}</span><Icon size={21} /></div>
              <h3>{title}</h3>
              <p>{text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="teams-section" id="teams">
        <div className="teams-copy">
          <span className="section-label light">MADE TO SCALE WITH YOU</span>
          <h2>One account.<br />Every catalog operation.</h2>
          <p>
            Create an organization for your company, then give each client, brand,
            region, or store its own workspace and clean operational boundary.
          </p>
          <ul>
            <li><CheckCircle2 size={17} /> Independent products and source history</li>
            <li><CheckCircle2 size={17} /> Separate Shopify credentials per workspace</li>
            <li><CheckCircle2 size={17} /> Role-aware access for every team</li>
          </ul>
        </div>
        <div className="teams-visual">
          <div className="org-card">
            <span className="org-icon"><Layers3 size={20} /></span>
            <span><small>ORGANIZATION</small><strong>Northstar Commerce</strong></span>
            <i>Owner</i>
          </div>
          <div className="workspace-branch">
            <article><span>EU</span><div><small>WORKSPACE</small><strong>European Catalog</strong><p>1,248 products · 4 sources</p></div></article>
            <article><span>CS</span><div><small>WORKSPACE</small><strong>Client Store</strong><p>384 products · 2 sources</p></div></article>
            <article><span>TR</span><div><small>WORKSPACE</small><strong>Turkey Launch</strong><p>Ready to configure</p></div></article>
          </div>
        </div>
      </section>

      <section className="landing-cta">
        <div className="cta-orb" aria-hidden="true" />
        <span className="section-label light">READY TO OPERATE</span>
        <h2>Your next catalog starts with one source URL.</h2>
        <p>Create a workspace, add a source, and let Scrappify handle the repetitive parts.</p>
        <Link href="/login?mode=signup" className="button button-lime">
          Start your workspace <ArrowRight size={17} />
        </Link>
      </section>

      <footer className="landing-footer">
        <Brand />
        <p>Catalog operations for modern Shopify teams.</p>
        <div><a href="#platform">Platform</a><a href="#workflow">Workflow</a><Link href="/login">Sign in</Link></div>
      </footer>
    </main>
  );
}

"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Product = {
  id: string;
  title: string;
  vendor: string;
  source: string;
  category: string;
  sale_price: string | null;
  compare_at_price: string | null;
  image_url: string;
  body_html: string;
  tags: string[];
  published: boolean;
  inventory_qty: number;
  price_warning: string | null;
  ai_status: "pending" | "enriched" | "failed" | "skipped";
  shopify_status: "not_synced" | "draft" | "active" | "failed";
  updated_at: string;
};

type Job = {
  id: string;
  source: string;
  category_name: string;
  category_url: string;
  start_page: number;
  max_pages: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  pages_completed: number;
  products_found: number;
  warning_count: number;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
};

type DashboardData = {
  summary: {
    total_products: number;
    ai_enriched: number;
    warnings: number;
    shopify_synced: number;
    catalog_value: string;
  };
  jobs: Job[];
  products: Product[];
  events: Array<{ id: number; level: string; event_type: string; message: string; created_at: string }>;
  sources: string[];
  services: { database: boolean; groq: boolean; shopify: boolean };
};

const emptyData: DashboardData = {
  summary: { total_products: 0, ai_enriched: 0, warnings: 0, shopify_synced: 0, catalog_value: "0" },
  jobs: [],
  products: [],
  events: [],
  sources: [],
  services: { database: false, groq: false, shopify: false },
};

const nav = [
  ["Overview", "01"],
  ["Products", "02"],
  ["AI Studio", "03"],
  ["Exports", "04"],
  ["Sources", "05"],
  ["Settings", "06"],
] as const;

const formatTry = (value: string | number | null) =>
  new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: 0,
  }).format(Number(value ?? 0));

const formatDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

export default function Home() {
  const [active, setActive] = useState("Overview");
  const [data, setData] = useState<DashboardData>(emptyData);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [drawer, setDrawer] = useState<Product | null>(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [busyAction, setBusyAction] = useState("");

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (sourceFilter) params.set("source", sourceFilter);
      const response = await fetch(`/api/data?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not load live data");
      setData(payload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load live data");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [query, sourceFilter]);

  useEffect(() => {
    void loadData();
    const interval = window.setInterval(() => void loadData(true), 5000);
    return () => window.clearInterval(interval);
  }, [loadData]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  };

  const visibleProducts = data.products;
  const activeJob = data.jobs.find((job) => job.status === "running" || job.status === "queued");
  const lastJob = activeJob ?? data.jobs[0];
  const aiCoverage = data.summary.total_products
    ? Math.round((data.summary.ai_enriched / data.summary.total_products) * 100)
    : 0;

  const createJob = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyAction("job");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: form.get("source"),
          category_name: form.get("category_name"),
          category_url: form.get("category_url"),
          start_page: Number(form.get("start_page")),
          max_pages: Number(form.get("max_pages")),
          auto_enrich: form.get("auto_enrich") === "on",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not queue scrape");
      setShowNewJob(false);
      notify("Real scrape job queued");
      await loadData(true);
    } catch (jobError) {
      notify(jobError instanceof Error ? jobError.message : "Could not queue scrape");
    } finally {
      setBusyAction("");
    }
  };

  const cancelJob = async (id: string) => {
    setBusyAction("cancel");
    const response = await fetch(`/api/jobs/${id}/cancel`, { method: "POST" });
    const payload = await response.json();
    if (response.ok) notify("Scrape job cancelled");
    else notify(payload.error ?? "Could not cancel job");
    setBusyAction("");
    await loadData(true);
  };

  const runAi = async () => {
    if (!selected.length) return notify("Select at least one real product first");
    setBusyAction("ai");
    try {
      const response = await fetch("/api/ai/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_ids: selected }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "AI enrichment failed");
      notify(`${payload.enriched} products enriched with Groq`);
      await loadData(true);
    } catch (aiError) {
      notify(aiError instanceof Error ? aiError.message : "AI enrichment failed");
    } finally {
      setBusyAction("");
    }
  };

  const syncShopify = async () => {
    if (!selected.length) return notify("Select at least one real product first");
    if (!data.services.shopify) return notify("Shopify Admin API is not configured yet");
    setBusyAction("shopify");
    try {
      const response = await fetch("/api/shopify/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_ids: selected }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Shopify sync failed");
      notify(`${payload.synced.length} products synced to Shopify`);
      await loadData(true);
    } catch (shopifyError) {
      notify(shopifyError instanceof Error ? shopifyError.message : "Shopify sync failed");
    } finally {
      setBusyAction("");
    }
  };

  const saveProduct = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!drawer) return;
    setBusyAction("save");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/products/${drawer.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.get("title"),
        vendor: form.get("vendor"),
        category: form.get("category"),
        sale_price: form.get("sale_price"),
        compare_at_price: form.get("compare_at_price") || null,
        inventory_qty: Number(form.get("inventory_qty")),
        body_html: form.get("body_html"),
        published: form.get("published") === "on",
      }),
    });
    const payload = await response.json();
    if (response.ok) {
      setDrawer(null);
      notify("Product saved to Neon");
      await loadData(true);
    } else {
      notify(payload.error ?? "Could not save product");
    }
    setBusyAction("");
  };

  const downloadCsv = () => {
    if (!data.summary.total_products) return notify("There are no real products to export yet");
    const params = selected.length ? `?ids=${selected.join(",")}` : "";
    window.location.href = `/api/export${params}`;
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><i /><i /><i /></div><span>SCRAPPIFY</span></div>
        <div className="workspace-label">LIVE WORKSPACE</div>
        <div className="workspace-switch static">
          <span className="store-avatar">DB</span>
          <span><strong>Production catalog</strong><small>{data.services.database ? "Neon connected" : "Database unavailable"}</small></span>
          <span className={`live-dot ${data.services.database ? "" : "offline"}`} />
        </div>
        <nav>
          <p>OPERATE</p>
          {nav.map(([item, count], index) => (
            <button key={item} className={active === item ? "active" : ""} onClick={() => setActive(item)}>
              <span className="nav-icon">{count}</span>{item}
              {item === "Products" && <em>{data.summary.total_products.toLocaleString()}</em>}
              {index === 4 && activeJob && <span className="live-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom live-summary">
          <div className="usage-head"><span>Database records</span><strong>{data.summary.total_products.toLocaleString()}</strong></div>
          <div className="usage-track"><i style={{ width: `${Math.min(100, aiCoverage)}%` }} /></div>
          <small>{aiCoverage}% enriched with AI</small>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="crumb"><span>Production</span><b>/</b><strong>{active}</strong></div>
          <div className="top-actions">
            <button className="secondary-button" onClick={() => void loadData()}>↻ Refresh live data</button>
            <button className="primary-button" onClick={() => setShowNewJob(true)}><span>＋</span> New scrape</button>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">LIVE COMMERCE OPERATIONS</div>
              <h1>{active}</h1>
              <p>Every number and product below comes directly from your production database.</p>
            </div>
            <div className={`health-chip ${error ? "health-error" : ""}`}><i />{error || "Live data connected"}</div>
          </div>

          {loading ? (
            <div className="loading-state"><span className="spinner dark" /><p>Loading production data…</p></div>
          ) : active === "Overview" ? (
            <>
              <section className="metrics-grid">
                <Metric label="CATALOG VALUE" value={formatTry(data.summary.catalog_value)} detail="Live price × inventory value" />
                <Metric label="PRODUCTS" value={data.summary.total_products.toLocaleString()} detail={`${data.summary.warnings} price warnings`} />
                <Metric label="AI COVERAGE" value={`${aiCoverage}%`} detail={`${data.summary.ai_enriched.toLocaleString()} enriched products`} />
                <Metric label="SHOPIFY SYNCED" value={data.summary.shopify_synced.toLocaleString()} detail={data.services.shopify ? "Admin API connected" : "Shopify not configured"} />
              </section>

              <section className="workspace-grid">
                <article className="panel activity-panel">
                  <div className="panel-heading"><div><span className="kicker">PIPELINE</span><h2>{activeJob ? "Active scraping" : "Latest scrape"}</h2></div><button onClick={() => setActive("Sources")}>View all jobs</button></div>
                  {lastJob ? (
                    <>
                      <div className="run-card">
                        <div className="source-logo beymen">{lastJob.source.slice(0, 1).toUpperCase()}</div>
                        <div className="run-info"><strong>{lastJob.category_name}</strong><span>{lastJob.source} · {formatDate(lastJob.created_at)}</span></div>
                        <div className="run-count"><strong>{lastJob.products_found}</strong><span> products</span></div>
                        <div className={`run-status ${lastJob.status}`}><i />{lastJob.status}</div>
                      </div>
                      <div className="progress-track"><i style={{ width: `${lastJob.progress}%` }} /></div>
                      <div className="run-meta">
                        <span><b>{lastJob.pages_completed}</b> pages complete</span>
                        <span><b>{lastJob.warning_count}</b> warnings</span>
                        <span><b>{lastJob.progress}%</b> progress</span>
                      </div>
                      {activeJob && <div className="up-next"><div><span>LIVE JOB</span><strong>{activeJob.category_url}</strong><small>Worker updates this record automatically</small></div><button disabled={busyAction === "cancel"} onClick={() => void cancelJob(activeJob.id)}>Cancel</button></div>}
                    </>
                  ) : (
                    <EmptyState title="No scrape jobs yet" detail="Queue your first real source URL to begin collecting products." action="Queue first scrape" onAction={() => setShowNewJob(true)} />
                  )}
                </article>

                <article className="panel ai-panel">
                  <div className="ai-orb"><i /><i /><i /></div>
                  <span className="kicker">GROQ AI</span>
                  <h2>{data.services.groq ? "AI enrichment is ready." : "AI is not configured."}</h2>
                  <p>{data.services.groq ? "Generate factual Turkish Shopify copy from products already stored in Neon." : "Add the Groq secret to enable production enrichment."}</p>
                  <div className="ai-stats"><span><strong>{Math.max(0, data.summary.total_products - data.summary.ai_enriched)}</strong><small>Awaiting AI</small></span><span><strong>{data.summary.ai_enriched}</strong><small>Completed</small></span></div>
                  <button onClick={() => setActive("AI Studio")}>Open AI Studio <span>↗</span></button>
                </article>
              </section>

              <ProductTable products={visibleProducts.slice(0, 8)} selected={selected} setSelected={setSelected} openProduct={setDrawer} runAi={runAi} syncShopify={syncShopify} shopifyReady={data.services.shopify} downloadCsv={downloadCsv} busyAction={busyAction} />
            </>
          ) : active === "Products" ? (
            <ProductWorkspace
              products={visibleProducts}
              sources={data.sources}
              selected={selected}
              setSelected={setSelected}
              query={query}
              setQuery={setQuery}
              sourceFilter={sourceFilter}
              setSourceFilter={setSourceFilter}
              openProduct={setDrawer}
              runAi={runAi}
              syncShopify={syncShopify}
              shopifyReady={data.services.shopify}
              downloadCsv={downloadCsv}
              busyAction={busyAction}
              onNewJob={() => setShowNewJob(true)}
            />
          ) : active === "AI Studio" ? (
            <section className="studio-layout">
              <article className="panel studio-main">
                <span className="kicker">LIVE GROQ ENRICHMENT</span>
                <h2>Enrich only products you select.</h2>
                <p>The model receives the real title, brand, category and price. It cannot see or invent unavailable product details.</p>
                <div className="real-selection"><span>{selected.length}</span><p>products selected from Neon</p></div>
                <div className="studio-options"><label><input type="checkbox" checked readOnly /> Turkish SEO HTML</label><label><input type="checkbox" checked readOnly /> Source-name removal</label><label><input type="checkbox" checked readOnly /> Safe tag suggestions</label><label><input type="checkbox" checked readOnly /> Factual-only prompt</label></div>
                <button className="primary-button wide" disabled={!selected.length || busyAction === "ai" || !data.services.groq} onClick={() => void runAi()}>
                  {busyAction === "ai" ? "Enriching real products…" : `✦ Enrich ${selected.length} selected products`}
                </button>
              </article>
              <article className="panel live-queue-panel">
                <span className="kicker">ENRICHMENT QUEUE</span>
                <h2>Products awaiting AI</h2>
                <div className="mini-product-list">
                  {data.products.filter((product) => product.ai_status !== "enriched").slice(0, 8).map((product) => (
                    <button key={product.id} onClick={() => setSelected((current) => current.includes(product.id) ? current : [...current, product.id])}>
                      <ProductThumb product={product} /><span><strong>{product.title}</strong><small>{product.vendor || "Unknown vendor"} · {product.ai_status}</small></span><b>＋</b>
                    </button>
                  ))}
                  {!data.products.some((product) => product.ai_status !== "enriched") && <EmptyState title="No pending products" detail="Scrape real products first, or all current products are already enriched." />}
                </div>
              </article>
            </section>
          ) : active === "Exports" ? (
            <section className="panel export-page">
              <div className="export-art"><span>CSV</span></div>
              <span className="kicker">LIVE SHOPIFY EXPORT</span>
              <h2>Export your Neon catalog.</h2>
              <p>The download is generated at request time from current products—titles, prices, inventory, images and AI descriptions included.</p>
              <div className="export-summary"><span><small>Products</small><strong>{selected.length || data.summary.total_products}</strong></span><span><small>Warnings</small><strong>{data.summary.warnings}</strong></span><span><small>AI ready</small><strong>{data.summary.ai_enriched}</strong></span></div>
              <button className="primary-button wide" disabled={!data.summary.total_products} onClick={downloadCsv}>↓ Download live Shopify CSV</button>
            </section>
          ) : active === "Sources" ? (
            <section className="sources-page">
              <article className="panel source-intro"><div><span className="kicker">POSTGRES JOB QUEUE</span><h2>Scrape jobs</h2><p>Jobs are claimed by the Python Playwright worker and updated here in real time.</p></div><button className="primary-button" onClick={() => setShowNewJob(true)}>＋ Queue scrape</button></article>
              <div className="jobs-list">
                {data.jobs.map((job) => <JobCard key={job.id} job={job} onCancel={cancelJob} />)}
                {!data.jobs.length && <article className="panel"><EmptyState title="No real jobs yet" detail="Queue a Beymen or Zaptila category URL. No sample jobs will be inserted." action="Queue first scrape" onAction={() => setShowNewJob(true)} /></article>}
              </div>
            </section>
          ) : (
            <section className="settings-grid">
              <ServiceCard name="Neon PostgreSQL" configured={data.services.database} detail="Products, scrape jobs and activity are persistent." />
              <ServiceCard name="Groq AI" configured={data.services.groq} detail="Llama 3.3 generates Shopify-safe Turkish HTML." />
              <ServiceCard name="Shopify Admin API" configured={data.services.shopify} detail="Requires store domain and custom-app access token." />
            </section>
          )}
        </div>
      </section>

      {showNewJob && (
        <div className="drawer-backdrop centered" onClick={() => setShowNewJob(false)}>
          <form className="job-modal" onSubmit={createJob} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="drawer-close" onClick={() => setShowNewJob(false)}>×</button>
            <span className="kicker">NEW LIVE SCRAPE</span><h2>Queue a source URL</h2><p>The Playwright worker will open this exact category URL and persist every collected product to Neon.</p>
            <label>Source name<input name="source" required defaultValue="beymen.com" /></label>
            <label>Category name<input name="category_name" required defaultValue="Perfume" /></label>
            <label>Category URL<input name="category_url" type="url" required placeholder="https://www.beymen.com/tr/search?..." /></label>
            <div className="job-form-row"><label>Start page<input name="start_page" type="number" min="1" defaultValue="1" /></label><label>Pages<input name="max_pages" type="number" min="1" max="100" defaultValue="1" /></label></div>
            <label className="check-row"><input name="auto_enrich" type="checkbox" /> Enrich every collected product with Groq</label>
            <button className="primary-button wide" disabled={busyAction === "job"}>{busyAction === "job" ? "Queuing…" : "Queue real scrape"}</button>
          </form>
        </div>
      )}

      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <form className="product-drawer" onSubmit={saveProduct} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="drawer-close" onClick={() => setDrawer(null)}>×</button>
            <div className="drawer-product-art">{drawer.image_url ? <img src={drawer.image_url} alt="" /> : <span>{drawer.vendor.slice(0, 1) || "P"}</span>}</div>
            <span className="kicker">NEON PRODUCT</span><h2>{drawer.title}</h2><p>{drawer.source} · Updated {formatDate(drawer.updated_at)}</p>
            <div className="drawer-fields">
              <label className="full">Shopify title<input name="title" defaultValue={drawer.title} /></label>
              <label>Vendor<input name="vendor" defaultValue={drawer.vendor} /></label>
              <label>Category<input name="category" defaultValue={drawer.category} /></label>
              <label>Price<input name="sale_price" type="number" step=".01" defaultValue={drawer.sale_price ?? ""} /></label>
              <label>Compare at<input name="compare_at_price" type="number" step=".01" defaultValue={drawer.compare_at_price ?? ""} /></label>
              <label>Inventory<input name="inventory_qty" type="number" min="0" defaultValue={drawer.inventory_qty} /></label>
              <label className="check-row"><input name="published" type="checkbox" defaultChecked={drawer.published} /> Publish in export</label>
              <label className="full">SEO description<textarea name="body_html" defaultValue={drawer.body_html} /></label>
            </div>
            <button className="primary-button wide" disabled={busyAction === "save"}>{busyAction === "save" ? "Saving…" : "Save to Neon"}</button>
          </form>
        </div>
      )}
      {toast && <div className="toast"><i />{toast}</div>}
    </main>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <article className="metric-card"><div className="metric-top"><span>{label}</span></div><strong>{value}</strong><p>{detail}</p></article>;
}

function ProductThumb({ product }: { product: Product }) {
  return product.image_url
    ? <span className="product-thumb image"><img src={product.image_url} alt="" /></span>
    : <span className="product-thumb">{product.vendor.slice(0, 1) || "P"}</span>;
}

type TableProps = {
  products: Product[];
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  openProduct: (product: Product) => void;
  runAi: () => void;
  syncShopify: () => void;
  shopifyReady: boolean;
  downloadCsv: () => void;
  busyAction: string;
};

function ProductTable({ products, selected, setSelected, openProduct, runAi, syncShopify, shopifyReady, downloadCsv, busyAction }: TableProps) {
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return (
    <section className="panel products-panel">
      <div className="panel-heading product-heading">
        <div><span className="kicker">LIVE CATALOG</span><h2>Products</h2></div>
        <div className="table-actions">{selected.length > 0 && <span className="selected-pill">{selected.length} selected</span>}<button disabled={!selected.length || busyAction === "ai"} onClick={runAi}>✦ Enrich with AI</button><button disabled={!selected.length || !shopifyReady || busyAction === "shopify"} onClick={syncShopify}>Shopify sync</button><button className="export-button" onClick={downloadCsv}>↓ Export CSV</button></div>
      </div>
      {products.length ? (
        <>
          <div className="table-wrap"><table><thead><tr><th><input aria-label="Select all products" type="checkbox" checked={products.every((product) => selected.includes(product.id))} onChange={(event) => setSelected(event.target.checked ? products.map((product) => product.id) : [])} /></th><th>PRODUCT</th><th>SOURCE</th><th>PRICE</th><th>STOCK</th><th>AI STATUS</th><th>SHOPIFY</th><th /></tr></thead><tbody>
            {products.map((product) => <tr key={product.id}>
              <td><input aria-label={`Select ${product.title}`} type="checkbox" checked={selected.includes(product.id)} onChange={() => toggle(product.id)} /></td>
              <td><button className="product-cell" onClick={() => openProduct(product)}><ProductThumb product={product} /><span><strong>{product.title}</strong><small>{product.vendor || "Unknown vendor"}</small></span></button></td>
              <td><span className="source-badge"><i />{product.source}</span></td>
              <td><strong>{formatTry(product.sale_price)}</strong>{product.compare_at_price && <small className="compare">{formatTry(product.compare_at_price)}</small>}</td>
              <td><span>{product.inventory_qty} units</span></td>
              <td><span className={`status-badge ${product.ai_status}`}>{product.ai_status === "enriched" ? "✦ " : ""}{product.ai_status}</span></td>
              <td><span className="shopify-state"><i />{product.shopify_status.replace("_", " ")}</span></td>
              <td><button className="row-menu" onClick={() => openProduct(product)}>•••</button></td>
            </tr>)}
          </tbody></table></div>
          <div className="table-footer"><span>Showing {products.length} live products</span></div>
        </>
      ) : <EmptyState title="No products in Neon" detail="Run the Playwright worker against a real source. Products will appear here automatically." />}
    </section>
  );
}

function ProductWorkspace(props: TableProps & {
  sources: string[];
  query: string;
  setQuery: (value: string) => void;
  sourceFilter: string;
  setSourceFilter: (value: string) => void;
  onNewJob: () => void;
}) {
  return <section className="product-workspace">
    <div className="filters standalone"><label className="search"><span>⌕</span><input aria-label="Search live products" placeholder="Search real products…" value={props.query} onChange={(event) => props.setQuery(event.target.value)} /></label><select aria-label="Filter by real source" value={props.sourceFilter} onChange={(event) => props.setSourceFilter(event.target.value)}><option value="">All live sources</option>{props.sources.map((source) => <option key={source}>{source}</option>)}</select><button className="filter-button" onClick={props.onNewJob}>＋ Queue scrape</button></div>
    <ProductTable {...props} />
  </section>;
}

function EmptyState({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><div className="empty-mark"><i /><i /><i /></div><h3>{title}</h3><p>{detail}</p>{action && <button onClick={onAction}>{action}</button>}</div>;
}

function JobCard({ job, onCancel }: { job: Job; onCancel: (id: string) => void }) {
  return <article className="panel job-card"><div className="job-card-head"><span className={`status-badge ${job.status}`}>{job.status}</span><small>{formatDate(job.created_at)}</small></div><h3>{job.category_name}</h3><p>{job.category_url}</p><div className="progress-track"><i style={{ width: `${job.progress}%` }} /></div><div className="job-stats"><span><b>{job.products_found}</b> products</span><span><b>{job.pages_completed}/{job.max_pages}</b> pages</span><span><b>{job.warning_count}</b> warnings</span></div>{job.error && <div className="job-error">{job.error}</div>}{(job.status === "queued" || job.status === "running") && <button onClick={() => onCancel(job.id)}>Cancel job</button>}</article>;
}

function ServiceCard({ name, configured, detail }: { name: string; configured: boolean; detail: string }) {
  return <article className="panel settings-card"><span className="kicker">PRODUCTION SERVICE</span><h2>{name}</h2><p>{detail}</p><div className="setting-row"><span><i className={configured ? "" : "offline"} />{configured ? "Connected" : "Not configured"}</span></div></article>;
}

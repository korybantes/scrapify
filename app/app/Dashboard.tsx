"use client";
/* eslint-disable @next/next/no-img-element -- product image hosts are dynamic workspace source data */

import { FormEvent, useCallback, useEffect, useState } from "react";
import { authClient } from "@/app/lib/auth-client";

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
  seo_language?: string;
};

type SavedSource = {
  id: string;
  name: string;
  source_host: string;
  category_name: string;
  category_url: string;
  start_page: number;
  max_pages: number;
  seo_language: string;
  auto_enrich: boolean;
  enabled: boolean;
};

type AccountData = {
  user: { id: string; name: string; email: string };
  organization: { id: string; name: string; slug: string };
  workspace: { id: string; name: string; slug: string; role: string };
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
    organization_id: string;
    organization_name: string;
    organization_slug: string;
  }>;
};

type ShopifyConnection = {
  configured: boolean;
  store_domain: string;
  api_version: string;
  updated_at: string | null;
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
  account?: Omit<AccountData, "workspaces">;
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

const languages = [
  ["tr", "Turkish"],
  ["en", "English"],
  ["de", "German"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["pl", "Polish"],
  ["ar", "Arabic"],
  ["it", "Italian"],
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
  const [showSource, setShowSource] = useState(false);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [showShopify, setShowShopify] = useState(false);
  const [savedSources, setSavedSources] = useState<SavedSource[]>([]);
  const [account, setAccount] = useState<AccountData | null>(null);
  const [shopifyConnection, setShopifyConnection] = useState<ShopifyConnection>({
    configured: false,
    store_domain: "",
    api_version: "2026-07",
    updated_at: null,
  });
  const [seoLanguage, setSeoLanguage] = useState("tr");
  const [selectedSourceId, setSelectedSourceId] = useState("");
  const [busyAction, setBusyAction] = useState("");

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (sourceFilter) params.set("source", sourceFilter);
      const [dataResponse, accountResponse, sourcesResponse, shopifyResponse] = await Promise.all([
        fetch(`/api/data?${params}`, { cache: "no-store" }),
        fetch("/api/account", { cache: "no-store" }),
        fetch("/api/sources", { cache: "no-store" }),
        fetch("/api/integrations/shopify", { cache: "no-store" }),
      ]);
      const [payload, accountPayload, sourcesPayload, shopifyPayload] = await Promise.all([
        dataResponse.json(),
        accountResponse.json(),
        sourcesResponse.json(),
        shopifyResponse.json(),
      ]);
      if (!dataResponse.ok) throw new Error(payload.error ?? "Could not load live data");
      if (!accountResponse.ok) throw new Error(accountPayload.error ?? "Could not load account");
      setData(payload);
      setAccount(accountPayload);
      setSavedSources(sourcesResponse.ok ? sourcesPayload.sources : []);
      if (shopifyResponse.ok) setShopifyConnection(shopifyPayload);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load live data");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [query, sourceFilter]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadData(), 0);
    const interval = window.setInterval(() => void loadData(true), 5000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
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
          saved_source_id: form.get("saved_source_id") || null,
          source: form.get("source"),
          category_name: form.get("category_name"),
          category_url: form.get("category_url"),
          start_page: Number(form.get("start_page")),
          max_pages: Number(form.get("max_pages")),
          auto_enrich: form.get("auto_enrich") === "on",
          seo_language: form.get("seo_language"),
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

  const saveSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyAction("source");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          category_name: form.get("category_name"),
          category_url: form.get("category_url"),
          start_page: Number(form.get("start_page")),
          max_pages: Number(form.get("max_pages")),
          seo_language: form.get("seo_language"),
          auto_enrich: form.get("auto_enrich") === "on",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save source");
      setShowSource(false);
      notify("Source saved to this workspace");
      await loadData(true);
    } catch (sourceError) {
      notify(sourceError instanceof Error ? sourceError.message : "Could not save source");
    } finally {
      setBusyAction("");
    }
  };

  const deleteSource = async (id: string) => {
    const response = await fetch(`/api/sources/${id}`, { method: "DELETE" });
    const payload = await response.json();
    notify(response.ok ? "Saved source removed" : payload.error ?? "Could not remove source");
    if (response.ok) await loadData(true);
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
        body: JSON.stringify({ product_ids: selected, language: seoLanguage }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "AI enrichment failed");
      const label = languages.find(([code]) => code === seoLanguage)?.[1] ?? "selected language";
      notify(`${payload.enriched} products enriched in ${label}`);
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
      notify("Product saved to workspace");
      await loadData(true);
    } else {
      notify(payload.error ?? "Could not save product");
    }
    setBusyAction("");
  };

  const switchWorkspace = async (workspaceId: string) => {
    setBusyAction("workspace");
    const response = await fetch("/api/account/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace_id: workspaceId }),
    });
    if (response.ok) {
      setSelected([]);
      await loadData();
      notify("Workspace switched");
    } else {
      const payload = await response.json();
      notify(payload.error ?? "Could not switch workspace");
    }
    setBusyAction("");
  };

  const createWorkspace = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyAction("workspace-create");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/account", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: form.get("type"),
        name: form.get("name"),
        organization_id: account?.organization.id,
      }),
    });
    const payload = await response.json();
    if (response.ok) {
      setShowWorkspace(false);
      notify(form.get("type") === "organization" ? "Organization created" : "Workspace created");
      await loadData(true);
    } else {
      notify(payload.error ?? "Could not create workspace");
    }
    setBusyAction("");
  };

  const saveShopify = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusyAction("shopify-settings");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/integrations/shopify", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        store_domain: form.get("store_domain"),
        access_token: form.get("access_token"),
      }),
    });
    const payload = await response.json();
    if (response.ok) {
      setShowShopify(false);
      notify("Shopify connected to this workspace");
      await loadData(true);
    } else {
      notify(payload.error ?? "Could not connect Shopify");
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
        <div className="workspace-label">WORKSPACE</div>
        <div className="workspace-switch">
          <span className="store-avatar">{account?.workspace.name.slice(0, 2).toUpperCase() || "WS"}</span>
          <label>
            <strong>{account?.organization.name || "Your organization"}</strong>
            <select
              aria-label="Current workspace"
              value={account?.workspace.id || ""}
              disabled={!account || busyAction === "workspace"}
              onChange={(event) => void switchWorkspace(event.target.value)}
            >
              {account?.workspaces.map((workspace) => (
                <option value={workspace.id} key={workspace.id}>
                  {workspace.organization_name} / {workspace.name}
                </option>
              ))}
            </select>
          </label>
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
          <button className="account-button" onClick={() => setShowWorkspace(true)}>
            <span>{account?.user.name.slice(0, 1).toUpperCase() || "A"}</span>
            <i><strong>{account?.user.name || "Account"}</strong><small>{account?.workspace.role || "member"}</small></i>
          </button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="crumb"><span>{account?.workspace.name || "Workspace"}</span><b>/</b><strong>{active}</strong></div>
          <div className="top-actions">
            <button className="secondary-button" onClick={() => void loadData()}>↻ Refresh</button>
            <button className="primary-button" onClick={() => setShowNewJob(true)}><span>＋</span> New scrape</button>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">LIVE COMMERCE OPERATIONS</div>
              <h1>{active}</h1>
              <p>Every number and product below belongs to the current workspace.</p>
            </div>
            <div className={`health-chip ${error ? "health-error" : ""}`}><i />{error || "Live data connected"}</div>
          </div>

          {loading ? (
            <div className="loading-state"><span className="spinner dark" /><p>Loading workspace data…</p></div>
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
                  <p>{data.services.groq ? "Generate factual Shopify copy in the language you choose for each run." : "Add the AI service secret to enable production enrichment."}</p>
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
                <div className="real-selection"><span>{selected.length}</span><p>products selected from this workspace</p></div>
                <label className="language-picker">SEO description language
                  <select value={seoLanguage} onChange={(event) => setSeoLanguage(event.target.value)}>
                    {languages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                  </select>
                </label>
                <div className="studio-options"><label><input type="checkbox" checked readOnly /> Shopify-safe HTML</label><label><input type="checkbox" checked readOnly /> Source-name removal</label><label><input type="checkbox" checked readOnly /> Safe tag suggestions</label><label><input type="checkbox" checked readOnly /> Factual-only prompt</label></div>
                <button className="primary-button wide" disabled={!selected.length || busyAction === "ai" || !data.services.groq} onClick={() => void runAi()}>
                  {busyAction === "ai" ? "Enriching selected products…" : `✦ Enrich ${selected.length} in ${languages.find(([code]) => code === seoLanguage)?.[1]}`}
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
              <h2>Export this workspace catalog.</h2>
              <p>The download is generated at request time from current products—titles, prices, inventory, images and AI descriptions included.</p>
              <div className="export-summary"><span><small>Products</small><strong>{selected.length || data.summary.total_products}</strong></span><span><small>Warnings</small><strong>{data.summary.warnings}</strong></span><span><small>AI ready</small><strong>{data.summary.ai_enriched}</strong></span></div>
              <button className="primary-button wide" disabled={!data.summary.total_products} onClick={downloadCsv}>↓ Download live Shopify CSV</button>
            </section>
          ) : active === "Sources" ? (
            <section className="sources-page">
              <article className="panel source-intro">
                <div><span className="kicker">REUSABLE COLLECTIONS</span><h2>Saved sources</h2><p>Store an approved category URL, run settings, and default SEO language once.</p></div>
                <div className="source-actions"><button className="secondary-button" onClick={() => setShowSource(true)}>＋ Save source</button><button className="primary-button" onClick={() => setShowNewJob(true)}>＋ Queue scrape</button></div>
              </article>
              <div className="saved-source-grid">
                {savedSources.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    onRun={() => { setSelectedSourceId(source.id); setSeoLanguage(source.seo_language); setShowNewJob(true); }}
                    onDelete={() => void deleteSource(source.id)}
                  />
                ))}
                {!savedSources.length && <article className="panel"><EmptyState title="No saved sources yet" detail="Save a real category URL to reuse its scrape and language settings." action="Save first source" onAction={() => setShowSource(true)} /></article>}
              </div>
              <article className="panel source-intro jobs-heading"><div><span className="kicker">BACKGROUND QUEUE</span><h2>Scrape jobs</h2><p>The browser worker claims queued jobs and updates progress here.</p></div></article>
              <div className="jobs-list">
                {data.jobs.map((job) => <JobCard key={job.id} job={job} onCancel={cancelJob} />)}
                {!data.jobs.length && <article className="panel"><EmptyState title="No real jobs yet" detail="Queue a Beymen or Zaptila category URL. No sample jobs will be inserted." action="Queue first scrape" onAction={() => setShowNewJob(true)} /></article>}
              </div>
            </section>
          ) : (
            <section className="settings-grid">
              <ServiceCard name="Catalog database" configured={data.services.database} detail="Products, scrape jobs, sources and activity are persistent." />
              <ServiceCard name="Groq AI" configured={data.services.groq} detail="Generates Shopify-safe SEO HTML in eight supported languages." />
              <article className="panel settings-card">
                <span className="kicker">WORKSPACE INTEGRATION</span>
                <h2>Shopify Admin API</h2>
                <p>{shopifyConnection.configured ? `${shopifyConnection.store_domain} is connected only to this workspace.` : "Connect a store domain and custom-app access token for this workspace."}</p>
                <div className="setting-row"><span><i className={shopifyConnection.configured ? "" : "offline"} />{shopifyConnection.configured ? "Connected" : "Not configured"}</span><button onClick={() => setShowShopify(true)}>{shopifyConnection.configured ? "Manage" : "Connect"}</button></div>
              </article>
              <article className="panel settings-card account-settings">
                <span className="kicker">ACCOUNT & ACCESS</span>
                <h2>{account?.organization.name || "Organization"}</h2>
                <p>{account?.user.email}</p>
                <div className="setting-row"><span><i />{account?.workspace.name} · {account?.workspace.role}</span></div>
                <div className="settings-actions"><button onClick={() => setShowWorkspace(true)}>Manage workspaces</button><button onClick={() => void authClient.signOut({ fetchOptions: { onSuccess: () => window.location.assign("/") } })}>Sign out</button></div>
              </article>
            </section>
          )}
        </div>
      </section>

      {showNewJob && (
        <div className="drawer-backdrop centered" onClick={() => setShowNewJob(false)}>
          <form className="job-modal" onSubmit={createJob} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="drawer-close" onClick={() => setShowNewJob(false)}>×</button>
            <span className="kicker">NEW LIVE SCRAPE</span><h2>Queue a collection</h2><p>Choose a saved source or enter one approved category URL for this run.</p>
            <label>Saved source
              <select name="saved_source_id" value={selectedSourceId} onChange={(event) => {
                setSelectedSourceId(event.target.value);
                const source = savedSources.find((item) => item.id === event.target.value);
                if (source) setSeoLanguage(source.seo_language);
              }}>
                <option value="">One-time source</option>
                {savedSources.filter((source) => source.enabled).map((source) => <option key={source.id} value={source.id}>{source.name} · {source.category_name}</option>)}
              </select>
            </label>
            {!selectedSourceId && <>
              <label>Source name<input name="source" required defaultValue="beymen.com" /></label>
              <label>Category name<input name="category_name" required placeholder="Women's shoes" /></label>
              <label>Category URL<input name="category_url" type="url" required placeholder="https://www.beymen.com/tr/..." /></label>
              <div className="job-form-row"><label>Start page<input name="start_page" type="number" min="1" defaultValue="1" /></label><label>Pages<input name="max_pages" type="number" min="1" max="100" defaultValue="1" /></label></div>
              <label>SEO description language<select name="seo_language" value={seoLanguage} onChange={(event) => setSeoLanguage(event.target.value)}>{languages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
              <label className="check-row"><input name="auto_enrich" type="checkbox" /> Enrich every collected product automatically</label>
            </>}
            <button className="primary-button wide" disabled={busyAction === "job"}>{busyAction === "job" ? "Queuing…" : "Queue real scrape"}</button>
          </form>
        </div>
      )}

      {showSource && (
        <div className="drawer-backdrop centered" onClick={() => setShowSource(false)}>
          <form className="job-modal" onSubmit={saveSource} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="drawer-close" onClick={() => setShowSource(false)}>×</button>
            <span className="kicker">SAVE SOURCE</span><h2>Create a reusable source</h2><p>These settings stay inside {account?.workspace.name || "this workspace"} and can be launched whenever you need them.</p>
            <label>Source label<input name="name" required placeholder="Beymen — Women's Shoes" /></label>
            <label>Category name<input name="category_name" required placeholder="Women's shoes" /></label>
            <label>Category URL<input name="category_url" type="url" required placeholder="https://www.beymen.com/tr/..." /></label>
            <div className="job-form-row"><label>Start page<input name="start_page" type="number" min="1" defaultValue="1" /></label><label>Pages per run<input name="max_pages" type="number" min="1" max="100" defaultValue="1" /></label></div>
            <label>Default SEO language<select name="seo_language" defaultValue={seoLanguage}>{languages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
            <label className="check-row"><input name="auto_enrich" type="checkbox" /> Automatically enrich new products</label>
            <button className="primary-button wide" disabled={busyAction === "source"}>{busyAction === "source" ? "Saving…" : "Save source"}</button>
          </form>
        </div>
      )}

      {showWorkspace && (
        <div className="drawer-backdrop centered" onClick={() => setShowWorkspace(false)}>
          <form className="job-modal account-modal" onSubmit={createWorkspace} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="drawer-close" onClick={() => setShowWorkspace(false)}>×</button>
            <span className="kicker">ACCOUNT & WORKSPACES</span><h2>{account?.user.name}</h2><p>{account?.user.email}</p>
            <div className="workspace-list">
              {account?.workspaces.map((workspace) => (
                <button type="button" key={workspace.id} className={workspace.id === account.workspace.id ? "current" : ""} onClick={() => void switchWorkspace(workspace.id)}>
                  <span><strong>{workspace.name}</strong><small>{workspace.organization_name} · {workspace.role}</small></span><i>{workspace.id === account.workspace.id ? "Current" : "Open"}</i>
                </button>
              ))}
            </div>
            <div className="account-create">
              <label>Create<select name="type" defaultValue="workspace"><option value="workspace">Workspace in current organization</option><option value="organization">New organization</option></select></label>
              <label>Name<input name="name" required placeholder="New catalog workspace" /></label>
              <button className="primary-button wide" disabled={busyAction === "workspace-create"}>{busyAction === "workspace-create" ? "Creating…" : "Create"}</button>
            </div>
            <button type="button" className="signout-link" onClick={() => void authClient.signOut({ fetchOptions: { onSuccess: () => window.location.assign("/") } })}>Sign out of Scrappify</button>
          </form>
        </div>
      )}

      {showShopify && (
        <div className="drawer-backdrop centered" onClick={() => setShowShopify(false)}>
          <form className="job-modal" onSubmit={saveShopify} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="drawer-close" onClick={() => setShowShopify(false)}>×</button>
            <span className="kicker">SHOPIFY CONNECTION</span><h2>Connect this workspace</h2><p>The access token is encrypted before storage. It is never returned to the browser after saving.</p>
            <label>Store domain<input name="store_domain" required defaultValue={shopifyConnection.store_domain} placeholder="your-store.myshopify.com" /></label>
            <label>Admin API access token<input name="access_token" type="password" required={!shopifyConnection.configured} placeholder={shopifyConnection.configured ? "Leave blank to keep current token" : "shpat_…"} /></label>
            <button className="primary-button wide" disabled={busyAction === "shopify-settings"}>{busyAction === "shopify-settings" ? "Connecting…" : "Save connection"}</button>
          </form>
        </div>
      )}

      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <form className="product-drawer" onSubmit={saveProduct} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="drawer-close" onClick={() => setDrawer(null)}>×</button>
            <div className="drawer-product-art">{drawer.image_url ? <img src={drawer.image_url} alt="" /> : <span>{drawer.vendor.slice(0, 1) || "P"}</span>}</div>
            <span className="kicker">WORKSPACE PRODUCT</span><h2>{drawer.title}</h2><p>{drawer.source} · Updated {formatDate(drawer.updated_at)}</p>
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
            <button className="primary-button wide" disabled={busyAction === "save"}>{busyAction === "save" ? "Saving…" : "Save product"}</button>
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
      ) : <EmptyState title="No products in this workspace" detail="Run the browser worker against a real source. Products will appear here automatically." />}
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

function SourceCard({ source, onRun, onDelete }: { source: SavedSource; onRun: () => void; onDelete: () => void }) {
  const language = languages.find(([code]) => code === source.seo_language)?.[1] ?? source.seo_language;
  return (
    <article className="panel saved-source-card">
      <div className="source-card-top"><span className="source-logo">{source.source_host.slice(0, 1).toUpperCase()}</span><span><strong>{source.name}</strong><small>{source.source_host}</small></span><i>{source.enabled ? "Active" : "Paused"}</i></div>
      <h3>{source.category_name}</h3>
      <p>{source.category_url}</p>
      <div className="source-details"><span><small>PAGES</small><strong>{source.start_page}–{source.start_page + source.max_pages - 1}</strong></span><span><small>SEO LANGUAGE</small><strong>{language}</strong></span><span><small>AI</small><strong>{source.auto_enrich ? "Automatic" : "Manual"}</strong></span></div>
      <div className="source-card-actions"><button onClick={onRun}>Run source</button><button className="danger-link" onClick={onDelete}>Remove</button></div>
    </article>
  );
}

function ServiceCard({ name, configured, detail }: { name: string; configured: boolean; detail: string }) {
  return <article className="panel settings-card"><span className="kicker">PRODUCTION SERVICE</span><h2>{name}</h2><p>{detail}</p><div className="setting-row"><span><i className={configured ? "" : "offline"} />{configured ? "Connected" : "Not configured"}</span></div></article>;
}

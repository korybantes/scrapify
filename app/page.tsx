"use client";

import { useMemo, useState } from "react";

type Product = {
  id: number;
  name: string;
  brand: string;
  source: string;
  category: string;
  price: number;
  compareAt: number;
  status: "Ready" | "Needs review" | "AI enriched";
  stock: number;
  tint: string;
};

const initialProducts: Product[] = [
  { id: 1042, name: "Aventus Eau de Parfum 100 ml", brand: "Creed", source: "beymen.com", category: "Perfume", price: 13250, compareAt: 14990, status: "AI enriched", stock: 8, tint: "#d5c5a8" },
  { id: 1041, name: "Oud Wood Eau de Parfum 50 ml", brand: "Tom Ford", source: "beymen.com", category: "Perfume", price: 9690, compareAt: 10750, status: "Ready", stock: 14, tint: "#43392f" },
  { id: 1040, name: "Terre d’Hermès Parfum 75 ml", brand: "Hermès", source: "zaptila.com", category: "Perfume", price: 5890, compareAt: 6490, status: "Needs review", stock: 3, tint: "#c66a2e" },
  { id: 1039, name: "Baccarat Rouge 540 70 ml", brand: "Maison Francis Kurkdjian", source: "beymen.com", category: "Perfume", price: 14500, compareAt: 15800, status: "AI enriched", stock: 5, tint: "#b8202e" },
  { id: 1038, name: "Sauvage Elixir 60 ml", brand: "Dior", source: "zaptila.com", category: "Perfume", price: 7850, compareAt: 8490, status: "Ready", stock: 17, tint: "#25364c" },
  { id: 1037, name: "Naxos Eau de Parfum 100 ml", brand: "Xerjoff", source: "beymen.com", category: "Perfume", price: 11290, compareAt: 12450, status: "Ready", stock: 6, tint: "#71829a" },
];

const nav = [
  ["Overview", "01"],
  ["Products", "02"],
  ["AI Studio", "03"],
  ["Exports", "04"],
] as const;

const formatTry = (value: number) =>
  new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(value);

export default function Home() {
  const [active, setActive] = useState("Overview");
  const [products, setProducts] = useState(initialProducts);
  const [selected, setSelected] = useState<number[]>([1042, 1041, 1040]);
  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("All sources");
  const [running, setRunning] = useState(false);
  const [toast, setToast] = useState("");
  const [drawer, setDrawer] = useState<Product | null>(null);
  const [aiProvider, setAiProvider] = useState("Groq · Llama 3.3");

  const visibleProducts = useMemo(
    () =>
      products.filter(
        (product) =>
          (sourceFilter === "All sources" || product.source === sourceFilter) &&
          `${product.name} ${product.brand}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [products, query, sourceFilter],
  );

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  };

  const toggleSelected = (id: number) => {
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const startScrape = () => {
    setRunning(true);
    notify("Scrape job started — collecting product pages");
    window.setTimeout(() => {
      setRunning(false);
      notify("Run complete · 248 products collected, 6 flagged");
    }, 3200);
  };

  const runAi = () => {
    if (!selected.length) return notify("Select at least one product first");
    setProducts((current) =>
      current.map((product) => (selected.includes(product.id) ? { ...product, status: "AI enriched" } : product)),
    );
    notify(`${selected.length} products enriched with ${aiProvider.split(" · ")[0]}`);
  };

  const downloadCsv = () => {
    const rows = products.filter((product) => !selected.length || selected.includes(product.id));
    const header = "Handle,Title,Vendor,Type,Variant Price,Variant Compare At Price,Variant Inventory Qty,Status";
    const csv = [
      header,
      ...rows.map((p) =>
        [
          p.name.toLowerCase().replace(/[^\w]+/g, "-"),
          `"${p.name}"`,
          p.brand,
          p.category,
          p.price,
          p.compareAt,
          p.stock,
          "draft",
        ].join(","),
      ),
    ].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `scrappify-shopify-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    notify(`Shopify CSV prepared · ${rows.length} products`);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><i /><i /><i /></div>
          <span>SCRAPPIFY</span>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <button className="workspace-switch">
          <span className="store-avatar">AU</span>
          <span><strong>Atelier Union</strong><small>Shopify · Production</small></span>
          <b>⌄</b>
        </button>

        <nav>
          <p>OPERATE</p>
          {nav.map(([item, count]) => (
            <button key={item} className={active === item ? "active" : ""} onClick={() => setActive(item)}>
              <span className="nav-icon">{count}</span>{item}
              {item === "Products" && <em>1,248</em>}
            </button>
          ))}
          <p>CONFIGURE</p>
          <button onClick={() => setActive("Sources")} className={active === "Sources" ? "active" : ""}>
            <span className="nav-icon">05</span>Sources
            <span className="live-dot" />
          </button>
          <button onClick={() => setActive("Settings")} className={active === "Settings" ? "active" : ""}>
            <span className="nav-icon">06</span>Settings
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="usage-head"><span>Monthly capacity</span><strong>62%</strong></div>
          <div className="usage-track"><i /></div>
          <small>6,240 of 10,000 products</small>
          <button className="profile">
            <span>MK</span><span><strong>Mert Kaya</strong><small>Owner</small></span><b>•••</b>
          </button>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="crumb"><span>Atelier Union</span><b>/</b><strong>{active}</strong></div>
          <div className="top-actions">
            <button className="icon-button" aria-label="Notifications">⌁<i /></button>
            <button className="secondary-button" onClick={() => setActive("Exports")}>View exports</button>
            <button className="primary-button" onClick={startScrape} disabled={running}>
              {running ? <><span className="spinner" /> Running scraper</> : <><span>＋</span> New scrape</>}
            </button>
          </div>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">COMMERCE INTELLIGENCE · LIVE</div>
              <h1>{active === "Overview" ? "Good morning, Mert." : active}</h1>
              <p>
                {active === "Overview"
                  ? "Your catalog pipeline is healthy. Six products need a quick review."
                  : `Manage your ${active.toLowerCase()} workflow from one focused workspace.`}
              </p>
            </div>
            <div className="health-chip"><i /> All systems operational</div>
          </div>

          {active === "Overview" ? (
            <>
              <section className="metrics-grid">
                <article className="metric-card accent">
                  <div className="metric-top"><span>CATALOG VALUE</span><b>↗ 12.4%</b></div>
                  <strong>₺12.8M</strong>
                  <p>Across 1,248 Shopify products</p>
                  <div className="sparkline"><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /><i /></div>
                </article>
                <article className="metric-card">
                  <div className="metric-top"><span>PRODUCTS</span><b>↗ 248 this week</b></div>
                  <strong>1,248</strong>
                  <p>1,218 ready · 24 drafts · 6 flagged</p>
                  <div className="split-bar"><i /><i /><i /></div>
                </article>
                <article className="metric-card">
                  <div className="metric-top"><span>AI COVERAGE</span><b>+18.2%</b></div>
                  <strong>78%</strong>
                  <p>974 descriptions enriched</p>
                  <div className="ring"><span>78</span></div>
                </article>
                <article className="metric-card">
                  <div className="metric-top"><span>SHOPIFY</span><b className="connected"><i /> Connected</b></div>
                  <strong>1,206</strong>
                  <p>Products synced to Atelier Union</p>
                  <button onClick={() => notify("Shopify sync queued for 42 product changes")}>Sync 42 changes <span>→</span></button>
                </article>
              </section>

              <section className="workspace-grid">
                <article className="panel activity-panel">
                  <div className="panel-heading">
                    <div><span className="kicker">PIPELINE</span><h2>Active scraping</h2></div>
                    <button onClick={() => setActive("Sources")}>Manage sources</button>
                  </div>
                  <div className="run-card">
                    <div className="source-logo beymen">B</div>
                    <div className="run-info"><strong>Beymen · Perfume</strong><span>{running ? "Collecting product details…" : "Completed 12 minutes ago"}</span></div>
                    <div className="run-count"><strong>{running ? "164" : "248"}</strong><span>/ 248 products</span></div>
                    <div className={`run-status ${running ? "running" : ""}`}><i />{running ? "Running" : "Complete"}</div>
                  </div>
                  <div className="progress-track"><i style={{ width: running ? "66%" : "100%" }} /></div>
                  <div className="run-meta">
                    <span><b>12</b> pages</span><span><b>734</b> images</span><span><b>6</b> warnings</span><span><b>04:12</b> duration</span>
                  </div>
                  <div className="up-next">
                    <div><span>UP NEXT</span><strong>Zaptila · Designer fragrances</strong><small>Tomorrow at 09:00 · 8 pages</small></div>
                    <button onClick={startScrape}>Run now</button>
                  </div>
                </article>

                <article className="panel ai-panel">
                  <div className="ai-orb"><i /><i /><i /></div>
                  <span className="kicker">AI STUDIO</span>
                  <h2>Make raw data sell.</h2>
                  <p>Generate clean Turkish SEO copy, normalize titles and map Shopify categories in one pass.</p>
                  <div className="ai-stats"><span><strong>274</strong><small>Awaiting AI</small></span><span><strong>~3 min</strong><small>Est. time</small></span></div>
                  <button onClick={() => setActive("AI Studio")}>Open AI Studio <span>↗</span></button>
                </article>
              </section>

              <ProductTable
                products={visibleProducts}
                selected={selected}
                query={query}
                sourceFilter={sourceFilter}
                setQuery={setQuery}
                setSourceFilter={setSourceFilter}
                toggleSelected={toggleSelected}
                setSelected={setSelected}
                openProduct={setDrawer}
                runAi={runAi}
                downloadCsv={downloadCsv}
              />
            </>
          ) : active === "Products" ? (
            <ProductTable
              products={visibleProducts}
              selected={selected}
              query={query}
              sourceFilter={sourceFilter}
              setQuery={setQuery}
              setSourceFilter={setSourceFilter}
              toggleSelected={toggleSelected}
              setSelected={setSelected}
              openProduct={setDrawer}
              runAi={runAi}
              downloadCsv={downloadCsv}
              expanded
            />
          ) : active === "AI Studio" ? (
            <section className="studio-layout">
              <article className="panel studio-main">
                <span className="kicker">BATCH ENRICHMENT</span>
                <h2>Turn product data into polished storefront copy.</h2>
                <p>Scrappify keeps the facts, removes source-store language and creates Shopify-safe HTML in Turkish.</p>
                <label>AI provider<select value={aiProvider} onChange={(e) => setAiProvider(e.target.value)}><option>Groq · Llama 3.3</option><option>Gemini · 2.5 Flash</option><option>OpenRouter · Auto</option></select></label>
                <label>Instruction<textarea defaultValue="Write concise, premium Turkish product copy. Preserve brand, size, fragrance notes and factual details. Never mention the source retailer." /></label>
                <div className="studio-options">
                  <label><input type="checkbox" defaultChecked /> SEO description</label>
                  <label><input type="checkbox" defaultChecked /> Normalize title</label>
                  <label><input type="checkbox" defaultChecked /> Suggest tags</label>
                  <label><input type="checkbox" /> Translate to English</label>
                </div>
                <button className="primary-button wide" onClick={runAi}>✦ Enrich {selected.length} selected products</button>
              </article>
              <article className="panel studio-preview">
                <span className="kicker">LIVE PREVIEW</span>
                <div className="before-after"><span>RAW INPUT</span><p>Creed Aventus EDP 100 ML Erkek Parfüm Beymen</p></div>
                <div className="before-after after"><span>SHOPIFY OUTPUT</span><h3>Creed Aventus Eau de Parfum 100 ml</h3><p>İkonik meyvemsi ve odunsu karakteriyle Aventus, güçlü ama dengeli bir imza sunar. Günlük kullanımdan özel davetlere uzanan zamansız bir seçim.</p><div><b>creed</b><b>erkek-parfum</b><b>premium</b></div></div>
                <div className="quality-score"><span>Quality score</span><strong>96 / 100</strong></div>
              </article>
            </section>
          ) : active === "Exports" ? (
            <section className="panel export-page">
              <div className="export-art"><span>CSV</span></div>
              <span className="kicker">SHOPIFY READY</span>
              <h2>Export a clean catalog in one click.</h2>
              <p>Prices, variants, inventory, handles, images and AI descriptions are mapped to Shopify’s standard CSV schema.</p>
              <div className="export-summary"><span><small>Products</small><strong>{selected.length || products.length}</strong></span><span><small>Warnings</small><strong>6</strong></span><span><small>Images</small><strong>734</strong></span></div>
              <button className="primary-button wide" onClick={downloadCsv}>↓ Download Shopify CSV</button>
            </section>
          ) : (
            <section className="settings-grid">
              <article className="panel settings-card"><span className="kicker">SOURCE CONNECTIONS</span><h2>Beymen</h2><p>Browser-powered product collection with price and image verification.</p><div className="setting-row"><span><i /> Connection healthy</span><button onClick={() => notify("Beymen connection tested successfully")}>Test</button></div></article>
              <article className="panel settings-card"><span className="kicker">STORE DESTINATION</span><h2>Atelier Union</h2><p>my-atelier-union.myshopify.com</p><div className="setting-row"><span><i /> Shopify connected</span><button onClick={() => notify("Shopify connection is healthy")}>Verify</button></div></article>
              <article className="panel settings-card"><span className="kicker">AI PROVIDER</span><h2>Groq</h2><p>Fast batch enrichment using Llama 3.3 70B.</p><div className="setting-row"><span><i /> API configured</span><button onClick={() => setActive("AI Studio")}>Configure</button></div></article>
            </section>
          )}
        </div>
      </section>

      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <aside className="product-drawer" onClick={(event) => event.stopPropagation()}>
            <button className="drawer-close" onClick={() => setDrawer(null)}>×</button>
            <div className="drawer-product-art" style={{ background: drawer.tint }}><span>{drawer.brand.slice(0, 1)}</span></div>
            <span className="kicker">PRODUCT #{drawer.id}</span>
            <h2>{drawer.name}</h2>
            <p>{drawer.brand} · {drawer.category} · {drawer.source}</p>
            <div className="drawer-fields"><label>Shopify title<input defaultValue={drawer.name} /></label><label>Vendor<input defaultValue={drawer.brand} /></label><label>Price<input defaultValue={drawer.price} /></label><label>Compare at<input defaultValue={drawer.compareAt} /></label><label className="full">SEO description<textarea defaultValue="A refined fragrance selected for a modern, premium collection. AI enrichment can generate a complete Turkish product description here." /></label></div>
            <button className="primary-button wide" onClick={() => { setDrawer(null); notify("Product changes saved"); }}>Save product</button>
          </aside>
        </div>
      )}

      {toast && <div className="toast"><i />{toast}</div>}
    </main>
  );
}

type ProductTableProps = {
  products: Product[];
  selected: number[];
  query: string;
  sourceFilter: string;
  setQuery: (value: string) => void;
  setSourceFilter: (value: string) => void;
  toggleSelected: (id: number) => void;
  setSelected: (value: number[]) => void;
  openProduct: (value: Product) => void;
  runAi: () => void;
  downloadCsv: () => void;
  expanded?: boolean;
};

function ProductTable({ products, selected, query, sourceFilter, setQuery, setSourceFilter, toggleSelected, setSelected, openProduct, runAi, downloadCsv, expanded }: ProductTableProps) {
  return (
    <section className={`panel products-panel ${expanded ? "expanded" : ""}`}>
      <div className="panel-heading product-heading">
        <div><span className="kicker">CATALOG</span><h2>Recent products</h2></div>
        <div className="table-actions">
          {selected.length > 0 && <span className="selected-pill">{selected.length} selected</span>}
          <button onClick={runAi}>✦ Enrich with AI</button>
          <button className="export-button" onClick={downloadCsv}>↓ Export CSV</button>
        </div>
      </div>
      <div className="filters">
        <label className="search"><span>⌕</span><input aria-label="Search products" placeholder="Search products or brands…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <select aria-label="Filter products by source" value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}><option>All sources</option><option>beymen.com</option><option>zaptila.com</option></select>
        <select aria-label="Filter products by status"><option>All statuses</option><option>Ready</option><option>Needs review</option></select>
        <button className="filter-button">≡ More filters</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th><input aria-label="Select all products" type="checkbox" checked={products.length > 0 && products.every((p) => selected.includes(p.id))} onChange={(event) => setSelected(event.target.checked ? products.map((p) => p.id) : [])} /></th><th>PRODUCT</th><th>SOURCE</th><th>PRICE</th><th>STOCK</th><th>AI STATUS</th><th>SHOPIFY</th><th /></tr></thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td><input aria-label={`Select ${product.name}`} type="checkbox" checked={selected.includes(product.id)} onChange={() => toggleSelected(product.id)} /></td>
                <td><button className="product-cell" onClick={() => openProduct(product)}><span className="product-thumb" style={{ background: product.tint }}>{product.brand.slice(0, 1)}</span><span><strong>{product.name}</strong><small>{product.brand} · #{product.id}</small></span></button></td>
                <td><span className="source-badge"><i />{product.source}</span></td>
                <td><strong>{formatTry(product.price)}</strong><small className="compare">{formatTry(product.compareAt)}</small></td>
                <td><span className={product.stock < 5 ? "low-stock" : ""}>{product.stock} units</span></td>
                <td><span className={`status-badge ${product.status.toLowerCase().replace(" ", "-")}`}>{product.status === "AI enriched" ? "✦ " : ""}{product.status}</span></td>
                <td><span className="shopify-state"><i /> Draft</span></td>
                <td><button className="row-menu" onClick={() => openProduct(product)}>•••</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="table-footer"><span>Showing {products.length} of 1,248 products</span><div><button disabled>←</button><button className="current">1</button><button>2</button><button>3</button><button>→</button></div></div>
    </section>
  );
}

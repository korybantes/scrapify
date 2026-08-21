"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, Clock3, Download,
  FileOutput, History, Package, Save, ShoppingBag, Sparkles, Trash2, WandSparkles,
} from "lucide-react";
import { ShopifyCategoryPicker } from "./ShopifyCategoryPicker";

export type ExportConfig = {
  name: string; presetId?: string; templateKey: string;
  categoryId: string; categoryBreadcrumb: string; productType: string;
  collections: string[]; tags: string[]; status: "active" | "draft";
  inventoryPolicy: "deny" | "continue"; priceMode: "none" | "percent" | "fixed";
  priceValue: number; rounding: "none" | "whole" | "ending_90" | "ending_99";
  compareAtPercent: number;
  attributes: { color: string; material: string; sizeSystem: string; scentFamily: string; volume: string };
  google: { category: string; gender: string; ageGroup: string; condition: string; mpn: string; labels: string[] };
};
type Session = { id: string; category_name: string; created_at: string; session_products: number; export_ready: number };
type Preset = { id: string; name: string; template_key: string; config: ExportConfig; is_default: boolean };
type Run = { id: string; name: string; product_count: number; warning_count: number; created_at: string; created_by: string };
type Report = { total: number; ready: boolean; score: number; errors: number; warnings: number; issues: Array<{ code: string; label: string; count: number; severity: "error" | "warning" | "info" }> };

const emptyConfig: ExportConfig = {
  name: "", templateKey: "custom", categoryId: "", categoryBreadcrumb: "", productType: "",
  collections: [], tags: [], status: "draft", inventoryPolicy: "deny", priceMode: "none",
  priceValue: 0, rounding: "none", compareAtPercent: 0,
  attributes: { color: "", material: "", sizeSystem: "", scentFamily: "", volume: "" },
  google: { category: "", gender: "", ageGroup: "", condition: "new", mpn: "sku", labels: ["", "", "", "", ""] },
};
const templates: Array<{ key: string; name: string; detail: string; values: Partial<ExportConfig> }> = [
  { key: "shoes", name: "Shoes", detail: "Sneakers + EU sizing", values: { categoryId: "aa-8-8", categoryBreadcrumb: "Apparel & Accessories > Shoes > Sneakers", productType: "Sneakers", collections: ["Sneakers"], tags: ["shoes", "sneakers"], attributes: { ...emptyConfig.attributes, sizeSystem: "EU" }, google: { ...emptyConfig.google, gender: "male", ageGroup: "adult" } } },
  { key: "perfume", name: "Perfume", detail: "Fragrance attributes", values: { categoryId: "hb-3-2-8", categoryBreadcrumb: "Health & Beauty > Personal Care > Cosmetics > Perfumes & Colognes", productType: "Perfume", collections: ["Perfume"], tags: ["perfume", "fragrance"] } },
  { key: "clothing", name: "Clothing", detail: "Apparel + materials", values: { categoryId: "aa-1", categoryBreadcrumb: "Apparel & Accessories > Clothing", productType: "Clothing", collections: ["Clothing"], tags: ["apparel", "clothing"], google: { ...emptyConfig.google, ageGroup: "adult" } } },
  { key: "bags", name: "Bags", detail: "Handbags + accessories", values: { categoryId: "aa-5-4", categoryBreadcrumb: "Apparel & Accessories > Handbags, Wallets & Cases > Handbags", productType: "Bags", collections: ["Bags"], tags: ["bags", "accessories"] } },
  { key: "accessories", name: "Accessories", detail: "Flexible profile", values: { categoryId: "aa-2", categoryBreadcrumb: "Apparel & Accessories > Clothing Accessories", productType: "Accessories", collections: ["Accessories"], tags: ["accessories"] } },
  { key: "custom", name: "Custom", detail: "Blank profile", values: {} },
];

export function ExportWorkspace(props: {
  sessions: Session[]; summary: { total_products: number; ai_enriched: number };
  selected: string[]; sessionId: string; setSessionId: (id: string) => void;
  scope: "ai_ready" | "all" | "selected"; setScope: (value: "ai_ready" | "all" | "selected") => void;
  shopifyReady: boolean; busyAction: string;
  shopifyProgress: { total: number; completed: number; failed: number } | null;
  onPublish: (ids: string[], config: ExportConfig) => Promise<{ synced: number; failed: number } | void>;
  onConnect: () => void; notify: (message: string) => void;
}) {
  const [config, setConfig] = useState<ExportConfig>(emptyConfig);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [presetName, setPresetName] = useState("");
  const [report, setReport] = useState<Report | null>(null);
  const [suggestion, setSuggestion] = useState<{ confidence: number; reason: string; provider: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [exportAnyway, setExportAnyway] = useState(false);

  const session = props.sessions.find((item) => item.id === props.sessionId);
  const count = props.scope === "selected" ? props.selected.length : props.sessionId
    ? props.scope === "ai_ready" ? session?.export_ready || 0 : session?.session_products || 0
    : props.scope === "ai_ready" ? props.summary.ai_enriched : props.summary.total_products;

  const loadWorkspace = useCallback(async () => {
    try {
      const response = await fetch("/api/export/workspace", { cache: "no-store" });
      const payload = await response.json();
      if (response.ok) { setPresets(payload.presets || []); setRuns(payload.runs || []); }
    } catch {}
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadWorkspace(), 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  const update = <K extends keyof ExportConfig>(key: K, value: ExportConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setReport(null); setExportAnyway(false);
  };
  const payload = () => ({
    ids: props.scope === "selected" ? props.selected : [],
    session_id: props.scope === "selected" ? "" : props.sessionId,
    readiness: props.scope, config,
  });
  const applyTemplate = (key: string) => {
    const template = templates.find((item) => item.key === key) || templates[5];
    setConfig({ ...emptyConfig, ...template.values, templateKey: key, name: key === "custom" ? "" : `${template.name} Shopify export`, attributes: { ...emptyConfig.attributes, ...(template.values.attributes || {}) }, google: { ...emptyConfig.google, ...(template.values.google || {}) } });
    setReport(null); setSuggestion(null);
  };
  const suggest = async () => {
    setBusy("suggest");
    try {
      const response = await fetch("/api/export/category-suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Suggestion failed");
      setConfig((current) => ({ ...current, categoryId: result.suggestion.id, categoryBreadcrumb: result.suggestion.breadcrumb }));
      setSuggestion({ confidence: result.suggestion.confidence, reason: result.suggestion.reason, provider: result.provider });
    } catch (error) { props.notify(error instanceof Error ? error.message : "Suggestion failed"); }
    finally { setBusy(""); }
  };
  const validate = async () => {
    setBusy("validate");
    try {
      const response = await fetch("/api/export/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Validation failed");
      setReport(result); setExportAnyway(false); return result as Report;
    } catch (error) { props.notify(error instanceof Error ? error.message : "Validation failed"); return null; }
    finally { setBusy(""); }
  };
  const savePreset = async () => {
    const name = presetName.trim() || config.name.trim();
    if (!name) return props.notify("Enter a preset name");
    setBusy("preset");
    try {
      const response = await fetch("/api/export/workspace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, template_key: config.templateKey, config }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not save preset");
      setConfig((current) => ({ ...current, presetId: result.preset.id, name })); setPresetName("");
      await loadWorkspace(); props.notify("Export preset saved");
    } catch (error) { props.notify(error instanceof Error ? error.message : "Could not save preset"); }
    finally { setBusy(""); }
  };
  const download = async (force = false) => {
    if (!count) return props.notify("No products match this export");
    const checked = force ? report : await validate();
    if (!force && checked && checked.errors > 0) { setExportAnyway(true); return props.notify("Review blocking errors before export"); }
    const params = new URLSearchParams();
    if (props.scope === "selected") params.set("ids", props.selected.join(","));
    else { if (props.sessionId) params.set("session_id", props.sessionId); params.set("readiness", props.scope); }
    params.set("config", JSON.stringify(config));
    window.location.href = `/api/export?${params}`; setTimeout(() => void loadWorkspace(), 1200);
  };
  const publish = async () => {
    if (!props.shopifyReady) return props.onConnect();
    const checked = await validate(); if (checked && checked.errors > 0) return props.notify("Fix blocking errors before publishing");
    let ids = props.selected;
    if (props.scope !== "selected") {
      const params = new URLSearchParams();
      if (props.sessionId) params.set("session_id", props.sessionId);
      if (props.scope === "ai_ready") params.set("ai_status", "enriched");
      const response = await fetch(`/api/products/ids?${params}`); const result = await response.json();
      if (!response.ok) return props.notify(result.error || "Could not prepare products"); ids = result.ids;
    }
    const result = await props.onPublish(ids, config);
    if (result) {
      await fetch("/api/export/workspace", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "record_run", product_ids: ids, config, preset_id: config.presetId, session_id: props.sessionId, scope: props.scope, failed: result.failed, name: config.name || `${session?.category_name || "Workspace"} Shopify publish` }),
      });
      await loadWorkspace();
    }
  };
  const pricePreview = useMemo(() => {
    let price = 1000;
    if (config.priceMode === "percent") price *= 1 + config.priceValue / 100;
    if (config.priceMode === "fixed") price += config.priceValue;
    if (config.rounding === "whole") price = Math.round(price);
    if (config.rounding === "ending_90") price = Math.floor(price) + .9;
    if (config.rounding === "ending_99") price = Math.floor(price) + .99;
    return price.toFixed(2);
  }, [config.priceMode, config.priceValue, config.rounding]);

  return <section className="export-workspace-page">
    <div className="guided-export-head"><div><span className="kicker">SCRAPIFY EXPORT WORKSPACE</span><h2>Prepare a Shopify-ready catalog without spreadsheets.</h2><p>Apply a reusable profile, validate every field, then publish or download.</p></div><span className="export-format-pill"><FileOutput size={16} /> CSV + API</span></div>
    <article className="panel export-template-bar"><div><span className="kicker">PRODUCT TEMPLATES</span><strong>Start with a proven profile</strong></div><div>{templates.map((item) => <button className={config.templateKey === item.key ? "active" : ""} key={item.key} onClick={() => applyTemplate(item.key)}><Package size={14} /><span><b>{item.name}</b><small>{item.detail}</small></span></button>)}</div></article>

    <div className="export-workspace-grid"><article className="panel export-builder export-pro-builder">
      <Step n="1" title="Choose products" detail="Select a scrape session and readiness level." />
      <label className="export-session-select"><select value={props.sessionId} onChange={(event) => { props.setSessionId(event.target.value); props.setScope("ai_ready"); }}><option value="">All workspace products</option>{props.sessions.map((item) => <option value={item.id} key={item.id}>{item.category_name} · {item.session_products} products</option>)}</select><ChevronDown size={15} /></label>
      <div className="export-choice-list compact">
        <Choice active={props.scope === "ai_ready"} onClick={() => props.setScope("ai_ready")} icon={<Sparkles size={15} />} title="AI-ready" count={props.sessionId ? session?.export_ready || 0 : props.summary.ai_enriched} />
        <Choice active={props.scope === "all"} onClick={() => props.setScope("all")} icon={<Package size={15} />} title="All products" count={props.sessionId ? session?.session_products || 0 : props.summary.total_products} />
        <Choice active={props.scope === "selected"} disabled={!props.selected.length} onClick={() => props.setScope("selected")} icon={<Check size={15} />} title="Selected" count={props.selected.length} />
      </div>

      <div className="export-divider" /><Step n="2" title="Classify and organize" detail="Use ScrapifyAI or search the complete official taxonomy." action={<button onClick={() => void suggest()} disabled={busy === "suggest"}><WandSparkles size={14} /> {busy === "suggest" ? "Analyzing…" : "Suggest with AI"}</button>} />
      {suggestion && <div className="ai-category-suggestion"><Sparkles size={15} /><span><strong>{suggestion.confidence}% · {suggestion.provider}</strong><small>{suggestion.reason}</small></span></div>}
      <div className="export-mapping-grid">
        <label className="full"><span>Shopify category <em>14,606 choices</em></span><ShopifyCategoryPicker value={config.categoryBreadcrumb} selectedId={config.categoryId} onChange={(name, id) => setConfig((current) => ({ ...current, categoryBreadcrumb: name, categoryId: id }))} /></label>
        <Field label="Product type"><input value={config.productType} onChange={(e) => update("productType", e.target.value)} /></Field>
        <Field label="Status"><select value={config.status} onChange={(e) => update("status", e.target.value as ExportConfig["status"])}><option value="draft">Draft</option><option value="active">Active</option></select></Field>
        <label className="full"><span>Collections <em>Multiple supported</em></span><input value={config.collections.join(", ")} onChange={(e) => update("collections", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} placeholder="Sneakers, New arrivals" /><small>Direct publish assigns all; CSV uses the first.</small></label>
        <label className="full"><span>Tags</span><input value={config.tags.join(", ")} onChange={(e) => update("tags", e.target.value.split(",").map((v) => v.trim()).filter(Boolean))} /></label>
      </div>

      <div className="export-divider" /><Step n="3" title="Pricing and inventory" detail="Apply consistent rules without changing source products." />
      <div className="export-rule-grid">
        <Field label="Pricing rule"><select value={config.priceMode} onChange={(e) => update("priceMode", e.target.value as ExportConfig["priceMode"])}><option value="none">Keep source</option><option value="percent">Percentage markup</option><option value="fixed">Fixed markup</option></select></Field>
        <Field label="Markup"><input type="number" min="0" value={config.priceValue} disabled={config.priceMode === "none"} onChange={(e) => update("priceValue", Number(e.target.value))} /></Field>
        <Field label="Rounding"><select value={config.rounding} onChange={(e) => update("rounding", e.target.value as ExportConfig["rounding"])}><option value="none">None</option><option value="whole">Whole</option><option value="ending_90">End .90</option><option value="ending_99">End .99</option></select></Field>
        <Field label="Compare-at uplift %"><input type="number" min="0" value={config.compareAtPercent} onChange={(e) => update("compareAtPercent", Number(e.target.value))} /></Field>
        <Field label="Sold-out policy"><select value={config.inventoryPolicy} onChange={(e) => update("inventoryPolicy", e.target.value as ExportConfig["inventoryPolicy"])}><option value="deny">Stop selling</option><option value="continue">Continue selling</option></select></Field>
        <div className="price-rule-preview"><small>₺1,000 EXAMPLE</small><strong>→ ₺{pricePreview}</strong></div>
      </div>

      <button className="export-advanced-toggle" onClick={() => setAdvanced(!advanced)}><ChevronDown size={15} /><span><strong>Attributes and Google Shopping</strong><small>Color, material, sizing, fragrance and Merchant Center</small></span></button>
      {advanced && <div className="export-advanced-panel"><div className="export-rule-grid">
        <Field label="Color"><input value={config.attributes.color} onChange={(e) => update("attributes", { ...config.attributes, color: e.target.value })} /></Field>
        <Field label="Material"><input value={config.attributes.material} onChange={(e) => update("attributes", { ...config.attributes, material: e.target.value })} /></Field>
        <Field label="Size system"><select value={config.attributes.sizeSystem} onChange={(e) => update("attributes", { ...config.attributes, sizeSystem: e.target.value })}><option value="">None</option><option>EU</option><option>US</option><option>UK</option></select></Field>
        <Field label="Scent family"><input value={config.attributes.scentFamily} onChange={(e) => update("attributes", { ...config.attributes, scentFamily: e.target.value })} /></Field>
        <Field label="Volume"><input value={config.attributes.volume} onChange={(e) => update("attributes", { ...config.attributes, volume: e.target.value })} /></Field>
        <label className="full"><span>Google category</span><input value={config.google.category} onChange={(e) => update("google", { ...config.google, category: e.target.value })} /></label>
        <Field label="Gender"><select value={config.google.gender} onChange={(e) => update("google", { ...config.google, gender: e.target.value })}><option value="">None</option><option value="male">Male</option><option value="female">Female</option><option value="unisex">Unisex</option></select></Field>
        <Field label="Age group"><select value={config.google.ageGroup} onChange={(e) => update("google", { ...config.google, ageGroup: e.target.value })}><option value="">None</option><option value="adult">Adult</option><option value="kids">Kids</option><option value="toddler">Toddler</option></select></Field>
        <Field label="Condition"><select value={config.google.condition} onChange={(e) => update("google", { ...config.google, condition: e.target.value })}><option value="new">New</option><option value="used">Used</option><option value="refurbished">Refurbished</option></select></Field>
        <Field label="MPN"><select value={config.google.mpn} onChange={(e) => update("google", { ...config.google, mpn: e.target.value })}><option value="sku">Variant SKU</option><option value="">Blank</option></select></Field>
        {config.google.labels.map((label, index) => <Field label={`Custom label ${index}`} key={index}><input value={label} onChange={(e) => { const labels = [...config.google.labels]; labels[index] = e.target.value; update("google", { ...config.google, labels }); }} /></Field>)}
      </div></div>}

      <div className="export-divider" /><Step n="4" title="Save and validate" detail="Reuse settings and catch errors before Shopify." />
      <div className="export-save-row"><input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Preset name" /><button onClick={() => void savePreset()}><Save size={13} /> Save</button><select defaultValue="" onChange={(e) => { const preset = presets.find((p) => p.id === e.target.value); if (preset) setConfig({ ...emptyConfig, ...preset.config, presetId: preset.id }); }}><option value="">Load preset…</option>{presets.map((p) => <option value={p.id} key={p.id}>{p.name}</option>)}</select></div>
      {presets.length > 0 && <div className="saved-preset-list">{presets.map((p) => <span key={p.id}><button onClick={() => setConfig({ ...emptyConfig, ...p.config, presetId: p.id })}>{p.name}</button><button onClick={async () => { await fetch(`/api/export/workspace?id=${p.id}`, { method: "DELETE" }); await loadWorkspace(); }}><Trash2 size={11} /></button></span>)}</div>}
      <button className="validation-trigger" onClick={() => void validate()}><CheckCircle2 size={14} /> {busy === "validate" ? "Checking every product…" : "Run preflight validation"}</button>
      {report && <Validation report={report} />}
    </article>

    <aside className="export-side-column"><article className="panel export-receipt"><div className="export-receipt-icon"><FileOutput size={24} /></div><span className="kicker">YOUR EXPORT</span><h3>{session?.category_name || "Complete workspace"}</h3><p>{config.categoryBreadcrumb || "Choose a category or ask ScrapifyAI."}</p><div className="export-count"><strong>{count.toLocaleString()}</strong><span>products selected</span></div><div className="export-organization-summary"><span><small>PROFILE</small><strong>{templates.find((t) => t.key === config.templateKey)?.name} · {config.status}</strong></span><span><small>PRICING</small><strong>{config.priceMode === "none" ? "Source prices" : `${config.priceMode} +${config.priceValue}`}</strong></span></div>
      {props.shopifyProgress && props.busyAction === "shopify" && <div className="shopify-publish-progress"><strong>{props.shopifyProgress.completed}/{props.shopifyProgress.total}</strong><div className="progress-track"><i style={{ width: `${Math.round(props.shopifyProgress.completed / props.shopifyProgress.total * 100)}%` }} /></div></div>}
      <button className="shopify-publish-button wide" disabled={!count} onClick={() => void publish()}><ShoppingBag size={14} /> {props.shopifyReady ? "Publish directly" : "Connect Shopify"}</button><button className="primary-button wide" disabled={!count} onClick={() => void download()}><Download size={14} /> Validate & download</button>{exportAnyway && <button className="export-anyway-button" onClick={() => void download(true)}><AlertTriangle size={12} /> Download anyway</button>}</article>
      <article className="panel export-history-card"><div className="panel-heading"><div><span className="kicker">AUDIT TRAIL</span><h3>Export history</h3></div><History size={17} /></div><div className="export-history-list">{runs.map((run) => <div key={run.id}><span><strong>{run.name}</strong><small>{new Date(run.created_at).toLocaleString()} · {run.created_by}</small><em>{run.product_count} products · {run.warning_count} warnings</em></span><a href={`/api/export?history_id=${run.id}&record=false`}><Download size={13} /></a></div>)}{!runs.length && <div className="export-history-empty"><Clock3 size={16} /> No exports yet</div>}</div></article>
    </aside></div>
  </section>;
}

function Step({ n, title, detail, action }: { n: string; title: string; detail: string; action?: React.ReactNode }) {
  return <div className="export-step"><span className="export-step-number">{n}</span><div><h3>{title}</h3><p>{detail}</p></div>{action && <div className="export-step-action">{action}</div>}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label><span>{label}</span>{children}</label>; }
function Choice({ active, disabled, onClick, icon, title, count }: { active: boolean; disabled?: boolean; onClick: () => void; icon: React.ReactNode; title: string; count: number }) {
  return <button className={active ? "active" : ""} disabled={disabled} onClick={onClick}>{icon}<span><strong>{title}</strong><small>Export scope</small></span><i>{count}</i></button>;
}
function Validation({ report }: { report: Report }) {
  return <div className={`validation-panel ${report.ready ? "ready" : "attention"}`}><div className="validation-score"><span><CheckCircle2 size={17} /><strong>{report.ready ? "Ready for Shopify" : "Needs attention"}</strong></span><b>{report.score}/100</b></div><div className="validation-summary"><span><strong>{report.total}</strong><small>checked</small></span><span><strong>{report.errors}</strong><small>errors</small></span><span><strong>{report.warnings}</strong><small>warnings</small></span></div><div className="validation-issues">{report.issues.map((issue) => <div className={issue.severity} key={issue.code}><i /><span><strong>{issue.label}</strong><small>{issue.severity}</small></span><b>{issue.count}</b></div>)}{!report.issues.length && <div className="clean"><Check size={13} /> No issues found</div>}</div></div>;
}

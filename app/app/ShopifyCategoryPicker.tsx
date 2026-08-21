"use client";

import { useCallback, useMemo, useState } from "react";
import { Check, CheckCircle2, ChevronDown, RefreshCw, Search, X } from "lucide-react";

type TaxonomyResponse = { version: string; categories: Array<[string, string]> };

const normalize = (value: string) =>
  value.toLocaleLowerCase("en-US").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim();

export function ShopifyCategoryPicker({ value, selectedId, onChange }: {
  value: string; selectedId: string; onChange: (value: string, id: string) => void;
}) {
  const [categories, setCategories] = useState<Array<[string, string]>>([]);
  const [version, setVersion] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [active, setActive] = useState(0);

  const load = useCallback(async () => {
    if (categories.length || loading) return;
    setLoading(true); setError("");
    try {
      const response = await fetch("/shopify-taxonomy-2026-05.json", { cache: "force-cache" });
      if (!response.ok) throw new Error("Could not load Shopify categories");
      const payload = await response.json() as TaxonomyResponse;
      setCategories(payload.categories); setVersion(payload.version);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load categories");
    } finally { setLoading(false); }
  }, [categories.length, loading]);

  const matches = useMemo(() => {
    const query = normalize(value);
    if (!query) return categories.filter(([, name]) => !name.includes(" > ")).slice(0, 40);
    const tokens = query.split(/\s+/).filter(Boolean);
    return categories.map((category) => {
      const name = normalize(category[1]);
      const leaf = name.split(" > ").pop() || name;
      if (!tokens.every((token) => name.includes(token))) return null;
      const score = leaf === query ? 0 : leaf.startsWith(query) ? 1 : name.startsWith(query) ? 2 : name.includes(` > ${query}`) ? 3 : 4;
      return { category, score, depth: category[1].split(" > ").length };
    }).filter((item): item is { category: [string, string]; score: number; depth: number } => Boolean(item))
      .sort((a, b) => a.score - b.score || a.depth - b.depth || a.category[1].localeCompare(b.category[1]))
      .slice(0, 80).map((item) => item.category);
  }, [categories, value]);

  const choose = (category: [string, string]) => { onChange(category[1], category[0]); setOpen(false); };
  return <div className="taxonomy-picker" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }}>
    <div className={`taxonomy-input ${selectedId ? "selected" : ""}`}><Search size={15} /><input
      role="combobox" aria-expanded={open} aria-controls="shopify-taxonomy-results"
      value={value} placeholder="Search every Shopify category..."
      onFocus={() => { setOpen(true); void load(); }}
      onChange={(event) => { onChange(event.target.value, ""); setActive(0); setOpen(true); void load(); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(value + 1, Math.max(0, matches.length - 1))); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); }
        else if (event.key === "Enter" && open && matches[active]) { event.preventDefault(); choose(matches[active]); }
        else if (event.key === "Escape") setOpen(false);
      }} />
      {selectedId ? <button type="button" aria-label="Clear category" onClick={() => onChange("", "")}><X size={14} /></button> : <ChevronDown size={15} />}
    </div>
    {selectedId && <div className="taxonomy-selected"><CheckCircle2 size={13} /><span>Official Shopify category</span><code>{selectedId}</code></div>}
    {open && <div className="taxonomy-results" id="shopify-taxonomy-results" role="listbox">
      <div className="taxonomy-results-head"><span>{value ? `${matches.length} best matches` : "Top-level categories"}</span><small>{categories.length ? `${categories.length.toLocaleString()} · ${version}` : "Official taxonomy"}</small></div>
      {loading ? <div className="taxonomy-message"><RefreshCw className="spin" size={16} /> Loading complete taxonomy…</div>
        : error ? <button className="taxonomy-message error" onClick={() => void load()}>{error} · Retry</button>
          : matches.length ? matches.map((category, index) => {
            const parts = category[1].split(" > "); const leaf = parts.pop(); const parent = parts.join(" > ");
            return <button type="button" role="option" aria-selected={selectedId === category[0]} className={index === active ? "active" : ""} key={category[0]} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActive(index)} onClick={() => choose(category)}><span><strong>{leaf}</strong><small>{parent || "Top-level category"}</small></span><code>{category[0]}</code>{selectedId === category[0] && <Check size={14} />}</button>;
          }) : <div className="taxonomy-message">No official category matches.</div>}
    </div>}
    <small>Search any word, then select the official category.</small>
  </div>;
}

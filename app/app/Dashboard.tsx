"use client";
/* eslint-disable @next/next/no-img-element -- product image hosts are dynamic workspace source data */

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { authClient } from "@/app/lib/auth-client";
import {
  Activity,
  Bell,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  FileOutput,
  Globe2,
  LayoutDashboard,
  Maximize2,
  MoreHorizontal,
  Package,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShoppingBag,
  Sparkles,
  Timer,
  Users,
  X,
} from "lucide-react";

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
  ai_error: string | null;
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
  logs: Array<{ at: string; level: string; message: string }>;
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
    ai_pending: number;
    ai_failed: number;
    ai_skipped: number;
    warnings: number;
    shopify_synced: number;
    catalog_value: string;
  };
  jobs: Job[];
  products: Product[];
  pagination: { page: number; page_size: number; total: number; total_pages: number };
  events: Array<{ id: number; level: string; event_type: string; message: string; created_at: string }>;
  sources: string[];
  services: { database: boolean; groq: boolean; shopify: boolean };
  account?: Omit<AccountData, "workspaces">;
};

type AiProcessLog = {
  id: string;
  title: string;
  status: "running" | "retrying" | "enriched" | "failed";
  message: string;
  at: string;
};

type AiProgress = {
  status: "running" | "completed" | "completed_with_errors" | "cancelled";
  completed: number;
  succeeded: number;
  total: number;
  failed: number;
  current: string;
  attempt: number;
  startedAt: number;
  logs: AiProcessLog[];
};

const emptyData: DashboardData = {
  summary: { total_products: 0, ai_enriched: 0, ai_pending: 0, ai_failed: 0, ai_skipped: 0, warnings: 0, shopify_synced: 0, catalog_value: "0" },
  jobs: [],
  products: [],
  pagination: { page: 1, page_size: 50, total: 0, total_pages: 1 },
  events: [],
  sources: [],
  services: { database: false, groq: false, shopify: false },
};

const nav = [
  ["Overview", LayoutDashboard],
  ["Products", Package],
  ["AI Studio", Sparkles],
  ["Exports", FileOutput],
  ["Sources", Globe2],
  ["Settings", Settings],
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
  const [aiStatusFilter, setAiStatusFilter] = useState("");
  const [productPage, setProductPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [drawer, setDrawer] = useState<Product | null>(null);
  const [showNewJob, setShowNewJob] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [editingSource, setEditingSource] = useState<SavedSource | null>(null);
  const [showWorkspace, setShowWorkspace] = useState(false);
  const [showShopify, setShowShopify] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [lastReadEventId, setLastReadEventId] = useState(0);
  const [showBulkEdit, setShowBulkEdit] = useState(false);
  const [showLiveTracker, setShowLiveTracker] = useState(false);
  const [showTrackerDock, setShowTrackerDock] = useState(true);
  const [trackedJobId, setTrackedJobId] = useState("");
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
  const [aiProgress, setAiProgress] = useState<AiProgress | null>(null);
  const [showAiTracker, setShowAiTracker] = useState(false);
  const [showAiTrackerDock, setShowAiTrackerDock] = useState(true);
  const aiCancelRequested = useRef(false);

  const loadData = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (sourceFilter) params.set("source", sourceFilter);
      if (aiStatusFilter) params.set("ai_status", aiStatusFilter);
      params.set("page", String(productPage));
      params.set("page_size", String(pageSize));
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
  }, [query, sourceFilter, aiStatusFilter, productPage, pageSize]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadData(), 0);
    const notificationState = window.setTimeout(() => setLastReadEventId(Number(window.localStorage.getItem("scrappify_last_event") || 0)), 0);
    const interval = window.setInterval(() => void loadData(true), 5000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearTimeout(notificationState);
      window.clearInterval(interval);
    };
  }, [loadData]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  };

  const visibleProducts = data.products;
  const unreadNotifications = data.events.filter((event) => Number(event.id) > lastReadEventId);
  const activeJob = data.jobs.find((job) => job.status === "running" || job.status === "queued");
  const trackedJob = (trackedJobId ? data.jobs.find((job) => job.id === trackedJobId) : undefined) ?? activeJob;
  const lastJob = activeJob ?? data.jobs[0];
  const latestTrackedLog = trackedJob?.logs?.[trackedJob.logs.length - 1];
  const aiCoverage = data.summary.total_products
    ? Math.round((data.summary.ai_enriched / data.summary.total_products) * 100)
    : 0;
  const aiProgressPercent = aiProgress?.total
    ? Math.round((aiProgress.completed / aiProgress.total) * 100)
    : 0;
  const aiRemaining = aiProgress ? Math.max(0, aiProgress.total - aiProgress.completed) : 0;

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
      setTrackedJobId(payload.id);
      setShowTrackerDock(true);
      setShowLiveTracker(true);
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
      const response = await fetch(editingSource ? `/api/sources/${editingSource.id}` : "/api/sources", {
        method: editingSource ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          category_name: form.get("category_name"),
          category_url: form.get("category_url"),
          start_page: Number(form.get("start_page")),
          max_pages: Number(form.get("max_pages")),
          seo_language: form.get("seo_language"),
          auto_enrich: form.get("auto_enrich") === "on",
          enabled: form.get("enabled") === "on",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save source");
      setSelectedSourceId(payload.source.id);
      setSeoLanguage(payload.source.seo_language);
      setShowSource(false);
      const wasEditing = Boolean(editingSource);
      setEditingSource(null);
      notify(wasEditing ? "Source settings updated" : "Source saved. You can run it now.");
      await loadData(true);
      if (!wasEditing) setShowNewJob(true);
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

  const processAiProducts = async (productIds: string[]) => {
    if (!productIds.length) {
      notify("There are no products waiting for AI");
      return { succeeded: 0, failed: 0, cancelled: false };
    }
    if (!data.services.groq) {
      notify("AI enrichment is not configured");
      return { succeeded: 0, failed: productIds.length, cancelled: false };
    }

    setBusyAction("ai");
    setShowAiTrackerDock(true);
    aiCancelRequested.current = false;
    const targets = [...new Set(productIds)];
    let succeeded = 0;
    let failed = 0;
    let logs: AiProcessLog[] = [];
    const startedAt = Date.now();
    const updateProgress = (
      current: string,
      attempt: number,
      status: AiProgress["status"] = "running",
    ) => {
      setAiProgress({
        status,
        completed: succeeded + failed,
        succeeded,
        total: targets.length,
        failed,
        current,
        attempt,
        startedAt,
        logs,
      });
    };
    updateProgress("Preparing catalog enrichment", 0);

    try {
      for (let index = 0; index < targets.length; index += 1) {
        if (aiCancelRequested.current) break;
        const productId = targets[index];
        const product = data.products.find((item) => item.id === productId);
        let productTitle = product?.title || `Product ${index + 1}`;
        let enriched = false;
        let finalError = "";

        for (let attempt = 1; attempt <= 3 && !aiCancelRequested.current; attempt += 1) {
          const activity: AiProcessLog = {
            id: `${productId}-${attempt}-${Date.now()}`,
            title: productTitle,
            status: attempt === 1 ? "running" : "retrying",
            message: attempt === 1 ? "Writing SEO description" : `Retry ${attempt} of 3`,
            at: new Date().toISOString(),
          };
          logs = [activity, ...logs].slice(0, 60);
          updateProgress(productTitle, attempt);

          try {
            const response = await fetch("/api/ai/enrich", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ product_ids: [productId], language: seoLanguage }),
            });
            const payload = await response.json();
            productTitle = payload.products?.[0]?.title || productTitle;
            if (!response.ok || payload.failed?.length) {
              throw new Error(payload.error || payload.failed?.[0]?.error || "AI enrichment failed");
            }
            enriched = true;
            succeeded += 1;
            const completedActivity: AiProcessLog = {
              id: `${productId}-success-${Date.now()}`,
              title: productTitle,
              status: "enriched",
              message: `Description completed in ${languages.find(([code]) => code === seoLanguage)?.[1] || "the selected language"}`,
              at: new Date().toISOString(),
            };
            logs = [completedActivity, ...logs].slice(0, 60);
            break;
          } catch (aiError) {
            finalError = aiError instanceof Error ? aiError.message : "AI enrichment failed";
            if (attempt < 3 && !aiCancelRequested.current) {
              await new Promise((resolve) => window.setTimeout(resolve, attempt * 1200));
            }
          }
        }

        if (!enriched && !aiCancelRequested.current) {
          failed += 1;
          const failedActivity: AiProcessLog = {
            id: `${productId}-failed-${Date.now()}`,
            title: productTitle,
            status: "failed",
            message: finalError || "Could not complete after 3 attempts",
            at: new Date().toISOString(),
          };
          logs = [failedActivity, ...logs].slice(0, 60);
        }
        updateProgress(productTitle, 0);
      }

      const label = languages.find(([code]) => code === seoLanguage)?.[1] ?? "selected language";
      const cancelled = aiCancelRequested.current;
      updateProgress(
        cancelled ? "Stopped safely" : failed ? "Catalog run finished with items to retry" : "Every product is enriched",
        0,
        cancelled ? "cancelled" : failed ? "completed_with_errors" : "completed",
      );
      notify(cancelled
        ? `AI run stopped · ${succeeded} products enriched`
        : `${succeeded} products enriched in ${label}${failed ? ` · ${failed} need attention` : ""}`);
      await loadData(true);
      return { succeeded, failed, cancelled };
    } catch (aiError) {
      notify(aiError instanceof Error ? aiError.message : "AI enrichment failed");
      updateProgress("The enrichment run stopped unexpectedly", 0, "completed_with_errors");
      return { succeeded, failed: Math.max(failed, targets.length - succeeded), cancelled: false };
    } finally {
      setBusyAction("");
    }
  };

  const runAi = async () => {
    if (!selected.length) return notify("Select at least one real product first");
    await processAiProducts(selected);
  };

  const enrichAllRemaining = async () => {
    if (busyAction === "ai") return;
    setBusyAction("select");
    try {
      const [pendingResponse, failedResponse] = await Promise.all([
        fetch("/api/products/ids?ai_status=pending", { cache: "no-store" }),
        fetch("/api/products/ids?ai_status=failed", { cache: "no-store" }),
      ]);
      const [pendingPayload, failedPayload] = await Promise.all([pendingResponse.json(), failedResponse.json()]);
      if (!pendingResponse.ok || !failedResponse.ok) {
        throw new Error(pendingPayload.error || failedPayload.error || "Could not prepare the AI queue");
      }
      const productIds = [...new Set<string>([...pendingPayload.ids, ...failedPayload.ids])];
      setSelected(productIds);
      if (!productIds.length) {
        notify("Every product is already enriched");
        return;
      }
      await processAiProducts(productIds);
    } catch (selectionError) {
      notify(selectionError instanceof Error ? selectionError.message : "Could not prepare the AI queue");
    } finally {
      setBusyAction((current) => current === "select" ? "" : current);
    }
  };

  const writeDrawerWithAi = async () => {
    if (!drawer || busyAction === "ai") return;
    const productId = drawer.id;
    const result = await processAiProducts([productId]);
    if (!result.succeeded) return;
    const response = await fetch(`/api/products/${productId}`, { cache: "no-store" });
    const payload = await response.json();
    if (response.ok) setDrawer(payload);
  };

  const bulkEdit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected.length) return notify("Select products to edit first");
    setBusyAction("bulk");
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = { product_ids: selected };
    const vendor = String(form.get("vendor") || "").trim();
    const category = String(form.get("category") || "").trim();
    const inventory = String(form.get("inventory_qty") || "").trim();
    const tags = String(form.get("tags") || "").trim();
    const published = String(form.get("published") || "");
    if (vendor) payload.vendor = vendor;
    if (category) payload.category = category;
    if (inventory) payload.inventory_qty = Number(inventory);
    if (tags) payload.tags = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
    if (published) payload.published = published === "true";
    try {
      const response = await fetch("/api/products/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Bulk edit failed");
      setShowBulkEdit(false);
      notify(`${result.updated} products updated`);
      await loadData(true);
    } catch (bulkError) {
      notify(bulkError instanceof Error ? bulkError.message : "Bulk edit failed");
    } finally {
      setBusyAction("");
    }
  };

  const openRunModal = () => {
    const firstSource = savedSources.find((source) => source.enabled);
    if (!firstSource) {
      setEditingSource(null);
      setShowSource(true);
      return;
    }
    if (!selectedSourceId) {
      setSelectedSourceId(firstSource.id);
      setSeoLanguage(firstSource.seo_language);
    }
    setShowNewJob(true);
  };

  const openNewSource = () => {
    setEditingSource(null);
    setShowSource(true);
  };

  const openSourceEditor = (source: SavedSource) => {
    setEditingSource(source);
    setSeoLanguage(source.seo_language);
    setShowSource(true);
  };

  const markNotificationsRead = () => {
    const newestId = Number(data.events[0]?.id || 0);
    setLastReadEventId(newestId);
    window.localStorage.setItem("scrappify_last_event", String(newestId));
  };

  const openNotification = (eventType: string) => {
    if (eventType.includes("scrape")) setActive("Sources");
    else if (eventType.includes("ai")) setActive("AI Studio");
    else if (eventType.includes("shopify")) setActive("Products");
    setShowNotifications(false);
    markNotificationsRead();
  };

  const syncShopify = async () => {
    if (!selected.length) return notify("Select at least one real product first");
    if (!data.services.shopify) return notify("Shopify Admin API is not configured yet");
    setBusyAction("shopify");
    try {
      let synced = 0;
      let failed = 0;
      for (let index = 0; index < selected.length; index += 50) {
        const response = await fetch("/api/shopify/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ product_ids: selected.slice(index, index + 50) }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? "Shopify sync failed");
        synced += payload.synced.length;
        failed += payload.failed.length;
      }
      notify(`${synced} products synced to Shopify${failed ? ` · ${failed} failed` : ""}`);
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

  const saveAccountSetting = async (event: FormEvent<HTMLFormElement>, scope: "organization" | "workspace") => {
    event.preventDefault();
    setBusyAction(`settings-${scope}`);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, name: form.get("name") }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not save settings");
      notify(`${scope === "organization" ? "Organization" : "Workspace"} settings saved`);
      await loadData(true);
    } catch (settingsError) {
      notify(settingsError instanceof Error ? settingsError.message : "Could not save settings");
    } finally {
      setBusyAction("");
    }
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
    const params = new URLSearchParams();
    if (selected.length && selected.length >= data.pagination.total) {
      params.set("scope", "matching");
      if (query) params.set("query", query);
      if (sourceFilter) params.set("source", sourceFilter);
      if (aiStatusFilter) params.set("ai_status", aiStatusFilter);
    } else if (selected.length) {
      params.set("ids", selected.join(","));
    }
    window.location.href = `/api/export${params.size ? `?${params}` : ""}`;
  };

  const selectAllMatching = async (statusOverride?: string) => {
    setBusyAction("select");
    try {
      const params = new URLSearchParams();
      if (query) params.set("query", query);
      if (sourceFilter) params.set("source", sourceFilter);
      const status = statusOverride ?? aiStatusFilter;
      if (status) params.set("ai_status", status);
      const response = await fetch(`/api/products/ids?${params}`, { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Could not select products");
      setSelected(payload.ids);
      notify(`${payload.total} matching products selected`);
    } catch (selectionError) {
      notify(selectionError instanceof Error ? selectionError.message : "Could not select products");
    } finally {
      setBusyAction("");
    }
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark"><i /><i /><i /></div><span>SCRAPPIFY</span></div>
        <div className="workspace-label">WORKSPACE</div>
        <button className="workspace-switch" onClick={() => setShowWorkspace(true)}>
          <span className="store-avatar">{account?.workspace.name.slice(0, 2).toUpperCase() || "WS"}</span>
          <span className="workspace-copy">
            <strong>{account?.organization.name || "Your organization"}</strong>
            <small>{account?.workspace.name || "Main workspace"}</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <nav>
          <p>OPERATE</p>
          {nav.map(([item, Icon], index) => (
            <button key={item} className={active === item ? "active" : ""} onClick={() => setActive(item)}>
              <Icon className="nav-icon" size={17} strokeWidth={1.8} />{item}
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
          <div className="topbar-left">
            <div className="crumb"><span>{account?.workspace.name || "Workspace"}</span><b>/</b><strong>{active}</strong></div>
            <span className="system-status"><i /> All systems operational</span>
          </div>
          <div className="top-actions">
            <button className={`icon-button notification-button ${showNotifications ? "active" : ""}`} aria-label="Notifications" onClick={() => {
              const next = !showNotifications;
              setShowNotifications(next);
              if (next) markNotificationsRead();
            }}>
              <Bell size={16} />
              {unreadNotifications.length > 0 && <i />}
            </button>
            <button className="secondary-button" onClick={() => void loadData()}><RefreshCw size={15} /> Refresh</button>
            <button className="primary-button" onClick={openRunModal}><Plus size={15} />{savedSources.length ? "Run source" : "Add first source"}</button>
          </div>
          {showNotifications && (
            <aside className="notification-center">
              <div className="notification-head">
                <div><span className="kicker">ACTIVITY CENTER</span><h3>Notifications</h3></div>
                <button onClick={markNotificationsRead}><Check size={13} /> Mark read</button>
              </div>
              <div className="notification-list">
                {data.events.slice(0, 10).map((event) => (
                  <button key={event.id} onClick={() => openNotification(event.event_type)}>
                    <span className={`notification-icon ${event.level}`}>
                      {event.event_type.includes("ai") ? <Sparkles size={15} /> : event.event_type.includes("shopify") ? <ShoppingBag size={15} /> : <Activity size={15} />}
                    </span>
                    <span><strong>{event.message}</strong><small>{formatDate(event.created_at)}</small></span>
                    {Number(event.id) > lastReadEventId && <i />}
                  </button>
                ))}
                {!data.events.length && <div className="notification-empty"><Bell size={20} /><strong>You are all caught up</strong><span>Scrapes, AI enrichment, and Shopify activity will appear here.</span></div>}
              </div>
              <button className="notification-footer" onClick={() => { setShowNotifications(false); setActive("Overview"); }}>View activity overview</button>
            </aside>
          )}
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">LIVE COMMERCE OPERATIONS</div>
              <h1>{active === "Overview" ? `Welcome back, ${account?.user.name?.split(" ")[0] || "there"}.` : active}</h1>
              <p>{active === "Overview" ? "Here is what is happening across your catalog today." : "Everything here belongs to the current workspace."}</p>
            </div>
            <div className={`health-chip ${error ? "health-error" : ""}`}><i />{error || "Live data connected"}</div>
          </div>

          {loading ? (
            <div className="loading-state"><span className="spinner dark" /><p>Loading workspace data…</p></div>
          ) : active === "Overview" ? (
            <>
              <section className={`onboarding-strip ${savedSources.length ? "complete" : ""}`}>
                <div className="onboarding-icon">{savedSources.length ? <Check size={20} /> : <Globe2 size={20} />}</div>
                <div className="onboarding-copy">
                  <span className="kicker">{savedSources.length ? "SOURCE READY" : "START HERE · STEP 1 OF 4"}</span>
                  <h2>{savedSources.length ? `${savedSources[0].name} is ready to run.` : "Add your first product source."}</h2>
                  <p>{savedSources.length ? "Run it now or open Sources to manage collection settings." : "Paste an approved collection URL and choose its default SEO language. Scrappify handles the rest."}</p>
                </div>
                <button className="primary-button" onClick={savedSources.length ? openRunModal : openNewSource}>
                  {savedSources.length ? <><RefreshCw size={15} /> Run source</> : <><Plus size={15} /> Add source</>}
                </button>
                <div className="onboarding-steps" aria-label="Catalog workflow">
                  {["Source", "Collect", "Refine", "Publish"].map((step, index) => (
                    <span className={index === 0 && savedSources.length ? "done" : index === 0 ? "active" : ""} key={step}>
                      <i>{index === 0 && savedSources.length ? <Check size={11} /> : index + 1}</i>{step}
                    </span>
                  ))}
                </div>
              </section>
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
                  <span className="kicker">HYBRID AI ENGINE</span>
                  <h2>{data.services.groq ? "AI enrichment is ready." : "AI is not configured."}</h2>
                  <p>{data.services.groq ? "Generate factual Shopify copy in the language you choose for each run." : "Add the AI service secret to enable production enrichment."}</p>
                  <div className="ai-stats"><span><strong>{Math.max(0, data.summary.total_products - data.summary.ai_enriched)}</strong><small>Awaiting AI</small></span><span><strong>{data.summary.ai_enriched}</strong><small>Completed</small></span></div>
                  <button onClick={() => setActive("AI Studio")}>Open AI Studio <span>↗</span></button>
                </article>
              </section>

              <ProductTable products={visibleProducts.slice(0, 8)} selected={selected} setSelected={setSelected} openProduct={setDrawer} openBulkEdit={() => setShowBulkEdit(true)} runAi={runAi} syncShopify={syncShopify} shopifyReady={data.services.shopify} downloadCsv={downloadCsv} busyAction={busyAction} />
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
              aiStatusFilter={aiStatusFilter}
              setAiStatusFilter={setAiStatusFilter}
              openProduct={setDrawer}
              openBulkEdit={() => setShowBulkEdit(true)}
              runAi={runAi}
              syncShopify={syncShopify}
              shopifyReady={data.services.shopify}
              downloadCsv={downloadCsv}
              busyAction={busyAction}
              onNewJob={openRunModal}
              pagination={data.pagination}
              setPage={setProductPage}
              pageSize={pageSize}
              setPageSize={setPageSize}
              selectAllMatching={() => void selectAllMatching()}
            />
          ) : active === "AI Studio" ? (
            <section className="ai-studio-page">
              <div className="ai-studio-hero">
                <div>
                  <span className="kicker">AI CATALOG STUDIO</span>
                  <h2>Know exactly what is ready—and what needs attention.</h2>
                  <p>Filter the complete catalog by enrichment status, select a page or every matching product, then watch each description complete live.</p>
                </div>
                <div className="ai-hero-actions">
                  <button className="secondary-button" disabled={busyAction === "select" || busyAction === "ai" || !data.services.groq} onClick={() => void enrichAllRemaining()}><Sparkles size={14} /> Enrich all remaining</button>
                  <button className="primary-button" disabled={!selected.length || busyAction === "ai" || !data.services.groq} onClick={() => void runAi()}><Sparkles size={14} /> Enrich {selected.length || "selected"}</button>
                </div>
              </div>

              <div className="ai-status-grid">
                <button className={aiStatusFilter === "" ? "active" : ""} onClick={() => { setAiStatusFilter(""); setProductPage(1); }}><span className="ai-status-icon all"><Boxes size={17} /></span><span><small>ALL PRODUCTS</small><strong>{data.summary.total_products.toLocaleString()}</strong></span><i>100%</i></button>
                <button className={aiStatusFilter === "pending" ? "active" : ""} onClick={() => { setAiStatusFilter("pending"); setProductPage(1); }}><span className="ai-status-icon pending"><Timer size={17} /></span><span><small>PENDING</small><strong>{data.summary.ai_pending.toLocaleString()}</strong></span><i>Needs copy</i></button>
                <button className={aiStatusFilter === "enriched" ? "active" : ""} onClick={() => { setAiStatusFilter("enriched"); setProductPage(1); }}><span className="ai-status-icon enriched"><Sparkles size={17} /></span><span><small>ENRICHED</small><strong>{data.summary.ai_enriched.toLocaleString()}</strong></span><i>{aiCoverage}% ready</i></button>
                <button className={aiStatusFilter === "failed" ? "active" : ""} onClick={() => { setAiStatusFilter("failed"); setProductPage(1); }}><span className="ai-status-icon failed"><X size={17} /></span><span><small>FAILED</small><strong>{data.summary.ai_failed.toLocaleString()}</strong></span><i>Retryable</i></button>
              </div>

              <div className="ai-workbench">
                <article className="panel ai-control-panel">
                  <div className="ai-control-head"><span className="ai-control-icon"><Sparkles size={19} /></span><div><span className="kicker">ENRICHMENT SETTINGS</span><h3>Prepare selected products</h3></div></div>
                  <label className="language-picker">SEO description language
                    <select value={seoLanguage} onChange={(event) => setSeoLanguage(event.target.value)}>
                      {languages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                  </label>
                  <div className="ai-policy-list">
                    <span><Check size={13} /> Shopify-safe HTML</span>
                    <span><Check size={13} /> Factual product copy only</span>
                    <span><Check size={13} /> Source retailer removed</span>
                    <span><Check size={13} /> Search-friendly tags</span>
                  </div>
                  <div className="ai-selection-summary"><strong>{selected.length}</strong><span><b>products selected</b><small>{selected.length ? "Ready for enrichment" : "Choose products from the queue"}</small></span></div>
                  {aiProgress && (
                    <div className="ai-live-progress">
                      <div><span><Sparkles size={15} /> {aiProgress.status === "running" ? "Enrichment in progress" : "Enrichment run complete"}</span><strong>{aiProgress.completed}/{aiProgress.total}</strong></div>
                      <div className="progress-track"><i style={{ width: `${aiProgressPercent}%` }} /></div>
                      <p>{aiProgress.status === "running" ? `Writing: ${aiProgress.current}` : aiProgress.failed ? `${aiProgress.failed} products need attention` : "Every selected product is ready"}</p>
                      <button className="ai-view-tracker" onClick={() => setShowAiTracker(true)}>View detailed progress <Maximize2 size={12} /></button>
                    </div>
                  )}
                  <button className="primary-button wide" disabled={!selected.length || busyAction === "ai" || !data.services.groq} onClick={() => void runAi()}>
                    {busyAction === "ai" ? <><span className="spinner" /> Enriching {aiProgress?.completed || 0} of {aiProgress?.total || selected.length}</> : <><Sparkles size={15} /> Enrich {selected.length} in {languages.find(([code]) => code === seoLanguage)?.[1]}</>}
                  </button>
                  {data.summary.ai_failed > 0 && <button className="retry-failed-button" disabled={busyAction === "select"} onClick={() => void selectAllMatching("failed")}><RefreshCw size={14} /> Select all {data.summary.ai_failed} failed products to retry</button>}
                </article>

                <article className="panel ai-queue-panel">
                  <div className="ai-queue-head">
                    <div><span className="kicker">PRODUCT QUEUE</span><h3>{aiStatusFilter ? `${aiStatusFilter[0].toUpperCase()}${aiStatusFilter.slice(1)} products` : "All enrichment statuses"}</h3></div>
                    <span>{data.pagination.total.toLocaleString()} products</span>
                  </div>
                  <div className="ai-queue-toolbar">
                    <label><input type="checkbox" checked={data.products.length > 0 && data.products.every((product) => selected.includes(product.id))} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, ...data.products.map((product) => product.id)])] : current.filter((id) => !data.products.some((product) => product.id === id)))} /> Select page</label>
                    <button disabled={busyAction === "select"} onClick={() => void selectAllMatching()}>{busyAction === "select" ? "Selecting…" : `Select all ${data.pagination.total.toLocaleString()}`}</button>
                    {selected.length > 0 && <button onClick={() => setSelected([])}>Clear</button>}
                  </div>
                  <div className="ai-product-queue">
                    {data.products.map((product) => (
                      <button className={selected.includes(product.id) ? "selected" : ""} key={product.id} onClick={() => setSelected((current) => current.includes(product.id) ? current.filter((id) => id !== product.id) : [...current, product.id])}>
                        <span className="queue-check">{selected.includes(product.id) && <Check size={12} />}</span>
                        <ProductThumb product={product} />
                        <span className="queue-product-copy"><strong>{product.title}</strong><small>{product.vendor || "Unknown vendor"} · {product.category || "Uncategorized"}</small>{product.ai_status === "failed" && product.ai_error && <em>{product.ai_error}</em>}</span>
                        <span className={`status-badge ${product.ai_status}`}>{product.ai_status === "enriched" && <Sparkles size={10} />}{product.ai_status}</span>
                      </button>
                    ))}
                    {!data.products.length && <EmptyState title={`No ${aiStatusFilter || "matching"} products`} detail={aiStatusFilter === "failed" ? "No AI failures need attention." : "Change the status filter or collect more products."} />}
                  </div>
                  <div className="ai-queue-pagination">
                    <span>Page {data.pagination.page} of {data.pagination.total_pages}</span>
                    <div><button disabled={data.pagination.page <= 1} onClick={() => setProductPage(data.pagination.page - 1)}>Previous</button><button disabled={data.pagination.page >= data.pagination.total_pages} onClick={() => setProductPage(data.pagination.page + 1)}>Next</button></div>
                  </div>
                </article>
              </div>
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
                <div className="source-actions"><button className="secondary-button" onClick={openNewSource}><Plus size={15} /> Add source</button><button className="primary-button" onClick={openRunModal}><RefreshCw size={15} /> Run source</button></div>
              </article>
              <div className="saved-source-grid">
                {savedSources.map((source) => (
                  <SourceCard
                    key={source.id}
                    source={source}
                    onRun={() => { setSelectedSourceId(source.id); setSeoLanguage(source.seo_language); setShowNewJob(true); }}
                    onEdit={() => openSourceEditor(source)}
                    onDelete={() => void deleteSource(source.id)}
                  />
                ))}
                {!savedSources.length && <article className="panel"><EmptyState title="No saved sources yet" detail="Save a real category URL to reuse its scrape and language settings." action="Save first source" onAction={openNewSource} /></article>}
              </div>
              <article className="panel source-intro jobs-heading"><div><span className="kicker">BACKGROUND QUEUE</span><h2>Scrape jobs</h2><p>The browser worker claims queued jobs and updates progress here.</p></div></article>
              <div className="jobs-list">
                {data.jobs.map((job) => <JobCard key={job.id} job={job} onCancel={cancelJob} />)}
                {!data.jobs.length && <article className="panel"><EmptyState title="No real jobs yet" detail="Queue a Beymen or Zaptila category URL. No sample jobs will be inserted." action="Queue first scrape" onAction={() => setShowNewJob(true)} /></article>}
              </div>
            </section>
          ) : (
            <section className="settings-page">
              <div className="settings-hero panel">
                <div className="settings-hero-icon"><Settings size={22} /></div>
                <div><span className="kicker">ORGANIZATION CONTROL CENTER</span><h2>Settings that scale with your operation.</h2><p>Manage business identity, workspace boundaries, production services, and publishing connections.</p></div>
                <span className="settings-role"><CheckCircle2 size={14} /> {account?.workspace.role || "member"} access</span>
              </div>

              <div className="settings-section-head"><div><span className="kicker">BUSINESS STRUCTURE</span><h3>Organization & workspace</h3></div><p>Names can be changed without affecting saved products, source history, or integrations.</p></div>
              <div className="settings-profile-grid">
                <form key={`org-${account?.organization.name || "loading"}`} className="panel profile-setting-card" onSubmit={(event) => void saveAccountSetting(event, "organization")}>
                  <div className="setting-card-title"><span className="setting-card-icon"><Users size={18} /></span><div><h4>Organization profile</h4><p>The company or account that owns your workspaces.</p></div></div>
                  <label>Organization name<input name="name" defaultValue={account?.organization.name || ""} required minLength={2} /></label>
                  <div className="setting-meta"><span><small>ORGANIZATION ID</small><strong>{account?.organization.slug}</strong></span><span><small>YOUR ACCESS</small><strong>Owner / admin</strong></span></div>
                  <button className="secondary-button" disabled={busyAction === "settings-organization"}>{busyAction === "settings-organization" ? "Saving…" : "Save organization"}</button>
                </form>
                <form key={`workspace-${account?.workspace.name || "loading"}`} className="panel profile-setting-card" onSubmit={(event) => void saveAccountSetting(event, "workspace")}>
                  <div className="setting-card-title"><span className="setting-card-icon workspace"><Boxes size={18} /></span><div><h4>Current workspace</h4><p>The isolated catalog operation you are working in.</p></div></div>
                  <label>Workspace name<input name="name" defaultValue={account?.workspace.name || ""} required minLength={2} /></label>
                  <div className="setting-meta"><span><small>WORKSPACE ID</small><strong>{account?.workspace.slug}</strong></span><span><small>CATALOG</small><strong>{data.summary.total_products.toLocaleString()} products</strong></span></div>
                  <div className="setting-card-actions"><button className="secondary-button" disabled={busyAction === "settings-workspace"}>{busyAction === "settings-workspace" ? "Saving…" : "Save workspace"}</button><button type="button" onClick={() => setShowWorkspace(true)}>Switch workspace</button></div>
                </form>
              </div>

              <div className="settings-section-head"><div><span className="kicker">PRODUCTION SERVICES</span><h3>Connections & readiness</h3></div><p>Each workspace keeps its own Shopify connection while core services remain available across the account.</p></div>
              <div className="service-settings-grid">
                <ServiceCard name="Catalog database" configured={data.services.database} detail="Products, jobs, source recipes, and activity history are persistent." />
                <ServiceCard name="AI enrichment" configured={data.services.groq} detail="Fast cloud generation with automatic private-model fallback in eight languages." />
                <article className="panel settings-card shopify-setting-card">
                  <span className="setting-service-icon"><ShoppingBag size={18} /></span>
                  <span className="kicker">WORKSPACE INTEGRATION</span>
                  <h2>Shopify Admin API</h2>
                  <p>{shopifyConnection.configured ? `${shopifyConnection.store_domain} is connected only to this workspace.` : "Connect a store domain and custom-app access token for this workspace."}</p>
                  <div className="setting-row"><span><i className={shopifyConnection.configured ? "" : "offline"} />{shopifyConnection.configured ? "Connected" : "Not configured"}</span><button onClick={() => setShowShopify(true)}>{shopifyConnection.configured ? "Manage connection" : "Connect Shopify"}</button></div>
                </article>
              </div>

              <div className="settings-section-head"><div><span className="kicker">ACCOUNT & SECURITY</span><h3>Your session</h3></div></div>
              <article className="panel account-security-row">
                <span className="account-security-avatar">{account?.user.name.slice(0, 1).toUpperCase() || "A"}</span>
                <span><strong>{account?.user.name}</strong><small>{account?.user.email}</small></span>
                <span className="security-chip"><CheckCircle2 size={13} /> Authenticated</span>
                <button onClick={() => void authClient.signOut({ fetchOptions: { onSuccess: () => window.location.assign("/") } })}>Sign out</button>
              </article>
            </section>
          )}
        </div>
      </section>

      {trackedJob && showTrackerDock && (
        <aside className={`live-tracker-dock ${trackedJob.status}`}>
          <button className="tracker-main" onClick={() => setShowLiveTracker(true)}>
            <span className="tracker-pulse"><Timer size={17} /></span>
            <span className="tracker-copy">
              <span><strong>{trackedJob.status === "queued" ? "Waiting for worker" : trackedJob.status === "running" ? "Collecting live products" : trackedJob.status === "completed" ? "Collection complete" : "Collection stopped"}</strong><b>{trackedJob.progress}%</b></span>
              <span className="tracker-bar"><i style={{ width: `${trackedJob.progress}%` }} /></span>
              <small>{latestTrackedLog?.message || `${trackedJob.category_name} · ${trackedJob.source}`}</small>
              <span className="tracker-mini-meta"><i>{trackedJob.products_found} products</i><i>{trackedJob.pages_completed}/{trackedJob.max_pages} pages</i><i>{trackedJob.warning_count} warnings</i></span>
            </span>
          </button>
          <button className="tracker-expand" aria-label="Open live scrape tracker" onClick={() => setShowLiveTracker(true)}><Maximize2 size={16} /></button>
          <button className="tracker-close" aria-label="Hide live scrape tracker" onClick={() => setShowTrackerDock(false)}><X size={15} /></button>
        </aside>
      )}

      {trackedJob && showLiveTracker && (
        <div className="drawer-backdrop centered tracker-backdrop" onClick={() => setShowLiveTracker(false)}>
          <section className="live-tracker-modal" onClick={(event) => event.stopPropagation()}>
            <button className="drawer-close" aria-label="Minimize live tracker" onClick={() => setShowLiveTracker(false)}><X size={18} /></button>
            <div className="tracker-modal-head">
              <span className={`tracker-status-icon ${trackedJob.status}`}><Timer size={21} /></span>
              <div><span className="kicker">LIVE COLLECTION TRACKER</span><h2>{trackedJob.category_name}</h2><p>{trackedJob.source} · Started {formatDate(trackedJob.started_at || trackedJob.created_at)}</p></div>
              <span className={`status-badge ${trackedJob.status}`}>{trackedJob.status}</span>
            </div>
            <div className="tracker-progress-hero">
              <div><strong>{trackedJob.progress}%</strong><span>{trackedJob.status === "queued" ? "Waiting for an available worker" : trackedJob.status === "running" ? "Your worker is collecting products now" : trackedJob.status === "completed" ? "Collection completed successfully" : "Collection is no longer running"}</span></div>
              <div className="progress-track"><i style={{ width: `${trackedJob.progress}%` }} /></div>
            </div>
            <div className="tracker-metrics">
              <span><small>PRODUCTS FOUND</small><strong>{trackedJob.products_found}</strong></span>
              <span><small>PAGES COMPLETE</small><strong>{trackedJob.pages_completed}<i> / {trackedJob.max_pages}</i></strong></span>
              <span><small>WARNINGS</small><strong>{trackedJob.warning_count}</strong></span>
              <span><small>ELAPSED</small><strong>{trackedJob.completed_at ? "Done" : "Live"}</strong></span>
            </div>
            <div className="tracker-activity">
              <div className="tracker-activity-head"><span>Worker activity</span><i>{trackedJob.status === "running" ? "Updating automatically" : "Final activity"}</i></div>
              <div className="tracker-log-list">
                {(trackedJob.logs || []).slice(-8).reverse().map((log, index) => (
                  <div className={log.level} key={`${log.at}-${index}`}>
                    <i />
                    <span><strong>{log.message}</strong><small>{formatDate(log.at)}</small></span>
                  </div>
                ))}
                {!trackedJob.logs?.length && <div className="empty-log"><span className="spinner dark" /> Waiting for the first worker update…</div>}
              </div>
            </div>
            <div className="tracker-source-url"><Globe2 size={15} /><span><small>SOURCE URL</small><strong>{trackedJob.category_url}</strong></span></div>
            <div className="tracker-modal-actions">
              {(trackedJob.status === "queued" || trackedJob.status === "running") && <button className="danger-button" onClick={() => void cancelJob(trackedJob.id)}>Cancel collection</button>}
              <button className="secondary-button" onClick={() => setShowLiveTracker(false)}>Minimize tracker</button>
              {trackedJob.status === "completed" && <button className="primary-button" onClick={() => { setShowLiveTracker(false); setActive("Products"); }}>Review products</button>}
            </div>
          </section>
        </div>
      )}

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
        <div className="drawer-backdrop centered" onClick={() => { setShowSource(false); setEditingSource(null); }}>
          <form key={editingSource?.id || "new-source"} className="job-modal source-editor-modal" onSubmit={saveSource} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="drawer-close" onClick={() => { setShowSource(false); setEditingSource(null); }}><X size={18} /></button>
            <div className="modal-icon source"><Globe2 size={21} /></div>
            <span className="kicker">{editingSource ? "SOURCE SETTINGS" : "NEW SAVED SOURCE"}</span>
            <h2>{editingSource ? "Edit collection source" : "Create a reusable source"}</h2>
            <p>{editingSource ? "Update the source URL, collection range, and enrichment defaults used on future runs." : `Save the collection recipe inside ${account?.workspace.name || "this workspace"}, then run it whenever you need fresh data.`}</p>
            <div className="source-form-section">
              <span>Source identity</span>
              <label>Source label<input name="name" required defaultValue={editingSource?.name || ""} placeholder="Beymen — Women's Shoes" /></label>
              <label>Category name<input name="category_name" required defaultValue={editingSource?.category_name || ""} placeholder="Women's shoes" /></label>
              <label>Category URL<input name="category_url" type="url" required defaultValue={editingSource?.category_url || ""} placeholder="https://www.beymen.com/tr/..." /></label>
            </div>
            <div className="source-form-section compact">
              <span>Collection defaults</span>
              <div className="job-form-row"><label>Start page<input name="start_page" type="number" min="1" defaultValue={editingSource?.start_page || 1} /></label><label>Pages per run<input name="max_pages" type="number" min="1" max="100" defaultValue={editingSource?.max_pages || 1} /></label></div>
              <label>Default SEO language<select name="seo_language" defaultValue={editingSource?.seo_language || seoLanguage}>{languages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
            </div>
            <div className="source-toggle-list">
              <label><span><strong>Automatic AI enrichment</strong><small>Generate SEO descriptions after every collection</small></span><input name="auto_enrich" type="checkbox" defaultChecked={editingSource?.auto_enrich || false} /></label>
              <label><span><strong>Source active</strong><small>Allow this source to be selected for new runs</small></span><input name="enabled" type="checkbox" defaultChecked={editingSource?.enabled ?? true} /></label>
            </div>
            <button className="primary-button wide" disabled={busyAction === "source"}>{busyAction === "source" ? "Saving changes…" : editingSource ? "Save source changes" : "Save and continue"}</button>
          </form>
        </div>
      )}

      {showWorkspace && (
        <div className="drawer-backdrop centered" onClick={() => setShowWorkspace(false)}>
          <section className="account-modal-v2" onClick={(event) => event.stopPropagation()}>
            <button type="button" className="drawer-close" onClick={() => setShowWorkspace(false)}><X size={18} /></button>
            <div className="account-modal-header">
              <span className="account-large-avatar">{account?.user.name.slice(0, 1).toUpperCase() || "A"}</span>
              <div><span className="kicker">ACCOUNT & WORKSPACES</span><h2>{account?.user.name}</h2><p>{account?.user.email}</p></div>
              <button onClick={() => { setShowWorkspace(false); setActive("Settings"); }}><Settings size={14} /> Account settings</button>
            </div>
            <div className="account-modal-content">
              <div className="workspace-browser">
                <div className="workspace-browser-head"><div><h3>Your workspaces</h3><p>Switch between independent catalog operations.</p></div><span>{account?.workspaces.length || 0} total</span></div>
                <div className="workspace-list">
                  {account?.workspaces.map((workspace) => (
                    <button type="button" key={workspace.id} className={workspace.id === account.workspace.id ? "current" : ""} onClick={() => void switchWorkspace(workspace.id)}>
                      <span className="workspace-list-avatar">{workspace.name.slice(0, 2).toUpperCase()}</span>
                      <span><strong>{workspace.name}</strong><small>{workspace.organization_name} · {workspace.role}</small></span>
                      <i>{workspace.id === account.workspace.id ? <><Check size={11} /> Current</> : "Open"}</i>
                    </button>
                  ))}
                </div>
              </div>
              <form className="workspace-create-card" onSubmit={createWorkspace}>
                <span className="workspace-create-icon"><Plus size={18} /></span>
                <div><span className="kicker">CREATE NEW</span><h3>Expand your operation</h3><p>Add a workspace for another catalog, or start a separate organization.</p></div>
                <label>What are you creating?<select name="type" defaultValue="workspace"><option value="workspace">Workspace in current organization</option><option value="organization">New organization with a workspace</option></select></label>
                <label>Name<input name="name" required placeholder="e.g. European catalog" /></label>
                <button className="primary-button wide" disabled={busyAction === "workspace-create"}>{busyAction === "workspace-create" ? "Creating…" : <><Plus size={14} /> Create workspace</>}</button>
              </form>
            </div>
            <div className="account-modal-footer"><span><CheckCircle2 size={14} /> Products and sources stay isolated by workspace</span><button onClick={() => void authClient.signOut({ fetchOptions: { onSuccess: () => window.location.assign("/") } })}>Sign out</button></div>
          </section>
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

      {showBulkEdit && (
        <div className="drawer-backdrop centered" onClick={() => setShowBulkEdit(false)}>
          <form className="job-modal bulk-modal" onSubmit={bulkEdit} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="drawer-close" aria-label="Close bulk editor" onClick={() => setShowBulkEdit(false)}><X size={18} /></button>
            <span className="kicker">BULK EDIT · {selected.length} PRODUCTS</span>
            <h2>Update selected products</h2>
            <p>Only fields you complete below will be changed. Existing values in every other field stay untouched.</p>
            <div className="bulk-form-grid">
              <label>Vendor<input name="vendor" placeholder="Leave unchanged" /></label>
              <label>Category<input name="category" placeholder="Leave unchanged" /></label>
              <label>Inventory quantity<input name="inventory_qty" type="number" min="0" placeholder="Leave unchanged" /></label>
              <label>Publishing status
                <select name="published" defaultValue="">
                  <option value="">Leave unchanged</option>
                  <option value="true">Include in export</option>
                  <option value="false">Keep as draft</option>
                </select>
              </label>
              <label className="full">Replace tags<input name="tags" placeholder="premium, fragrance, unisex" /></label>
            </div>
            <div className="bulk-summary"><Boxes size={18} /><span><strong>{selected.length} products</strong><small>Updates remain inside {account?.workspace.name || "this workspace"}</small></span></div>
            <button className="primary-button wide" disabled={busyAction === "bulk"}>{busyAction === "bulk" ? "Updating products…" : `Apply to ${selected.length} products`}</button>
          </form>
        </div>
      )}

      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(null)}>
          <form className="product-drawer" onSubmit={saveProduct} onClick={(event) => event.stopPropagation()}>
            <button type="button" className="drawer-close" aria-label="Close product editor" onClick={() => setDrawer(null)}><X size={18} /></button>
            <div className="drawer-product-art"><SafeProductImage src={drawer.image_url} alt={drawer.title} fallback={drawer.vendor.slice(0, 1) || "P"} /></div>
            <span className="kicker">WORKSPACE PRODUCT</span><h2>{drawer.title}</h2><p>{drawer.source} · Updated {formatDate(drawer.updated_at)}</p>
            <div className="drawer-fields">
              <label className="full">Shopify title<input name="title" defaultValue={drawer.title} /></label>
              <label>Vendor<input name="vendor" defaultValue={drawer.vendor} /></label>
              <label>Category<input name="category" defaultValue={drawer.category} /></label>
              <label>Price<input name="sale_price" type="number" step=".01" defaultValue={drawer.sale_price ?? ""} /></label>
              <label>Compare at<input name="compare_at_price" type="number" step=".01" defaultValue={drawer.compare_at_price ?? ""} /></label>
              <label>Inventory<input name="inventory_qty" type="number" min="0" defaultValue={drawer.inventory_qty} /></label>
              <label className="check-row"><input name="published" type="checkbox" defaultChecked={drawer.published} /> Publish in export</label>
              <label className="full drawer-description-field">
                <span className="drawer-field-head">
                  <span>SEO description</span>
                  <span className="drawer-ai-controls">
                    <select aria-label="AI description language" value={seoLanguage} onChange={(event) => setSeoLanguage(event.target.value)}>
                      {languages.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                    <button type="button" disabled={busyAction === "ai" || !data.services.groq} onClick={() => void writeDrawerWithAi()}>
                      {busyAction === "ai" ? <><span className="spinner dark" /> Writing</> : <><Sparkles size={13} /> Write with AI</>}
                    </button>
                  </span>
                </span>
                <textarea key={`${drawer.id}-${drawer.updated_at}`} name="body_html" defaultValue={drawer.body_html} />
              </label>
            </div>
            <button className="primary-button wide" disabled={busyAction === "save"}>{busyAction === "save" ? "Saving…" : "Save product"}</button>
          </form>
        </div>
      )}
      {aiProgress && showAiTrackerDock && (
        <aside className={`ai-progress-dock ${aiProgress.status}`}>
          <button className="ai-tracker-main" onClick={() => setShowAiTracker(true)}>
            <span className="ai-dock-icon">{aiProgress.status === "running" ? <Sparkles size={18} /> : aiProgress.failed ? <RefreshCw size={18} /> : <Check size={18} />}</span>
            <span className="ai-dock-copy">
              <span><strong>{aiProgress.status === "running" ? "Enriching products" : aiProgress.failed ? "Run finished with retries" : "Enrichment complete"}</strong><b>{aiProgressPercent}%</b></span>
              <span className="tracker-bar"><i style={{ width: `${aiProgressPercent}%` }} /></span>
              <small>{aiProgress.status === "running" ? aiProgress.current : aiProgress.failed ? `${aiProgress.failed} products need attention` : "Every queued product is ready"}</small>
              <span className="tracker-mini-meta"><i>{aiProgress.succeeded} enriched</i><i>{aiRemaining} remaining</i><i>{aiProgress.failed} failed</i></span>
            </span>
          </button>
          <button className="tracker-expand" aria-label="Open AI progress tracker" onClick={() => setShowAiTracker(true)}><Maximize2 size={16} /></button>
          <button className="tracker-close" aria-label="Hide AI progress tracker" onClick={() => setShowAiTrackerDock(false)}><X size={15} /></button>
        </aside>
      )}
      {aiProgress && showAiTracker && (
        <div className="drawer-backdrop centered tracker-backdrop" onClick={() => setShowAiTracker(false)}>
          <section className="live-tracker-modal ai-tracker-modal" onClick={(event) => event.stopPropagation()}>
            <button className="drawer-close" aria-label="Minimize AI tracker" onClick={() => setShowAiTracker(false)}><X size={18} /></button>
            <div className="tracker-modal-head">
              <span className={`tracker-status-icon ai ${aiProgress.status}`}><Sparkles size={21} /></span>
              <div><span className="kicker">LIVE AI ENRICHMENT</span><h2>{aiProgress.status === "running" ? "Your catalog is being written" : "Enrichment run summary"}</h2><p>Started {formatDate(new Date(aiProgress.startedAt).toISOString())} · Auto-retry enabled</p></div>
              <span className={`status-badge ${aiProgress.status === "completed" ? "enriched" : aiProgress.status === "running" ? "running" : aiProgress.status === "cancelled" ? "cancelled" : "failed"}`}>{aiProgress.status.replaceAll("_", " ")}</span>
            </div>
            <div className="tracker-progress-hero ai">
              <div><strong>{aiProgressPercent}%</strong><span>{aiProgress.status === "running" ? `Writing ${aiProgress.current}${aiProgress.attempt > 1 ? ` · attempt ${aiProgress.attempt} of 3` : ""}` : aiProgress.failed ? "Finished; failed items remain clearly marked for another run" : "Every queued product has a finished SEO description"}</span></div>
              <div className="progress-track"><i style={{ width: `${aiProgressPercent}%` }} /></div>
            </div>
            <div className="tracker-metrics">
              <span><small>TOTAL QUEUED</small><strong>{aiProgress.total}</strong></span>
              <span><small>ENRICHED</small><strong>{aiProgress.succeeded}</strong></span>
              <span><small>REMAINING</small><strong>{aiRemaining}</strong></span>
              <span><small>FAILED</small><strong>{aiProgress.failed}</strong></span>
            </div>
            <div className="tracker-activity">
              <div className="tracker-activity-head"><span>Enrichment activity</span><i>{aiProgress.status === "running" ? "Live updates · automatic retries" : "Final run history"}</i></div>
              <div className="tracker-log-list ai-log-list">
                {aiProgress.logs.map((log) => (
                  <div className={log.status} key={log.id}>
                    <i />
                    <span><strong>{log.title}</strong><small>{log.message} · {formatDate(log.at)}</small></span>
                    <em>{log.status}</em>
                  </div>
                ))}
                {!aiProgress.logs.length && <div className="empty-log"><span className="spinner dark" /> Preparing the first product…</div>}
              </div>
            </div>
            <div className="ai-tracker-assurance"><CheckCircle2 size={16} /><span><strong>Safe continuous processing</strong><small>Scrappify continues through the entire queue and automatically retries temporary AI failures up to three times.</small></span></div>
            <div className="tracker-modal-actions">
              {aiProgress.status === "running" && <button className="danger-button" onClick={() => { aiCancelRequested.current = true; notify("AI will stop safely after the current request"); }}>Stop after current product</button>}
              <button className="secondary-button" onClick={() => setShowAiTracker(false)}>Minimize tracker</button>
              {aiProgress.status !== "running" && <button className="primary-button" onClick={() => { setShowAiTracker(false); setShowAiTrackerDock(false); }}>Done</button>}
            </div>
          </section>
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
  return <span className="product-thumb image"><SafeProductImage src={product.image_url} alt={product.title} fallback={product.vendor.slice(0, 1) || "P"} /></span>;
}

function SafeProductImage({ src, alt, fallback }: { src: string; alt: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return <span className="product-image-fallback" aria-label={`${alt} image unavailable`}>{fallback}</span>;
  }
  return <img src={src} alt={alt} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}

type TableProps = {
  products: Product[];
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  openProduct: (product: Product) => void;
  openBulkEdit: () => void;
  runAi: () => void;
  syncShopify: () => void;
  shopifyReady: boolean;
  downloadCsv: () => void;
  busyAction: string;
  pagination?: DashboardData["pagination"];
  setPage?: (page: number) => void;
  pageSize?: number;
  setPageSize?: (size: number) => void;
  selectAllMatching?: () => void;
};

function ProductTable({ products, selected, setSelected, openProduct, openBulkEdit, runAi, syncShopify, shopifyReady, downloadCsv, busyAction, pagination, setPage, pageSize, setPageSize, selectAllMatching }: TableProps) {
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const allVisibleSelected = products.length > 0 && products.every((product) => selected.includes(product.id));
  const pageNumbers = pagination
    ? Array.from({ length: pagination.total_pages }, (_, index) => index + 1)
      .filter((page) => page === 1 || page === pagination.total_pages || Math.abs(page - pagination.page) <= 2)
    : [];
  return (
    <section className="panel products-panel">
      <div className="panel-heading product-heading">
        <div><span className="kicker">LIVE CATALOG</span><h2>Products</h2></div>
        <div className="table-actions">
          {selected.length > 0 && <span className="selected-pill">{selected.length} selected</span>}
          <button disabled={!selected.length || busyAction === "bulk"} onClick={openBulkEdit}><PencilLine size={14} /> Bulk edit</button>
          <button disabled={!selected.length || busyAction === "ai"} onClick={runAi}><Sparkles size={14} /> Enrich</button>
          <button disabled={!selected.length || !shopifyReady || busyAction === "shopify"} onClick={syncShopify}><ShoppingBag size={14} /> Shopify</button>
          <button className="export-button" onClick={downloadCsv}><Download size={14} /> Export</button>
        </div>
      </div>
      {pagination && allVisibleSelected && pagination.total > products.length && (
        <div className="selection-scope-banner">
          <CheckCircle2 size={15} />
          <span>{selected.length >= pagination.total ? `All ${pagination.total.toLocaleString()} matching products are selected.` : `All ${products.length} products on this page are selected.`}</span>
          {selected.length < pagination.total && <button disabled={busyAction === "select"} onClick={selectAllMatching}>{busyAction === "select" ? "Selecting…" : `Select all ${pagination.total.toLocaleString()} matching products`}</button>}
          {selected.length >= pagination.total && <button onClick={() => setSelected([])}>Clear selection</button>}
        </div>
      )}
      {products.length ? (
        <>
          <div className="table-wrap"><table><thead><tr><th><input aria-label="Select all products on this page" type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelected((current) => event.target.checked ? [...new Set([...current, ...products.map((product) => product.id)])] : current.filter((id) => !products.some((product) => product.id === id)))} /></th><th>PRODUCT</th><th>SOURCE</th><th>PRICE</th><th>STOCK</th><th>AI STATUS</th><th>SHOPIFY</th><th /></tr></thead><tbody>
            {products.map((product) => <tr key={product.id}>
              <td><input aria-label={`Select ${product.title}`} type="checkbox" checked={selected.includes(product.id)} onChange={() => toggle(product.id)} /></td>
              <td><button className="product-cell" onClick={() => openProduct(product)}><ProductThumb product={product} /><span><strong>{product.title}</strong><small>{product.vendor || "Unknown vendor"}</small></span></button></td>
              <td><span className="source-badge"><i />{product.source}</span></td>
              <td><strong>{formatTry(product.sale_price)}</strong>{product.compare_at_price && <small className="compare">{formatTry(product.compare_at_price)}</small>}</td>
              <td><span>{product.inventory_qty} units</span></td>
              <td><span className={`status-badge ${product.ai_status}`}>{product.ai_status === "enriched" ? "✦ " : ""}{product.ai_status}</span></td>
              <td><span className="shopify-state"><i />{product.shopify_status.replace("_", " ")}</span></td>
              <td><button className="row-menu" aria-label={`Edit ${product.title}`} onClick={() => openProduct(product)}><MoreHorizontal size={17} /></button></td>
            </tr>)}
          </tbody></table></div>
          <div className="table-footer">
            <span>{pagination ? `Showing ${(pagination.page - 1) * pagination.page_size + 1}–${Math.min(pagination.page * pagination.page_size, pagination.total)} of ${pagination.total.toLocaleString()} products` : `Showing ${products.length} live products`}</span>
            {pagination && setPage && setPageSize && (
              <div className="pagination-controls">
                <label>Rows<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage?.(1); }}><option value="20">20</option><option value="50">50</option><option value="100">100</option></select></label>
                <button disabled={pagination.page <= 1} onClick={() => setPage(pagination.page - 1)}>Previous</button>
                <span className="page-numbers">
                  {pageNumbers.map((page, index) => (
                    <span key={page}>
                      {index > 0 && pageNumbers[index - 1] !== page - 1 && <i>…</i>}
                      <button className={page === pagination.page ? "current" : ""} onClick={() => setPage(page)}>{page}</button>
                    </span>
                  ))}
                </span>
                <button disabled={pagination.page >= pagination.total_pages} onClick={() => setPage(pagination.page + 1)}>Next</button>
              </div>
            )}
          </div>
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
  aiStatusFilter: string;
  setAiStatusFilter: (value: string) => void;
  onNewJob: () => void;
}) {
  return <section className="product-workspace">
    <div className="filters standalone"><label className="search"><Search size={16} /><input aria-label="Search live products" placeholder="Search products…" value={props.query} onChange={(event) => { props.setQuery(event.target.value); props.setPage?.(1); }} /></label><select aria-label="Filter by real source" value={props.sourceFilter} onChange={(event) => { props.setSourceFilter(event.target.value); props.setPage?.(1); }}><option value="">All sources</option>{props.sources.map((source) => <option key={source}>{source}</option>)}</select><select aria-label="Filter by AI status" value={props.aiStatusFilter} onChange={(event) => { props.setAiStatusFilter(event.target.value); props.setPage?.(1); }}><option value="">All AI statuses</option><option value="pending">Pending AI</option><option value="enriched">Enriched</option><option value="failed">Failed</option><option value="skipped">Skipped</option></select><button className="filter-button" onClick={props.onNewJob}><Plus size={15} /> Run source</button></div>
    <ProductTable {...props} />
  </section>;
}

function EmptyState({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><div className="empty-mark"><i /><i /><i /></div><h3>{title}</h3><p>{detail}</p>{action && <button onClick={onAction}>{action}</button>}</div>;
}

function JobCard({ job, onCancel }: { job: Job; onCancel: (id: string) => void }) {
  return <article className="panel job-card"><div className="job-card-head"><span className={`status-badge ${job.status}`}>{job.status}</span><small>{formatDate(job.created_at)}</small></div><h3>{job.category_name}</h3><p>{job.category_url}</p><div className="progress-track"><i style={{ width: `${job.progress}%` }} /></div><div className="job-stats"><span><b>{job.products_found}</b> products</span><span><b>{job.pages_completed}/{job.max_pages}</b> pages</span><span><b>{job.warning_count}</b> warnings</span></div>{job.error && <div className="job-error">{job.error}</div>}{(job.status === "queued" || job.status === "running") && <button onClick={() => onCancel(job.id)}>Cancel job</button>}</article>;
}

function SourceCard({ source, onRun, onEdit, onDelete }: { source: SavedSource; onRun: () => void; onEdit: () => void; onDelete: () => void }) {
  const language = languages.find(([code]) => code === source.seo_language)?.[1] ?? source.seo_language;
  return (
    <article className="panel saved-source-card">
      <div className="source-card-top"><span className="source-logo">{source.source_host.slice(0, 1).toUpperCase()}</span><span><strong>{source.name}</strong><small>{source.source_host}</small></span><i>{source.enabled ? "Active" : "Paused"}</i></div>
      <h3>{source.category_name}</h3>
      <p>{source.category_url}</p>
      <div className="source-details"><span><small>PAGES</small><strong>{source.start_page}–{source.start_page + source.max_pages - 1}</strong></span><span><small>SEO LANGUAGE</small><strong>{language}</strong></span><span><small>AI</small><strong>{source.auto_enrich ? "Automatic" : "Manual"}</strong></span></div>
      <div className="source-card-actions"><button className="run-source-button" onClick={onRun}><RefreshCw size={13} /> Run source</button><button onClick={onEdit}><PencilLine size={13} /> Edit</button><button className="danger-link" onClick={onDelete}>Remove</button></div>
    </article>
  );
}

function ServiceCard({ name, configured, detail }: { name: string; configured: boolean; detail: string }) {
  return <article className="panel settings-card"><span className="setting-service-icon">{name.includes("AI") ? <Sparkles size={18} /> : <Boxes size={18} />}</span><span className="kicker">PRODUCTION SERVICE</span><h2>{name}</h2><p>{detail}</p><div className="setting-row"><span><i className={configured ? "" : "offline"} />{configured ? "Operational" : "Not configured"}</span></div></article>;
}

import { db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace, safeSlug } from "@/app/lib/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const manager = (role: string) => ["owner", "admin"].includes(role);
const nextRun = (schedule: string) => schedule === "hourly" ? "1 hour" : schedule === "weekly" ? "7 days" : "1 day";

async function applyChange(sql: ReturnType<typeof db>, workspaceId: string, change: Record<string, unknown>) {
  const id = String(change.product_id);
  const value = change.new_value;
  const field = String(change.field);
  if (field === "title") await sql`UPDATE products SET title = ${String(value || "")}, updated_at = now() WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid`;
  else if (field === "vendor") await sql`UPDATE products SET vendor = ${String(value || "")}, updated_at = now() WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid`;
  else if (field === "category") await sql`UPDATE products SET category = ${String(value || "")}, updated_at = now() WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid`;
  else if (field === "sale_price") await sql`UPDATE products SET sale_price = ${Number(value || 0)}, updated_at = now() WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid`;
  else if (field === "compare_at_price") await sql`UPDATE products SET compare_at_price = ${value == null ? null : Number(value)}, updated_at = now() WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid`;
  else if (field === "image_url") await sql`UPDATE products SET image_url = ${String(value || "")}, updated_at = now() WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid`;
  else if (field === "inventory_qty") await sql`UPDATE products SET inventory_qty = ${Number(value || 0)}, updated_at = now() WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid`;
  else if (field === "variants") await sql`UPDATE products SET variants = ${JSON.stringify(value || [])}::jsonb, updated_at = now() WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid`;
}

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const sql = db();
    const workspaceId = auth.context.workspace.id;
    const [
      quality, duplicateTitles, changes, recipes, approvals, translations, members,
      invitations, adapters, profile, comments, runs, analytics, templates,
    ] = await Promise.all([
      sql`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE image_url = '')::int AS missing_image,
        count(*) FILTER (WHERE body_html = '')::int AS missing_description,
        count(*) FILTER (WHERE sale_price IS NULL OR sale_price <= 0)::int AS invalid_price,
        count(*) FILTER (WHERE category = '')::int AS missing_category,
        count(*) FILTER (WHERE jsonb_array_length(COALESCE(variants, '[]'::jsonb)) = 0)::int AS missing_variants,
        count(*) FILTER (WHERE price_warning IS NOT NULL)::int AS suspicious_price,
        count(*) FILTER (WHERE ai_status = 'failed')::int AS ai_failed
        FROM products WHERE workspace_id = ${workspaceId}::uuid`,
      sql`SELECT count(*)::int AS count FROM (
        SELECT lower(title) FROM products WHERE workspace_id = ${workspaceId}::uuid
        GROUP BY lower(title) HAVING count(*) > 1
      ) duplicate_groups`,
      sql`SELECT change.*, product.title, product.image_url FROM catalog_changes change
        JOIN products product ON product.id = change.product_id
        WHERE change.workspace_id = ${workspaceId}::uuid ORDER BY change.detected_at DESC LIMIT 80`,
      sql`SELECT recipe.*, source.name AS source_name FROM automation_recipes recipe
        LEFT JOIN saved_sources source ON source.id = recipe.source_id
        WHERE recipe.workspace_id = ${workspaceId}::uuid ORDER BY recipe.created_at DESC`,
      sql`SELECT approval.*, product.title, product.image_url FROM approval_requests approval
        JOIN products product ON product.id = approval.product_id
        WHERE approval.workspace_id = ${workspaceId}::uuid ORDER BY approval.created_at DESC LIMIT 80`,
      sql`SELECT locale, market, status, count(*)::int AS count FROM product_translations
        WHERE workspace_id = ${workspaceId}::uuid GROUP BY locale, market, status ORDER BY locale`,
      sql`SELECT member.user_id, member.role, member.created_at, app_user.name, app_user.email
        FROM workspace_members member JOIN "user" app_user ON app_user.id = member.user_id
        WHERE member.workspace_id = ${workspaceId}::uuid ORDER BY member.created_at`,
      sql`SELECT id, email, role, status, expires_at, created_at FROM workspace_invitations
        WHERE workspace_id = ${workspaceId}::uuid ORDER BY created_at DESC LIMIT 30`,
      sql`SELECT * FROM source_adapters WHERE workspace_id = ${workspaceId}::uuid ORDER BY updated_at DESC`,
      sql`SELECT * FROM workspace_catalog_profiles WHERE workspace_id = ${workspaceId}::uuid`,
      sql`SELECT comment.*, product.title AS product_title FROM product_comments comment
        JOIN products product ON product.id = comment.product_id
        WHERE comment.workspace_id = ${workspaceId}::uuid ORDER BY comment.created_at DESC LIMIT 40`,
      sql`SELECT run.*, recipe.name AS recipe_name FROM operation_runs run
        LEFT JOIN automation_recipes recipe ON recipe.id = run.recipe_id
        WHERE run.workspace_id = ${workspaceId}::uuid ORDER BY run.started_at DESC LIMIT 30`,
      sql`SELECT
        (SELECT count(*)::int FROM scrape_jobs WHERE workspace_id = ${workspaceId}::uuid AND created_at > now() - interval '30 days') AS scrape_runs,
        (SELECT coalesce(sum(products_found),0)::int FROM scrape_jobs WHERE workspace_id = ${workspaceId}::uuid AND created_at > now() - interval '30 days') AS products_collected,
        (SELECT count(*)::int FROM activity_events WHERE workspace_id = ${workspaceId}::uuid AND event_type = 'ai_enriched' AND created_at > now() - interval '30 days') AS ai_enrichments,
        (SELECT count(*)::int FROM activity_events WHERE workspace_id = ${workspaceId}::uuid AND event_type = 'shopify_synced' AND created_at > now() - interval '30 days') AS shopify_syncs,
        (SELECT count(*)::int FROM catalog_changes WHERE workspace_id = ${workspaceId}::uuid AND detected_at > now() - interval '30 days') AS changes_detected,
        (SELECT count(*)::int FROM approval_requests WHERE workspace_id = ${workspaceId}::uuid AND status = 'approved' AND reviewed_at > now() - interval '30 days') AS approvals`,
      sql`SELECT * FROM organization_templates WHERE organization_id = ${auth.context.organization.id}::uuid ORDER BY created_at DESC`,
    ]);
    const q = quality[0] || {};
    const issueValues = [
      ["missing_image", "Missing images", q.missing_image, "warning"],
      ["missing_description", "Missing descriptions", q.missing_description, "warning"],
      ["invalid_price", "Invalid prices", q.invalid_price, "error"],
      ["missing_category", "Missing categories", q.missing_category, "warning"],
      ["missing_variants", "Missing variants", q.missing_variants, "warning"],
      ["suspicious_price", "Suspicious prices", q.suspicious_price, "warning"],
      ["ai_failed", "Failed AI enrichment", q.ai_failed, "error"],
      ["duplicate_title", "Duplicate product titles", duplicateTitles[0]?.count || 0, "warning"],
    ];
    const issueTotal = issueValues.reduce((sum, issue) => sum + Number(issue[2] || 0), 0);
    const total = Number(q.total || 0);
    return Response.json({
      quality: { score: total ? Math.max(0, Math.round(100 - issueTotal / total * 8)) : 100, total, missing_image:Number(q.missing_image||0), missing_description:Number(q.missing_description||0), invalid_price:Number(q.invalid_price||0), missing_category:Number(q.missing_category||0), missing_variants:Number(q.missing_variants||0), suspicious_price:Number(q.suspicious_price||0), ai_failed:Number(q.ai_failed||0), duplicate_titles:Number(duplicateTitles[0]?.count||0), issues: issueValues.map(([code, label, count, severity]) => ({ code, label, count: Number(count), severity })).filter((item) => item.count > 0) },
      changes, recipes, approvals, translations, members, invitations, adapters,
      profile: profile[0] || { brand_voice: "", forbidden_words: [], target_keywords: [], approval_required: true, auto_publish: false, white_label_name: "", white_label_logo_url: "" },
      comments, runs, analytics: [{ day: "30 days", products: Number(analytics[0]?.products_collected || 0), enriched: Number(analytics[0]?.ai_enrichments || 0), published: Number(analytics[0]?.shopify_syncs || 0), changes: Number(analytics[0]?.changes_detected || 0) }], templates,
      permissions: { manage: manager(auth.context.workspace.role), review: ["owner","admin","reviewer"].includes(auth.context.workspace.role), role: auth.context.workspace.role },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("catalog_changes") || message.includes("automation_recipes")) return Response.json({ migration_required: true }, { status: 503 });
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const payload = await request.json();
    const action = String(payload.action || "");
    const sql = db();
    const workspaceId = auth.context.workspace.id;
    const canManage = manager(auth.context.workspace.role);

    if (action === "save_recipe") {
      const schedule = ["hourly", "daily", "weekly", "manual"].includes(payload.schedule) ? payload.schedule : "daily";
      const actions = Array.isArray(payload.actions) ? payload.actions.slice(0, 10) : [payload.auto_enrich ? "enrich" : null, payload.auto_export ? "export" : null].filter(Boolean);
      const approvalRequired = Boolean(payload.approval_required ?? payload.require_approval);
      const id = String(payload.id || "").trim() || null;
      const rows = id
        ? await sql`UPDATE automation_recipes SET name = ${String(payload.name || "Automation").slice(0,120)}, source_id = ${payload.source_id || null}::uuid, schedule = ${schedule}, actions = ${JSON.stringify(actions)}::jsonb, approval_required = ${approvalRequired}, enabled = ${Boolean(payload.enabled)}, next_run_at = CASE WHEN ${schedule} = 'manual' THEN NULL ELSE now() + ${nextRun(schedule)}::interval END, updated_at = now() WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid RETURNING *`
        : await sql`INSERT INTO automation_recipes(workspace_id,name,source_id,schedule,actions,approval_required,enabled,next_run_at,created_by) VALUES(${workspaceId}::uuid,${String(payload.name || "Automation").slice(0,120)},${payload.source_id || null}::uuid,${schedule},${JSON.stringify(actions)}::jsonb,${approvalRequired},true,CASE WHEN ${schedule} = 'manual' THEN NULL ELSE now() + ${nextRun(schedule)}::interval END,${auth.context.user.name}) RETURNING *`;
      return Response.json({ recipe: rows[0] });
    }

    if (action === "toggle_recipe") {
      await sql`UPDATE automation_recipes SET enabled = ${Boolean(payload.enabled)}, next_run_at = CASE WHEN ${Boolean(payload.enabled)} AND schedule <> 'manual' THEN now() ELSE NULL END, updated_at = now() WHERE id = ${String(payload.id)}::uuid AND workspace_id = ${workspaceId}::uuid`;
      return Response.json({ ok: true });
    }

    if (action === "run_recipe") {
      const rows = await sql`SELECT recipe.*, source.* FROM automation_recipes recipe JOIN saved_sources source ON source.id = recipe.source_id WHERE recipe.id = ${String(payload.id)}::uuid AND recipe.workspace_id = ${workspaceId}::uuid`;
      const recipe = rows[0];
      if (!recipe) return Response.json({ error: "Automation needs a saved source" }, { status: 404 });
      const actions = Array.isArray(recipe.actions) ? recipe.actions.map(String) : [];
      const jobs = await sql`INSERT INTO scrape_jobs(workspace_id,saved_source_id,automation_recipe_id,source,category_name,category_url,start_page,max_pages,auto_enrich,seo_language) VALUES(${workspaceId}::uuid,${recipe.source_id}::uuid,${recipe.id}::uuid,${recipe.source_host},${recipe.category_name},${recipe.category_url},${recipe.start_page},${recipe.max_pages},${actions.includes("enrich")},${recipe.seo_language}) RETURNING id`;
      await sql`UPDATE automation_recipes SET last_run_at = now(), next_run_at = CASE WHEN schedule = 'manual' THEN NULL WHEN schedule = 'hourly' THEN now()+interval '1 hour' WHEN schedule = 'weekly' THEN now()+interval '7 days' ELSE now()+interval '1 day' END WHERE id = ${recipe.id}`;
      await sql`INSERT INTO operation_runs(workspace_id,recipe_id,kind,status,summary,completed_at) VALUES(${workspaceId}::uuid,${recipe.id}::uuid,'automation','completed',${JSON.stringify({ queued_job_id: jobs[0].id, actions })}::jsonb,now())`;
      return Response.json({ job_id: jobs[0].id });
    }

    if (action === "review_change") {
      const status = ["approve","approved","applied"].includes(String(payload.decision)) ? "approved" : "rejected";
      const rows = await sql`UPDATE catalog_changes SET status = ${status}, reviewed_by = ${auth.context.user.name}, reviewed_at = now() WHERE id = ${String(payload.id)}::uuid AND workspace_id = ${workspaceId}::uuid AND status = 'pending' RETURNING *`;
      if (status === "approved" && rows[0]) {
        await applyChange(sql, workspaceId, rows[0]);
        await sql`UPDATE catalog_changes SET status = 'applied' WHERE id = ${String(payload.id)}::uuid`;
      }
      return Response.json({ change: rows[0] });
    }

    if (action === "request_approval") {
      const ids = Array.isArray(payload.product_ids) ? payload.product_ids.slice(0,1000).map(String) : [];
      if (!ids.length) return Response.json({ error: "Select products first" }, { status: 400 });
      await sql`INSERT INTO approval_requests(workspace_id,product_id,requested_by,note) SELECT ${workspaceId}::uuid,id,${auth.context.user.name},${String(payload.note || "").slice(0,500)} FROM products WHERE workspace_id = ${workspaceId}::uuid AND id = ANY(${ids}::uuid[])`;
      return Response.json({ created: ids.length });
    }

    if (action === "decide_approval") {
      const decision = ["approve","approved","applied"].includes(String(payload.decision)) ? "approved" : "rejected";
      const rows = await sql`UPDATE approval_requests SET status = ${decision}, reviewed_by = ${auth.context.user.name}, reviewed_at = now(), note = COALESCE(NULLIF(${String(payload.note || "")},''),note) WHERE id = ${String(payload.id)}::uuid AND workspace_id = ${workspaceId}::uuid AND status = 'pending' RETURNING *`;
      return Response.json({ approval: rows[0] });
    }

    if (action === "invite") {
      if (!canManage) return Response.json({ error: "Admin access required" }, { status: 403 });
      const email = String(payload.email || "").trim().toLowerCase();
      const role = ["admin","member","reviewer"].includes(payload.role) ? payload.role : "reviewer";
      if (!email.includes("@")) return Response.json({ error: "Enter a valid email" }, { status: 400 });
      const token = crypto.randomUUID()+crypto.randomUUID();
      const rows = await sql`INSERT INTO workspace_invitations(workspace_id,email,role,token,invited_by) VALUES(${workspaceId}::uuid,${email},${role},${token},${auth.context.user.name}) ON CONFLICT(workspace_id,email) DO UPDATE SET role=EXCLUDED.role,token=EXCLUDED.token,status='pending',expires_at=now()+interval '7 days',invited_by=EXCLUDED.invited_by RETURNING id,email,role,token,expires_at`;
      return Response.json({ invitation: rows[0], invite_url: `${new URL(request.url).origin}/app?invite=${token}` });
    }

    if (action === "accept_invite") {
      const token = String(payload.token || "");
      const rows = await sql`UPDATE workspace_invitations SET status='accepted' WHERE token=${token} AND status='pending' AND expires_at>now() RETURNING workspace_id,role`;
      if (!rows[0]) return Response.json({ error: "Invitation expired or invalid" }, { status: 400 });
      await sql`INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(${rows[0].workspace_id}::uuid,${auth.context.user.id},${rows[0].role}) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role`;
      return Response.json({ workspace_id: rows[0].workspace_id });
    }

    if (action === "member_role") {
      if (!canManage) return Response.json({ error: "Admin access required" }, { status: 403 });
      const role = ["admin","member","reviewer"].includes(payload.role) ? payload.role : "reviewer";
      await sql`UPDATE workspace_members SET role=${role} WHERE workspace_id=${workspaceId}::uuid AND user_id=${String(payload.user_id)} AND role<>'owner'`;
      return Response.json({ ok: true });
    }

    if (action === "save_adapter" || action === "test_adapter") {
      const url = new URL(String(payload.url || ""));
      if (url.protocol !== "https:") return Response.json({ error: "Use a public HTTPS source URL" }, { status: 400 });
      const config = { card: String(payload.card || payload.card_selector || ""), title: String(payload.title || payload.title_selector || ""), vendor: String(payload.vendor || payload.vendor_selector || ""), price: String(payload.price || payload.price_selector || ""), image: String(payload.image || payload.image_selector || ""), link: String(payload.link || payload.link_selector || "a"), nextPage: String(payload.next_page || "") };
      const rows = await sql`INSERT INTO source_adapters(workspace_id,name,source_host,config,status,created_by) VALUES(${workspaceId}::uuid,${String(payload.name || url.hostname).slice(0,120)},${url.hostname},${JSON.stringify(config)}::jsonb,'draft',${auth.context.user.name}) ON CONFLICT(workspace_id,source_host) DO UPDATE SET name=EXCLUDED.name,config=EXCLUDED.config,updated_at=now() RETURNING *`;
      if (action === "save_adapter") return Response.json({ adapter: rows[0] });
      const backend = process.env.SCRAPPIFY_BACKEND_URL?.replace(/\/$/,"");
      const key = process.env.SCRAPPIFY_API_KEY;
      if (!backend || !key) return Response.json({ error: "Source tester backend is unavailable" }, { status: 503 });
      const response = await fetch(`${backend}/v1/sources/test`, { method:"POST", headers:{"Content-Type":"application/json","X-Scrappify-Key":key}, body:JSON.stringify({ workspace_id:workspaceId, adapter_id:rows[0].id, url:url.toString() }), signal:AbortSignal.timeout(120000) });
      const result = await response.json();
      await sql`UPDATE source_adapters SET status=${response.ok ? "verified" : "failed"},sample_count=${Number(result.count || 0)},last_tested_at=now(),updated_at=now() WHERE id=${rows[0].id}`;
      if (!response.ok) return Response.json({ error: result.detail || "Adapter test failed" }, { status: 400 });
      return Response.json({ adapter: { ...rows[0], status:"verified", sample_count:result.count }, preview:result.products });
    }

    if (action === "generate_translations") {
      const ids = Array.isArray(payload.product_ids) ? payload.product_ids.slice(0,100).map(String) : [];
      const locale = String(payload.locale || "en");
      const backend = process.env.SCRAPPIFY_BACKEND_URL?.replace(/\/$/,"");
      const key = process.env.SCRAPPIFY_API_KEY;
      if (!backend || !key) return Response.json({ error: "ScrapifyAI backend is unavailable" }, { status: 503 });
      const response = await fetch(`${backend}/v1/ai/translate`, { method:"POST", headers:{"Content-Type":"application/json","X-Scrappify-Key":key}, body:JSON.stringify({ workspace_id:workspaceId, product_ids:ids, language:locale, market:String(payload.market || "") }), signal:AbortSignal.timeout(290000) });
      const result = await response.json();
      if (!response.ok) return Response.json({ error: result.detail || "Translation failed" }, { status: response.status });
      return Response.json(result);
    }

    if (action === "save_profile") {
      await sql`INSERT INTO workspace_catalog_profiles(workspace_id,brand_voice,forbidden_words,target_keywords,approval_required,auto_publish,white_label_name,white_label_logo_url) VALUES(${workspaceId}::uuid,${String(payload.brand_voice || "")},${Array.isArray(payload.forbidden_words)?payload.forbidden_words:[]},${Array.isArray(payload.target_keywords)?payload.target_keywords:[]},${Boolean(payload.approval_required)},${Boolean(payload.auto_publish)},${String(payload.white_label_name || "")},${String(payload.white_label_logo_url || "")}) ON CONFLICT(workspace_id) DO UPDATE SET brand_voice=EXCLUDED.brand_voice,forbidden_words=EXCLUDED.forbidden_words,target_keywords=EXCLUDED.target_keywords,approval_required=EXCLUDED.approval_required,auto_publish=EXCLUDED.auto_publish,white_label_name=EXCLUDED.white_label_name,white_label_logo_url=EXCLUDED.white_label_logo_url,updated_at=now()`;
      return Response.json({ ok:true });
    }

    if (action === "comment") {
      const body = String(payload.body || "").trim().slice(0,2000);
      if (!body) return Response.json({ error:"Comment cannot be empty" }, { status:400 });
      const mentions = [...body.matchAll(/@([\w.+-]+@[\w.-]+|[\w.-]+)/g)].map((match)=>match[1]).slice(0,20);
      const rows = await sql`INSERT INTO product_comments(workspace_id,product_id,author_id,author_name,body,mentions) VALUES(${workspaceId}::uuid,${String(payload.product_id)}::uuid,${auth.context.user.id},${auth.context.user.name},${body},${mentions}) RETURNING *`;
      return Response.json({ comment:rows[0] });
    }

    if (action === "save_template") {
      if (!canManage) return Response.json({ error:"Admin access required" }, { status:403 });
      const config = { profile:payload.profile || {}, recipes:payload.recipes || [], sources:payload.sources || [] };
      const rows = await sql`INSERT INTO organization_templates(organization_id,name,config,created_by) VALUES(${auth.context.organization.id}::uuid,${String(payload.name || "Catalog template").slice(0,120)},${JSON.stringify(config)}::jsonb,${auth.context.user.name}) ON CONFLICT(organization_id,name) DO UPDATE SET config=EXCLUDED.config RETURNING *`;
      return Response.json({ template:rows[0] });
    }

    if (action === "duplicate_workspace") {
      if (!canManage) return Response.json({ error:"Admin access required" }, { status:403 });
      const name = String(payload.name || `${auth.context.workspace.name} copy`).slice(0,80);
      const rows = await sql`INSERT INTO workspaces(organization_id,name,slug) VALUES(${auth.context.organization.id}::uuid,${name},${safeSlug(name)+"-"+crypto.randomUUID().slice(0,6)}) RETURNING id,name,slug`;
      const newId=String(rows[0].id);
      await sql`INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(${newId}::uuid,${auth.context.user.id},'owner')`;
      await sql`INSERT INTO saved_sources(workspace_id,name,source_host,category_name,category_url,start_page,max_pages,seo_language,auto_enrich,enabled) SELECT ${newId}::uuid,name,source_host,category_name,category_url,start_page,max_pages,seo_language,auto_enrich,enabled FROM saved_sources WHERE workspace_id=${workspaceId}::uuid`;
      await sql`INSERT INTO workspace_catalog_profiles(workspace_id,brand_voice,forbidden_words,target_keywords,approval_required,auto_publish,white_label_name,white_label_logo_url) SELECT ${newId}::uuid,brand_voice,forbidden_words,target_keywords,approval_required,auto_publish,white_label_name,white_label_logo_url FROM workspace_catalog_profiles WHERE workspace_id=${workspaceId}::uuid`;
      return Response.json({ workspace:rows[0] });
    }

    return Response.json({ error:"Unsupported operation" }, { status:400 });
  } catch (error) { return jsonError(error, 400); }
}




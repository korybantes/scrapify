import { db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace } from "@/app/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const sql = db();
    const [presets, runs] = await Promise.all([
      sql`SELECT id, name, template_key, config, is_default, created_at, updated_at
          FROM export_presets
          WHERE workspace_id = ${auth.context.workspace.id}::uuid
          ORDER BY is_default DESC, updated_at DESC`,
      sql`SELECT run.id, run.name, run.format, run.scope, run.config,
            run.product_count, run.warning_count, run.status, run.created_at,
            preset.name AS preset_name, job.category_name AS session_name,
            COALESCE(NULLIF(run.created_by, ''), 'Workspace member') AS created_by
          FROM export_runs run
          LEFT JOIN export_presets preset ON preset.id = run.preset_id
          LEFT JOIN scrape_jobs job ON job.id = run.session_id
          WHERE run.workspace_id = ${auth.context.workspace.id}::uuid
          ORDER BY run.created_at DESC
          LIMIT 30`,
    ]);
    return Response.json({ presets, runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load export workspace";
    if (message.includes("export_presets") || message.includes("export_runs")) {
      return Response.json({ presets: [], runs: [], migration_required: true });
    }
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const payload = await request.json();
    if (payload.action === "record_run") {
      const productIds = Array.isArray(payload.product_ids) ? payload.product_ids.slice(0, 10000).map(String) : [];
      const config = payload.config && typeof payload.config === "object" ? payload.config : {};
      const presetId = String(payload.preset_id || "").trim() || null;
      const sessionId = String(payload.session_id || "").trim() || null;
      const failed = Math.max(0, Number(payload.failed || 0));
      const sql = db();
      const rows = await sql`INSERT INTO export_runs(
          workspace_id, preset_id, session_id, created_by, name, format, scope,
          product_ids, config, product_count, warning_count, status
        ) VALUES (
          ${auth.context.workspace.id}::uuid, ${presetId}::uuid, ${sessionId}::uuid,
          ${auth.context.user.name}, ${String(payload.name || "Direct Shopify publish").slice(0, 160)},
          'shopify_api', ${String(payload.scope || "selected")}, ${productIds}::uuid[],
          ${JSON.stringify(config)}::jsonb, ${productIds.length}, ${failed},
          ${failed >= productIds.length && productIds.length ? "failed" : "completed"}
        ) RETURNING id`;
      return Response.json({ run_id: rows[0]?.id });
    }
    const name = String(payload.name || "").trim().slice(0, 120);
    const templateKey = String(payload.template_key || "custom").trim().slice(0, 60);
    const config = payload.config && typeof payload.config === "object" ? payload.config : {};
    if (!name) return Response.json({ error: "Preset name is required" }, { status: 400 });
    const sql = db();
    if (Boolean(payload.is_default)) {
      await sql`UPDATE export_presets SET is_default = false
        WHERE workspace_id = ${auth.context.workspace.id}::uuid`;
    }
    const rows = await sql`
      INSERT INTO export_presets(workspace_id, name, template_key, config, is_default, created_by)
      VALUES (
        ${auth.context.workspace.id}::uuid, ${name}, ${templateKey},
        ${JSON.stringify(config)}::jsonb, ${Boolean(payload.is_default)}, ${auth.context.user.name}
      )
      ON CONFLICT (workspace_id, name) DO UPDATE SET
        template_key = EXCLUDED.template_key,
        config = EXCLUDED.config,
        is_default = EXCLUDED.is_default,
        created_by = EXCLUDED.created_by,
        updated_at = now()
      RETURNING id, name, template_key, config, is_default, created_at, updated_at
    `;
    return Response.json({ preset: rows[0] });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!id) return Response.json({ error: "Preset id is required" }, { status: 400 });
    const sql = db();
    await sql`DELETE FROM export_presets
      WHERE id = ${id}::uuid AND workspace_id = ${auth.context.workspace.id}::uuid`;
    return Response.json({ deleted: true });
  } catch (error) {
    return jsonError(error);
  }
}

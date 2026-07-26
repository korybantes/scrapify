import { db, jsonError } from "@/app/lib/server-db";
import { requireWorkspace, safeSlug } from "@/app/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const sql = db();
    const workspaces = await sql`
      SELECT w.id, w.name, w.slug, wm.role,
        o.id AS organization_id, o.name AS organization_name, o.slug AS organization_slug
      FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
      JOIN organizations o ON o.id = w.organization_id
      WHERE wm.user_id = ${auth.context.user.id}
      ORDER BY o.name, w.name
    `;
    return Response.json({ ...auth.context, workspaces });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const payload = await request.json();
    const name = String(payload.name || "").trim().slice(0, 80);
    if (name.length < 2) {
      return Response.json({ error: "Enter a name with at least 2 characters" }, { status: 400 });
    }

    const sql = db();
    if (payload.type === "organization") {
      const slug = `${safeSlug(name)}-${crypto.randomUUID().slice(0, 6)}`;
      const organizations = await sql`
        INSERT INTO organizations (name, slug)
        VALUES (${name}, ${slug})
        RETURNING id, name, slug
      `;
      const organization = organizations[0];
      const workspaces = await sql`
        INSERT INTO workspaces (organization_id, name, slug)
        VALUES (${organization.id}::uuid, 'Main workspace', 'main')
        RETURNING id, name, slug
      `;
      const workspace = workspaces[0];
      await Promise.all([
        sql`
          INSERT INTO organization_members (organization_id, user_id, role)
          VALUES (${organization.id}::uuid, ${auth.context.user.id}, 'owner')
        `,
        sql`
          INSERT INTO workspace_members (workspace_id, user_id, role)
          VALUES (${workspace.id}::uuid, ${auth.context.user.id}, 'owner')
        `,
      ]);
      return Response.json({ organization, workspace }, { status: 201 });
    }

    if (payload.type === "workspace") {
      const organizationId = String(payload.organization_id || auth.context.organization.id);
      const membership = await sql`
        SELECT role FROM organization_members
        WHERE organization_id = ${organizationId}::uuid
          AND user_id = ${auth.context.user.id}
          AND role IN ('owner', 'admin')
      `;
      if (!membership.length) {
        return Response.json({ error: "Owner or admin access required" }, { status: 403 });
      }
      const slug = `${safeSlug(name)}-${crypto.randomUUID().slice(0, 6)}`;
      const workspaces = await sql`
        INSERT INTO workspaces (organization_id, name, slug)
        VALUES (${organizationId}::uuid, ${name}, ${slug})
        RETURNING id, name, slug
      `;
      await sql`
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES (${workspaces[0].id}::uuid, ${auth.context.user.id}, 'owner')
      `;
      return Response.json({ workspace: workspaces[0] }, { status: 201 });
    }

    return Response.json({ error: "Unsupported account action" }, { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireWorkspace(request);
    if (!auth.context) return auth.response;
    const payload = await request.json();
    const name = String(payload.name || "").trim().slice(0, 80);
    if (name.length < 2) {
      return Response.json({ error: "Enter a name with at least 2 characters" }, { status: 400 });
    }
    const sql = db();

    if (payload.scope === "organization") {
      const membership = await sql`
        SELECT role FROM organization_members
        WHERE organization_id = ${auth.context.organization.id}::uuid
          AND user_id = ${auth.context.user.id}
          AND role IN ('owner', 'admin')
      `;
      if (!membership.length) {
        return Response.json({ error: "Owner or admin access required" }, { status: 403 });
      }
      const rows = await sql`
        UPDATE organizations SET name = ${name}, updated_at = now()
        WHERE id = ${auth.context.organization.id}::uuid
        RETURNING id, name, slug
      `;
      return Response.json({ organization: rows[0] });
    }

    if (payload.scope === "workspace") {
      const membership = await sql`
        SELECT role FROM workspace_members
        WHERE workspace_id = ${auth.context.workspace.id}::uuid
          AND user_id = ${auth.context.user.id}
          AND role IN ('owner', 'admin')
      `;
      if (!membership.length) {
        return Response.json({ error: "Owner or admin access required" }, { status: 403 });
      }
      const rows = await sql`
        UPDATE workspaces SET name = ${name}, updated_at = now()
        WHERE id = ${auth.context.workspace.id}::uuid
        RETURNING id, name, slug
      `;
      return Response.json({ workspace: rows[0] });
    }

    return Response.json({ error: "Unsupported settings scope" }, { status: 400 });
  } catch (error) {
    return jsonError(error, 400);
  }
}

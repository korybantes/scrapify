import { auth } from "@/app/lib/auth";
import { db } from "@/app/lib/server-db";

export type WorkspaceContext = {
  user: { id: string; name: string; email: string; image?: string | null };
  organization: { id: string; name: string; slug: string };
  workspace: { id: string; name: string; slug: string; role: string };
};

const LEGACY_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000001";
const LEGACY_WORKSPACE_ID = "00000000-0000-4000-8000-000000000002";

function cookieValue(request: Request, name: string) {
  const row = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return row ? decodeURIComponent(row.slice(name.length + 1)) : "";
}

function slugify(value: string) {
  return (
    value
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 42) || "workspace"
  );
}

async function provisionUser(user: WorkspaceContext["user"]) {
  const sql = db();
  const memberCount = await sql`SELECT count(*)::int AS count FROM organization_members`;

  if (Number(memberCount[0]?.count ?? 0) === 0) {
    await Promise.all([
      sql`
        INSERT INTO organization_members (organization_id, user_id, role)
        VALUES (${LEGACY_ORGANIZATION_ID}::uuid, ${user.id}, 'owner')
        ON CONFLICT DO NOTHING
      `,
      sql`
        INSERT INTO workspace_members (workspace_id, user_id, role)
        VALUES (${LEGACY_WORKSPACE_ID}::uuid, ${user.id}, 'owner')
        ON CONFLICT DO NOTHING
      `,
    ]);
    return;
  }

  const slug = `${slugify(user.name || user.email.split("@")[0])}-${user.id.slice(0, 7).toLowerCase()}`;
  const organizations = await sql`
    INSERT INTO organizations (name, slug)
    VALUES (${`${user.name || "My"} Organization`}, ${slug})
    ON CONFLICT (slug) DO UPDATE SET updated_at = now()
    RETURNING id
  `;
  const organizationId = String(organizations[0].id);
  const workspaces = await sql`
    INSERT INTO workspaces (organization_id, name, slug)
    VALUES (${organizationId}::uuid, 'Main workspace', 'main')
    ON CONFLICT (organization_id, slug) DO UPDATE SET updated_at = now()
    RETURNING id
  `;
  const workspaceId = String(workspaces[0].id);
  await Promise.all([
    sql`
      INSERT INTO organization_members (organization_id, user_id, role)
      VALUES (${organizationId}::uuid, ${user.id}, 'owner')
      ON CONFLICT DO NOTHING
    `,
    sql`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (${workspaceId}::uuid, ${user.id}, 'owner')
      ON CONFLICT DO NOTHING
    `,
  ]);
}

export async function getWorkspaceContext(request: Request): Promise<WorkspaceContext | null> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return null;

  const user = {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
    image: session.user.image,
  };
  const sql = db();
  let memberships = await sql`
    SELECT w.id, w.name, w.slug, wm.role,
      o.id AS organization_id, o.name AS organization_name, o.slug AS organization_slug
    FROM workspace_members wm
    JOIN workspaces w ON w.id = wm.workspace_id
    JOIN organizations o ON o.id = w.organization_id
    WHERE wm.user_id = ${user.id}
    ORDER BY w.created_at
  `;
  if (!memberships.length) {
    await provisionUser(user);
    memberships = await sql`
      SELECT w.id, w.name, w.slug, wm.role,
        o.id AS organization_id, o.name AS organization_name, o.slug AS organization_slug
      FROM workspace_members wm
      JOIN workspaces w ON w.id = wm.workspace_id
      JOIN organizations o ON o.id = w.organization_id
      WHERE wm.user_id = ${user.id}
      ORDER BY w.created_at
    `;
  }
  if (!memberships.length) return null;

  const requestedId = cookieValue(request, "scrappify_workspace");
  const membership = memberships.find((row) => row.id === requestedId) ?? memberships[0];
  return {
    user,
    organization: {
      id: String(membership.organization_id),
      name: String(membership.organization_name),
      slug: String(membership.organization_slug),
    },
    workspace: {
      id: String(membership.id),
      name: String(membership.name),
      slug: String(membership.slug),
      role: String(membership.role),
    },
  };
}

export async function requireWorkspace(request: Request) {
  const context = await getWorkspaceContext(request);
  if (!context) {
    return {
      context: null,
      response: Response.json({ error: "Authentication required" }, { status: 401 }),
    } as const;
  }
  return { context, response: null } as const;
}

export function safeSlug(value: string) {
  return slugify(value);
}

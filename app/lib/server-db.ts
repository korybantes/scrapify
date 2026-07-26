import { neon } from "@neondatabase/serverless";

export function db() {
  const connectionString = process.env.NEON_DB_URL;
  if (!connectionString) {
    throw new Error("NEON_DB_URL is not configured");
  }
  return neon(connectionString);
}

export const allowedSourceHosts = new Set(
  (process.env.ALLOWED_SOURCE_HOSTS ??
    "beymen.com,www.beymen.com,zaptila.com,www.zaptila.com")
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean),
);

export function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message }, { status });
}

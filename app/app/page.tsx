import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/app/lib/auth";
import Dashboard from "./Dashboard";

export default async function AppPage({ searchParams }: { searchParams: Promise<{ shop?: string }> }) {
  const session = await auth.api.getSession({ headers: await headers() });
  const params = await searchParams;
  if (!session?.user) redirect(params.shop ? `/login?shop=${encodeURIComponent(params.shop)}` : "/login");
  return <Dashboard />;
}

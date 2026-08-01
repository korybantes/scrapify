import LoginForm from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; shop?: string }>;
}) {
  const params = await searchParams;
  return <LoginForm initialMode={params.mode === "signup" ? "signup" : "signin"} shop={params.shop || ""} />;
}

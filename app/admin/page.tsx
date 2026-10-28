import type { Metadata } from "next";
import Admin from "@/components/admin/Admin";
import { adminEnabled, isAdmin } from "@/lib/server/admin";

export const metadata: Metadata = {
  title: "Evocast Admin",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const state = !adminEnabled() ? "setup" : (await isAdmin()) ? "in" : "login";
  return <Admin state={state} />;
}

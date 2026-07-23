import { redirect } from "next/navigation";

// The dashboard lives at /tennis; /tennis/dashboard is an alias for shareable links.
export default function TennisDashboardAlias() {
  redirect("/tennis");
}

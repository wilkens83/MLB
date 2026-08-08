import type { Metadata } from "next";
import { MyPlayersDashboard } from "@/features/players/my-players-dashboard";

export const metadata: Metadata = {
  title: "My Players · Diamond Edge",
  description: "Your saved MLB players — favorites and followed performance tracking.",
};

export default function MyPlayersPage() {
  return <MyPlayersDashboard />;
}

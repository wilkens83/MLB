import { PicksWorkbench } from "@/features/picks/picks-workbench";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Player Picks · Diamond Edge",
  description: "Analyze every supported prop for one MLB player and rank the strongest MORE/LESS opportunities.",
};

export default function PicksPage() {
  return <PicksWorkbench />;
}

import { TennisBoard } from "@/components/tennis/board";
import { getTennisDataStatus } from "@/lib/tennis/status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function TennisBoardPage() {
  const status = getTennisDataStatus();
  return <TennisBoard liveConfigured={status.liveConfigured} />;
}

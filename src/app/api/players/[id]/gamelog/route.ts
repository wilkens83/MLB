import { NextResponse, type NextRequest } from "next/server";
import { getPlayer, getGameLog, CURRENT_SEASON } from "@/lib/mlb/api";
import { draftKingsHitterPoints, inningsToOuts } from "@/lib/mlb/series";
import type { GameStatLine } from "@/lib/mlb/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface GameLogRow {
  date?: string;
  opponent?: string;
  isHome?: boolean;
  // batting
  hits?: number;
  singles?: number;
  doubles?: number;
  triples?: number;
  homeRuns?: number;
  totalBases?: number;
  runs?: number;
  rbi?: number;
  walks?: number;
  strikeOuts?: number;
  stolenBases?: number;
  fantasyPoints?: number;
  // pitching
  outs?: number;
  earnedRuns?: number;
  hitsAllowed?: number;
  pitcherWalks?: number;
}

function batterRow(s: GameStatLine) {
  const singles = Math.max(0, (s.hits ?? 0) - (s.doubles ?? 0) - (s.triples ?? 0) - (s.homeRuns ?? 0));
  return {
    hits: s.hits ?? 0,
    singles,
    doubles: s.doubles ?? 0,
    triples: s.triples ?? 0,
    homeRuns: s.homeRuns ?? 0,
    totalBases: s.totalBases ?? 0,
    runs: s.runs ?? 0,
    rbi: s.rbi ?? 0,
    walks: s.baseOnBalls ?? 0,
    strikeOuts: s.strikeOuts ?? 0,
    stolenBases: s.stolenBases ?? 0,
    fantasyPoints: Math.round(draftKingsHitterPoints(s) * 10) / 10,
  };
}

function pitcherRow(s: GameStatLine) {
  return {
    outs: s.outs ?? inningsToOuts(s.inningsPitched),
    strikeOuts: s.strikeOuts ?? 0,
    earnedRuns: s.earnedRuns ?? 0,
    hitsAllowed: s.hits ?? 0,
    pitcherWalks: s.baseOnBalls ?? 0,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isFinite(playerId)) return NextResponse.json({ error: "invalid_player_id" }, { status: 400 });

  const season = Number(req.nextUrl.searchParams.get("season")) || CURRENT_SEASON;
  try {
    const player = await getPlayer(playerId).catch(() => null);
    const isPitcher = player?.primaryPosition?.abbreviation === "P";
    const log = await getGameLog(playerId, isPitcher ? "pitching" : "hitting", season);
    const rows: GameLogRow[] = log
      .filter((sp) => (sp.stat.gamesPlayed ?? 1) > 0)
      .map((sp) => ({
        date: sp.date,
        opponent: sp.opponent?.name,
        isHome: sp.isHome,
        ...(isPitcher ? pitcherRow(sp.stat) : batterRow(sp.stat)),
      }))
      .reverse(); // newest first for the table
    return NextResponse.json({ isPitcher, season, rows });
  } catch {
    return NextResponse.json({ rows: [], error: "gamelog_failed" }, { status: 502 });
  }
}

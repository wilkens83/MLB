/* ============================================================================
   Team color map (presentation only) — primary brand color per MLB team id,
   used for avatar fallbacks and accents. No analytics use.
   ========================================================================== */

export const TEAM_COLORS: Record<number, string> = {
  108: "#ba0021", // LAA
  109: "#a71930", // ARI
  110: "#df4601", // BAL
  111: "#bd3039", // BOS
  112: "#0e3386", // CHC
  113: "#c6011f", // CIN
  114: "#0c2340", // CLE
  115: "#333366", // COL
  116: "#0c2340", // DET
  117: "#eb6e1f", // HOU
  118: "#004687", // KC
  119: "#005a9c", // LAD
  120: "#ab0003", // WSH
  121: "#002d72", // NYM
  133: "#003831", // ATH
  134: "#fdb827", // PIT
  135: "#2f241d", // SD
  136: "#0c2c56", // SEA
  137: "#fd5a1e", // SF
  138: "#c41e3a", // STL
  139: "#092c5c", // TB
  140: "#003278", // TEX
  141: "#134a8e", // TOR
  142: "#002b5c", // MIN
  143: "#e81828", // PHI
  144: "#ce1141", // ATL
  145: "#27251f", // CWS
  146: "#00a3e0", // MIA
  147: "#003087", // NYY
  158: "#12284b", // MIL
};

export function teamColor(teamId?: number): string {
  if (teamId && TEAM_COLORS[teamId]) return TEAM_COLORS[teamId];
  return "#3a4150";
}

/* ============================================================================
   ParkFactorProvider — wraps the static ballpark factor table as a provider so
   the analytics layer depends on the interface, not the table.
   ========================================================================== */

import { parkFactor } from "@/lib/mlb/context";
import type { ParkFactorProvider } from "./types";
import type { BallparkEntity } from "@/lib/domain/models";

export const staticParkProvider: ParkFactorProvider = {
  name: "static-park-factors",
  getFactor(venueName?: string): BallparkEntity {
    const pf = parkFactor(venueName);
    return { venueName: venueName ?? "", runs: pf.runs, hr: pf.hr, hits: pf.hits };
  },
};

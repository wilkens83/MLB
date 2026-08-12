/* ============================================================================
   Role-based prop discovery. The canonical prop catalog is the single source of
   truth: a pitcher gets the pitcher-category props, a hitter the batter-category
   props. Team/game markets are never player picks. No market is hard-coded here.
   ========================================================================== */

import { propsByCategory, type PropDef } from "@/lib/props/catalog";

/** Every supported prop for the player's role, straight from the catalog. */
export function eligibleProps(isPitcher: boolean): PropDef[] {
  return propsByCategory(isPitcher ? "pitcher" : "batter");
}

/* Decision-engine version + a deterministic config checksum (pure, no deps, so it
   runs under Bun and in the browser). The checksum lets a persisted decision be
   tied to the exact policy + engine that produced it. */

export const DECISION_ENGINE_VERSION = "decision-1.0.0";

/** FNV-1a 32-bit hash → 8-hex-char checksum of any JSON-serializable value. */
export function configChecksum(value: unknown): string {
  const str = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

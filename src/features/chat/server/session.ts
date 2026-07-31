/* ============================================================================
   Anonymous session id. Until real auth exists, each browser gets a stable
   anonymous id in an httpOnly cookie. The DB schema already carries user_id, so
   swapping in authenticated ids later is a drop-in — the session id simply
   becomes the authenticated user id.
   ========================================================================== */

import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";

const COOKIE = "de_chat_session";

/** Get the caller's session id, minting + persisting one if absent. */
export async function getOrCreateSessionId(): Promise<string> {
  const jar = await cookies();
  const existing = jar.get(COOKIE)?.value;
  if (existing) return existing;
  const id = `anon-${randomUUID()}`;
  jar.set(COOKIE, id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
  return id;
}

/* ============================================================================
   Tool registry — the allow-list of analytics tools the chat can invoke. Tools
   register themselves here; the orchestrator can only call registered names.
   ========================================================================== */

import type { ChatToolDefinition } from "./types";
import type { ChatSport } from "../schemas/request";

export class ToolRegistry {
  private tools = new Map<string, ChatToolDefinition>();

  register(def: ChatToolDefinition): void {
    if (this.tools.has(def.name)) {
      throw new Error(`Duplicate tool registration: ${def.name}`);
    }
    this.tools.set(def.name, def);
  }

  get(name: string): ChatToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ChatToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Tools available for a given selected sport/domain (plus cross-cutting ones). */
  forSport(sport: ChatSport): ChatToolDefinition[] {
    return this.list().filter((t) => t.domain === sport || t.domain === "system");
  }

  /** Catalog (name + description) the model/intent layer sees. */
  catalog(): { name: string; description: string; domain: ChatSport }[] {
    return this.list().map((t) => ({ name: t.name, description: t.description, domain: t.domain }));
  }
}

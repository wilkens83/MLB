/* Edges are implicit in a node's `dependsOn` list. Conditional routing is
   expressed by a node's `guard(inputs)` predicate: when it returns false the node
   (and anything depending only on it) is skipped rather than failed. This module
   provides a small helper to derive the edge list from a node set for tooling /
   visualization. Pure. */

import type { GraphNode } from "./types";

export interface Edge {
  from: string;
  to: string;
}

export function edgesOf(nodes: GraphNode[]): Edge[] {
  const edges: Edge[] = [];
  for (const n of nodes) for (const dep of n.dependsOn) edges.push({ from: dep, to: n.id });
  return edges;
}

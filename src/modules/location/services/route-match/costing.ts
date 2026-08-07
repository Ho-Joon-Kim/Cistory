import type { ValhallaCosting } from "@/lib/adapters/map-matching/valhalla";

export type RouteMatchDecision =
  | { kind: "match"; costing: ValhallaCosting }
  | { kind: "not_applicable" }
  | { kind: "skip" };

export function costingForMode(mode: string): RouteMatchDecision {
  switch (mode) {
    case "walking":
    case "running":
      return { kind: "match", costing: "pedestrian" };
    case "cycling":
      return { kind: "match", costing: "bicycle" };
    case "driving":
      return { kind: "match", costing: "auto" };
    case "motorcycle":
      return { kind: "match", costing: "motorcycle" };
    case "bus":
      return { kind: "match", costing: "bus" };
    case "subway":
    case "train":
    case "flying":
      return { kind: "not_applicable" };
    default:
      return { kind: "skip" };
  }
}

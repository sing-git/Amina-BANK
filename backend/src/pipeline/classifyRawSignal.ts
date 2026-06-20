// THE routing decision, in one place (matches the diagram in spec §1).
//
// "How does the system know to use arithmetic vs exact-match vs embedding?"
// → It does NOT infer it. WE hardcode the mapping below: each `sourceType` (stamped by
//   the ingestion connector) maps to exactly one route. classifyRawSignal() is a pure
//   table lookup — deterministic, no AI, auditable.
import type { RawSignal } from "../types.js";

export type SignalRoute =
  | "numeric" //   → ruleDiff()  (arithmetic on numbers / tx history)
  | "narrative" // → embedding gate → Stage 2 LLM (semantic drift on text)
  | "identity"; //  → hardGate()  (EXACT name match vs sanctions/PEP)

// The single source of truth. Editing this table is the ONLY way routing changes.
const ROUTE_BY_SOURCE: Record<RawSignal["sourceType"], SignalRoute> = {
  transaction: "numeric", // amounts/counts → subtraction & thresholds
  funding_db: "numeric", //  funding multiples → arithmetic
  news: "narrative", //      free text → semantic similarity
  registry: "narrative", //  registry text (name/jurisdiction change) → semantic similarity
  domain: "narrative", //    website/domain text → semantic similarity
};

/**
 * Returns which method a signal must be handled by. Why each is correct:
 *  - numeric:   payload is a NUMBER → exact arithmetic is enough, cheap, explainable.
 *  - narrative: payload is TEXT → meaning must be compared → embeddings (then LLM if it passes).
 *  - identity:  payload is a NAME → must be EXACT match (Ivan Petrov ≠ Petroff); similarity
 *               here would create compliance false positives/negatives. Names never route
 *               through embeddings.
 *
 * Note: sanctions/PEP screening runs on the client's `legalName`/UBO names up front (the
 * "identity" branch), not as an incoming RawSignal — so the table above only lists the
 * sources that arrive as signals. A narrative signal that reveals an ownership change hands
 * the NEW name to the identity branch for exact re-screening (spec §8, row 8).
 */
export function classifyRawSignal(signal: RawSignal): SignalRoute {
  return ROUTE_BY_SOURCE[signal.sourceType];
}

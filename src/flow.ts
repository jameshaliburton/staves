import type { Board, Job } from "./model.js";

/** Artifact handoffs do not imply a start rule. An omitted rule remains unknown. */
export type Prerequisites =
  | { kind: "all"; inputs: string[] }
  | { kind: "any"; inputs: string[] }
  | { kind: "unknown"; inputs: string[] }
  | { kind: "conditional"; inputs: string[]; condition: string };

export interface PrerequisiteContext {
  board?: Pick<Board, "artifacts">;
  job?: Pick<Job, "inputs">;
}

/** Validate explicit declarations at ingestion, optionally checking their references. */
export function validatePrerequisites(value: unknown, context: PrerequisiteContext = {}): Prerequisites {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("prerequisites must be an object");
  }
  const rule = value as Record<string, unknown>;
  if (typeof rule.kind !== "string" || !["all", "any", "conditional", "unknown"].includes(rule.kind)) {
    throw new Error("prerequisites.kind must be all, any, conditional or unknown");
  }
  const allowed = rule.kind === "conditional" ? ["kind", "inputs", "condition"] : ["kind", "inputs"];
  if (Object.keys(rule).some(key => !allowed.includes(key))) {
    throw new Error("prerequisites contains an unsupported field");
  }
  if (!Array.isArray(rule.inputs) || rule.inputs.some(id => typeof id !== "string" || !id.trim())) {
    throw new Error("prerequisites.inputs must be an explicit list of non-empty artifact IDs");
  }
  const inputs = rule.inputs as string[];
  if (new Set(inputs).size !== inputs.length) throw new Error("prerequisites.inputs must not contain duplicates");
  if (rule.kind === "any" && inputs.length === 0) throw new Error("any prerequisites require at least one input");
  if (rule.kind === "conditional" && (typeof rule.condition !== "string" || !rule.condition.trim())) {
    throw new Error("conditional prerequisites require a non-empty condition");
  }
  for (const id of inputs) {
    if (context.board && !context.board.artifacts.some(artifact => artifact.id === id)) {
      throw new Error(`prerequisites references unknown artifact ${id}`);
    }
    if (context.job && !context.job.inputs.includes(id)) {
      throw new Error(`prerequisites artifact ${id} is not a job input`);
    }
  }
  if (rule.kind === "conditional") return { kind: "conditional", inputs: [...inputs], condition: rule.condition as string };
  return { kind: rule.kind as "all" | "any" | "unknown", inputs: [...inputs] };
}

export interface PrerequisiteAssessment {
  status: "ready" | "waiting" | "unresolved";
  reasons: string[];
  /** Unavailable declared artifacts; for any, these are alternatives, not all required. */
  missingInputs: string[];
}

/**
 * Evaluate only the declared rule. A conditional rule requires all listed inputs
 * and a true named condition. A missing condition is unresolved; false is waiting.
 * Explicit all with no inputs permits a start; absence of a rule never does.
 */
export function assessPrerequisites(
  prerequisites: Prerequisites | undefined,
  availableArtifactIds: Iterable<string>,
  conditions: Readonly<Record<string, boolean | undefined>> = {},
): PrerequisiteAssessment {
  if (prerequisites === undefined) {
    return { status: "unresolved", reasons: ["The prerequisite rule has not been specified."], missingInputs: [] };
  }
  const rule = validatePrerequisites(prerequisites);
  const available = new Set(availableArtifactIds);
  const missingInputs = rule.inputs.filter(id => !available.has(id));
  if (rule.kind === "unknown") {
    return { status: "unresolved", reasons: ["The relationship between prerequisite inputs is unknown."], missingInputs };
  }
  if (rule.kind === "conditional") {
    const condition = Object.hasOwn(conditions, rule.condition) ? conditions[rule.condition] : undefined;
    if (typeof condition !== "boolean") {
      return { status: "unresolved", reasons: [`The condition \"${rule.condition}\" has no supplied value.`], missingInputs };
    }
    if (!condition) {
      return { status: "waiting", reasons: [`The condition \"${rule.condition}\" is false.`, ...missingInputs.map(id => `Input ${id} is unavailable.`)], missingInputs };
    }
  }
  if (rule.kind === "any") {
    return missingInputs.length < rule.inputs.length
      ? { status: "ready", reasons: ["At least one declared alternative input is available."], missingInputs }
      : { status: "waiting", reasons: ["None of the declared alternative inputs is available."], missingInputs };
  }
  return missingInputs.length === 0
    ? { status: "ready", reasons: ["All declared prerequisites are satisfied."], missingInputs }
    : { status: "waiting", reasons: missingInputs.map(id => `Required input ${id} is unavailable.`), missingInputs };
}

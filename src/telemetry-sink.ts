/** Aggregate interview metrics, as the server reports them. Never prompts, boards or errors. */
export interface InterviewMetric {
  scope: "board" | "job";
  streaming: boolean;
  engine: "model" | "rules" | "none";
  outcome: "success" | "error" | "unavailable";
  cardCount: number;
  lineCount: number;
  startedAt: number;
}

/** Where the server reports interview metrics. Open Staves records nothing: the default sink drops
 *  every metric. A hosted service installs its own at its entry point (BOUNDARY.md rule 4). */
export interface TelemetrySink {
  record(metric: InterviewMetric): string | undefined;
}

const none: TelemetrySink = { record: () => undefined };
let sink: TelemetrySink = none;

export function setTelemetrySink(next: TelemetrySink | undefined): void { sink = next ?? none; }
export function telemetrySink(): TelemetrySink { return sink; }

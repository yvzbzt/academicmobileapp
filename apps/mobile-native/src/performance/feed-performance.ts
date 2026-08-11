export const ANDROID_FRAMESTATS_PROFILE_MARKER = "---PROFILEDATA---";
export const FEED_PERFORMANCE_THRESHOLDS = Object.freeze({
  requiredTrialCount: 5,
  minimumFramesPerTrial: 100,
  maximumP90Ms: 32,
  maximumP95Ms: 50,
  frozenFrameThresholdMs: 700,
  maximumFrozenFrames: 0,
} as const);

export interface FeedPerformanceSummary {
  frameCount: number;
  p90Ms: number;
  p95Ms: number;
  frozenFrames: number;
}

export type FeedPerformanceFailureCode =
  | "trial_count"
  | "trial_frame_count"
  | "p90_limit"
  | "p95_limit"
  | "frozen_frames";

export interface FeedPerformanceFailure {
  code: FeedPerformanceFailureCode;
  actual: number;
  expected: number;
  trial?: number;
}

export interface FeedPerformanceTrialSummary extends FeedPerformanceSummary {
  trial: number;
}

export interface FeedPerformanceEvaluation {
  accepted: boolean;
  reasons: FeedPerformanceFailure[];
  aggregate: FeedPerformanceSummary;
  trials: FeedPerformanceTrialSummary[];
}

export interface AndroidActivityStartTiming {
  thisTimeMs: number;
  totalTimeMs: number;
  waitTimeMs: number;
}

interface FramestatsColumns {
  flags: number;
  intendedVsync: number;
  frameCompleted: number;
}

/**
 * Reads the three timing fields emitted by `adb shell am start -W`. Returning
 * `null` keeps malformed or incomplete launch output from being presented as
 * a real startup measurement.
 */
export function parseAndroidActivityStartTiming(
  output: string,
): AndroidActivityStartTiming | null {
  const thisTimeMs = parseNonNegativeTimingField(output, "ThisTime");
  const totalTimeMs = parseNonNegativeTimingField(output, "TotalTime");
  const waitTimeMs = parseNonNegativeTimingField(output, "WaitTime");
  if (thisTimeMs === null || totalTimeMs === null || waitTimeMs === null) {
    return null;
  }

  return { thisTimeMs, totalTimeMs, waitTimeMs };
}

/**
 * Extracts completed UI-frame durations from Android gfxinfo PROFILEDATA CSV
 * sections. Android timestamps are nanoseconds; BigInt keeps the subtraction
 * exact before the small frame duration is converted to milliseconds.
 */
export function parseAndroidFrameStats(output: string): number[] {
  const durationsMs: number[] = [];
  let inProfileData = false;
  let columns: FramestatsColumns | null = null;

  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === ANDROID_FRAMESTATS_PROFILE_MARKER) {
      inProfileData = !inProfileData;
      columns = null;
      continue;
    }
    if (!inProfileData || line.length === 0) continue;

    const cells = line.split(",").map((cell) => cell.trim().replace(/^\uFEFF/u, ""));
    const header = framestatsColumns(cells);
    if (header) {
      columns = header;
      continue;
    }
    if (!columns) continue;

    const lastRequiredColumn = Math.max(
      columns.flags,
      columns.intendedVsync,
      columns.frameCompleted,
    );
    if (cells.length <= lastRequiredColumn) continue;

    const flags = parseInteger(cells[columns.flags]);
    if (flags !== 0n) continue;

    const intendedVsync = parseInteger(cells[columns.intendedVsync]);
    const frameCompleted = parseInteger(cells[columns.frameCompleted]);
    if (intendedVsync === null || frameCompleted === null) continue;

    const durationNs = frameCompleted - intendedVsync;
    if (durationNs <= 0n || durationNs > BigInt(Number.MAX_SAFE_INTEGER)) continue;

    const durationMs = Number(durationNs) / 1_000_000;
    if (Number.isFinite(durationMs) && durationMs > 0) durationsMs.push(durationMs);
  }

  return durationsMs;
}

/** Uses the statistical nearest-rank definition: ceil(percentile * count). */
export function nearestRankPercentile(
  values: readonly number[],
  percentile: number,
): number {
  if (!Number.isFinite(percentile) || percentile <= 0 || percentile > 1) {
    throw new RangeError("Percentile must be greater than 0 and at most 1.");
  }

  const sorted = validDurations(values).sort((left, right) => left - right);
  if (sorted.length === 0) return 0;

  const rank = Math.ceil(percentile * sorted.length);
  return sorted[rank - 1] ?? 0;
}

export function summarizeFrameDurations(
  values: readonly number[],
): FeedPerformanceSummary {
  const durations = validDurations(values);
  return {
    frameCount: durations.length,
    p90Ms: nearestRankPercentile(durations, 0.9),
    p95Ms: nearestRankPercentile(durations, 0.95),
    frozenFrames: durations.filter(
      (duration) => duration >= FEED_PERFORMANCE_THRESHOLDS.frozenFrameThresholdMs,
    ).length,
  };
}

export function evaluateFeedPerformanceTrials(
  trials: readonly (readonly number[])[],
): FeedPerformanceEvaluation {
  const normalizedTrials = trials.map(validDurations);
  const trialSummaries = normalizedTrials.map((trial, index) => ({
    trial: index + 1,
    ...summarizeFrameDurations(trial),
  }));
  const aggregate = summarizeFrameDurations(normalizedTrials.flat());
  const reasons: FeedPerformanceFailure[] = [];

  if (normalizedTrials.length !== FEED_PERFORMANCE_THRESHOLDS.requiredTrialCount) {
    reasons.push({
      code: "trial_count",
      actual: normalizedTrials.length,
      expected: FEED_PERFORMANCE_THRESHOLDS.requiredTrialCount,
    });
  }

  trialSummaries.forEach((summary) => {
    if (summary.frameCount >= FEED_PERFORMANCE_THRESHOLDS.minimumFramesPerTrial) return;
    reasons.push({
      code: "trial_frame_count",
      actual: summary.frameCount,
      expected: FEED_PERFORMANCE_THRESHOLDS.minimumFramesPerTrial,
      trial: summary.trial,
    });
  });

  if (aggregate.p90Ms > FEED_PERFORMANCE_THRESHOLDS.maximumP90Ms) {
    reasons.push({
      code: "p90_limit",
      actual: aggregate.p90Ms,
      expected: FEED_PERFORMANCE_THRESHOLDS.maximumP90Ms,
    });
  }
  if (aggregate.p95Ms > FEED_PERFORMANCE_THRESHOLDS.maximumP95Ms) {
    reasons.push({
      code: "p95_limit",
      actual: aggregate.p95Ms,
      expected: FEED_PERFORMANCE_THRESHOLDS.maximumP95Ms,
    });
  }
  if (aggregate.frozenFrames > FEED_PERFORMANCE_THRESHOLDS.maximumFrozenFrames) {
    reasons.push({
      code: "frozen_frames",
      actual: aggregate.frozenFrames,
      expected: FEED_PERFORMANCE_THRESHOLDS.maximumFrozenFrames,
    });
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    aggregate,
    trials: trialSummaries,
  };
}

export function evaluateAndroidFrameStatsTrials(
  outputs: readonly string[],
): FeedPerformanceEvaluation {
  return evaluateFeedPerformanceTrials(outputs.map(parseAndroidFrameStats));
}

function framestatsColumns(cells: readonly string[]): FramestatsColumns | null {
  const flags = cells.indexOf("Flags");
  const intendedVsync = cells.indexOf("IntendedVsync");
  const frameCompleted = cells.indexOf("FrameCompleted");
  if (flags < 0 || intendedVsync < 0 || frameCompleted < 0) return null;
  return { flags, intendedVsync, frameCompleted };
}

function parseInteger(value: string | undefined): bigint | null {
  if (!value || !/^-?\d+$/u.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function validDurations(values: readonly number[]): number[] {
  return values.filter((value) => Number.isFinite(value) && value > 0);
}

function parseNonNegativeTimingField(output: string, field: string): number | null {
  const match = output.match(new RegExp(`^${field}:\\s*(\\d+)\\s*$`, "mu"));
  const value = Number(match?.[1]);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

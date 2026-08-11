import { describe, expect, it } from "vitest";
import {
  FEED_PERFORMANCE_THRESHOLDS,
  evaluateAndroidFrameStatsTrials,
  evaluateFeedPerformanceTrials,
  nearestRankPercentile,
  parseAndroidActivityStartTiming,
  parseAndroidFrameStats,
  summarizeFrameDurations,
} from "../../apps/mobile-native/src/performance/feed-performance";

const profileHeader = "Flags,IntendedVsync,Vsync,FrameCompleted";

function profile(...rows: string[]): string {
  return [
    "Graphics info for pid 1234",
    "---PROFILEDATA---",
    profileHeader,
    ...rows,
    "---PROFILEDATA---",
  ].join("\n");
}

describe("Android release feed framestats contract", () => {
  it("exports the fixed five-trial release thresholds", () => {
    expect(FEED_PERFORMANCE_THRESHOLDS).toEqual({
      requiredTrialCount: 5,
      minimumFramesPerTrial: 100,
      maximumP90Ms: 32,
      maximumP95Ms: 50,
      frozenFrameThresholdMs: 700,
      maximumFrozenFrames: 0,
    });
  });

  it("parses every PROFILEDATA CSV section and converts nanoseconds to milliseconds", () => {
    const output = [
      "unrelated preamble",
      profile("0,1000000000,1000000001,1016000000"),
      "unrelated middle text",
      profile("0,2000000000,2000000001,2032000000"),
    ].join("\r\n");

    expect(parseAndroidFrameStats(output)).toEqual([16, 32]);
  });

  it("parses complete am start -W activity timing without confusing similarly named fields", () => {
    const output = [
      "Starting: Intent { cmp=com.anssoft.akademiktakvim/.MainActivity }",
      "Status: ok",
      "LaunchState: COLD",
      "Activity: com.anssoft.akademiktakvim/.MainActivity",
      "ThisTime: 742",
      "TotalTime: 781",
      "WaitTime: 799",
      "Complete",
    ].join("\n");

    expect(parseAndroidActivityStartTiming(output)).toEqual({
      thisTimeMs: 742,
      totalTimeMs: 781,
      waitTimeMs: 799,
    });
  });

  it("rejects incomplete, negative, malformed, and unsafe am start -W timing", () => {
    expect(parseAndroidActivityStartTiming("ThisTime: 1\nTotalTime: 2")).toBeNull();
    expect(parseAndroidActivityStartTiming(
      "ThisTime: -1\nTotalTime: 2\nWaitTime: 3",
    )).toBeNull();
    expect(parseAndroidActivityStartTiming(
      "ThisTime: fast\nTotalTime: 2\nWaitTime: 3",
    )).toBeNull();
    expect(parseAndroidActivityStartTiming(
      "ThisTime: 9007199254740992\nTotalTime: 2\nWaitTime: 3",
    )).toBeNull();
  });

  it("ignores flagged, malformed, incomplete, zero, and negative-duration rows", () => {
    const output = profile(
      "1,1000000000,1000000001,1016000000",
      "0,not-a-timestamp,1000000001,1016000000",
      "0,1000000000,1000000001,not-a-timestamp",
      "0,1000000000,1000000001",
      "0,1000000000,1000000001,1000000000",
      "0,1016000000,1000000001,1000000000",
      "0,1000000000,1000000001,1700000000",
    );

    expect(parseAndroidFrameStats(output)).toEqual([700]);
    expect(parseAndroidFrameStats(`${profileHeader}\n0,0,0,16000000`)).toEqual([]);
  });

  it("uses nearest-rank percentiles with explicit empty and input boundaries", () => {
    const values = [40, 10, 30, 20];
    expect(nearestRankPercentile(values, 0.25)).toBe(10);
    expect(nearestRankPercentile(values, 0.5)).toBe(20);
    expect(nearestRankPercentile(values, 0.9)).toBe(40);
    expect(nearestRankPercentile(values, 1)).toBe(40);
    expect(nearestRankPercentile([], 0.9)).toBe(0);
    expect(() => nearestRankPercentile(values, 0)).toThrow(RangeError);
    expect(() => nearestRankPercentile(values, 1.01)).toThrow(RangeError);
  });

  it("summarizes valid frames and treats exactly 700 ms as frozen", () => {
    expect(summarizeFrameDurations([16, 32, 50, 700, 0, -1, Number.NaN])).toEqual({
      frameCount: 4,
      p90Ms: 700,
      p95Ms: 700,
      frozenFrames: 1,
    });
    expect(FEED_PERFORMANCE_THRESHOLDS.frozenFrameThresholdMs).toBe(700);
  });

  it("accepts five 100-frame trials at the aggregate p90 and p95 boundaries", () => {
    const boundaryTrial = [
      ...Array.from({ length: 90 }, () => FEED_PERFORMANCE_THRESHOLDS.maximumP90Ms),
      ...Array.from({ length: 10 }, () => FEED_PERFORMANCE_THRESHOLDS.maximumP95Ms),
    ];
    const trials = Array.from(
      { length: FEED_PERFORMANCE_THRESHOLDS.requiredTrialCount },
      () => [...boundaryTrial],
    );

    const result = evaluateFeedPerformanceTrials(trials);
    expect(result).toMatchObject({
      accepted: true,
      aggregate: {
        frameCount: 500,
        p90Ms: 32,
        p95Ms: 50,
        frozenFrames: 0,
      },
      reasons: [],
    });
    expect(result.trials.map((trial) => trial.frameCount)).toEqual([100, 100, 100, 100, 100]);
  });

  it("rejects the wrong trial count and any trial below 100 valid frames", () => {
    const fullTrial = Array.from(
      { length: FEED_PERFORMANCE_THRESHOLDS.minimumFramesPerTrial },
      () => 16,
    );
    const fourTrials = Array.from({ length: 4 }, () => [...fullTrial]);
    expect(evaluateFeedPerformanceTrials(fourTrials).reasons).toContainEqual({
      code: "trial_count",
      actual: 4,
      expected: 5,
    });

    const fiveTrials = [...fourTrials, fullTrial.slice(1)];
    const result = evaluateFeedPerformanceTrials(fiveTrials);
    expect(result.accepted).toBe(false);
    expect(result.reasons).toContainEqual({
      code: "trial_frame_count",
      actual: 99,
      expected: 100,
      trial: 5,
    });
  });

  it("evaluates percentiles over all trial frames rather than averaging trial summaries", () => {
    const trials = [
      ...Array.from({ length: 4 }, () => Array.from({ length: 100 }, () => 16)),
      Array.from({ length: 100 }, () => 50),
    ];
    const result = evaluateFeedPerformanceTrials(trials);

    expect(result.aggregate).toMatchObject({ frameCount: 500, p90Ms: 50, p95Ms: 50 });
    expect(result.accepted).toBe(false);
    expect(result.reasons).toContainEqual({
      code: "p90_limit",
      actual: 50,
      expected: 32,
    });
    expect(result.reasons.map((reason) => reason.code)).not.toContain("p95_limit");
  });

  it("rejects any aggregate frame at or above the frozen threshold", () => {
    const trials = Array.from(
      { length: FEED_PERFORMANCE_THRESHOLDS.requiredTrialCount },
      () => Array.from({ length: FEED_PERFORMANCE_THRESHOLDS.minimumFramesPerTrial }, () => 16),
    );
    trials[2]![50] = FEED_PERFORMANCE_THRESHOLDS.frozenFrameThresholdMs;

    const result = evaluateFeedPerformanceTrials(trials);
    expect(result.aggregate.frozenFrames).toBe(1);
    expect(result.accepted).toBe(false);
    expect(result.reasons).toContainEqual({
      code: "frozen_frames",
      actual: 1,
      expected: 0,
    });
  });

  it("can evaluate raw framestats outputs directly for a future Android runner", () => {
    const trialOutput = profile(
      ...Array.from(
        { length: FEED_PERFORMANCE_THRESHOLDS.minimumFramesPerTrial },
        (_, index) => {
          const intended = BigInt(index + 1) * 1_000_000_000n;
          return `0,${intended},${intended},${intended + 16_000_000n}`;
        },
      ),
    );
    const result = evaluateAndroidFrameStatsTrials(
      Array.from({ length: FEED_PERFORMANCE_THRESHOLDS.requiredTrialCount }, () => trialOutput),
    );

    expect(result.accepted).toBe(true);
    expect(result.aggregate).toEqual({
      frameCount: 500,
      p90Ms: 16,
      p95Ms: 16,
      frozenFrames: 0,
    });
  });
});

export interface ConfidenceScoreInput {
  dateClarity: number;
  titleClarity: number;
  categoryClarity: number;
  ocrQuality: number;
  tableRowQuality: number;
  academicYearClarity: number;
  scopeClarity: number;
  duplicateRisk: number;
  sourcePageClarity: number;
}

export interface ConfidenceScoreResult {
  score: number;
  band: "high" | "medium" | "low" | "manual_required";
  reviewRequired: boolean;
}

const weights: Record<keyof ConfidenceScoreInput, number> = {
  dateClarity: 0.22,
  titleClarity: 0.15,
  categoryClarity: 0.13,
  ocrQuality: 0.12,
  tableRowQuality: 0.1,
  academicYearClarity: 0.1,
  scopeClarity: 0.08,
  duplicateRisk: 0.06,
  sourcePageClarity: 0.04
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function calculateConfidenceScore(input: ConfidenceScoreInput): ConfidenceScoreResult {
  const normalizedInput: ConfidenceScoreInput = {
    dateClarity: clampPercent(input.dateClarity),
    titleClarity: clampPercent(input.titleClarity),
    categoryClarity: clampPercent(input.categoryClarity),
    ocrQuality: clampPercent(input.ocrQuality),
    tableRowQuality: clampPercent(input.tableRowQuality),
    academicYearClarity: clampPercent(input.academicYearClarity),
    scopeClarity: clampPercent(input.scopeClarity),
    duplicateRisk: clampPercent(100 - input.duplicateRisk),
    sourcePageClarity: clampPercent(input.sourcePageClarity)
  };

  const score = Math.round(
    Object.entries(normalizedInput).reduce((total, [key, value]) => {
      return total + value * weights[key as keyof ConfidenceScoreInput];
    }, 0)
  );

  if (score >= 90) return { score, band: "high", reviewRequired: false };
  if (score >= 70) return { score, band: "medium", reviewRequired: true };
  if (score >= 50) return { score, band: "low", reviewRequired: true };
  return { score, band: "manual_required", reviewRequired: true };
}

export const pdfPipelineSteps = [
  "uploaded",
  "validated",
  "stored",
  "hashed",
  "queued",
  "text_layer_checked",
  "text_extracted",
  "table_extracted",
  "ocr_required",
  "ocr_completed",
  "events_normalized",
  "confidence_scored",
  "pending_admin_review",
  "processed",
  "failed"
] as const;

export type PdfPipelineStep = (typeof pdfPipelineSteps)[number];

export interface PdfProcessingState {
  pdfSourceId: string;
  currentStep: PdfPipelineStep;
  completedSteps: PdfPipelineStep[];
  errorCode?: string;
  errorMessage?: string;
  retryable: boolean;
}

export function transitionPdfState(state: PdfProcessingState, nextStep: PdfPipelineStep): PdfProcessingState {
  const completedSteps = state.completedSteps.includes(state.currentStep)
    ? state.completedSteps
    : [...state.completedSteps, state.currentStep];

  return {
    ...state,
    currentStep: nextStep,
    completedSteps,
    retryable: nextStep !== "processed" && nextStep !== "pending_admin_review"
  };
}

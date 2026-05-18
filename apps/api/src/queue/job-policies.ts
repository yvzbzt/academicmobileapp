export interface QueueJobPolicy {
  name: string;
  retryCount: number;
  timeoutMs: number;
  priority: 1 | 2 | 3 | 4 | 5;
  failureHandling: string;
  deadLetter: boolean;
}

export const queueJobPolicies: QueueJobPolicy[] = [
  { name: "pdf_download_job", retryCount: 3, timeoutMs: 60000, priority: 2, failureHandling: "Mark pdf source download_failed", deadLetter: true },
  { name: "pdf_validation_job", retryCount: 1, timeoutMs: 30000, priority: 1, failureHandling: "Reject unsafe source", deadLetter: false },
  { name: "pdf_parse_job", retryCount: 2, timeoutMs: 120000, priority: 2, failureHandling: "Mark parse failed with parser error", deadLetter: true },
  { name: "ocr_job", retryCount: 1, timeoutMs: 300000, priority: 4, failureHandling: "Mark OCR required or OCR failed", deadLetter: true },
  { name: "event_normalization_job", retryCount: 2, timeoutMs: 60000, priority: 2, failureHandling: "Keep raw extraction for manual review", deadLetter: true },
  { name: "duplicate_check_job", retryCount: 2, timeoutMs: 30000, priority: 2, failureHandling: "Require manual duplicate review", deadLetter: true },
  { name: "confidence_score_job", retryCount: 2, timeoutMs: 30000, priority: 2, failureHandling: "Set confidence score to 0 and require review", deadLetter: true },
  { name: "admin_review_create_job", retryCount: 3, timeoutMs: 30000, priority: 2, failureHandling: "Alert content operations", deadLetter: true },
  { name: "notification_schedule_job", retryCount: 3, timeoutMs: 180000, priority: 3, failureHandling: "Retry batch and mark failed jobs", deadLetter: true },
  { name: "notification_send_job", retryCount: 5, timeoutMs: 30000, priority: 1, failureHandling: "Retry with backoff, invalidate bad tokens", deadLetter: true },
  { name: "stale_pdf_check_job", retryCount: 2, timeoutMs: 60000, priority: 5, failureHandling: "Log and retry next schedule", deadLetter: false },
  { name: "cache_invalidation_job", retryCount: 5, timeoutMs: 15000, priority: 1, failureHandling: "Retry aggressively", deadLetter: true },
  { name: "audit_log_job", retryCount: 5, timeoutMs: 15000, priority: 1, failureHandling: "Persist to fallback log on final failure", deadLetter: true },
  { name: "email_job", retryCount: 3, timeoutMs: 30000, priority: 4, failureHandling: "Retry and mark email failed", deadLetter: true }
];

import { BadRequestException, ConflictException, Inject, Injectable, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";
import {
  OPENAI_RESPONSES_URL,
  safeOutboundRequest
} from "../../common/network/safe-outbound-request.js";
import { contentLlmSettingsSchema } from "../../database/mongoose-schemas.js";
import { getModel, toDomainRecord } from "../../database/mongoose-utils.js";
import { MongoConnectionService } from "../../database/mongo-connection.service.js";
import { protectSensitiveValue, revealSensitiveValue } from "../../security/data-protection.js";
import { AuditService } from "../audit/audit.service.js";
import type { AnnouncementItem, AnnouncementLlmClassification } from "./announcements.types.js";

const SETTINGS_ID = "academic-content-review";
const API_KEY_PURPOSE = "content-llm-api-key";
const OPENAI_MAXIMUM_REQUEST_BYTES = 128 * 1024;
const OPENAI_MAXIMUM_RESPONSE_BYTES = 1024 * 1024;
const MAXIMUM_MODEL_NAME_LENGTH = 128;

export interface ContentLlmSettingsView {
  enabled: boolean;
  provider: "openai";
  model: string;
  apiKeyConfigured: boolean;
  keyLastFour?: string;
  lastTestStatus: "untested" | "success" | "failed";
  lastTestedAt?: string;
  updatedAt?: string;
  revision: number;
}

interface ContentLlmSettingsRecord {
  id: string;
  enabled: boolean;
  provider: "openai";
  model: string;
  encryptedApiKey?: string;
  keyLastFour?: string;
  lastTestStatus?: "untested" | "success" | "failed";
  lastTestedAt?: Date;
  revision?: number;
  updatedBy?: string;
  updatedAt?: Date;
}

interface ContentLlmSettingsUpdate {
  expectedRevision: number;
  enabled: boolean;
  provider: "openai";
  model: string;
  apiKey?: string;
}

@Injectable()
export class ContentLlmSettingsService {
  constructor(
    @Inject(MongoConnectionService) private readonly mongo: MongoConnectionService,
    @Inject(AuditService) private readonly auditService: AuditService
  ) {}

  async getSettings(): Promise<ContentLlmSettingsView> {
    return settingsView(await this.loadSettings());
  }

  async updateSettings(input: ContentLlmSettingsUpdate, actorId: string): Promise<ContentLlmSettingsView> {
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new BadRequestException("expectedRevision must be a non-negative integer.");
    }
    const modelName = input.model.trim();
    if (!modelName) throw new BadRequestException("LLM model is required.");
    if (modelName.length > MAXIMUM_MODEL_NAME_LENGTH) throw new BadRequestException("LLM model is too long.");
    const apiKey = input.apiKey?.trim();
    const model = await this.model();
    const currentDocument = await model.findById(SETTINGS_ID);
    const current = currentDocument
      ? toDomainRecord<ContentLlmSettingsRecord>(currentDocument)
      : null;
    if ((current ? settingsRevision(current) : 0) !== input.expectedRevision) {
      throw new ConflictException("LLM settings changed after they were loaded. Refresh and retry.");
    }
    if (input.enabled && !apiKey && !current?.encryptedApiKey) {
      throw new BadRequestException("An LLM API key must be configured before enabling LLM review.");
    }
    const encryptedApiKey = apiKey ? protectSensitiveValue(apiKey, API_KEY_PURPOSE) : undefined;
    const credentialsChanged = Boolean(apiKey) || current?.model !== modelName;
    let document;
    try {
      document = await model.findOneAndUpdate(
        { _id: SETTINGS_ID, ...settingsRevisionFilter(current) },
        {
          $set: {
            enabled: input.enabled,
            provider: "openai",
            model: modelName,
            updatedBy: actorId,
            ...(encryptedApiKey ? { encryptedApiKey, keyLastFour: apiKey!.slice(-4) } : {}),
            ...(credentialsChanged ? { lastTestStatus: "untested" } : {})
          },
          $setOnInsert: { _id: SETTINGS_ID },
          $inc: { revision: 1 },
          ...(credentialsChanged ? { $unset: { lastTestedAt: 1 } } : {})
        },
        { new: true, upsert: !current, setDefaultsOnInsert: true, runValidators: true }
      );
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
    if (!document) {
      throw new ConflictException("LLM settings changed while they were being updated. Retry the update.");
    }
    await this.auditService.record({
      actorId,
      action: "content_llm.settings_updated",
      entityType: "content_llm_settings",
      entityId: SETTINGS_ID,
      metadata: { enabled: input.enabled, provider: "openai", model: modelName, apiKeyRotated: Boolean(apiKey) }
    });
    return settingsView(toDomainRecord<ContentLlmSettingsRecord>(document));
  }

  async deleteApiKey(actorId: string, expectedRevision: number): Promise<ContentLlmSettingsView> {
    const model = await this.model();
    const currentDocument = await model.findById(SETTINGS_ID);
    const current = currentDocument
      ? toDomainRecord<ContentLlmSettingsRecord>(currentDocument)
      : null;
    if (!current?.encryptedApiKey) throw new BadRequestException("LLM API key is not configured.");
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || settingsRevision(current) !== expectedRevision) {
      throw new ConflictException("LLM settings changed after they were loaded. Refresh and retry.");
    }
    const document = await model.findOneAndUpdate(
      { _id: SETTINGS_ID, ...settingsRevisionFilter(current) },
      {
        $set: { enabled: false, lastTestStatus: "untested", updatedBy: actorId },
        $unset: { encryptedApiKey: 1, keyLastFour: 1, lastTestedAt: 1 },
        $inc: { revision: 1 }
      },
      { new: true, runValidators: true }
    );
    if (!document) {
      throw new ConflictException("LLM settings changed while the API key was being removed. Refresh and retry.");
    }
    await this.auditService.record({
      actorId,
      action: "content_llm.api_key_deleted",
      entityType: "content_llm_settings",
      entityId: SETTINGS_ID,
      metadata: {}
    });
    return settingsView(toDomainRecord<ContentLlmSettingsRecord>(document));
  }

  async testConnection(actorId: string): Promise<ContentLlmSettingsView> {
    const settings = await this.requireStoredSettings(false);
    let lastTestStatus: "success" | "failed" = "failed";
    try {
      await this.requestClassification(settings, {
        id: "connection-test",
        sourceId: "connection-test",
        sourceName: "Connection test",
        scopeType: "university",
        scopeId: "connection-test",
        title: "2026-2027 ders kayıt tarihleri",
        link: "https://example.edu.tr/duyuru/connection-test",
        trustStatus: "trusted"
      });
      lastTestStatus = "success";
    } catch {
      lastTestStatus = "failed";
    }
    const lastTestedAt = new Date();
    const document = await (await this.model()).findOneAndUpdate(
      {
        _id: SETTINGS_ID,
        encryptedApiKey: settings.encryptedApiKey,
        model: settings.model,
        ...settingsRevisionFilter(settings)
      },
      {
        $set: { lastTestStatus, lastTestedAt, updatedBy: actorId },
        $inc: { revision: 1 }
      },
      { new: true, runValidators: true }
    );
    if (!document) throw new ConflictException("LLM settings changed while the connection test was running. Retry the test.");
    await this.auditService.record({
      actorId,
      action: "content_llm.connection_tested",
      entityType: "content_llm_settings",
      entityId: SETTINGS_ID,
      metadata: { status: lastTestStatus }
    });
    return settingsView(toDomainRecord<ContentLlmSettingsRecord>(document));
  }

  async classify(item: AnnouncementItem): Promise<AnnouncementLlmClassification> {
    const settings = await this.requireStoredSettings(true);
    return this.requestClassification(settings, item);
  }

  async assertReviewReady(): Promise<void> {
    await this.requireStoredSettings(true);
  }

  private async requestClassification(
    settings: ContentLlmSettingsRecord & { encryptedApiKey: string },
    item: AnnouncementItem
  ): Promise<AnnouncementLlmClassification> {
    const apiKey = revealSensitiveValue(settings.encryptedApiKey, API_KEY_PURPOSE);
    let response;
    try {
      response = await safeOutboundRequest(OPENAI_RESPONSES_URL, {
        timeoutMs: readPositiveInteger(process.env.CONTENT_LLM_TIMEOUT_MS, 20_000),
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: settings.model,
          store: false,
          max_output_tokens: 600,
          input: [
            {
              role: "developer",
              content: [{
                type: "input_text",
                text: "Classify Turkish university content for students. Use only the supplied text. Be conservative when evidence is missing."
              }]
            },
            {
              role: "user",
              content: [{ type: "input_text", text: contentReviewInput(item) }]
            }
          ],
          text: {
            format: {
              type: "json_schema",
              name: "academic_content_classification",
              strict: true,
              schema: classificationJsonSchema
            }
          }
        }),
        maximumRedirects: 0,
        maximumRequestBytes: OPENAI_MAXIMUM_REQUEST_BYTES,
        maximumResponseBytes: OPENAI_MAXIMUM_RESPONSE_BYTES,
        providerPolicy: "openai-responses"
      });
    } catch {
      // Never surface provider/network error details: they can include request
      // headers, bodies, or credentials depending on the HTTP implementation.
      throw new ServiceUnavailableException("LLM provider is temporarily unavailable.");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new ServiceUnavailableException("LLM provider request failed.");
    }
    let payload: unknown;
    try {
      payload = JSON.parse(response.body.toString("utf8"));
    } catch {
      // Do not include provider response bytes in errors or logs.
      throw new ServiceUnavailableException("LLM provider returned an invalid response.");
    }
    const parsed = parseClassificationPayload(payload);
    return {
      provider: "openai",
      model: settings.model,
      ...parsed,
      analyzedAt: new Date().toISOString()
    };
  }

  private async requireStoredSettings(requireEnabled: boolean): Promise<ContentLlmSettingsRecord & { encryptedApiKey: string }> {
    const settings = await this.loadSettings();
    if (!settings?.encryptedApiKey) throw new BadRequestException("LLM API key is not configured.");
    if (requireEnabled && !settings.enabled) throw new BadRequestException("LLM review is disabled.");
    return settings as ContentLlmSettingsRecord & { encryptedApiKey: string };
  }

  private async loadSettings(): Promise<ContentLlmSettingsRecord | null> {
    const document = await (await this.model()).findById(SETTINGS_ID);
    return document ? toDomainRecord<ContentLlmSettingsRecord>(document) : null;
  }

  private async model() {
    const connection = this.mongo.getConnection() ?? (await this.mongo.connect());
    if (!connection) throw new Error("MONGODB_NOT_CONFIGURED");
    return getModel(connection, "ContentLlmSettings", contentLlmSettingsSchema);
  }
}

function settingsView(settings: ContentLlmSettingsRecord | null): ContentLlmSettingsView {
  if (!settings) {
    return {
      enabled: false,
      provider: "openai",
      model: defaultModel(),
      apiKeyConfigured: false,
      lastTestStatus: "untested",
      revision: 0
    };
  }
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    model: settings.model,
    apiKeyConfigured: Boolean(settings.encryptedApiKey),
    ...(settings.keyLastFour ? { keyLastFour: settings.keyLastFour } : {}),
    lastTestStatus: settings.lastTestStatus ?? "untested",
    revision: settingsRevision(settings),
    ...(settings.lastTestedAt ? { lastTestedAt: settings.lastTestedAt.toISOString() } : {}),
    ...(settings.updatedAt ? { updatedAt: settings.updatedAt.toISOString() } : {})
  };
}

function settingsRevision(settings: Pick<ContentLlmSettingsRecord, "revision">): number {
  return Number.isSafeInteger(settings.revision) && (settings.revision ?? -1) >= 0
    ? settings.revision!
    : 0;
}

function defaultModel(): string {
  return process.env.CONTENT_LLM_DEFAULT_MODEL?.trim() || "gpt-5-mini";
}

const classificationJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    studentRelevance: { type: "string", enum: ["relevant", "not_relevant", "uncertain"] },
    topic: {
      type: "string",
      enum: [
        "academic_calendar", "admission", "course_registration", "course_schedule", "double_major_minor",
        "education_opportunity", "exam", "horizontal_transfer", "scholarship", "internship", "exchange",
        "graduation", "tuition", "housing", "competition", "student_achievement", "student_event",
        "personnel_recruitment", "procurement", "internal_operations", "unknown"
      ]
    },
    audience: {
      anyOf: [
        { type: "string", enum: ["unknown"] },
        {
          type: "array",
          minItems: 1,
          items: {
            type: "string",
            enum: ["all_students", "prospective_students", "associate_students", "bachelor_students", "master_students", "doctoral_students", "graduates"]
          }
        }
      ]
    },
    actionType: { type: "string", enum: ["apply", "attend", "pay", "register", "review", "submit", "unknown"] },
    deadline: { type: "string", pattern: "^(?:unknown|\\d{4}-\\d{2}-\\d{2})$" },
    urgency: { type: "string", enum: ["critical", "high", "normal", "low", "unknown"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    rationale: { type: "string" }
  },
  required: ["studentRelevance", "topic", "audience", "actionType", "deadline", "urgency", "confidence", "rationale"]
} as const;

function contentReviewInput(item: AnnouncementItem): string {
  const body = item.body?.map((block) => block.text).join("\n") ?? "";
  return [
    `Content type: ${item.contentType ?? "announcement"}`,
    `Title: ${item.title}`,
    `Summary: ${item.summary ?? ""}`,
    `Body: ${body}`
  ].join("\n").slice(0, 24_000);
}

function parseClassificationPayload(payload: unknown): Omit<AnnouncementLlmClassification, "provider" | "model" | "analyzedAt"> {
  const outputText = extractOutputText(payload);
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new ServiceUnavailableException("LLM provider returned invalid structured output.");
  }
  if (!isRecord(parsed)) throw new ServiceUnavailableException("LLM provider returned invalid structured output.");
  const confidence = parsed.confidence;
  const rationale = parsed.rationale;
  const deadline = parsed.deadline;
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1 || typeof rationale !== "string" || !rationale.trim()
    || typeof deadline !== "string" || !isCalendarDateOrUnknown(deadline)) {
    throw new ServiceUnavailableException("LLM provider returned invalid structured output.");
  }
  return {
    studentRelevance: readEnum(parsed.studentRelevance, studentRelevanceValues),
    topic: readEnum(parsed.topic, topicValues),
    audience: readAudience(parsed.audience),
    actionType: readEnum(parsed.actionType, actionTypeValues),
    deadline,
    urgency: readEnum(parsed.urgency, urgencyValues),
    confidence,
    rationale: rationale.slice(0, 500)
  };
}

const studentRelevanceValues = ["relevant", "not_relevant", "uncertain"] as const;
const topicValues = [
  "academic_calendar", "admission", "course_registration", "course_schedule", "double_major_minor",
  "education_opportunity", "exam", "horizontal_transfer", "scholarship", "internship", "exchange",
  "graduation", "tuition", "housing", "competition", "student_achievement", "student_event",
  "personnel_recruitment", "procurement", "internal_operations", "unknown"
] as const;
const audienceValues = [
  "all_students", "prospective_students", "associate_students", "bachelor_students",
  "master_students", "doctoral_students", "graduates"
] as const;
const actionTypeValues = ["apply", "attend", "pay", "register", "review", "submit", "unknown"] as const;
const urgencyValues = ["critical", "high", "normal", "low", "unknown"] as const;

function readEnum<const TValues extends readonly string[]>(value: unknown, values: TValues): TValues[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new ServiceUnavailableException("LLM provider returned invalid structured output.");
  }
  return value as TValues[number];
}

function readAudience(value: unknown): NonNullable<AnnouncementItem["audience"]> {
  if (value === "unknown") return value;
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || !(audienceValues as readonly string[]).includes(entry))) {
    throw new ServiceUnavailableException("LLM provider returned invalid structured output.");
  }
  return [...new Set(value)] as NonNullable<AnnouncementItem["audience"]>;
}

function isCalendarDateOrUnknown(value: string): boolean {
  if (value === "unknown") return true;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/u);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function extractOutputText(payload: unknown): string {
  if (!isRecord(payload)) throw new ServiceUnavailableException("LLM provider returned an invalid response.");
  if (typeof payload.output_text === "string" && payload.output_text.trim()) return payload.output_text;
  if (!Array.isArray(payload.output)) throw new ServiceUnavailableException("LLM provider returned an invalid response.");
  let refused = false;
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") return content.text;
      if (isRecord(content) && content.type === "refusal") refused = true;
    }
  }
  if (refused) throw new UnprocessableEntityException("LLM provider refused to classify this content.");
  throw new ServiceUnavailableException("LLM provider returned no structured output.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function settingsRevisionFilter(settings: Pick<ContentLlmSettingsRecord, "revision"> | null): Record<string, unknown> {
  return Number.isSafeInteger(settings?.revision) && (settings?.revision ?? -1) >= 0
    ? { revision: settings!.revision }
    : { revision: { $exists: false } };
}

function isDuplicateKeyError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === 11_000);
}

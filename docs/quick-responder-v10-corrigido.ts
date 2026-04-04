// index.ts
import { createClient } from "jsr:@supabase/supabase-js@2";

const JOTFORM_QUESTION_TEXTS_KEY = "__jotform_question_texts";
const JOTFORM_QUESTION_CACHE_TABLE = "jotform_form_questions_cache";
const DEFAULT_JOTFORM_QUESTION_CACHE_HOURS = 24;
const JSON_HEADERS = { "Content-Type": "application/json" };

type JotformQuestionCatalog = {
  by_base_code: Record<string, string>;
  by_question_id: Record<string, string>;
};

type AudioFromWebhook = {
  audioUrl: string;
  durationMs: number | null;
  canonicalDurationMs: number | null;
  canonicalDurationSource: "blobDecoded" | "activeRecording" | "payloadDuration" | "legacy" | null;
  recordingId: string | null;
  wallClockMs: number | null;
  activeRecordingMs: number | null;
  blobDecodedMs: number | null;
  driftMs: number | null;
  driftPct: number | null;
  debug: Record<string, unknown> | null;
  trackerConfig: Record<string, unknown> | null;
  payloadRaw: Record<string, unknown> | null;
  sizeBytes: number | null;
  mimeType: string | null;
  extension: string | null;
  recordedAt: string | null;
  payloadVersion: number | null;
  sourceField: string;
};

type AiGenerationOptions = {
  provider: string;
  groqKey: string;
  openaiKey: string;
  groqModel: string;
  openaiModel: string;
  promptText?: string | null;
};

type AiGenerationResult = {
  notes: string;
  modelName: string;
};

console.log("quick-responder v10 (translator + audio v3) loaded");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function readWebhookPayload(req: Request): Promise<Record<string, unknown>> {
  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();

  if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
    const formData = await req.formData();
    const payload: Record<string, unknown> = {};
    formData.forEach((value, key) => {
      payload[key] = value instanceof File ? value.name : value;
    });
    return payload;
  }

  if (contentType.includes("application/json")) {
    const parsed = await req.json();
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  }

  const text = await req.text();
  const trimmed = text.trim();
  if (!trimmed) return {};

  const parsedJson = safeJsonParse(trimmed);
  if (parsedJson) return parsedJson;

  const params = new URLSearchParams(trimmed);
  const payload: Record<string, unknown> = {};
  for (const [key, value] of params.entries()) {
    payload[key] = value;
  }
  return payload;
}

function mergeRawRequestPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const rawRequest = payload.rawRequest;
  if (typeof rawRequest !== "string" || !rawRequest.trim()) {
    return payload;
  }

  try {
    const parsed = JSON.parse(rawRequest);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return { ...payload, ...(parsed as Record<string, unknown>) };
    }
  } catch (err) {
    console.error("rawRequest parse error:", err);
  }

  return payload;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Use POST" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseKey) {
      return jsonResponse({ error: "Config error: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing" }, 500);
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    const groqKey = Deno.env.get("GROQ_API_KEY") ?? "";
    const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
    const aiProviderDefault = (Deno.env.get("AI_PROVIDER_DEFAULT") ?? "groq").toLowerCase();
    const groqModel = Deno.env.get("GROQ_MODEL") ?? "llama-3.1-8b-instant";
    const openaiModel = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
    const jotformApiKey = Deno.env.get("JOTFORM_API_KEY") ?? "";
    const jotformQuestionCacheHours = parsePositiveInteger(
      Deno.env.get("JOTFORM_QUESTION_CACHE_HOURS"),
      DEFAULT_JOTFORM_QUESTION_CACHE_HOURS,
    );

    let payload = await readWebhookPayload(req);
    payload = mergeRawRequestPayload(payload);

    const formID = payload.formID || payload.formId || "Nao encontrado";
    const submissionID = payload.submissionID || payload.submissionId || "Nao encontrado";

    let finalAudioUrl: string | null = null;
    let finalLat: number | null = null;
    let finalLong: number | null = null;
    let rawUserAgent: string | null = null;

    const audioFromWebhook = extractAudioFromWebhook(payload);
    if (audioFromWebhook?.audioUrl) {
      finalAudioUrl = audioFromWebhook.audioUrl;
    }

    const storagePublicSign = "/storage/v1/object/public/";
    for (const key in payload) {
      if (key === "rawRequest") continue;

      const val = payload[key];
      if (typeof val !== "string") continue;

      const latMatch = val.match(/Latitude:\s*([-\d.]+)/i);
      const longMatch = val.match(/Longitude:\s*([-\d.]+)/i);
      if (latMatch) {
        const parsedLat = Number(latMatch[1]);
        if (Number.isFinite(parsedLat)) finalLat = parsedLat;
      }
      if (longMatch) {
        const parsedLong = Number(longMatch[1]);
        if (Number.isFinite(parsedLong)) finalLong = parsedLong;
      }

      if (!rawUserAgent && !val.includes(storagePublicSign)) {
        if (
          val.includes("Mozilla") ||
          val.includes("Chrome") ||
          val.includes("Android") ||
          val.includes("Safari")
        ) {
          if (val.length > 20 && !val.trim().startsWith("{")) {
            rawUserAgent = val;
          }
        }
      }
    }

    let simplifiedDevice: string | null = null;
    if (rawUserAgent) {
      simplifiedDevice = simplifyUserAgent(rawUserAgent);
    }

    const durationFromPayloadMs =
      audioFromWebhook?.canonicalDurationMs ??
      audioFromWebhook?.durationMs ??
      null;

    let derivedAudioDurationSec = durationFromPayloadMs !== null
      ? normalizeAudioSeconds(durationFromPayloadMs / 1000)
      : null;
    if (derivedAudioDurationSec === null) {
      derivedAudioDurationSec = extractAudioDurationSeconds(payload);
    }

    const isLegacyAudioPayload = (audioFromWebhook?.payloadVersion ?? 1) <= 1;
    if (derivedAudioDurationSec === null && finalAudioUrl && (isLegacyAudioPayload || durationFromPayloadMs === null)) {
      derivedAudioDurationSec = await detectAudioDurationFromUrl(finalAudioUrl);
    }

    if (derivedAudioDurationSec !== null) {
      payload.audio_duration = derivedAudioDurationSec;
      payload.audio_duration_sec = derivedAudioDurationSec;
    }
    if (durationFromPayloadMs !== null) {
      payload.audio_duration_ms = durationFromPayloadMs;
    }
    if (audioFromWebhook?.canonicalDurationSource) {
      payload.audio_duration_source = audioFromWebhook.canonicalDurationSource;
    }
    if (audioFromWebhook?.recordingId) {
      payload.audio_recording_id = audioFromWebhook.recordingId;
    }
    if (audioFromWebhook?.sizeBytes !== null && audioFromWebhook?.sizeBytes !== undefined) {
      payload.audio_size_bytes = audioFromWebhook.sizeBytes;
    }
    if (audioFromWebhook?.mimeType) {
      payload.audio_mime_type = audioFromWebhook.mimeType;
    }
    if (audioFromWebhook?.extension) {
      payload.audio_extension = audioFromWebhook.extension;
    }
    if (audioFromWebhook?.recordedAt) {
      payload.audio_recorded_at = audioFromWebhook.recordedAt;
    }
    if (audioFromWebhook?.payloadVersion !== null && audioFromWebhook?.payloadVersion !== undefined) {
      payload.audio_payload_version = audioFromWebhook.payloadVersion;
    }
    if (audioFromWebhook?.sourceField) {
      payload.audio_source_field = audioFromWebhook.sourceField;
    }
    if (audioFromWebhook?.wallClockMs !== null && audioFromWebhook?.wallClockMs !== undefined) {
      payload.audio_wall_clock_ms = audioFromWebhook.wallClockMs;
    }
    if (audioFromWebhook?.activeRecordingMs !== null && audioFromWebhook?.activeRecordingMs !== undefined) {
      payload.audio_active_recording_ms = audioFromWebhook.activeRecordingMs;
    }
    if (audioFromWebhook?.blobDecodedMs !== null && audioFromWebhook?.blobDecodedMs !== undefined) {
      payload.audio_blob_decoded_ms = audioFromWebhook.blobDecodedMs;
    }
    if (audioFromWebhook?.driftMs !== null && audioFromWebhook?.driftMs !== undefined) {
      payload.audio_drift_ms = audioFromWebhook.driftMs;
    }
    if (audioFromWebhook?.driftPct !== null && audioFromWebhook?.driftPct !== undefined) {
      payload.audio_drift_pct = audioFromWebhook.driftPct;
    }
    if (audioFromWebhook?.debug) {
      payload.audio_debug = audioFromWebhook.debug;
    }
    if (audioFromWebhook?.trackerConfig) {
      payload.audio_tracker_config = audioFromWebhook.trackerConfig;
    }
    if (audioFromWebhook?.payloadRaw) {
      payload.audio_payload = audioFromWebhook.payloadRaw;
    }

    const ipAddress = parseOptionalText(payload.ip) ?? parseOptionalText(payload.ip_address);

    const { data: projectData, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("jotform_form_id", String(formID))
      .single();

    if (projectError || !projectData) {
      return jsonResponse({ message: "Ignorado: projeto desconhecido" }, 200);
    }

    const questionTextMap = await resolveSubmissionQuestionTexts(
      supabase,
      payload,
      formID,
      jotformApiKey,
      jotformQuestionCacheHours,
    );
    if (Object.keys(questionTextMap).length > 0) {
      payload[JOTFORM_QUESTION_TEXTS_KEY] = questionTextMap;
    }

    const defaultStatus = "Auditado AI";
    const collectionInsertPayload: Record<string, unknown> = {
      project_id: projectData.id,
      jotform_submission_id: String(submissionID),
      raw_response: payload,
      audio_url: finalAudioUrl,
      audio_payload_version: audioFromWebhook?.payloadVersion ?? null,
      audio_payload: audioFromWebhook?.payloadRaw ?? {},
      audio_recording_id: audioFromWebhook?.recordingId ?? null,
      audio_duration_ms: durationFromPayloadMs,
      audio_duration_source: audioFromWebhook?.canonicalDurationSource ?? null,
      audio_duration_updated_at: durationFromPayloadMs !== null ? new Date().toISOString() : null,
      latitude: finalLat,
      longitude: finalLong,
      ip_address: ipAddress,
      device_info: simplifiedDevice,
      status: defaultStatus,
    };

    const { data: collectionData, error: insertError } = await supabase
      .from("collections")
      .insert(collectionInsertPayload)
      .select("id")
      .single();

    if (insertError) {
      console.error("collections insert error:", insertError);
      return jsonResponse({
        error: insertError.message,
        details: insertError.details ?? null,
        hint: insertError.hint ?? null,
        step: "insert_collections",
      }, 500);
    }

    await patchAudioUploadEventFromWebhook(supabase, audioFromWebhook);

    const collectionId = collectionData?.id;
    if (collectionId) {
      const projectPromptText = await resolveProjectPromptText(supabase, String(projectData.id));
      const aiResult = await generateAiNotes(payload, {
        provider: aiProviderDefault,
        groqKey,
        openaiKey,
        groqModel,
        openaiModel,
        promptText: projectPromptText,
      });

      const { error: aiError } = await supabase
        .from("collection_ai_review")
        .insert({
          collection_id: collectionId,
          ai_status: defaultStatus,
          ai_score: null,
          ai_notes: aiResult.notes,
          model_name: aiResult.modelName,
        });
      if (aiError) {
        console.error("ai insert error:", aiError);
      }

      const { error: logError } = await supabase
        .from("collection_status_log")
        .insert({
          collection_id: collectionId,
          old_status: null,
          new_status: defaultStatus,
          changed_by: "IA",
          source: "ai",
        });
      if (logError) {
        console.error("status log insert error:", logError);
      }

      const interviewerAnswer = getAnswerByQuestionName(payload, "Agradecimento_Entrevistador");
      const isTrainingSubmission = String(interviewerAnswer || "").trim().toLowerCase() === "teste";
      const hasAudioLink = Boolean(finalAudioUrl && String(finalAudioUrl).trim());

      const filterCodes = new Set(["I1P2", "FE2P5", "FE2P6", "FE2P7", "FE2P8", "FE2P9", "FE2P10"]);
      const lastAnswered = findLastAnsweredQuestion(payload);
      const shouldSetAbordagem = Boolean(lastAnswered && filterCodes.has(lastAnswered.baseCode));

      let automaticStatus: string | null = null;
      if (isTrainingSubmission) {
        automaticStatus = "Treinamento";
      } else if (!hasAudioLink) {
        automaticStatus = "Reprovado: Codigo 4 | Sem audio";
      } else if (shouldSetAbordagem) {
        automaticStatus = "Abordagem";
      }

      if (automaticStatus && automaticStatus !== defaultStatus) {
        const { error: updateStatusError } = await supabase
          .from("collections")
          .update({ status: automaticStatus })
          .eq("id", collectionId);
        if (updateStatusError) {
          console.error("automatic status update error:", updateStatusError);
        }

        const { error: filterLogError } = await supabase
          .from("collection_status_log")
          .insert({
            collection_id: collectionId,
            old_status: defaultStatus,
            new_status: automaticStatus,
            changed_by: "IA",
            source: "ai",
          });
        if (filterLogError) {
          console.error("automatic status log insert error:", filterLogError);
        }
      }
    }

    return jsonResponse({ message: "Processado." }, 200);
  } catch (err) {
    console.error("quick-responder unhandled error:", err);
    return jsonResponse({ error: errorMessage(err), step: "unhandled" }, 500);
  }
});

function safeJsonParse(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseOptionalObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function extractFirstUrl(text: string): string | null {
  const found = text.match(/https?:\/\/[^\s,"]+/i)?.[0] ?? null;
  if (!found) return null;
  return found.replace(/[)\].,;]+$/, "");
}

function parseNonNegativeNumber(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  return numeric;
}

function parseSignedInteger(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.trunc(numeric);
}

function parseFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric;
}

function normalizeAudioMilliseconds(value: unknown): number | null {
  const numeric = parseNonNegativeNumber(value);
  if (numeric === null) return null;
  if (numeric > (8 * 3600 * 1000)) return null;
  return Math.round(numeric);
}

function parsePayloadVersion(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.trunc(numeric);
}

function parseOptionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text || null;
}

function resolveCanonicalDurationFromParsedPayload(parsed: Record<string, unknown>) {
  const payloadDurationMs = normalizeAudioMilliseconds(parsed.durationMs);
  const duration = parseOptionalObject(parsed.duration);

  const wallClockMs = normalizeAudioMilliseconds(duration?.wallClockMs);
  const activeRecordingMs = normalizeAudioMilliseconds(duration?.activeRecordingMs);
  const blobDecodedMs = normalizeAudioMilliseconds(duration?.blobDecodedMs);
  const driftMs = parseSignedInteger(duration?.driftMs);
  const driftPct = parseFiniteNumber(duration?.driftPct);

  let canonicalDurationMs: number | null = null;
  let canonicalDurationSource: AudioFromWebhook["canonicalDurationSource"] = null;

  if (blobDecodedMs !== null) {
    canonicalDurationMs = blobDecodedMs;
    canonicalDurationSource = "blobDecoded";
  } else if (activeRecordingMs !== null) {
    canonicalDurationMs = activeRecordingMs;
    canonicalDurationSource = "activeRecording";
  } else if (payloadDurationMs !== null) {
    canonicalDurationMs = payloadDurationMs;
    canonicalDurationSource = "payloadDuration";
  }

  return {
    payloadDurationMs,
    canonicalDurationMs,
    canonicalDurationSource,
    wallClockMs,
    activeRecordingMs,
    blobDecodedMs,
    driftMs,
    driftPct,
    debug: parseOptionalObject(parsed.debug),
    trackerConfig: parseOptionalObject(parsed.trackerConfig),
  };
}

function extractAudioFromWebhook(payload: Record<string, unknown>): AudioFromWebhook | null {
  for (const [key, raw] of Object.entries(payload || {})) {
    if (key === "rawRequest") continue;

    const parsed = safeJsonParse(raw)
      || (
        raw && typeof raw === "object" && !Array.isArray(raw)
          ? raw as Record<string, unknown>
          : null
      );

    if (parsed) {
      const audioUrlText = typeof parsed.audioUrl === "string"
        ? parsed.audioUrl
        : (typeof parsed.url === "string" ? parsed.url : "");
      const parsedAudioUrl = audioUrlText ? extractFirstUrl(audioUrlText) : null;
      if (parsedAudioUrl) {
        const durationData = resolveCanonicalDurationFromParsedPayload(parsed);
        const sizeBytesNumeric = parseNonNegativeNumber(parsed.sizeBytes);
        return {
          audioUrl: parsedAudioUrl,
          durationMs: durationData.payloadDurationMs,
          canonicalDurationMs: durationData.canonicalDurationMs,
          canonicalDurationSource: durationData.canonicalDurationSource,
          recordingId: parseOptionalText(parsed.recordingId),
          wallClockMs: durationData.wallClockMs,
          activeRecordingMs: durationData.activeRecordingMs,
          blobDecodedMs: durationData.blobDecodedMs,
          driftMs: durationData.driftMs,
          driftPct: durationData.driftPct,
          debug: durationData.debug,
          trackerConfig: durationData.trackerConfig,
          payloadRaw: parsed,
          sizeBytes: sizeBytesNumeric === null ? null : Math.round(sizeBytesNumeric),
          mimeType: parseOptionalText(parsed.mimeType),
          extension: parseOptionalText(parsed.extension),
          recordedAt: parseOptionalText(parsed.recordedAt),
          payloadVersion: parsePayloadVersion(parsed.v),
          sourceField: key,
        };
      }
    }

    if (typeof raw !== "string") continue;
    const legacyUrl = extractFirstUrl(raw);
    const isStorageUrl = legacyUrl && (
      legacyUrl.includes("/storage/v1/object/public/")
      || legacyUrl.includes("/storage/v1/object/sign/")
      || legacyUrl.includes("supabase.co/storage")
    );
    if (isStorageUrl) {
      return {
        audioUrl: legacyUrl,
        durationMs: null,
        canonicalDurationMs: null,
        canonicalDurationSource: "legacy",
        recordingId: null,
        wallClockMs: null,
        activeRecordingMs: null,
        blobDecodedMs: null,
        driftMs: null,
        driftPct: null,
        debug: null,
        trackerConfig: null,
        payloadRaw: null,
        sizeBytes: null,
        mimeType: null,
        extension: null,
        recordedAt: null,
        payloadVersion: 1,
        sourceField: key,
      };
    }
  }
  return null;
}

function extractObjectPathFromPublicUrl(audioUrl: string): string | null {
  try {
    const url = new URL(audioUrl);
    const marker = "/storage/v1/object/public/";
    const idx = url.pathname.indexOf(marker);
    if (idx < 0) return null;

    const suffix = url.pathname.slice(idx + marker.length);
    const slashPos = suffix.indexOf("/");
    if (slashPos < 0) return null;

    return decodeURIComponent(suffix.slice(slashPos + 1));
  } catch {
    return null;
  }
}

async function patchAudioUploadEventFromWebhook(
  supabase: any,
  audio: AudioFromWebhook | null,
): Promise<void> {
  if (!audio?.audioUrl) return;

  try {
    const updateData: Record<string, unknown> = {
      payload_version: audio.payloadVersion,
      duration_ms: audio.canonicalDurationMs ?? audio.durationMs,
      size_bytes: audio.sizeBytes,
      mime_type: audio.mimeType,
      extension: audio.extension,
      recorded_at: audio.recordedAt,
      metadata: {
        ...(audio.payloadRaw ?? {}),
        webhookUpdatedAt: new Date().toISOString(),
      },
    };

    let updated = false;

    const byPublicUrl = await supabase
      .from("audio_upload_events")
      .update(updateData)
      .eq("public_url", audio.audioUrl)
      .select("id");
    if (!byPublicUrl.error && Array.isArray(byPublicUrl.data) && byPublicUrl.data.length > 0) {
      updated = true;
    }

    if (!updated) {
      const objectPath = extractObjectPathFromPublicUrl(audio.audioUrl);
      if (objectPath) {
        const byObjectPath = await supabase
          .from("audio_upload_events")
          .update(updateData)
          .eq("object_path", objectPath)
          .select("id");
        if (!byObjectPath.error && Array.isArray(byObjectPath.data) && byObjectPath.data.length > 0) {
          updated = true;
        }
      }
    }

    if (!updated) {
      console.log("audio_upload_events: no matching row", { audioUrl: audio.audioUrl });
    }
  } catch (err) {
    console.error("audio_upload_events patch failed:", err);
  }
}

async function detectAudioDurationFromUrl(audioUrl: string): Promise<number | null> {
  if (!audioUrl) return null;
  try {
    const response = await fetch(audioUrl);
    if (!response.ok) {
      console.error("audio download failed for duration:", response.status, audioUrl);
      return null;
    }

    const contentLength = Number(response.headers.get("content-length") || "0");
    const maxBytes = 50 * 1024 * 1024;
    if (contentLength > maxBytes) {
      console.error("audio too large to inspect duration:", contentLength);
      return null;
    }

    const bytes = await response.arrayBuffer();
    if (!bytes || bytes.byteLength === 0 || bytes.byteLength > maxBytes) {
      return null;
    }

    const { parseBuffer } = await import("npm:music-metadata@10.6.4");
    const { Buffer } = await import("node:buffer");
    const metadata = await parseBuffer(Buffer.from(bytes), undefined, { duration: true });
    return normalizeAudioSeconds(metadata?.format?.duration);
  } catch (err) {
    console.error("detect duration failed:", err);
    return null;
  }
}

function normalizeAudioSeconds(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return null;
  if (numeric > (8 * 3600)) return null;
  return Math.round(numeric * 100) / 100;
}

function clockToSeconds(value: string): number | null {
  const parts = value.trim().replace(",", ".").split(":");
  if (parts.length !== 2 && parts.length !== 3) return null;

  if (parts.length === 2) {
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) return null;
    if (minutes < 0 || seconds < 0 || seconds >= 60) return null;
    return (minutes * 60) + seconds;
  }

  const hours = Number(parts[0]);
  const minutes = Number(parts[1]);
  const seconds = Number(parts[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
    return null;
  }
  if (hours < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) {
    return null;
  }
  return (hours * 3600) + (minutes * 60) + seconds;
}

function parseDurationSeconds(
  value: unknown,
  opts: { allowPlainNumeric?: boolean; allowClock?: boolean } = {},
): number | null {
  if (value === null || value === undefined) return null;
  const allowPlainNumeric = Boolean(opts.allowPlainNumeric);
  const allowClock = Boolean(opts.allowClock);

  if (typeof value === "number") {
    return normalizeAudioSeconds(value);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseDurationSeconds(item, opts);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const msKeys = ["durationMs", "audioDurationMs", "audio_duration_ms", "duration_ms"];
    for (const key of msKeys) {
      const durationMs = normalizeAudioMilliseconds(objectValue[key]);
      if (durationMs !== null) {
        return normalizeAudioSeconds(durationMs / 1000);
      }
    }
    for (const nested of Object.values(objectValue)) {
      const parsed = parseDurationSeconds(nested, opts);
      if (parsed !== null) return parsed;
    }
    return null;
  }

  const text = String(value).trim();
  if (!text) return null;
  const normalized = text.replace(/,/g, ".");

  if (allowClock) {
    const hmsMatch = normalized.match(/(?:^|[^\d])(\d{1,2}:[0-5]\d:[0-5]\d(?:\.\d{1,3})?)(?:$|[^\d])/i);
    if (hmsMatch?.[1]) {
      const parsed = clockToSeconds(hmsMatch[1]);
      if (parsed !== null) return normalizeAudioSeconds(parsed);
    }

    const msMatch = normalized.match(/(?:^|[^\d])(\d{1,3}:[0-5]\d(?:\.\d{1,3})?)(?:$|[^\d])/i);
    if (msMatch?.[1]) {
      const parsed = clockToSeconds(msMatch[1]);
      if (parsed !== null) return normalizeAudioSeconds(parsed);
    }
  }

  if (allowPlainNumeric || allowClock) {
    const durationMsMatch = normalized.match(
      /(?:durationms|duration_ms|audio_duration_ms|audiodurationms)[^0-9]{0,8}(\d+(?:\.\d+)?)/i,
    );
    if (durationMsMatch?.[1]) {
      const durationMs = normalizeAudioMilliseconds(durationMsMatch[1]);
      if (durationMs !== null) {
        return normalizeAudioSeconds(durationMs / 1000);
      }
    }

    const labelClock = normalized.match(
      /(?:durac|duration|length)[^0-9]{0,12}(\d{1,2}:[0-5]\d(?::[0-5]\d)?(?:\.\d{1,3})?)/i,
    );
    if (labelClock?.[1]) {
      const parsed = clockToSeconds(labelClock[1]);
      if (parsed !== null) return normalizeAudioSeconds(parsed);
    }

    const labeledUnit = normalized.match(
      /(?:durac|duration|length)[^0-9]{0,12}(\d+(?:\.\d+)?)(?:\s*(h|hora|horas|min|mins|m|seg|secs|sec|s))?/i,
    );
    if (labeledUnit?.[1]) {
      const numeric = Number(labeledUnit[1]);
      if (Number.isFinite(numeric) && numeric >= 0) {
        const unit = (labeledUnit[2] ?? "s").toLowerCase();
        if (unit === "h" || unit === "hora" || unit === "horas") {
          return normalizeAudioSeconds(numeric * 3600);
        }
        if (unit === "min" || unit === "mins" || unit === "m") {
          return normalizeAudioSeconds(numeric * 60);
        }
        return normalizeAudioSeconds(numeric);
      }
    }
  }

  if (allowPlainNumeric || allowClock) {
    const unitMatch = normalized.match(/(\d+(?:\.\d+)?)\s*(h|hora|horas|min|mins|m|seg|secs|sec|s)\b/i);
    if (unitMatch?.[1]) {
      const numeric = Number(unitMatch[1]);
      if (Number.isFinite(numeric) && numeric >= 0) {
        const unit = (unitMatch[2] ?? "s").toLowerCase();
        if (unit === "h" || unit === "hora" || unit === "horas") {
          return normalizeAudioSeconds(numeric * 3600);
        }
        if (unit === "min" || unit === "mins" || unit === "m") {
          return normalizeAudioSeconds(numeric * 60);
        }
        return normalizeAudioSeconds(numeric);
      }
    }
  }

  if (allowPlainNumeric && /^\d+(?:\.\d+)?$/.test(normalized)) {
    return normalizeAudioSeconds(normalized);
  }

  return null;
}

function extractAudioDurationSeconds(payload: Record<string, unknown>): number | null {
  const directMsKeys = [
    "durationMs",
    "audio_duration_ms",
    "audioDurationMs",
    "recordingDurationMs",
  ];
  const directKeys = [
    "audio_duration",
    "audioDuration",
    "audio_duration_sec",
    "audioDurationSec",
    "audioLength",
    "recordingDuration",
  ];
  const keyHints = ["audio", "gravador", "record"];

  for (const key of directMsKeys) {
    const durationMs = normalizeAudioMilliseconds(payload[key]);
    if (durationMs !== null) {
      return normalizeAudioSeconds(durationMs / 1000);
    }
  }

  for (const key of directKeys) {
    const parsed = parseDurationSeconds(payload[key], { allowPlainNumeric: true, allowClock: true });
    if (parsed !== null) return parsed;
  }

  for (const [key, value] of Object.entries(payload || {})) {
    const keyLower = String(key || "").toLowerCase();
    const hinted = keyHints.some((hint) => keyLower.includes(hint));
    const parsed = parseDurationSeconds(value, {
      allowPlainNumeric: hinted,
      allowClock: hinted,
    });
    if (parsed !== null) return parsed;
  }

  return null;
}

function parsePositiveInteger(rawValue: string | null | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeFormId(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!/^\d+$/.test(text)) return null;
  return text;
}

function normalizeQuestionText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text || null;
}

function normalizeQuestionCatalog(value: unknown): JotformQuestionCatalog | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const byBaseSource = source.by_base_code;
  const byQuestionSource = source.by_question_id;
  if (!byBaseSource || typeof byBaseSource !== "object") return null;
  if (!byQuestionSource || typeof byQuestionSource !== "object") return null;

  const by_base_code: Record<string, string> = {};
  const by_question_id: Record<string, string> = {};

  for (const [key, rawText] of Object.entries(byBaseSource as Record<string, unknown>)) {
    const text = normalizeQuestionText(rawText);
    const normalizedKey = normalizeQuestionText(key);
    if (!text || !normalizedKey) continue;
    by_base_code[normalizedKey.toLowerCase()] = text;
  }

  for (const [key, rawText] of Object.entries(byQuestionSource as Record<string, unknown>)) {
    const text = normalizeQuestionText(rawText);
    if (!text || !/^\d+$/.test(String(key))) continue;
    by_question_id[String(key)] = text;
  }

  if (Object.keys(by_base_code).length === 0 && Object.keys(by_question_id).length === 0) {
    return null;
  }
  return { by_base_code, by_question_id };
}

async function loadQuestionCatalogFromCache(
  supabase: any,
  formId: string,
  maxAgeMs: number,
): Promise<JotformQuestionCatalog | null> {
  try {
    const { data, error } = await supabase
      .from(JOTFORM_QUESTION_CACHE_TABLE)
      .select("question_catalog, fetched_at")
      .eq("form_id", formId)
      .maybeSingle();

    if (error) {
      const message = String(error.message || "");
      if (!message.toLowerCase().includes("does not exist")) {
        console.error("question cache read error:", error);
      }
      return null;
    }

    if (!data) return null;
    const fetchedAtMs = Date.parse(String(data.fetched_at || ""));
    if (!Number.isFinite(fetchedAtMs)) return null;
    if ((Date.now() - fetchedAtMs) > maxAgeMs) return null;

    return normalizeQuestionCatalog(data.question_catalog);
  } catch (err) {
    console.error("question cache query failed:", err);
    return null;
  }
}

async function saveQuestionCatalogToCache(
  supabase: any,
  formId: string,
  catalog: JotformQuestionCatalog,
): Promise<void> {
  try {
    const { error } = await supabase
      .from(JOTFORM_QUESTION_CACHE_TABLE)
      .upsert(
        {
          form_id: formId,
          question_catalog: catalog,
          fetched_at: new Date().toISOString(),
        },
        { onConflict: "form_id" },
      );
    if (error) {
      const message = String(error.message || "");
      if (!message.toLowerCase().includes("does not exist")) {
        console.error("question cache save error:", error);
      }
    }
  } catch (err) {
    console.error("question cache persist failed:", err);
  }
}

async function fetchQuestionCatalogFromJotform(
  formId: string,
  apiKey: string,
): Promise<JotformQuestionCatalog | null> {
  if (!apiKey) return null;

  try {
    const endpoint = new URL(`https://api.jotform.com/form/${encodeURIComponent(formId)}/questions`);
    endpoint.searchParams.set("apiKey", apiKey);
    const response = await fetch(endpoint.toString(), { method: "GET" });
    if (!response.ok) {
      console.error("Jotform questions API error:", response.status, formId);
      return null;
    }

    const data = await response.json();
    const content = data?.content;
    if (!content || typeof content !== "object") {
      return null;
    }

    const by_base_code: Record<string, string> = {};
    const by_question_id: Record<string, string> = {};

    for (const [rawQid, rawQuestion] of Object.entries(content as Record<string, unknown>)) {
      if (!rawQuestion || typeof rawQuestion !== "object") continue;
      const question = rawQuestion as Record<string, unknown>;
      const questionText = normalizeQuestionText(question.text);
      if (!questionText) continue;

      const name = normalizeQuestionText(question.name);
      if (name) {
        by_base_code[name.toLowerCase()] = questionText;
      }

      const qid = normalizeQuestionText(rawQid)
        || normalizeQuestionText(question.qid)
        || normalizeQuestionText(question.order);
      if (qid && /^\d+$/.test(qid)) {
        by_question_id[qid] = questionText;
      }
    }

    if (Object.keys(by_base_code).length === 0 && Object.keys(by_question_id).length === 0) {
      return null;
    }
    return { by_base_code, by_question_id };
  } catch (err) {
    console.error("Jotform questions API fetch failed:", err);
    return null;
  }
}

function buildSubmissionQuestionTextMap(
  payload: Record<string, unknown>,
  catalog: JotformQuestionCatalog,
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const key of Object.keys(payload || {})) {
    const match = key.match(/^q(\d+)_/i);
    if (!match) continue;

    const baseCode = parseBaseCode(key);
    if (!baseCode) continue;

    const byName = catalog.by_base_code[baseCode.toLowerCase()];
    const byQuestionId = catalog.by_question_id[match[1]];
    const questionText = byName || byQuestionId;
    if (questionText && !resolved[baseCode]) {
      resolved[baseCode] = questionText;
    }
  }
  return resolved;
}

async function resolveSubmissionQuestionTexts(
  supabase: any,
  payload: Record<string, unknown>,
  formIdRaw: unknown,
  apiKey: string,
  cacheHours: number,
): Promise<Record<string, string>> {
  const formId = normalizeFormId(formIdRaw);
  if (!formId) return {};

  const maxAgeMs = Math.max(cacheHours, 1) * 60 * 60 * 1000;
  let catalog = await loadQuestionCatalogFromCache(supabase, formId, maxAgeMs);
  if (!catalog && apiKey) {
    catalog = await fetchQuestionCatalogFromJotform(formId, apiKey);
    if (catalog) {
      await saveQuestionCatalogToCache(supabase, formId, catalog);
    }
  }
  if (!catalog) return {};
  return buildSubmissionQuestionTextMap(payload, catalog);
}

function sanitizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const ignoreKeys = new Set([
    "rawRequest",
    "pretty",
    "ip",
    "ip_address",
    "device",
    "device_info",
    "latitude",
    "longitude",
    "audio",
    "audio_url",
    "formID",
    "formId",
    "submissionID",
    "submissionId",
    JOTFORM_QUESTION_TEXTS_KEY,
    "formTitle",
    "form_title",
    "created_at",
    "updated_at",
  ]);

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload || {})) {
    if (ignoreKeys.has(key)) continue;
    if (typeof value === "string") {
      cleaned[key] = value.length > 280 ? `${value.slice(0, 280)}...` : value;
    } else if (typeof value === "number" || typeof value === "boolean") {
      cleaned[key] = value;
    } else if (value && typeof value === "object") {
      cleaned[key] = "[object]";
    }
  }
  return cleaned;
}

async function resolveProjectPromptText(supabase: any, projectId: string): Promise<string | null> {
  if (!projectId) return null;
  try {
    const { data, error } = await supabase
      .from("ai_prompt_templates")
      .select("prompt_text, updated_at")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("project prompt load error:", error);
      return null;
    }

    const first = Array.isArray(data) && data.length > 0 ? data[0] : null;
    const promptText = first?.prompt_text;
    if (typeof promptText === "string" && promptText.trim()) {
      return promptText.trim();
    }
    return null;
  } catch (err) {
    console.error("project prompt query failed:", err);
    return null;
  }
}

function buildPrompt(payload: Record<string, unknown>, promptOverride?: string | null): string {
  const defaultFrontendPrompt =
    "Resuma a entrevista em ate 6 linhas. Aponte sinais de incoerencia, riscos de fraude e divergencias entre perfil e respostas. Retorne em pt-BR.";
  const promptText = promptOverride?.trim()
    || Deno.env.get("AI_DEFAULT_PROMPT")
    || defaultFrontendPrompt;
  const payloadJson = JSON.stringify(sanitizePayload(payload), null, 2);
  return `${promptText}\n\nPayload compacto (JSON):\n${payloadJson}`;
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.length > 0;

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if ("full" in obj && typeof obj.full === "string") {
      return obj.full.trim().length > 0;
    }
    return Object.keys(obj).length > 0;
  }
  return false;
}

function normalizeLookupToken(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_]+/g, "")
    .toLowerCase()
    .trim();
}

function extractAnswerText(value: unknown): string | null {
  if (typeof value === "string") {
    const text = value.trim();
    return text || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const full = (value as Record<string, unknown>).full;
    if (typeof full === "string" && full.trim()) {
      return full.trim();
    }
  }
  return null;
}

function getAnswerByQuestionName(
  payload: Record<string, unknown>,
  questionName: string,
): string | null {
  const target = normalizeLookupToken(questionName);
  if (!target) return null;

  for (const [rawKey, rawValue] of Object.entries(payload || {})) {
    if (rawKey === "rawRequest") continue;
    const baseCode = parseBaseCode(rawKey);
    const keyCandidates = [rawKey, baseCode ?? ""];

    for (const candidate of keyCandidates) {
      if (!candidate) continue;
      if (normalizeLookupToken(candidate) !== target) continue;
      const answer = extractAnswerText(rawValue);
      if (answer) return answer;
    }
  }
  return null;
}

function parseBaseCode(rawKey: string): string | null {
  const match = rawKey.match(/^q(\d+)_([^]+)/);
  if (!match) return null;

  let remainder = match[2];
  if (!remainder) return null;

  if (remainder.includes("_")) {
    const parts = remainder.split("_");
    const tail = parts[parts.length - 1];
    if (/^\d+$/.test(tail)) {
      parts.pop();
      remainder = parts.join("_");
    }
  }
  return remainder;
}

function isMetaBaseCode(baseCode: string): boolean {
  const lower = baseCode.toLowerCase();
  const metaHints = [
    "gravador",
    "audio",
    "georrefer",
    "selo",
    "navegador",
    "device",
    "upload",
    "ip",
    "geo",
    "gps",
    "localizacao",
  ];
  if (lower.startsWith("ltstrong")) return true;
  return metaHints.some((hint) => lower.includes(hint));
}

function findLastAnsweredQuestion(payload: Record<string, unknown>): { qNumber: number; baseCode: string } | null {
  let maxQ = -1;
  let lastBase = "";

  for (const [key, value] of Object.entries(payload || {})) {
    if (key === "rawRequest" || key === "pretty") continue;
    if (!hasValue(value)) continue;

    const match = key.match(/^q(\d+)_/);
    if (!match) continue;
    const qNumber = Number.parseInt(match[1], 10);
    if (!Number.isFinite(qNumber)) continue;

    const base = parseBaseCode(key);
    if (!base || isMetaBaseCode(base)) continue;

    if (qNumber > maxQ) {
      maxQ = qNumber;
      lastBase = base;
    }
  }

  if (maxQ < 0 || !lastBase) return null;
  return { qNumber: maxQ, baseCode: lastBase };
}

async function generateAiNotes(
  payload: Record<string, unknown>,
  options: AiGenerationOptions,
): Promise<AiGenerationResult> {
  const provider = String(options.provider || "groq").toLowerCase() === "openai"
    ? "openai"
    : "groq";
  const model = provider === "openai" ? options.openaiModel : options.groqModel;
  const apiKey = provider === "openai" ? options.openaiKey : options.groqKey;
  const endpoint = provider === "openai"
    ? "https://api.openai.com/v1/chat/completions"
    : "https://api.groq.com/openai/v1/chat/completions";
  const prompt = buildPrompt(payload, options.promptText);

  if (!apiKey) {
    const keyName = provider === "openai" ? "OPENAI_API_KEY" : "GROQ_API_KEY";
    return {
      notes: `AI disabled: missing ${keyName}.`,
      modelName: `${provider}-disabled`,
    };
  }

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 280,
        messages: [
          { role: "system", content: "You are a helpful data analyst." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("ai provider error:", provider, resp.status, errText);
      return {
        notes: "AI failed to generate notes.",
        modelName: `${provider}:${model}`,
      };
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== "string") {
      return {
        notes: "AI failed to generate notes.",
        modelName: `${provider}:${model}`,
      };
    }

    return {
      notes: content.trim(),
      modelName: `${provider}:${model}`,
    };
  } catch (err) {
    console.error("ai request error:", provider, err);
    return {
      notes: "AI failed to generate notes.",
      modelName: `${provider}:${model}`,
    };
  }
}

function simplifyUserAgent(ua: string): string {
  let os = "Desconhecido";
  let type = "Outro";
  let browser = "Navegador";

  if (/Windows/.test(ua)) {
    os = "Windows";
    type = "Computador";
  } else if (/Android/.test(ua)) {
    os = "Android";
    type = "Tablet/Celular";
  } else if (/iPhone/.test(ua)) {
    os = "iOS";
    type = "Celular";
  } else if (/iPad/.test(ua)) {
    os = "iOS";
    type = "Tablet";
  } else if (/Macintosh|Mac OS/.test(ua)) {
    os = "macOS";
    type = "Computador";
  } else if (/Linux/.test(ua)) {
    os = "Linux";
    type = "Computador";
  }

  if (/Edg/.test(ua)) browser = "Edge";
  else if (/Chrome/.test(ua)) browser = "Chrome";
  else if (/Firefox/.test(ua)) browser = "Firefox";
  else if (/Safari/.test(ua)) browser = "Safari";

  return `${browser} no ${os} | ${type}`;
}

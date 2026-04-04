import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type UploadMetadata = {
  v?: number;
  recordingId?: string;
  durationMs?: number;
  sizeBytes?: number;
  mimeType?: string;
  extension?: string;
  recordedAt?: string;
  duration?: Record<string, unknown>;
  debug?: Record<string, unknown>;
  trackerConfig?: Record<string, unknown>;
  [key: string]: unknown;
};

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function errorToMessage(err: unknown): string {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (typeof err === "object" && "message" in err) {
    return String((err as { message?: unknown }).message ?? "Unknown error");
  }
  return String(err);
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function sanitizePathSegment(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .toLowerCase();
}

function sanitizeFolderPath(value: string): string {
  return value
    .replaceAll("\\", "/")
    .split("/")
    .map((segment) => sanitizePathSegment(segment))
    .filter(Boolean)
    .join("/");
}

function sanitizeFileName(fileName: string): string {
  const withoutPath = fileName.replaceAll("\\", "/").split("/").pop() ?? "";
  const compact = withoutPath.trim().replace(/\s+/g, "-");
  const safe = compact.replace(/[^A-Za-z0-9._-]/g, "");
  return safe || `audio-${Date.now()}.webm`;
}

function normalizePositiveInt(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const asInt = Math.trunc(numeric);
  return asInt >= 0 ? asInt : null;
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toISOString();
}

function normalizeMetadata(metadata: unknown): UploadMetadata | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const raw = metadata as UploadMetadata;
  const normalized: UploadMetadata = {};

  const v = normalizePositiveInt(raw.v);
  if (v !== null) normalized.v = v;

  if (typeof raw.recordingId === "string" && raw.recordingId.trim()) {
    normalized.recordingId = raw.recordingId.trim();
  }

  const durationMs = normalizePositiveInt(raw.durationMs);
  if (durationMs !== null) normalized.durationMs = durationMs;

  const sizeBytes = normalizePositiveInt(raw.sizeBytes);
  if (sizeBytes !== null) normalized.sizeBytes = sizeBytes;

  if (typeof raw.mimeType === "string" && raw.mimeType.trim()) {
    normalized.mimeType = raw.mimeType.trim().toLowerCase();
  }

  if (typeof raw.extension === "string" && raw.extension.trim()) {
    normalized.extension = raw.extension.trim().toLowerCase();
  }

  const recordedAt = normalizeIsoDate(raw.recordedAt);
  if (recordedAt) normalized.recordedAt = recordedAt;

  if (raw.duration && typeof raw.duration === "object" && !Array.isArray(raw.duration)) {
    normalized.duration = raw.duration as Record<string, unknown>;
  }

  if (raw.debug && typeof raw.debug === "object" && !Array.isArray(raw.debug)) {
    normalized.debug = raw.debug as Record<string, unknown>;
  }

  if (raw.trackerConfig && typeof raw.trackerConfig === "object" && !Array.isArray(raw.trackerConfig)) {
    normalized.trackerConfig = raw.trackerConfig as Record<string, unknown>;
  }

  return Object.keys(normalized).length ? normalized : null;
}

function resolveProjectKey(body: Record<string, unknown>): string {
  const rawProjectKey = firstNonEmptyString(
    body.formID,
    body.formId,
    body.form_id,
    body.projectKey,
    body.project_key,
    body.projectId,
    body.project_id,
  );

  const safe = sanitizePathSegment(rawProjectKey ?? "");
  return safe || "sem-form-id";
}

Deno.serve(async (req) => {
  const requestId = crypto.randomUUID();

  try {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed.", requestId }, 405);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body.", requestId }, 400);
    }

    const fileName = firstNonEmptyString(body.fileName) ?? "";
    const contentType = firstNonEmptyString(body.contentType) ?? "";

    if (!fileName || !contentType) {
      return jsonResponse({ error: "fileName and contentType are required.", requestId }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse(
        {
          error: "Server env vars are not configured.",
          details: "SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.",
          requestId,
        },
        500,
      );
    }

    const bucket = (Deno.env.get("AUDIO_UPLOAD_BUCKET") ?? "auditoria-audios").trim();
    const folder = sanitizeFolderPath((Deno.env.get("AUDIO_UPLOAD_FOLDER") ?? "auditoria").trim());
    const metadataTable = (Deno.env.get("AUDIO_UPLOAD_METADATA_TABLE") ?? "").trim();

    const safeFileName = sanitizeFileName(fileName);
    const projectKey = resolveProjectKey(body);
    const objectPath = [folder, projectKey, safeFileName].filter(Boolean).join("/");
    const metadata = normalizeMetadata(body.metadata);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { error: bucketError } = await supabase.storage.getBucket(bucket);
    if (bucketError) {
      console.error("[audio-uploader] bucket check failed", {
        requestId,
        bucket,
        message: bucketError.message,
      });
      return jsonResponse(
        {
          error: "Storage bucket unavailable.",
          details: bucketError.message,
          bucket,
          requestId,
        },
        500,
      );
    }

    const { data: signedData, error: signedError } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(objectPath);

    if (signedError || !signedData?.signedUrl) {
      console.error("[audio-uploader] signed URL generation failed", {
        requestId,
        bucket,
        objectPath,
        message: signedError?.message ?? "signedUrl missing",
      });
      return jsonResponse(
        {
          error: "Failed to generate signed upload URL.",
          details: signedError?.message ?? "signedUrl missing",
          bucket,
          objectPath,
          requestId,
        },
        500,
      );
    }

    const uploadUrl = signedData.signedUrl.startsWith("http")
      ? signedData.signedUrl
      : new URL(signedData.signedUrl, supabaseUrl).toString();

    const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    const publicUrl = publicData.publicUrl;

    if (metadataTable && metadata) {
      const metadataToPersist: UploadMetadata = {
        ...metadata,
        formID: firstNonEmptyString(body.formID, body.formId, body.form_id),
        projectKey,
      };

      const { error: metadataError } = await supabase.from(metadataTable).insert({
        object_path: objectPath,
        public_url: publicUrl,
        file_name: safeFileName,
        content_type: contentType.trim().toLowerCase(),
        payload_version: metadata.v ?? null,
        duration_ms: metadata.durationMs ?? null,
        size_bytes: metadata.sizeBytes ?? null,
        mime_type: metadata.mimeType ?? null,
        extension: metadata.extension ?? null,
        recorded_at: metadata.recordedAt ?? null,
        metadata: metadataToPersist,
      });

      if (metadataError) {
        console.error("[audio-uploader] metadata insert failed", {
          requestId,
          table: metadataTable,
          message: metadataError.message,
        });
      }
    }

    return jsonResponse({
      uploadUrl,
      publicUrl,
      objectPath,
      bucket,
      projectKey,
      metadataAccepted: Boolean(metadata),
      requestId,
    });
  } catch (err) {
    const message = errorToMessage(err);
    console.error("[audio-uploader] unhandled error", { requestId, message });
    return jsonResponse(
      {
        error: "Unhandled function error.",
        details: message,
        requestId,
      },
      500,
    );
  }
});

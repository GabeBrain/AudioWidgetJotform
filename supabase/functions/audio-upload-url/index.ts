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

function sanitizeFileName(fileName: string): string {
  const withoutPath = fileName.replaceAll("\\", "/").split("/").pop() ?? "";
  const compact = withoutPath.trim().replace(/\s+/g, "-");
  const safe = compact.replace(/[^A-Za-z0-9._-]/g, "");
  return safe || `audio-${Date.now()}.webm`;
}

function normalizePositiveInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const asInt = Math.trunc(value);
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

    const fileName = typeof body.fileName === "string" ? body.fileName : "";
    const contentType = typeof body.contentType === "string" ? body.contentType : "";

    if (!fileName.trim() || !contentType.trim()) {
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

    const bucket = (Deno.env.get("AUDIO_UPLOAD_BUCKET") ?? "audios").trim();
    const folder = (Deno.env.get("AUDIO_UPLOAD_FOLDER") ?? "auditorias").trim().replace(/^\/+|\/+$/g, "");
    const metadataTable = (Deno.env.get("AUDIO_UPLOAD_METADATA_TABLE") ?? "").trim();

    const safeFileName = sanitizeFileName(fileName);
    const objectPath = folder ? `${folder}/${safeFileName}` : safeFileName;
    const metadata = normalizeMetadata(body.metadata);

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false },
    });

    const { error: bucketError } = await supabase.storage.getBucket(bucket);
    if (bucketError) {
      console.error("[audio-upload-url] bucket check failed", {
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
      console.error("[audio-upload-url] signed URL generation failed", {
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
        metadata,
      });

      if (metadataError) {
        console.error("[audio-upload-url] metadata insert failed:", {
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
      metadataAccepted: Boolean(metadata),
      requestId,
    });
  } catch (err) {
    const message = errorToMessage(err);
    console.error("[audio-upload-url] unhandled error", { requestId, message });
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

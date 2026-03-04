## audio-upload-url (v2-ready)

Edge Function para gerar URL assinada de upload no Supabase Storage, com suporte opcional a metadados do audio.

### Requisicao esperada

```json
{
  "fileName": "gravacao-1741111111111-d73450ms.webm",
  "contentType": "audio/webm",
  "metadata": {
    "v": 2,
    "durationMs": 73450,
    "sizeBytes": 812345,
    "mimeType": "audio/webm",
    "extension": "webm",
    "recordedAt": "2026-03-04T15:20:31.000Z"
  }
}
```

### Resposta

```json
{
  "uploadUrl": "https://<project>.supabase.co/storage/v1/object/upload/sign/...",
  "publicUrl": "https://<project>.supabase.co/storage/v1/object/public/...",
  "objectPath": "auditorias/gravacao-1741111111111-d73450ms.webm",
  "metadataAccepted": true
}
```

### Variaveis de ambiente

- `SUPABASE_URL` (obrigatoria)
- `SUPABASE_SERVICE_ROLE_KEY` (obrigatoria)
- `AUDIO_UPLOAD_BUCKET` (opcional, default: `audios`)
- `AUDIO_UPLOAD_FOLDER` (opcional, default: `auditorias`)
- `AUDIO_UPLOAD_METADATA_TABLE` (opcional, ex: `audio_upload_events`)

### Observacoes

- O widget agora envia JSON no campo do Jotform (`WIDGET_VALUE_FORMAT = 'json'`) com `audioUrl`, `durationMs`, `sizeBytes`, etc.
- A funcao aceita metadata opcional e o frontend faz fallback automatico sem metadata se o endpoint antigo recusar.

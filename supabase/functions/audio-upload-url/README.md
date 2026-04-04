## audio-upload-url (legado/local)

Esta documentacao descreve a funcao antiga deste repo para gerar URL assinada.
Em producao, o widget usa a Edge `audio-uploader` no projeto PRO.

### Historico de projetos Supabase

| Periodo | Projeto | Edge | Status |
| --- | --- | --- | --- |
| ate 2026-04-04 | `qrnpgskrapnfpksucdvq` | `/functions/v1/audio-upload-url` | legado |
| desde 2026-04-04 | `egrwllnuutoxjexqkrjv` | `/functions/v1/audio-uploader` | atual |

### Endpoint atual do widget

- `https://egrwllnuutoxjexqkrjv.supabase.co/functions/v1/audio-uploader`

### Requisicao esperada

```json
{
  "fileName": "gravacao-1741111111111-d73450ms.webm",
  "contentType": "audio/webm",
  "formID": "1234567890",
  "metadata": {
    "v": 3,
    "recordingId": "8f3614ba-11ce-4e7f-a784-e0e7b3ef76a2",
    "durationMs": 476812,
    "sizeBytes": 5492012,
    "mimeType": "audio/webm",
    "extension": "webm",
    "recordedAt": "2026-03-06T18:15:30.000Z"
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

Em caso de erro, a resposta agora retorna tambem `requestId` para correlacionar com logs da Edge Function.

### Variaveis de ambiente

- `SUPABASE_URL` (obrigatoria)
- `SUPABASE_SERVICE_ROLE_KEY` (obrigatoria)
- `AUDIO_UPLOAD_BUCKET` (opcional, default da edge atual: `auditoria-audios`)
- `AUDIO_UPLOAD_FOLDER` (opcional, default da edge atual: `auditoria`)
- `AUDIO_UPLOAD_METADATA_TABLE` (opcional, ex: `audio_upload_events`)

### Observacoes

- O widget agora envia JSON no campo do Jotform (`WIDGET_VALUE_FORMAT = 'json'`) com `audioUrl`, `durationMs`, `sizeBytes`, etc.
- O widget envia `formID` quando disponivel e preserva compatibilidade com:
  - retry sem metadata;
  - fallback sem `formID`.
- Se houver `500`, verifique primeiro:
  - nome real do bucket configurado em `AUDIO_UPLOAD_BUCKET`;
  - se `SUPABASE_SERVICE_ROLE_KEY` pertence ao mesmo projeto;
  - logs da funcao usando o `requestId` retornado no corpo de erro.

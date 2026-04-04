# WidgetAudio

Widget de audio para Jotform com upload seguro no Supabase via URL assinada.

## Estrutura

- `index.html`: widget principal (UI, permissoes, gravacao, integracao Jotform).
- `supabase/functions/audio-upload-url/index.ts`: referencia local/legada da Edge Function antiga.
- `supabase/migrations/20260304_create_audio_upload_events.sql`: tabela opcional para metadados de upload.
- `docs/payload-v3-tracker-contract.md`: contrato proposto de payload v3 e integracao de tracker no app consumidor.
- `supabase/functions/audio-upload-url/README.md`: notas da funcao legada e contexto da migracao.

## Fluxo atual

1. Usuario concede permissoes de localizacao e microfone.
2. Usuario inicia gravacao.
3. No submit do formulario, o widget finaliza a gravacao e faz upload.
4. Widget envia o valor para o Jotform em JSON (payload v3).

## Endpoint de upload atual (PRO)

- Edge atual em producao: `https://egrwllnuutoxjexqkrjv.supabase.co/functions/v1/audio-uploader`
- Comportamento atual do widget:
  - envia `formID` quando encontrado no contexto do Jotform/URL;
  - mantem retry sem `metadata`;
  - mantem fallback sem `formID` para compatibilidade.

## Historico de projetos Supabase usados

| Periodo | Projeto | Edge de upload | Status |
| --- | --- | --- | --- |
| ate 2026-04-04 | `qrnpgskrapnfpksucdvq` | `/functions/v1/audio-upload-url` | legado |
| desde 2026-04-04 | `egrwllnuutoxjexqkrjv` | `/functions/v1/audio-uploader` | atual |

## Payload v3 no campo do Jotform

Valor enviado no `sendData/sendSubmit`:

```json
{
  "v": 3,
  "recordingId": "8f3614ba-11ce-4e7f-a784-e0e7b3ef76a2",
  "audioUrl": "https://<project>.supabase.co/storage/v1/object/public/audios/auditorias/gravacao-....webm",
  "durationMs": 476812,
  "duration": {
    "source": "blobDecoded",
    "wallClockMs": 1142013,
    "activeRecordingMs": 480104,
    "blobDecodedMs": 476812,
    "driftMs": -333292,
    "driftPct": -41.14,
    "computedAt": "2026-03-06T18:15:33.000Z"
  },
  "debug": {
    "startAt": "2026-03-06T17:56:28.000Z",
    "stopAt": "2026-03-06T18:15:30.000Z",
    "pauseCount": 2,
    "resumeCount": 2,
    "chunksCount": 473,
    "blobSizeBytes": 5492012,
    "timesliceMs": 1000,
    "targetBitrate": 96000
  },
  "sizeBytes": 5492012,
  "mimeType": "audio/webm",
  "extension": "webm",
  "recordedAt": "2026-03-06T18:15:30.000Z",
  "trackerConfig": {
    "version": 1,
    "canonicalDurationMs": 476812,
    "durationToleranceMs": 2000,
    "durationTolerancePct": 10
  }
}
```

Observacao:
- O widget ainda consegue ler valor legado (apenas URL) ao abrir `ready`.
- Para backend/webhook, parsear JSON com fallback `v3 -> v2 -> URL simples`.
- Existe proposta de evolucao para payload v3 com diagnostico de duracao + contrato de tracker:
  - Ver `docs/payload-v3-tracker-contract.md`.
  - Objetivo: `durationMs` canonico, rastreabilidade e compatibilidade progressiva com v2/legado.

Exemplo de parser no webhook:

```js
function parseWidgetValue(raw) {
  if (!raw || typeof raw !== "string") return { audioUrl: "", payload: null };
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.audioUrl === "string") {
      return { audioUrl: parsed.audioUrl, payload: parsed };
    }
  } catch (_) {}
  return { audioUrl: raw, payload: null };
}
```

## Supabase: variaveis de ambiente (Edge atual `audio-uploader`)

### Obrigatorias

- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: chave service role para assinar upload e gravar metadados no backend.

Sem essas duas, a funcao `audio-uploader` nao funciona.

### Opcionais

- `AUDIO_UPLOAD_BUCKET` (default: `auditoria-audios`)
  - Bucket onde o arquivo sera salvo.
- `AUDIO_UPLOAD_FOLDER` (default: `auditoria`)
  - Prefixo base de pasta dentro do bucket.
  - O caminho final inclui o projeto/formulario resolvido pela Edge a partir do `formID`.
- `AUDIO_UPLOAD_METADATA_TABLE` (default: vazio)
  - Nome da tabela para persistir metadados de upload (ex.: `audio_upload_events`).
  - Se nao definir, a funcao continua funcionando, so nao grava metadados em tabela.

## Precisamos dessas envs?

- Para upload funcionar: **sim**, precisa de `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
- Para customizar bucket/pasta: **nao obrigatorio**, usa defaults.
- Para salvar metadados estruturados no banco: **nao obrigatorio**, mas recomendado para analytics, auditoria e evitar download posterior so para duracao.

## Observacao de compatibilidade

O frontend envia `metadata` e `formID` quando disponivel, com degradacao progressiva:
1. tentativa completa (`fileName`, `contentType`, `metadata`, `formID`);
2. retry sem `metadata`;
3. fallback sem `formID`.
Assim, o fluxo antigo continua operando mesmo com backends mais restritivos.

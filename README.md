# WidgetAudio

Widget de audio para Jotform com upload seguro no Supabase via URL assinada.

## Estrutura

- `index.html`: widget principal (UI, permissoes, gravacao, integracao Jotform).
- `supabase/functions/audio-upload-url/index.ts`: Edge Function para gerar URL assinada.
- `supabase/migrations/20260304_create_audio_upload_events.sql`: tabela opcional para metadados de upload.

## Fluxo atual

1. Usuario concede permissoes de localizacao e microfone.
2. Usuario inicia gravacao.
3. No submit do formulario, o widget finaliza a gravacao e faz upload.
4. Widget envia o valor para o Jotform em JSON (payload v2).

## Payload v2 no campo do Jotform

Valor enviado no `sendData/sendSubmit`:

```json
{
  "v": 2,
  "audioUrl": "https://<project>.supabase.co/storage/v1/object/public/audios/auditorias/gravacao-....webm",
  "durationMs": 73450,
  "sizeBytes": 812345,
  "mimeType": "audio/webm",
  "extension": "webm",
  "recordedAt": "2026-03-04T15:20:31.000Z"
}
```

Observacao:
- O widget ainda consegue ler valor legado (apenas URL) ao abrir `ready`.
- Para backend/webhook, prefira parsear JSON e usar fallback para URL simples quando necessario.

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

## Supabase: variaveis de ambiente

### Obrigatorias

- `SUPABASE_URL`: URL do projeto Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: chave service role para assinar upload e gravar metadados no backend.

Sem essas duas, a funcao `audio-upload-url` nao funciona.

### Opcionais

- `AUDIO_UPLOAD_BUCKET` (default: `audios`)
  - Bucket onde o arquivo sera salvo.
- `AUDIO_UPLOAD_FOLDER` (default: `auditorias`)
  - Pasta/prefixo dentro do bucket.
- `AUDIO_UPLOAD_METADATA_TABLE` (default: vazio)
  - Nome da tabela para persistir metadados de upload (ex.: `audio_upload_events`).
  - Se nao definir, a funcao continua funcionando, so nao grava metadados em tabela.

## Precisamos dessas envs?

- Para upload funcionar: **sim**, precisa de `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.
- Para customizar bucket/pasta: **nao obrigatorio**, usa defaults.
- Para salvar metadados estruturados no banco: **nao obrigatorio**, mas recomendado para analytics, auditoria e evitar download posterior so para duracao.

## Observacao de compatibilidade

O frontend ja envia metadata no request da URL assinada e faz fallback se a funcao antiga nao aceitar.
Assim, da para migrar com baixo risco.

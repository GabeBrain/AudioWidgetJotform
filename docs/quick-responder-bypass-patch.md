# Instrução para Claude: Patch de Bypass no Quick-Responder

> Este documento é uma instrução auto-contida para ser lida por Claude ao abrir o repositório
> do quick-responder. Leia-o inteiro antes de buscar qualquer arquivo.

---

## Contexto do problema

O widget de áudio (hospedado no GitHub Pages, embarcado em formulários Jotform via iframe) sofreu
um incidente em 08/05/2026: a Jotform passou a servir um header `Permissions-Policy` incorreto
que bloqueia `geolocation` e `microphone` em todos os iframes da página. O browser retorna
`PERMISSION_DENIED` imediatamente, sem mostrar diálogo ao usuário.

Como solução provisória, o widget foi colocado em **modo bypass** (`PROVISIONAL_BYPASS_MODE = true`
no `index.html`). Nesse modo, o widget:
- Simula as permissões como concedidas sem chamar nenhuma API de mídia/localização
- Simula o fluxo de gravação visualmente (botão muda de estado) sem gravar nada
- No submit, envia um JSON de bypass no campo do Jotform em vez de um payload de áudio real

---

## Estrutura do payload de bypass

O campo de áudio do Jotform (nome do campo contém "gravador", ex: `q6_gravador_voz`) recebe
este JSON como valor de string:

```json
{
  "v": 3,
  "bypass": true,
  "bypassReason": "provisional-mode",
  "bypassNote": "Permissions-Policy bloqueio Jotform — audio nao capturado",
  "audioUrl": "",
  "recordingId": "rec-1746711300000-ab3f8c2d",
  "submittedAt": 1746711322000
}
```

Campos importantes:
- `bypass: true` — flag de identificação. É a única verificação necessária.
- `audioUrl: ""` — string vazia, não é uma URL de storage
- `submittedAt` — Unix timestamp em ms (número, não ISO string — proposital para evitar
  que o parser de duração extraia "HH:MM" do timestamp)
- `recordingId` — presente se o usuário clicou em "Iniciar Gravação", `null` se não clicou

---

## O que o quick-responder faz hoje (problema a corrigir)

O quick-responder tem dois bugs com o payload de bypass:

### Bug 1 — Duração falsa (CRÍTICO)
A função `extractAudioDurationSeconds` itera sobre todos os campos do payload. O campo
`q6_gravador_voz` (ou similar com "gravador" no nome) tem `hinted: true`, o que ativa
`allowClock: true` no parser. O JSON do bypass continha originalmente `submittedAt` em formato
ISO (`"2026-05-08T14:35:22.000Z"`) — o regex de clock capturava `14:35` e retornava 875 segundos
de duração falsa.

**Status atual:** o widget já foi corrigido para usar `submittedAt: Date.now()` (número), eliminando
o falso match. Mas o quick-responder ainda não tem detecção explícita de bypass — ele segue tentando
extrair duração e URL, encontrando null/zero, e cai no status "Reprovado: Codigo 4 | Sem audio".

### Bug 2 — Status incorreto
Submissões de bypass estão sendo classificadas como `"Reprovado: Codigo 4 | Sem audio"` porque
`finalAudioUrl` é null e `hasAudioLink` é false. O status correto deveria ser
`"Erro Jotform de coleta de audio"`.

---

## O que você deve fazer no quick-responder

### Passo 1 — Encontrar o arquivo principal

Procure o arquivo que é o entry point do webhook (provavelmente `index.ts` numa Edge Function
Deno/Supabase). Ele deve conter:
- `Deno.serve(async (req) => {`
- A função `extractAudioFromWebhook`
- A função `extractAudioDurationSeconds`
- O bloco de status automático com `isTrainingSubmission`, `hasAudioLink`, `shouldSetAbordagem`

### Passo 2 — Adicionar a função de detecção de bypass

Adicione esta função auxiliar junto às outras funções auxiliares (próximo de
`extractAudioFromWebhook`):

```typescript
function detectWidgetBypass(payload: Record<string, unknown>): boolean {
    // Verifica campos diretos do payload
    for (const [key, value] of Object.entries(payload)) {
        if (key === 'rawRequest') continue;
        const parsed = isRecord(value)
            ? value
            : (typeof value === 'string' ? parseJsonRecordFromString(value) : null);
        if (parsed?.bypass === true) return true;
    }
    // Verifica dentro do rawRequest
    const rawRequest = payload.rawRequest;
    if (rawRequest) {
        const rawParsed = parseJsonRecordValue(rawRequest);
        if (rawParsed) {
            for (const [, value] of Object.entries(rawParsed)) {
                const parsed = parseJsonRecordValue(value);
                if (parsed?.bypass === true) return true;
            }
        }
    }
    return false;
}
```

### Passo 3 — Usar a detecção logo após `extractAudioFromWebhook`

No corpo principal do handler (`Deno.serve`), logo após o bloco que define `finalAudioUrl`
e `audio_parser_mode`, adicione:

```typescript
// Detecta submissão em modo bypass do widget provisório
const isWidgetBypassSubmission = detectWidgetBypass(payload);

if (isWidgetBypassSubmission) {
    payload.audio_parser_mode = 'bypass';
    payload.widget_bypass = true;
}
```

### Passo 4 — Zerar duração e URL para bypass

Ainda no handler, no bloco que calcula `derivedAudioDurationSec`, envolva a extração:

```typescript
let derivedAudioDurationSec = /* ... lógica existente ... */;

// Se for bypass, duração deve ser null (não há áudio)
if (isWidgetBypassSubmission) {
    derivedAudioDurationSec = null;
}

if (derivedAudioDurationSec !== null) {
    payload.audio_duration = derivedAudioDurationSec;
    payload.audio_duration_sec = derivedAudioDurationSec;
}
```

Garanta também que `finalAudioUrl` permaneça `null` para bypass (já vai ser, pois `audioUrl: ""`
não produz URL válida no `extractFirstUrl`, mas confirme).

### Passo 5 — Adicionar novo status automático

No bloco de regras automáticas de status, adicione a regra de bypass **entre** `isTrainingSubmission`
e `!hasAudioLink`. A ordem importa — bypass tem prioridade sobre "Sem audio":

```typescript
let automaticStatus: string | null = null;
if (isTrainingSubmission) {
    automaticStatus = "Treinamento";
} else if (isWidgetBypassSubmission) {           // ← NOVO, nesta posição
    automaticStatus = "Erro Jotform de coleta de audio";
} else if (!hasAudioLink) {
    automaticStatus = "Reprovado: Codigo 4 | Sem audio";
} else if (shouldSetAbordagem) {
    automaticStatus = "Abordagem";
}
```

A string `"Erro Jotform de coleta de audio"` é o status definitivo — análoga a como
`"Treinamento"` é reconhecido quando `isTrainingSubmissionPayload` detecta envios de teste.

---

## O que NÃO mudar

- Não altere `isTrainingSubmissionPayload` — ela funciona independentemente
- Não altere `extractAudioFromWebhook` ou `buildAudioFromRecord` — o bypass é detectado depois,
  não antes dessas funções
- Não altere os status existentes (`"Treinamento"`, `"Reprovado: Codigo 4 | Sem audio"`,
  `"Abordagem"`) — apenas insira o novo entre eles

---

## Como verificar se o patch está correto

Após as alterações, um payload de bypass deve produzir:
- `payload.audio_parser_mode === 'bypass'`
- `payload.widget_bypass === true`
- `payload.audio_duration` ausente (não setado)
- `finalAudioUrl === null`
- Status automático: `"Erro Jotform de coleta de audio"`
- Nenhuma tentativa de análise AI bloqueada (a AI ainda roda, ela é relevante para o contexto
  da entrevista mesmo sem áudio — a menos que você queira desabilitar, mas não é necessário)

Um payload normal (não bypass, `bypass` ausente ou `false`) deve passar pelo fluxo existente
sem nenhuma mudança.

---

## Referência: onde está o widget

- Repo do widget: `c:\Users\GaloD\Desktop\SE\Quanti\ProjetoJF1\WidgetAudio`
- Arquivo principal: `index.html` (JavaScript vanilla, ~1650 linhas)
- Constante de bypass: `PROVISIONAL_BYPASS_MODE = true` (linha ~57)
- Payload de bypass gerado em: `handleWidgetSubmit()`, bloco `if (PROVISIONAL_BYPASS_MODE)`

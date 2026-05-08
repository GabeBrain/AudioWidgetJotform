# Histórico de Problemas — WidgetAudio

Registro cronológico de incidentes, bugs e decisões técnicas relevantes enfrentados no ciclo de vida do widget.

---

## 2026-05-08 — Incidente: Permissions-Policy bloqueando geolocation e microphone

**Severidade:** Alta — impede gravação em produção  
**Status:** Mitigado (bypass provisório ativo); aguardando correção pelo Jotform  
**Formulários afetados:** Parcial (intermitente por CDN — ex: `261184301656656` afetado, `261184823806662` OK)  
**Coletas impactadas:** ~0 entre 09h–11h BRT em formulários afetados (121 coletas normais em 04–07/05)

### O que aconteceu

A partir das ~09h BRT, o widget passou a receber `PERMISSION_DENIED` (code 1) imediatamente ao tentar acessar geolocation e microphone — sem mostrar diálogo ao usuário. O problema aparecia tanto no browser quanto no app Jotform.

A causa identificada foi um header `Permissions-Policy` incorreto sendo servido pela Jotform nas páginas dos formulários, bloqueando essas APIs para todos os iframes e até para scripts do próprio Jotform (`geo-stamp.76ce44a7.js` também bloqueado).

O comportamento era **intermitente** porque parte dos nós de CDN do Cloudflare ainda servia cache antigo (funcional) enquanto outros entregavam conteúdo novo do origin com o header errado. O incidente foi correlacionado com um incidente ativo do Cloudflare no mesmo dia ("Wrangler users may experience frequent log out"), sugerindo instabilidade de infra que pode ter causado deploy parcial ou inválido na Jotform.

### Evidências coletadas

- `[Violation] Permissions policy violation: Geolocation access has been blocked because of a permissions policy applied to the current document` — aparece no console antes de qualquer interação do usuário
- `navigator.permissions.query({name: 'geolocation'})` e `{name: 'microphone'}` retornam `'denied'` na inicialização do widget (`source: 'query:init', detail: 'q:denied'`)
- `GeolocationPositionError code 1` ao clicar no botão de permissão (`source: 'tap:location'`)
- O script `geo-stamp.76ce44a7.js` (do próprio Jotform) exibe o mesmo `[Violation]`
- Widget funciona normalmente no GitHub Pages direto (fora do iframe Jotform)
- Formulários com cache CDN antigo continuaram funcionando normalmente

### Solução provisória implementada

`PROVISIONAL_BYPASS_MODE = true` adicionado ao `index.html` (commits `47ce450`, `954ea63`).

Comportamento no modo bypass:
- Permissões marcadas como concedidas automaticamente, sem chamar APIs do browser
- Gravação simulada visualmente (botão muda de estado) sem acionar `MediaRecorder`
- Submit envia payload JSON identificável ao Jotform:

```json
{
  "v": 3,
  "bypass": true,
  "bypassReason": "provisional-mode",
  "bypassNote": "Permissions-Policy bloqueio Jotform — audio nao capturado",
  "audioUrl": "",
  "recordingId": "rec-...",
  "submittedAt": 1746711322000
}
```

- O sistema de auditoria (quick-responder) deve detectar `bypass: true` e atribuir status `"Erro Jotform de coleta de audio"` em vez de `"Reprovado: Codigo 4 | Sem audio"`

### Bug secundário descoberto durante a mitigação

O campo do widget no Jotform tem nome contendo `"gravador"` — o parser de duração do quick-responder (`extractAudioDurationSeconds`) aplicava `allowClock: true` em valores de campos com esse hint. O `submittedAt` originalmente em ISO string (`"2026-05-08T14:35:22.000Z"`) continha o padrão `14:35` que o regex de clock capturava e interpretava como 875 segundos de áudio. Corrigido usando `Date.now()` (número inteiro) em vez de ISO string.

### Referências técnicas

- Documentação da restrição de permissões em iframes: https://crbug.com/414348233
- Instrução para patch do quick-responder: `docs/quick-responder-bypass-patch.md`
- Ticket enviado ao suporte do Jotform com evidências em 08/05/2026

### Como reverter o bypass

Quando o Jotform corrigir o `Permissions-Policy`:

1. Alterar `PROVISIONAL_BYPASS_MODE = true` para `false` no `index.html`
2. Fazer commit e push → GitHub Pages atualiza em ~1–3 min → formulários voltam ao normal
3. Nenhuma outra mudança é necessária no widget

---

## 2026-04-04 — Migração de projeto Supabase (legado → PRO)

**Severidade:** Planejada  
**Status:** Concluída

Migração da Edge Function de upload de áudio do projeto Supabase legado para o projeto PRO (`egrwllnuutoxjexqkrjv`). O bucket de storage mudou de `audios` para `auditoria-audios`. A Edge Function ativa passou de `audio-upload-url` para `audio-uploader` (com suporte a `projectKey` por `formID`, sanitização NFD e payload v3).

A Edge Function legada (`audio-upload-url`) foi mantida no repo como referência. Formulários antigos continuaram funcionando durante a transição via fallback no parser do quick-responder (v3 → v2 → URL legada).

---

## Anteriores a 2026-04-04 — Evolução do widget (resumo do git log)

| Período | Problema / Decisão | Commits relevantes |
|---|---|---|
| Início | Comunicação Jotform instável; widget não liberava o formulário no submit | `2803a03`, `35628ea`, `92c5635` |
| Bootstrap | `JFCustomWidget` não detectado consistentemente; implementado poll de 250ms + `onJotformReady` | `8c22e57`, `c8459a4`, `b904f7c` |
| Permissões | WebViews (app Jotform) reportavam `prompt/denied` mesmo após permissão real; implementado `mergePermissionState` para preservar `granted` comprovado | `abf85e8` |
| Layout | Botões de permissão com altura dobrada para acessibilidade mobile | `c447034` |
| Recheck | Revalidação de localização mais rápida com cache (`maximumAge`) | `09cbf19` |
| Payload | Migração do valor do campo de URL simples para JSON estruturado (payload v2 → v3) | `d514ae3`, `146a763` |
| Obrigatoriedade | Widget bloqueava submit sem gravação mesmo quando não obrigatório; corrigido com detecção de config do Jotform | `fd8d8dd`, `10ca0db` |

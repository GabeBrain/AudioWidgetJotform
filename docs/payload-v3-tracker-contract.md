# Contrato Proposto: Payload v3 + Tracker Handler

Este documento define um contrato robusto para o campo do widget no Jotform e para o sistema que consome o audio.

## Objetivo

- Tornar `durationMs` confiavel para player/tracker.
- Preservar diagnostico para investigar divergencias.
- Padronizar ids e eventos para auditoria do tracker.
- Manter compatibilidade com payload v2 e formato legado (URL simples).

## Escopo

- Widget: envia novo JSON no campo do Jotform.
- Jotform/Webhook: recebe e persiste o JSON sem quebrar compatibilidade.
- App consumidor do audio: usa contrato para player/tracker, flags e marcacoes.

## Impacto esperado

Estas mudancas podem ficar **restritas ao payload do widget** no curto prazo, mas o sistema consumidor precisa:

- parsear os novos campos (sem depender so de `durationMs` antigo);
- persistir campos novos se quiser auditoria/analytics;
- aplicar regra de duracao canonica no player/tracker.

Se o consumidor ignorar os novos campos, continua funcionando como hoje (com menos robustez).

## Payload v3 (campo do widget no Jotform)

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
  "sizeBytes": 5492012,
  "mimeType": "audio/webm",
  "extension": "webm",
  "recordedAt": "2026-03-06T18:15:30.000Z",
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
  "trackerConfig": {
    "version": 1,
    "canonicalDurationMs": 476812,
    "durationToleranceMs": 2000,
    "durationTolerancePct": 10,
    "flagTypes": [
      "duvida",
      "erro",
      "risco",
      "followup",
      "insight"
    ],
    "severityLevels": [
      "low",
      "medium",
      "high"
    ],
    "statusValues": [
      "open",
      "in_review",
      "resolved"
    ],
    "features": {
      "pointMarkers": true,
      "rangeMarkers": true,
      "loopAB": true,
      "comments": true,
      "auditTrail": true
    }
  }
}
```

## Regras obrigatorias de duracao

- `durationMs` deve ser a duracao canonica para consumo.
- Prioridade da duracao canonica:
1. `duration.blobDecodedMs` (preferencial)
2. `duration.activeRecordingMs` (fallback)
- `duration.wallClockMs` nunca deve ser usada como duracao final no player.
- A duracao canonica deve ser congelada no `stop` da gravacao.
- Ao iniciar nova gravacao, o widget deve resetar estado completo (`recordingId`, chunks, timers, refs e diagnosticos).

## Contrato de tracker para o app consumidor

### Marker (ponto ou intervalo)

```json
{
  "id": "mk_01J2QVYV4DA1P8N8V1M8A7V6ZE",
  "recordingId": "8f3614ba-11ce-4e7f-a784-e0e7b3ef76a2",
  "type": "erro",
  "severity": "high",
  "status": "open",
  "startMs": 125300,
  "endMs": 132900,
  "label": "Trecho com possivel inconsistencia",
  "note": "Conferir valor informado no minuto 2:08.",
  "tags": [
    "auditoria",
    "revisao"
  ],
  "createdBy": "user_123",
  "createdAt": "2026-03-06T18:20:02.000Z",
  "updatedAt": "2026-03-06T18:20:02.000Z"
}
```

### Evento de tracker (telemetria/auditoria)

```json
{
  "eventId": "evt_01J2QW0D7G5NYDEB9CZ6TQ6SC4",
  "playbackSessionId": "ps_01J2QW03Q8M3HNEP3P4M2JB7B4",
  "recordingId": "8f3614ba-11ce-4e7f-a784-e0e7b3ef76a2",
  "eventType": "seek",
  "at": "2026-03-06T18:24:13.000Z",
  "positionMs": 131200,
  "payload": {
    "fromMs": 45200,
    "toMs": 131200,
    "playbackRate": 1.0,
    "state": "playing"
  }
}
```

### Event types recomendados

- `play`
- `pause`
- `seek`
- `ended`
- `stalled`
- `rate_change`
- `volume_change`
- `heartbeat`
- `marker_created`
- `marker_updated`
- `marker_resolved`
- `loop_ab_set`
- `loop_ab_cleared`
- `error`

## Regras para handler robusto

- Fonte de verdade da duracao no player: metadata do proprio audio carregado (`loadedmetadata`), com reconciliacao contra `durationMs` do payload.
- Se diferenca for `> 2000 ms` ou `> 10%`, marcar `durationMismatch=true` e registrar evento `error`/`diagnostic`.
- Todo `seek` e marcador deve ser clampado em `[0, canonicalDurationMs]`.
- Calcular `uniqueListenedMs` por sessao para medir cobertura real de escuta.
- Criar `playbackSessionId` novo a cada abertura/reproducao.
- Guardar trilha de auditoria para mudancas em marker (quem, quando, antes/depois).

## Compatibilidade

Parser recomendado no consumidor:

1. Se `raw` JSON com `v === 3`: usar contrato v3.
2. Se `raw` JSON com `v === 2`: usar campos v2 e tratar `durationMs` com baixa confiabilidade.
3. Se nao for JSON: tratar como formato legado (`audioUrl = raw`).

## Checklist de migracao (sistema consumidor)

1. Atualizar parser do campo do widget para v3 + fallback v2/legado.
2. Ajustar DTO/modelo de persistencia para `recordingId`, `duration.*`, `debug.*`, `trackerConfig`.
3. Ajustar player para usar duracao canonica reconciliada.
4. Implementar tabela/colecao de `tracker_events`.
5. Implementar tabela/colecao de `audio_markers`.
6. Criar dashboards de mismatch (`durationDiff`) e qualidade de gravacao.

## Objetivo de aceite

- Divergencia entre `durationMs` do payload e duracao real do audio <= 2s, ou <= 10% no pior caso.
- Eventos de tracker com auditoria suficiente para reproduzir jornada de escuta e marcacao.

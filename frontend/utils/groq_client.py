import json
import os
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple, Union


GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"
DEFAULT_GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")


def groq_chat(
    messages: Union[str, List[Dict[str, str]]],
    model: Optional[str] = None,
    temperature: float = 0.2,
    max_tokens: int = 320,
    timeout: int = 60,
) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return None, "GROQ_API_KEY nao encontrado.", None

    if isinstance(messages, str):
        messages = [{"role": "user", "content": messages}]

    payload: Dict[str, Any] = {
        "model": model or DEFAULT_GROQ_MODEL,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "messages": messages,
    }
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        GROQ_API_URL,
        data=data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="ignore")
            parsed = json.loads(raw)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="ignore")
        return None, f"Groq HTTP {exc.code}: {detail[:200]}", None
    except Exception as exc:
        return None, f"Erro ao chamar Groq: {exc}", None

    try:
        content = parsed.get("choices", [{}])[0].get("message", {}).get("content")
    except Exception:
        content = None
    if not content or not isinstance(content, str):
        return None, "Resposta vazia do Groq.", payload["model"]
    return content.strip(), None, payload["model"]

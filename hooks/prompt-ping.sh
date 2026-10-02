#!/bin/bash
# Command hook: ping Context Ledger and release the prompt. Never blocks, never calls a model.
input=$(cat || true)

parsed=$(printf '%s' "$input" | /usr/bin/python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    data = {}
print(data.get("conversation_id") or "")
print(data.get("generation_id") or "")
print(data.get("model_id") or data.get("model") or "")
' 2>/dev/null || true)

conversation_id=$(printf '%s\n' "$parsed" | /usr/bin/sed -n '1p')
generation_id=$(printf '%s\n' "$parsed" | /usr/bin/sed -n '2p')
model_name=$(printf '%s\n' "$parsed" | /usr/bin/sed -n '3p')

if [ -n "$conversation_id" ] && [ -n "$generation_id" ]; then
  body=$(/usr/bin/python3 -c 'import json, sys; print(json.dumps({"conversationId": sys.argv[1], "generationId": sys.argv[2], "model": sys.argv[3] or None}))' "$conversation_id" "$generation_id" "$model_name" 2>/dev/null || true)
  if [ -n "$body" ]; then
    /usr/bin/curl --silent --max-time 1 \
      -X POST \
      -H 'Content-Type: application/json' \
      --data "$body" \
      http://127.0.0.1:3847/api/prompt-ping \
      >/dev/null 2>&1 || true
  fi
fi

printf '%s\n' '{"continue":true}'
exit 0

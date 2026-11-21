#!/usr/bin/env bash
set -euo pipefail

# Metadata is available before the CPU runner has loaded the weights. A real
# embedding keeps startup within this probe's deadline instead of the gateway's.
payload='{"model":"embeddinggemma-2:270m-q8_0-text","input":"readiness","dimensions":768,"truncate":false,"options":{"num_ctx":8192,"num_thread":4},"keep_alive":-1}'
exec 3<>/dev/tcp/127.0.0.1/11434
printf 'POST /api/embed HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: %s\r\nConnection: close\r\n\r\n%s' "${#payload}" "$payload" >&3
IFS= read -r response <&3
[[ "$response" == HTTP/1.*' 200 '* ]]
cat <&3 >/dev/null

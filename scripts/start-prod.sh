#!/bin/sh

# The Postgres driver materialises a DATE column at the PROCESS's local
# midnight. On this host (PKT, +0500) that made every business day read one
# day earlier once converted back through UTC. The queries now cast ::text so
# they never produce a Date at all; pinning TZ closes the same class anywhere
# else a DATE reaches JavaScript, and costs nothing — every business day, the
# collection window and every slice boundary are already UTC.
export TZ=UTC

echo "[start-prod] PORT=${PORT:-unset} NODE_ENV=${NODE_ENV:-unset} PID=$$"
exec node dist/index.cjs

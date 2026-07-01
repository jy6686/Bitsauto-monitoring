#!/bin/sh
echo "[start-prod] PORT=${PORT:-unset} NODE_ENV=${NODE_ENV:-unset} PID=$$"
exec node dist/index.cjs

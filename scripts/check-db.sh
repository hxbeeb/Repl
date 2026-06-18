#!/usr/bin/env bash
# Test that the PostgreSQL in DATABASE_URL (.env) is reachable from THIS host.
# Prints only host/port and pass/fail — never the password.
#
# Run on the EC2 box (and/or your laptop):
#   bash scripts/check-db.sh
set -euo pipefail

ENV_FILE="${1:-.env}"
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE here. Pass the path: bash scripts/check-db.sh /path/.env"; exit 1; }

# Pull DATABASE_URL without echoing the whole line.
URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'"'"'')
[ -n "$URL" ] || { echo "DATABASE_URL not set in $ENV_FILE"; exit 1; }

# Parse host + port from postgresql://user:pass@HOST:PORT/db (strip creds).
hostport=$(echo "$URL" | sed -E 's#^[a-zA-Z]+://[^@]*@##; s#/.*$##; s#\?.*$##')
HOST=$(echo "$hostport" | cut -d: -f1)
PORT=$(echo "$hostport" | cut -s -d: -f2)
PORT=${PORT:-5432}

echo "DB host: $HOST"
echo "DB port: $PORT"
echo

# 1. DNS resolves?
if getent hosts "$HOST" >/dev/null 2>&1 || nslookup "$HOST" >/dev/null 2>&1; then
  echo "[ok]  DNS resolves"
else
  echo "[!!]  DNS does NOT resolve — host unreachable from here"
fi

# 2. TCP port open? (try bash /dev/tcp, fall back to nc)
if timeout 5 bash -c "exec 3<>/dev/tcp/$HOST/$PORT" 2>/dev/null; then
  echo "[ok]  TCP $PORT reachable"
elif command -v nc >/dev/null && timeout 5 nc -z "$HOST" "$PORT" 2>/dev/null; then
  echo "[ok]  TCP $PORT reachable (nc)"
else
  echo "[!!]  TCP $PORT NOT reachable — check security group / firewall / host"
fi

# 3. Warn on obvious local-only hosts.
case "$HOST" in
  localhost|127.0.0.1|0.0.0.0)
    echo
    echo "[WARN] DATABASE_URL points at localhost — pods on k3s will NOT reach this."
    echo "       Use a managed/remote PostgreSQL (Neon/RDS) reachable from the box." ;;
esac

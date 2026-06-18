#!/usr/bin/env bash
# Create/update the 'repl-secrets' Kubernetes secret from .env.
# Loads ALL env vars (DATABASE_URL, GEMINI_API_KEY, E2B_API_KEY,
# GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, AUTH_SECRET) and forces the
# production NEXTAUTH_URL. Values never leave the .env file.
#
# Run on the EC2 box from the repo dir (where .env lives):
#   bash scripts/create-secret.sh
set -euo pipefail

ENV_FILE="${1:-.env}"
NS=repl
PROD_URL="https://repl.habeebsaleh.dev"

[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE here. cd to the dir with your .env."; exit 1; }

# Pick the kubectl invocation that works (admin user owns the kubeconfig).
KC="kubectl"
if ! kubectl get nodes >/dev/null 2>&1; then
  if sudo -u admin kubectl get nodes >/dev/null 2>&1; then
    KC="sudo -u admin kubectl"
  else
    echo "kubectl can't reach the cluster. Run setup-amazonlinux-native.sh first."
    echo "Quick fix: sudo chmod 644 /etc/rancher/k3s/k3s.yaml"
    exit 1
  fi
fi

$KC create namespace "$NS" >/dev/null 2>&1 || true

# Parse .env into --from-literal args, STRIPPING surrounding quotes.
# (--from-env-file keeps literal quotes, which breaks values like
#  DATABASE_URL="postgresql://..." → Prisma rejects the leading quote.)
ARGS=()
while IFS= read -r line; do
  case "$line" in ''|'#'*) continue ;; esac
  key=${line%%=*}
  val=${line#*=}
  # Trim surrounding double or single quotes.
  val=${val#\"}; val=${val%\"}
  val=${val#\'}; val=${val%\'}
  [ "$key" = "NEXTAUTH_URL" ] && continue   # force prod value below
  ARGS+=("--from-literal=${key}=${val}")
done < "$ENV_FILE"
ARGS+=("--from-literal=NEXTAUTH_URL=${PROD_URL}")

# Apply (idempotent — re-running updates the secret in place).
$KC -n "$NS" create secret generic repl-secrets \
  "${ARGS[@]}" \
  --dry-run=client -o yaml | $KC apply -f -

echo
echo "Keys stored in repl-secrets:"
$KC -n "$NS" get secret repl-secrets -o jsonpath='{.data}' | tr ',' '\n' | sed -E 's/[:{].*//; s/"//g; s/^ *//' | grep -v '^$'

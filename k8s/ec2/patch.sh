#!/usr/bin/env bash
# Apply k8s manifests tuned for a small single-node EC2 + k3s.
# Run from the repo root on the EC2 host, with IMAGE set, e.g.:
#   IMAGE=docker.io/hxbeeb/repl:latest ./k8s/ec2/patch.sh
set -euo pipefail

: "${IMAGE:?Set IMAGE, e.g. IMAGE=docker.io/hxbeeb/repl:latest}"
NS=repl

kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/service.yaml

# Single replica + lower resource requests so it fits a 2GB node.
sed -e "s|IMAGE_PLACEHOLDER|${IMAGE}|g" \
    -e "s|replicas: 2|replicas: 1|" \
    -e 's|cpu: "100m"|cpu: "50m"|' \
    -e 's|memory: "256Mi"|memory: "192Mi"|' \
    k8s/deployment.yaml | kubectl apply -f -

kubectl -n "$NS" rollout status deployment/repl --timeout=300s
echo "Deployed ${IMAGE} (1 replica) to ${NS}"

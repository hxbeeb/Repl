# CI/CD: Jenkins → Docker → Kubernetes

This app (Next.js 14 + Prisma/PostgreSQL + NextAuth) ships via a Jenkins
pipeline that builds an OCI image, runs DB migrations, and rolls out to
Kubernetes.

## Pipeline flow

```
git push ──► Jenkins (pods) ──► Kaniko build+push ──► registry
                                       │
                                       ├─► prisma migrate deploy (Job)
                                       └─► kubectl rollout (Deployment, 2+ replicas)
```

Each stage runs in an ephemeral Kubernetes pod (Jenkins kubernetes plugin).
The image is built with **Kaniko**, so no Docker daemon is needed on agents.

## Files

| Path | Purpose |
|------|---------|
| `Dockerfile` | Multi-stage build → Next.js `standalone` runner, non-root |
| `.dockerignore` | Keeps build context small / excludes secrets |
| `Jenkinsfile` | Declarative pipeline (build → migrate → deploy) |
| `k8s/namespace.yaml` | `repl` namespace |
| `k8s/secret.example.yaml` | Template for app secrets (do **not** commit real values) |
| `k8s/deployment.yaml` | App Deployment + liveness/readiness probes |
| `k8s/service.yaml` | ClusterIP Service |
| `k8s/ingress.yaml` | Ingress (nginx assumed) |
| `k8s/hpa.yaml` | HorizontalPodAutoscaler (2–6 replicas @ 70% CPU) |
| `k8s/migrate-job.yaml` | `prisma migrate deploy` Job, run per release |
| `k8s/jenkins-rbac.yaml` | ServiceAccount/Role for the deploy pod |
| `app/api/health/route.ts` | Probe endpoint (`?ready=1` checks the DB) |

## One-time cluster setup

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/jenkins-rbac.yaml

# App secrets (replace values):
kubectl -n repl create secret generic repl-secrets \
  --from-literal=DATABASE_URL='postgresql://...' \
  --from-literal=GEMINI_API_KEY='...' \
  --from-literal=E2B_API_KEY='...' \
  --from-literal=NEXTAUTH_URL='https://repl.habeebsaleh.dev' \
  --from-literal=GOOGLE_CLIENT_ID='...' \
  --from-literal=GOOGLE_CLIENT_SECRET='...' \
  --from-literal=AUTH_SECRET="$(openssl rand -base64 32)"

# Registry pull/push creds for Kaniko (docker.io example):
kubectl -n repl create secret docker-registry registry-credentials \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username=YOURUSER \
  --docker-password=YOURTOKEN
```

## Jenkins setup

1. Install the **Kubernetes** and **Pipeline** plugins; point Jenkins at the cluster.
2. Create a **Multibranch Pipeline** (or Pipeline) job pointing at this repo;
   Jenkins auto-detects the `Jenkinsfile`.
3. Edit the `environment {}` block in the `Jenkinsfile`:
   - `REGISTRY` → your registry/org (e.g. `docker.io/hxbeeb`).
4. Edit `repl.habeebsaleh.dev` in `k8s/ingress.yaml` and `NEXTAUTH_URL`.

## Notes

- `next.config.mjs` sets `output: "standalone"` so the runtime image carries
  only the server it needs.
- `prisma generate` runs at build time (via `npm run build` / `postinstall`);
  `prisma migrate deploy` runs at release time as a Job, before the rollout.
- The rollout uses `maxUnavailable: 0` for zero-downtime deploys; a failed
  rollout auto-reverts via the `post { failure }` block.
- Migrations run before the new pods serve traffic. For destructive schema
  changes, use expand/contract migrations to stay backward-compatible.

## Local image build (optional, requires Docker)

```bash
docker build -t repl:dev .
docker run --rm -p 3000:3000 --env-file .env repl:dev
```

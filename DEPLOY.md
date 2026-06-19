# Deployment

This app deploys via a **Jenkins → Docker → k3s** pipeline running on a single
EC2 host. The pipeline is defined in [`Jenkinsfile.ec2`](Jenkinsfile.ec2).

**Flow:** push to `main` → Jenkins (SCM polling) → `docker build` + push to
Docker Hub (`hxbeeb/repl`) → `prisma migrate deploy` (k8s Job) → rolling deploy
to k3s. The app is exposed by IP via a NodePort service.

## Where things are documented

- **Full EC2 setup + run instructions:** [`RUN-ON-EC2.md`](RUN-ON-EC2.md)
- **One-time host setup script:** [`scripts/setup-amazonlinux-native.sh`](scripts/setup-amazonlinux-native.sh)
- **Create app secrets from `.env`:** [`scripts/create-secret.sh`](scripts/create-secret.sh)
- **DB reachability check:** [`scripts/check-db.sh`](scripts/check-db.sh)
- **Kubernetes manifests:** [`k8s/`](k8s/)

## Key files

| Path | Purpose |
|------|---------|
| `Jenkinsfile.ec2` | Pipeline: build (host Docker) → migrate → deploy to k3s |
| `Dockerfile` | Multi-stage build → Next.js `standalone` runner, non-root |
| `k8s/deployment.yaml` | App Deployment + liveness/readiness probes |
| `k8s/service.yaml` | NodePort service (IP-only access) |
| `k8s/migrate-job.yaml` | `prisma migrate deploy` Job, run per release |
| `app/api/health/route.ts` | Probe endpoint (`?ready=1` checks the DB) |

## Notes

- `next.config.mjs` sets `output: "standalone"` for a small runtime image.
- App secrets live in the `repl-secrets` Kubernetes secret (created from `.env`
  on the host), injected into pods via `envFrom`.
- Pushes to `main` auto-deploy (Jenkins Poll SCM, `H/2 * * * *`).

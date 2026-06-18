# Running the pipeline on a single small EC2 instance

Target: one EC2 box (Docker already installed, ≤2GB RAM) running **k3s**
(lightweight Kubernetes) + **Jenkins**, deploying this app via `Jenkinsfile.ec2`.

> ⚠️ **2GB is the bare minimum and will be tight.** k3s + Jenkins + a Docker
> build at once can exhaust memory. The swap step below is not optional on a
> small box. If builds keep getting OOM-killed, resize to t3.medium (4GB).

---

## 0. Open the right ports (EC2 Security Group)

In the AWS console, on the instance's security group, allow inbound:

| Port | Why |
|------|-----|
| 22   | SSH (you, ideally locked to your IP) |
| 80 / 443 | App traffic → ingress |
| 8080 | Jenkins UI (lock to your IP) |

SSH in for the rest:

```bash
ssh ec2-user@<EC2_PUBLIC_IP>      # or ubuntu@ on Ubuntu AMIs
```

---

## 1. Add swap (critical on 2GB)

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h        # confirm Swap shows 2.0Gi
```

---

## 2. Install k3s (single-node Kubernetes)

```bash
curl -sfL https://get.k3s.io | sh -
# kubectl is bundled with k3s. Make it usable without sudo:
mkdir -p ~/.kube
sudo cp /etc/rancher/k3s/k3s.yaml ~/.kube/config
sudo chown $(id -u):$(id -g) ~/.kube/config
export KUBECONFIG=~/.kube/config
echo 'export KUBECONFIG=~/.kube/config' >> ~/.bashrc

kubectl get nodes      # should show the node as Ready
```

k3s ships with **Traefik** as its ingress controller (not nginx). See step 7.

---

## 3. Clone the repo on the box

```bash
git clone https://github.com/hxbeeb/Repl.git
cd Repl
```

---

## 4. Create cluster secrets (do this once, by hand)

App secrets (replace the real values):

```bash
kubectl create namespace repl

kubectl -n repl create secret generic repl-secrets \
  --from-literal=DATABASE_URL='postgresql://...' \
  --from-literal=GEMINI_API_KEY='...' \
  --from-literal=E2B_API_KEY='...' \
  --from-literal=NEXTAUTH_URL='https://repl.habeebsaleh.dev' \
  --from-literal=GOOGLE_CLIENT_ID='...' \
  --from-literal=GOOGLE_CLIENT_SECRET='...' \
  --from-literal=AUTH_SECRET="$(openssl rand -base64 32)"
```

> The app needs a **PostgreSQL** database. A 2GB box should NOT also host
> Postgres — use a managed DB (Neon, RDS, Supabase) and put its connection
> string in `DATABASE_URL`.

---

## 5. Run Jenkins as a container (with host Docker + kubeconfig mounted)

Because `Jenkinsfile.ec2` builds with the **host** Docker daemon, Jenkins needs
the Docker socket and your kubeconfig mounted in:

```bash
docker run -d --name jenkins --restart unless-stopped \
  -p 8080:8080 -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /usr/bin/docker:/usr/bin/docker \
  -v $HOME/.kube/config:/var/jenkins_home/.kube/config:ro \
  -e KUBECONFIG=/var/jenkins_home/.kube/config \
  jenkins/jenkins:lts-jdk17

# kubectl inside the container:
docker exec -u root jenkins bash -c \
  'curl -sLO https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl \
   && install -m 0755 kubectl /usr/local/bin/kubectl && rm kubectl'

# initial admin password:
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

> The kubeconfig from k3s points at `127.0.0.1:6443`. Since Jenkins shares the
> host network path via the mounted socket but runs in its own net namespace,
> edit the mounted config's `server:` to `https://<EC2_PRIVATE_IP>:6443`, OR
> run the Jenkins container with `--network host` (simplest on a single box —
> then drop the `-p` flags).

Open `http://<EC2_PUBLIC_IP>:8080`, paste the password, install suggested
plugins, create your admin user.

---

## 6. Configure Jenkins

1. **Credentials** → add **Username with password**, ID `dockerhub`:
   username `hxbeeb`, password = your Docker Hub access token.
2. **New Item** → **Pipeline** (or Multibranch) → name it `repl`.
3. Pipeline definition → **Pipeline script from SCM** →
   - SCM: Git, URL `https://github.com/hxbeeb/Repl.git`
   - **Script Path: `Jenkinsfile.ec2`**  ← important, not the default `Jenkinsfile`
4. Save → **Build Now**.

---

## 7. Expose the app (Traefik ingress on k3s)

k3s uses Traefik, not nginx, so the provided `k8s/ingress.yaml`
(`ingressClassName: nginx`) won't match. Quickest options:

**Option A — Traefik ingress** (edit ingress class):
```bash
sed 's/ingressClassName: nginx/ingressClassName: traefik/' k8s/ingress.yaml | kubectl apply -f -
```

**Option B — skip ingress, expose the Service directly** on port 80:
```bash
kubectl -n repl patch svc repl -p '{"spec":{"type":"LoadBalancer"}}'
```
k3s's built-in ServiceLB will bind the node's port 80.

Then point DNS: an **A record** for `repl.habeebsaleh.dev` → your EC2 public IP.
For TLS, install cert-manager or use Traefik's Let's Encrypt resolver.

---

## What "run the pipeline" looks like once set up

```
git push  ──►  Jenkins (Build Now / webhook)  ──►  docker build+push to hxbeeb/repl
                                                ──►  prisma migrate deploy (Job)
                                                ──►  kubectl rollout on k3s
```

After the first successful run, add a **GitHub webhook**
(`http://<EC2_PUBLIC_IP>:8080/github-webhook/`) so pushes trigger builds
automatically.

---

## If memory is the problem (likely on 2GB)

- Confirm swap is on (`free -h`).
- Deploy at **1 replica**: the pipeline's k3s deploy already works, but you can
  also run `IMAGE=docker.io/hxbeeb/repl:latest ./k8s/ec2/patch.sh` to apply a
  trimmed 1-replica, low-resource version directly.
- Consider building images **off-box** (your laptop or GitHub Actions) and let
  EC2 only run k3s + deploy. That removes the heaviest step from the small node.
```

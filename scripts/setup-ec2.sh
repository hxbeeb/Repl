#!/usr/bin/env bash
# One-time setup for an EXISTING Ubuntu EC2 box that already has Docker.
# Installs: swap, k3s (single-node Kubernetes), Jenkins (container) pre-wired
# to the host Docker socket + k3s kubeconfig, with pipeline plugins pre-installed
# and the setup wizard skipped.
#
# Usage (on the EC2 box):
#   export JENKINS_ADMIN_PASSWORD='choose-a-strong-password'
#   curl -fsSL https://raw.githubusercontent.com/hxbeeb/Repl/main/scripts/setup-ec2.sh | bash
# or after cloning the repo:
#   JENKINS_ADMIN_PASSWORD='...' bash scripts/setup-ec2.sh
set -euxo pipefail

: "${JENKINS_ADMIN_PASSWORD:?Set JENKINS_ADMIN_PASSWORD before running}"
JENKINS_IMAGE="${JENKINS_IMAGE:-jenkins/jenkins:lts-jdk17}"
RUN_USER="${SUDO_USER:-$(whoami)}"
USER_HOME=$(eval echo "~$${RUN_USER}")

# --- Swap (safety margin during Docker builds) ---
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# --- Verify Docker is present ---
command -v docker >/dev/null || { echo "Docker not found — install it first."; exit 1; }
sudo usermod -aG docker "$${RUN_USER}" || true

# --- k3s (single-node Kubernetes); kubectl is bundled ---
if ! command -v k3s >/dev/null; then
  curl -sfL https://get.k3s.io | sh -
fi
sudo mkdir -p "$${USER_HOME}/.kube"
sudo cp /etc/rancher/k3s/k3s.yaml "$${USER_HOME}/.kube/config"
PRIVATE_IP=$(hostname -I | awk '{print $1}')
sudo sed -i "s/127.0.0.1/$${PRIVATE_IP}/" "$${USER_HOME}/.kube/config"
sudo chown -R "$${RUN_USER}:$${RUN_USER}" "$${USER_HOME}/.kube"
grep -q KUBECONFIG "$${USER_HOME}/.bashrc" || \
  echo "export KUBECONFIG=$${USER_HOME}/.kube/config" >> "$${USER_HOME}/.bashrc"

# --- Pre-seed Jenkins home (plugins + admin user, skip wizard) ---
docker volume create jenkins_home
JHOME=$(docker volume inspect -f '{{.Mountpoint}}' jenkins_home)

sudo mkdir -p "$${JHOME}/init.groovy.d"
sudo tee "$${JHOME}/plugins.txt" >/dev/null <<'EOF'
git
workflow-aggregator
credentials-binding
github
github-branch-source
docker-workflow
configuration-as-code
EOF

sudo tee "$${JHOME}/init.groovy.d/01-admin.groovy" >/dev/null <<EOF
import jenkins.model.*
import hudson.security.*
import jenkins.install.InstallState
def inst = Jenkins.get()
def realm = new HudsonPrivateSecurityRealm(false)
realm.createAccount("admin", "$${JENKINS_ADMIN_PASSWORD}")
inst.setSecurityRealm(realm)
def strategy = new FullControlOnceLoggedInAuthorizationStrategy()
strategy.setAllowAnonymousRead(false)
inst.setAuthorizationStrategy(strategy)
inst.setInstallState(InstallState.INITIAL_SETUP_COMPLETED)
inst.save()
EOF
sudo chown -R 1000:1000 "$${JHOME}"

# Install plugins into the volume before first start.
docker run --rm -v jenkins_home:/var/jenkins_home "$${JENKINS_IMAGE}" \
  jenkins-plugin-cli --plugin-file /var/jenkins_home/plugins.txt \
  --plugin-download-directory /var/jenkins_home/plugins

# --- Start Jenkins (Docker socket + kubeconfig mounted) ---
docker rm -f jenkins 2>/dev/null || true
docker run -d --name jenkins --restart unless-stopped \
  -p 8080:8080 -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /usr/bin/docker:/usr/bin/docker \
  -v "$${USER_HOME}/.kube/config":/var/jenkins_home/.kube/config:ro \
  -e KUBECONFIG=/var/jenkins_home/.kube/config \
  -e JAVA_OPTS="-Djenkins.install.runSetupWizard=false" \
  --group-add "$(getent group docker | cut -d: -f3)" \
  "$${JENKINS_IMAGE}"

# kubectl inside the Jenkins container so pipeline stages can deploy.
sleep 10
docker exec -u root jenkins bash -c '
  curl -sLO "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" &&
  install -m 0755 kubectl /usr/local/bin/kubectl && rm kubectl
'

echo
echo "==================================================================="
echo "Done. Jenkins:  http://$(curl -s ifconfig.me 2>/dev/null || echo '<EC2_PUBLIC_IP>'):8080"
echo "Login:          admin / (the password you set)"
echo "Next: create the repl-secrets secret, then create the pipeline job"
echo "      pointing at Jenkinsfile.ec2 with Poll SCM (H/2 * * * *)."
echo "==================================================================="

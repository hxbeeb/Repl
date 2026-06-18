#!/usr/bin/env bash
# Wire up an EXISTING Amazon Linux box that has Jenkins installed natively (yum)
# so the Jenkinsfile.ec2 pipeline can build with Docker and deploy to k3s.
#
# This variant runs the Jenkins service as the 'admin' user (which you've
# already granted docker permissions) instead of the default 'jenkins' user.
#
# Installs/configures: swap, Docker (if missing), k3s, runs Jenkins as 'admin',
# and gives 'admin' kubectl + a kubeconfig.
#
# Run on the EC2 box:
#   sudo bash scripts/setup-amazonlinux-native.sh
set -euxo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run with sudo."; exit 1; }

RUN_USER="admin"
id "$RUN_USER" >/dev/null 2>&1 || { echo "User '$RUN_USER' does not exist."; exit 1; }
USER_HOME=$(eval echo "~$RUN_USER")

# --- Swap (safety margin during Docker builds) ---
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# --- Docker (install if missing) + admin access ---
if ! command -v docker >/dev/null; then
  yum install -y docker
fi
systemctl enable --now docker
usermod -aG docker "$RUN_USER"

# --- Run the Jenkins service as 'admin' instead of 'jenkins' ---
# Take ownership of Jenkins home so it can start as admin.
chown -R "$RUN_USER":"$RUN_USER" /var/lib/jenkins
chown -R "$RUN_USER":"$RUN_USER" /var/cache/jenkins /var/log/jenkins 2>/dev/null || true

mkdir -p /etc/systemd/system/jenkins.service.d
cat > /etc/systemd/system/jenkins.service.d/override.conf <<EOF
[Service]
User=$RUN_USER
Group=$RUN_USER
Environment="KUBECONFIG=$USER_HOME/.kube/config"
EOF

# --- k3s (single-node Kubernetes); kubectl is bundled ---
if ! command -v k3s >/dev/null; then
  curl -sfL https://get.k3s.io | sh -
fi

# --- Give 'admin' a kubeconfig ---
install -d -o "$RUN_USER" -g "$RUN_USER" "$USER_HOME/.kube"
cp /etc/rancher/k3s/k3s.yaml "$USER_HOME/.kube/config"
PRIVATE_IP=$(hostname -I | awk '{print $1}')
sed -i "s/127.0.0.1/${PRIVATE_IP}/" "$USER_HOME/.kube/config"
chown -R "$RUN_USER":"$RUN_USER" "$USER_HOME/.kube"
chmod 600 "$USER_HOME/.kube/config"
grep -q KUBECONFIG "$USER_HOME/.bashrc" 2>/dev/null || \
  echo "export KUBECONFIG=$USER_HOME/.kube/config" >> "$USER_HOME/.bashrc"

# --- Make kubectl available on PATH (symlink k3s) ---
ln -sf "$(command -v k3s)" /usr/local/bin/kubectl

# --- Restart Jenkins so the new user + env take effect ---
systemctl daemon-reload
systemctl restart jenkins

echo
echo "==================================================================="
echo "Wired up. Jenkins now runs as '$RUN_USER'. Verify:"
echo "  sudo -u $RUN_USER docker ps"
echo "  sudo -u $RUN_USER kubectl get nodes"
echo "Both should work. Then: create repl-secrets, configure the job"
echo "(Jenkinsfile.ec2, Poll SCM H/2 * * * *)."
echo "==================================================================="

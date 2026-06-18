# Terraform: provision the Repl EC2 host

Creates a t3.medium EC2 instance in **ap-south-1** with a security group, and
**auto-installs Docker + k3s + Jenkins on boot** via cloud-init. After `apply`
you get a ready-to-configure Jenkins + a single-node Kubernetes cluster.

## What it creates

| Resource | Purpose |
|----------|---------|
| `aws_instance.repl` | Ubuntu 22.04, t3.medium, 30GB gp3 |
| `aws_security_group.repl` | SSH + Jenkins (locked to your IP), HTTP/HTTPS open |
| user-data | swap, Docker, k3s, Jenkins container (wired to Docker + kubeconfig) |

It uses your **default VPC/subnet** — nothing else to manage.

## Prerequisites

1. **AWS credentials** configured locally:
   ```bash
   aws configure        # or export AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
   aws sts get-caller-identity   # confirm it works
   ```
2. An **existing EC2 key pair** in ap-south-1 (you said you'd provide the name).
   List them: `aws ec2 describe-key-pairs --region ap-south-1`

## Run it

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars
# edit terraform.tfvars: set key_name and admin_cidr (your.ip/32)

terraform init
terraform plan
terraform apply
```

Outputs include the public IP, SSH command, and Jenkins URL.

## After apply (~3-5 min for boot to finish)

```bash
# Watch the bootstrap finish (optional):
ssh ubuntu@<IP> 'tail -f /var/log/repl-bootstrap.log'   # wait for "BOOTSTRAP COMPLETE"

# Get the Jenkins initial admin password:
terraform output -raw jenkins_initial_password_cmd | bash
```

Then open `http://<IP>:8080` and follow **RUN-ON-EC2.md** from step 6
(configure Jenkins: add the `dockerhub` credential, create the `repl` pipeline
job pointing at `Jenkinsfile.ec2`).

## Important notes

- **`admin_cidr` defaults to `0.0.0.0/0` (open to the world).** Always set it to
  `your.ip/32` in `terraform.tfvars` so SSH and Jenkins aren't public.
- **Database:** the app still needs an external PostgreSQL (Neon/RDS). Terraform
  here does NOT create a DB — keep it managed and off this box.
- **State:** `terraform.tfstate` is local and gitignored. For a team, move it to
  an S3 backend.

## Tear down

```bash
terraform destroy
```

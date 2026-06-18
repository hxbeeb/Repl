variable "region" {
  description = "AWS region"
  type        = string
  default     = "ap-south-1"
}

variable "name" {
  description = "Name tag / resource prefix"
  type        = string
  default     = "repl"
}

variable "instance_type" {
  description = "EC2 instance type"
  type        = string
  default     = "t3.medium"
}

variable "disk_gb" {
  description = "Root EBS volume size (GB). Docker images + Jenkins home need room."
  type        = number
  default     = 30
}

variable "key_name" {
  description = "Name of an existing EC2 key pair in this region for SSH."
  type        = string
}

variable "admin_cidr" {
  description = "CIDR allowed to reach SSH (22) and Jenkins (8080). Use your.ip/32."
  type        = string
  # WARNING: default is open to the world. Override with your IP in terraform.tfvars.
  default = "0.0.0.0/0"
}

variable "jenkins_image" {
  description = "Jenkins container image"
  type        = string
  default     = "jenkins/jenkins:lts-jdk17"
}

variable "jenkins_admin_password" {
  description = "Password for the seeded Jenkins 'admin' user. Set in terraform.tfvars."
  type        = string
  sensitive   = true
}

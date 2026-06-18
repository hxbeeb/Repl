output "public_ip" {
  description = "Public IP of the EC2 instance"
  value       = aws_instance.repl.public_ip
}

output "ssh" {
  description = "SSH command"
  value       = "ssh ubuntu@${aws_instance.repl.public_ip}"
}

output "jenkins_url" {
  description = "Jenkins UI (wait a few minutes after apply for boot to finish)"
  value       = "http://${aws_instance.repl.public_ip}:8080"
}

output "jenkins_login" {
  description = "Jenkins is pre-configured: log in as 'admin' with the password you set in terraform.tfvars (jenkins_admin_password)."
  value       = "user: admin  (password = your jenkins_admin_password)"
}

output "dns_hint" {
  description = "Point your domain here"
  value       = "Create an A record: repl.habeebsaleh.dev -> ${aws_instance.repl.public_ip}"
}

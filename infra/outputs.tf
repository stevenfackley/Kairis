output "ecr_registry" {
  description = "Set as GitHub repository variable ECR_REGISTRY"
  value       = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com"
}

output "ecr_repository_url" {
  description = "Image repository the build job pushes to"
  value       = aws_ecr_repository.web.repository_url
}

output "github_actions_role_arn" {
  description = "Set as GitHub repository secret AWS_OIDC_ROLE_ARN"
  value       = aws_iam_role.github_actions.arn
}

output "tunnel_id" {
  description = "Cloudflare tunnel id"
  value       = cloudflare_zero_trust_tunnel_cloudflared.web.id
}

output "hostname" {
  description = "Public hostname"
  value       = var.hostname
}

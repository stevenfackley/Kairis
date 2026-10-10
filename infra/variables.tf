variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "app" {
  description = "App slug; used for names and the app-<slug> tag the deploy workflow targets"
  type        = string
  default     = "kairis"
}

variable "hostname" {
  description = "Public hostname served through the Cloudflare tunnel"
  type        = string
  default     = "kairis.qavrensolutions.com"
}

variable "cloudflare_zone_name" {
  description = "Cloudflare zone that contains hostname; stripped from hostname to get the CNAME record name"
  type        = string
  default     = "qavrensolutions.com"
}

variable "cloudflare_api_token" {
  description = "Cloudflare API token: Zone:DNS:Edit and Zone:Zone:Read on the zone, Account:Cloudflare Tunnel:Edit"
  type        = string
  sensitive   = true
}

variable "cloudflare_account_id" {
  description = "Cloudflare account ID"
  type        = string
}

variable "cloudflare_zone_id" {
  description = "Zone ID of cloudflare_zone_name"
  type        = string
}

variable "github_repo" {
  description = "GitHub repo in owner/name format; scopes the OIDC role"
  type        = string
  default     = "stevenfackley/Kairis"
}

variable "create_github_oidc_provider" {
  description = "false when the account already has the GitHub Actions OIDC provider (it does: created by another project)"
  type        = bool
  default     = false
}

# --- Shared host (2026-10 AWS consolidation) ---
# kairis runs on the shared x86 host Qavren-Web-Server. That host is hand-built (no Terraform owns
# it), so this root only attaches what kairis needs: a tag the deploy finds it by, and read access
# on the host's existing instance role.
variable "hub_instance_id" {
  description = "Shared x86 host that runs kairis (Qavren-Web-Server)."
  type        = string
  default     = "i-03ba0ecb6f5697d64"
}

variable "hub_role_name" {
  description = "Instance role of the shared host. Not managed here; kairis only adds an inline policy to it."
  type        = string
  default     = "QavrenRole"
}

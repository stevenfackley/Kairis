resource "random_id" "tunnel_secret" {
  byte_length = 32
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "web" {
  account_id    = var.cloudflare_account_id
  name          = "${var.app}-web"
  tunnel_secret = random_id.tunnel_secret.b64_std
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "web" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.web.id

  config = {
    ingress = [
      {
        hostname = var.hostname
        service  = "http://web:3000"
      },
      {
        service = "http_status:404"
      },
    ]
  }
}

# Provider v5 dropped the tunnel resource's computed tunnel_token; the token now comes from this data source.
data "cloudflare_zero_trust_tunnel_cloudflared_token" "web" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.web.id
}

resource "cloudflare_dns_record" "web" {
  zone_id = var.cloudflare_zone_id
  # kairis.qavrensolutions.com in zone qavrensolutions.com -> "kairis"; the apex becomes "@".
  name    = var.hostname == var.cloudflare_zone_name ? "@" : trimsuffix(var.hostname, ".${var.cloudflare_zone_name}")
  content = "${cloudflare_zero_trust_tunnel_cloudflared.web.id}.cfargotunnel.com"
  type    = "CNAME"
  proxied = true
  ttl     = 1 # automatic; required in provider v5
}

# Provider v5 renamed cloudflare_record to cloudflare_dns_record; the provider's MoveState handler carries the
# existing record over. Needs Terraform >= 1.8. Safe to delete after the first successful apply on v5.
moved {
  from = cloudflare_record.web
  to   = cloudflare_dns_record.web
}

# The tunnel token reaches the host at deploy time via SSM Parameter Store; never via GitHub secrets.
resource "aws_ssm_parameter" "tunnel_token" {
  name  = "/${var.app}/prod/tunnel_token"
  type  = "SecureString"
  value = data.cloudflare_zero_trust_tunnel_cloudflared_token.web.token
  tags  = { App = var.app }
}

resource "random_id" "tunnel_secret" {
  byte_length = 32
}

resource "cloudflare_zero_trust_tunnel_cloudflared" "web" {
  account_id = var.cloudflare_account_id
  name       = "${var.app}-web"
  secret     = random_id.tunnel_secret.b64_std
}

resource "cloudflare_zero_trust_tunnel_cloudflared_config" "web" {
  account_id = var.cloudflare_account_id
  tunnel_id  = cloudflare_zero_trust_tunnel_cloudflared.web.id

  config {
    ingress_rule {
      hostname = var.hostname
      service  = "http://web:3000"
    }
    ingress_rule {
      service = "http_status:404"
    }
  }
}

resource "cloudflare_record" "web" {
  zone_id = var.cloudflare_zone_id
  # kairis.qavrensolutions.com in zone qavrensolutions.com -> "kairis"; the apex becomes "@".
  name    = var.hostname == var.cloudflare_zone_name ? "@" : trimsuffix(var.hostname, ".${var.cloudflare_zone_name}")
  content = "${cloudflare_zero_trust_tunnel_cloudflared.web.id}.cfargotunnel.com"
  type    = "CNAME"
  proxied = true
}

# The tunnel token reaches the host at deploy time via SSM Parameter Store; never via GitHub secrets.
resource "aws_ssm_parameter" "tunnel_token" {
  name  = "/${var.app}/prod/tunnel_token"
  type  = "SecureString"
  value = cloudflare_zero_trust_tunnel_cloudflared.web.tunnel_token
  tags  = { App = var.app }
}

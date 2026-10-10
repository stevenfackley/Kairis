# --- GitHub Actions OIDC role: pushes images, sends the SSM deploy command ---
resource "aws_iam_openid_connect_provider" "github" {
  count           = var.create_github_oidc_provider ? 1 : 0
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1", "1c58a3a8518e8759bf075b76b750d4f2df264fcd"]
}

locals {
  oidc_provider_arn = var.create_github_oidc_provider ? aws_iam_openid_connect_provider.github[0].arn : "arn:aws:iam::${data.aws_caller_identity.current.account_id}:oidc-provider/token.actions.githubusercontent.com"
  repo_arns         = [aws_ecr_repository.web.arn]
  gh_owner          = split("/", var.github_repo)[0]
  gh_repo           = split("/", var.github_repo)[1]
  ssm_param_arn     = "arn:aws:ssm:${var.aws_region}:${data.aws_caller_identity.current.account_id}:parameter/${var.app}/prod/*"
}

resource "aws_iam_role" "github_actions" {
  name        = "${var.app}-github-actions"
  description = "Assumed by GitHub Actions for ${var.github_repo}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = local.oidc_provider_arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        # GitHub issues two subject formats: the classic "repo:owner/name:..." and, for newer
        # repositories, "repo:owner@OWNER_ID/name@REPO_ID:...".
        StringLike   = { "token.actions.githubusercontent.com:sub" = ["repo:${var.github_repo}:*", "repo:${local.gh_owner}@*/${local.gh_repo}@*:*"] }
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
      }
    }]
  })

  tags = { App = var.app }
}

resource "aws_iam_role_policy" "ecr_push" {
  name = "${var.app}-ecr-push"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "ECRAuth", Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      {
        Sid    = "ECRPush"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:CompleteLayerUpload", "ecr:InitiateLayerUpload",
          "ecr:PutImage", "ecr:UploadLayerPart", "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer",
        ]
        Resource = local.repo_arns
      },
    ]
  })
}

resource "aws_iam_role_policy" "ssm_deploy" {
  name = "${var.app}-ssm-deploy"
  role = aws_iam_role.github_actions.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "SendToSharedHost"
        Effect    = "Allow"
        Action    = ["ssm:SendCommand"]
        Resource  = "arn:aws:ec2:*:*:instance/*"
        Condition = { StringEquals = { "ssm:resourceTag/app-${var.app}" = "true" } }
      },
      {
        Sid      = "SendRunShellScript"
        Effect   = "Allow"
        Action   = ["ssm:SendCommand"]
        Resource = "arn:aws:ssm:*:*:document/AWS-RunShellScript"
      },
      {
        Sid      = "ReadBack"
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation", "ssm:DescribeInstanceInformation", "ssm:ListCommandInvocations"]
        Resource = "*"
      },
    ]
  })
}

# --- Shared host: tag it for the deploy lookup, let its role pull images and read the token ---
resource "aws_ec2_tag" "hub_app" {
  resource_id = var.hub_instance_id
  key         = "app-${var.app}"
  value       = "true"
}

resource "aws_iam_role_policy" "hub_pull" {
  name = "${var.app}-hub-pull"
  role = var.hub_role_name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Sid = "ECRAuth", Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
      {
        Sid      = "ECRPull"
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = local.repo_arns
      },
      {
        Sid      = "TunnelToken"
        Effect   = "Allow"
        Action   = ["ssm:GetParameter"]
        Resource = local.ssm_param_arn
      },
    ]
  })
}

# infra

Terraform for Kairis prod on the shared hub (Qavren-Web-Server): one ECR repo (`kairis-web`), a
GitHub OIDC role scoped to `stevenfackley/Kairis`, the `app-kairis=true` tag on the hub instance,
an inline `kairis-hub-pull` policy on the hub's existing `QavrenRole`, and a Cloudflare Tunnel with
a proxied CNAME for `kairis.qavrensolutions.com`. No EC2 instance is created here. State is local
and gitignored.

    cp terraform.tfvars.example terraform.tfvars   # fill in Cloudflare values
    terraform init && terraform plan -out tfplan && terraform apply tfplan
    terraform output

Then in GitHub: variables `AWS_REGION`, `ECR_REGISTRY`; repository secret `AWS_OIDC_ROLE_ARN` (the
build job runs outside the environment); environment `production` secrets `DOTENV_CONTENT`,
`EXTRA_ENV_CONTENT` (optional), `QAVREN_DB_PROD_SESSION_URL` (session-mode URL for migrations).
The tunnel token reaches the host only via SSM Parameter Store (`/kairis/prod/tunnel_token`),
read at deploy time; it never goes through GitHub secrets.

## The host `.env`

`DOTENV_CONTENT` is the whole of `/opt/kairis/.env` bar the lines the deploy appends
(`ECR_REGISTRY`, `IMAGE_TAG`, `TUNNEL_TOKEN`). Keys the app needs:

    NEXT_PUBLIC_APP_NAME=Kairis
    NEXT_PUBLIC_APP_ENV=production
    APP_BASE_URL=https://kairis.qavrensolutions.com
    AUTH_URL=https://kairis.qavrensolutions.com
    AUTH_SECRET=
    AUTH_TRUST_HOST=true
    QAVREN_AUTH_URL=https://auth.qavrensolutions.com
    QAVREN_REALM=kairis
    KAIRIS_OWNER_EMAILS=
    KAIRIS_SECRET_KEY=
    DATABASE_URL=          # qavren-db transaction pooler :6543, role kairis.<ref>
    ENABLE_LIVE_ASSISTED_TRADING=false
    ENABLE_AUTO_MODE=false
    R2_ACCOUNT_ID=
    R2_ACCESS_KEY_ID=
    R2_SECRET_ACCESS_KEY=
    R2_BUCKET=kairis-prod
    R2_PUBLIC_URL=

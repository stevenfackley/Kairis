# Identity

Kairis signs users in through qavren-auth (Keycloak) using `@qavren/auth-next` on next-auth v5. It stores
no passwords.

## Realms

| Realm | Used by | Redirect URI |
|---|---|---|
| `kairis` | production | `https://kairis.qavrensolutions.com/*` |
| `kairis-dev` | local development | `http://localhost:3000/*` |

Each realm has one public PKCE client named `<realm>-web` (`kairis-web`, `kairis-dev-web`). The SDK
derives the issuer (`{QAVREN_AUTH_URL}/realms/{realm}`) and the client id from `QAVREN_REALM`, so no
client id or secret is configured in Kairis. The realms are separate user pools with separate SSO
sessions. Provisioning steps are in [deployment.md](deployment.md).

Local `.env.example` sets `QAVREN_REALM=kairis-dev` and `QAVREN_AUTH_URL=https://auth.qavrensolutions.com`.
To run qavren-auth locally instead, point `QAVREN_AUTH_URL` at that instance.

## Session

`auth.ts` extends the SDK defaults so the session carries:

- `user.id`: the Keycloak `sub`. Every Kairis row is keyed by it.
- `user.email` and `user.name`
- `user.roles`: realm roles from the token (`realm_access.roles`)

`lib/server/session.ts` turns that into a `CurrentUser` with an `isOwner` flag.

## Owner gate

A user is an owner when their email is listed in `KAIRIS_OWNER_EMAILS` (comma separated, compared in
lower case) or they hold the realm role `owner`. Owner-only surfaces: `/app/operations` and the auto
cycle. `requireOwner()` answers non-owners with a 404 rather than a redirect.

## Route gating

`proxy.ts` matches `/app/:path*`. Without a session it redirects to `/sign-in?...` with the original path
as the callback. The landing page, `/sign-in` and the API routes are public; `/api/health` and
`/api/system/status` do not need a session, but the status endpoint returns its full configuration
report only to the owner (everyone else sees just whether the database answers). Server code uses `requireUser()` or `requireOwner()` from
`lib/server/session.ts`, so the gate does not rest on the proxy alone. After sign-in the user returns to
the callback path (same-origin paths only, default `/app`).

## Sign-out

The sign-out action (`app/sign-out/actions.ts`) ends the Kairis session and returns to `/`. It does not end
the Keycloak SSO session, so signing in again right away may skip the password prompt.

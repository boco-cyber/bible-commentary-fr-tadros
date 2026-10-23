# Deployment

Runtime: **AboHub (`155.248.209.35`)**. The Coolify control plane stays at
`https://hub.copticfaith.org` (`163.192.16.13`). See [production topology](../DEPLOYMENT.md).

Production runs on Coolify at `https://commentary.copticfaith.org`. The SQLite
database is built inside the Docker image, so there is no persistent volume,
init job, or runtime migration. The public-domain Scripture JSONL under
`data/bible/` is copied into the image and loaded into memory on first use; no
extra volume or environment variable is required.

## Coolify application settings

| Setting | Value |
|---|---|
| Repository | `boco-cyber/bible-commentary-fr-tadros` |
| Build pack | Dockerfile |
| Dockerfile location | `/Dockerfile` |
| Base directory | `/` |
| Container port | `3000` |
| Health check path | `/health` |
| Domain | `https://commentary.copticfaith.org` |
| Persistent storage | None |

The base directory must be `/` so the Docker build can copy the committed
`data/` files used to build `commentary.sqlite` and the `data/bible/` Scripture
JSONL used by `/scripture` and `/study`.

## Environment variables

Copy the values from [`backend/.env.example`](../backend/.env.example):

| Variable | Example / default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port inside the container |
| `DB_PATH` | `./data/commentary.sqlite` | SQLite file to open read-only |
| `CORS_ORIGINS` | `*` | Comma-separated allowed origins |
| `RATE_LIMIT_PER_MIN` | `120` | Per-IP request limit |
| `SITE_NAME` | `Bible Commentary — Fr. Tadros Malaty` | Metadata display name |
| `PUBLIC_BASE_URL` | `https://commentary.copticfaith.org` | Base URL used in section links |
| `NODE_ENV` | `production` | Runtime mode |

All endpoints are public and read-only; no secrets are required by the
application itself.

## GitHub Actions secrets

Configure these repository secrets for the deploy workflow:

| Secret | Purpose |
|---|---|
| `COOLIFY_BASE_URL` | Coolify base URL, for example `https://hub.copticfaith.org` |
| `COOLIFY_API_TOKEN` | Coolify API token with deploy permission |
| `COOLIFY_APP_UUID` | UUID of the Coolify application |

Optional repository variables:

| Variable | Purpose |
|---|---|
| `PRODUCTION_RESOLVE` | `curl --resolve` for the public API origin, e.g. `commentary.copticfaith.org:443:155.248.209.35`, when Cloudflare blocks GitHub health checks |
| `COOLIFY_RESOLVE` | `curl --resolve` value such as `hub.copticfaith.org:443:163.192.16.13`, used to bypass Cloudflare Bot Fight Mode during deployment |

The workflow runs the test suite and database build before triggering a
deploy. A failed build or test run prevents deployment.

## Manual deploy

```bash
export COOLIFY_BASE_URL='https://hub.copticfaith.org'
export COOLIFY_API_TOKEN='<token>'
export COOLIFY_APP_UUID='<app-uuid>'

curl --fail-with-body -sS \
  ${COOLIFY_RESOLVE:+--resolve "$COOLIFY_RESOLVE"} \
  -X POST "$COOLIFY_BASE_URL/api/v1/deploy?uuid=$COOLIFY_APP_UUID" \
  -H "Authorization: Bearer $COOLIFY_API_TOKEN" \
  -H 'Accept: application/json'
```

Set `COOLIFY_RESOLVE` only when the Coolify host must bypass Cloudflare:

```bash
export COOLIFY_RESOLVE='hub.copticfaith.org:443:163.192.16.13'
```

Poll the deployment in Coolify until it reports success, then verify:

```bash
curl --fail 'https://commentary.copticfaith.org/health'
```

The response should report `status: "ok"`, 67 books, 7,590 sections, and a
build timestamp.

## Rollback

Because every deploy produces an immutable image containing its own database:

1. Open the application in Coolify and select **Deployments**.
2. Choose the last known-good successful deployment.
3. Redeploy that deployment, or redeploy the previous Git commit.

Rolling back the image also rolls back the commentary data. No database
restore is needed.

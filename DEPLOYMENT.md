# Production deployment

Updated 2026-10-23 after migration to AboHub.

| Setting | Value |
|---|---|
| Runtime server | AboHub — `155.248.209.35` |
| Coolify server UUID | `qit4mjbfkpigeillcdnw5k0c` |
| Docker destination UUID | `z6ty1zudb3wyoxmenu8i1psb` |
| Coolify dashboard / API | `https://hub.copticfaith.org` on `163.192.16.13` |
| Application | `bible-commentary-api` |
| Application UUID | `ix26hf3a4afyduvyt3s3yzza` |
| Production Git branch | `main` |
| Public URL | https://commentary.copticfaith.org |

## Updates from GitHub

GitHub Actions calls the existing Coolify API deployment endpoint. `PRODUCTION_RESOLVE` is `commentary.copticfaith.org:443:155.248.209.35`; `COOLIFY_RESOLVE` remains `hub.copticfaith.org:443:163.192.16.13`.

Push application changes to `main`. Coolify uses the same application UUID, settings, environment variables, and repository authentication, and builds/runs the update on AboHub. Deployment calls target the Coolify control plane, not the AboHub IP directly. Do not point `COOLIFY_BASE_URL` or `COOLIFY_RESOLVE` at AboHub.

## Data and secrets

Commentary SQLite and Scripture JSONL data are baked into the application image. There are no persistent application volumes. Updates to those data files require a normal image build and deployment.

Cloudflare's existing proxied A records point at `155.248.209.35`. AboHub's Oracle network security group and operating-system firewall allow TCP 80 and 443. SSH administration uses `ubuntu@155.248.209.35`; Coolify uses its dedicated management key.

## Recovery

Migration snapshots are retained under `/root/abohub-migration-20261023` on the original server (`163.192.16.13`). Original app containers are stopped and their volumes retained. The original proxy forwards these domains to AboHub for clients using the old origin. Before rolling WordPress back, take a fresh database/file backup from AboHub so new writes are preserved.

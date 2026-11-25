# Nodrail Helm chart

This chart installs the console and API Deployment, Service, migration hook and scheduled delivery job. Provision PostgreSQL 17, an application database and its owner before installation. The migration owner needs `CREATEROLE` and the ability to manage Nodrail's roles. The migration job provisions separate restricted application and authentication logins.

Create these Secrets in the release namespace before running Helm. Use a dedicated Postgres cluster or restrict each login to its own database. Postgres roles are shared across databases on a cluster.

| Default Secret      | Required keys                                     | Optional keys                                   |
| ------------------- | ------------------------------------------------- | ----------------------------------------------- |
| `nodrail-app`       | `DATABASE_URL`, `AUTH_DATABASE_URL`                 | `DATABASE_CA`, `SMTP_URL`, `NOTIFICATIONS_FROM` |
| `nodrail-migrate`   | `MIGRATION_DATABASE_URL`, `APP_DATABASE_PASSWORD`, `AUTH_DATABASE_PASSWORD` | `APP_DATABASE_USER`, `DATABASE_CA`              |
| `nodrail-scheduler` | `NOTIFICATIONS_SECRET`                            |                                                 |

Set `DATABASE_URL` to use `APP_DATABASE_USER` (default `nodrail_app_login`) and `AUTH_DATABASE_URL` to use `nodrail_auth_login`. The passwords must match their respective entries in the migration Secret. Keep the owner connection in the migration Secret. Remote Postgres requires verified TLS. Provide a trusted PEM chain in `DATABASE_CA` in both database Secrets, or use `sslmode=verify-full` in each connection URL to use system roots.

Use HTTPS for a public `appOrigin`, including when TLS terminates upstream. Configure your trusted ingress or reverse proxy to overwrite a header with one client IP. Set `AUTH_CLIENT_IP_HEADER` through `extraEnv` to that header's name and restrict direct access to the app.

```sh
helm upgrade --install control . --namespace nodrail \
  --set appOrigin=https://control.example.org \
  --set-string image.digest="$NODRAIL_SERVER_DIGEST" \
  --set-string migration.digest="$NODRAIL_MIGRATE_DIGEST" \
  --wait --timeout 10m
```

Use the verified index digest for each image. The workloads run as UID and GID 1000 and use the Linux Restricted Pod Security settings.

| Values                                                                                       | Purpose                                                                                                        |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `appOrigin`                                                                                  | Public origin for links and authentication. Defaults to `http://localhost:3000` with Ingress disabled.         |
| `replicaCount`, `resources`                                                                  | App replicas and Kubernetes container resource settings. Start with one replica.                               |
| `nodeSelector`                                                                               | Optional Pod node selector. On mixed clusters, pin `kubernetes.io/arch` so replicas use the same server build. |
| `image.repository`, `image.digest`, `image.tag`, `image.pullPolicy`                          | App and scheduler image. Set the verified digest or use the tag, which defaults to the chart's app version.    |
| `migration.repository`, `migration.digest`, `migration.tag`                                  | Migration image. Set its own verified digest or use the tag, which defaults to the server image tag.           |
| `migration.existingSecret`, `migration.activeDeadlineSeconds`                                | Name of the migration Secret and hook deadline.                                                                |
| `appSecret`, `schedulerSecret`                                                               | Names of the existing app and scheduler Secrets.                                                               |
| `extraEnv`                                                                                   | Additional app settings in Kubernetes `EnvVar` format.                                                         |
| `service.port`                                                                               | Internal Service port. Defaults to 80.                                                                         |
| `ingress.enabled`, `ingress.host`, `ingress.className`, `ingress.annotations`, `ingress.tls` | Ingress requires an HTTPS `appOrigin` with the same public hostname.         |
| `scheduler.enabled`, `scheduler.schedule`                                                    | Delivery, retries and retention schedule. If disabled, supply an external scheduler.                           |

Migrations run before installation and upgrade. Back up the database first. After a failed hook, inspect the migration Job logs before retrying. Run `pnpm admin:create --email you@example.com --generate` as a one-shot Job using the migration image and migration Secret. Override the image entrypoint with `pnpm` for that Job. SMTP is optional and enables sign-in links, verified signup and password reset. Set `NOTIFICATIONS_FROM` and use `smtps://` for implicit TLS or `smtp://` for STARTTLS.

Run chart regressions from `apps/web` with `node --test tests/helm.test.mjs` and Helm installed.

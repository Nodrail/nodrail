# Nodrail server

**The open control plane for AI agent development.**

Think of `nodrail.yaml`, rule files and `nodrail.lock.yaml` as Kubernetes
manifests. Use `nodrail plan` to preview changes and `nodrail apply` to install
or publish them. The server provides the API and console, stores policy and
run history in Postgres, and runs scheduled jobs. The agent hook is the data
plane. It uses the open policy engine to allow or deny calls on each host
and reports decisions back to the control plane. The console is the control
plane's web interface.

## Self-host with Docker Compose

1. From the repository root, build the application and migration images.

   ```sh
   docker build -f apps/web/Dockerfile -t nodrail-local/server:dev .
   docker build -f apps/web/Dockerfile --target server-migrate -t nodrail-local/server-migrate:dev .
   ```

2. Copy the environment template.

   ```sh
   cd apps/web/deploy
   cp .env.example .env
   ```

   Set `NODRAIL_REGISTRY=nodrail-local` and `NODRAIL_VERSION=dev`.
   Fill in the four Postgres passwords and the notification scheduler secret
   with independent random values (`openssl rand -hex 24`). Set `APP_ORIGIN`
   to the public HTTPS origin or use `http://localhost:3000` for local
   evaluation. For public sign-in, configure a trusted reverse proxy to
   overwrite `AUTH_CLIENT_IP_HEADER` with one client IP. Keep the app port
   reachable only through that proxy.

3. Run `docker compose up -d`. Compose applies migrations and provisions
   the separate application and authentication logins before starting the app.
   Create the first administrator with the migration image.

   ```sh
   docker compose run --rm --entrypoint pnpm migrate admin:create --email you@example.com --generate
   ```

   Save the password securely. Open `APP_ORIGIN`, sign in and create a
   workspace. Point your CLI there with `NODRAIL_URL`. Set `SMTP_URL` and
   `NOTIFICATIONS_FROM` to enable sign-in links, verified signup and reset
   emails. Use `smtps://` for implicit TLS or `smtp://` for STARTTLS.

For Kubernetes, follow the [Helm chart README](apps/web/deploy/helm/nodrail/README.md).
Supply both `DATABASE_URL` and `AUTH_DATABASE_URL` to the server.

## Development

Use Node.js 22 or later and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm lint
pnpm test
pnpm build
```

See [Contributing](CONTRIBUTING.md) for the Postgres tests and
[LICENSE](LICENSE) for the Apache-2.0 terms.

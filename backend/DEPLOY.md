# Deploying the Calgy API (VM, no custom domain)

The API runs in Docker on one small Linux VM, behind Caddy, which handles HTTPS automatically. Without a domain, the hostname comes from the VM's IP via sslip.io: `203.0.113.5` → `203-0-113-5.sslip.io`. The web app (Vercel) calls it with Firebase ID tokens (`AUTH_MODE=bearer`).

Run **one instance only**. The reminder and aggregate cron jobs run inside the API process, so a second instance would send every reminder twice. To run more, set `DISABLE_JOBS=true` on all but one instance, or add a Firestore lock per job first.

## One-time Firebase setup

1. Create the Firebase project (the free Spark plan is enough). Create Firestore in production mode, in the region with the best latency for Nigerian users. **The region can't be changed later.**
2. Authentication → Sign-in method: enable **Anonymous**, **Google** and **Email link**.
3. Authentication → Settings → Authorized domains: `localhost`, `<project>.vercel.app`, and any preview domains you actually use. The sslip.io API host doesn't need adding.
4. Project settings → Service accounts → **Generate new private key**. It goes into `api.env` as `CRED`, base64-encoded (step 4 below). Never commit it; delete the downloaded file once it's in place.
5. From the repo root, deploy the rules and indexes:
   `npx firebase-tools deploy --only firestore:rules,firestore:indexes --project <project-id>`
   (`firebase.json` points at `firebase/firestore.rules`. Never deploy `firestore.dev.rules`.)

## Deploy

1. **Provision the VM**: 1 vCPU / 1 GB is enough. Give it a **static public IP**: the hostname and certificate depend on it. In the firewall, open inbound **22** (your IP only if you can), **80** and **443**. **Don't open 8080.**
2. **Install Docker and the Compose plugin**: https://docs.docker.com/engine/install/
3. **Clone the repo**: `git clone <repo> /opt/calgy && cd /opt/calgy`
4. **Add the secrets**:
   ```sh
   sudo mkdir -p /etc/calgy
   sudo cp backend/.env.example /etc/calgy/api.env
   sudo chown root:root /etc/calgy/api.env
   sudo chmod 600 /etc/calgy/api.env
   base64 -w0 service-account.json   # → paste as CRED=…, then delete service-account.json
   ```
   Then edit `/etc/calgy/api.env`:
   ```
   NODE_ENV=production
   AUTH_MODE=bearer
   HOST=127.0.0.1
   PORT=8080
   APP_ORIGINS=https://<project>.vercel.app,http://localhost:3000
   CRED=<base64 of the service account JSON, one line>
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:<your email>
   AGGREGATE_MIN_CONTRIBUTORS=10
   DISABLE_JOBS=false
   ```
5. **VAPID keys, once**: run `npx web-push generate-vapid-keys` and put both keys in `api.env`. Back them up. **Never regenerate them**: that breaks every existing push subscription.
6. **Hostname**: in `deploy/Caddyfile`, replace `203-0-113-5` with your IP, using dashes for the dots. Check that `nslookup <ip-with-dashes>.sslip.io` returns the VM's IP.
7. **Start**: `cd deploy && docker compose up -d --build`
8. Run the checklist below.

Then point the web app at the API: on Vercel, set `NEXT_PUBLIC_API_MODE=http`, `NEXT_PUBLIC_API_URL=https://<ip-with-dashes>.sslip.io` and `NEXT_PUBLIC_AUTH_MODE=bearer`.

**Updates:** `cd /opt/calgy && git pull && cd deploy && docker compose up -d --build`

## Verification checklist

Replace `HOST` with `<ip-with-dashes>.sslip.io` and `APP` with `https://<project>.vercel.app`.

1. `curl -I https://HOST/health` → `200`, a valid certificate, and a `strict-transport-security` header.
2. `curl -I http://HOST/health` → a redirect to `https://`.
3. From another machine: `curl -m 5 http://<ip>:8080/health` → fails (the port isn't exposed).
4. CORS preflight:
   ```sh
   curl -i -X OPTIONS https://HOST/v1/me \
     -H "Origin: APP" \
     -H "Access-Control-Request-Method: GET" \
     -H "Access-Control-Request-Headers: authorization,x-calgy-client"
   ```
   → `access-control-allow-origin: APP`, and the allowed headers include `Authorization`. With `-H "Origin: https://evil.example"` → no `access-control-allow-origin` header.
5. `curl -i https://HOST/v1/me` → `401 {"code":"unauthenticated",…}`.
6. Open the deployed app: the first launch creates an anonymous user and its `users/{uid}` doc (check the Firestore console). Changes in Settings save. No CORS or mixed-content errors in Chrome or Safari.
7. Expired token: in DevTools, wait more than an hour or revoke the user's tokens. The next call gets a 401, and the client refreshes the token and retries successfully.
8. Push: Settings → Reminders → turn on, then send a test notification.

## Logs and health

- Logs: `docker compose logs -f api`. These are pino JSON lines; pipe them through `npx pino-pretty` to read them. Look for `reminders run` every 15 minutes and `aggregates run` at 02:00 Lagos time.
- Add an uptime monitor on `https://HOST/health`.
- Caddy (certificates): `docker compose logs -f caddy`.

## Running locally

```sh
cp backend/.env.example backend/.env   # fill in CRED and the VAPID keys
npm run dev -w backend                 # http://127.0.0.1:4000
npm test -w backend                    # HTTP + logic tests (fakes, no emulator)
npm run test:emulator -w backend       # Firestore store tests (needs Java 21+)
```
To use it from the web app, set `NEXT_PUBLIC_API_MODE=http` and `NEXT_PUBLIC_API_URL=http://127.0.0.1:4000` in `frontend/.env.local`.

## Moving to a custom domain later

1. Add an A record `api.<domain>` → the VM's IP, and point the app's domain at Vercel.
2. Add an `api.<domain> { … }` block to the Caddyfile. Keep the sslip.io block for about a week so old clients keep working, then remove it. Restart Caddy.
3. Update `APP_ORIGINS`, the Firebase authorized domains and, in the app, `NEXT_PUBLIC_API_URL` and the email-link URL.
4. Optional: switch to cookie sessions with `AUTH_MODE=cookie` and `COOKIE_DOMAIN=.<domain>` here, plus `NEXT_PUBLIC_AUTH_MODE=cookie` in the app. Staying on bearer tokens is fine.

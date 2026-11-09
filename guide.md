# Veil production deployment: Vercel + Render

How to deploy Veil with the web app on **Vercel** and everything else on **Render**, at `https://chat.xivago.com`.

> **Status:** this guide was written from the project's code. It hasn't been run end to end yet, so check each step's result before moving on.

**Contents**

1. [What goes where](#1-what-goes-where)
2. [Before you start](#2-before-you-start)
3. [Render: database and Redis](#3-render-database-and-redis)
4. [Render: the five services](#4-render-the-five-services)
5. [Vercel: the web app](#5-vercel-the-web-app)
6. [Domains](#6-domains)
7. [Order to follow](#7-order-to-follow)
8. [Check that it works](#8-check-that-it-works)
9. [Things to know](#9-things-to-know)
10. [Environment variables at a glance](#10-environment-variables-at-a-glance)

---

## 1. What goes where

| Part | Host | Render type | Address |
|---|---|---|---|
| Web app (`apps/web`, Next.js) | **Vercel** | | `https://chat.xivago.com` |
| `chat-ws`: live chat socket | **Render** | Web Service | `https://veil-chat-ws.onrender.com` |
| `call-signaling`: call setup | **Render** | Web Service | `https://chat-calls.xivago.com` |
| `media-worker`: upload and download links | **Render** | Web Service | `https://veil-media.onrender.com` |
| `link-scraper`: link previews and GIFs | **Render** | Web Service | `https://veil-links.onrender.com` |
| `push-service`: notifications | **Render** | Background Worker | none, it has no port |
| PostgreSQL 16 | **Render** | Postgres | |
| Redis | **Render** | Key Value | |
| Photos, files, voice notes | **Cloudflare R2** | | bucket `secure-chat` |

```
Phone or browser
   |-- https://chat.xivago.com ............ Vercel (web app, sign-in, API)
   |       |-- /svc/media -> media-worker (Render)
   |       |-- /svc/link  -> link-scraper (Render)
   |       |-- /svc/calls -> call-signaling (Render)
   |-- chat socket ......................... chat-ws (Render)
   |-- call socket ......................... call-signaling (Render, chat-calls.xivago.com)
   |-- file upload and download ............ Cloudflare R2 (directly)

Render private network: Postgres, Key Value (Redis), push-service
```

**Why the services aren't on Vercel:** they hold long-lived connections (WebSockets) and run background jobs, which Vercel functions can't do.

**Regions:** put **all Render resources in one region**, and set Vercel's function region next to it. For example, use Render **Singapore** with Vercel **sin1**.

---

## 2. Before you start

1. **Push the project to GitHub.** Vercel and Render both deploy from a GitHub repository. Make sure `.env` is **not** committed.
2. **Fix SMS sign-in.** The local web log shows `Twilio Verify error 403`. In production, sign-in codes are never written to the log, so phone sign-in won't work until Twilio does. Check the Account SID, Auth Token and Verify Service SID, and that your Twilio account may send to your users' countries.
3. **Set up real email.** Use `EMAIL_PROVIDER=smtp` or `resend`, with a sender address your provider has verified.
4. **Create production secrets.** On your PC, run this from the project root in Git Bash:
   ```bash
   export PATH="/c/Users/lenovo/AppData/Local/nvm/v22.23.4:$PATH"
   pnpm --silent secrets
   ```
   It prints `BETTER_AUTH_SECRET`, `SEALED_SENDER_PRIVATE_KEY`, `NEXT_PUBLIC_SEALED_SENDER_TRUST_ROOT`, `DISCOVERY_OPRF_KEY`, `SENDER_TAG_PEPPER`, `MEDIA_URL_SECRET` and `LINK_PROXY_SECRET`. Keep them private. Wherever a name appears more than once below, it must have **exactly the same value** each time.
5. **Create push keys:** if you don't already have a VAPID pair, generate one:
   ```bash
   (cd mini-services/push-service && node -e "const k=require('web-push').generateVAPIDKeys();console.log(k)")
   ```
6. **Rotate the TURN token.** The Cloudflare TURN API token was shared in a chat, so roll it in the Cloudflare dashboard and use the new token below.
7. **Allow the site in your R2 bucket.** Browsers upload straight to R2. In Cloudflare go to **R2 → secure-chat → Settings → CORS policy** and add:
   ```json
   [
     {
       "AllowedOrigins": ["https://chat.xivago.com"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

---

## 3. Render: database and Redis

### 3.1 PostgreSQL

1. In Render, choose **New → Postgres**.
2. Name it `veil-db`, choose **PostgreSQL 16** and your region.
3. When it's ready, copy both connection strings:
   - **Internal Database URL:** used by the Render services.
   - **External Database URL:** used by Vercel and for running migrations. Add `?sslmode=require` to the end.

### 3.2 Redis (Key Value)

1. Choose **New → Key Value**, name it `veil-redis`, and pick the same region.
2. Under **Access Control**, allow external connections from `0.0.0.0/0`. Vercel has no fixed IP addresses. The password and TLS still protect it.
3. Copy:
   - the **Internal URL** (`redis://...`), for the Render services
   - the **External URL** (`rediss://...`, with two s's), for Vercel

### 3.3 Create the tables

Run this from your PC, in Git Bash at the project root:

```bash
export PATH="/c/Users/lenovo/AppData/Local/nvm/v22.23.4:$PATH"
export DATABASE_URL="<External Database URL>?sslmode=require"
pnpm db:migrate
pnpm db:seed
```

Run `pnpm db:migrate` again whenever an update adds a migration.

---

## 4. Render: the five services

Create four **Web Services** and one **Background Worker** (push-service). Connect each one to your GitHub repo.

### 4.1 Settings for every service

| Setting | Value |
|---|---|
| Root Directory | *(leave empty: the repo root)* |
| Runtime | Node |
| Build Command | `corepack enable && pnpm install --frozen-lockfile --prod=false` |
| Instance type | **Starter or higher** for `chat-ws` and `call-signaling` |

- **Why `--prod=false`:** the services start with `tsx`, a dev dependency. With `NODE_ENV=production`, pnpm would otherwise skip installing it.
- **Why not the free plan:** free instances sleep after 15 minutes. That drops everyone's live chat and call connections. Background Workers have no free plan.
- **No `PORT` needed:** Render sets `PORT` itself and every service reads it, so don't add it.

### 4.2 Start commands

| Render name | Type | Start Command | Health Check Path |
|---|---|---|---|
| `veil-chat-ws` | Web Service | `pnpm --filter @veil/chat-ws start` | `/health` |
| `veil-calls` | Web Service | `pnpm --filter @veil/call-signaling start` | `/health` |
| `veil-media` | Web Service | `pnpm --filter @veil/media-worker start` | `/health` |
| `veil-links` | Web Service | `pnpm --filter @veil/link-scraper start` | `/health` |
| `veil-push` | Background Worker | `pnpm --filter @veil/push-service start` | none |

### 4.3 Environment variables on every Render service

| Variable | Value |
|---|---|
| `NODE_VERSION` | `22.19.0` |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Postgres **Internal** URL |
| `CORS_ORIGINS` | `https://chat.xivago.com,capacitor://localhost,https://localhost` |

`push-service` makes no browser requests, so it doesn't need `CORS_ORIGINS`, but adding it does no harm.

### 4.4 Extra variables per service

**chat-ws**

| Variable | Value |
|---|---|
| `REDIS_URL` | Key Value **Internal** URL |
| `SENDER_TAG_PEPPER` | generated secret, **same as on Vercel** |

**call-signaling**

| Variable | Value |
|---|---|
| `REDIS_URL` | Key Value **Internal** URL |
| `CALL_PROVIDER` | `p2p` |
| `CF_TURN_KEY_ID` | `6ae73daf37ebebfdba26e19cb9f5bfde` |
| `CF_TURN_API_TOKEN` | the **new** token from step 2 |

Leave `TURN_SECRET` and `TURN_URLS` empty. They're only for a self-hosted coturn server.

**media-worker**

| Variable | Value |
|---|---|
| `STORAGE_DRIVER` | `r2` |
| `R2_ACCOUNT_ID` | `153ace01f6a85dea92a1afba3f90b101` |
| `R2_ACCESS_KEY_ID` | your R2 access key |
| `R2_SECRET_ACCESS_KEY` | your R2 secret key |
| `R2_BUCKET` | `secure-chat` |
| `MEDIA_URL_SECRET` | generated secret |
| `MEDIA_PUBLIC_URL` | `https://pub-d2691bf057694152b33e7d10c2b0f5c3.r2.dev` |

**link-scraper**

| Variable | Value |
|---|---|
| `LINK_PROXY_SECRET` | generated secret |
| `MAP_TILE_URL` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` |
| `GIPHY_API_KEY` and/or `TENOR_API_KEY` | optional, for GIF search |

**push-service**

| Variable | Value |
|---|---|
| `REDIS_URL` | Key Value **Internal** URL |
| `VAPID_PUBLIC_KEY` | your VAPID public key |
| `VAPID_PRIVATE_KEY` | your VAPID private key |
| `VAPID_SUBJECT` | `https://chat.xivago.com` |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | the whole Firebase service-account JSON. Only needed for the Android app |
| `APNS_KEY_P8` | the contents of your `.p8` key. Only needed for the iOS app |
| `APNS_KEY_ID`, `APNS_TEAM_ID` | from your Apple Developer account. iOS app only |
| `APNS_BUNDLE_ID` | `app.veil.messenger` |
| `APNS_PRODUCTION` | `true` |

Use `FIREBASE_SERVICE_ACCOUNT_JSON` and `APNS_KEY_P8` rather than the `_FILE` versions, because Render services have no secrets folder.

> **Same Redis everywhere:** the web app, `chat-ws`, `call-signaling` and `push-service` pass messages and call events to each other through Redis, so they must all use the **same** Key Value instance.

### 4.5 Deploy

Deploy all five and wait until they show **Live**. Then open each web service's `/health` address, for example `https://veil-chat-ws.onrender.com/health`. Each should return `{"ok":true}`.

Write down the four `onrender.com` addresses, because Vercel needs them in the next step.

---

## 5. Vercel: the web app

### 5.1 Create the project

1. In Vercel, choose **Add New → Project** and import the same GitHub repo.
2. Set **Root Directory** to `apps/web`. Vercel detects the pnpm workspace and installs from the repo root by itself.
3. **Framework Preset:** Next.js. Keep the default Build Command (`next build`) and Output settings.
4. In **Settings → Functions → Function Region**, pick the region next to Render, for example `sin1` for Singapore.

### 5.2 Environment variables (Production)

**App and origins**

| Variable | Value |
|---|---|
| `APP_URL` | `https://chat.xivago.com` |
| `NEXT_PUBLIC_APP_URL` | `https://chat.xivago.com` |
| `TRUSTED_ORIGINS` | `https://chat.xivago.com,capacitor://localhost,https://localhost` |

**Database and Redis**

| Variable | Value |
|---|---|
| `DATABASE_URL` | Postgres **External** URL + `?sslmode=require` |
| `DATABASE_POOL_SIZE` | `2` (every Vercel function opens its own connections) |
| `REDIS_URL` | Key Value **External** URL (`rediss://...`) |

**Secrets**

| Variable | Value |
|---|---|
| `BETTER_AUTH_SECRET` | generated |
| `SEALED_SENDER_PRIVATE_KEY` | generated |
| `NEXT_PUBLIC_SEALED_SENDER_TRUST_ROOT` | generated. It's a pair with the line above, so keep them together |
| `DISCOVERY_OPRF_KEY` | generated |
| `SENDER_TAG_PEPPER` | generated, **same as chat-ws** |

**Service addresses**

| Variable | Value | Used for |
|---|---|---|
| `PUBLIC_CHAT_WS_URL` | `https://veil-chat-ws.onrender.com` | phones connect here for chat |
| `PUBLIC_CALL_WS_URL` | `https://chat-calls.xivago.com` | phones connect here for calls |
| `MEDIA_WORKER_URL` | `https://veil-media.onrender.com` | behind `/svc/media` |
| `LINK_SCRAPER_URL` | `https://veil-links.onrender.com` | behind `/svc/link` |
| `CALL_SIGNALING_URL` | `https://veil-calls.onrender.com` | behind `/svc/calls` |
| `MEDIA_PUBLIC_ORIGIN` | `https://153ace01f6a85dea92a1afba3f90b101.r2.cloudflarestorage.com` | lets the browser talk to R2 |

Until the `chat-calls.xivago.com` domain from section 6 is working, use `https://veil-calls.onrender.com` for `PUBLIC_CALL_WS_URL`.

**Sign-in**

| Variable | Value |
|---|---|
| `SMS_PROVIDER` | `twilio-verify` |
| `TWILIO_ACCOUNT_SID` | your Twilio value |
| `TWILIO_AUTH_TOKEN` | your Twilio value |
| `TWILIO_VERIFY_SERVICE_SID` | your Twilio value |
| `EMAIL_PROVIDER` | `smtp` or `resend` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` | if you use SMTP |
| `RESEND_API_KEY` | if you use Resend |
| `EMAIL_FROM` | `Veil <no-reply@xivago.com>` (a verified sender) |
| `GOOGLE_CLIENT_ID` | from Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | from Google Cloud Console |
| `OTP_SENDS_PER_HOUR` | `5` |
| `OTP_VERIFIES_PER_5MIN` | `10` |

**Push and extras**

| Variable | Value |
|---|---|
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | same as `VAPID_PUBLIC_KEY` on push-service |
| `GIPHY_API_KEY` / `TENOR_API_KEY` | optional; these only switch the GIF button on |
| `LIVEKIT_URL` | only if you change `CALL_PROVIDER` to `livekit` |

**Don't add these on Vercel:** `DEV_EXPOSE_OTP`, `WEB_PORT`, `MEDIA_WORKER_PORT`, `STORAGE_DRIVER`, or any `R2_*` key.

Variables starting with `NEXT_PUBLIC_` are built into the app, so **redeploy** after changing one.

### 5.3 Deploy

Click **Deploy**. When it finishes, open the `*.vercel.app` address Vercel gives you to check that the page loads. Signing in only works on `chat.xivago.com`, so finish section 6 first.

---

## 6. Domains

All of these are done in **Cloudflare → xivago.com → DNS**.

1. **Take these names off the tunnel.** Delete the existing tunnel records for `chat.xivago.com` and `chat-calls.xivago.com`. Remove those hostnames from `C:\Users\lenovo\.cloudflared\xivago-chat.yml` too. Your other tunnels aren't affected.
2. **`chat.xivago.com` → Vercel:**
   - In Vercel, go to **Settings → Domains** and add `chat.xivago.com`.
   - In Cloudflare, add the record Vercel shows, usually `CNAME chat → cname.vercel-dns.com`.
   - Set the record to **DNS only** (grey cloud).
3. **`chat-calls.xivago.com` → Render call-signaling:**
   - In the `veil-calls` service, go to **Settings → Custom Domains** and add `chat-calls.xivago.com`.
   - In Cloudflare, add `CNAME chat-calls → veil-calls.onrender.com` and set it to **DNS only**.
   - When Render shows the certificate as issued, set `PUBLIC_CALL_WS_URL=https://chat-calls.xivago.com` on Vercel and redeploy.
4. **Optional:** you can give chat-ws its own name, such as `chat-ws.xivago.com`, the same way. If you do, update `PUBLIC_CHAT_WS_URL` on Vercel and redeploy.
5. **Google sign-in** needs no change, because the domain stays the same. Keep these in Google Cloud Console:
   - Authorized JavaScript origin: `https://chat.xivago.com`
   - Authorized redirect URI: `https://chat.xivago.com/api/auth/callback/google`
6. **Cloudflare cache:** go to **Caching → Configuration → Browser Cache TTL** and set it to **Respect Existing Headers**. Otherwise Cloudflare can tell phones to keep old app code for hours.

---

## 7. Order to follow

1. Section 2: GitHub, Twilio, email, secrets, R2 CORS.
2. Section 3: Postgres and Key Value, then the migrations.
3. Section 4: the five Render services. Note their `onrender.com` addresses.
4. Section 5: the Vercel project with those addresses.
5. Section 6: domains. Wait until Vercel and Render both show the HTTPS certificate as issued.
6. Section 8: checks.
7. Stop Veil and the chat tunnel on your PC, so two copies don't share the domain.

---

## 8. Check that it works

Run these in Git Bash. Each should return the result shown:

```bash
curl -s https://chat.xivago.com/api/health
# {"ok":true,"db":"fulfilled","redis":"fulfilled"}

curl -s https://chat.xivago.com/api/config
# JSON with "chatWsUrl":"https://veil-chat-ws.onrender.com" and your call address

curl -s "https://veil-chat-ws.onrender.com/socket.io/?EIO=4&transport=polling"
# 0{"sid":...

curl -s "https://chat-calls.xivago.com/socket.io/?EIO=4&transport=polling"
# 0{"sid":...

curl -s -o /dev/null -w '%{http_code}\n' "https://chat.xivago.com/api/dev/otp?to=x@example.com"
# must be 404. Anything else means sign-in codes may be exposed.
```

Then test with two phones:

- [ ] Sign-in by SMS, by email and with Google.
- [ ] Messages arrive in both directions.
- [ ] A photo and a voice note send and open on the other phone.
- [ ] A link shows a preview.
- [ ] A call connects on **mobile data**, not just Wi-Fi.
- [ ] With the phone locked, a new message shows **Veil: New message**.

### If something fails

| Problem | Likely cause | Fix |
|---|---|---|
| `/api/health` shows `db` or `redis` as rejected | Wrong external URL, or Redis external access is off | Check `DATABASE_URL` ends in `?sslmode=require`, the Redis URL starts with `rediss://`, and Key Value allows `0.0.0.0/0` |
| Chat never connects | `PUBLIC_CHAT_WS_URL` is wrong, or the domain is missing from `CORS_ORIGINS` on chat-ws | Fix the variable, then redeploy both |
| Photos fail to upload | R2 CORS is missing `https://chat.xivago.com` | Section 2, step 7 |
| Calls fail on mobile data | TURN token is wrong or old | Check `CF_TURN_*` on call-signaling, and look for `[ice]` lines in its Render logs |
| Sign-in code never arrives | Twilio or email misconfigured | Look at the Vercel function logs for the provider's error |
| A Render build fails with `tsx: not found` | Missing `--prod=false` in the Build Command | Section 4.1 |
| Chat works, then stops after a while | The service is on a free instance and went to sleep | Use a Starter instance or higher |
| Phones show an old version after a deploy | Cloudflare browser cache | Section 6, step 6 |

---

## 9. Things to know

- **Dev-only settings:** the cache changes in `apps/web/next.config.ts` (`deploymentId` and `Cache-Control: no-store`) only apply in development, so they're off on Vercel.
- **Media files** go straight between phones and R2 with `STORAGE_DRIVER=r2`. The `/blob/` tunnel route from the PC setup isn't used anymore.
- **Existing data:** the production database starts empty. Accounts and chats from your PC don't move over, and messages live on users' own devices anyway.
- **Changing secrets** later signs everyone out and can break encrypted features, so set them once and keep them safe.
- **Native apps:** the iOS and Android apps have to be rebuilt with `NEXT_PUBLIC_APP_URL=https://chat.xivago.com` and `NEXT_PUBLIC_API_URL=https://chat.xivago.com`. See the **Mobile** section of `README.md`.
- **Updates:** pushing to GitHub redeploys Vercel and Render automatically. If the update includes a database change, run `pnpm db:migrate` as in section 3.3.

---

## 10. Environment variables at a glance

✔ = set it there. **(same)** = must be the same value everywhere it's set.

| Variable | Vercel | chat-ws | call-signaling | media-worker | link-scraper | push-service |
|---|---|---|---|---|---|---|
| `NODE_VERSION`, `NODE_ENV` | | ✔ | ✔ | ✔ | ✔ | ✔ |
| `DATABASE_URL` | ✔ external | ✔ internal | ✔ internal | ✔ internal | ✔ internal | ✔ internal |
| `DATABASE_POOL_SIZE` | ✔ `2` | | | | | |
| `REDIS_URL` **(same instance)** | ✔ external | ✔ internal | ✔ internal | | | ✔ internal |
| `CORS_ORIGINS` | | ✔ | ✔ | ✔ | ✔ | |
| `APP_URL`, `NEXT_PUBLIC_APP_URL`, `TRUSTED_ORIGINS` | ✔ | | | | | |
| `BETTER_AUTH_SECRET` | ✔ | | | | | |
| `SEALED_SENDER_PRIVATE_KEY`, `NEXT_PUBLIC_SEALED_SENDER_TRUST_ROOT` | ✔ | | | | | |
| `DISCOVERY_OPRF_KEY` | ✔ | | | | | |
| `SENDER_TAG_PEPPER` **(same)** | ✔ | ✔ | | | | |
| `MEDIA_URL_SECRET` | | | | ✔ | | |
| `LINK_PROXY_SECRET` | | | | | ✔ | |
| `PUBLIC_CHAT_WS_URL`, `PUBLIC_CALL_WS_URL` | ✔ | | | | | |
| `MEDIA_WORKER_URL`, `LINK_SCRAPER_URL`, `CALL_SIGNALING_URL` | ✔ | | | | | |
| `MEDIA_PUBLIC_ORIGIN` | ✔ | | | | | |
| `STORAGE_DRIVER`, `R2_*`, `MEDIA_PUBLIC_URL` | | | | ✔ | | |
| `CALL_PROVIDER`, `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` | | | ✔ | | | |
| `SMS_PROVIDER`, `TWILIO_*` | ✔ | | | | | |
| `EMAIL_PROVIDER`, `EMAIL_FROM`, `SMTP_*` / `RESEND_API_KEY` | ✔ | | | | | |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | ✔ | | | | | |
| `OTP_SENDS_PER_HOUR`, `OTP_VERIFIES_PER_5MIN` | ✔ | | | | | |
| `GIPHY_API_KEY`, `TENOR_API_KEY` **(same)** | ✔ | | | | ✔ | |
| `MAP_TILE_URL` | | | | | ✔ | |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` **(same as `VAPID_PUBLIC_KEY`)** | ✔ | | | | | |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | | | | | | ✔ |
| `FIREBASE_SERVICE_ACCOUNT_JSON`, `APNS_*` | | | | | | ✔ |

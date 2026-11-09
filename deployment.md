# Veil deployment guide

How to deploy Veil on a Windows PC and publish it at `https://chat.xivago.com` through a Cloudflare Tunnel.

> **Current status:** this is a test deployment. It runs the Next.js dev server on one PC, with no real SMS or email. It's fine for your own phones, but not for real users. See [Going to production](#going-to-production).

**Contents**

1. [How it fits together](#1-how-it-fits-together)
2. [Requirements](#2-requirements)
3. [First-time setup](#3-first-time-setup)
4. [Publish with Cloudflare Tunnel](#4-publish-with-cloudflare-tunnel)
5. [Daily start and stop](#5-daily-start-and-stop)
6. [Turn on notifications on phones](#6-turn-on-notifications-on-phones)
7. [Check that it works](#7-check-that-it-works)
8. [Troubleshooting](#8-troubleshooting)
9. [Backups](#9-backups)
10. [Security notes](#10-security-notes)
11. [Going to production](#going-to-production)

---

## 1. How it fits together

```
Phone or browser
      |  HTTPS
Cloudflare  (chat.xivago.com, chat-calls.xivago.com)
      |  tunnel: xivago-chat
This PC
  |-- /socket.io on chat.xivago.com        -> chat-ws         :4001
  |-- /blob/ on chat.xivago.com            -> media-worker    :4012
  |-- everything else on chat.xivago.com   -> web (Next.js)   :3010
  |-- /socket.io on chat-calls.xivago.com  -> call-signaling  :4005
  |
  |-- link-scraper :4003   reached through the web app at /svc/link
  |-- push-service         sends notifications, has no port
  |-- PostgreSQL   :5432   localhost only
  |-- Redis        :6379   localhost only
```

Calls need their own hostname because chat and calls both use the path `/socket.io`.

### Ports

| Port | Used by | Notes |
|---|---|---|
| 3010 | Veil web app | **Not 3000:** `xivago.com` and `app.xivago.com` point to 3000 |
| 4012 | Veil media-worker | **Not 4002:** `conferio.xivago.com` points to 4002 |
| 4001, 4003, 4005 | Veil chat, link previews, calls | |
| 5432, 6379 | PostgreSQL, Redis | Localhost only |
| 3000, 3001, 4002 | **Keep free** | Reserved for your other tunnels |

> **Warning:** a tunnel sends traffic to whatever is listening on its port. If Veil uses a port from another tunnel, that app's public address will serve Veil. This has already happened once. Check `C:\Users\lenovo\.cloudflared\*.yml` before changing a port.

---

## 2. Requirements

| Tool | Version | Notes |
|---|---|---|
| Windows | 10 or newer | No admin rights needed, except possibly for the scheduled task |
| Node.js | **22.19 or newer** | `link-scraper` crashes on Node 20. Install with `nvm install 22` |
| pnpm | 10.28 | |
| Git Bash | Any | Needed for `scripts/dev-all.sh` |
| cloudflared | Any recent version | Must already be logged in to the `xivago.com` zone |
| Google Chrome | Any | Only needed for browser testing |

The commands below use Node `v22.23.4`, the version installed on this PC. Your default Node can stay on 20, because the start commands select 22 for Veil only.

---

## 3. First-time setup

Skip this section on the current PC, because it's already done. Run the commands from the project root unless a step says otherwise.

### 3.1 Install dependencies

```bash
pnpm install --frozen-lockfile
```

### 3.2 Get PostgreSQL and Redis

Docker works if you have it: `docker compose up -d postgres redis`. Without Docker or admin rights, use portable copies in `.data/tools`, which git ignores.

> **Trust note:** both are community builds, not official releases. Postgres comes from the npm package `@embedded-postgres/windows-x64`, and Redis from the GitHub project `redis-windows/redis-windows`. Verify the checksums, and use official installers if you prefer.

**Git Bash:**

```bash
mkdir -p .data/tools/dl .data/tools/pg16 .data/tools/redis .data/redis .logs
cd .data/tools/dl

curl -sSL -o pg.tgz "https://registry.npmjs.org/@embedded-postgres/windows-x64/-/windows-x64-16.15.0-beta.19.tgz"
tar -xzf pg.tgz -C ../pg16 --strip-components=1

curl -sSL -o redis.zip "https://github.com/redis-windows/redis-windows/releases/download/8.10.3/Redis-8.10.3-Windows-x64-msys2.zip"
powershell.exe -NoProfile -Command "Expand-Archive -Force redis.zip ..\\redis"

cd ../../..
```

Before unpacking, compare `pg.tgz` with the `shasum` listed by the npm registry, and `redis.zip` with the digest on the GitHub release.

### 3.3 Create the database

**Git Bash:**

```bash
PGBIN="$PWD/.data/tools/pg16/native/bin"
printf 'veil' > .data/pwfile
"$PGBIN/initdb.exe" -D .data/pg -U veil --pwfile=.data/pwfile --auth=scram-sha-256 -E UTF8 --locale=C
rm -f .data/pwfile
"$PGBIN/pg_ctl.exe" -D .data/pg -l .logs/postgres.log -o "-c listen_addresses=localhost -p 5432" -w start

node -e "const p=require('postgres');(async()=>{const s=p('postgres://veil:veil@localhost:5432/postgres');await s.unsafe('create database veil');await s.end();console.log('created')})()"
```

The password `veil` is only acceptable because the database listens on localhost. Change it for anything else.

### 3.4 Create `.env`

Don't copy `.env.example` as it is. Some of its values contain `<` without quotes, which breaks `scripts/dev-all.sh`. Create `.env` with this content, keeping the quotes:

```bash
DATABASE_URL="postgres://veil:veil@localhost:5432/veil"
REDIS_URL="redis://localhost:6379"
APP_URL="https://chat.xivago.com"
NEXT_PUBLIC_APP_URL="https://chat.xivago.com"
TRUSTED_ORIGINS="https://chat.xivago.com,http://localhost:3010,capacitor://localhost,https://localhost"
CORS_ORIGINS="https://chat.xivago.com,http://localhost:3010,capacitor://localhost,https://localhost"

WEB_PORT="3010"
MEDIA_WORKER_PORT="4012"
PUBLIC_CHAT_WS_URL="https://chat.xivago.com"
PUBLIC_CALL_WS_URL="https://chat-calls.xivago.com"
MEDIA_WORKER_URL="http://localhost:4012"
LINK_SCRAPER_URL="http://localhost:4003"
CALL_SIGNALING_URL="http://localhost:4005"
MEDIA_PUBLIC_URL="https://chat.xivago.com"
MEDIA_PUBLIC_ORIGIN="https://chat.xivago.com"
STORAGE_DRIVER="local"

SMS_PROVIDER="console"
EMAIL_PROVIDER="console"
OTP_SENDS_PER_HOUR="50"
VAPID_SUBJECT="https://chat.xivago.com"
```

`OTP_SENDS_PER_HOUR` is per network. The default is 5, so 50 is a testing value. Lower it when you finish testing.

**Don't add `DEV_EXPOSE_OTP`** on a public deployment. It lets anyone read sign-in codes from a web address.

### 3.5 Generate secrets

**Git Bash.** Add a line break to the end of `.env` first, so the new lines don't join the last setting:

```bash
export PATH="/c/Users/lenovo/AppData/Local/nvm/v22.23.4:$PATH"
[ -n "$(tail -c1 .env)" ] && echo >> .env

pnpm --silent secrets >> .env

(cd mini-services/push-service && node -e "
const k=require('web-push').generateVAPIDKeys();
require('fs').appendFileSync('../../.env','VAPID_PUBLIC_KEY=\"'+k.publicKey+'\"\nVAPID_PRIVATE_KEY=\"'+k.privateKey+'\"\nNEXT_PUBLIC_VAPID_PUBLIC_KEY=\"'+k.publicKey+'\"\n')")
```

Use `--silent`, because otherwise pnpm writes its banner into `.env`.

Then check that no secret starts with `/`, because Git Bash rewrites those values into Windows paths:

```bash
grep -E '^[A-Z_]+="?/' .env | cut -d= -f1
```

If it prints a name, generate a new value for it. `SEALED_SENDER_PRIVATE_KEY` and `NEXT_PUBLIC_SEALED_SENDER_TRUST_ROOT` are a pair, so replace them together.

> **Keep `.env` safe.** Don't commit or share it. Changing the secrets later can break existing sessions and encrypted features.

### 3.6 Create the tables

**Git Bash:**

```bash
export PATH="/c/Users/lenovo/AppData/Local/nvm/v22.23.4:$PATH"
set -a; . ./.env; set +a
pnpm db:migrate
pnpm db:seed
```

Now follow [Daily start and stop](#5-daily-start-and-stop) to start everything.

---

## 4. Publish with Cloudflare Tunnel

This is already set up for `xivago-chat`, except for the scheduled task in step 4. Run these steps in PowerShell on a new PC.

### Step 1: create the tunnel

```powershell
cloudflared tunnel create xivago-chat
```

This writes a credentials file to `C:\Users\lenovo\.cloudflared\`, named after the tunnel ID. Keep it secret.

### Step 2: create `C:\Users\lenovo\.cloudflared\xivago-chat.yml`

Replace `<TUNNEL-ID>` with your ID. The order matters, because the first matching rule wins.

```yaml
tunnel: <TUNNEL-ID>
credentials-file: C:\Users\lenovo\.cloudflared\<TUNNEL-ID>.json

ingress:
  - hostname: chat.xivago.com
    path: ^/socket\.io
    service: http://localhost:4001
  - hostname: chat.xivago.com
    path: ^/blob/
    service: http://localhost:4012
  - hostname: chat.xivago.com
    service: http://localhost:3010
  - hostname: chat-calls.xivago.com
    path: ^/socket\.io
    service: http://localhost:4005
  - service: http_status:404
```

Validate it:

```powershell
cloudflared tunnel --config "C:\Users\lenovo\.cloudflared\xivago-chat.yml" ingress validate
```

### Step 3: add the DNS records

```powershell
cloudflared tunnel route dns xivago-chat chat.xivago.com
cloudflared tunnel route dns xivago-chat chat-calls.xivago.com
```

Check public DNS, not just your router:

```powershell
Resolve-DnsName chat.xivago.com -Server 1.1.1.1 -DnsOnly
```

### Step 4: start the tunnel

**Option A, for testing.** Run this in a window and keep it open:

```powershell
& "C:\Program Files (x86)\cloudflared\cloudflared.exe" tunnel --config "C:\Users\lenovo\.cloudflared\xivago-chat.yml" --logfile "C:\Users\lenovo\.cloudflared\xivago-chat.log" run xivago-chat
```

**Option B, start at login like your other tunnels.** This option hasn't been run on this PC yet.

Create `C:\Users\lenovo\.cloudflared\run-xivago-chat.vbs`:

```vb
' Runs the chat.xivago.com Cloudflare tunnel with no console window.
' Waits for cloudflared to exit so Task Scheduler can restart it if it fails.
Set sh = CreateObject("WScript.Shell")
rc = sh.Run("""C:\Program Files (x86)\cloudflared\cloudflared.exe"" tunnel --config ""C:\Users\lenovo\.cloudflared\xivago-chat.yml"" --logfile ""C:\Users\lenovo\.cloudflared\xivago-chat.log"" run xivago-chat", 0, True)
WScript.Quit rc
```

Then register the task:

```powershell
$dir = "C:\Users\lenovo\.cloudflared"
$a = New-ScheduledTaskAction -Execute "C:\Windows\System32\wscript.exe" -Argument "//B //Nologo `"$dir\run-xivago-chat.vbs`"" -WorkingDirectory $dir
$t = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName "Cloudflared xivago-chat" -Action $a -Trigger $t -Settings $s
Start-ScheduledTask -TaskName "Cloudflared xivago-chat"
```

Stop any other copy of the tunnel first, so that only one is running.

### Check the tunnel

```powershell
cloudflared tunnel info xivago-chat
```

A table of connectors means it's connected. Cloudflare showing "healthy" only means the tunnel is up, not that Veil is running.

---

## 5. Daily start and stop

Nothing starts by itself after a reboot, except the tunnel if you set up the scheduled task. Start things in this order.

### Start

**1. PostgreSQL** (PowerShell, from the project root):

```powershell
.data\tools\pg16\native\bin\pg_ctl.exe -D .data\pg -l .logs\postgres.log -o "-c listen_addresses=localhost -p 5432" -w start
```

**2. Redis** (PowerShell, from the project root; it runs hidden in the background):

```powershell
$root = (Get-Location).Path
Start-Process -FilePath "$root\.data\tools\redis\Redis-8.10.3-Windows-x64-msys2\redis-server.exe" -ArgumentList '--bind','127.0.0.1','--port','6379' -WorkingDirectory "$root\.data\redis" -WindowStyle Hidden -RedirectStandardOutput "$root\.logs\redis.log" -RedirectStandardError "$root\.logs\redis.err.log"
```

**3. Veil** (Git Bash, from the project root):

```bash
export PATH="/c/Users/lenovo/AppData/Local/nvm/v22.23.4:$PATH"
./scripts/dev-all.sh
```

**4. Tunnel:** use [step 4](#step-4-start-the-tunnel) above, unless the scheduled task already started it.

The first page load after a start can take 30 seconds or more while the server compiles.

### Stop

`scripts/stop-all.sh` probably doesn't stop these services on Windows, so use this in PowerShell from the project root:

```powershell
# Veil only. Other Node apps keep running.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like '*secure-chat-main\secure-chat-main*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

# Redis and PostgreSQL
Stop-Process -Name redis-server
.data\tools\pg16\native\bin\pg_ctl.exe -D .data\pg stop

# The chat tunnel only. Your other tunnels keep running.
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -like '*run xivago-chat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
```

If you set up the scheduled task, use `Stop-ScheduledTask -TaskName "Cloudflared xivago-chat"` for the tunnel instead, so it doesn't restart.

### Restart after changing `.env`

Run the "Veil only" stop command, then step 3 of Start. Postgres, Redis and the tunnel can keep running.

### Update after a code change

**Git Bash:**

```bash
export PATH="/c/Users/lenovo/AppData/Local/nvm/v22.23.4:$PATH"
pnpm install --frozen-lockfile
set -a; . ./.env; set +a
pnpm db:migrate
```

Then restart Veil. The web app picks up most code changes by itself, but the five services in `mini-services/` need a restart.

### Getting a sign-in code

No real SMS or email is sent, so codes only appear in this PC's log and expire after 5 minutes. Run this in PowerShell from the project root:

```powershell
Select-String "OTP for" .logs\web.log | Select-Object -Last 1
```

---

## 6. Turn on notifications on phones

The lock screen shows only **Veil: New message** or **Veil: Incoming call**. Showing names is a separate setting, called **Show previews on lock screen**, and it's off by default.

### Android (Chrome)

1. Open `https://chat.xivago.com` in a normal Chrome tab. Incognito tabs and browsers inside other apps can't get notifications.
2. Go to **Settings → Notifications and Sounds**, turn on **Notifications on this device**, and tap **Allow**.

If it says blocked, tap the icon left of the address, then **Permissions → Notifications → Allow**. Also check **Android Settings → Apps → Chrome → Notifications**.

### iPhone (iOS 16.4 or newer)

1. Open `https://chat.xivago.com` in Safari, then tap **Share → Add to Home Screen**.
2. Open Veil **from that icon**. A normal Safari tab can't get notifications.
3. Go to **Settings → Notifications and Sounds**, turn on **Notifications on this device**, and tap **Allow**.

If it says blocked, go to **iPhone Settings → Notifications → Veil**. If Veil isn't listed, delete the icon and repeat these steps.

When notifications are blocked or unavailable, the screen shows a status line like `permission=denied app=installed ...`, which is useful for diagnosing the problem.

### Importing contacts

- **Android Chrome:** use the find button in the Contacts tab.
- **iPhone:** export your contacts as a `.vcf` file, then use the import button in the Contacts tab.
- **Invites:** these open your own SMS or email app with the message ready, and you press send.
- **Matching:** this only works by phone number, so people who signed up by email appear as invites.

---

## 7. Check that it works

**Git Bash.** Each of these should return the result shown:

```bash
curl -s https://chat.xivago.com/api/health
# {"ok":true,"db":"fulfilled","redis":"fulfilled"}

curl -s "https://chat.xivago.com/socket.io/?EIO=4&transport=polling"
# 0{"sid":...

curl -s "https://chat-calls.xivago.com/socket.io/?EIO=4&transport=polling"
# 0{"sid":...

curl -s -o /dev/null -w '%{http_code}\n' "https://chat.xivago.com/api/dev/otp?to=x@example.com"
# 404. Anything else means sign-in codes may be exposed.

curl -s -o /dev/null -w '%{http_code}\n' https://chat.xivago.com/blob/x
# 403
```

Then try these on a real phone:

- [ ] The welcome screen loads, and you can sign in with a code from the log.
- [ ] Messages arrive in both directions between two accounts.
- [ ] A photo sends and opens on the other phone.
- [ ] A call connects.
- [ ] With the phone locked, a new message shows **Veil: New message**.
- [ ] Importing contacts finds people on Veil and offers invites for others.

---

## 8. Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `DNS_PROBE_FINISHED_NXDOMAIN` | Your router or provider cached "not found" from before the record existed. It can last up to about an hour | Wait, or in Chrome turn on **Use secure DNS** with Cloudflare (1.1.1.1). First check public DNS with `Resolve-DnsName ... -Server 1.1.1.1 -DnsOnly` |
| Cloudflare 502 | The tunnel is up, but Veil isn't running on that port | Start Veil and check `.logs\web.log` |
| Cloudflare 530 or 1033 | The tunnel isn't running | Start the tunnel, then check with `cloudflared tunnel info xivago-chat` |
| Page reloads about once a second and never loads; browser or server shows `HMR hash mismatch` | Stale dev server cache | Run the "Veil only" stop command, delete `apps\web\.next`, then start Veil |
| Page stays blank for several seconds | The dev server is compiling | Wait, then reload after about 30 seconds |
| `/api/config` returns 500 with `invalid base64` | Git Bash rewrote a secret starting with `/` | Replace that secret. See [Generate secrets](#35-generate-secrets) |
| `link-scraper` crashes mentioning `zstd` or `undici` | It was started on Node 20 | Start Veil with the Node 22 `PATH` line shown above |
| Chat, media or calls fail on `localhost:3010` | The app connects through your public domain | Start the tunnel, or use the public address |
| "Too many requests" when signing in | The hourly code limit for that network was reached | Raise `OTP_SENDS_PER_HOUR` and restart, or wait for the hour to pass |
| Notifications say blocked | The phone is blocking this site specifically, even if notifications are on overall | Follow [section 6](#6-turn-on-notifications-on-phones) |
| Calls connect on Wi-Fi but fail on mobile data | No TURN server is set up | Configure `CF_TURN_KEY_ID` and `CF_TURN_API_TOKEN`, or `TURN_SECRET` and `TURN_URLS` |
| Another xivago site shows Veil, or a Veil-style response | Port conflict | Stop Veil and fix the ports. See [Ports](#ports) |
| `dev-all.sh` fails on `.env` | A value has `<` or spaces without quotes, or two settings joined on one line | Put quotes around values, one setting per line |

### Logs

| What | Where |
|---|---|
| Web app and sign-in codes | `.logs\web.log` |
| Services | `.logs\chat-ws.log`, `media-worker.log`, `link-scraper.log`, `call-signaling.log`, `push-service.log` |
| PostgreSQL, Redis | `.logs\postgres.log`, `.logs\redis.log` |
| Tunnel | `C:\Users\lenovo\.cloudflared\xivago-chat.log` |

`dev-all.sh` overwrites the service logs each time it starts Veil.

---

## 9. Backups

Stop Veil and PostgreSQL first, then copy these to a safe, private location:

| Path | Contains |
|---|---|
| `.env` | Secrets. Without them, restored data may not work properly |
| `.data\pg\` | The database |
| `mini-services\media-worker\.data\media\` | Encrypted photos, files and voice messages |
| `C:\Users\lenovo\.cloudflared\xivago-chat.yml` and the tunnel's `.json` file | Tunnel config and credentials |

Treat backups as sensitive, because they contain the secrets. Messages can't be read from them, but account data and group details can. Messages stay encrypted, and history depends on users' own devices and recovery keys, so a server backup doesn't replace those.

---

## 10. Security notes

**What's already in place**

- Messages, media and calls are end-to-end encrypted, and the database check found no plaintext.
- Lock-screen notifications show no names or message text by default.
- Address books stay on the device.
- PostgreSQL and Redis listen on localhost only, and `/api/dev/otp` is closed.

**Current risks**

- **Dev server on the internet:** `next dev` is slower and less hardened than a production build.
- **Open on your network:** the web app and services listen on all network interfaces, not just localhost, over plain HTTP. Only use trusted networks, or block ports 3010, 4001, 4003, 4005 and 4012 in Windows Firewall.
- **Sign-in codes in a log file:** anyone who can read `.logs\web.log` can sign in as any user whose code is there.
- **Weak local passwords:** the database password is `veil`, and Redis has no password. Both rely on being localhost only.
- **One PC:** if it sleeps, loses power or restarts, the site goes down.
- **Community builds:** the portable Postgres and Redis aren't official releases.
- **Cloudflare analytics:** the page contacted `static.cloudflareinsights.com`. Consider turning off Web Analytics for this hostname.

---

## Going to production

**None of this has been tested yet.** This is what's needed before real users can sign up.

### Required

- [ ] **Real server:** an always-on server with official PostgreSQL 16 and Redis 7, strong passwords and automatic backups.
- [ ] **Production build:** run `pnpm build` and `next start` with `NODE_ENV=production`. Console sign-in codes are refused in production, so the next item must be done first.
- [ ] **Real SMS and email:** set `SMS_PROVIDER` to Twilio or MSG91, and `EMAIL_PROVIDER` to `smtp` with its settings, in `.env`.
- [ ] **Sign-in limit:** set `OTP_SENDS_PER_HOUR` back to about 5.
- [ ] **TURN server:** needed for calls across mobile networks. Use Cloudflare TURN or coturn.
- [ ] **Media storage:** set `STORAGE_DRIVER="r2"` and the `R2_*` settings. Note that the `/blob/` tunnel route only applies to local storage.
- [ ] **Process management:** run every service under a supervisor so it restarts after crashes and reboots.
- [ ] **Firewall:** make sure only the tunnel can reach the services.

### Recommended

- [ ] Update `cloudflared`, because the installed version 2025.8.1 is outdated.
- [ ] Load test before relying on large groups, as the README says this hasn't been done.
- [ ] Test uploads over 8 MB, which split into parts. The bug in that path was fixed, but it hasn't been tested with a real large file.
- [ ] Test on real iPhones and Android phones, including when the phone sleeps with battery saver on.

### Native apps (optional)

The Android and iOS projects in `apps/mobile` have never been compiled. They need:

- Android Studio and a `google-services.json` file for Firebase push.
- Xcode on a Mac, an Apple Developer account and an APNs key.
- `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_APP_URL` set when building.
- `FIREBASE_SERVICE_ACCOUNT_FILE` and the `APNS_*` settings on the server.

See the **Mobile** section of `README.md` for the build commands.

### Files changed from the original project

| File | Change |
|---|---|
| `scripts/dev-all.sh` | Ports can be set with `WEB_PORT` and `MEDIA_WORKER_PORT` |
| `apps/web/next.config.ts` | Allows `chat.xivago.com` for the dev server. Change this if the domain changes |
| `mini-services/media-worker/src/storage.ts` | Fixed Windows paths and `.parts` keys |
| `mini-services/push-service/src/` | Private lock-screen text by default |
| `apps/web/public/sw.js` | Notification display, and "Missed call" after a hang-up |
| `packages/ui/src/lib/native.ts` | Notification permission flow and help text |
| `packages/ui/src/app.tsx` | Keeps message text off the lock screen |
| `packages/ui/src/screens/settings.tsx` | Notification and preview switches |
| `packages/ui/src/screens/contacts.tsx` | Contact import and invites |
| `packages/ui/src/engine/contacts.ts`, `contact-import.ts` | Contact import, invite links, `.vcf` parsing |

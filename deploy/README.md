# Host Triumvirate on Unraid

This puts the app at **https://triumvirate.snds-server.com**, running on your Unraid server.

How it fits together, in plain terms:

- **The app** runs as one Docker container on Unraid. Your sign-in, snapshots, chats, and caches are saved in
  `/mnt/user/appdata/triumvirate`, so they survive restarts and updates.
- **Cloudflare Tunnel** is a second small container (`cloudflared`) that connects *out* to Cloudflare.
  Nothing is opened on your router, and your home IP address stays hidden.
- **Cloudflare Access** sits in front of the address and asks for your email before anything loads. This
  matters: the app has no login of its own, so anyone who reached it could move your items and spend your
  Anthropic credits. The app also checks the Access sign-in itself and refuses to start without it.

You do steps 1 to 3 once in web dashboards, step 4 once on GitHub, and step 5 once on Unraid.
Each step says what to copy; keep those values in a note until step 5.

## 1. Make a second Bungie app

Bungie allows only one Redirect URL per app. Keep your current app for `localhost`, and make a new one for the
hosted copy.

1. Go to <https://www.bungie.net/en/Application> and choose **Create New App**.
2. Name it something like **triumvirate hosted**, then set:
   - **OAuth Client Type:** Confidential
   - **Redirect URL:** `https://triumvirate.snds-server.com/auth/callback`
   - **Scope:** the same first three boxes as before (Destiny 2 read, Destiny 1 vendor read, move or equip)
   - **Origin Header:** leave blank
3. Save, then copy the **API Key**, **OAuth client_id**, and **OAuth client_secret**.

## 2. Make the Cloudflare Tunnel

1. In the Cloudflare dashboard, open **Zero Trust** (left sidebar), then **Networks > Tunnels**.
2. **Create a tunnel**, choose **Cloudflared**, and name it `triumvirate`.
3. On the install screen, skip the install commands. Copy only the **token**: the long string after
   `--token` in any of the commands shown.
4. Click **Next** to **Public hostnames** (sometimes called **Routes**) and add one:
   - **Subdomain:** `triumvirate` · **Domain:** `snds-server.com`
   - **Service type:** `HTTP` · **URL:** `app:8080`
5. Save the tunnel.

`app:8080` means "the container named app, on port 8080". It works because both containers run in the same
stack on Unraid.

## 3. Lock it with Cloudflare Access

1. In **Zero Trust**, open **Access > Applications** and choose **Add an application > Self-hosted**.
2. **Application name:** Triumvirate · **Domain:** `triumvirate.snds-server.com` (subdomain `triumvirate`).
3. Add a policy: **Action:** Allow · **Include > Emails:** your email address.
4. Leave the login method as **One-time PIN** (Cloudflare emails you a code) unless you've set up another one.
5. Save. Then open the application again and copy its **Application Audience (AUD) Tag** (on the Overview or
   Basic information tab).
6. Find your **team domain** under **Settings > Custom Pages** (or **Settings > General**). It looks like
   `yourteam.cloudflareaccess.com`.
7. **Let the home screen icon through.** iPhone fetches the icon for *Add to Home Screen* without your
   sign-in, so Access must not block it (it's only the app's artwork). Add a second **Self-hosted**
   application named **Triumvirate icons** with these **Destinations** (subdomain `triumvirate`, domain
   `snds-server.com`), one per row:
   - path `icons/*`
   - path `apple-touch-icon*`
   - path `favicon.ico`

   Give it one policy: **Action:** Bypass · **Include > Everyone**. A more specific path wins over the
   main app, so everything else still asks for your email. The app itself only lets these icon files
   through without the sign-in.

## 4. Let Unraid download the app

Each time a change lands on `main`, GitHub builds a fresh copy of the app as a Docker image called
`ghcr.io/snds/triumvirate`. It's private like the repo, so Unraid needs a key to download it.

1. On GitHub, go to **Settings > Developer settings > Personal access tokens > Tokens (classic)**.
2. **Generate new token (classic)**, name it `unraid`, tick only **read:packages**, and generate. Copy it.
3. On Unraid, open the terminal (the `>_` icon top right) and run this, pasting the token when asked for a
   password:

   ```
   docker login ghcr.io -u snds
   ```

## 5. Start it on Unraid

1. In **Apps** (Community Applications), install **Docker Compose Manager**.
2. Go to **Docker**, scroll to **Compose**, choose **Add New Stack**, and name it `triumvirate`.
3. Click the stack's gear, **Edit Stack > Compose File**, and paste in
   [`docker-compose.yml`](../docker-compose.yml) from this repo. Save.
4. **Edit Stack > Env File**, paste in [`unraid.env.example`](unraid.env.example), and fill in the values
   from steps 1 to 3 (plus your Anthropic key and time zone). Save.
5. Click **Compose Up**.

Open <https://triumvirate.snds-server.com>. Cloudflare asks for your email first, then the app asks you to
sign in with Bungie. The first load downloads the item database, so give it a minute.

## Updating

After new changes are merged, wait for the **Docker image** check on GitHub to go green (about 3 minutes), then
on Unraid click the stack's **Update Stack** (or **Compose Pull**, then **Compose Up**).

## If something's off

- **"Sign in through Cloudflare Access"** or **"sign-in is missing or expired":** the Access app's domain,
  AUD tag, or team domain doesn't match. Re-copy them into the Env File and Compose Up again.
- **Bungie says the redirect URL doesn't match:** the hosted Bungie app's Redirect URL must be exactly
  `https://triumvirate.snds-server.com/auth/callback`, and the Env File must hold *that* app's keys.
- **Page doesn't load at all:** in Zero Trust > Networks > Tunnels, the tunnel should say **Healthy**. If not,
  check the `tunnel` container's log on Unraid; a wrong `TUNNEL_TOKEN` is the usual cause.
- **The app container keeps restarting:** open its log. A missing Bungie key or Access setting is named there.

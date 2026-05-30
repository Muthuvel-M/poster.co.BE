# Deploy poster.co.BE on Render

## Option A — Blueprint (recommended)

1. Push this repo to GitHub
2. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint**
3. Connect `poster.co.BE` repo — Render reads [`render.yaml`](render.yaml)
4. On first deploy, set these manually when prompted:
   - `ADMIN_EMAIL` — your admin login email
   - `ADMIN_PASSWORD` — strong password
   - `CORS_ORIGIN` — e.g. `https://your-app.vercel.app,http://localhost:5173`
   - `R2_*` — Cloudflare R2 credentials (required for image uploads in production)
5. Wait for deploy to finish

## Option B — Manual setup

1. **New → PostgreSQL** → name it `poster-co-db` → create
2. **New → Web Service** → connect GitHub repo
3. Settings:
   - **Language:** Docker
   - **Dockerfile path:** `./Dockerfile`
   - **Health check path:** `/health`
4. **Environment** → add variables:

| Variable | Source |
|----------|--------|
| `DATABASE_URL` | Copy **Internal Database URL** from Postgres service |
| `JWT_SECRET` | Generate a long random string |
| `ADMIN_EMAIL` | Your admin email |
| `ADMIN_PASSWORD` | Your admin password |
| `CORS_ORIGIN` | Your Vercel frontend URL(s), comma-separated |
| `NODE_ENV` | `production` |
| `R2_ACCOUNT_ID` | Cloudflare |
| `R2_ACCESS_KEY_ID` | Cloudflare |
| `R2_SECRET_ACCESS_KEY` | Cloudflare |
| `R2_BUCKET_NAME` | `poster-co` |
| `R2_PUBLIC_URL` | Public R2/CDN URL |

Render sets `PORT` automatically — no need to configure it.

5. **Create Web Service**

---

## After first deploy

### Seed categories (one-time)

Render Shell → your web service → **Shell**:

```bash
npm run db:seed
```

Or locally with the **External** Postgres URL from Render:

```bash
DATABASE_URL="postgresql://..." npm run db:seed
```

Migrations run automatically on each deploy via the Dockerfile `CMD`.

### Verify

```bash
curl https://YOUR-SERVICE.onrender.com/health
curl https://YOUR-SERVICE.onrender.com/api/categories
```

---

## Connect frontend (Vercel)

```
VITE_API_URL=https://YOUR-SERVICE.onrender.com
```

Redeploy `poster.co`, then open `/admin` → **Connect API**.

---

## Cloudflare R2 (production images)

Render disk is ephemeral — **use R2 for uploads**, not local `uploads/`.

1. Cloudflare → R2 → create bucket `poster-co`
2. Enable public access or custom domain (`cdn.poster.co`)
3. Create API token (Object Read & Write)
4. Set `R2_PUBLIC_URL` to the public bucket URL

---

## Render tips

| Topic | Note |
|-------|------|
| **Free web tier** | Spins down after ~15 min idle; first request may be slow |
| **Free Postgres** | Expires after 90 days — use **Basic** for production |
| **Region** | Default in `render.yaml` is `singapore` — change in blueprint if needed |
| **SSL** | Render provides HTTPS automatically |
| **Logs** | Dashboard → your service → **Logs** |

---

## Railway (alternative)

See [DEPLOY.md](DEPLOY.md) if you want Railway instead.

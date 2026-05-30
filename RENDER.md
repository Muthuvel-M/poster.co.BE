# Deploy poster.co.BE — 100% free (MongoDB Atlas + Render)

| Service | Platform | Cost |
|---------|----------|------|
| API | Render **Free** | $0 |
| Database | **MongoDB Atlas M0** | $0 (512 MB, no expiry) |
| Images | **Cloudflare R2** | $0 |
| Frontend | **Vercel** | $0 |

---

## Step 1 — MongoDB Atlas (free database)

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) → sign up (free, no card for M0)
2. **Build a Database** → choose **M0 FREE** → pick a region close to you
3. **Create** database user (username + password) — save the password
4. **Network Access** → **Add IP Address**:
   - For Render: **Allow Access from Anywhere** (`0.0.0.0/0`)
   - Or add your home IP for local dev only
5. **Database** → **Connect** → **Drivers** → copy connection string:

   ```
   mongodb+srv://myuser:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```

6. Edit the URL:
   - Replace `<password>` with your real password
   - Add database name before `?`: `...mongodb.net/poster_co?retryWrites=...`

   Final example:

   ```
   mongodb+srv://myuser:MyPass123@cluster0.abc123.mongodb.net/poster_co?retryWrites=true&w=majority
   ```

### Push schema + seed (from your Mac)

```bash
cd poster.co.BE

# Put Atlas URL in .env as DATABASE_URL, then:
npx prisma db push
npm run db:seed
```

You should see `Seeded 8 categories`.

---

## Step 2 — Cloudflare R2 (free images)

1. [Cloudflare Dashboard](https://dash.cloudflare.com) → **R2** → create bucket `poster-co`
2. Enable **public access** / R2.dev URL
3. Create **R2 API token** (Read & Write)
4. Save: Account ID, Access Key, Secret Key, public URL

---

## Step 3 — Render (free API)

1. Push repo to GitHub
2. [Render](https://dashboard.render.com) → **New → Blueprint** → connect `poster.co.BE`
3. Set env vars:

| Variable | Value |
|----------|---------|
| `DATABASE_URL` | MongoDB Atlas URI from Step 1 |
| `ADMIN_EMAIL` | your admin email |
| `ADMIN_PASSWORD` | your admin password |
| `CORS_ORIGIN` | `https://your-app.vercel.app,http://localhost:5173` |
| `R2_ACCOUNT_ID` | Cloudflare |
| `R2_ACCESS_KEY_ID` | Cloudflare |
| `R2_SECRET_ACCESS_KEY` | Cloudflare |
| `R2_PUBLIC_URL` | public R2 URL |

4. Deploy → wait for build

Schema sync runs automatically: `npx prisma db push` on start.

If categories are empty after deploy, run seed once in Render Shell:

```bash
npm run db:seed
```

### Verify

```bash
curl https://YOUR-SERVICE.onrender.com/health
curl https://YOUR-SERVICE.onrender.com/api/categories
```

---

## Step 4 — Frontend (Vercel)

```
VITE_API_URL=https://YOUR-SERVICE.onrender.com
```

Redeploy → `/admin` → **Connect API** → add products.

---

## Free tier notes

- **Render free API** sleeps after 15 min idle (~30–60s cold start)
- **Atlas M0** — 512 MB, shared CPU, free forever for small shops
- **R2** — 10 GB/month free storage

---

## Common errors

| Error | Fix |
|-------|-----|
| URL must start with `mongodb` | Use Atlas connection string, not dashboard URL |
| Authentication failed | Check password in URI (URL-encode special chars like `@`, `#`) |
| IP not whitelisted | Atlas → Network Access → allow `0.0.0.0/0` for Render |
| Empty categories | Run `npm run db:seed` |

# Deploy poster.co.BE + poster.co

> **Preferred host: [Render](RENDER.md)** — step-by-step guide and `render.yaml` blueprint included.

## 1. Render — backend (poster.co.BE)

See **[RENDER.md](RENDER.md)** for the full guide.

Quick version:

1. Push `poster.co.BE` to GitHub
2. Render → **New → Blueprint** → select repo
3. Set env vars: `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CORS_ORIGIN`, `R2_*`
4. Deploy → Shell → `npm run db:seed`
5. Copy URL: `https://your-service.onrender.com`

---

## 1b. Railway — backend (alternative)

1. Push `poster.co.BE` to GitHub (`https://github.com/Muthuvel-M/poster.co.BE.git`)
2. In [Railway](https://railway.app): **New Project → Deploy from GitHub** → select `poster.co.BE`
3. Add **PostgreSQL** plugin to the project (Railway injects `DATABASE_URL`)
4. Set service variables:

| Variable | Value |
|----------|-------|
| `JWT_SECRET` | Long random string |
| `ADMIN_EMAIL` | Your admin login email |
| `ADMIN_PASSWORD` | Strong password (hashed on first boot) |
| `CORS_ORIGIN` | `https://your-frontend.vercel.app,https://poster.co` |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API token access key |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret |
| `R2_BUCKET_NAME` | `poster-co` |
| `R2_PUBLIC_URL` | Public CDN URL for the bucket |

5. Deploy — migrations run via `npx prisma migrate deploy` on start
6. Seed categories (one-time, Railway shell or local against prod DB):

```bash
npm run db:seed
```

7. Note the public Railway URL (e.g. `https://poster-co-be-production.up.railway.app`)

### Cloudflare R2 setup

1. Cloudflare Dashboard → R2 → Create bucket `poster-co`
2. Enable public access or attach custom domain (`cdn.poster.co`)
3. Create R2 API token with Object Read & Write
4. Set `R2_PUBLIC_URL` to the public bucket URL

### Local dev (without R2)

Images are stored in `uploads/` and served at `http://localhost:3001/uploads/`.

```bash
cp .env.example .env
# Set DATABASE_URL to local Postgres
npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

---

## 2. Vercel — frontend (poster.co)

1. Add environment variable:

```
VITE_API_URL=https://your-railway-api-url.railway.app
```

2. Redeploy the frontend

---

## 3. Verify end-to-end

1. Open `/admin` on the frontend
2. **Connect API** with `ADMIN_EMAIL` / `ADMIN_PASSWORD`
3. **Add product** — upload image, set A4/A5/A6 prices and optional discounts
4. Shop page should show the new product with CDN/local image URLs
5. Add to cart → checkout → verify discounted pricing

---

## Health check

```bash
curl https://your-api.railway.app/health
# → {"ok":true}
```

# Deploy Aura.Frame — 100% free tier

| Service | Platform | Cost |
|---------|----------|------|
| Storefront (`poster.co`) | **Vercel** Hobby | $0 |
| Admin (`Poster.co.AD`) | **Vercel** Hobby | $0 |
| API (`poster.co.BE`) | **Render** Free | $0 |
| Database | **MongoDB Atlas** M0 | $0 (512 MB) |
| Images | **Cloudinary** Free | $0 |

Images go to **Cloudinary** (WebP variants). MongoDB only stores CDN URLs.

---

## Step 1 — MongoDB Atlas (free database)

1. [cloud.mongodb.com](https://cloud.mongodb.com) → Build M0 FREE cluster
2. Create DB user; Network Access → allow `0.0.0.0/0` (for Render)
3. Connect → Drivers → connection string:

```
mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/poster_co?retryWrites=true&w=majority
```

```bash
cd poster.co.BE
cp .env.example .env
# set DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD, CLOUDINARY_*
npx prisma db push
npm run db:seed
```

---

## Step 2 — Cloudinary (free images)

1. [cloudinary.com](https://cloudinary.com) → sign up
2. Dashboard → **API Keys**
3. Copy Cloud name, API Key, API Secret into `.env`:

```
CLOUDINARY_CLOUD_NAME=...
CLOUDINARY_API_KEY=...
CLOUDINARY_API_SECRET=...
```

---

## Step 3 — Render (free API)

1. Push `poster.co.BE` to GitHub
2. Render → New → Blueprint (or Web Service + Docker)
3. Env vars:

| Variable | Value |
|----------|---------|
| `DATABASE_URL` | Atlas URI |
| `JWT_SECRET` | long random string |
| `ADMIN_EMAIL` | your admin email |
| `ADMIN_PASSWORD` | your admin password |
| `CORS_ORIGIN` | `https://YOUR-STORE.vercel.app,https://YOUR-ADMIN.vercel.app,http://localhost:3000,http://localhost:3001` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary |
| `CLOUDINARY_API_KEY` | Cloudinary |
| `CLOUDINARY_API_SECRET` | Cloudinary |

4. Deploy → `curl https://YOUR-SERVICE.onrender.com/health`  
   Should return `"storage":"cloudinary"`.

Seed FAQs/categories once if empty: Render Shell → `npm run db:seed`

---

## Step 4 — Storefront (Vercel)

Repo: `poster.co`

```
VITE_API_URL=https://YOUR-SERVICE.onrender.com
```

---

## Step 5 — Admin (Vercel)

Repo: `Poster.co.AD`

```
VITE_API_URL=https://YOUR-SERVICE.onrender.com
```

Login with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

---

## Free tier notes

- **Render** sleeps after ~15 min idle (cold start 30–60s)
- **Atlas M0** — 512 MB shared
- **Cloudinary** — free plan has monthly transform/storage limits
- WhatsApp checkout — no payment gateway fees

## Local dev

```bash
# Terminal 1 — API (:3005)
cd poster.co.BE && npm run dev

# Terminal 2 — store (:3000)
cd poster.co && VITE_API_URL=http://localhost:3005 npm run dev

# Terminal 3 — admin (:3001)
cd Poster.co.AD && VITE_API_URL=http://localhost:3005 npm run dev
```

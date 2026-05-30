# poster.co.BE

Backend API for [Poster.Co](https://poster.co) — product catalog, admin uploads, and image storage.

## Stack

- **Fastify** + TypeScript
- **Prisma** + MongoDB Atlas
- **Cloudflare R2** (or local `uploads/` in dev)
- **sharp** for WebP variants (thumb / card / full)

## Setup

```bash
cp .env.example .env
# Edit DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD

npm install
npx prisma db push
npm run db:seed
npm run dev
```

API runs at `http://localhost:3001`.

## Environment

See [.env.example](.env.example).

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | MongoDB Atlas connection string (`mongodb+srv://...`) |
| `JWT_SECRET` | Admin JWT signing key |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Bootstrap admin (first boot only) |
| `CORS_ORIGIN` | Comma-separated frontend origins |
| `R2_*` | Cloudflare R2 credentials (optional in dev) |

## API

### Public

- `GET /health`
- `GET /api/categories`
- `GET /api/products?category=movie`
- `GET /api/products/:slug`

### Admin (Bearer JWT)

- `POST /api/admin/login` — `{ email, password }` → `{ token }`
- `GET /api/admin/me`
- `GET /api/admin/products` — includes archived
- `POST /api/products` — multipart: title, description, category, stock, sizes[A4/A5/A6][price|discountedPrice], images[]
- `PATCH /api/products/:id`
- `DELETE /api/products/:id` — archives product
- `POST /api/products/:id/images`
- `DELETE /api/products/:id/images/:imageId`

## Render deploy (free — MongoDB Atlas)

See **[RENDER.md](RENDER.md)** — Atlas M0 (free) + Render free web + R2.

## Railway deploy (alternative)

1. Connect this repo to Railway
2. Add PostgreSQL plugin
3. Set env vars from `.env.example`
4. Deploy — migrations run automatically

## Frontend

Set in Vercel / `.env.local`:

```
VITE_API_URL=https://your-service.onrender.com
```

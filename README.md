# poster.co.BE

Backend API for [Poster.Co](https://poster.co) — product catalog, admin uploads, and image storage.

## Stack

- **Fastify** + TypeScript
- **Prisma** + PostgreSQL
- **Cloudflare R2** (or local `uploads/` in dev)
- **sharp** for WebP variants (thumb / card / full)

## Setup

```bash
cp .env.example .env
# Edit DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD

npm install
npx prisma migrate dev
npm run db:seed
npm run dev
```

API runs at `http://localhost:3001`.

## Environment

See [.env.example](.env.example).

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection string |
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

## Render deploy (recommended)

See **[RENDER.md](RENDER.md)** for full steps.

1. Push repo to GitHub
2. Render → **New → Blueprint** → connect repo (uses [`render.yaml`](render.yaml))
3. Set `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CORS_ORIGIN`, and `R2_*` env vars
4. After deploy: **Shell** → `npm run db:seed`
5. API URL: `https://your-service.onrender.com`

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

# poster.co.BE

Backend API for Aura.Frame — catalog, customers, orders, reviews, FAQ, admin uploads.

## Stack

- **Fastify** + TypeScript
- **Prisma** + MongoDB Atlas (free M0)
- **Cloudinary** for images (falls back to local `uploads/` if not configured)
- **sharp** for WebP variants (thumb / card / full)

## Setup

```bash
cp .env.example .env
# Edit DATABASE_URL, JWT_SECRET, ADMIN_*, CLOUDINARY_*

npm install
npx prisma db push
npm run db:seed
npm run dev
```

API runs at `http://localhost:3005`.

Local ports: **store :3000** · **admin :3001** · **API :3005**.

## Environment

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | MongoDB Atlas connection string |
| `JWT_SECRET` | JWT signing key |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Bootstrap admin (first boot only) |
| `CORS_ORIGIN` | Comma-separated store + admin origins |
| `CLOUDINARY_CLOUD_NAME` / `API_KEY` / `API_SECRET` | Image hosting |

## Images

Uploaded posters are resized to WebP and stored on **Cloudinary**. MongoDB only keeps the CDN URLs (`url`, `thumbUrl`, `cardUrl`).

## Deploy

See **[RENDER.md](RENDER.md)** — Atlas M0 + Render free web + Cloudinary.

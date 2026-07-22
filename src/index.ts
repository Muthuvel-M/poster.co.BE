import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, isCloudinaryConfigured } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { ensureAdminUser, registerAuth } from "./plugins/auth.js";
import { categoryRoutes } from "./routes/categories.js";
import { productRoutes } from "./routes/products.js";
import { orderRoutes } from "./routes/orders.js";
import { reviewRoutes } from "./routes/reviews.js";
import { faqRoutes } from "./routes/faqs.js";
import { adminRoutes } from "./routes/admin.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const app = Fastify({
    logger: config.nodeEnv !== "production",
    bodyLimit: 50 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (config.isAllowedCorsOrigin(origin)) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Accept"],
  });

  await app.register(multipart, {
    limits: { fileSize: 15 * 1024 * 1024, files: 50 },
  });

  // Always serve local uploads (older products may still point here even
  // after Cloudinary is enabled for new uploads).
  const uploadRoot = path.resolve(config.uploadDir);
  await app.register(fastifyStatic, {
    root: uploadRoot,
    prefix: "/uploads/",
    decorateReply: false,
    setHeaders: (res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  });

  if (isCloudinaryConfigured()) {
    console.log(
      `Cloudinary configured (cloud: ${config.cloudinary.cloudName}); also serving local uploads from ${uploadRoot}`,
    );
  } else {
    console.log(`Serving local uploads from ${uploadRoot}`);
  }

  await registerAuth(app);
  await categoryRoutes(app);
  await productRoutes(app);
  await orderRoutes(app);
  await reviewRoutes(app);
  await faqRoutes(app);
  await adminRoutes(app);

  app.get("/", async () => ({
    name: "poster.co.BE",
    status: "ok",
    storage: isCloudinaryConfigured() ? "cloudinary" : "local",
    docs: {
      health: "GET /health",
      categories: "GET /api/categories",
      products: "GET /api/products",
      product: "GET /api/products/:slug",
      faqs: "GET /api/faqs",
      customerRegister: "POST /api/auth/register",
      customerLogin: "POST /api/auth/login",
      adminLogin: "POST /api/admin/login",
      createOrder: "POST /api/orders",
    },
  }));

  app.get("/health", async () => ({
    ok: true,
    storage: isCloudinaryConfigured() ? "cloudinary" : "local",
  }));

  await ensureAdminUser();

  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`poster.co.BE listening on :${config.port}`);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, isR2Configured } from "./config.js";
import { prisma } from "./lib/prisma.js";
import { ensureAdminUser, registerAuth } from "./plugins/auth.js";
import { categoryRoutes } from "./routes/categories.js";
import { productRoutes } from "./routes/products.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const app = Fastify({
    logger: config.nodeEnv !== "production",
    bodyLimit: 20 * 1024 * 1024,
  });

  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  await app.register(multipart, {
    limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  });

  if (!isR2Configured()) {
    const uploadRoot = path.resolve(config.uploadDir);
    await app.register(fastifyStatic, {
      root: uploadRoot,
      prefix: "/uploads/",
      decorateReply: false,
    });
    console.log(`Serving local uploads from ${uploadRoot}`);
  }

  await registerAuth(app);
  await categoryRoutes(app);
  await productRoutes(app);

  app.get("/", async () => ({
    name: "poster.co.BE",
    status: "ok",
    docs: {
      health: "GET /health",
      categories: "GET /api/categories",
      products: "GET /api/products",
      product: "GET /api/products/:slug",
      adminLogin: "POST /api/admin/login",
    },
  }));

  app.get("/health", async () => ({ ok: true }));

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

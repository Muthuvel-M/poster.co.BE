import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:8080",
  "http://localhost:3000",
  "https://poster-co.vercel.app",
];

function parseCorsOrigins(): string[] {
  const fromEnv = (process.env.CORS_ORIGIN ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_CORS_ORIGINS, ...fromEnv])];
}

function isAllowedCorsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const allowed = parseCorsOrigins();
  if (allowed.includes(origin)) return true;
  // Vercel preview deploys: poster-co-git-main-user.vercel.app
  if (/^https:\/\/poster-co[a-z0-9-]*\.vercel\.app$/.test(origin)) return true;
  return false;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-in-production"),
  adminEmail: required("ADMIN_EMAIL", "admin@poster.co"),
  adminPassword: required("ADMIN_PASSWORD", "changeme"),
  corsOrigins: parseCorsOrigins(),
  isAllowedCorsOrigin,
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  r2: {
    accountId: process.env.R2_ACCOUNT_ID ?? "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    bucketName: process.env.R2_BUCKET_NAME ?? "poster-co",
    publicUrl: (process.env.R2_PUBLIC_URL ?? "http://localhost:3001/uploads").replace(
      /\/$/,
      "",
    ),
  },
};

export function isR2Configured(): boolean {
  return Boolean(
    config.r2.accountId &&
      config.r2.accessKeyId &&
      config.r2.secretAccessKey &&
      config.r2.bucketName,
  );
}

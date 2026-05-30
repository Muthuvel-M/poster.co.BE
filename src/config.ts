import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-in-production"),
  adminEmail: required("ADMIN_EMAIL", "admin@poster.co"),
  adminPassword: required("ADMIN_PASSWORD", "changeme"),
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
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

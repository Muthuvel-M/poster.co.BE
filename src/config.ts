import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:3001",
  "https://poster-co.vercel.app",
  "https://www.auraframe.store",
  "https://auraframe.store",
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

  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  if (
    /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d+)?$/.test(
      origin,
    )
  ) {
    return true;
  }

  if (/^https:\/\/(www\.)?auraframe\.store$/.test(origin)) return true;
  if (/^https:\/\/poster-co[a-z0-9-]*\.vercel\.app$/.test(origin)) return true;
  if (/^https:\/\/poster-co-ad[a-z0-9-]*\.vercel\.app$/.test(origin)) return true;
  return false;
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

const DEV_JWT = "dev-secret-change-in-production";
const DEV_ADMIN_PASSWORD = "changeme";

function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET;
  if (isProduction) {
    if (!fromEnv || fromEnv === DEV_JWT || fromEnv.length < 32) {
      throw new Error(
        "JWT_SECRET must be set to a strong value (≥32 chars) in production",
      );
    }
    return fromEnv;
  }
  return fromEnv || DEV_JWT;
}

function resolveAdminPassword(): string {
  const fromEnv = process.env.ADMIN_PASSWORD;
  if (isProduction) {
    if (!fromEnv || fromEnv === DEV_ADMIN_PASSWORD || fromEnv.length < 8) {
      throw new Error(
        "ADMIN_PASSWORD must be set to a strong value (≥8 chars) in production",
      );
    }
    return fromEnv;
  }
  return fromEnv || DEV_ADMIN_PASSWORD;
}

export const config = {
  port: Number(process.env.PORT ?? 3005),
  nodeEnv,
  isProduction,
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: resolveJwtSecret(),
  adminEmail: required("ADMIN_EMAIL", "admin@poster.co"),
  adminPassword: resolveAdminPassword(),
  corsOrigins: parseCorsOrigins(),
  isAllowedCorsOrigin,
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  storefrontUrl:
    process.env.STOREFRONT_URL ?? "https://www.auraframe.store",
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME ?? "",
    apiKey: process.env.CLOUDINARY_API_KEY ?? "",
    apiSecret: process.env.CLOUDINARY_API_SECRET ?? "",
  },
};

export function isCloudinaryConfigured(): boolean {
  return Boolean(
    config.cloudinary.cloudName &&
      config.cloudinary.apiKey &&
      config.cloudinary.apiSecret,
  );
}

export function assertProductionStorage(): void {
  if (config.isProduction && !isCloudinaryConfigured()) {
    throw new Error(
      "Cloudinary must be configured in production (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)",
    );
  }
}

export function isGoogleAuthConfigured(): boolean {
  return Boolean(config.googleClientId);
}

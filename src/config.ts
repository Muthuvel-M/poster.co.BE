import "dotenv/config";

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

const DEFAULT_CORS_ORIGINS = [
  "http://localhost:3000",
  "http://localhost:3001",
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
  if (/^https:\/\/poster-co[a-z0-9-]*\.vercel\.app$/.test(origin)) return true;
  if (/^https:\/\/poster-co-ad[a-z0-9-]*\.vercel\.app$/.test(origin)) return true;
  return false;
}

export const config = {
  port: Number(process.env.PORT ?? 3005),
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET", "dev-secret-change-in-production"),
  adminEmail: required("ADMIN_EMAIL", "admin@poster.co"),
  adminPassword: required("ADMIN_PASSWORD", "changeme"),
  corsOrigins: parseCorsOrigins(),
  isAllowedCorsOrigin,
  uploadDir: process.env.UPLOAD_DIR ?? "uploads",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
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

export function isGoogleAuthConfigured(): boolean {
  return Boolean(config.googleClientId);
}

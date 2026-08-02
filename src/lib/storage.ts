import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { v2 as cloudinary } from "cloudinary";
import sharp from "sharp";
import { config, isCloudinaryConfigured } from "../config.js";

export type ImageVariant = "thumb" | "card" | "full";

const VARIANT_WIDTH: Record<ImageVariant, number> = {
  thumb: 400,
  card: 800,
  full: 1600,
};

let cloudinaryReady = false;

function ensureCloudinary() {
  if (cloudinaryReady) return;
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
    secure: true,
  });
  cloudinaryReady = true;
}

function uploadBufferToCloudinary(
  buffer: Buffer,
  publicId: string,
): Promise<string> {
  ensureCloudinary();
  return new Promise((resolve, reject) => {
    cloudinary.uploader
      .upload_stream(
        {
          public_id: publicId,
          resource_type: "image",
          format: "webp",
          overwrite: true,
          unique_filename: false,
        },
        (err, result) => {
          if (err || !result?.secure_url) {
            reject(err ?? new Error("Cloudinary upload returned no URL"));
            return;
          }
          resolve(result.secure_url);
        },
      )
      .end(buffer);
  });
}

async function uploadBufferLocal(key: string, buffer: Buffer): Promise<string> {
  const filePath = path.join(config.uploadDir, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  const base =
    process.env.PUBLIC_API_URL?.replace(/\/$/, "") ||
    `http://localhost:${config.port}`;
  return `${base}/uploads/${key}`;
}

async function uploadBuffer(key: string, buffer: Buffer): Promise<string> {
  if (isCloudinaryConfigured()) {
    // Cloudinary public_id without extension
    const publicId = key.replace(/\.webp$/i, "");
    return uploadBufferToCloudinary(buffer, publicId);
  }
  return uploadBufferLocal(key, buffer);
}

export async function processAndUploadImage(
  productId: string,
  imageId: string,
  input: Buffer,
): Promise<{ url: string; thumbUrl: string; cardUrl: string }> {
  const baseKey = `posters/${productId}/${imageId}`;

  const [thumb, card, full] = await Promise.all(
    (["thumb", "card", "full"] as ImageVariant[]).map(async (variant) => {
      const buffer = await sharp(input)
        .rotate()
        .resize(VARIANT_WIDTH[variant], undefined, {
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: variant === "full" ? 88 : 82 })
        .toBuffer();

      const key = `${baseKey}-${variant}.webp`;
      const url = await uploadBuffer(key, buffer);
      return { variant, url };
    }),
  );

  return {
    url: full.url,
    cardUrl: card.url,
    thumbUrl: thumb.url,
  };
}

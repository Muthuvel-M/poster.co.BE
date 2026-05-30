import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { config, isR2Configured } from "../config.js";

export type ImageVariant = "thumb" | "card" | "full";

const VARIANT_WIDTH: Record<ImageVariant, number> = {
  thumb: 400,
  card: 800,
  full: 1600,
};

let s3: S3Client | null = null;

function getS3(): S3Client {
  if (!s3) {
    s3 = new S3Client({
      region: "auto",
      endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2.accessKeyId,
        secretAccessKey: config.r2.secretAccessKey,
      },
    });
  }
  return s3;
}

function publicUrl(key: string): string {
  return `${config.r2.publicUrl}/${key}`;
}

async function uploadBuffer(key: string, buffer: Buffer): Promise<string> {
  if (isR2Configured()) {
    await getS3().send(
      new PutObjectCommand({
        Bucket: config.r2.bucketName,
        Key: key,
        Body: buffer,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return publicUrl(key);
  }

  const filePath = path.join(config.uploadDir, key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, buffer);
  return publicUrl(key);
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

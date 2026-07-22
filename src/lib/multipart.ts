import type { Multipart, MultipartFile } from "@fastify/multipart";

export type BufferedUpload = {
  fieldname: string;
  filename: string;
  mimetype: string;
  buffer: Buffer;
};

/**
 * Consume multipart parts immediately (required by @fastify/multipart).
 * Skips empty file fields browsers often send with FormData.
 */
export async function readMultipart(
  request: { parts: () => AsyncIterable<Multipart> },
): Promise<{ fields: Record<string, string>; files: BufferedUpload[] }> {
  const fields: Record<string, string> = {};
  const files: BufferedUpload[] = [];

  for await (const part of request.parts()) {
    if (part.type === "file") {
      const file = part as MultipartFile;
      const buffer = await file.toBuffer();
      const filename = (file.filename || "").trim();
      // Browsers often append an empty File when the input is untouched
      if (!filename || buffer.length === 0) continue;
      files.push({
        fieldname: file.fieldname,
        filename,
        mimetype: file.mimetype || "application/octet-stream",
        buffer,
      });
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }

  return { fields, files };
}

export function isImageUpload(file: BufferedUpload): boolean {
  if (file.mimetype.startsWith("image/")) return true;
  return /\.(jpe?g|png|webp|gif|avif|bmp|tiff?)$/i.test(file.filename);
}

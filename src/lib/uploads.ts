export const MAX_UPLOAD_FILES = 100;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/tiff",
]);

export function validateImageFile(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) return `${file.name}: unsupported image type`;
  if (file.size === 0) return `${file.name}: file is empty`;
  if (file.size > MAX_UPLOAD_BYTES) return `${file.name}: exceeds the 15 MB limit`;
  return null;
}

import { getDb } from "./db";

export async function saveItemImage(itemId: number, image: Buffer, contentType = "image/jpeg") {
  const db = await getDb();
  await db.query(
    `INSERT INTO item_images (item_id, image_data, image_content_type, cutout_data, cutout_content_type, updated_at)
     VALUES ($1, $2, $3, NULL, NULL, NOW())
     ON CONFLICT (item_id) DO UPDATE SET image_data = EXCLUDED.image_data,
       image_content_type = EXCLUDED.image_content_type, cutout_data = NULL,
       cutout_content_type = NULL, updated_at = NOW()`,
    [itemId, image, contentType]
  );
}

export async function saveProcessedImages(itemId: number, recognitionImage: Buffer, cutout: Buffer) {
  const db = await getDb();
  await db.query(
    `UPDATE item_images SET image_data = $1, image_content_type = 'image/jpeg',
       cutout_data = $2, cutout_content_type = 'image/png', updated_at = NOW()
     WHERE item_id = $3`,
    [recognitionImage, cutout, itemId]
  );
}

export async function getItemImage(itemId: number, cutout = false): Promise<{ data: Buffer; contentType: string } | null> {
  const db = await getDb();
  const column = cutout ? "cutout_data" : "image_data";
  const typeColumn = cutout ? "cutout_content_type" : "image_content_type";
  const { rows } = await db.query<{ data: Buffer | null; content_type: string | null }>(
    `SELECT ${column} AS data, ${typeColumn} AS content_type FROM item_images WHERE item_id = $1`,
    [itemId]
  );
  const row = rows[0];
  return row?.data ? { data: row.data, contentType: row.content_type ?? (cutout ? "image/png" : "image/jpeg") } : null;
}

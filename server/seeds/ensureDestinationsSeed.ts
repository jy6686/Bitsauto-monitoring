import { createReadStream } from "fs";
import { join } from "path";
import { createGunzip } from "zlib";
import { pool } from "../db";

export async function ensureDestinationsSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    const res = await client.query("SELECT COUNT(*) AS cnt FROM destinations");
    const count = parseInt(res.rows[0].cnt, 10);
    if (count > 0) {
      console.log(`[dest-seed] destinations has ${count} rows — skipping seed`);
      return;
    }

    console.log("[dest-seed] destinations is empty — seeding from bundled dump...");

    const seedPath = join(process.cwd(), "server", "seeds", "destinations.sql.gz");
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      createReadStream(seedPath)
        .pipe(createGunzip())
        .on("data", (chunk: Buffer) => chunks.push(chunk))
        .on("error", reject)
        .on("end", resolve);
    });

    const sql = Buffer.concat(chunks).toString("utf8");
    await client.query(sql);
    const after = await client.query("SELECT COUNT(*) AS cnt FROM destinations");
    console.log(`[dest-seed] seeded ${after.rows[0].cnt} destinations`);
  } finally {
    client.release();
  }
}

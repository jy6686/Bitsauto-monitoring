import { createReadStream } from "fs";
import { join } from "path";
import { createGunzip } from "zlib";
import { spawn } from "child_process";
import { pool } from "../db";

export async function ensureDestinationsSeed(): Promise<void> {
  const client = await pool.connect();
  let isEmpty = false;
  try {
    const res = await client.query("SELECT COUNT(*) AS cnt FROM destinations");
    const count = parseInt(res.rows[0].cnt, 10);
    if (count > 0) {
      console.log(`[dest-seed] destinations has ${count} rows — skipping seed`);
      return;
    }
    isEmpty = true;
    console.log("[dest-seed] destinations is empty — seeding via psql...");
  } finally {
    client.release();
  }

  if (!isEmpty) return;

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("[dest-seed] DATABASE_URL not set");

  const seedPath = join(process.cwd(), "server", "seeds", "destinations.sql.gz");

  await new Promise<void>((resolve, reject) => {
    const psql = spawn("psql", [dbUrl], {
      stdio: ["pipe", "inherit", "inherit"],
    });

    const gz = createReadStream(seedPath).pipe(createGunzip());
    gz.pipe(psql.stdin);

    psql.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`[dest-seed] psql exited with code ${code}`));
    });
    psql.on("error", reject);
    gz.on("error", reject);
  });

  const verifyClient = await pool.connect();
  try {
    const after = await verifyClient.query("SELECT COUNT(*) AS cnt FROM destinations");
    console.log(`[dest-seed] seeded ${after.rows[0].cnt} destinations`);
  } finally {
    verifyClient.release();
  }
}

import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, writeFile } from "fs/promises";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");

  // Stamp the build so a running instance can say which code it is.
  // Without this, "is my fix deployed?" is answered by hunting for a visible
  // symptom — which is how an unpublished deployment went unnoticed while
  // several rounds of fixes were assumed live. Baked in at build time because
  // the deployed image has no git history to read.
  let gitCommit = "unknown";
  try {
    const { execSync } = await import("child_process");
    gitCommit = execSync("git rev-parse --short HEAD", { encoding: "utf-8" }).trim();
  } catch {
    // Deployment images sometimes ship without .git — record that honestly
    // rather than inventing a value.
    gitCommit = process.env.REPL_SLUG ? "no-git-in-image" : "unknown";
  }
  const buildTime = new Date().toISOString();
  const version   = `${buildTime.slice(0, 10).replace(/-/g, ".")}-${gitCommit}`;
  await writeFile("dist/build-info.json", JSON.stringify({ gitCommit, buildTime, version }, null, 2));
  console.log(`build stamp: ${version} (${buildTime})`);

  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});

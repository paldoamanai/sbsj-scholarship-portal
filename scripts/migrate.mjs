// Applies the migrations in supabase/migrations that the database doesn't have yet, in order. Runs before
// `next build` (see package.json), so a deploy only goes live once its migrations are in; a failing
// migration fails the build and the current site stays up.
//
// Needs SUPABASE_DB_URL (the Session pooler connection string from Supabase: Project Settings → Database).
// Without it, it skips, so local builds and builds before the variable is set work as before.
//
// Applied migrations are recorded in supabase_migrations.schema_migrations, the table the Supabase CLI
// uses. The first run records 001 to BASELINE as applied without running them: those were run by hand
// in the SQL Editor.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const BASELINE = 66;
const DIR = path.join(process.cwd(), "supabase", "migrations");

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.log("migrate: SUPABASE_DB_URL is not set, skipping migrations");
  process.exit(0);
}

const files = (await readdir(DIR))
  .map((name) => ({ name, m: name.match(/^(\d+)_(.+)\.sql$/) }))
  .filter((f) => f.m)
  .map((f) => ({ file: f.name, version: f.m[1], name: f.m[2] }))
  .sort((a, b) => Number(a.version) - Number(b.version));

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  // One build at a time: a second deploy waits here instead of running the same migration twice.
  await client.query("SELECT pg_advisory_lock(hashtext('sbsj_migrations'))");
  await client.query(`
    CREATE SCHEMA IF NOT EXISTS supabase_migrations;
    CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version TEXT PRIMARY KEY, statements TEXT[], name TEXT);
  `);

  const { rows } = await client.query("SELECT version FROM supabase_migrations.schema_migrations");
  if (rows.length === 0) {
    const old = files.filter((f) => Number(f.version) <= BASELINE);
    for (const f of old) {
      await client.query("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2)", [f.version, f.name]);
    }
    console.log(`migrate: recorded ${old.length} migrations up to ${String(BASELINE).padStart(3, "0")} as already applied`);
  }

  const done = new Set((await client.query("SELECT version FROM supabase_migrations.schema_migrations")).rows.map((r) => r.version));
  const pending = files.filter((f) => !done.has(f.version));
  if (pending.length === 0) console.log("migrate: database is up to date");

  for (const f of pending) {
    const sql = await readFile(path.join(DIR, f.file), "utf8");
    // Most migrations wrap themselves in BEGIN/COMMIT; for the rest, the whole file is one transaction.
    const ownTransaction = /^\s*BEGIN\s*;/im.test(sql);
    console.log(`migrate: applying ${f.file}`);
    try {
      if (ownTransaction) {
        await client.query(sql);
        await client.query("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2)", [f.version, f.name]);
      } else {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2)", [f.version, f.name]);
        await client.query("COMMIT");
      }
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error(`migrate: ${f.file} failed: ${err.message}`);
      console.error("migrate: stopping the build; the current site stays live. Fix the migration and deploy again.");
      process.exitCode = 1;
      break;
    }
  }
} finally {
  await client.end();
}

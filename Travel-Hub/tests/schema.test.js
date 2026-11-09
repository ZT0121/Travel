import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { tables } from "../store.js";
test("PostgreSQL schema enforces ownership, parent ownership and compare-and-swap", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select current_setting('app.uid')::uuid$$;
 grant usage on schema auth to authenticated;
 create schema storage;create table storage.buckets(id text,name text,public boolean,file_size_limit int,allowed_mime_types text[]);
 create table storage.objects(bucket_id text,name text);alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated;grant all on storage.objects to authenticated;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 create publication supabase_realtime;`);
    await db.exec(
      await readFile(new URL("../schema.sql", import.meta.url), "utf8"),
    );
    await db.exec(
      await readFile(new URL("../households.sql", import.meta.url), "utf8"),
    );
    const partner = crypto.randomUUID();
    const a = crypto.randomUUID(),
      b = crypto.randomUUID(),
      trip = crypto.randomUUID(),
      op = crypto.randomUUID();
    await db.exec(
      `insert into auth.users values ('${a}'),('${b}'),('${partner}');insert into hub_households values ('${a}');insert into hub_members values ('${a}','${a}'),('${partner}','${a}');set role authenticated;set app.uid='${a}';insert into trips(id,mutation,data) values ('${trip}','${op}','{}');`,
    );
    for (const t of tables.slice(1))
      await db.exec(
        `insert into ${t}(id,trip_id,mutation,data) values(gen_random_uuid(),'${trip}','${op}','{}')`,
      );
    await db.exec(
      `insert into storage.objects values('travel-shopping','${a}/photo');update trips set data='{"name":"test"}' where version=1`,
    );
    assert.equal(
      (await db.query("select version from trips")).rows[0].version,
      2,
    );
    assert.equal(
      (
        await db.query(
          "update trips set deleted=true where version=1 returning id",
        )
      ).rows.length,
      0,
    );
    await db.exec(`set app.uid='${partner}'`);
    for (const t of [...tables, "storage.objects"])
      assert.equal((await db.query("select * from " + t)).rows.length, 1);
    await db.exec(`set app.uid='${b}'`);
    for (const t of [...tables, "storage.objects"])
      assert.equal((await db.query("select * from " + t)).rows.length, 0);
    await assert.rejects(
      db.exec(
        `insert into shopping_items(id,trip_id,mutation,data) values(gen_random_uuid(),'${trip}','${op}','{}')`,
      ),
    );
    await assert.rejects(
      db.exec(
        `insert into storage.objects values('travel-shopping','${a}/other')`,
      ),
    );
  } finally {
    await db.close();
  }
});

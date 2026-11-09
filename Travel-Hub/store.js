export const tables = [
  "trips",
  "itinerary_items",
  "saved_places",
  "shopping_items",
  "expenses",
  "packing_items",
];
export const uid = () => crypto.randomUUID();
export async function stableId(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    h.slice(12, 16),
    h.slice(16, 20),
    h.slice(20),
  ].join("-");
}
function request(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function openStore(scope, owner, client) {
  const open = indexedDB.open("travel-hub:" + scope + ":" + owner, 1);
  open.onupgradeneeded = () => {
    for (const name of ["rows", "images"])
      open.result.createObjectStore(name, { keyPath: "id" });
  };
  const db = await request(open);
  const read = (store, id) =>
    request(db.transaction(store).objectStore(store).get(id));
  const all = () =>
    request(db.transaction("rows").objectStore("rows").getAll());
  async function write(store, value) {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    await new Promise((res, rej) => {
      tx.oncomplete = res;
      tx.onabort = () => rej(tx.error);
    });
  }
  const serial = (fn) =>
    navigator.locks.request("travel-hub:" + scope + owner, fn);
  const api = {
    all,
    read,
    write,
    owner,
    status: "待同步",
    error: "",
    onchange: () => {},
    busy: false,
  };
  api.save = (table, id, trip, data, deleted = false, expected) =>
    serial(async () => {
      const prev = await read("rows", id);
      if (
        prev?.conflict ||
        (expected !== undefined && expected !== (prev?.stamp || ""))
      )
        throw Error("資料已更新，請重開表單確認。");
      const stamp = uid();
      await write("rows", {
        ...prev,
        id,
        table,
        trip,
        data,
        deleted,
        stamp,
        dirty: true,
        created_at: prev?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
        base: prev?.base || 0,
        mutation: stamp,
        prior: prev?.dirty ? [...(prev.prior || []), prev.mutation] : [],
      });
      api.onchange();
      queueMicrotask(() => api.sync());
      return stamp;
    });
  api.resolve = (id, keep) =>
    serial(async () => {
      const row = await read("rows", id);
      if (!row?.conflict) return;
      const remote = row.conflict;
      await write(
        "rows",
        keep
          ? {
              ...row,
              conflict: null,
              base: remote.version,
              mutation: uid(),
              prior: [],
              stamp: uid(),
            }
          : fromRemote(row.table, remote),
      );
      api.onchange();
      queueMicrotask(() => api.sync());
    });
  function fromRemote(table, r) {
    return {
      table,
      id: r.id,
      trip: r.trip_id,
      data: r.data,
      deleted: r.deleted,
      base: r.version,
      stamp: r.mutation,
      created_at: r.created_at,
      updated_at: r.updated_at,
      dirty: false,
    };
  }
  async function reconcile(row, remote) {
    if (remote.mutation === row.mutation) {
      await write("rows", fromRemote(row.table, remote));
      return;
    }
    if (row.prior?.includes(remote.mutation)) {
      await write("rows", { ...row, base: remote.version, prior: [] });
      return;
    }
    if (row.base !== remote.version)
      await write("rows", { ...row, conflict: remote });
  }
  async function push(row) {
    const bucket = client.storage.from("travel-shopping");
    if (row.table === "shopping_items" && row.data.image && !row.deleted) {
      const img = await read("images", row.data.image);
      if (img && !img.uploaded) {
        const result = await bucket.upload(img.id, img.blob, {
          contentType: "image/jpeg",
        });
        if (
          result.error &&
          !["409", "Duplicate"].includes(String(result.error.statusCode)) &&
          !/already exists/i.test(result.error.message)
        )
          throw result.error;
        await write("images", { ...img, uploaded: true });
      }
    }
    const payload = {
      id: row.id,
      owner_id: owner,
      data: row.data,
      mutation: row.mutation,
      deleted: row.deleted,
    };
    if (row.table !== "trips") payload.trip_id = row.trip;
    const q = client.from(row.table);
    const result = await (
      row.base
        ? q.update(payload).eq("id", row.id).eq("version", row.base)
        : q.insert(payload)
    )
      .select()
      .maybeSingle();
    if (result.error && result.error.code !== "23505") throw result.error;
    if (result.data) {
      await write("rows", fromRemote(row.table, result.data));
      return;
    }
    const found = await q.select().eq("id", row.id).single();
    if (found.error) throw found.error;
    await reconcile(row, found.data);
  }
  api.sync = async () => {
    if (!client || !navigator.onLine) return;
    if (api.busy) {
      api.again = true;
      return;
    }
    api.busy = true;
    try {
      await serial(async () => {
        api.error = "";
        const pending = (await all())
          .filter((r) => r.dirty && !r.conflict)
          .sort((a, b) => tables.indexOf(a.table) - tables.indexOf(b.table));
        for (const row of pending) {
          try {
            await push(row);
          } catch (e) {
            api.error = e.message;
          }
        }
        const cleanup = await client
          .from("hub_removed_images")
          .select("path")
          .eq("owner_id", owner)
          .limit(100);
        if (cleanup.error) throw cleanup.error;
        for (const job of cleanup.data) {
          const removed = await client.storage
            .from("travel-shopping")
            .remove([job.path]);
          if (removed.error) throw removed.error;
          const ack = await client
            .from("hub_removed_images")
            .delete()
            .eq("path", job.path);
          if (ack.error) throw ack.error;
        }
        for (const table of tables) {
          let after = null;
          while (true) {
            let q = client
              .from(table)
              .select()
              .eq("owner_id", owner)
              .order("id")
              .limit(200);
            if (after) q = q.gt("id", after);
            const { data, error } = await q;
            if (error) throw error;
            for (const r of data) {
              const local = await read("rows", r.id);
              if (local?.dirty) await reconcile(local, r);
              else if (local?.base !== r.version)
                await write("rows", fromRemote(table, r));
            }
            if (data.length < 200) break;
            after = data.at(-1).id;
          }
        }
      });
    } catch (e) {
      api.error = e.message;
    } finally {
      api.busy = false;
      api.onchange();
      if (api.again) {
        api.again = false;
        queueMicrotask(() => api.sync());
      }
    }
  };
  return api;
}

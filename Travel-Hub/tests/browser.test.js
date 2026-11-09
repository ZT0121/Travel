import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { existsSync } from "node:fs";
import { tables } from "../store.js";

// HTTP fixture implements the Data API subset used by the real Supabase client.
// Both browser contexts use their own real IndexedDB, service worker and Auth client.
test("two mobile profiles: isolated trips, move/undo, fixed totals, offline queue, images and conflicts", async () => {
  const root = new URL("../", import.meta.url),
    db = new Map(tables.map((t) => [t, new Map()]));
  const sockets = new Set();
  let loseFirstExpenseResponse = true;
  const images = new Map(),
    owner = crypto.randomUUID(),
    exp = Math.floor(Date.now() / 1000) + 3600;
  const tokenFor = (owner) =>
    [
      { alg: "HS256", typ: "JWT" },
      { sub: owner, exp, role: "authenticated", iat: exp - 3600 },
      "sig",
    ]
      .map((v) => Buffer.from(JSON.stringify(v)).toString("base64url"))
      .join(".");
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost"),
        path = url.pathname;
      const json = (value, status = 200) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(value));
      };
      if (path.startsWith("/storage/v1/object/")) {
        const parts = path
          .replace("/authenticated/", "/")
          .split("/")
          .slice(5)
          .join("/");
        if (req.method === "POST") {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          let bytes = Buffer.concat(chunks);
          if (req.headers["content-type"]?.includes("multipart/form-data")) {
            const data = await new Response(bytes, {
              headers: { "Content-Type": req.headers["content-type"] },
            }).formData();
            const file = [...data.values()].find((v) => typeof v !== "string");
            bytes = Buffer.from(await file.arrayBuffer());
          }
          images.set(parts, bytes);
          return json({ Key: parts });
        }
        if (!images.has(parts)) return json({}, 404);
        res.setHeader("content-type", "image/jpeg");
        return res.end(images.get(parts));
      }
      if (path === "/rest/v1/rpc/hub_household_id") return json(owner);
      if (path.startsWith("/rest/v1/")) {
        if (path.endsWith("/hub_removed_images")) return json([]);
        const table = db.get(path.split("/").pop()),
          id = url.searchParams.get("id")?.slice(3);
        if (req.method === "GET") {
          const vals = id
            ? [table.get(id)].filter(Boolean)
            : [...table.values()];
          return json(
            req.headers.accept?.includes("vnd.pgrst.object") ? vals[0] : vals,
          );
        }
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const data = JSON.parse(Buffer.concat(chunks)),
          prev = table.get(data.id);
        if (req.method === "POST" && prev)
          return json({ code: "23505", message: "duplicate" }, 409);
        if (
          req.method === "PATCH" &&
          prev?.version !== Number(url.searchParams.get("version").slice(3))
        )
          return json([]);
        const row = {
          ...data,
          version: (prev?.version || 0) + 1,
          created_at: prev?.created_at || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        table.set(data.id, row);
        for (const subscription of sockets) {
          const binding = subscription.bindings.find(
            (b) => b.table === path.split("/").pop(),
          );
          if (binding)
            subscription.ws.send(
              JSON.stringify([
                subscription.join,
                null,
                subscription.topic,
                "postgres_changes",
                {
                  ids: [binding.id],
                  data: {
                    schema: "public",
                    table: binding.table,
                    type: prev ? "UPDATE" : "INSERT",
                    columns: [],
                    record: row,
                    old_record: {},
                  },
                },
              ]),
            );
        }
        if (path.endsWith("/expenses") && loseFirstExpenseResponse) {
          loseFirstExpenseResponse = false;
          return json({ message: "Lost write acknowledgement" }, 503);
        }
        return json([row]);
      }
      if (path === "/Busan-2026/") {
        res.setHeader("content-type", "text/html");
        return res.end(
          await readFile(new URL("../Busan-2026/index.html", root)),
        );
      }
      const name = path.slice(1) || "index.html";
      if (!/^(?:fonts\/)?[\w.-]+$/.test(name)) return json({}, 404);
      const contents = await readFile(new URL(name, root));
      res.setHeader(
        "content-type",
        {
          js: "text/javascript",
          html: "text/html",
          css: "text/css",
          webmanifest: "application/manifest+json",
          png: "image/png",
        }[name.split(".").pop()] || "application/octet-stream",
      );
      res.end(contents);
    } catch (err) {
      res.writeHead(500);
      res.end(err.message);
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = "http://127.0.0.1:" + server.address().port;
  let browser;
  try {
    const systemChrome =
      "C:/Program Files/Google/Chrome/Application/chrome.exe";
    browser = await chromium.launch(
      existsSync(systemChrome) ? { executablePath: systemChrome } : {},
    );
    const devices = [];
    for (let i = 0; i < 2; i++) {
      const userId = crypto.randomUUID();
      const ctx = await browser.newContext({
        viewport: { width: 390, height: 844 },
      });
      await ctx.addInitScript(
        ({ origin, owner, token, exp }) => {
          localStorage.setItem(
            "hub-project",
            JSON.stringify({ url: origin, publicKey: "sb_publishable_test" }),
          );
          localStorage.setItem(
            "hub-auth:" + origin,
            JSON.stringify({
              access_token: token,
              refresh_token: "fixture",
              expires_at: exp,
              expires_in: 3600,
              token_type: "bearer",
              user: { id: owner },
            }),
          );
        },
        { origin, owner: userId, token: tokenFor(userId), exp },
      );
      await ctx.routeWebSocket("**/realtime/v1/websocket**", (ws) => {
        let subscription;
        ws.onMessage((message) => {
          const [join, ref, topic, event, payload] = JSON.parse(
            String(message),
          );
          const response = {};
          if (event === "phx_join") {
            const bindings = payload.config.postgres_changes.map((b, i) => ({
              ...b,
              id: i + 1,
            }));
            response.postgres_changes = bindings;
            subscription = { join, topic, bindings, ws };
            sockets.add(subscription);
          }
          ws.send(
            JSON.stringify([
              join,
              ref,
              topic,
              "phx_reply",
              { status: "ok", response },
            ]),
          );
        });
        ws.onClose(() => sockets.delete(subscription));
      });
      const page = await ctx.newPage();
      page.setDefaultTimeout(6000);
      await page.goto(origin);
      await expect(page.locator("h1")).toHaveText("Seoul 2027");
      devices.push(page);
    }
    const [a, b] = devices;
    const click = (p, text) =>
      p.getByRole("button", { name: text, exact: true }).first().click();
    const nav = (p, v) =>
      p.locator("#nav").getByRole("button", { name: v, exact: true }).click();
    const save = async (p) => {
      await click(p, "儲存");
      await expect(p.locator("dialog")).not.toBeVisible();
    };
    const sync = async (p) => {
      await click(p, "重新同步");
      await expect(p.locator("#sync")).toContainText("已同步");
    };
    const fill = (p, k, v) => p.locator('dialog [name="' + k + '"]').fill(v);
    await nav(a, "行程");
    await expect(a.locator(".lodging-row")).toHaveText([
      "從家裡出發",
      "開心回家～",
    ]);
    await nav(a, "旅行");
    await click(a, "編輯");
    await fill(a, "hotel", "Sample Hotel");
    await fill(a, "hotelAddress", "Sample Road");
    await save(a);
    await nav(b, "行程");
    await expect(b.locator(".lodging-row")).toHaveCount(10);
    const days = await b.locator(".itinTable tbody").all();
    for (const [index, day] of days.entries()) {
      const first = day.locator("tr").first();
      const last = day.locator("tr").last();
      if (index === 0) {
        await expect(first).toHaveText("從家裡出發");
        await expect(first.getByRole("link")).toHaveCount(0);
      } else await expect(first).toContainText("從住宿出發");
      if (index === days.length - 1) {
        await expect(last).toHaveText("開心回家～");
        await expect(last.getByRole("link")).toHaveCount(0);
      } else {
        await expect(last).toContainText("返回住宿");
        await expect(last.getByRole("link")).toHaveAttribute(
          "href",
          /Sample%20Road/,
        );
      }
    }
    await nav(b, "首頁");
    await nav(a, "首頁");
    await click(a, "填寫去程航班");
    await fill(a, "number", "TEST123");
    await fill(a, "from", "AAA");
    await fill(a, "to", "BBB");
    await fill(a, "depart", "2027-01-21T10:00");
    await save(a);
    await expect(b.locator(".flight-ticket").first()).toContainText("TEST123");
    await expect(b.locator(".flight-ticket").last()).toContainText("填寫航班");
    await expect(a.locator("#page")).toContainText("飯店地址");
    await nav(a, "行程");
    const flightRows = a
      .locator(".itinTable tr")
      .filter({ hasText: "TEST123" });
    await expect(flightRows).toHaveCount(1);
    await expect(flightRows.getByText("編輯航班")).toHaveCount(0);
    await click(a, "編輯行程");
    await flightRows.getByText("編輯航班").click();
    await fill(a, "arrive", "2027-01-21T14:00");
    await save(a);
    await expect(flightRows).toHaveCount(1);
    await expect(flightRows).toContainText("14:00");
    await flightRows.getByText("編輯航班").click();
    await fill(a, "arrive", "2027-01-22T01:30");
    await save(a);
    await expect(flightRows).toHaveCount(2);
    await expect(
      a
        .locator("details")
        .filter({ has: a.locator("summary", { hasText: "2027-01-22" }) }),
    ).toContainText("TEST123 · 抵達");
    await flightRows.first().getByText("編輯航班").click();
    for (const k of ["number", "from", "to", "depart", "arrive"])
      await fill(a, k, "");
    await save(a);
    await expect(flightRows).toHaveCount(0);
    for (const name of ["A景點", "B景點"]) {
      await click(a, "新增行程");
      await fill(a, "name", name);
      await fill(a, "date", "2027-01-22");
      await fill(a, "address", "範例街");
      await save(a);
    }
    await a
      .getByRole("row")
      .filter({ hasText: "A景點" })
      .getByText("移動")
      .click();
    await fill(a, "date", "2027-01-23");
    await fill(a, "time", "11:00");
    await save(a);
    await sync(a);
    await nav(b, "行程");
    await expect(
      b.locator("details").filter({ hasText: "2027-01-23" }),
    ).toContainText("A景點");
    await expect(
      b.locator("details").filter({ hasText: "2027-01-22" }),
    ).toContainText("B景點");
    await click(a, "復原移動");
    await expect(
      a.locator("details").filter({ hasText: "2027-01-22" }),
    ).toContainText("A景點");
    await nav(a, "購物");
    await click(a, "新增購物");
    await fill(a, "name", "測試商品");
    await a
      .locator("[name=album]")
      .setInputFiles(
        new URL("../icon-192.png", import.meta.url).pathname
          .replace(/^\/(\w:)/, "$1")
          .replaceAll("%20", " "),
      );
    await save(a);
    await click(a, "未購買");
    await sync(a);
    await nav(b, "購物");
    await expect(b.getByText("✓ 已購買")).toBeVisible();
    await expect
      .poll(() => b.locator(".thumb").evaluate((x) => x.naturalWidth))
      .toBeGreaterThan(0);
    assert.equal(db.get("expenses").size, 0);
    await a.evaluate(() => navigator.serviceWorker.ready);
    await a.context().setOffline(true);
    await nav(a, "記帳");
    await click(a, "新增記帳");
    await fill(a, "amount", "1000");
    await fill(a, "rate", "0.022");
    await save(a);
    await a.reload();
    await nav(a, "記帳");
    await expect(a.locator("#page")).toContainText("NT$ 22");
    await expect(a.locator("#sync")).toContainText("待同步");
    await a.context().setOffline(false);
    await sync(a);
    await nav(b, "記帳");
    await expect(b.locator(".entry")).toHaveCount(1);
    await expect(b.locator("#page")).toContainText("NT$ 22");
    assert.equal(db.get("expenses").size, 1);
    await a.context().setOffline(true);
    await click(a, "編輯");
    await fill(a, "notes", "離線版本");
    await save(a);
    await click(b, "編輯");
    await fill(b, "notes", "另一台版本");
    await save(b);
    await sync(b);
    await a.context().setOffline(false);
    await expect(a.getByRole("button", { name: /處理衝突/ })).toBeVisible();
    await a.getByRole("button", { name: /處理衝突/ }).click();
    await expect(a.locator("dialog")).toContainText("另一台版本");
    await click(a, "保留此裝置版本");
    await sync(a);
    await sync(b);
    await expect(b.locator(".entry")).toContainText("離線版本");
    const fileEvent = a.waitForEvent("download");
    await click(a, "匯出 JSON");
    const download = await fileEvent;
    const backup = JSON.parse(await readFile(await download.path(), "utf8"));
    assert.equal(backup.expenses.length, 1);
    await nav(a, "行李");
    await click(a, "新增行李");
    await fill(a, "name", "雨傘");
    await save(a);
    await click(a, "未打包");
    await sync(a);
    await nav(a, "收藏");
    await click(a, "新增收藏");
    await fill(a, "name", "範例景點");
    await fill(a, "area", "測試區");
    await save(a);
    await click(a, "加入行程");
    await save(a);
    await expect(a.locator(".entry")).toContainText("已加入行程");
    await nav(a, "匯率");
    await click(a, "手動輸入");
    await fill(a, "rate", "0.02");
    await save(a);
    await a.locator("#foreign").fill("100");
    await expect(a.locator("#twd")).toHaveValue("2");
    await nav(a, "旅行");
    await click(a, "新增旅行");
    await fill(a, "name", "第二趟");
    await fill(a, "destination", "測試");
    await fill(a, "start", "2028-02-01");
    await fill(a, "end", "2028-02-02");
    await save(a);
    await a
      .locator(".entry")
      .filter({ hasText: "第二趟" })
      .getByText("開啟")
      .click();
    await nav(a, "記帳");
    await expect(a.locator(".entry")).toHaveCount(0);
    for (const payload of [
      backup,
      backup,
      {
        rateTwdPerKrw: 0.025,
        expenses: [
          {
            id: "legacy",
            date: "2026-01-21",
            cur: "KRW",
            amt: "2000",
            cat: "餐飲",
            pay: "現金",
            memo: "範例",
          },
        ],
      },
    ]) {
      await click(a, "匯入 JSON");
      await a.locator("dialog input[type=file]").setInputFiles({
        name: "fixture.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(payload)),
      });
      await save(a);
    }
    await expect(a.locator(".entry")).toHaveCount(2);
    await expect(a.locator("#page")).toContainText("NT$ 72");
    await nav(a, "行李");
    a.once("dialog", (d) => d.accept());
    await click(a, "複製前趟項目");
    await expect(a.locator(".entry")).toContainText("雨傘");
    await expect(a.locator(".entry")).toContainText("未打包");
    await a.goto(origin + "/Busan-2026/");
    await expect(a.locator("table.itinTable")).toHaveCount(5);
  } finally {
    await browser?.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});

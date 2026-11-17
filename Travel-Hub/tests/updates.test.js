import test from "node:test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { chromium, expect } from "@playwright/test";

test("new service worker waits for consent and preserves active edits", async () => {
  let version = 1;
  const sw = await readFile(new URL("../sw.js", import.meta.url), "utf8");
  const updates = await readFile(
    new URL("../updates.js", import.meta.url),
    "utf8",
  );
  const server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/sw.js" || req.url === "/updates.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end(
        req.url === "/sw.js" ? sw.replace("v1-31", `test-${version}`) : updates,
      );
    } else {
      res.setHeader("Content-Type", "text/html");
      res.end(
        `<div id="version">${version}</div><input id="draft"><script type="module">import {watchUpdates} from './updates.js'; watchUpdates(() => !!document.querySelector('#draft').value);</script>`,
      );
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const chrome = "C:/Program Files/Google/Chrome/Application/chrome.exe";
  const browser = await chromium.launch(
    existsSync(chrome) ? { executablePath: chrome } : {},
  );
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.locator("#draft").fill("尚未儲存");
    version = 2;
    await page.evaluate(async () =>
      (await navigator.serviceWorker.ready).update(),
    );
    await expect(
      page.getByRole("button", { name: "更新", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "更新", exact: true }).click();
    await expect(page.locator("#draft")).toHaveValue("尚未儲存");
    await expect(page.locator("#version")).toHaveText("1");
    await page.locator("#draft").fill("");
    await page.getByRole("button", { name: "更新", exact: true }).click();
    await expect(page.locator("#version")).toHaveText("2");
    await expect(page.locator(".app-update")).toBeHidden();
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});

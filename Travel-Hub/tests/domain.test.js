import test from "node:test";
import assert from "node:assert/strict";
import { totals, localDate, days, overlaps, safeMap } from "../fields.js";
import { stableId } from "../store.js";
import { comparePacking } from "../fields.js";

test("packing order stays consistent across sync and checked states", () => {
  const items = [
    { id: "d", data: { name: "袋子10", category: "收納" } },
    { id: "c", data: { name: "袋子2", category: "收納" } },
    { id: "a", data: { name: "未分類物品" } },
    { id: "b", data: { name: "袋子2", category: "收納" } },
  ];
  const ids = (rows) =>
    rows
      .toSorted((a, b) => comparePacking(a, b, ["b", "c", "d", "a"]))
      .map((r) => r.id);
  assert.deepEqual(ids(items), ["b", "c", "d", "a"]);
  assert.deepEqual(ids([...items].reverse()), ids(items));
  items[1].data.done = true;
  items[1].stamp = "later-update";
  assert.deepEqual(ids(items), ["b", "c", "d", "a"]);
});
test("目的地日期、重疊時段、匯率與安全導航", async () => {
  assert.equal(
    localDate("Asia/Seoul", new Date("2027-01-20T15:00:00Z")),
    "2027-01-21",
  );
  assert.equal(days("2027-01-21", "2027-01-25"), 4);
  assert.equal(
    overlaps(
      { date: "d", time: "10:30" },
      { date: "d", time: "10:00", endTime: "11:00" },
    ),
    true,
  );
  assert.deepEqual(
    totals([
      { data: { amount: 1000, currency: "KRW", rate: 0.023 } },
      { data: { amount: 50, currency: "TWD", rate: 0.025 } },
    ]),
    { twd: 73, foreign: 3000 },
  );
  assert.equal(safeMap("javascript:alert(1)"), "");
  assert.equal(await stableId("a"), await stableId("a"));
});

test("hotel cards preserve manual lines and separate existing English/Korean text", async () => {
  const { hotelLines } = await import("../fields.js");
  assert.equal(hotelLines("Sample House 호텔"), "Sample House\n호텔");
  assert.equal(hotelLines("156, Road 1 서울 156"), "156, Road 1\n서울 156");
  assert.equal(hotelLines("Sample\nHouse 호텔"), "Sample\nHouse 호텔");
  assert.equal(hotelLines("서울 156"), "서울 156");
});

test("preparation stages use destination dates and keep earlier unfinished tasks", async () => {
  const { currentStage, duePreparation } = await import("../preparation.js");
  const trip = {
    start: "2027-01-21",
    timezone: "Asia/Seoul",
    preparation: [
      { id: "earlier", stage: "early", done: false },
      { id: "completed", stage: "early", done: true },
      { id: "later", stage: "week", done: false },
    ],
  };
  for (const [date, index] of [
    ["2026-12-21", 0],
    ["2026-12-22", 1],
    ["2027-01-14", 2],
    ["2027-01-20", 3],
  ]) {
    assert.equal(currentStage(trip, new Date(date + "T00:00:00+09:00")), index);
  }
  assert.deepEqual(
    duePreparation(trip, new Date("2027-01-01T00:00:00+09:00")).map(
      (task) => task.id,
    ),
    ["earlier"],
  );
  assert.equal(currentStage(trip, new Date("2027-01-19T15:00:00Z")), 3);
});

test("legacy packing types keep their category under the new labels", async () => {
  const { packingBag } = await import("../fields.js");
  assert.equal(packingBag("隨身"), "隨身行李");
  assert.equal(packingBag("托運"), "托運行李");
  assert.equal(packingBag("隨身行李"), "隨身行李");
});

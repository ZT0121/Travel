import test from "node:test";
import assert from "node:assert/strict";
import { totals, localDate, days, overlaps, safeMap } from "../fields.js";
import { stableId } from "../store.js";
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

export const labels = {
  home: "首頁",
  itinerary_items: "行程",
  saved_places: "收藏",
  shopping_items: "購物",
  expenses: "記帳",
  packing_items: "行李",
  fx: "匯率",
  trips: "旅行",
};
export const people = ["我", "先生", "Hunter", "Angus", "共用"];
export const categories = ["餐飲", "交通", "住宿", "購物", "娛樂", "其他"];
// Field definitions also drive native mobile date, camera and time controls.
export function fields(table, currency) {
  const name = ["name", "名稱", "text", true],
    date = ["date", "日期", "date", true],
    notes = ["notes", "備註", "textarea"];
  const address = ["address", "地址"],
    map = ["map", "導航連結", "url"];
  return {
    trips: [
      name,
      ["destination", "目的地", "text", true],
      ["timezone", "目的地時區", "text", true],
      ["start", "出發日期", "date", true],
      ["end", "回程日期", "date", true],
      ["currency", "目的地幣別", "text", true],
      ["hotel", "住宿摘要"],
      ["transport", "交通摘要"],
    ],
    itinerary_items: [
      date,
      ["time", "開始時間", "time"],
      ["endTime", "結束時間", "time"],
      name,
      ["place", "地點"],
      address,
      ["transport", "交通"],
      notes,
      map,
      ["order", "排列順序", "number"],
      ["status", "安排", ["正式", "候選"]],
    ],
    saved_places: [
      name,
      ["category", "分類", ["餐飲", "景點", "購物", "其他"]],
      ["area", "地區"],
      address,
      map,
      notes,
      ["priority", "優先程度", ["一般", "高", "低"]],
    ],
    shopping_items: [
      name,
      ["category", "分類"],
      ["qty", "數量", "number", true],
      ["shop", "目標店家"],
      ["price", "預估價格", "number"],
      notes,
    ],
    expenses: [
      date,
      ["time", "時間", "time"],
      ["amount", "金額", "number", true],
      ["currency", "幣別", [...new Set([currency, "TWD"])]],
      ["category", "分類", categories],
      ["pay", "付款方式", ["現金", "信用卡", "交通卡", "其他"]],
      ["person", "記帳人", people.slice(0, 2)],
      ["rate", "記錄匯率（1 目的地幣值多少台幣）", "number", true],
      notes,
    ],
    packing_items: [
      name,
      ["person", "人員", people],
      ["bag", "行李類型", ["隨身", "托運"]],
      ["category", "分類"],
      notes,
    ],
  }[table];
}
export function localDate(zone, now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export const days = (a, b) =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
export function totals(rows) {
  return rows.reduce(
    (sum, { data: d }) => {
      const a = Number(d.amount),
        r = Number(d.rate);
      sum.twd += d.currency === "TWD" ? a : a * r;
      sum.foreign += d.currency === "TWD" ? a / r : a;
      return sum;
    },
    { twd: 0, foreign: 0 },
  );
}
export function safeMap(s) {
  try {
    const url = new URL(s);
    return ["https:", "http:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}
export function overlaps(a, b) {
  return (
    a.date === b.date &&
    a.time &&
    b.time &&
    (a.time === b.time ||
      (a.time < (b.endTime || b.time) && b.time < (a.endTime || a.time)))
  );
}

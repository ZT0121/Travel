import { createClient } from "./supabase.js";
import { openStore, uid, stableId, tables } from "./store.js";
import {
  fields,
  labels,
  people,
  localDate,
  days,
  totals,
  safeMap,
  overlaps,
} from "./fields.js";
const $ = (s) => document.querySelector(s),
  dlg = $("#dialog");
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const btn = (caption, action, id = "", cls = "") =>
  `<button type="button" class="${cls}" data-act="${action}" data-id="${esc(id)}">${esc(caption)}</button>`;
const sel = (key, choices, value, all = "") =>
  `<select aria-label="${esc(all || key)}" data-filter="${key}">${(all ? ["", ...choices] : choices).map((v) => `<option value="${esc(v)}" ${value === v ? "selected" : ""}>${esc(v || all)}</option>`).join("")}</select>`;
let cfg = JSON.parse(localStorage.getItem("hub-project") || "null") ?? {
    url: "https://wxleinjxefdtctqxvvfg.supabase.co",
    publicKey: "sb_publishable_2-OgtNn0xJiKOkAM85G3lw_xtvg9pWJ",
  },
  client,
  store,
  rows = [],
  trip,
  view = "home",
  filter = {},
  editMode = false,
  undo = null,
  refreshCount = 0;
let channel, timer;
const photoUrls = new Map();
const message = (s) => {
  const el = dlg.open ? dlg.querySelector("[role=status]") : $("#toast");
  if (el) {
    el.textContent = s;
    clearTimeout(timer);
    timer = setTimeout(() => (el.textContent = ""), 6500);
  }
};
const key = (k) => "hub:" + cfg.url + ":" + store.userId + ":" + k;
function modal(title, html, submit) {
  if (dlg.open) dlg.close();
  dlg.innerHTML =
    "<form><h2>" +
    esc(title) +
    "</h2>" +
    html +
    '<p role="status"></p><div class="tools">' +
    (submit ? '<button class="primary">儲存</button>' : "") +
    btn("關閉", "close") +
    "</div></form>";
  dlg.showModal();
  dlg.querySelector("form").onsubmit = async (e) => {
    e.preventDefault();
    const b = e.submitter;
    if (b) b.disabled = true;
    try {
      await submit(new FormData(e.target));
      dlg.close();
    } catch (err) {
      message(err.message);
    } finally {
      if (b) b.disabled = false;
    }
  };
}
function inputs(defs, values) {
  return defs
    .map(([k, label, type = "text", req]) => {
      let v = values[k] ?? "",
        attrs = `name="${k}" ${req ? "required" : ""}`;
      let field = Array.isArray(type)
        ? `<select ${attrs}>${[...new Set([...type, ...(v ? [v] : [])])].map((x) => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`
        : type === "textarea"
          ? `<textarea ${attrs}>${esc(v)}</textarea>`
          : `<input ${attrs} type="${type}" value="${esc(v)}" ${type === "number" ? 'step="any"' : ""}>`;
      return "<label>" + esc(label) + field + "</label>";
    })
    .join("");
}
function setup() {
  $("#top").innerHTML = "";
  $("#page").innerHTML =
    '<div class="card"><h2>' +
    (cfg ? "個人帳號登入" : "連接旅行資料庫") +
    "</h2>" +
    btn(cfg ? "登入" : "設定 Supabase", "account") +
    "</div>";
}
function account() {
  if (store) {
    modal(
      "個人帳號",
      "<p>此裝置的預設記帳人：" +
        esc(localStorage.getItem(key("person")) || "我") +
        "</p>" +
        btn("登出", "logout"),
    );
    return;
  }
  if (!cfg) {
    modal(
      "連接 Supabase",
      inputs(
        [
          ["url", "專案 URL", "url", true],
          ["publicKey", "Publishable key", "text", true],
        ],
        {},
      ),
      async (f) => {
        const url = new URL(f.get("url"));
        if (
          url.protocol !== "https:" &&
          !["localhost", "127.0.0.1"].includes(url.hostname)
        )
          throw Error("需要 HTTPS 專案網址");
        const publicKey = f.get("publicKey").trim();
        if (!/^sb_publishable_[\w-]+$/.test(publicKey))
          throw Error("請使用 sb_publishable_ 開頭的公開金鑰");
        localStorage.setItem(
          "hub-project",
          JSON.stringify({ url: url.origin, publicKey }),
        );
        location.reload();
      },
    );
    return;
  }
  modal(
    "登入個人帳號",
    inputs(
      [
        ["email", "電子郵件", "email", true],
        ["password", "密碼", "password", true],
      ],
      {},
    ) + btn("更換專案", "reset"),
    async (f) => {
      const { data, error } = await client.auth.signInWithPassword(
        Object.fromEntries(f),
      );
      if (error) throw error;
      await enter(data.user.id);
    },
  );
}
async function enter(userId) {
  if (store) return;
  const cacheKey = "hub-family:" + cfg.url + ":" + userId;
  let owner = localStorage.getItem(cacheKey);
  if (navigator.onLine) {
    const { data, error } = await client.rpc("hub_household_id");
    if (error) throw error;
    if (!data) {
      localStorage.removeItem(cacheKey);
      throw Error("此帳號尚未加入家庭，請聯絡專案管理者。");
    }
    owner = data;
    localStorage.setItem(cacheKey, owner);
  }
  if (!owner) throw Error("首次登入需要網路連線。");
  store = await openStore(cfg.url, owner, client, userId);
  localStorage.setItem("hub-last-owner", userId);
  const id = await stableId(owner + ":Seoul2027");
  store.onchange = () => refresh().catch((e) => message(e.message));
  if (!(await store.all()).length) {
    await store.sync();
    if (!(await store.all()).length)
      await store.save("trips", id, null, {
        name: "Seoul 2027",
        destination: "首爾",
        timezone: "Asia/Seoul",
        start: "2027-01-21",
        end: "2027-01-25",
        currency: "KRW",
      });
  }
  await refresh();
  channel = client.channel("household");
  for (const table of tables)
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: "owner_id=eq." + owner },
      () => store.sync(),
    );
  channel.subscribe((status) => {
    if (status === "SUBSCRIBED") store.sync();
  });
  setInterval(() => store.sync(), 45000);
  window.addEventListener("online", () => store.sync());
  window.addEventListener("offline", refresh);
}
const live = (table) =>
  rows.filter(
    (r) =>
      r.table === table &&
      !r.deleted &&
      (table === "trips" || r.trip === trip?.id),
  );
const find = (id) => rows.find((r) => r.id === id);
const fmt = (n) =>
  Number(n).toLocaleString("zh-TW", { maximumFractionDigits: 2 });
const amountText = (rs) => {
  const sum = totals(rs);
  return (
    esc(trip.data.currency) + " " + fmt(sum.foreign) + " ／ NT$ " + fmt(sum.twd)
  );
};
const mapLink = (d) => {
  const url =
    safeMap(d.map) ||
    (d.address || d.place
      ? "https://www.google.com/maps/search/?api=1&query=" +
        encodeURIComponent(d.address || d.place)
      : "");
  return url
    ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">導航 ↗</a>`
    : "";
};
const empty = '<p class="card muted">目前沒有符合的項目。</p>';
const dayDate = (start, n) =>
  new Date(Date.parse(start) + n * 86400000).toISOString().slice(0, 10);
async function refresh() {
  const n = ++refreshCount;
  const snapshot = await store.all();
  if (n !== refreshCount) return;
  rows = snapshot;
  const trips = live("trips");
  trip =
    trips.find((r) => r.id === localStorage.getItem(key("trip"))) ||
    trips.find((r) => !r.data.archived) ||
    trips[0];
  $("#top").innerHTML = trip
    ? '<div class="row"><strong>目前旅行</strong>' +
      sel(
        "trip",
        trips.map((r) => r.id),
        trip.id,
      ) +
      "</div>"
    : "";
  $("#top select")
    ?.querySelectorAll("option")
    .forEach(
      (o) =>
        (o.textContent =
          find(o.value).data.name +
          (find(o.value).data.archived ? "（已封存）" : "")),
    );
  $("#nav").innerHTML = Object.entries(labels)
    .map(([k, v]) => btn(v, "nav", k, k === view ? "active" : ""))
    .join("");
  render();
  const pending = rows.filter((r) => r.dirty),
    conflicts = pending.filter((r) => r.conflict);
  $("#sync").innerHTML =
    esc(
      (!navigator.onLine ? "離線 · " : "") +
        (store.error || conflicts.length
          ? "同步失敗"
          : pending.length
            ? "待同步 " + pending.length + " 筆"
            : "已同步"),
    ) +
    " " +
    esc(store.error) +
    " " +
    btn("重新同步", "retry") +
    conflicts
      .map((r) =>
        btn("處理衝突 · " + (r.data.name || r.data.date), "conflict", r.id),
      )
      .join("");
}
function packingProgress(done, total) {
  return `<progress class="packing-progress" aria-label="打包進度" value="${done}" max="${Math.max(total, 1)}"></progress>`;
}
const flightLegs = { outbound: "去程", inbound: "回程" };
const flightFields = [
  ["number", "航班號碼"],
  ["from", "出發機場"],
  ["depart", "起飛（當地日期與時間）", "datetime-local"],
  ["to", "抵達機場"],
  ["arrive", "抵達（當地日期與時間）", "datetime-local"],
];
function flightTickets(data) {
  const tickets = Object.entries(flightLegs).map(([leg, label]) => {
    const flight = data.flights?.[leg] || {};
    const filled = Object.values(flight).some(Boolean);
    const stop = (airport, time) =>
      `<span class="flight-stop"><strong>${esc(airport || "—")}</strong><small>${esc((time || "").replace("T", " "))}</small></span>`;
    const route = filled
      ? `<span class="flight-route">${stop(flight.from, flight.depart)}<span aria-hidden="true">→</span>${stop(flight.to, flight.arrive)}</span>`
      : "<span>＋ 填寫航班</span>";
    return `<button type="button" class="flight-ticket" data-act="flight" data-id="${leg}" aria-label="${filled ? "編輯" : "填寫"}${label}航班"><span class="ticket-stub"><span aria-hidden="true">✈︎</span>${label}</span><span class="ticket-body">${filled ? `<b>${esc(flight.number || label + "航班")}</b>` : ""}${route}</span></button>`;
  });
  return (
    '<section aria-label="航班資訊"><h2>航班資訊</h2><div class="flight-grid">' +
    tickets.join("") +
    "</div></section>"
  );
}
function editFlight(leg) {
  const target = trip;
  modal(
    flightLegs[leg] + "航班",
    inputs(flightFields, target.data.flights?.[leg] || {}),
    async (form) => {
      const flights = { ...target.data.flights };
      const values = Object.fromEntries(
        flightFields.map(([key]) => [key, String(form.get(key) || "").trim()]),
      );
      if (Object.values(values).some(Boolean)) flights[leg] = values;
      else delete flights[leg];
      await store.save(
        "trips",
        target.id,
        null,
        { ...target.data, flights },
        false,
        target.stamp,
      );
    },
  );
}
function home() {
  const d = trip.data,
    today = localDate(d.timezone),
    before = today < d.start,
    after = today > d.end;
  const pack = live("packing_items"),
    done = pack.filter((r) => r.data.done).length,
    agenda = live("itinerary_items")
      .filter((r) => r.data.date === today)
      .sort(byTime);
  const title = before
    ? "距離出發 " + days(today, d.start) + " 天"
    : after
      ? "旅程回顧"
      : "Day " + (days(d.start, today) + 1) + " ｜ " + today;
  const tiles = before
    ? [
        ["住宿", d.hotel || "尚未填寫"],
        ["飯店地址", d.hotelAddress || "尚未填寫"],
        ["打包進度", done + " / " + pack.length],
      ]
    : after
      ? [
          ["旅程天數", days(d.start, d.end) + 1 + " 天"],
          ["總花費", amountText(live("expenses"))],
          [
            "已購買",
            live("shopping_items")
              .filter((r) => r.data.done)
              .map((r) => r.data.name)
              .join("、") || "尚無",
          ],
        ]
      : [
          [
            "今日行程",
            agenda
              .map((r) => [r.data.time, r.data.name].join(" "))
              .join(" ／ ") || "尚無安排",
          ],
        ];
  return (
    '<div class="card trip-cover"><small>' +
    esc(title) +
    "</small><h1>" +
    esc(d.name) +
    "</h1><p>" +
    esc(d.destination) +
    " · " +
    esc(d.start) +
    " — " +
    esc(d.end) +
    '</p></div><div class="grid">' +
    tiles
      .map(
        ([k, v]) =>
          '<div class="card"><small>' +
          k +
          "</small><h3>" +
          esc(v) +
          "</h3>" +
          (k === "打包進度" ? packingProgress(done, pack.length) : "") +
          "</div>",
      )
      .join("") +
    "</div>" +
    flightTickets(d) +
    '<div class="tools">' +
    btn("完整行程", "nav", "itinerary_items") +
    btn("快速記帳", "expense") +
    btn("購物清單", "nav", "shopping_items") +
    btn("行李清單", "nav", "packing_items") +
    (after ? btn("歷史旅行", "nav", "trips") : "") +
    "</div>" +
    (!before && !after
      ? agenda
          .map((r) => mapLink(r.data))
          .filter(Boolean)
          .join(" · ")
      : "") +
    (after ? stats(live("expenses")) : "")
  );
}
const byTime = (a, b) =>
  (a.data.time || "24").localeCompare(b.data.time || "24") ||
  Number(a.data.order || 0) - Number(b.data.order || 0);
function itinerary() {
  const items = live(view),
    d = trip.data,
    dates = new Set(items.map((r) => r.data.date));
  for (let i = 0; i <= days(d.start, d.end); i++)
    dates.add(dayDate(d.start, i));
  return (
    '<div class="tools">' +
    btn(editMode ? "完成編輯" : "編輯行程", "mode") +
    (editMode ? btn("新增行程", "add") + btn("匯入釜山 HTML", "html") : "") +
    (undo && undo.trip === trip.id ? btn("復原移動", "undo") : "") +
    "</div>" +
    [...dates]
      .sort()
      .map(
        (date) =>
          "<details open><summary>Day " +
          (days(d.start, date) + 1) +
          " ｜ " +
          esc(date) +
          '</summary><div class="table"><table class="itinTable"><thead><tr><th>時間</th><th>行程</th><th>交通</th><th>備註</th></tr></thead><tbody>' +
          (items
            .filter((r) => r.data.date === date)
            .sort(byTime)
            .map((r) => {
              const x = r.data;
              return (
                "<tr><td>" +
                esc([x.time, x.endTime].filter(Boolean).join("–")) +
                "</td><td><b>" +
                esc(x.name) +
                "</b> " +
                (x.status === "候選" ? "候選" : "") +
                "<br>" +
                esc([x.place, x.address].filter(Boolean).join(" · ")) +
                " " +
                mapLink(x) +
                "</td><td>" +
                esc(x.transport) +
                "</td><td>" +
                esc(x.notes) +
                "<div>" +
                btn("移動", "move", r.id) +
                (editMode ? controls(r) : "") +
                "</div></td></tr>"
              );
            })
            .join("") || '<tr><td colspan="4">尚無行程</td></tr>') +
          "</tbody></table></div></details>",
      )
      .join("")
  );
}
const controls = (r) => btn("編輯", "edit", r.id) + btn("刪除", "del", r.id);
function stats(rs) {
  const cats = [...new Set(rs.map((r) => r.data.category))];
  return cats.length
    ? '<div class="card"><h3>分類統計</h3>' +
        cats
          .map(
            (c) =>
              "<p>" +
              esc(c) +
              " · " +
              amountText(rs.filter((r) => r.data.category === c)) +
              "</p>",
          )
          .join("") +
        "</div>"
    : "";
}
function list() {
  const source = live(view);
  let result = source,
    tools = btn("新增" + labels[view], "add"),
    extra = "";
  const choices = (k) => [
    ...new Set(source.map((r) => r.data[k]).filter(Boolean)),
  ];
  const dropdown = (k, title, opts) => {
    tools += sel(k, opts || choices(k), filter[k], title);
    if (filter[k]) result = result.filter((r) => r.data[k] === filter[k]);
  };
  if (view === "packing_items") {
    dropdown("person", "全部", people);
    dropdown("bag", "全部行李類型", ["隨身", "托運"]);
    tools += btn("複製前趟項目", "copy");
    const done = source.filter((r) => r.data.done).length;
    extra =
      '<div class="card"><p>已打包 ' +
      done +
      " / " +
      source.length +
      "</p>" +
      packingProgress(done, source.length) +
      "</div>";
  }
  if (view === "saved_places") {
    dropdown("category", "全部分類");
    dropdown("area", "全部地區");
  }
  if (view === "shopping_items") {
    tools += sel("done", ["未購買", "已購買"], filter.done, "全部狀態");
    if (filter.done)
      result = result.filter(
        (r) => !!r.data.done === (filter.done === "已購買"),
      );
  }
  if (view === "expenses") {
    dropdown("category", "全部分類");
    dropdown("person", "全部記帳人");
    dropdown("pay", "全部付款方式");
    tools +=
      '<input type="search" id="search" placeholder="搜尋記帳" value="' +
      esc(filter.q) +
      '">' +
      btn("匯出 JSON", "export") +
      btn("匯入 JSON", "import");
    if (filter.q)
      result = result.filter((r) =>
        Object.values(r.data)
          .join(" ")
          .toLowerCase()
          .includes(filter.q.toLowerCase()),
      );
    result = result.toSorted((a, b) =>
      (b.data.date + b.data.time).localeCompare(a.data.date + a.data.time),
    );
    extra =
      '<div class="card"><small>整趟總支出</small><h3>' +
      amountText(source) +
      "</h3><p>篩選小計 · " +
      amountText(result) +
      "</p></div>" +
      stats(result);
  }
  return (
    '<div class="tools">' +
    tools +
    "</div>" +
    extra +
    (result
      .map((r) => {
        const d = r.data;
        let actions = "",
          other = "",
          title = d.name,
          sub = "";
        if (view === "trips") {
          sub = [d.destination, d.start, d.end, d.archived ? "已封存" : ""]
            .filter(Boolean)
            .join(" · ");
          actions =
            btn("開啟", "choose", r.id) +
            btn(d.archived ? "取消封存" : "封存", "archive", r.id);
        }
        if (view === "saved_places") {
          sub = [
            d.category,
            d.area,
            d.address,
            d.priority,
            live("itinerary_items").some((i) => i.data.savedId === r.id)
              ? "已加入行程"
              : "尚未加入",
          ]
            .filter(Boolean)
            .join(" · ");
          actions = mapLink(d) + btn("加入行程", "schedule", r.id);
        }
        if (view === "expenses") {
          title = d.currency + " " + fmt(d.amount);
          sub = [d.date, d.time, d.category, d.pay, d.person, "匯率 " + d.rate]
            .filter(Boolean)
            .join(" · ");
        }
        if (["shopping_items", "packing_items"].includes(view)) {
          const shop = view === "shopping_items";
          actions = btn(
            d.done
              ? shop
                ? "✓ 已購買"
                : "✓ 已打包"
              : shop
                ? "未購買"
                : "未打包",
            "toggle",
            r.id,
          );
          sub = (
            shop
              ? [
                  "× " + d.qty,
                  d.category,
                  d.shop,
                  d.price ? "預估 " + d.price : "",
                ]
              : [d.person, d.bag, d.category]
          )
            .filter(Boolean)
            .join(" · ");
          if (shop && d.image)
            other =
              '<img class="thumb" tabindex="0" alt="商品圖片" data-act="zoom" data-id="' +
              esc(r.id) +
              '">';
        }
        return (
          '<article class="entry">' +
          other +
          "<div><strong>" +
          esc(title) +
          "</strong><p>" +
          esc(sub) +
          "</p><p>" +
          esc(d.notes) +
          '</p></div><div class="tools">' +
          actions +
          controls(r) +
          "</div></article>"
        );
      })
      .join("") || empty)
  );
}
function fx() {
  const d = trip.data;
  return (
    '<div class="card"><h3>1 ' +
    esc(d.currency) +
    " = " +
    esc(d.rate || "—") +
    " TWD</h3><p>" +
    esc(d.rateSource || "尚未取得匯率") +
    " " +
    esc(d.rateAt || "") +
    "</p>" +
    btn("更新參考匯率", "rate") +
    btn("手動輸入", "manual") +
    "<label>" +
    esc(d.currency) +
    '<input id="foreign" type="number" step="any" value="' +
    esc(filter.foreign ?? "") +
    '"></label><label>TWD<input id="twd" type="number" step="any" value="' +
    esc(filter.twd ?? "") +
    '"></label><small>市場參考匯率與刷卡、現金實際成交匯率可能不同。 <a href="https://www.exchangerate-api.com" target="_blank" rel="noopener noreferrer">Rates by ExchangeRate-API</a></small></div>'
  );
}
function render() {
  $("#page").innerHTML =
    !trip && view !== "trips"
      ? btn("新增旅行", "newTrip")
      : view === "home"
        ? home()
        : "<h2>" +
          labels[view] +
          "</h2>" +
          (view === "itinerary_items"
            ? itinerary()
            : view === "fx"
              ? fx()
              : list());
  for (const img of document.querySelectorAll(".thumb"))
    loadPhoto(find(img.dataset.id).data.image)
      .then((url) => {
        img.src = url;
      })
      .catch(() => {
        img.alt = "圖片待下載";
      });
}
async function loadPhoto(path) {
  if (photoUrls.has(path)) return photoUrls.get(path);
  let img = await store.read("images", path);
  if (!img) {
    const { data, error } = await client.storage
      .from("travel-shopping")
      .download(path);
    if (error) throw error;
    img = { id: path, blob: data, uploaded: true };
    await store.write("images", img);
  }
  const url = URL.createObjectURL(img.blob);
  photoUrls.set(path, url);
  return url;
}
async function photo(file, tripId) {
  const bmp = await createImageBitmap(file),
    ratio = Math.min(1, 1280 / Math.max(bmp.width, bmp.height)),
    canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * ratio));
  canvas.height = Math.max(1, Math.round(bmp.height * ratio));
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise((res) =>
    canvas.toBlob(res, "image/jpeg", 0.78),
  );
  if (!blob || blob.size > 2097152) throw Error("無法壓縮圖片");
  const path = store.owner + "/" + tripId + "/" + uid() + ".jpg";
  await store.write("images", { id: path, blob, uploaded: false });
  return path;
}
function editor(table, r = null, initial = {}, mode = "") {
  const target = trip?.id,
    tripData = trip?.data || {},
    currency = tripData.currency || "KRW";
  const today = localDate(tripData.timezone || "Asia/Seoul");
  const values = {
    date: table === "itinerary_items" ? tripData.start : today,
    time:
      table === "expenses"
        ? new Intl.DateTimeFormat("en-GB", {
            timeZone: tripData.timezone,
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date())
        : "",
    qty: 1,
    rate: tripData.rate,
    person: localStorage.getItem(key("person")) || "我",
    timezone: "Asia/Seoul",
    currency,
    ...r?.data,
    ...initial,
  };
  let defs = fields(table, currency);
  if (table === "trips" && r?.data.transport)
    defs.push(["transport", "交通摘要（原有資料）"]);
  if (mode === "move")
    defs = defs.filter(([k]) => ["date", "time", "endTime"].includes(k));
  const photos =
    table === "shopping_items"
      ? '<label>相簿<input type="file" name="album" accept="image/*"></label><label>相機<input type="file" name="camera" accept="image/*" capture="environment"></label>' +
        (values.image
          ? '<label><input type="checkbox" name="remove">移除圖片</label>'
          : "")
      : "";
  modal(
    (mode === "move" ? "移動" : r ? "編輯" : "新增") + labels[table],
    inputs(defs, values) + photos,
    async (f) => {
      const d = { ...r?.data, ...initial };
      for (const [k] of defs) d[k] = String(f.get(k) || "").trim();
      if (table === "trips") {
        if (d.end < d.start) throw Error("回程日期必須在出發之後或同日");
        localDate(d.timezone);
        d.currency = d.currency.toUpperCase();
        if (!/^[A-Z]{3}$/.test(d.currency)) throw Error("請輸入三碼幣別");
        if (
          r &&
          r.data.currency !== d.currency &&
          rows.some(
            (x) => x.table === "expenses" && x.trip === r.id && !x.deleted,
          )
        )
          throw Error("已有記帳，請保留原目的地幣別");
      }
      if (table === "trips" && r && d.currency !== r.data.currency) {
        delete d.rate;
        delete d.rateSource;
        delete d.rateAt;
      }
      if (
        table === "expenses" &&
        (!(Number(d.amount) > 0) || !(Number(d.rate) > 0))
      )
        throw Error("金額及記錄匯率須大於零");
      if (table === "shopping_items") {
        if (!Number.isInteger(+d.qty) || +d.qty < 1 || Number(d.price) < 0)
          throw Error("請檢查數量與價格");
        const file = [f.get("camera"), f.get("album")].find((x) => x?.size);
        if (file) d.image = await photo(file, target);
        else if (f.has("remove")) delete d.image;
      }
      if (table === "itinerary_items") {
        if (d.date < tripData.start || d.date > tripData.end)
          throw Error("請選擇旅程內日期");
        if (d.endTime && d.endTime <= d.time)
          throw Error("結束時間必須晚於開始時間");
      }
      const conflict =
        table === "itinerary_items" &&
        live(table).some((x) => x.id !== r?.id && overlaps(x.data, d));
      const id = r?.id || uid();
      const stamp = await store.save(
        table,
        id,
        table === "trips" ? null : target,
        d,
        false,
        r?.stamp,
      );
      if (mode === "move") {
        undo = { ...r, stamp };
        await refresh();
      }
      if (table === "expenses") localStorage.setItem(key("person"), d.person);
      if (conflict)
        setTimeout(() => message("已儲存，此時段與其他行程重疊。"), 0);
    },
  );
}

function go(page) {
  view = page;
  filter = {};
  editMode = false;
  render();
  refresh();
}
function choose(id) {
  localStorage.setItem(key("trip"), id);
  undo = null;
  go("home");
}
function fileForm(title, accept, callback, extra = "") {
  modal(
    title,
    '<label>選擇檔案<input required type="file" name="file" accept="' +
      accept +
      '"></label>' +
      extra,
    async (f) => callback(await f.get("file").text(), f),
  );
}
async function importExpenses(raw, f) {
  const obj = JSON.parse(raw),
    target = trip.id,
    currency = trip.data.currency;
  if (!Array.isArray(obj.expenses)) throw Error("缺少 expenses 清單");
  const records = [];
  for (const item of obj.expenses) {
    const d = item.data
      ? { ...item.data }
      : {
          date: item.date,
          time: "",
          amount: item.amt,
          currency: item.cur,
          category: item.cat,
          pay: item.pay,
          notes: item.memo,
          person: "",
          rate: obj.rateTwdPerKrw || f.get("fallback"),
        };
    if (
      (item.data && obj.currency !== currency) ||
      (!item.data && currency !== "KRW")
    )
      throw Error("備份與旅行目的地幣別不同");
    if (
      !item.id ||
      !/^\d{4}-\d{2}-\d{2}$/.test(d.date) ||
      !Number.isFinite(+d.amount) ||
      +d.amount <= 0 ||
      !Number.isFinite(+d.rate) ||
      +d.rate <= 0 ||
      ![currency, "TWD"].includes(d.currency)
    )
      throw Error("記帳格式或匯率有誤");
    const id = await stableId(
      target + ":expense:" + (item.sourceId || item.id),
    );
    records.push({ id, data: { ...d, sourceId: item.sourceId || item.id } });
  }
  for (const r of records) {
    const existing = await store.read("rows", r.id);
    if (
      (existing && !existing.deleted) ||
      live("expenses").some((x) => x.id === r.data.sourceId)
    )
      continue;
    await store.save("expenses", r.id, target, r.data, false, existing?.stamp);
  }
}
async function importHtml(raw) {
  const doc = new DOMParser().parseFromString(raw, "text/html"),
    records = [];
  for (const table of doc.querySelectorAll("table.itinTable")) {
    const day = table
      .closest("details")
      ?.querySelector("summary")
      ?.textContent.match(/Day\s*(\d+)/i);
    if (!day) continue;
    const date = dayDate(trip.data.start, +day[1] - 1);
    if (date > trip.data.end) throw Error("目標旅行天數不足");
    for (const tr of table.querySelectorAll("tbody tr")) {
      const cells = [...tr.cells].map((c) => c.textContent.trim());
      if (!cells[1]) continue;
      const times = cells[0].match(/\d{2}:\d{2}/g) || [];
      records.push({
        date,
        time: times[0] || "",
        endTime: times[1] || "",
        name: cells[1],
        transport: cells[2],
        notes: cells[3],
        status: "正式",
        order: records.length,
        map: safeMap(tr.querySelector("a")?.getAttribute("href")),
      });
    }
  }
  if (!records.length) throw Error("找不到釜山每日行程表");
  for (const data of records) {
    const id = await stableId(trip.id + JSON.stringify(data));
    if (!(await store.read("rows", id)))
      await store.save("itinerary_items", id, trip.id, data);
  }
}
async function action(a, id) {
  const r = find(id),
    d = r?.data;
  if (a === "account") return account();
  if (a === "close") return dlg.close();
  if (a === "reset") {
    localStorage.setItem("hub-project", "false");
    location.reload();
    return;
  }
  if (a === "logout") {
    if (
      rows.some((x) => x.dirty) &&
      !confirm("尚有待同步資料，重新登入同一帳號後可繼續同步。確定登出？")
    )
      return;
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw error;
    localStorage.removeItem("hub-last-owner");
    location.reload();
    return;
  }
  if (a === "flight" && Object.hasOwn(flightLegs, id)) return editFlight(id);
  if (a === "nav") return go(id);
  if (a === "choose") return choose(id);
  if (a === "mode") {
    editMode = !editMode;
    render();
    return;
  }
  if (a === "retry") return store.sync();
  if (a === "add" || a === "newTrip" || a === "expense")
    return editor(
      a === "newTrip" ? "trips" : a === "expense" ? "expenses" : view,
    );
  if (a === "edit" || a === "move") return editor(r.table, r, {}, a);
  if (a === "schedule")
    return editor("itinerary_items", null, {
      savedId: id,
      name: d.name,
      place: d.name,
      address: d.address,
      notes: d.notes,
      map: d.map,
    });
  if (a === "undo") {
    await store.save(
      undo.table,
      undo.id,
      undo.trip,
      undo.data,
      false,
      undo.stamp,
    );
    undo = null;
    return refresh();
  }
  if (a === "archive" || a === "toggle")
    return store.save(
      r.table,
      id,
      r.trip,
      a === "archive"
        ? { ...d, archived: !d.archived }
        : { ...d, done: !d.done },
      false,
      r.stamp,
    );
  if (a === "del") {
    if (!confirm("確定刪除「" + (d.name || d.date) + "」？")) return;
    if (r.table === "trips" && !confirm("再次確認刪除整趟旅行及其清單？"))
      return;
    return store.save(r.table, id, r.trip, d, true, r.stamp);
  }
  if (a === "copy") {
    const prev = live("trips")
      .filter((x) => x.data.start < trip.data.start)
      .sort((a, b) => b.data.start.localeCompare(a.data.start))[0];
    if (!prev) throw Error("沒有較早的旅行可供複製");
    const items = rows.filter(
      (x) => x.table === "packing_items" && x.trip === prev.id && !x.deleted,
    );
    if (!items.length) throw Error("前一趟旅行沒有行李項目");
    if (!confirm("從 " + prev.data.name + " 複製 " + items.length + " 項？"))
      return;
    for (const x of items) {
      const newId = await stableId(trip.id + x.id);
      if (!(await store.read("rows", newId)))
        await store.save("packing_items", newId, trip.id, {
          ...x.data,
          done: false,
        });
    }
    return;
  }
  if (a === "zoom") {
    const url = await loadPhoto(d.image);
    return modal(d.name, '<img alt="商品大圖" src="' + esc(url) + '">');
  }
  if (a === "conflict") {
    const display = (x) => "<pre>" + esc(JSON.stringify(x, null, 2)) + "</pre>";
    return modal(
      "兩台裝置修改了同一筆資料",
      "<h3>此裝置" +
        (r.deleted ? "（刪除）" : "") +
        "</h3>" +
        display(d) +
        "<h3>雲端" +
        (r.conflict.deleted ? "（刪除）" : "") +
        "</h3>" +
        display(r.conflict.data) +
        btn("保留此裝置版本", "keep", id) +
        btn("採用雲端版本", "remote", id),
    );
  }
  if (a === "keep" || a === "remote") {
    await store.resolve(id, a === "keep");
    dlg.close();
    return;
  }
  if (a === "manual")
    return modal(
      "手動設定匯率",
      inputs(
        [["rate", "1 " + trip.data.currency + " 可換算的 TWD", "number", true]],
        trip.data,
      ),
      async (f) => {
        const rate = +f.get("rate");
        if (!(rate > 0)) throw Error("匯率須大於零");
        await setRate(rate, "手動輸入", new Date().toISOString(), trip);
      },
    );
  if (a === "rate") {
    const target = trip,
      res = await fetch(
        "https://open.er-api.com/v6/latest/" +
          encodeURIComponent(target.data.currency),
      );
    if (!res.ok) throw Error("無法連線，保留最近匯率");
    const json = await res.json();
    if (!(json.rates?.TWD > 0)) throw Error("無此幣別報價");
    return setRate(
      json.rates.TWD,
      "ExchangeRate-API",
      json.time_last_update_utc,
      target,
    );
  }
  if (a === "export") {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            currency: trip.data.currency,
            expenses: live("expenses").map((r) => ({
              id: r.id,
              sourceId: r.data.sourceId || r.id,
              data: r.data,
              created_at: r.created_at,
              updated_at: r.updated_at,
            })),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = trip.data.name + "-記帳.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    return;
  }
  if (a === "import")
    return fileForm(
      "匯入記帳 JSON",
      ".json",
      importExpenses,
      "<p>舊版帳目使用備份中的 KRW 匯率。若備份沒有匯率，請填入此次還原使用的匯率。</p>" +
        inputs([["fallback", "備用 KRW → TWD 匯率", "number"]], {
          fallback: trip.data.rate,
        }),
    );
  if (a === "html")
    return fileForm(
      "依 Day 順序匯入釜山行程",
      ".html",
      importHtml,
      "<p>Day 1 對應目前旅行的出發日。</p>",
    );
}
function setRate(rate, rateSource, rateAt, target) {
  return store.save(
    "trips",
    target.id,
    null,
    { ...target.data, rate, rateSource, rateAt },
    false,
    target.stamp,
  );
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act],#account");
  if (b)
    action(b.dataset.act || "account", b.dataset.id).catch((err) =>
      message(err.message),
    );
});
document.addEventListener("change", (e) => {
  const k = e.target.dataset.filter;
  if (k === "trip") choose(e.target.value);
  else if (k) {
    filter[k] = e.target.value;
    render();
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "search") {
    filter.q = e.target.value;
    render();
    $("#search").focus();
  }
  if (["twd", "foreign"].includes(e.target.id)) {
    const r = trip.data.rate,
      foreign = e.target.id === "foreign";
    filter[e.target.id] = e.target.value;
    const other = foreign ? "twd" : "foreign";
    filter[other] = $("#" + other).value =
      r && e.target.value
        ? Number((foreign ? e.target.value * r : e.target.value / r).toFixed(4))
        : "";
  }
});
async function init() {
  setup();
  if ("serviceWorker" in navigator)
    await navigator.serviceWorker
      .register("./sw.js", { scope: "./" })
      .catch((e) => message(e.message));
  if (!cfg) return;
  client = createClient(cfg.url, cfg.publicKey, {
    auth: { storageKey: "hub-auth:" + cfg.url },
    global: {
      fetch: (input, options = {}) =>
        fetch(input, {
          ...options,
          signal: options.signal
            ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
            : AbortSignal.timeout(15000),
        }),
    },
  });
  client.auth.onAuthStateChange((event, session) => {
    if (
      store &&
      (event === "SIGNED_OUT" || (session && session.user.id !== store.userId))
    ) {
      localStorage.removeItem("hub-last-owner");
      location.reload();
    }
  });
  const last = localStorage.getItem("hub-last-owner");
  if (!navigator.onLine && last) return enter(last);
  const { data } = await client.auth.getSession();
  if (data.session) await enter(data.session.user.id);
}
init().catch((e) => message(e.message));

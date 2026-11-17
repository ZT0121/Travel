export async function watchUpdates(isBusy = () => false) {
  if (!("serviceWorker" in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let approved = false,
    changed = false;
  const banner = document.createElement("aside");
  banner.className = "app-update";
  banner.hidden = true;
  banner.setAttribute("role", "status");
  banner.innerHTML =
    '<span>有新版本可以更新</span><button type="button">更新</button>';
  document.body.append(banner);
  const show = () => {
    banner.hidden = false;
  };
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (approved && !isBusy()) location.reload();
    else if (hadController) {
      changed = true;
      show();
    }
  });
  const registration = await navigator.serviceWorker.register("./sw.js", {
    scope: "./",
    updateViaCache: "none",
  });
  const inspect = () => {
    if (registration.waiting) show();
  };
  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    worker?.addEventListener("statechange", inspect);
  });
  inspect();
  banner.querySelector("button").onclick = () => {
    if (isBusy()) {
      banner.querySelector("span").textContent =
        "請先完成或關閉編輯，並等資料同步完成再更新";
      return;
    }
    if (changed) {
      location.reload();
      return;
    }
    if (registration.waiting) {
      approved = true;
      registration.waiting.postMessage({ type: "ACTIVATE_UPDATE" });
    }
  };
  const check = () => {
    if (navigator.onLine && document.visibilityState === "visible")
      registration.update().catch(() => {});
  };
  document.addEventListener("visibilitychange", check);
  window.addEventListener("online", check);
  setInterval(check, 5 * 60 * 1000);
  check();
}

const PENDING_SHARE_KEY = "cc_mark_pending_share";

injectClipboardHook();

window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== "cc-mark" || data.type !== "douyin-clipboard-write") return;
  storePendingShare(data.text, data);
});

document.addEventListener("copy", (event) => {
  const text = event.clipboardData?.getData("text/plain") || "";
  if (text) storePendingShare(text, { href: location.href, title: document.title, timestamp: Date.now() });
});

function injectClipboardHook() {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("site-adapters/douyin-clipboard-hook.js");
  script.onload = () => script.remove();
  (document.documentElement || document.head).append(script);
}

function storePendingShare(text, context) {
  const parsed = parseDouyinShare(text, context);
  if (!parsed) return;
  chrome.storage.local.set({ [PENDING_SHARE_KEY]: parsed });
}

function parseDouyinShare(text, context = {}) {
  const rawText = String(text || "").trim();
  const urls = rawText.match(/https?:\/\/[^\s"'<>，。；、）)]+/g) || [];
  const url = urls.find((item) => item.includes("douyin.com"));
  if (!url) return null;

  const cleanedText = rawText
    .replace(url, " ")
    .replace(/复制(?:此)?链接.*$/i, " ")
    .replace(/打开(?:抖音|Douyin).*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    source: "douyin",
    url,
    rawText,
    title: cleanedText || context.title || "抖音视频",
    pageTitle: context.title || document.title || "",
    pageUrl: context.href || location.href,
    timestamp: context.timestamp || Date.now()
  };
}

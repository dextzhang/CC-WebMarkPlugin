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
  const url = extractDouyinUrl(rawText);
  if (!url) return null;

  const beforeUrl = rawText.slice(0, rawText.indexOf(url));
  const cleanedText = extractDouyinTitle(beforeUrl);
  return {
    source: "douyin",
    url,
    rawText,
    title: cleanedText && !isNoisyDouyinShareText(cleanedText) ? cleanedText : context.title || document.title || "抖音视频",
    pageTitle: context.title || document.title || "",
    pageUrl: context.href || location.href,
    timestamp: context.timestamp || Date.now()
  };
}

function extractDouyinUrl(text) {
  const urls = String(text || "").match(/https?:\/\/[^\s"'<>，。；、）)]+/g) || [];
  const url = urls.find((item) => /(^https?:\/\/|\/\/)([\w-]+\.)?douyin\.com/i.test(item));
  return url ? url.replace(/[，。；、,.!?！?]+$/g, "") : "";
}

function cleanDouyinShareText(text, url = "") {
  return String(text || "")
    .replace(url, " ")
    .replace(/复制(?:此)?链接[，,]?\s*打开(?:Dou音|抖音|Douyin).*?(?:视频|观看).*$/i, " ")
    .replace(/打开(?:Dou音|抖音|Douyin).*?(?:视频|观看).*$/i, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractDouyinTitle(text) {
  const beforeTags = String(text || "").split("#")[0] || "";
  const afterDate = beforeTags.replace(/^[\s\S]*?\b\d{1,2}\/\d{1,2}\s+/u, "");
  const withoutNoise = (afterDate === beforeTags ? beforeTags.replace(/^[^\u4e00-\u9fff\d]+/u, "") : afterDate)
    .replace(/\s+/g, " ")
    .trim();
  return withoutNoise.replace(/[，。；、,.!?！?]+$/g, "");
}

function isNoisyDouyinShareText(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (value.length > 80) return true;
  if (/https?:\/\/|复制(?:此)?链接|打开(?:Dou音|抖音|Douyin)|KJV:|[@]/i.test(value)) return true;
  const symbolCount = (value.match(/[/:;@#$%^&*=+\\|~<>]/g) || []).length;
  return symbolCount >= 3;
}

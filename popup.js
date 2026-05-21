const STORAGE_KEYS = {
  bookmarks: "cc_mark_bookmarks",
  github: "cc_mark_github",
  drafts: "cc_mark_drafts",
  pendingShare: "cc_mark_pending_share"
};

const DEFAULT_GITHUB = {
  repo: "",
  branch: "main",
  token: "",
  jsonPath: "bookmarks.json",
  mdPath: "bookmarks.md",
  autoSync: true
};

const state = {
  page: null,
  bookmarks: [],
  drafts: {},
  pendingShare: null,
  github: { ...DEFAULT_GITHUB },
  busy: false,
  draftTimer: null,
  editingBookmarkId: null
};

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  await loadState();
  await readCurrentPage();
  renderAll();
});

function bindEvents() {
  $("refreshPage").addEventListener("click", readCurrentPage);
  $("copyCleanUrl").addEventListener("click", () => copyText(state.page?.cleanUrl || ""));
  $("addBookmark").addEventListener("click", addBookmark);
  $("saveConfig").addEventListener("click", saveGithubConfig);
  $("pullGithub").addEventListener("click", pullFromGithub);
  $("openGithub").addEventListener("click", openGithubRepo);
  $("manageBookmarks").addEventListener("click", openManager);
  $("pushGithub").addEventListener("click", pushToGithub);
  $("exportMarkdown").addEventListener("click", () => copyText(renderMarkdown(state.bookmarks)));
  $("openSettings").addEventListener("click", openSettings);
  $("closeSettings").addEventListener("click", closeSettings);
  $("closeManager").addEventListener("click", closeManager);
  $("managerSearch").addEventListener("input", renderManager);
  $("managerTagFilter").addEventListener("change", renderManager);
  $("noteInput").addEventListener("input", handleNoteInput);
  $("tagsInput").addEventListener("input", queueDraftSave);
  $("settingsOverlay").addEventListener("click", (event) => {
    if (event.target === $("settingsOverlay")) closeSettings();
  });
  $("managerOverlay").addEventListener("click", (event) => {
    if (event.target === $("managerOverlay")) closeManager();
  });
}

async function loadState() {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.bookmarks, STORAGE_KEYS.github, STORAGE_KEYS.drafts, STORAGE_KEYS.pendingShare]);
  state.bookmarks = Array.isArray(stored[STORAGE_KEYS.bookmarks]) ? stored[STORAGE_KEYS.bookmarks] : [];
  state.github = { ...DEFAULT_GITHUB, ...(stored[STORAGE_KEYS.github] || {}) };
  state.drafts = stored[STORAGE_KEYS.drafts] && typeof stored[STORAGE_KEYS.drafts] === "object" ? stored[STORAGE_KEYS.drafts] : {};
  state.pendingShare = stored[STORAGE_KEYS.pendingShare] || null;
}

async function saveBookmarks(bookmarks = state.bookmarks) {
  state.bookmarks = sortBookmarks(bookmarks);
  await chrome.storage.local.set({ [STORAGE_KEYS.bookmarks]: state.bookmarks });
}

async function readCurrentPage() {
  setStatus("正在读取当前网页...", "working");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.url) {
      throw new Error("没有读取到当前标签页。");
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPageInfo
    });

    state.page = applyPendingShare(normalizePageInfo({
      title: tab.title,
      url: tab.url,
      ...result
    }));
    await applyClipboardShare();
    restoreDraft();
    setStatus(state.page.fromPendingShare ? "已识别抖音复制链接。" : state.github.repo ? "已读取当前网页。" : "未配置同步。");
  } catch (error) {
    state.page = normalizePageInfo({
      title: "当前网页",
      url: "",
      author: ""
    });
    setStatus(`读取失败：${error.message}`, "error");
  }
  renderCurrentPage();
}

function collectPageInfo() {
  const text = (selector) => document.querySelector(selector)?.textContent?.trim() || "";
  const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name)?.trim() || "";
  const metas = (names) => {
    for (const name of names) {
      const value =
        attr(`meta[property="${name}"]`, "content") ||
        attr(`meta[name="${name}"]`, "content");
      if (value) return value;
    }
    return "";
  };

  const hostname = location.hostname;
  let author =
    metas(["author", "article:author", "og:author"]) ||
    text('[rel="author"]') ||
    text(".author") ||
    text('[class*="author"]') ||
    text('[class*="up-name"]');

  if (hostname.includes("bilibili.com")) {
    author =
      text(".up-name") ||
      text(".up-info-name") ||
      text(".username") ||
      text('[class*="up-info"] [class*="name"]') ||
      author;
  }

  if (hostname.includes("douyin.com")) {
    const bodyText = document.body?.innerText || "";
    const douyinAuthor = bodyText.match(/@([^\s@#：:，,。；;|｜]{2,30})/)?.[1] || "";
    author = douyinAuthor || author;
  }

  return {
    title: metas(["og:title", "twitter:title"]) || document.title || "",
    url: location.href,
    canonicalUrl: attr('link[rel="canonical"]', "href"),
    description: metas(["description", "og:description", "twitter:description"]),
    author,
    siteName: metas(["og:site_name"]),
    hostname
  };
}

function normalizePageInfo(info) {
  const url = info.url || info.canonicalUrl || "";
  return {
    title: cleanTitle(info.title || ""),
    url,
    cleanUrl: cleanUrl(url),
    canonicalUrl: info.canonicalUrl || "",
    description: info.description || "",
    author: cleanAuthor(info.author || ""),
    siteName: info.siteName || "",
    hostname: info.hostname || safeHostname(url)
  };
}

function applyPendingShare(page) {
  const share = state.pendingShare;
  if (!isFreshDouyinShare(share, page)) return page;
  return pageFromDouyinShare(page, share);
}

function isFreshDouyinShare(share, page) {
  if (!share || share.source !== "douyin" || !share.url) return false;
  const age = Date.now() - Number(share.timestamp || 0);
  const fresh = age >= 0 && age <= 15 * 60 * 1000;
  const currentIsDouyin = page.hostname?.includes("douyin.com");
  const shareIsDouyin = share.url.includes("douyin.com");
  return fresh && currentIsDouyin && shareIsDouyin;
}

async function applyClipboardShare() {
  if (!state.page?.hostname?.includes("douyin.com") || !navigator.clipboard?.readText) return;
  try {
    const text = await navigator.clipboard.readText();
    const share = parseDouyinShare(text, state.page);
    if (!share) return;
    state.pendingShare = share;
    await chrome.storage.local.set({ [STORAGE_KEYS.pendingShare]: share });
    state.page = pageFromDouyinShare(state.page, share);
  } catch {
    // Clipboard access is best-effort and can be blocked by browser settings.
  }
}

function pageFromDouyinShare(page, share) {
  const shareUrl = cleanUrl(share.url);
  return {
    ...page,
    title: cleanTitle(preferredDouyinTitle(share, page)),
    url: share.url,
    cleanUrl: shareUrl,
    canonicalUrl: shareUrl,
    description: share.rawText || page.description || "",
    siteName: "抖音",
    hostname: safeHostname(shareUrl),
    fromPendingShare: true
  };
}

function parseDouyinShare(text, page = {}) {
  const rawText = String(text || "").trim();
  const url = extractDouyinUrl(rawText);
  if (!url) return null;
  const beforeUrl = rawText.slice(0, rawText.indexOf(url));
  const shareContent = extractDouyinShareContent(beforeUrl);
  const title = extractDouyinTitle(shareContent);
  const tags = extractDouyinTags(shareContent);
  return {
    source: "douyin",
    url,
    rawText,
    shareContent,
    title: title || page.title || "抖音视频",
    tags,
    pageTitle: page.title || "",
    pageUrl: page.url || "",
    timestamp: Date.now()
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

function extractDouyinShareContent(text) {
  const source = String(text || "");
  const firstChinese = source.search(/[\u4e00-\u9fff]/u);
  return (firstChinese >= 0 ? source.slice(firstChinese) : source).replace(/\s+/g, " ").trim();
}

function extractDouyinTitle(text) {
  const content = extractDouyinShareContent(text);
  const title = content.split(/\s+#/u)[0].replace(/\s+/g, " ").trim();
  return title.replace(/[，。；、,.!?！?]+$/g, "");
}

function extractDouyinTags(text) {
  return [...String(text || "").matchAll(/#\s*([^#\s，,。；;！!？?]+)/g)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function preferredDouyinTitle(share, page = {}) {
  if (share.title && !isNoisyDouyinShareText(share.title)) return share.title;
  return page.title || share.pageTitle || "抖音视频";
}

function isNoisyDouyinShareText(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (value.length > 80) return true;
  if (/https?:\/\/|复制(?:此)?链接|打开(?:Dou音|抖音|Douyin)|KJV:|[@]/i.test(value)) return true;
  const symbolCount = (value.match(/[/:;@#$%^&*=+\\|~<>]/g) || []).length;
  return symbolCount >= 3;
}

function cleanUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    const removable = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "utm_id",
      "vd_source",
      "spm_id_from",
      "from",
      "share_source",
      "share_medium",
      "share_plat",
      "share_session_id",
      "share_tag",
    "timestamp"
  ];
    removable.forEach((key) => url.searchParams.delete(key));
    if ([...url.searchParams.keys()].length === 0) {
      url.search = "";
    }
    return url.toString().replace(/\/$/, "");
  } catch {
    return rawUrl || "";
  }
}

function safeHostname(rawUrl) {
  try {
    return new URL(rawUrl).hostname;
  } catch {
    return "";
  }
}

function cleanTitle(title) {
  return title.replace(/\s+/g, " ").replace(/_哔哩哔哩_bilibili$/, "").trim();
}

function cleanAuthor(author) {
  return author.replace(/\s+/g, " ").replace(/^UP主[:：]\s*/, "").trim();
}

async function addBookmark() {
  if (!state.page?.cleanUrl) {
    setStatus("没有可收藏的当前网页。", "error");
    return;
  }

  const now = new Date();
  const bookmark = {
    id: `${now.getTime()}-${crypto.randomUUID()}`,
    title: state.page.title,
    url: state.page.url,
    cleanUrl: state.page.cleanUrl,
    author: state.page.author,
    siteName: state.page.siteName,
    hostname: state.page.hostname,
    description: state.page.description,
    note: $("noteInput").value.trim(),
    tags: parseTags($("tagsInput").value),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  await saveBookmarks([bookmark, ...state.bookmarks]);
  await clearDraft();
  if (state.page.fromPendingShare) {
    await clearPendingShare();
  }
  $("noteInput").value = "";
  $("tagsInput").value = "";
  renderRecent();
  renderManager();
  setStatus("已保存到本机。", "success");

  if (state.github.autoSync && hasGithubConfig()) {
    await pushToGithub();
  }
}

function parseTags(value) {
  return value
    .split(/[,，\s]+/)
    .map((tag) => tag.trim().replace(/^#/, ""))
    .filter(Boolean);
}

async function handleNoteInput() {
  const originalNote = $("noteInput").value;
  const share = parseDouyinShare(originalNote, state.page || {});
  if (share) {
    state.pendingShare = share;
    await chrome.storage.local.set({ [STORAGE_KEYS.pendingShare]: share });
    state.page = pageFromDouyinShare(state.page || {}, share);
    $("tagsInput").value = mergeTagText($("tagsInput").value, share.tags || []);
    $("noteInput").value = share.shareContent || extractUserNoteAfterDouyinShare(originalNote, share.url);
    renderCurrentPage();
    setStatus("已从备注识别抖音链接。", "success");
  }
  queueDraftSave();
}

function extractUserNoteAfterDouyinShare(text, url) {
  const value = String(text || "");
  const marker = /复制(?:此)?链接[，,]?\s*打开(?:Dou音|抖音|Douyin).*?(?:视频|观看)[！!。.]?/i;
  const afterMarker = value.split(marker)[1]?.trim();
  if (afterMarker) return afterMarker;
  const afterUrl = value.slice(value.indexOf(url) + url.length).replace(marker, "").trim();
  return afterUrl && !isNoisyDouyinShareText(afterUrl) ? afterUrl : "";
}

function mergeTagText(current, tags) {
  const merged = [...new Set([...parseTags(current), ...tags])];
  return merged.join(", ");
}

function draftKey() {
  return state.page?.cleanUrl || "";
}

function restoreDraft() {
  const key = draftKey();
  if (!key || !state.drafts[key]) {
    $("noteInput").value = "";
    $("tagsInput").value = "";
    return;
  }
  $("noteInput").value = state.drafts[key].note || "";
  $("tagsInput").value = state.drafts[key].tags || "";
}

function queueDraftSave() {
  window.clearTimeout(state.draftTimer);
  state.draftTimer = window.setTimeout(saveDraft, 250);
}

async function saveDraft() {
  const key = draftKey();
  if (!key) return;
  const note = $("noteInput").value;
  const tags = $("tagsInput").value;
  if (!note.trim() && !tags.trim()) {
    await clearDraft();
    return;
  }
  state.drafts = {
    ...state.drafts,
    [key]: {
      note,
      tags,
      updatedAt: new Date().toISOString()
    }
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.drafts]: state.drafts });
}

async function clearDraft() {
  const key = draftKey();
  if (!key || !state.drafts[key]) return;
  const next = { ...state.drafts };
  delete next[key];
  state.drafts = next;
  await chrome.storage.local.set({ [STORAGE_KEYS.drafts]: state.drafts });
}

async function clearPendingShare() {
  state.pendingShare = null;
  await chrome.storage.local.remove(STORAGE_KEYS.pendingShare);
}

async function saveGithubConfig() {
  state.github = {
    repo: $("repoInput").value.trim(),
    branch: $("branchInput").value.trim() || "main",
    token: $("tokenInput").value.trim(),
    jsonPath: $("jsonPathInput").value.trim() || "bookmarks.json",
    mdPath: $("mdPathInput").value.trim() || "bookmarks.md",
    autoSync: $("autoSync").checked
  };
  await chrome.storage.local.set({ [STORAGE_KEYS.github]: state.github });
  renderConfig();
  setStatus(hasGithubConfig() ? "同步配置已保存。" : "同步配置不完整。", hasGithubConfig() ? "success" : "error");
}

async function pullFromGithub() {
  await withBusy("正在拉取 GitHub 数据...", async () => {
    ensureGithubConfig();
    const remote = await fetchGithubJson();
    const merged = mergeById([...remote, ...state.bookmarks]);
    await saveBookmarks(merged);
    renderRecent();
    renderManager();
    setStatus(`拉取完成，本机共有 ${state.bookmarks.length} 条收藏。`, "success");
  });
}

async function pushToGithub() {
  await withBusy("正在上传...", async () => {
    ensureGithubConfig();
    const remote = await fetchGithubJson();
    const merged = mergeById([...state.bookmarks, ...remote]);
    const sorted = sortBookmarks(merged);
    await uploadGithubFile(state.github.jsonPath, JSON.stringify(sorted, null, 2), "Update bookmark JSON backup");
    await uploadGithubFile(state.github.mdPath, renderMarkdown(sorted), "Update bookmark markdown");
    await saveBookmarks(sorted);
    renderRecent();
    renderManager();
    setStatus(`上传成功，共 ${sorted.length} 条收藏。`, "success");
  });
}

async function withBusy(message, task) {
  if (state.busy) return;
  state.busy = true;
  renderBusy();
  setStatus(message, "working");
  try {
    await task();
  } catch (error) {
    setStatus(`同步失败：${error.message}`, "error");
  } finally {
    state.busy = false;
    renderBusy();
  }
}

function hasGithubConfig() {
  return Boolean(state.github.repo && state.github.token && state.github.jsonPath && state.github.mdPath);
}

function ensureGithubConfig() {
  if (!hasGithubConfig()) {
    throw new Error("请先填写仓库、Token 和文件路径。");
  }
}

async function fetchGithubJson() {
  const file = await getGithubFile(state.github.jsonPath);
  if (!file) return [];
  try {
    const json = decodeBase64(file.content || "");
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error(`${state.github.jsonPath} 不是可解析的 JSON 数组。`);
  }
}

async function getGithubFile(path) {
  const url = githubContentsUrl(path);
  const response = await fetch(url, {
    headers: githubHeaders()
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`读取 ${path} 失败：${response.status}`);
  }
  return response.json();
}

async function uploadGithubFile(path, content, message) {
  const current = await getGithubFile(path);
  const response = await fetch(githubContentsUrl(path), {
    method: "PUT",
    headers: githubHeaders(),
    body: JSON.stringify({
      message,
      content: encodeBase64(content),
      branch: state.github.branch,
      sha: current?.sha
    })
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    throw new Error(`写入 ${path} 失败：${detail.message || response.status}`);
  }
}

function githubContentsUrl(path) {
  const cleanPath = path.replace(/^\/+/, "");
  return `https://api.github.com/repos/${state.github.repo}/contents/${encodeURI(cleanPath)}?ref=${encodeURIComponent(state.github.branch)}`;
}

function githubHeaders() {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${state.github.token}`,
    "X-GitHub-Api-Version": "2022-11-28"
  };
}

function encodeBase64(text) {
  return btoa(unescape(encodeURIComponent(text)));
}

function decodeBase64(text) {
  return decodeURIComponent(escape(atob(text.replace(/\n/g, ""))));
}

function mergeById(bookmarks) {
  const seen = new Set();
  const merged = [];
  for (const bookmark of bookmarks) {
    if (!bookmark?.id || seen.has(bookmark.id)) continue;
    seen.add(bookmark.id);
    merged.push(bookmark);
  }
  return sortBookmarks(merged);
}

function sortBookmarks(bookmarks) {
  return [...bookmarks].sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
}

function renderAll() {
  renderCurrentPage();
  renderConfig();
  renderRecent();
  renderManager();
  renderBusy();
}

function renderCurrentPage() {
  $("pageTitle").textContent = state.page?.title || "未读取到标题";
  $("pageAuthor").textContent = state.page?.author ? `UP/作者：${state.page.author}` : state.page?.hostname || "";
  $("cleanUrl").textContent = state.page?.cleanUrl || "";
}

function renderConfig() {
  $("repoInput").value = state.github.repo;
  $("branchInput").value = state.github.branch;
  $("tokenInput").value = state.github.token;
  $("jsonPathInput").value = state.github.jsonPath;
  $("mdPathInput").value = state.github.mdPath;
  $("autoSync").checked = state.github.autoSync;
  $("syncMode").textContent = state.github.autoSync ? "自动上传" : "手动同步";
}

function renderRecent() {
  const list = $("recentList");
  list.innerHTML = "";
  const recent = state.bookmarks.slice(0, 10);
  if (!recent.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "还没有本机收藏。";
    list.append(empty);
    return;
  }

  for (const bookmark of recent) {
    list.append(createBookmarkItem(bookmark, { allowDelete: false }));
  }
}

function renderManager() {
  const list = $("managerList");
  if (!list) return;
  renderTagFilter();
  list.innerHTML = "";
  const bookmarks = filteredBookmarks();

  if (!bookmarks.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "没有匹配的收藏。";
    list.append(empty);
    return;
  }

  for (const bookmark of bookmarks) {
    list.append(createBookmarkItem(bookmark, { allowDelete: true }));
  }
}

function renderTagFilter() {
  const select = $("managerTagFilter");
  const current = select.value;
  const tags = [...new Set(state.bookmarks.flatMap((bookmark) => bookmark.tags || []))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = "";
  const all = document.createElement("option");
  all.value = "";
  all.textContent = "全部标签";
  select.append(all);
  for (const tag of tags) {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = `#${tag}`;
    select.append(option);
  }
  select.value = tags.includes(current) ? current : "";
}

function filteredBookmarks() {
  const keyword = $("managerSearch").value.trim().toLowerCase();
  const tag = $("managerTagFilter").value;
  return state.bookmarks.filter((bookmark) => {
    const matchesTag = !tag || bookmark.tags?.includes(tag);
    const haystack = [
      bookmark.title,
      bookmark.note,
      bookmark.cleanUrl,
      bookmark.url,
      bookmark.hostname,
      ...(bookmark.tags || [])
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return matchesTag && (!keyword || haystack.includes(keyword));
  });
}

function createBookmarkItem(bookmark, options = {}) {
  const item = document.createElement("article");
  item.className = "bookmark-item";
  if (state.editingBookmarkId === bookmark.id) {
    item.classList.add("is-editing");
  }

  const top = document.createElement("p");
  top.className = "bookmark-top";
  top.textContent = renderBookmarkTitleLine(bookmark);

  const editToggle = document.createElement("button");
  editToggle.className = "text-button bookmark-edit-toggle";
  editToggle.textContent = state.editingBookmarkId === bookmark.id ? "保存" : "编辑";

  const edit = document.createElement("div");
  edit.className = "bookmark-edit";

  const titleInput = document.createElement("input");
  titleInput.className = "bookmark-edit-input";
  titleInput.type = "text";
  titleInput.value = bookmark.title || "";
  titleInput.placeholder = "修改标题";

  const tagsInput = document.createElement("input");
  tagsInput.className = "bookmark-edit-input";
  tagsInput.type = "text";
  tagsInput.value = bookmark.tags?.join(", ") || "";
  tagsInput.placeholder = "修改标签";

  const noteInput = document.createElement("textarea");
  noteInput.className = "bookmark-edit-textarea";
  noteInput.value = bookmark.note || "";
  noteInput.placeholder = "修改备注";

  editToggle.addEventListener("click", () => {
    if (state.editingBookmarkId === bookmark.id) {
      updateBookmark(bookmark.id, {
        title: titleInput.value,
        tags: tagsInput.value,
        note: noteInput.value
      });
    } else {
      state.editingBookmarkId = bookmark.id;
      renderRecent();
      renderManager();
    }
  });

  edit.append(titleInput, tagsInput, noteInput);

  const tags = document.createElement("p");
  tags.className = "bookmark-tags";
  tags.textContent = bookmark.tags?.length ? bookmark.tags.map((tag) => `#${tag}`).join(" ") : "#未标记";

  const note = document.createElement("p");
  note.className = "bookmark-note";
  note.textContent = bookmark.note || "无备注";

  const date = document.createElement("p");
  date.className = "bookmark-date";
  date.textContent = formatDate(bookmark.createdAt);

  const actions = document.createElement("div");
  actions.className = "bookmark-actions";

  const openButton = document.createElement("button");
  openButton.className = "text-button";
  openButton.textContent = "打开";
  openButton.addEventListener("click", () => chrome.tabs.create({ url: bookmark.cleanUrl || bookmark.url }));

  const copyButton = document.createElement("button");
  copyButton.className = "text-button";
  copyButton.textContent = "复制";
  copyButton.addEventListener("click", () => copyText(renderCompactBookmark(bookmark)));

  actions.append(openButton, copyButton);
  if (options.allowDelete) {
    const deleteButton = document.createElement("button");
    deleteButton.className = "text-button danger-button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => deleteBookmark(bookmark.id));
    actions.append(deleteButton);
  }

  item.append(top, editToggle, edit, tags, note, date, actions);
  return item;
}

async function updateBookmark(id, values) {
  const cleanTitleValue = values.title.trim();
  if (!cleanTitleValue) {
    setStatus("标题不能为空。", "error");
    return;
  }

  const bookmark = state.bookmarks.find((item) => item.id === id);
  if (!bookmark) return;

  const nextTags = parseTags(values.tags);
  const nextNote = values.note.trim();

  const updated = state.bookmarks.map((item) =>
    item.id === id
      ? {
          ...item,
          title: cleanTitleValue,
          tags: nextTags,
          note: nextNote,
          updatedAt: new Date().toISOString()
        }
      : item
  );

  state.editingBookmarkId = null;
  await saveBookmarks(updated);
  renderRecent();
  renderManager();
  setStatus("收藏已更新。", "success");

  if (hasGithubConfig()) {
    await pushToGithub();
  }
}

async function deleteBookmark(id) {
  const bookmark = state.bookmarks.find((item) => item.id === id);
  if (!bookmark) return;
  const confirmed = window.confirm(`删除这条收藏？\n\n${bookmark.title || bookmark.cleanUrl || bookmark.url}`);
  if (!confirmed) return;

  state.editingBookmarkId = null;
  await saveBookmarks(state.bookmarks.filter((item) => item.id !== id));
  renderRecent();
  renderManager();
  setStatus("收藏已删除。", "success");

  if (hasGithubConfig()) {
    await pushToGithub();
  }
}

function renderBusy() {
  ["addBookmark", "saveConfig", "pullGithub", "pushGithub"].forEach((id) => {
    $(id).disabled = state.busy;
  });
}

function renderCompactBookmark(bookmark) {
  const tags = bookmark.tags?.length ? bookmark.tags.map((tag) => `#${tag}`).join(" ") : "";
  const note = bookmark.note || "";
  return `${renderBookmarkTitleLine(bookmark)}\n  ${tags}\n  ${note}\n  ${formatDate(bookmark.createdAt)}`;
}

function renderBookmarkTitleLine(bookmark) {
  const title = bookmark.title || "未命名网页";
  const author = bookmark.author ? ` - ${bookmark.author}` : "";
  return `${bookmark.cleanUrl || bookmark.url} - ${title}${author}`;
}

function renderMarkdown(bookmarks) {
  if (!bookmarks.length) return "# Bookmarks\n";
  const body = sortBookmarks(bookmarks)
    .map((bookmark) => {
      const title = bookmark.title || "未命名网页";
      const author = bookmark.author ? ` ${bookmark.author}` : "";
      const tags = bookmark.tags?.length ? bookmark.tags.map((tag) => `#${tag}`).join(" ") : "无";
      const note = bookmark.note || "无";
      return [
        `## ${formatDateTime(bookmark.createdAt)}`,
        "",
        `- 标题：[${escapeMd(title)}${author ? ` - ${escapeMd(author.trim())}` : ""}](${bookmark.cleanUrl || bookmark.url})`,
        `- 标签：${tags}`,
        `- 备注：${note}`,
        ""
      ].join("\n");
    })
    .join("\n");
  return `# Bookmarks\n\n${body}`;
}

function openSettings() {
  $("settingsOverlay").hidden = false;
  $("repoInput").focus();
}

function closeSettings() {
  $("settingsOverlay").hidden = true;
}

function openManager() {
  $("managerOverlay").hidden = false;
  renderManager();
  $("managerSearch").focus();
}

function closeManager() {
  $("managerOverlay").hidden = true;
  state.editingBookmarkId = null;
  renderRecent();
}

function openGithubRepo() {
  if (!state.github.repo) {
    openSettings();
    setStatus("请先在设置里填写 GitHub 仓库。", "error");
    return;
  }
  chrome.tabs.create({ url: `https://github.com/${state.github.repo}` });
}

function escapeMd(text) {
  return String(text).replace(/[[\]]/g, "\\$&");
}

function formatDate(value) {
  const date = value ? new Date(value) : new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateTime(value) {
  const date = value ? new Date(value) : new Date();
  const time = date.toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
  return `${formatDate(value)} ${time}`;
}

async function copyText(text) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
  setStatus("已复制。", "success");
}

function setStatus(message, tone = "") {
  $("syncStatus").textContent = message;
  $("syncInlineStatus").textContent = compactStatus(message);
  $("syncInlineStatus").className = `inline-sync-status${tone ? ` is-${tone}` : ""}`;
}

function compactStatus(message) {
  if (message.includes("正在上传")) return "正在上传";
  if (message.includes("上传成功")) return "上传成功";
  if (message.includes("失败")) return "同步失败";
  if (message.includes("保存")) return "已保存";
  if (message.includes("拉取完成")) return "已拉取";
  if (message.includes("读取")) return "已读取";
  return "待命";
}

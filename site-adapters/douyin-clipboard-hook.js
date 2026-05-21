(() => {
  if (window.__ccMarkDouyinClipboardHooked) return;
  window.__ccMarkDouyinClipboardHooked = true;

  function notify(text) {
    if (typeof text !== "string" || !text.trim()) return;
    window.postMessage(
      {
        source: "cc-mark",
        type: "douyin-clipboard-write",
        text,
        href: location.href,
        title: document.title,
        timestamp: Date.now()
      },
      "*"
    );
  }

  const clipboard = navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    const originalWriteText = clipboard.writeText.bind(clipboard);
    try {
      clipboard.writeText = (text) => {
        notify(String(text || ""));
        return originalWriteText(text);
      };
    } catch {
      // Some browsers expose clipboard methods as read-only. The content script
      // still listens for native copy events as a fallback.
    }
  }

  const originalExecCommand = document.execCommand?.bind(document);
  if (originalExecCommand) {
    document.execCommand = (command, showUI, value) => {
      const result = originalExecCommand(command, showUI, value);
      if (String(command).toLowerCase() === "copy") {
        setTimeout(() => notify(window.getSelection?.().toString() || ""), 0);
      }
      return result;
    };
  }
})();

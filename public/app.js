// public/app.js
(() => {
  const historyWrap = document.getElementById("history");
  const chatEl = document.getElementById("chat");
  const emptyStateEl = document.getElementById("emptyState");
  const inputEl = document.getElementById("msg");
  const composerEl = document.getElementById("composer");
  const spacerEl = document.getElementById("bottom-spacer");

  const modelSel = document.getElementById("modelSel");
  const personaToggle = document.getElementById("personaToggle");
  const themeToggle = document.getElementById("themeToggle");
  const settingsBtn = document.getElementById("settingsBtn");
  const sendBtn = document.getElementById("sendBtn");

  const settingsMask = document.getElementById("settingsMask");
  const customPromptEl = document.getElementById("customPrompt");
  const savePromptBtn = document.getElementById("savePrompt");
  const clearPromptBtn = document.getElementById("clearPrompt");
  const closeSettingsBtn = document.getElementById("closeSettings");
  const historyKeepEl = document.getElementById("historyKeep");
  const clearHistoryBtn = document.getElementById("clearHistory");
  const promptKeepEl = document.getElementById("promptKeep");

  const MODELS = (window.APP_MODELS || [
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  ]);

  const session = [];

  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let totalInEstimate = 0;
  let totalOutEstimate = 0;
  let isSending = false;

  const LS_MODEL = "cfw_model";
  const LS_USE_BUILTIN = "cfw_use_builtin";
  const LS_THEME = "cfw_theme";

  const LS_HISTORY_ENABLED = "cfw_history_enabled";
  const LS_CHAT_SESSION = "cfw_chat_session_v1";

  const LS_PROMPT_ENABLED = "cfw_prompt_enabled";
  const LS_CUSTOM_PROMPT = "cfw_custom_prompt_v1";

  let useBuiltin = (localStorage.getItem(LS_USE_BUILTIN) ?? "1") === "1";
  let historyEnabled = (localStorage.getItem(LS_HISTORY_ENABLED) ?? "0") === "1";
  let promptEnabled = (localStorage.getItem(LS_PROMPT_ENABLED) ?? "1") === "1";

  personaToggle.textContent = useBuiltin ? "😈" : "😇";
  historyKeepEl.checked = historyEnabled;
  promptKeepEl.checked = promptEnabled;

  function setTheme(theme) {
    const next = theme === "light" ? "light" : "dark";
    document.body.dataset.theme = next;
    themeToggle.textContent = next === "light" ? "☀" : "☾";
    themeToggle.title = next === "light" ? "切换到黑夜模式" : "切换到白天模式";
    localStorage.setItem(LS_THEME, next);
  }

  function initTheme() {
    const saved = localStorage.getItem(LS_THEME);
    if (saved === "light" || saved === "dark") {
      setTheme(saved);
      return;
    }

    const prefersLight = window.matchMedia?.("(prefers-color-scheme: light)")?.matches;
    setTheme(prefersLight ? "light" : "dark");
  }

  function updateEmptyState() {
    if (!emptyStateEl) return;
    emptyStateEl.style.display = session.length ? "none" : "grid";
  }

  function estimateTokens(text) {
    if (!text) return 0;
    let cjk = 0, ascii = 0;
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") continue;
      const isCJK =
        (code >= 0x4E00 && code <= 0x9FFF) ||
        (code >= 0x3400 && code <= 0x4DBF) ||
        (code >= 0x3040 && code <= 0x30FF) ||
        (code >= 0xAC00 && code <= 0xD7AF) ||
        (code >= 0xFF00 && code <= 0xFFEF);
      if (isCJK) cjk++; else ascii++;
    }
    return cjk + Math.ceil(ascii / 4);
  }

  function updateSpacer() {
    if (!composerEl || !spacerEl) return;
    const rect = composerEl.getBoundingClientRect();
    const rootStyle = getComputedStyle(document.documentElement);
    const gap = parseFloat(rootStyle.getPropertyValue("--composer-gap")) || 18;
    const extra = parseFloat(rootStyle.getPropertyValue("--spacer-extra")) || 34;
    const h = Math.ceil(rect.height + gap + extra);
    spacerEl.style.height = h + "px";
    historyWrap.style.scrollPaddingBottom = h + "px";
  }

  function isNearBottom() {
    const threshold = 120;
    return (historyWrap.scrollHeight - historyWrap.scrollTop - historyWrap.clientHeight) < threshold;
  }

  function scrollToBottom() {
    historyWrap.scrollTo({ top: historyWrap.scrollHeight, behavior: "auto" });
  }

  function makeRow(role) {
    const row = document.createElement("div");
    row.className = "row " + (role === "user" ? "user" : "ai");

    const avatar = document.createElement("div");
    avatar.className = "avatar " + (role === "user" ? "human" : "bot");
    avatar.textContent = role === "user" ? "U" : "D";

    const content = document.createElement("div");
    content.className = "content";

    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = role === "user" ? "You" : "DeepSeek";

    const bubble = document.createElement("div");
    bubble.className = "bubble " + (role === "user" ? "user" : "ai");

    const stats = document.createElement("div");
    stats.className = "stats";

    content.appendChild(meta);
    content.appendChild(bubble);
    content.appendChild(stats);

    if (role === "user") {
      row.appendChild(content);
      row.appendChild(avatar);
    } else {
      row.appendChild(avatar);
      row.appendChild(content);
    }

    chatEl.insertBefore(row, spacerEl);
    updateEmptyState();
    if (isNearBottom()) scrollToBottom();

    return { bubble, stats };
  }

  function clearUIRows() {
    const nodes = Array.from(chatEl.children);
    for (const n of nodes) {
      if (n === spacerEl || n === emptyStateEl) continue;
      chatEl.removeChild(n);
    }
    updateEmptyState();
  }

  function persistSessionIfEnabled() {
    if (!historyEnabled) return;
    try { localStorage.setItem(LS_CHAT_SESSION, JSON.stringify(session)); } catch {}
  }

  function restoreSessionIfEnabled() {
    if (!historyEnabled) return;
    const raw = localStorage.getItem(LS_CHAT_SESSION);
    if (!raw) return;

    try {
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return;

      session.length = 0;
      for (const m of arr) {
        if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string") continue;
        session.push({ role: m.role, content: m.content });
      }

      clearUIRows();
      for (const m of session) {
        const r = makeRow(m.role === "user" ? "user" : "assistant");
        r.bubble.textContent = m.content;
        r.stats.textContent = "";
      }
    } catch {}
  }

  function displayModelName(model) {
    const raw = model.label || model.id || "Model";
    return raw
      .replace(/^deepseek-v4-pro$/i, "DeepSeek V4 Pro")
      .replace(/^deepseek-v4-flash$/i, "DeepSeek V4 Flash")
      .replace(/^deepseek-chat$/i, "DeepSeek Chat")
      .replace(/^deepseek-reasoner$/i, "DeepSeek Reasoner");
  }

  function initModels() {
    modelSel.innerHTML = "";
    for (const m of MODELS) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = displayModelName(m);
      modelSel.appendChild(opt);
    }

    const saved = localStorage.getItem(LS_MODEL);
    const fallback = window.APP_DEFAULT_MODEL || MODELS[0]?.id;
    const validSaved = MODELS.some((m) => m.id === saved);
    modelSel.value = validSaved ? saved : fallback;
    localStorage.setItem(LS_MODEL, modelSel.value);

    modelSel.addEventListener("change", () => {
      localStorage.setItem(LS_MODEL, modelSel.value);
    });
  }

  personaToggle.addEventListener("click", () => {
    useBuiltin = !useBuiltin;
    personaToggle.textContent = useBuiltin ? "😈" : "😇";
    localStorage.setItem(LS_USE_BUILTIN, useBuiltin ? "1" : "0");
  });

  themeToggle.addEventListener("click", () => {
    setTheme(document.body.dataset.theme === "light" ? "dark" : "light");
  });

  settingsBtn.addEventListener("click", () => {
    settingsMask.style.display = "flex";
    settingsMask.setAttribute("aria-hidden", "false");
    historyKeepEl.checked = historyEnabled;
    promptKeepEl.checked = promptEnabled;
    customPromptEl.value = localStorage.getItem(LS_CUSTOM_PROMPT) || "";
  });

  function closeSettings() {
    settingsMask.style.display = "none";
    settingsMask.setAttribute("aria-hidden", "true");
  }

  closeSettingsBtn.addEventListener("click", closeSettings);
  settingsMask.addEventListener("click", (e) => {
    if (e.target === settingsMask) closeSettings();
  });

  historyKeepEl.addEventListener("change", () => {
    historyEnabled = !!historyKeepEl.checked;
    localStorage.setItem(LS_HISTORY_ENABLED, historyEnabled ? "1" : "0");
    if (historyEnabled) persistSessionIfEnabled();
  });

  clearHistoryBtn.addEventListener("click", () => {
    const ok = confirm("确定清除本地历史？\n只会删除对话记录，不会影响网页自定义人物模板。");
    if (!ok) return;
    localStorage.removeItem(LS_CHAT_SESSION);
    session.length = 0;
    clearUIRows();
    updateSpacer();
    scrollToBottom();
  });

  promptKeepEl.addEventListener("change", () => {
    promptEnabled = !!promptKeepEl.checked;
    localStorage.setItem(LS_PROMPT_ENABLED, promptEnabled ? "1" : "0");
    if (!promptEnabled) localStorage.removeItem(LS_CUSTOM_PROMPT);
  });

  savePromptBtn.addEventListener("click", () => {
    const val = customPromptEl.value || "";
    if (promptEnabled) localStorage.setItem(LS_CUSTOM_PROMPT, val);
    else localStorage.removeItem(LS_CUSTOM_PROMPT);
    closeSettings();
  });

  clearPromptBtn.addEventListener("click", () => {
    const ok = confirm("确定清除网页自定义人物模板？\n只会删除自定义模板，不会影响本地历史。");
    if (!ok) return;
    localStorage.removeItem(LS_CUSTOM_PROMPT);
    customPromptEl.value = "";
  });

  inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height = inputEl.scrollHeight + "px";
    const stick = isNearBottom();
    updateSpacer();
    if (stick) scrollToBottom();
  });

  function setupResizeObserver() {
    if (!composerEl || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const stick = isNearBottom();
      updateSpacer();
      if (stick) scrollToBottom();
    });
    ro.observe(composerEl);
  }

  function setupViewportListener() {
    if (!window.visualViewport) return;
    window.visualViewport.addEventListener("resize", () => {
      const stick = isNearBottom();
      updateSpacer();
      if (stick) scrollToBottom();
    });
  }

  window.addEventListener("resize", () => {
    const stick = isNearBottom();
    updateSpacer();
    if (stick) scrollToBottom();
  });

  function setSending(next) {
    isSending = next;
    sendBtn.disabled = next;
    sendBtn.textContent = next ? "..." : "Send";
    composerEl.classList.toggle("is-sending", next);
  }

  async function send() {
    if (isSending) return;
    updateSpacer();
    const text = inputEl.value.trim();
    if (!text) return;

    setSending(true);

    const userRow = makeRow("user");
    userRow.bubble.textContent = text;

    const inEst = estimateTokens(text);
    totalInEstimate += inEst;
    userRow.stats.textContent = `Input ≈${inEst} | Total In ≈${totalInEstimate}`;

    session.push({ role: "user", content: text });
    persistSessionIfEnabled();

    inputEl.value = "";
    inputEl.style.height = "auto";
    updateSpacer();
    scrollToBottom();

    const aiRow = makeRow("assistant");
    aiRow.bubble.textContent = "";
    aiRow.stats.textContent = "Thinking...";

    let outStartMs = 0;
    let outEndMs = 0;
    let full = "";
    let exactUsage = null;

    let customPrompt = "";
    if (!useBuiltin && promptEnabled) {
      customPrompt = localStorage.getItem(LS_CUSTOM_PROMPT) || "";
    }

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: modelSel.value,
          use_builtin_persona: useBuiltin,
          custom_system_prompt: customPrompt,
          messages: session
        })
      });

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        aiRow.bubble.textContent = `Request failed (${res.status}):\n${t || "Unknown error"}`;
        aiRow.stats.textContent = "";
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.replace("data: ", "").trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const parsed = JSON.parse(jsonStr);
            if (parsed.usage) exactUsage = parsed.usage;

            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              if (!outStartMs) outStartMs = performance.now();
              full += delta;
              aiRow.bubble.textContent = full;
              aiRow.stats.textContent = "";
              if (isNearBottom()) scrollToBottom();
            }
          } catch {}
        }
      }

      outEndMs = performance.now();
      if (!full) {
        aiRow.bubble.textContent = "No content returned.";
        aiRow.stats.textContent = "";
        return;
      }

      session.push({ role: "assistant", content: full });
      persistSessionIfEnabled();

      const seconds = Math.max(0.001, (outEndMs - (outStartMs || outEndMs)) / 1000);

      if (exactUsage && typeof exactUsage.completion_tokens === "number") {
        const p = exactUsage.prompt_tokens || 0;
        const c = exactUsage.completion_tokens || 0;
        const t = exactUsage.total_tokens || (p + c);

        totalPromptTokens += p;
        totalCompletionTokens += c;

        const tps = c / seconds;
        aiRow.stats.textContent =
          `Prompt ${p} | Completion ${c} | Total ${t} | ${tps.toFixed(2)} tok/s | Cum ${totalPromptTokens}/${totalCompletionTokens}`;
      } else {
        const outEst = estimateTokens(full);
        totalOutEstimate += outEst;
        const tps = outEst / seconds;
        aiRow.stats.textContent =
          `Output ≈${outEst} | Total Out ≈${totalOutEstimate} | ${tps.toFixed(2)} tok/s`;
      }
    } catch (err) {
      aiRow.bubble.textContent = `Request failed:\n${err?.message || String(err)}`;
      aiRow.stats.textContent = "";
    } finally {
      setSending(false);
      updateSpacer();
      scrollToBottom();
    }
  }

  sendBtn.addEventListener("click", send);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  function init() {
    initTheme();
    initModels();
    setupResizeObserver();
    setupViewportListener();
    updateSpacer();
    restoreSessionIfEnabled();
    updateEmptyState();
    scrollToBottom();
  }

  init();
})();

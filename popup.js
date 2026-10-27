const $ = (id) => document.getElementById(id);
const textEl = $("text");
const wpmEl = $("wpm");
const wpmRangeEl = $("wpmRange");
const delayEl = $("delay");
const humanizeEl = $("humanize");
const startBtn = $("start");
const stopBtn = $("stop");
const statusEl = $("status");

const CHARS_PER_WORD = 5; // standard WPM definition

function setStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle("error", isError);
}

function setRunning(running) {
  startBtn.disabled = running;
  stopBtn.disabled = !running;
}

function getWpm() {
  const n = Math.round(Number(wpmEl.value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 2000) : 60;
}

function updateMeta() {
  const text = textEl.value;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  $("wordCount").textContent = `${words} word${words === 1 ? "" : "s"} · ${text.length} chars`;
  $("wpmValue").textContent = getWpm();
  if (text.length) {
    const secs = Math.round((text.length / CHARS_PER_WORD / getWpm()) * 60);
    $("eta").textContent = `≈ ${secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`}`;
  } else {
    $("eta").textContent = "";
  }
}

function saveSettings() {
  chrome.storage.local.set({
    text: textEl.value,
    wpm: getWpm(),
    delay: Number(delayEl.value) || 0,
    humanize: humanizeEl.checked,
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ["content.js"],
  });
}

// --- wire up inputs ---
wpmRangeEl.addEventListener("input", () => {
  wpmEl.value = wpmRangeEl.value;
  updateMeta();
  saveSettings();
});
wpmEl.addEventListener("input", () => {
  wpmRangeEl.value = Math.min(getWpm(), Number(wpmRangeEl.max));
  updateMeta();
  saveSettings();
});
textEl.addEventListener("input", () => { updateMeta(); saveSettings(); });
delayEl.addEventListener("input", saveSettings);
humanizeEl.addEventListener("change", saveSettings);

startBtn.addEventListener("click", async () => {
  const text = textEl.value;
  if (!text) {
    setStatus("Enter a paragraph to type first.", true);
    return;
  }
  const tab = await getActiveTab();
  try {
    await injectContentScript(tab.id);
  } catch (e) {
    setStatus("Can't type on this page (browser pages and the Web Store are blocked). Open a normal website and try again.", true);
    return;
  }
  // At least 1s so the popup can close and the page gets focus back.
  const delay = Math.max(1, Math.min(30, Number(delayEl.value) || 0));
  chrome.tabs.sendMessage(tab.id, {
    type: "autotyper:start",
    text,
    wpm: getWpm(),
    delay,
    humanize: humanizeEl.checked,
  }).catch(() => {});
  setRunning(true);
  setStatus(`Starting in ${delay}s — click into the text field now. You can stop from the on-page badge.`);
  // Close so the page can receive focus; typing continues in the page.
  setTimeout(() => window.close(), 600);
});

stopBtn.addEventListener("click", async () => {
  const tab = await getActiveTab();
  chrome.tabs.sendMessage(tab.id, { type: "autotyper:stop" }).catch(() => {});
  setRunning(false);
  setStatus("Stopped.");
});

// --- init ---
(async () => {
  const s = await chrome.storage.local.get({ text: "", wpm: 60, delay: 3, humanize: true });
  textEl.value = s.text;
  wpmEl.value = s.wpm;
  wpmRangeEl.value = Math.min(s.wpm, Number(wpmRangeEl.max));
  delayEl.value = s.delay;
  humanizeEl.checked = s.humanize;
  updateMeta();

  // Ask the page whether a typing session is already in progress.
  const tab = await getActiveTab();
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { type: "autotyper:status" });
    if (res && res.running) {
      setRunning(true);
      setStatus(`Typing… ${res.progress}% done.`);
    }
  } catch {
    // Content script not injected in this tab yet — nothing running.
  }
})();

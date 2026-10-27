// Injected into every frame of the active tab when the user presses Start.
// Types the given text into the focused editable element at the requested WPM.
(() => {
  if (window.__autoTyperLoaded) return;
  window.__autoTyperLoaded = true;

  const CHARS_PER_WORD = 5; // standard WPM definition
  const isTop = window === window.top;

  let session = null; // { phase: "countdown" | "typing", plan, index, target, timer }

  // ---------- helpers ----------

  function isTextInput(el) {
    if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
    if (el instanceof HTMLInputElement) {
      const t = (el.type || "text").toLowerCase();
      return ["text", "search", "email", "url", "tel", "password", "number", ""].includes(t)
        && !el.readOnly && !el.disabled;
    }
    return false;
  }

  function editableTarget() {
    let el = document.activeElement;
    // Descend into open shadow roots (web components).
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el || el === document.body) return null;
    if (isTextInput(el) || el.isContentEditable) return el;
    return null;
  }

  function insertChar(target, ch) {
    const isContentEditable = target.isContentEditable;
    const isTextarea = target instanceof HTMLTextAreaElement;

    if (ch === "\n" || ch === "\r") {
      if (ch === "\r") return; // \r\n -> handle on the \n
      if (isContentEditable) {
        if (document.execCommand("insertLineBreak")) return;
      } else if (!isTextarea) {
        ch = " "; // single-line inputs can't hold newlines
      }
    }

    // execCommand fires real input events, keeps undo history and works with
    // React/Vue-controlled fields and most rich-text editors.
    if (document.execCommand("insertText", false, ch)) return;

    // Fallbacks if execCommand is unavailable.
    if (!isContentEditable) {
      try {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        target.setRangeText(ch, start, end, "end");
      } catch {
        target.value += ch; // e.g. type=email/number don't support selection APIs
      }
      target.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
    } else {
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(ch);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      target.dispatchEvent(new InputEvent("input", { bubbles: true, data: ch, inputType: "insertText" }));
    }
  }

  function backspace(target) {
    if (document.execCommand("delete")) return;

    // Fallbacks if execCommand is unavailable.
    if (!target.isContentEditable) {
      try {
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? target.value.length;
        if (start === end && start > 0) target.setRangeText("", start - 1, end, "end");
        else target.setRangeText("", start, end, "end");
      } catch {
        target.value = Array.from(target.value).slice(0, -1).join("");
      }
    } else {
      const sel = window.getSelection();
      if (sel.isCollapsed) sel.modify("extend", "backward", "character");
      sel.deleteFromDocument();
    }
    target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  }

  // ---------- typo planning ----------

  // Neighbouring keys on a QWERTY keyboard, used to make believable mistakes.
  const NEIGHBOURS = {
    q: "wa", w: "qeas", e: "wrsd", r: "etdf", t: "ryfg", y: "tugh", u: "yihj", i: "uojk", o: "ipkl", p: "ol",
    a: "qwsz", s: "awedxz", d: "serfcx", f: "drtgvc", g: "ftyhbv", h: "gyujnb", j: "huikmn", k: "jiolm", l: "kop",
    z: "asx", x: "zsdc", c: "xdfv", v: "cfgb", b: "vghn", n: "bhjm", m: "njk",
  };
  const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));

  function wrongKeyFor(ch) {
    const lower = ch.toLowerCase();
    const options = NEIGHBOURS[lower];
    if (!options) return "abcdefghijklmnopqrstuvwxyz"[randInt(0, 25)];
    const wrong = options[randInt(0, options.length - 1)];
    return ch === lower ? wrong : wrong.toUpperCase();
  }

  // Turns the text into a list of keystrokes. With typos on, every 20-25
  // correct characters it types 2-6 wrong keys, pauses as if noticing the
  // mistake, then backspaces them before carrying on.
  function planKeystrokes(chars, typos) {
    const plan = [];
    let nextTypoAt = randInt(20, 25);
    for (let i = 0; i < chars.length; i++) {
      if (typos && i === nextTypoAt && chars[i] !== "\n" && chars[i] !== "\r") {
        const count = randInt(2, 6);
        for (let k = 0; k < count; k++) {
          const intended = chars[i + k] && !/\s/.test(chars[i + k]) ? chars[i + k] : "";
          plan.push({ key: wrongKeyFor(intended), weight: 1 });
        }
        for (let k = 0; k < count; k++) plan.push({ key: "Backspace", weight: k === 0 ? 4 : 0.8 });
        plan.push({ key: chars[i], weight: 1.5 }); // a beat before retyping
        nextTypoAt = i + randInt(20, 25);
        continue;
      }
      if (typos && i === nextTypoAt) nextTypoAt++; // don't start a typo on a line break
      plan.push({ key: chars[i], weight: 1 });
    }
    return plan;
  }

  // ---------- on-page badge ----------

  let badgeHost = null;
  let badgeText = null;

  function showBadge(message) {
    if (!badgeHost) {
      badgeHost = document.createElement("div");
      badgeHost.style.cssText = "all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;";
      const root = badgeHost.attachShadow({ mode: "closed" });
      root.innerHTML = `
        <style>
          .b { display:flex; align-items:center; gap:10px; padding:8px 10px 8px 12px;
               background:#111827; color:#f9fafb; border-radius:8px;
               font:13px/1.3 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
               box-shadow:0 4px 14px rgba(0,0,0,.25); }
          button { all:unset; cursor:pointer; padding:4px 10px; border-radius:6px;
                   background:#dc2626; color:#fff; font-weight:600; }
          button:hover { background:#b91c1c; }
        </style>
        <div class="b"><span></span><button type="button">Stop</button></div>`;
      badgeText = root.querySelector("span");
      const btn = root.querySelector("button");
      // Keep focus in the text field when clicking Stop.
      btn.addEventListener("mousedown", (e) => e.preventDefault());
      btn.addEventListener("click", () => stop("Stopped."));
      (document.body || document.documentElement).appendChild(badgeHost);
    }
    badgeText.textContent = message;
  }

  function hideBadge(finalMessage) {
    if (!badgeHost) return;
    if (finalMessage) {
      badgeText.textContent = finalMessage;
      const host = badgeHost;
      badgeHost = badgeText = null;
      setTimeout(() => host.remove(), 2000);
    } else {
      badgeHost.remove();
      badgeHost = badgeText = null;
    }
  }

  // ---------- typing session ----------

  function stop(message) {
    if (!session) return;
    clearTimeout(session.timer);
    session = null;
    hideBadge(message);
  }

  function start({ text, wpm, delay, humanize, typos }) {
    stop();
    const chars = Array.from(text); // code points, so emoji aren't split
    const plan = planKeystrokes(chars, typos);
    // Spread the time for the text itself over every keystroke (typos and
    // backspaces included), so the finished text still arrives at the chosen WPM.
    const totalMs = (chars.length / (wpm * CHARS_PER_WORD)) * 60000;
    const interval = totalMs / plan.reduce((sum, k) => sum + k.weight, 0);
    session = { phase: "countdown", plan, index: 0, target: null, timer: null };
    const s = session;

    let remaining = Math.max(0, Math.round(delay));
    const tick = () => {
      if (session !== s) return;
      if (remaining > 0) {
        if (isTop) showBadge(`Auto Typer: click a text field — starting in ${remaining}s`);
        remaining--;
        s.timer = setTimeout(tick, 1000);
        return;
      }
      begin(s, interval, humanize);
    };
    tick();
  }

  function begin(s, interval, humanize) {
    const target = editableTarget();
    if (!target) {
      // Another frame (an iframe holding focus) may be the one to type.
      const focusInChildFrame = document.activeElement instanceof HTMLIFrameElement
        || document.activeElement instanceof HTMLFrameElement;
      if (isTop && !focusInChildFrame) {
        stop("No text field focused — click into one and press Start again.");
      } else {
        session = null;
        if (isTop) hideBadge();
      }
      return;
    }
    // In a child frame, only the frame that actually has focus types.
    if (!isTop && !document.hasFocus()) {
      session = null;
      return;
    }
    if (isTop) hideBadge();

    s.phase = "typing";
    s.target = target;
    let next = performance.now();

    const step = () => {
      if (session !== s) return;
      if (editableTarget() !== target) {
        stop("Stopped: focus left the text field.");
        return;
      }
      const { key } = s.plan[s.index];
      if (key === "Backspace") backspace(target);
      else insertChar(target, key);
      s.index++;
      if (s.index >= s.plan.length) {
        stop("Done typing ✓");
        return;
      }
      const pct = Math.floor((s.index / s.plan.length) * 100);
      showBadge(`Auto Typer: typing… ${pct}%`);

      // Jitter averages to 1, so the overall speed still matches the chosen WPM.
      const factor = humanize ? 0.5 + Math.random() : 1;
      next += interval * s.plan[s.index].weight * factor;
      const now = performance.now();
      if (now - next > 500) next = now; // fell far behind (e.g. throttled); don't burst
      s.timer = setTimeout(step, Math.max(0, next - now));
    };
    step();
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "autotyper:start") {
      start(msg);
    } else if (msg.type === "autotyper:stop") {
      stop("Stopped.");
    } else if (msg.type === "autotyper:status") {
      // Only the frame doing the work answers; others stay silent.
      if (session && (session.phase === "typing" || isTop)) {
        sendResponse({
          running: true,
          progress: session.plan.length ? Math.floor((session.index / session.plan.length) * 100) : 0,
        });
      }
    }
  });
})();

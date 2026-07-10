"use strict";

// =====================================================================
// The automation runs HERE, in the service worker, not in the popup.
// Focusing the form tab (chrome.tabs.update({active:true})) closes the
// popup, which would tear down its JS context mid-run and abandon the
// remaining entries. The worker survives that, reports progress through
// chrome.storage.local, and the popup just renders whatever it finds.
// =====================================================================

const FORM_URL = "https://techzu.fillout.com/t/uhz6TddCX2us";

let running = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "fill") {
    if (running) {
      sendResponse({ started: false, error: "A fill is already in progress." });
      return false;
    }
    running = true;
    sendResponse({ started: true });
    // Deliberately not awaited: the popup is about to close anyway.
    run(msg.name, msg.date, msg.rows).finally(() => {
      running = false;
    });
    return false;
  }
  if (msg && msg.type === "status") {
    sendResponse({ running });
    return false;
  }
  return false;
});

function setStatus(status) {
  return chrome.storage.local.set({ fillStatus: { ...status, at: Date.now() } });
}

async function run(name, date, rows) {
  await setStatus({ state: "running", done: 0, total: rows.length, message: "Opening form…" });
  try {
    const tabId = await ensureFormTab(name, date);
    await setStatus({ state: "running", done: 0, total: rows.length, message: "Selecting name…" });
    const out = await fillFormOnPage(tabId, rows, name);
    if (out.error) {
      await setStatus({
        state: "error",
        done: out.added,
        total: rows.length,
        message: `Stopped after ${out.added}/${rows.length}: ${out.error}`,
      });
    } else {
      await setStatus({
        state: "done",
        done: out.added,
        total: rows.length,
        message: `${out.added} entries added. Review, then click the form's own Submit.`,
      });
    }
  } catch (err) {
    await setStatus({ state: "error", done: 0, total: rows.length, message: err.message });
  }
}

// ---------- tab lifecycle ----------

function formUrl(name, date) {
  const u = new URL(FORM_URL);
  u.searchParams.set("name", name);
  if (date) u.searchParams.set("date", date);
  return u.toString();
}

async function ensureFormTab(name, date) {
  const url = formUrl(name, date);
  const [existing] = await chrome.tabs.query({ url: FORM_URL + "*" });
  let tabId;
  if (existing) {
    tabId = existing.id;
    await chrome.tabs.update(tabId, { active: true });
    // CRITICAL: attach the onUpdated listener BEFORE navigating, and wait on
    // the event rather than polling tabs.get().status. Right after
    // tabs.update() resolves, tabs.get() can still report the OLD "complete"
    // status for a moment; a poll landing in that gap treats the navigation
    // as finished and drives a page that is about to be torn down, silently
    // losing everything it just did (e.g. the Name selection).
    const loaded = waitForTabLoadComplete(tabId);
    await chrome.tabs.update(tabId, { url });
    await loaded;
  } else {
    // A brand-new tab has no stale "complete" to read, so polling is safe.
    const tab = await chrome.tabs.create({ url, active: true });
    tabId = tab.id;
    await waitTabComplete(tabId);
  }
  // "complete" only means the document loaded; the React app can take another
  // second or more to become interactive. Poll for the real thing.
  await waitForFormReady(tabId);
  return tabId;
}

function waitForTabLoadComplete(tabId, timeout = 30000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const timer = setTimeout(finish, timeout);
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        finish();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function waitTabComplete(tabId, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const t = await chrome.tabs.get(tabId);
    if (t.status === "complete") return;
    await sleep(200);
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// =====================================================================
// FORM AUTOMATION — Fillout's "Create" opens a genuine <iframe> subform: a
// separate document with its own react-select instances, invisible to a
// top-frame script. Orchestration below alternates executeScript calls
// between the top frame (frameId 0) and the discovered subform frameId.
//
//   - Name/Project/Category are react-select (`.react-select__control`,
//     `.react-select__placeholder`, `input[role=combobox]`,
//     `.react-select__single-value`) — driven by setting the input value and
//     dispatching a synthetic Enter keydown, exactly as react-select's own
//     type-to-search handles a human.
//   - The subform's own "Submit" button lives entirely inside that iframe's
//     document, so clicking it there can never reach the main form's final
//     Submit. That one is always left for the user.
// =====================================================================

function pageFormReady() {
  const hasNamePlaceholder = [...document.querySelectorAll(".react-select__placeholder")]
    .some((e) => e.textContent.trim() === "Name" && e.offsetParent !== null);
  const hasNameValue = document.querySelectorAll(".react-select__single-value").length > 0;
  const hasCreate = [...document.querySelectorAll("button,[role=button],a,div,span")]
    .some((n) => n.textContent.trim() === "Create" && n.children.length === 0 && n.offsetParent !== null);
  return hasNamePlaceholder || hasNameValue || hasCreate;
}

async function waitForFormReady(tabId, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const [res] = await chrome.scripting
      .executeScript({ target: { tabId }, func: pageFormReady })
      .catch(() => [{}]);
    if (res && res.result) return true;
    await sleep(300);
  }
  return false;
}

function pageSelectName(name) {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const setNative = (el, val) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const fire = (el, type, extra) =>
    el.dispatchEvent(
      new (type.startsWith("key") ? KeyboardEvent : MouseEvent)(type, {
        bubbles: true,
        cancelable: true,
        ...extra,
      }),
    );
  // The ?name= URL param may have prefilled it already.
  const already = [...document.querySelectorAll(".react-select__single-value")]
    .find((e) => norm(e.textContent) === name);
  if (already) return { skipped: true };
  const ph = [...document.querySelectorAll(".react-select__placeholder")]
    .find((e) => norm(e.textContent) === "Name" && e.offsetParent !== null);
  if (!ph) return { error: "Name field not found" };
  const control = ph.closest(".react-select__control");
  const input = control.querySelector("input[role=combobox]");
  fire(input, "mousedown");
  input.focus();
  setNative(input, name);
  return new Promise((resolve) => {
    setTimeout(() => {
      fire(input, "keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13 });
      setTimeout(() => {
        const sv = control.querySelector(".react-select__single-value");
        resolve(sv && norm(sv.textContent) === name ? { ok: true } : { error: `could not select name "${name}"` });
      }, 350);
    }, 450);
  });
}

function pageClickCreate() {
  const fire = (el, type) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  const el = [...document.querySelectorAll("button,[role=button],a,div,span")]
    .find((n) => n.textContent.trim() === "Create" && n.children.length === 0 && n.offsetParent !== null);
  if (!el) return { error: "Create button not found" };
  ["pointerdown", "mousedown", "mouseup", "click"].forEach((t) => fire(el, t));
  return { ok: true };
}

// Run with allFrames:true — true only inside the subform iframe once loaded.
function probeSubform() {
  return !!document.querySelector('input[placeholder="Task Description"]');
}

// After a submit, Fillout's "Timesheet Entries" list does its own async
// refetch/re-render before the new entry's text appears. Clicking "Create"
// again while that is still in flight can hit a transitional node whose
// handler no longer fires — the "worked once, then silently did nothing"
// failure. Confirm the entry is visible before the next Create.
function pageEntryVisible(description) {
  return document.body.innerText.includes(description);
}

// Targeted at the discovered subform frameId only — physically cannot see or
// click the main page's final Submit button.
function frameFillEntry(entry) {
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
  const setNative = (el, val) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, val);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  };
  const fire = (el, type, extra) =>
    el.dispatchEvent(
      new (type.startsWith("key") ? KeyboardEvent : MouseEvent)(type, {
        bubbles: true,
        cancelable: true,
        ...extra,
      }),
    );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const selectReact = async (placeholder, value) => {
    const ph = [...document.querySelectorAll(".react-select__placeholder")]
      .find((e) => norm(e.textContent) === placeholder && e.offsetParent !== null);
    if (!ph) throw new Error(`dropdown "${placeholder}" not found`);
    const control = ph.closest(".react-select__control");
    const input = control.querySelector("input[role=combobox]");
    fire(input, "mousedown");
    input.focus();
    setNative(input, value);
    await sleep(400);
    fire(input, "keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13 });
    await sleep(300);
    const sv = control.querySelector(".react-select__single-value");
    if (!sv || norm(sv.textContent) !== value) throw new Error(`could not select "${value}" for "${placeholder}"`);
  };
  const setByPlaceholder = (placeholder, value) => {
    const inp = [...document.querySelectorAll("input,textarea")].find((i) => i.placeholder === placeholder);
    if (!inp) throw new Error(`input "${placeholder}" not found`);
    setNative(inp, value);
  };
  return (async () => {
    try {
      await selectReact("Select Project", entry.project);
      await selectReact("Select Work Category", entry.category);
      setByPlaceholder("Task Description", entry.description);
      setByPlaceholder("Hours Clocked (hh:mm)", entry.hhmm);
      await sleep(150);
      const submitBtn = [...document.querySelectorAll("button,[role=button]")]
        .find((b) => norm(b.textContent) === "Submit"); // scoped to this iframe document only
      if (!submitBtn) throw new Error("modal Submit button not found");
      ["pointerdown", "mousedown", "mouseup", "click"].forEach((t) => fire(submitBtn, t));
      return { ok: true };
    } catch (err) {
      return { error: err.message };
    }
  })();
}

// ---------- cross-frame orchestration ----------

async function waitForSubframe(tabId, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const results = await chrome.scripting
      .executeScript({ target: { tabId, allFrames: true }, func: probeSubform })
      .catch(() => []);
    const hit = results.find((r) => r.frameId !== 0 && r.result === true);
    if (hit) return hit.frameId;
    await sleep(400);
  }
  return null;
}

async function waitForSubframeGone(tabId, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const results = await chrome.scripting
      .executeScript({ target: { tabId, allFrames: true }, func: probeSubform })
      .catch(() => []);
    if (!results.some((r) => r.result === true)) return true;
    await sleep(400);
  }
  return false;
}

// Best-effort: a long description gets visually truncated, so a miss here
// doesn't mean the entry failed. It only buys the list time to settle.
async function waitForEntryVisible(tabId, description, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const [res] = await chrome.scripting
      .executeScript({ target: { tabId }, func: pageEntryVisible, args: [description] })
      .catch(() => [{}]);
    if (res && res.result) return true;
    await sleep(300);
  }
  return false;
}

async function fillFormOnPage(tabId, rows, name) {
  let added = 0;
  try {
    const [nameRes] = await chrome.scripting.executeScript({
      target: { tabId },
      func: pageSelectName,
      args: [name],
    });
    if (nameRes.result && nameRes.result.error) throw new Error(nameRes.result.error);

    for (const row of rows) {
      await setStatus({
        state: "running",
        done: added,
        total: rows.length,
        message: `Adding ${added + 1}/${rows.length}: ${row.project}…`,
      });

      const [createRes] = await chrome.scripting.executeScript({ target: { tabId }, func: pageClickCreate });
      if (createRes.result && createRes.result.error) throw new Error(createRes.result.error);

      const frameId = await waitForSubframe(tabId);
      if (frameId == null) throw new Error(`modal did not open for "${row.project}"`);

      const [fillRes] = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [frameId] },
        func: frameFillEntry,
        args: [row],
      });
      if (fillRes.result && fillRes.result.error) throw new Error(fillRes.result.error);

      await waitForSubframeGone(tabId);
      await waitForEntryVisible(tabId, row.description);
      added++;
    }
    return { added };
  } catch (err) {
    return { error: err.message, added };
  }
}

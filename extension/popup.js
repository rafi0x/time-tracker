"use strict";

const FORM_URL = "https://techzu.fillout.com/t/uhz6TddCX2us";
const HEADER = ["date", "project", "category", "task", "time"];

const $ = (id) => document.getElementById(id);

const S = {
  name: "",
  names: [],
  csv: "",
  rows: [], // { date, project, category, description, hhmm, error }
  picked: new Set(), // indices into S.rows
};

// ---------- CSV ----------

/** RFC 4180: quoted fields, "" escapes, CRLF or LF line endings. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') (field += '"'), i++;
      else quoted = false;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

function todayStr() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hhmmToMin(hhmm) {
  const m = /^(\d{1,3}):([0-5]\d)$/.exec(hhmm.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function minToHhMm(min) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
}

/**
 * Accepts the header row Time Tracker emits, and also headerless CSV in the
 * same column order.
 */
function toRows(text) {
  const grid = parseCsv(text);
  if (!grid.length) return [];
  const first = grid[0].map((c) => c.trim().toLowerCase());
  const hasHeader = HEADER.every((h) => first.includes(h));
  const idx = hasHeader
    ? Object.fromEntries(HEADER.map((h) => [h, first.indexOf(h)]))
    : Object.fromEntries(HEADER.map((h, i) => [h, i]));

  return grid.slice(hasHeader ? 1 : 0).map((cells) => {
    const at = (key) => (cells[idx[key]] ?? "").trim();
    const row = {
      date: at("date") || todayStr(),
      project: at("project"),
      category: at("category"),
      description: at("task"),
      hhmm: at("time"),
    };
    const minutes = hhmmToMin(row.hhmm);
    if (!row.project) row.error = "no project";
    else if (!row.category) row.error = "no category";
    else if (!row.description) row.error = "no task description";
    else if (minutes === null) row.error = `bad time "${row.hhmm}"`;
    else if (minutes === 0) row.error = "00:00 — nothing to log";
    return row;
  });
}

// ---------- rendering ----------

function setStatus(el, text, kind) {
  el.className = "status" + (kind ? " " + kind : "");
  el.textContent = text;
}

function route() {
  $("setup").classList.toggle("hidden", !!S.name);
  $("main").classList.toggle("hidden", !S.name);
  if (S.name) $("whoName").textContent = S.name;
}

function renderPreview() {
  const box = $("preview");
  box.textContent = "";
  if (!S.rows.length) {
    $("fillBtn").disabled = true;
    return;
  }

  const pickedMin = [...S.picked].reduce((sum, i) => sum + (hhmmToMin(S.rows[i].hhmm) ?? 0), 0);
  const summary = document.createElement("div");
  summary.className = "summary";
  summary.append(
    Object.assign(document.createElement("span"), {
      textContent: `${S.picked.size} of ${S.rows.length} selected`,
    }),
    Object.assign(document.createElement("span"), { textContent: minToHhMm(pickedMin) }),
  );

  const list = document.createElement("ul");
  list.className = "entries";
  S.rows.forEach((row, i) => {
    const li = document.createElement("li");
    li.className = "entry" + (row.error ? " invalid" : "");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = S.picked.has(i);
    cb.disabled = !!row.error;
    cb.addEventListener("change", () => {
      cb.checked ? S.picked.add(i) : S.picked.delete(i);
      renderPreview();
    });

    const body = document.createElement("div");
    body.className = "body";
    body.append(
      Object.assign(document.createElement("div"), {
        className: "desc",
        textContent: row.description || "(no description)",
      }),
      Object.assign(document.createElement("div"), {
        className: "meta",
        textContent: [row.project, row.category].filter(Boolean).join(" · ") || "—",
      }),
    );
    if (row.error) {
      body.append(
        Object.assign(document.createElement("div"), { className: "why", textContent: row.error }),
      );
    }

    li.append(
      cb,
      body,
      Object.assign(document.createElement("span"), { className: "hhmm", textContent: row.hhmm }),
    );
    list.append(li);
  });

  box.append(summary, list);
  $("fillBtn").disabled = S.picked.size === 0;
}

function loadCsv(text) {
  S.csv = text;
  S.rows = toRows(text);
  S.picked = new Set(S.rows.map((r, i) => (r.error ? -1 : i)).filter((i) => i >= 0));
  chrome.storage.local.set({ csv: text });
  renderPreview();
}

// ---------- name setup ----------

/**
 * Names are static options embedded in the form's server-rendered
 * __NEXT_DATA__ (the Name dropdown widget) — fetch and parse, no tab needed.
 */
function parseNames(html) {
  const m = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) return [];
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch {
    return [];
  }
  let names = [];
  (function walk(o) {
    if (o && typeof o === "object") {
      const staticOptions = o.name === "Name" && o.template?.options?.staticOptions;
      if (staticOptions) {
        names = staticOptions
          .map((x) => {
            try {
              return x.value.logic.value;
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      }
      for (const k in o) walk(o[k]);
    }
  })(data);
  return names.sort((a, b) => a.localeCompare(b));
}

async function loadNames() {
  const st = $("setupStatus");
  setStatus(st, "Loading names…");
  try {
    const res = await fetch(FORM_URL, { credentials: "omit" });
    const names = parseNames(await res.text());
    if (!names.length) {
      setStatus(st, "Could not read names from the form.", "err");
      return;
    }
    S.names = names;
    await chrome.storage.local.set({ names });
    $("setupPicker").classList.remove("hidden");
    setStatus(st, `Loaded ${names.length} names. Pick yours.`, "ok");
  } catch (err) {
    setStatus(st, "Error: " + err.message, "err");
  }
}

/** Substring typeahead over a fixed list; click or Enter to pick. */
function setupCombo(input, listEl, getOptions) {
  let hi = 0;
  const render = (filter) => {
    const q = filter.trim().toLowerCase();
    const matches = getOptions().filter((o) => o.toLowerCase().includes(q));
    listEl.textContent = "";
    matches.forEach((o, i) => {
      const li = document.createElement("li");
      li.textContent = o;
      if (i === hi) li.className = "hi";
      li.addEventListener("mousedown", (e) => {
        e.preventDefault();
        pick(o);
      });
      listEl.append(li);
    });
    listEl.classList.toggle("hidden", !matches.length);
  };
  const pick = (value) => {
    input.value = value;
    listEl.classList.add("hidden");
  };
  input.addEventListener("focus", () => ((hi = 0), render(input.value)));
  input.addEventListener("input", () => ((hi = 0), render(input.value)));
  input.addEventListener("keydown", (e) => {
    const rows = [...listEl.children];
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!rows.length) return;
      hi = (hi + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
      rows.forEach((r, i) => (r.className = i === hi ? "hi" : ""));
      rows[hi].scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rows[hi]) pick(rows[hi].textContent);
    } else if (e.key === "Escape") {
      listEl.classList.add("hidden");
    }
  });
  input.addEventListener("blur", () => setTimeout(() => listEl.classList.add("hidden"), 120));
}

async function saveName() {
  const value = $("nameInput").value.trim();
  if (!S.names.includes(value)) {
    setStatus($("setupStatus"), "Pick a name from the list.", "err");
    return;
  }
  S.name = value;
  await chrome.storage.local.set({ name: value });
  route();
}

// ---------- fill ----------

function renderFillStatus(status) {
  const el = $("fillStatus");
  if (!status) return setStatus(el, "");
  const kind = status.state === "done" ? "ok" : status.state === "error" ? "err" : "";
  setStatus(el, status.message, kind);
  $("fillBtn").disabled = status.state === "running" || S.picked.size === 0;
}

async function fill() {
  const rows = [...S.picked].sort((a, b) => a - b).map((i) => S.rows[i]);
  if (!rows.length) return;
  const res = await chrome.runtime.sendMessage({
    type: "fill",
    name: S.name,
    date: rows[0].date,
    rows: rows.map(({ project, category, description, hhmm }) => ({
      project,
      category,
      description,
      hhmm,
    })),
  });
  if (!res || !res.started) {
    setStatus($("fillStatus"), (res && res.error) || "Could not start.", "err");
    return;
  }
  // Focusing the form tab closes this popup; the worker keeps going and
  // publishes progress, which the popup picks up whenever it's reopened.
  $("fillBtn").disabled = true;
  setStatus($("fillStatus"), "Opening form…");
}

// ---------- wiring ----------

async function init() {
  const st = await chrome.storage.local.get(["name", "names", "csv", "fillStatus"]);
  S.name = st.name || "";
  S.names = st.names || [];
  route();
  if (S.names.length) $("setupPicker").classList.remove("hidden");
  if (st.csv) {
    $("csv").value = st.csv;
    loadCsv(st.csv);
  }
  renderFillStatus(st.fillStatus);
}

document.addEventListener("DOMContentLoaded", () => {
  $("loadNames").onclick = loadNames;
  $("saveName").onclick = saveName;
  $("changeName").onclick = () => {
    S.name = "";
    chrome.storage.local.remove("name");
    route();
  };
  $("csv").addEventListener("input", (e) => loadCsv(e.target.value));
  $("pasteBtn").onclick = async () => {
    try {
      const text = await navigator.clipboard.readText();
      $("csv").value = text;
      loadCsv(text);
    } catch (err) {
      setStatus($("fillStatus"), "Clipboard read failed: " + err.message, "err");
    }
  };
  $("clearBtn").onclick = () => {
    $("csv").value = "";
    loadCsv("");
    chrome.storage.local.remove("fillStatus");
    setStatus($("fillStatus"), "");
  };
  $("fillBtn").onclick = fill;

  setupCombo($("nameInput"), $("nameList"), () => S.names);

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.fillStatus) renderFillStatus(changes.fillStatus.newValue);
  });

  init();
});

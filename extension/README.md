# Timesheet CSV Autofill

A Chrome extension that takes a day's activity CSV — copied straight out of
the Time Tracker app with **Copy CSV** — and types it into the Techzu
**Daily Timesheet Form** on Fillout for you, stopping right before the form's
own final Submit so you always review before sending.

## Flow

```
Time Tracker  ──Copy CSV──▶  clipboard  ──paste──▶  extension  ──autofill──▶  Fillout form
                                                        │
                                                   your name
                                              (asked once, stored)
```

The tracker owns the data (projects, categories, task titles, times); the
extension owns the identity (your name) and the browser automation. Nothing is
shared between them but the CSV text on your clipboard.

## CSV format

Emitted by the tracker's `Copy CSV` button (`GET /api/export?day=`), standard
RFC 4180 — quoted fields, `""` escapes:

```csv
date,project,category,task,time
2026-07-10,NewERP,Development,"Fix login, redirect",01:30
2026-07-10,ZuPOS,Code Review,PR review,00:45
```

`time` is `hh:mm`, matching the form's "Hours Clocked" field. Headerless CSV in
the same column order is accepted too.

## Install

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.

## Use

1. **First run** — click the extension icon → **Load names from form** → type
   to find your name → **Save**. Asked once, then remembered.
2. In Time Tracker, hit **Copy CSV** on the day you want to submit.
3. Click the extension icon → **Paste from clipboard** (or ⌘/Ctrl-V into the
   box). Each row appears as a checkbox. Rows missing a project or category,
   or sitting at `00:00`, are flagged and can't be selected.
4. Click **Fill form**. The extension opens the form, picks your name, and
   adds each selected entry.
5. **You click the form's own Submit** after reviewing — the extension never
   does this for you.

## How it works

- **Manifest V3**, no build step, no bundler, no dependencies. Plain HTML/CSS/JS.
- **The automation runs in the service worker, not the popup.** Focusing the
  form tab closes the popup, which would kill a popup-hosted run halfway
  through. The worker survives, and publishes progress to
  `chrome.storage.local.fillStatus`, which the popup renders whenever it's
  reopened.
- `chrome.scripting.executeScript` drives the page, including **cross-frame**
  injection: the form's "Create" button opens the project/category/description
  /time fields inside a genuine `<iframe>` subform, a separate document that a
  top-frame script can't see into. The subform's own Submit button lives only
  in that iframe, so filling and submitting there can never reach the main
  form's final Submit.
- The form's dropdowns are [react-select](https://react-select.com/);
  automation sets the input value and dispatches a synthetic `Enter` keydown —
  the same path react-select's own type-to-search takes for a human.
- Navigating the form tab waits on the `chrome.tabs.onUpdated` **event**, never
  a `tabs.get().status` poll: just after `tabs.update()` resolves, `tabs.get()`
  can still report the previous page's `complete`, and a poll landing in that
  window drives a page that's about to be torn down.

## Files

| File | Purpose |
|---|---|
| `manifest.json` | Extension configuration (MV3) |
| `popup.html` / `popup.css` | Popup UI |
| `popup.js` | Name setup, CSV parsing, preview & validation |
| `background.js` | Service worker — all form automation |
| `icons/` | Extension icon |

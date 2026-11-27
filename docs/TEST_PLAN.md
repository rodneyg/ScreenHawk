# ScreenHawk test plan for failure coverage

Based on T-2020's test gap map and T-2030's timing probe. Covered items run under `npm test`. Open items name the PR or task that owns the remaining coverage.

## Two-tab timing (`test/e2e.mjs`)

- **Covered**. Hold the mock response until Chromium reports that the second tab is active. Confirm the answer appears on the initiating tab while the second tab stays active and has no overlay. Releasing the response and waiting for the first answer before opening the second tab must fail the test.
- **Lesson from T-2030**. The earlier test still passed when it checked the answer before opening the second tab. A passing two-tab test needs to prove the response was held until tab activation. Deliberately reverse that order once to verify the test catches it.

## Background worker (`src/background.ts`)

- **Covered**. `test/permission-errors.test.cjs` checks denied injection, cleanup after a failed screenshot, and the ability to retry.
- **Covered**. A `chrome://` or `file://` page is rejected before injection or capture. Chrome Web Store permission errors use the injection failure path tested in PR #21.
- **Covered**. Switching away and back during capture discards the screenshot, removes the listener, and allows a new capture. No API request is made.
- **Covered**. A duplicate start is rejected without taking a second screenshot. Capture can start again when the first completes.
- **Covered**. An unanswered request aborts at its deadline and clears its timer. Cancellation affects only the initiating document, even when two documents share a request ID. PR #26 tests basic single-document cancellation.
- **Covered**. Invalid senders and malformed questions are ignored without a reply, a settings read, or an API request. PR #26 tests unknown actions.

## Keyboard shortcut feedback (`src/background.ts`)

- **Covered by T-99484123229959167**. A failed shortcut marks the affected tab, a successful shortcut and popup start clear the mark, completed navigation clears it, and a missing command tab is resolved to the active tab. Headless Chromium checks the mark on a `chrome://` tab and its removal after navigation.

## Content overlay (`src/content.ts`)

- **Covered**. At 320 × 420, the keyboard-only capture in `test/e2e.mjs` keeps the selector open for an empty selection. It checks focus on the question after marking both corners, submits by keyboard, and confirms Escape restores focus on the page.
- **Covered**. A tiny selection keeps the selection tool open, and a new drag can make a valid selection.
- **Covered**. A crop failure shows recovery instructions, disables Ask, and sends no question.
- **Covered**. A failed Ask message shows an error and restores the form.
- **Covered**. Closing during a request cancels its ID and ignores a late answer.
- **Covered**. A failed settings request directs the user to the toolbar menu.
- **Covered**. Retrying after a messaging failure reuses the question and crop and can show the answer.

## Options and popup (`src/options.ts` and `src/popup.ts`)

- **Covered**. Options shows recovery instructions on storage read or write failure. A failed read keeps the form disabled. A failed write re-enables it for a retry.
- **Covered**. `test/permission-errors.test.cjs` checks worker and runtime messaging failures, disabled capture controls during the request, and recovery.
- **Covered**. `test/options-popup-errors.test.mjs` checks that a failed send from any of the three start buttons disables all three while pending, shows the retry message, and enables them again.
- **Covered**. A history read failure shows `Could not load history.`, keeps Clear history disabled, leaves Select area usable, and loads history when the popup is reopened.
- **Covered**. A failed delete or clear (rejected message, missing reply, or a storage write error reply) keeps the saved entry, shows a retry message, and succeeds on retry.
- **Open**. The history read message gives no recovery step, and a rejected `openOptionsPage` call from the popup Settings link shows no message. Both need a change in `src/popup.ts`.

## API (`src/api.ts`)

- **Covered**. `test/prompt.test.cjs` checks HTTP errors, invalid response bodies, network failure, and key redaction.

## Store links (`site/store.js`)

- **Covered**. `test/site-analytics.test.mjs` checks the configured Store link and click events when the analytics script is missing or blocked.
- **Open**. The empty Store URL fallback has no automated coverage.

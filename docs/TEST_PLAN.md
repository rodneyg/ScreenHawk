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

## Content overlay (`src/content.ts`)

- **Covered**. A tiny selection keeps the selection tool open, and a new drag can make a valid selection.
- **Covered**. A crop failure shows recovery instructions, disables Ask, and sends no question.
- **Covered**. A failed Ask message shows an error and restores the form.
- **Covered**. Closing during a request cancels its ID and ignores a late answer.
- **Covered**. A failed settings request directs the user to the toolbar menu.
- **Covered**. Retrying after a messaging failure reuses the question and crop and can show the answer.

## Options and popup (`src/options.ts` and `src/popup.ts`)

- **Covered**. Options shows recovery instructions on storage read or write failure. A failed read keeps the form disabled. A failed write re-enables it for a retry.
- **Covered**. `test/permission-errors.test.cjs` checks worker and runtime messaging failures, disabled capture controls during the request, and recovery.

## API (`src/api.ts`)

- **Covered**. `test/prompt.test.cjs` checks HTTP errors, invalid response bodies, network failure, and key redaction.

## Store links (`site/store.js`)

- **Covered**. `test/site-analytics.test.mjs` checks the configured Store link and click events when the analytics script is missing or blocked.
- **Open**. The empty Store URL fallback has no automated coverage.

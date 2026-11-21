# ScreenHawk permissions

| Manifest permission | Why ScreenHawk needs it |
| --- | --- |
| `activeTab` | Temporarily access the active tab when the user starts a capture or draft. |
| `scripting` | Inject the packaged capture or draft overlay in the current tab on demand. |
| `storage` | Save the OpenAI API key, model setting, and recent interaction history in `chrome.storage.local`. |
| `https://api.openai.com/*` | Send the cropped screenshot and question or the reviewed field label and draft instructions to OpenAI Chat Completions when the user submits. The key is provided in the authorization header only for that endpoint. |

The manifest declares no standing permission to access sites other than the OpenAI API. The API key is accessible only to trusted extension contexts. ScreenHawk uses packaged JavaScript. It has no remote code or analytics.

The toolbar action and capture shortcut grant `activeTab` access. The service
worker uses it to read the active tab's URL and call
`chrome.tabs.captureVisibleTab`. It uses `scripting` to inject the packaged
`content.js` overlay into that tab.

The options page saves the key and model with `chrome.storage.local.set`.
The service worker reads them before sending a question.

The OpenAI entry is a host permission. It allows the extension service worker
to make a cross-origin request. Chrome applies the grant to the HTTPS host.
ScreenHawk sends the request to `/v1/chat/completions` when the user submits
a question and an API key is configured.

When changing a manifest permission, update the table with its current reason.
`npm test` checks that the table matches the manifest.

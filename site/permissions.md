# ScreenHawk 1.0.0 permissions

| Manifest permission | Why ScreenHawk needs it |
| --- | --- |
| `activeTab` | Temporarily access the active tab when the user starts a capture or draft. |
| `scripting` | Inject the packaged capture or draft overlay in the current tab on demand. |
| `storage` | Save the OpenAI API key, model setting, and recent interaction history in `chrome.storage.local`. |
| `https://api.openai.com/*` | Send the cropped screenshot and question or the reviewed field label and draft instructions to OpenAI Chat Completions when the user submits. The key is provided in the authorization header only for that endpoint. |

The manifest declares no standing permission to access sites other than the OpenAI API. The API key is accessible only to trusted extension contexts. ScreenHawk uses packaged JavaScript. It has no remote code or analytics.

# ScreenHawk extension privacy policy

**Draft for review**

Rodney Gainous Jr publishes ScreenHawk, a Chrome extension for asking questions about a selected area of a web page. The extension has no ScreenHawk account, developer server, or analytics.

## What stays in Chrome

ScreenHawk saves your OpenAI API key and model preference in `chrome.storage.local` on your device. When you start a capture, ScreenHawk takes a screenshot of the visible tab and crops it on your device to the area you select. ScreenHawk displays the answer in the tab where you asked the question and does not save a history of screenshots, questions, or answers.

## What goes to OpenAI

When you submit a question, ScreenHawk sends the selected image crop and your typed question directly to `api.openai.com` so OpenAI can generate an answer. The request includes your chosen model and uses your API key in the authorization header. The developer does not receive that request or the response. See OpenAI's API data controls for how OpenAI handles API data. [OpenAI API data controls](https://developers.openai.com/api/docs/guides/your-data)

## Chrome permissions

| Permission | What ScreenHawk uses it for |
| --- | --- |
| `activeTab` | Temporarily access the active tab after you start a capture. |
| `scripting` | Load the selection, question, and answer controls on that tab. |
| `storage` | Save your OpenAI API key and model preference in Chrome. |
| `https://api.openai.com/*` | Send your submitted image crop and question directly to OpenAI. |

## Remove your data

To remove the saved key from ScreenHawk, clear the key field in Settings and save. Uninstall ScreenHawk to remove its local settings. You can revoke the key in your OpenAI account. For data already sent to OpenAI, use the controls available through OpenAI.

## Contact

For ScreenHawk privacy questions, email Rodney Gainous Jr at [rodney.gainous@gmail.com](mailto:rodney.gainous@gmail.com).

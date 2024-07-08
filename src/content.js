// content.ts
var screenshot = null;
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "prepareCapture") {
        // Notify the background script to take a screenshot
        chrome.runtime.sendMessage({ action: "captureScreenshot" });
    }
    else if (request.action === "showPromptDialog") {
        screenshot = request.screenshot;
        showPromptDialog();
    }
});
function showPromptDialog() {
    var _a, _b;
    var dialog = document.createElement('div');
    dialog.style.cssText = "\n    position: fixed;\n    top: 50%;\n    left: 50%;\n    transform: translate(-50%, -50%);\n    background-color: white;\n    padding: 20px;\n    border-radius: 5px;\n    box-shadow: 0 0 10px rgba(0,0,0,0.3);\n    z-index: 10000;\n  ";
    dialog.innerHTML = "\n    <h2>Enter your prompt</h2>\n    <textarea id=\"prompt\" rows=\"4\" cols=\"50\" placeholder=\"Describe what you want to know about the screenshot\"></textarea>\n    <br><br>\n    <button id=\"submit\">Submit</button>\n    <button id=\"cancel\">Cancel</button>\n  ";
    document.body.appendChild(dialog);
    (_a = document.getElementById('submit')) === null || _a === void 0 ? void 0 : _a.addEventListener('click', function () {
        var promptElement = document.getElementById('prompt');
        var prompt = promptElement.value;
        chrome.runtime.sendMessage({ action: "sendToOpenAI", prompt: prompt, screenshot: screenshot });
        document.body.removeChild(dialog);
    });
    (_b = document.getElementById('cancel')) === null || _b === void 0 ? void 0 : _b.addEventListener('click', function () {
        document.body.removeChild(dialog);
    });
}

// popup.ts
Object.defineProperty(exports, "__esModule", { value: true });
document.addEventListener('DOMContentLoaded', function () {
    var captureButton = document.getElementById('captureButton');
    if (captureButton) {
        captureButton.addEventListener('click', function () {
            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                var activeTab = tabs[0];
                if (activeTab.id) {
                    chrome.tabs.sendMessage(activeTab.id, { action: "prepareCapture" });
                }
            });
            window.close(); // Close the popup after clicking
        });
    }
    else {
        console.error('Capture button not found');
    }
});

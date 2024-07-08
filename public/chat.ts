// chat.ts

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log("Chat page received message:", request);
    if (request.action === "displayResponse") {
      const responseElement = document.getElementById('response');
      if (responseElement) {
        responseElement.textContent = request.response;
      }
      sendResponse({status: "response displayed"});
    }
    return true;
  });
  
  console.log("Chat script loaded");
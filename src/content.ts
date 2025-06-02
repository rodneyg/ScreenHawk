// content.ts

import { compressImage, createThumbnail } from './imageUtils';

let screenshot: string | null = null;
let compressedScreenshot: string | null = null;
let thumbnail: string | null = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received message:", request);
  if (request.action === "prepareCapture") {
    console.log("Preparing capture...");
    chrome.runtime.sendMessage({action: "captureScreenshot"});
    console.log("Sent captureScreenshot message to background script");
    sendResponse({status: "preparing capture"});
  } else if (request.action === "showPromptDialog") {
    console.log("Showing prompt dialog...");
    screenshot = request.screenshot;
    console.log("Received screenshot:", request.screenshot);
    
    // Compress image and create thumbnail
    compressImageData(request.screenshot).then(() => {
      showPromptDialog();
    }).catch(error => {
      console.error("Error compressing image:", error);
      // Fallback to original screenshot
      compressedScreenshot = request.screenshot;
      thumbnail = request.screenshot;
      showPromptDialog();
    });
    
    sendResponse({status: "showing prompt dialog"});
  } else if (request.action === "displayError") {
    console.error("Error from OpenAI:", request.error);
    alert(`Error: ${request.error}`);
    sendResponse({status: "error displayed"});
  } else if (request.action === "openAIResponse") {
    console.log("Received OpenAI response:", request.response);
    showOpenAIResponse(request.response);
    sendResponse({status: "response displayed"});
  }
  return true;
});

function showOpenAIResponse(response: string) {
  const responseDialog = document.createElement('div');
  responseDialog.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: white;
    padding: 20px;
    border-radius: 5px;
    box-shadow: 0 0 10px rgba(0,0,0,0.3);
    z-index: 10000;
  `;
  
  responseDialog.innerHTML = `
    <h2>OpenAI Response</h2>
    <p>${response}</p>
    <br>
    <button id="closeResponse">Close</button>
  `;
  
  document.body.appendChild(responseDialog);

  document.getElementById('closeResponse')?.addEventListener('click', () => {
    document.body.removeChild(responseDialog);
  });
}

function showPromptDialog() {
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: white;
    padding: 20px;
    border-radius: 5px;
    box-shadow: 0 0 10px rgba(0,0,0,0.3);
    z-index: 10000;
  `;
  
  dialog.innerHTML = `
    <h2>Enter your prompt</h2>
    <textarea id="prompt" rows="4" cols="50" placeholder="Describe what you want to know about the screenshot"></textarea>
    <br><br>
    <button id="submit">Submit</button>
    <button id="cancel">Cancel</button>
  `;
  
  document.body.appendChild(dialog);

  document.getElementById('submit')?.addEventListener('click', () => {
    const promptElement = document.getElementById('prompt') as HTMLTextAreaElement;
    const prompt = promptElement.value;
    console.log("Sending to OpenAI:", {action: "sendToOpenAI", prompt, screenshot, compressedScreenshot, thumbnail});
    chrome.runtime.sendMessage({
      action: "sendToOpenAI", 
      prompt, 
      screenshot: screenshot, // Original for OpenAI
      compressedScreenshot: compressedScreenshot, // For storage
      thumbnail: thumbnail // For storage
    }, (response) => {
      console.log("Response from background script:", response);
      if (chrome.runtime.lastError) {
        console.error("Error:", chrome.runtime.lastError);
      }
    });
    document.body.removeChild(dialog);
  });

  document.getElementById('cancel')?.addEventListener('click', () => {
    document.body.removeChild(dialog);
  });
}

async function compressImageData(imageDataUrl: string) {
  try {
    console.log("Compressing image data...");
    const [compressed, thumb] = await Promise.all([
      compressImage(imageDataUrl, 0.6, 1200),
      createThumbnail(imageDataUrl, 120)
    ]);
    compressedScreenshot = compressed;
    thumbnail = thumb;
    console.log("Image compression completed");
  } catch (error) {
    console.error("Error during image compression:", error);
    throw error;
  }
}
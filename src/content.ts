// content.ts

let screenshot: string | null = null;
let croppedScreenshot: string | null = null;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log("Content script received message:", request);
  if (request.action === "prepareCapture") {
    console.log("Preparing capture...");
    chrome.runtime.sendMessage({action: "captureScreenshot"});
    console.log("Sent captureScreenshot message to background script");
    sendResponse({status: "preparing capture"});
  } else if (request.action === "showPromptDialog") {
    console.log("Showing area selection...");
    screenshot = request.screenshot;
    console.log("Received screenshot:", request.screenshot);
    showAreaSelection();
    sendResponse({status: "showing area selection"});
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
    background-color: rgba(255, 255, 255, 0.95);
    padding: 20px;
    border-radius: 5px;
    box-shadow: 0 0 10px rgba(0,0,0,0.3);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    z-index: 10000;
  `;
  
  responseDialog.innerHTML = `
    <h2>OpenAI Response</h2>
    <p>${response}</p>
    <br>
    <button id="closeResponse" style="
      background-color: rgba(76, 175, 80, 0.3);
      color: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(76, 175, 80, 0.5);
      border-radius: 4px;
      padding: 8px 16px;
      cursor: pointer;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      transition: all 0.3s ease;
    ">Close</button>
  `;
  
  document.body.appendChild(responseDialog);

  // Add hover effects for close button
  const closeBtn = document.getElementById('closeResponse');
  if (closeBtn) {
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.backgroundColor = 'rgba(76, 175, 80, 0.4)';
      closeBtn.style.borderColor = 'rgba(76, 175, 80, 0.7)';
      closeBtn.style.color = 'rgba(255, 255, 255, 1)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.backgroundColor = 'rgba(76, 175, 80, 0.3)';
      closeBtn.style.borderColor = 'rgba(76, 175, 80, 0.5)';
      closeBtn.style.color = 'rgba(255, 255, 255, 0.9)';
    });
  }

  document.getElementById('closeResponse')?.addEventListener('click', () => {
    document.body.removeChild(responseDialog);
  });
}

function showAreaSelection() {
  if (!screenshot) {
    console.error("No screenshot available for area selection");
    return;
  }

  // Create overlay container
  const overlay = document.createElement('div');
  overlay.id = 'screenhawk-area-selection';
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10000;
    cursor: crosshair;
  `;

  // Create canvas for selection
  const canvas = document.createElement('canvas');
  canvas.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    cursor: crosshair;
  `;
  
  // Set canvas size to viewport size
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error("Could not get canvas context");
    return;
  }

  // Create instruction text
  const instructions = document.createElement('div');
  instructions.style.cssText = `
    position: absolute;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: white;
    padding: 10px 20px;
    border-radius: 5px;
    font-family: Arial, sans-serif;
    font-size: 14px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
  `;
  instructions.textContent = 'Click and drag to select an area of the screenshot';

  overlay.appendChild(canvas);
  overlay.appendChild(instructions);
  document.body.appendChild(overlay);

  // Selection state
  let isSelecting = false;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let currentY = 0;

  // Mouse events for area selection
  canvas.addEventListener('mousedown', (e) => {
    isSelecting = true;
    const rect = canvas.getBoundingClientRect();
    startX = e.clientX - rect.left;
    startY = e.clientY - rect.top;
    currentX = startX;
    currentY = startY;
  });

  canvas.addEventListener('mousemove', (e) => {
    if (!isSelecting) return;
    
    const rect = canvas.getBoundingClientRect();
    currentX = e.clientX - rect.left;
    currentY = e.clientY - rect.top;
    
    // Clear canvas and draw selection rectangle
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#00ff00';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    
    ctx.strokeRect(x, y, width, height);
  });

  canvas.addEventListener('mouseup', (e) => {
    if (!isSelecting) return;
    
    isSelecting = false;
    const rect = canvas.getBoundingClientRect();
    currentX = e.clientX - rect.left;
    currentY = e.clientY - rect.top;
    
    const x = Math.min(startX, currentX);
    const y = Math.min(startY, currentY);
    const width = Math.abs(currentX - startX);
    const height = Math.abs(currentY - startY);
    
    // Only proceed if selection is large enough
    if (width > 10 && height > 10) {
      cropImageArea(x, y, width, height);
      document.body.removeChild(overlay);
      showPromptDialog();
    }
  });

  // Cancel selection on escape key
  document.addEventListener('keydown', function escapeHandler(e) {
    if (e.key === 'Escape') {
      document.body.removeChild(overlay);
      document.removeEventListener('keydown', escapeHandler);
    }
  });
}

function cropImageArea(x: number, y: number, width: number, height: number) {
  if (!screenshot) {
    console.error("No screenshot available for cropping");
    return;
  }

  // Create an image element to load the screenshot
  const img = new Image();
  img.onload = () => {
    // Create a canvas for cropping
    const cropCanvas = document.createElement('canvas');
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) {
      console.error("Could not get crop canvas context");
      return;
    }

    // Calculate scaling factors between viewport and actual image
    const scaleX = img.width / window.innerWidth;
    const scaleY = img.height / window.innerHeight;

    // Convert viewport coordinates to image coordinates
    const cropX = x * scaleX;
    const cropY = y * scaleY;
    const cropWidth = width * scaleX;
    const cropHeight = height * scaleY;

    // Set canvas size to cropped area size
    cropCanvas.width = cropWidth;
    cropCanvas.height = cropHeight;

    // Draw the cropped area
    cropCtx.drawImage(
      img,
      cropX, cropY, cropWidth, cropHeight,
      0, 0, cropWidth, cropHeight
    );

    // Convert to data URL
    croppedScreenshot = cropCanvas.toDataURL('image/png');
    console.log("Cropped screenshot created");
  };

  img.src = screenshot;
}

function showPromptDialog() {
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: rgba(255, 255, 255, 0.95);
    padding: 20px;
    border-radius: 5px;
    box-shadow: 0 0 10px rgba(0,0,0,0.3);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    z-index: 10000;
  `;
  
  dialog.innerHTML = `
    <h2>Enter your prompt</h2>
    <textarea id="prompt" rows="4" cols="50" placeholder="Describe what you want to know about the screenshot"></textarea>
    <br><br>
    <button id="submit" style="
      background-color: rgba(76, 175, 80, 0.3);
      color: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(76, 175, 80, 0.5);
      border-radius: 4px;
      padding: 8px 16px;
      margin-right: 10px;
      cursor: pointer;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      transition: all 0.3s ease;
    ">Submit</button>
    <button id="cancel" style="
      background-color: rgba(128, 128, 128, 0.3);
      color: rgba(255, 255, 255, 0.9);
      border: 1px solid rgba(128, 128, 128, 0.5);
      border-radius: 4px;
      padding: 8px 16px;
      cursor: pointer;
      backdrop-filter: blur(10px);
      -webkit-backdrop-filter: blur(10px);
      transition: all 0.3s ease;
    ">Cancel</button>
  `;
  
  document.body.appendChild(dialog);

  // Add hover effects for buttons
  const submitBtn = document.getElementById('submit');
  const cancelBtn = document.getElementById('cancel');
  
  if (submitBtn) {
    submitBtn.addEventListener('mouseenter', () => {
      submitBtn.style.backgroundColor = 'rgba(76, 175, 80, 0.4)';
      submitBtn.style.borderColor = 'rgba(76, 175, 80, 0.7)';
      submitBtn.style.color = 'rgba(255, 255, 255, 1)';
    });
    submitBtn.addEventListener('mouseleave', () => {
      submitBtn.style.backgroundColor = 'rgba(76, 175, 80, 0.3)';
      submitBtn.style.borderColor = 'rgba(76, 175, 80, 0.5)';
      submitBtn.style.color = 'rgba(255, 255, 255, 0.9)';
    });
  }
  
  if (cancelBtn) {
    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.backgroundColor = 'rgba(128, 128, 128, 0.4)';
      cancelBtn.style.borderColor = 'rgba(128, 128, 128, 0.7)';
      cancelBtn.style.color = 'rgba(255, 255, 255, 1)';
    });
    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.backgroundColor = 'rgba(128, 128, 128, 0.3)';
      cancelBtn.style.borderColor = 'rgba(128, 128, 128, 0.5)';
      cancelBtn.style.color = 'rgba(255, 255, 255, 0.9)';
    });
  }

  document.getElementById('submit')?.addEventListener('click', () => {
    const promptElement = document.getElementById('prompt') as HTMLTextAreaElement;
    const prompt = promptElement.value;
    const imageToSend = croppedScreenshot || screenshot;
    console.log("Sending to OpenAI:", {action: "sendToOpenAI", prompt, screenshot: imageToSend});
    chrome.runtime.sendMessage({action: "sendToOpenAI", prompt, screenshot: imageToSend}, (response) => {
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
// content.ts

let screenshot: string | null = null;
let croppedScreenshot: string | null = null;

// Form assistance functionality
let formAssistanceButtons: Map<HTMLElement, HTMLElement> = new Map();
let currentFormField: HTMLTextAreaElement | HTMLInputElement | null = null;

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
  } else if (request.action === "formFillResponse") {
    console.log("Received form fill response:", request.response);
    fillFormField(request.response);
    sendResponse({status: "form filled"});
  }
  return true;
});

// Initialize form assistance when page loads
document.addEventListener('DOMContentLoaded', initializeFormAssistance);
// Also run immediately in case DOMContentLoaded already fired
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeFormAssistance);
} else {
  initializeFormAssistance();
}

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

// Form assistance functionality
function initializeFormAssistance() {
  console.log("Initializing form assistance...");
  detectFormFields();
  
  // Set up mutation observer to handle dynamically added form fields
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const element = node as Element;
            // Check if the added node or its descendants contain form fields
            const formFields = element.querySelectorAll('textarea, input[type="text"]');
            formFields.forEach((field) => addAssistanceButton(field as HTMLTextAreaElement | HTMLInputElement));
            
            // Also check if the node itself is a form field
            if (isEligibleFormField(element as HTMLElement)) {
              addAssistanceButton(element as HTMLTextAreaElement | HTMLInputElement);
            }
          }
        });
      }
    });
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function detectFormFields() {
  // Find all textarea elements and larger text input fields
  const textareas = document.querySelectorAll('textarea');
  const textInputs = document.querySelectorAll('input[type="text"]');
  
  textareas.forEach((textarea) => {
    addAssistanceButton(textarea as HTMLTextAreaElement);
  });
  
  // Filter text inputs to only include larger ones (exclude small fields like search boxes)
  textInputs.forEach((input) => {
    if (isEligibleFormField(input as HTMLElement)) {
      addAssistanceButton(input as HTMLInputElement);
    }
  });
}

function isEligibleFormField(element: HTMLElement): boolean {
  if (element.tagName.toLowerCase() === 'textarea') {
    return true;
  }
  
  if (element.tagName.toLowerCase() === 'input') {
    const input = element as HTMLInputElement;
    if (input.type !== 'text') return false;
    
    // Check if it's a larger text input (not a small search box or similar)
    const style = window.getComputedStyle(input);
    const width = parseInt(style.width) || input.offsetWidth;
    const minLength = input.minLength || input.maxLength;
    
    // Consider it eligible if:
    // - Width is substantial (>200px) OR
    // - Has a substantial maxLength/minLength OR  
    // - Size attribute suggests it's meant for longer text OR
    // - Has placeholder text suggesting longer input OR
    // - Context suggests it's for longer text (name, role, etc.)
    return width > 200 || 
           (minLength && minLength > 50) || 
           (input.maxLength && input.maxLength > 100) ||
           (input.size && input.size > 30) ||
           (input.placeholder && input.placeholder.length > 20) ||
           /description|bio|comment|message|experience|summary|story|essay|feedback|review/i.test(input.placeholder || input.name || input.id || '');
  }
  
  return false;
}

function addAssistanceButton(formField: HTMLTextAreaElement | HTMLInputElement) {
  // Skip if button already exists for this field
  if (formAssistanceButtons.has(formField)) {
    return;
  }
  
  // Skip if field is disabled or readonly
  if (formField.disabled || formField.readOnly) {
    return;
  }
  
  // Create the assistance button
  const button = document.createElement('button');
  button.innerHTML = '✨'; // Magic wand emoji
  button.title = 'Get AI assistance for this field';
  button.type = 'button'; // Prevent form submission
  button.style.cssText = `
    position: absolute;
    top: 8px;
    right: 8px;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 4px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    font-size: 12px;
    cursor: pointer;
    z-index: 10000;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    transition: all 0.2s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    font-family: Arial, sans-serif;
    opacity: 0.8;
  `;
  
  // Add hover effect
  button.addEventListener('mouseenter', () => {
    button.style.transform = 'scale(1.1)';
    button.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
    button.style.opacity = '1';
  });
  
  button.addEventListener('mouseleave', () => {
    button.style.transform = 'scale(1)';
    button.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    button.style.opacity = '0.8';
  });
  
  // Show/hide button based on field focus
  formField.addEventListener('focus', () => {
    button.style.opacity = '1';
  });
  
  formField.addEventListener('blur', () => {
    setTimeout(() => {
      if (!button.matches(':hover')) {
        button.style.opacity = '0.8';
      }
    }, 100);
  });
  
  // Position the button relative to the form field
  const parentElement = formField.offsetParent || formField.parentElement || document.body;
  
  // Make sure the parent has relative positioning
  const parentStyle = window.getComputedStyle(parentElement);
  if (parentStyle.position === 'static') {
    (parentElement as HTMLElement).style.position = 'relative';
  }
  
  // Calculate position relative to the form field
  const updateButtonPosition = () => {
    const fieldRect = formField.getBoundingClientRect();
    const parentRect = parentElement.getBoundingClientRect();
    
    button.style.top = `${fieldRect.top - parentRect.top + 8}px`;
    button.style.right = `${parentRect.right - fieldRect.right + 8}px`;
  };
  
  updateButtonPosition();
  
  // Update position on resize
  window.addEventListener('resize', updateButtonPosition);
  
  // Add click handler
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    currentFormField = formField;
    showFormAssistanceDialog(formField);
  });
  
  // Append button to the parent element
  parentElement.appendChild(button);
  
  // Store the button reference
  formAssistanceButtons.set(formField, button);
  
  // Clean up when form field is removed
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.removedNodes.forEach((node) => {
        if (node === formField || (node as Element).contains?.(formField)) {
          observer.disconnect();
          window.removeEventListener('resize', updateButtonPosition);
          removeAssistanceButton(formField);
        }
      });
    });
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

function removeAssistanceButton(formField: HTMLElement) {
  const button = formAssistanceButtons.get(formField);
  if (button && button.parentElement) {
    button.parentElement.removeChild(button);
  }
  formAssistanceButtons.delete(formField);
}

function getFormFieldContext(formField: HTMLTextAreaElement | HTMLInputElement): string {
  let context = '';
  
  // Get placeholder text
  if (formField.placeholder) {
    context += `Field placeholder: "${formField.placeholder}". `;
  }
  
  // Get associated label
  let label = '';
  if (formField.id) {
    const labelElement = document.querySelector(`label[for="${formField.id}"]`);
    if (labelElement) {
      label = labelElement.textContent?.trim() || '';
    }
  }
  
  // If no label found by ID, look for labels that contain this field
  if (!label) {
    const parentLabel = formField.closest('label');
    if (parentLabel) {
      label = parentLabel.textContent?.replace(formField.textContent || '', '').trim() || '';
    }
  }
  
  // Look for nearby text that might be a label
  if (!label) {
    const prevSibling = formField.previousElementSibling;
    if (prevSibling && (prevSibling.tagName === 'SPAN' || prevSibling.tagName === 'DIV' || prevSibling.tagName === 'P')) {
      const text = prevSibling.textContent?.trim();
      if (text && text.length < 100) {
        label = text;
      }
    }
  }
  
  if (label) {
    context += `Field label: "${label}". `;
  }
  
  // Get form name or title if available
  const form = formField.closest('form');
  if (form) {
    const formTitle = form.querySelector('h1, h2, h3, h4, h5, h6');
    if (formTitle) {
      context += `Form section: "${formTitle.textContent?.trim()}". `;
    }
  }
  
  // Get field name/id hints
  if (formField.name) {
    context += `Field name: "${formField.name}". `;
  }
  
  return context.trim();
}

function showFormAssistanceDialog(formField: HTMLTextAreaElement | HTMLInputElement) {
  const context = getFormFieldContext(formField);
  
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: white;
    padding: 24px;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.15);
    z-index: 10001;
    max-width: 500px;
    width: 90%;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  `;
  
  dialog.innerHTML = `
    <h2 style="margin: 0 0 16px 0; font-size: 20px; color: #1a1a1a; display: flex; align-items: center; gap: 8px;">
      <span>✨</span> AI Writing Assistant
    </h2>
    ${context ? `<div style="background: #f5f5f5; padding: 12px; border-radius: 6px; margin-bottom: 16px; font-size: 14px; color: #666;">
      <strong>Context:</strong> ${context}
    </div>` : ''}
    <label for="userPrompt" style="display: block; margin-bottom: 8px; font-weight: 500; color: #333;">What would you like to write?</label>
    <textarea id="userPrompt" rows="3" style="width: 100%; padding: 12px; border: 2px solid #e1e5e9; border-radius: 6px; font-size: 14px; font-family: inherit; resize: vertical; box-sizing: border-box;" placeholder="e.g., 'Write a professional 2-sentence summary about my experience at Apple'"></textarea>
    <div style="display: flex; gap: 12px; margin-top: 20px; justify-content: flex-end;">
      <button id="cancelFormAssist" style="padding: 10px 20px; border: 2px solid #e1e5e9; background: white; color: #666; border-radius: 6px; cursor: pointer; font-weight: 500;">Cancel</button>
      <button id="generateContent" style="padding: 10px 20px; border: none; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 6px; cursor: pointer; font-weight: 500; position: relative;">
        <span id="buttonText">Generate</span>
        <span id="loadingSpinner" style="display: none;">Generating...</span>
      </button>
    </div>
  `;
  
  // Add backdrop
  const backdrop = document.createElement('div');
  backdrop.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background: rgba(0, 0, 0, 0.5);
    z-index: 10000;
  `;
  
  document.body.appendChild(backdrop);
  document.body.appendChild(dialog);
  
  // Focus the prompt input
  const promptInput = document.getElementById('userPrompt') as HTMLTextAreaElement;
  setTimeout(() => promptInput.focus(), 100);
  
  const generateButton = document.getElementById('generateContent') as HTMLButtonElement;
  const buttonText = document.getElementById('buttonText') as HTMLSpanElement;
  const loadingSpinner = document.getElementById('loadingSpinner') as HTMLSpanElement;

  const closeDialog = () => {
    if (backdrop.parentElement) {
      document.body.removeChild(backdrop);
    }
    if (dialog.parentElement) {
      document.body.removeChild(dialog);
    }
  };

  generateButton.addEventListener('click', () => {
    const userPrompt = promptInput.value.trim();
    if (!userPrompt) {
      alert('Please describe what you want to write.');
      promptInput.focus();
      return;
    }
    
    // Show loading state
    generateButton.disabled = true;
    buttonText.style.display = 'none';
    loadingSpinner.style.display = 'inline';
    generateButton.style.cursor = 'wait';
    
    // Create a comprehensive prompt for GPT
    let fullPrompt = `You are helping a user fill out a form field. `;
    if (context) {
      fullPrompt += `Context about the form field: ${context} `;
    }
    fullPrompt += `The user wants: ${userPrompt}. Please provide ONLY the text content that should go in the form field, without any additional explanation or formatting. Keep it appropriate for the context and purpose of the field.`;
    
    console.log("Sending form assistance request to OpenAI:", fullPrompt);
    chrome.runtime.sendMessage({
      action: "sendToOpenAI", 
      prompt: fullPrompt, 
      isFormAssistance: true
    }, (response) => {
      console.log("Response from background script:", response);
      if (chrome.runtime.lastError) {
        console.error("Error:", chrome.runtime.lastError);
        alert("Sorry, there was an error generating content. Please check your OpenAI API key and try again.");
        
        // Reset button state
        generateButton.disabled = false;
        buttonText.style.display = 'inline';
        loadingSpinner.style.display = 'none';
        generateButton.style.cursor = 'pointer';
      } else {
        closeDialog();
      }
    });
  });

  document.getElementById('cancelFormAssist')?.addEventListener('click', closeDialog);
  backdrop.addEventListener('click', closeDialog);
  
  // Close on escape key
  const escapeHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeDialog();
      document.removeEventListener('keydown', escapeHandler);
    }
  };
  document.addEventListener('keydown', escapeHandler);
  
  // Allow enter to submit if not shift+enter
  promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      generateButton.click();
    }
  });
}

function fillFormField(content: string) {
  if (!currentFormField) {
    console.error("No current form field to fill");
    return;
  }
  
  // Clear any existing value
  currentFormField.value = '';
  
  // Animate typing effect for better UX
  let index = 0;
  const typewriterSpeed = 20; // milliseconds per character
  
  const typeWriter = () => {
    if (index < content.length) {
      currentFormField!.value += content.charAt(index);
      index++;
      
      // Trigger input event for each character (for reactive frameworks)
      const inputEvent = new Event('input', { bubbles: true });
      currentFormField!.dispatchEvent(inputEvent);
      
      setTimeout(typeWriter, typewriterSpeed);
    } else {
      // Final events after typing is complete
      const events = ['change', 'blur'];
      events.forEach(eventType => {
        const event = new Event(eventType, { bubbles: true });
        currentFormField!.dispatchEvent(event);
      });
      
      // Show a subtle success indication
      const button = formAssistanceButtons.get(currentFormField!);
      if (button) {
        const originalText = button.innerHTML;
        button.innerHTML = '✅';
        button.style.background = 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)';
        
        setTimeout(() => {
          button.innerHTML = originalText;
          button.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
        }, 2000);
      }
    }
  };
  
  // Focus the field and start typing animation
  currentFormField.focus();
  typeWriter();
  
  // Clear the current field reference
  currentFormField = null;
}
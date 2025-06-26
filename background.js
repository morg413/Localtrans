// Background service worker for the extension
chrome.runtime.onInstalled.addListener(() => {
  console.log('Local LLM Webpage Translator installed');
});

// Handle extension icon click
chrome.action.onClicked.addListener((tab) => {
  // This will open the popup, no additional action needed
  console.log('Extension icon clicked for tab:', tab.id);
});

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRANSLATION_PROGRESS' || 
      message.type === 'TRANSLATION_COMPLETE' || 
      message.type === 'TRANSLATION_ERROR') {
    // Forward progress messages to popup if it's open
    chrome.runtime.sendMessage(message).catch(() => {
      // Popup might be closed, that's okay
    });
  }
  return true;
});

// Handle storage changes
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync') {
    console.log('Settings changed:', changes);
  }
});

// Context menu for quick translation
chrome.contextMenus.create({
  id: 'translate-selection',
  title: 'Translate with Local LLM',
  contexts: ['selection']
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'translate-selection' && info.selectionText) {
    try {
      // Get settings
      const settings = await chrome.storage.sync.get([
        'llmUrl', 'model', 'targetLanguage', 'customLanguage'
      ]);
      
      const config = {
        llmUrl: settings.llmUrl || 'http://localhost:11434',
        model: settings.model || 'llama2',
        targetLanguage: settings.targetLanguage === 'Custom' ? 
          settings.customLanguage : (settings.targetLanguage || 'Spanish')
      };

      // Inject script to translate selection
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: translateSelection,
        args: [info.selectionText, config]
      });
    } catch (error) {
      console.error('Context menu translation error:', error);
    }
  }
});

// Function to inject for selection translation
async function translateSelection(text, config) {
  try {
    const prompt = `Translate the following text to ${config.targetLanguage}. Only return the translated text, nothing else.

Text to translate:
${text}`;

    let response;
    
    if (config.llmUrl.includes('localhost:11434') || config.llmUrl.includes('ollama')) {
      response = await fetch(`${config.llmUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          prompt: prompt,
          stream: false
        })
      });
    } else {
      response = await fetch(`${config.llmUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: 1000,
          temperature: 0.3
        })
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[LocalLLMTranslator] translateSelection: API error (Status: ${response.status}):`, errorText);
      let detail = errorText.substring(0, 500);
      try {
        const errorJson = JSON.parse(errorText);
        if (errorJson.error) {
          detail = typeof errorJson.error === 'object' ? JSON.stringify(errorJson.error) : String(errorJson.error);
        } else if (errorJson.message) {
          detail = errorJson.message;
        }
      } catch (e) { /* Not JSON, use raw snippet */ }
      throw new Error(`Translation API error: ${response.status} ${response.statusText}. Detail: ${detail}`);
    }

    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch (e) {
      console.error('[LocalLLMTranslator] translateSelection: Failed to parse JSON response. Raw:', responseText.substring(0, 500));
      throw new Error(`Failed to parse JSON response from translation API. Snippet: ${responseText.substring(0,500)}`);
    }

    const translatedText = data.response || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content);

    if (typeof translatedText !== 'string') {
      console.error('[LocalLLMTranslator] translateSelection: Could not extract translated text from API response. Data:', data);
      throw new Error('Could not extract translated text from API response.');
    }

    // Show translation in a tooltip
    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      max-width: 400px;
      background: rgba(102, 126, 234, 0.95);
      color: white;
      padding: 16px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      line-height: 1.4;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      z-index: 10000;
      backdrop-filter: blur(10px);
      border: 1px solid rgba(255, 255, 255, 0.2);
    `;
    
    tooltip.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px;">🌐 Translation:</div>
      <div>${translatedText.replace(/\n/g, '<br>')}</div>
      <div style="margin-top: 12px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.2); font-size: 12px; opacity: 0.8;">
        Click to close
      </div>
    `;
    
    tooltip.addEventListener('click', () => tooltip.remove());
    document.body.appendChild(tooltip);
    
    // Auto-remove after 10 seconds
    setTimeout(() => tooltip.remove(), 10000);

  } catch (error) {
    console.error('Selection translation error:', error);
    alert('Translation failed: ' + error.message);
  }
}
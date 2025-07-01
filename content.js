// Content script for webpage translation
(function() {
  'use_strict';

  // Stores original node values and references for reversion
  // Key: string (generated parent element ID)
  // Value: Array of objects like { node: Text, originalValue: string }
  let originalContent = new Map();
  let isTranslating = false;
  let translationConfig = null;
  let nextElementId = 0; // Counter for generating unique IDs
  let translationAbortedByUser = false;

  // Listen for messages from popup (e.g., to start translation or abort)
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_TRANSLATION') {
      console.log('[LocalLLMTranslator] DEBUG: Received START_TRANSLATION signal with config:', JSON.stringify(message.config, null, 2));
      // Call window.startTranslation, but don't await it here as addListener expects sync true/false or a Promise for sendResponse
      window.startTranslation(message.config);
      // sendResponse({status: "Translation started"}); // Optional: send confirmation
      return true; // Indicate that we might send a response asynchronously (though not strictly needed if not calling sendResponse)
    } else if (message.type === 'ABORT_TRANSLATION') {
      console.log('[LocalLLMTranslator] DEBUG: Received ABORT_TRANSLATION signal.');
      translationAbortedByUser = true;
      console.log('[LocalLLMTranslator] DEBUG: translationAbortedByUser is now true.');
      // sendResponse({status: "Abort signal received"}); // Optional: send confirmation
      return true;
    }
    // For other message types not handled here, return undefined or false if not responding.
    // Returning true keeps the message channel open for sendResponse, if you plan to use it.
  });

  // Initialize translation functionality
  window.startTranslation = async function(config) {
    console.log('[LocalLLMTranslator] DEBUG: startTranslation called with config:', JSON.stringify(config, null, 2));
    // Clear previous translation state before starting a new one
    if (originalContent.size > 0) {
        console.log('[LocalLLMTranslator] DEBUG: Clearing previous translation artifacts before new translation.');
        revertPage(false); // Revert without refresh confirmation
    }
    originalContent.clear();
    nextElementId = 0;
    translationAbortedByUser = false; // Reset abort flag for new translation

    translationConfig = config;
    await translatePage();
  };

  // Revert translation functionality
  window.revertTranslation = function() {
    console.log('[LocalLLMTranslator] DEBUG: revertTranslation called');
    revertPage(true); // Revert with refresh confirmation
  };

  async function translatePage() {
    console.log('[LocalLLMTranslator] DEBUG: translatePage started');
    if (isTranslating) {
      console.log('[LocalLLMTranslator] DEBUG: Already translating, exiting translatePage.');
      return;
    }
    isTranslating = true;

    try {
      console.log('[LocalLLMTranslator] Sending initial progress: Analyzing page content...');
      // Send progress update
      chrome.runtime.sendMessage({
        type: 'TRANSLATION_PROGRESS',
        progress: 10,
        message: 'Analyzing page content...'
      });

      // Get all text elements
      console.log('[LocalLLMTranslator] DEBUG: Getting translatable elements...');
      const textElements = getTranslatableElements();
      console.log(`[LocalLLMTranslator] DEBUG: Found ${textElements.length} translatable elements.`);
      
      if (textElements.length === 0) {
        console.warn('[LocalLLMTranslator] DEBUG: No translatable content found.');
        throw new Error('No translatable content found on this page');
      }

      chrome.runtime.sendMessage({
        type: 'TRANSLATION_PROGRESS',
        progress: 20,
        message: `Found ${textElements.length} elements to translate...`
      });

      // Process elements in batches
      const batchSize = 10; // TODO: Make this configurable?
      const batches = [];
      
      for (let i = 0; i < textElements.length; i += batchSize) {
        batches.push(textElements.slice(i, i + batchSize));
      }
      console.log(`[LocalLLMTranslator] DEBUG: Created ${batches.length} batches of size ${batchSize}.`);

      let completedBatches = 0;

      console.log('[LocalLLMTranslator] DEBUG: Starting batch processing...');
      for (const batch of batches) {
        if (translationAbortedByUser) {
          console.log('[LocalLLMTranslator] DEBUG: Translation aborted by user during batch processing.');
          chrome.runtime.sendMessage({ type: 'TRANSLATION_ERROR', error: 'Translation stopped by user.' });
          break;
        }
        console.log(`[LocalLLMTranslator] DEBUG: Processing batch ${completedBatches + 1} of ${batches.length}, containing ${batch.length} elements.`);
        await processBatch(batch, completedBatches + 1, batches.length);
        if (translationAbortedByUser) { // Check again after await, as processBatch itself could be long
          console.log('[LocalLLMTranslator] DEBUG: Translation aborted by user after processBatch.');
          chrome.runtime.sendMessage({ type: 'TRANSLATION_ERROR', error: 'Translation stopped by user.' });
          break;
        }
        completedBatches++;
        console.log(`[LocalLLMTranslator] DEBUG: Finished processing batch ${completedBatches} of ${batches.length}.`);
        
        const progress = 20 + (completedBatches / batches.length) * 70;
        chrome.runtime.sendMessage({
          type: 'TRANSLATION_PROGRESS',
          progress: Math.round(progress),
          message: `Translated ${completedBatches} of ${batches.length} batches...`
        });
      }

      if (translationAbortedByUser) {
        console.log('[LocalLLMTranslator] DEBUG: Finished processing due to user abort.');
      } else {
        console.log('[LocalLLMTranslator] DEBUG: All batches processed.');
        chrome.runtime.sendMessage({
          type: 'TRANSLATION_COMPLETE',
          progress: 100
        });
        console.log('[LocalLLMTranslator] DEBUG: Translation complete message sent.');
      }

    } catch (error) {
      console.error('[LocalLLMTranslator] DEBUG: Translation error in translatePage:', error);
      // Avoid sending another error if already aborted
      if (!translationAbortedByUser) {
        chrome.runtime.sendMessage({
          type: 'TRANSLATION_ERROR',
          error: error.message
        });
      }
    } finally {
      console.log('[LocalLLMTranslator] DEBUG: translatePage finished. Resetting isTranslating flag.');
      isTranslating = false;
      // translationAbortedByUser is reset at the start of a new translation
    }
  }

  function getTranslatableElements() {
    console.log('[LocalLLMTranslator] DEBUG: getTranslatableElements: Walking DOM...');
    const elements = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: function(node) {
          // Skip script, style, and other non-translatable elements
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          
          const tagName = parent.tagName.toLowerCase();
          const skipTags = ['script', 'style', 'code', 'pre', 'noscript', 'textarea'];
          
          if (skipTags.includes(tagName)) {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip very short text or whitespace-only text
          const text = node.textContent.trim();
          if (text.length < 3 || /^\s*$/.test(text)) {
            return NodeFilter.FILTER_REJECT;
          }

          // Skip numbers-only or symbol-only text
          if (/^[\d\s\W]*$/.test(text)) {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    let node;
    while (node = walker.nextNode()) {
      elements.push(node);
    }

    return elements;
  }

  async function processBatch(elements, batchNum, totalBatches) {
    console.log(`[LocalLLMTranslator] DEBUG: processBatch: Starting batch ${batchNum}/${totalBatches}, ${elements.length} elements.`);
    const textsToTranslate = elements.map(el => el.textContent.trim());
    const combinedText = textsToTranslate.join('\n---\n');
    console.log(`[LocalLLMTranslator] DEBUG: processBatch: Combined text for batch ${batchNum}: "${combinedText}"`);

    try {
      if (translationAbortedByUser) {
        console.log(`[LocalLLMTranslator] DEBUG: Skipping translateText call for batch ${batchNum} due to user abort.`);
        return; // Exit batch processing if aborted
      }
      console.log(`[LocalLLMTranslator] DEBUG: processBatch: Calling translateText for batch ${batchNum}...`);
      const translatedText = await translateText(combinedText);

      if (translationAbortedByUser) {
        console.log(`[LocalLLMTranslator] DEBUG: Discarding translation results for batch ${batchNum} due to user abort.`);
        return; // Don't process results if aborted during await
      }

      console.log(`[LocalLLMTranslator] DEBUG: processBatch: Raw translated text for batch ${batchNum}: "${translatedText}"`);

      const translatedParts = translatedText.split('\n---\n');
      console.log(`[LocalLLMTranslator] DEBUG: processBatch: Split translated parts for batch ${batchNum}:`, translatedParts);

      if (translatedParts.length !== textsToTranslate.length) {
        console.warn(`[LocalLLMTranslator] DEBUG: processBatch: Mismatch in translated parts length for batch ${batchNum}. Expected ${textsToTranslate.length}, got ${translatedParts.length}. Original texts:`, textsToTranslate, "Translated parts:", translatedParts);
      }

      // Apply translations
      elements.forEach((textNode, index) => { // element is a Text node
        if (translatedParts[index] && translatedParts[index].trim()) {
          const originalNodeValue = textNode.nodeValue;
          const translatedFragment = translatedParts[index].trim();
          console.log(`[LocalLLMTranslator] DEBUG: processBatch: Applying translation to text node ${index} in batch ${batchNum}: "${originalNodeValue}" -> "${translatedFragment}"`);

          const parentEl = textNode.parentElement;
          if (parentEl) {
            let parentId = parentEl.getAttribute('data-llm-translator-id');
            if (!parentId) {
              parentId = `llm-translator-el-${nextElementId++}`;
              parentEl.setAttribute('data-llm-translator-id', parentId);
            }

            if (!originalContent.has(parentId)) {
              originalContent.set(parentId, []);
            }
            // Store the text node itself and its original value
            originalContent.get(parentId).push({ node: textNode, originalValue: originalNodeValue });

            // Apply translation
            textNode.nodeValue = translatedFragment;

            // Add visual indicator to the parent element
            addTranslationIndicator(parentEl);
          } else {
            console.warn(`[LocalLLMTranslator] DEBUG: processBatch: Text node ${index} in batch ${batchNum} has no parent element. Skipping.`);
          }
        } else {
          console.warn(`[LocalLLMTranslator] DEBUG: processBatch: No valid translation for text node ${index} in batch ${batchNum}. Original: "${textNode.nodeValue.trim()}"`);
        }
      });
      console.log(`[LocalLLMTranslator] DEBUG: processBatch: Finished applying translations for batch ${batchNum}.`);

    } catch (error) {
      console.error(`[LocalLLMTranslator] DEBUG: Batch translation error in processBatch (batch ${batchNum}):`, error);
      // Continue with next batch even if this one fails
    }
  }

  async function translateText(text) {
    console.log('[LocalLLMTranslator] DEBUG: translateText: Starting with text length:', text.length, 'First 100 chars:', text.substring(0,100));
    const { llmUrl, model, targetLanguage } = translationConfig;
    console.log('[LocalLLMTranslator] DEBUG: translateText: Config:', { llmUrl, model, targetLanguage });

    if (translationAbortedByUser) {
      console.log('[LocalLLMTranslator] DEBUG: translateText: Aborting before fetch due to user signal.');
      throw new Error("Translation aborted by user before API call.");
    }

    const prompt = `Translate the following text to ${targetLanguage}. Preserve the original formatting and structure. Only return the translated text, nothing else. If there are multiple sections separated by "---", translate each section separately and maintain the "---" separators.

Text to translate:
${text}`;
    console.log('[LocalLLMTranslator] DEBUG: translateText: Generated prompt:', prompt);

    // Try different API formats based on the URL
    let response;
    let apiType = 'Unknown';
    const FETCH_TIMEOUT = 180000; // 3 minutes timeout
    
    console.log('[LocalLLMTranslator] DEBUG: translateText: Preparing fetch request...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(`[LocalLLMTranslator] DEBUG: translateText: Fetch request timed out after ${FETCH_TIMEOUT / 1000} seconds.`);
      controller.abort();
    }, FETCH_TIMEOUT);

    try {
      if (llmUrl.includes('localhost:11434') || llmUrl.includes('ollama')) {
        apiType = 'Ollama';
        const requestBody = { model: model, prompt: prompt, stream: false };
        console.log(`[LocalLLMTranslator] DEBUG: translateText: Calling ${apiType} API at ${llmUrl}/api/generate with body:`, JSON.stringify(requestBody));
        response = await fetch(`${llmUrl}/api/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
      } else {
        apiType = 'OpenAI-compatible';
        const requestBody = { model: model, messages: [{ role: 'user', content: prompt }], max_tokens: 2000, temperature: 0.3 };
        console.log(`[LocalLLMTranslator] DEBUG: translateText: Calling ${apiType} API at ${llmUrl}/v1/chat/completions with body:`, JSON.stringify(requestBody));
        response = await fetch(`${llmUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal
        });
      }
      clearTimeout(timeoutId); // Clear timeout if fetch completes in time
      console.log(`[LocalLLMTranslator] DEBUG: translateText: Fetch response received from ${apiType} API. Status: ${response.status}, OK: ${response.ok}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[LocalLLMTranslator] DEBUG: translateText: API error response text from ${apiType} (Status: ${response.status}):`, errorText);
        // Try to parse to see if it's a structured error, otherwise use raw text.
        let detail = errorText.substring(0, 500); // Limit length
        try {
          const errorJson = JSON.parse(errorText);
          if (errorJson.error) { // Common pattern for Ollama, OpenAI
            detail = typeof errorJson.error === 'object' ? JSON.stringify(errorJson.error) : String(errorJson.error);
          } else if (errorJson.message) { // Another common pattern
            detail = errorJson.message;
          }
        } catch (e) {
          // Not JSON or unexpected structure, stick with truncated raw text
        }
        throw new Error(`Translation API error: ${response.status} ${response.statusText}. Detail: ${detail}`);
      }
    } catch (error) {
      clearTimeout(timeoutId); // Clear timeout if fetch itself throws an error (e.g., network error, aborted)
      if (error.name === 'AbortError') {
        console.error('[LocalLLMTranslator] DEBUG: translateText: Fetch aborted due to timeout.');
        throw new Error(`Translation request timed out after ${FETCH_TIMEOUT / 1000} seconds.`);
      }
      console.error(`[LocalLLMTranslator] DEBUG: translateText: Fetch error for ${apiType} API:`, error);
      throw error; // Re-throw other errors
    }

    const responseText = await response.text();
    console.log(`[LocalLLMTranslator] DEBUG: translateText: Raw response text from ${apiType} (length ${responseText.length}):`, responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));

    let data;
    try {
      data = JSON.parse(responseText);
      console.log(`[LocalLLMTranslator] DEBUG: translateText: Parsed JSON data from ${apiType}:`, data);
    } catch (e) {
      console.error(`[LocalLLMTranslator] DEBUG: translateText: Failed to parse JSON response from ${apiType}. Error:`, e, "Raw response (first 500 chars):", responseText.substring(0,500));
      throw new Error(`Failed to parse JSON response from translation API. Response snippet: ${responseText.substring(0, 500)}`);
    }
    
    // Extract translated text based on API format
    let translatedText;
    if (data.response) {
      // Ollama format
      translatedText = data.response;
      console.log(`[LocalLLMTranslator] DEBUG: translateText: Extracted text (Ollama format, length ${translatedText?.length}):`, translatedText?.substring(0,100) + (translatedText?.length > 100 ? '...' : ''));
    } else if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
      // OpenAI format
      translatedText = data.choices[0].message.content;
      console.log(`[LocalLLMTranslator] DEBUG: translateText: Extracted text (OpenAI format, length ${translatedText?.length}):`, translatedText?.substring(0,100) + (translatedText?.length > 100 ? '...' : ''));
    } else {
      console.error('[LocalLLMTranslator] DEBUG: translateText: Unexpected API response format. Data:', data);
      throw new Error('Unexpected API response format');
    }

    return translatedText.trim();
  }

  // Removed generateElementId as it's no longer used with the new revert logic

  function addTranslationIndicator(element) {
    // Ensure element is a valid HTML element
    if (!(element instanceof HTMLElement)) return;

    if (!element.hasAttribute('data-translated-indicator')) {
      element.setAttribute('data-translated-indicator', 'true');
      // It's generally better to use classes for styling, but for simplicity of
      // this script, direct style manipulation is kept.
      // Consider moving these to content.css if styles become complex.
      element.style.setProperty('background', 'linear-gradient(90deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%)', 'important');
      element.style.setProperty('border-left', '3px solid #667eea', 'important');
      element.style.setProperty('padding-left', '8px', 'important');
      element.style.setProperty('transition', 'all 0.3s ease', 'important');
    }
  }

  function removeTranslationIndicator(element) {
    if (!(element instanceof HTMLElement)) return;

    if (element.hasAttribute('data-translated-indicator')) {
      element.removeAttribute('data-translated-indicator');
      element.style.background = '';
      element.style.borderLeft = '';
      element.style.paddingLeft = '';
      element.style.transition = '';
    }
  }

  function revertPage(showRefreshConfirm = true) {
    console.log('[LocalLLMTranslator] DEBUG: Reverting page content...');
    
    originalContent.forEach((nodeEntries, parentId) => {
      const parentEl = document.querySelector(`[data-llm-translator-id="${parentId}"]`);
      if (parentEl) {
        nodeEntries.forEach(entry => {
          // Check if the node is still part of the parent element
          if (entry.node && parentEl.contains(entry.node)) {
            console.log(`[LocalLLMTranslator] DEBUG: Reverting node in parent ${parentId}: "${entry.node.nodeValue}" to "${entry.originalValue}"`);
            entry.node.nodeValue = entry.originalValue;
          } else {
            console.warn(`[LocalLLMTranslator] DEBUG: Original node for parentId ${parentId} is no longer in the expected parent or document. Original value was: "${entry.originalValue}"`);
          }
        });
        removeTranslationIndicator(parentEl);
        parentEl.removeAttribute('data-llm-translator-id');
      } else {
        console.warn(`[LocalLLMTranslator] DEBUG: Parent element with ID ${parentId} not found during revert.`);
      }
    });

    console.log(`[LocalLLMTranslator] DEBUG: Cleared ${originalContent.size} stored original content entries.`);
    originalContent.clear();
    nextElementId = 0; // Reset ID counter for next translation

    if (showRefreshConfirm) {
      // Refresh the page as a fallback
      setTimeout(() => {
        if (confirm('Page content has been reverted. Would you like to refresh the page to ensure full restoration (e.g., for scripts or complex elements)?')) {
          location.reload();
        }
      }, 500); // Short delay to allow user to see the revert before confirm
    }
  }

})();
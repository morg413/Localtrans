// Content script for webpage translation
(function() {
  'use strict';

  let originalContent = new Map();
  let isTranslating = false;
  let translationConfig = null;

  // Initialize translation functionality
  window.startTranslation = async function(config) {
    console.log('[LocalLLMTranslator] startTranslation called with config:', config);
    translationConfig = config;
    await translatePage();
  };

  // Revert translation functionality
  window.revertTranslation = function() {
    console.log('[LocalLLMTranslator] revertTranslation called');
    revertPage();
  };

  async function translatePage() {
    console.log('[LocalLLMTranslator] translatePage started');
    if (isTranslating) {
      console.log('[LocalLLMTranslator] Already translating, exiting translatePage.');
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
      console.log('[LocalLLMTranslator] Getting translatable elements...');
      const textElements = getTranslatableElements();
      console.log(`[LocalLLMTranslator] Found ${textElements.length} translatable elements.`);
      
      if (textElements.length === 0) {
        console.warn('[LocalLLMTranslator] No translatable content found.');
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
      console.log(`[LocalLLMTranslator] Created ${batches.length} batches of size ${batchSize}.`);

      let completedBatches = 0;

      console.log('[LocalLLMTranslator] Starting batch processing...');
      for (const batch of batches) {
        await processBatch(batch, completedBatches + 1, batches.length); // Pass batch numbers for logging
        completedBatches++;
        
        const progress = 20 + (completedBatches / batches.length) * 70;
        chrome.runtime.sendMessage({
          type: 'TRANSLATION_PROGRESS',
          progress: Math.round(progress),
          message: `Translated ${completedBatches} of ${batches.length} batches...`
        });
      }
      console.log('[LocalLLMTranslator] All batches processed.');

      chrome.runtime.sendMessage({
        type: 'TRANSLATION_COMPLETE',
        progress: 100
      });
      console.log('[LocalLLMTranslator] Translation complete message sent.');

    } catch (error) {
      console.error('[LocalLLMTranslator] Translation error in translatePage:', error);
      chrome.runtime.sendMessage({
        type: 'TRANSLATION_ERROR',
        error: error.message
      });
    } finally {
      console.log('[LocalLLMTranslator] translatePage finished. Resetting isTranslating flag.');
      isTranslating = false;
    }
  }

  function getTranslatableElements() {
    console.log('[LocalLLMTranslator] getTranslatableElements: Walking DOM...');
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
    console.log(`[LocalLLMTranslator] processBatch: Starting batch ${batchNum}/${totalBatches}, ${elements.length} elements.`);
    const textsToTranslate = elements.map(el => el.textContent.trim());
    const combinedText = textsToTranslate.join('\n---\n');
    console.log(`[LocalLLMTranslator] processBatch: Combined text for batch ${batchNum}:`, combinedText);

    try {
      console.log(`[LocalLLMTranslator] processBatch: Calling translateText for batch ${batchNum}...`);
      const translatedText = await translateText(combinedText);
      console.log(`[LocalLLMTranslator] processBatch: Raw translated text for batch ${batchNum}:`, translatedText);

      const translatedParts = translatedText.split('\n---\n');
      console.log(`[LocalLLMTranslator] processBatch: Split translated parts for batch ${batchNum}:`, translatedParts);

      if (translatedParts.length !== textsToTranslate.length) {
        console.warn(`[LocalLLMTranslator] processBatch: Mismatch in translated parts length for batch ${batchNum}. Expected ${textsToTranslate.length}, got ${translatedParts.length}. Some translations might be incorrect or missing.`);
      }

      // Apply translations
      elements.forEach((element, index) => {
        if (translatedParts[index] && translatedParts[index].trim()) {
          const originalText = element.textContent;
          const translatedFragment = translatedParts[index].trim();
          console.log(`[LocalLLMTranslator] processBatch: Applying translation to element ${index} in batch ${batchNum}: "${originalText}" -> "${translatedFragment}"`);

          // Store original content
          const elementId = generateElementId(element); // Assuming this is deterministic enough for a short period
          originalContent.set(elementId, originalText);
          
          // Apply translation
          element.textContent = translatedFragment;
          
          // Add visual indicator
          addTranslationIndicator(element.parentElement);
        } else {
          console.warn(`[LocalLLMTranslator] processBatch: No valid translation for element ${index} in batch ${batchNum}. Original: "${element.textContent.trim()}"`);
        }
      });
      console.log(`[LocalLLMTranslator] processBatch: Finished applying translations for batch ${batchNum}.`);

    } catch (error) {
      console.error(`[LocalLLMTranslator] Batch translation error in processBatch (batch ${batchNum}):`, error);
      // Continue with next batch even if this one fails
    }
  }

  async function translateText(text) {
    console.log('[LocalLLMTranslator] translateText: Starting with text:', text);
    const { llmUrl, model, targetLanguage } = translationConfig;
    console.log('[LocalLLMTranslator] translateText: Config:', { llmUrl, model, targetLanguage });

    const prompt = `Translate the following text to ${targetLanguage}. Preserve the original formatting and structure. Only return the translated text, nothing else. If there are multiple sections separated by "---", translate each section separately and maintain the "---" separators.

Text to translate:
${text}`;
    console.log('[LocalLLMTranslator] translateText: Generated prompt:', prompt);

    // Try different API formats based on the URL
    let response;
    let apiType = 'Unknown';
    const FETCH_TIMEOUT = 30000; // 30 seconds timeout
    
    console.log('[LocalLLMTranslator] translateText: Preparing fetch request...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.warn(`[LocalLLMTranslator] translateText: Fetch request timed out after ${FETCH_TIMEOUT / 1000} seconds.`);
      controller.abort();
    }, FETCH_TIMEOUT);

    try {
      if (llmUrl.includes('localhost:11434') || llmUrl.includes('ollama')) {
        apiType = 'Ollama';
        const requestBody = { model: model, prompt: prompt, stream: false };
        console.log(`[LocalLLMTranslator] translateText: Calling ${apiType} API at ${llmUrl}/api/generate with body:`, JSON.stringify(requestBody));
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
        console.log(`[LocalLLMTranslator] translateText: Calling ${apiType} API at ${llmUrl}/v1/chat/completions with body:`, JSON.stringify(requestBody));
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
      console.log(`[LocalLLMTranslator] translateText: Fetch response received from ${apiType} API. Status: ${response.status}, OK: ${response.ok}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[LocalLLMTranslator] translateText: API error response text from ${apiType}:`, errorText);
        throw new Error(`Translation API error: ${response.status} ${response.statusText}. Response: ${errorText}`);
      }
    } catch (error) {
      clearTimeout(timeoutId); // Clear timeout if fetch itself throws an error (e.g., network error, aborted)
      if (error.name === 'AbortError') {
        console.error('[LocalLLMTranslator] translateText: Fetch aborted due to timeout.');
        throw new Error(`Translation request timed out after ${FETCH_TIMEOUT / 1000} seconds.`);
      }
      console.error(`[LocalLLMTranslator] translateText: Fetch error for ${apiType} API:`, error);
      throw error; // Re-throw other errors
    }

    const responseText = await response.text();
    console.log(`[LocalLLMTranslator] translateText: Raw response text from ${apiType}:`, responseText);

    let data;
    try {
      data = JSON.parse(responseText);
      console.log(`[LocalLLMTranslator] translateText: Parsed JSON data from ${apiType}:`, data);
    } catch (e) {
      console.error(`[LocalLLMTranslator] translateText: Failed to parse JSON response from ${apiType}. Error:`, e);
      throw new Error(`Failed to parse JSON response from translation API. Response: ${responseText}`);
    }
    
    // Extract translated text based on API format
    let translatedText;
    if (data.response) {
      // Ollama format
      translatedText = data.response;
      console.log(`[LocalLLMTranslator] translateText: Extracted text (Ollama format):`, translatedText);
    } else if (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) {
      // OpenAI format
      translatedText = data.choices[0].message.content;
      console.log(`[LocalLLMTranslator] translateText: Extracted text (OpenAI format):`, translatedText);
    } else {
      console.error('[LocalLLMTranslator] translateText: Unexpected API response format. Data:', data);
      throw new Error('Unexpected API response format');
    }

    return translatedText.trim();
  }

  function generateElementId(element) {
    return `translate_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  function addTranslationIndicator(element) {
    if (!element.hasAttribute('data-translated')) {
      element.setAttribute('data-translated', 'true');
      element.style.background = 'linear-gradient(90deg, rgba(102, 126, 234, 0.1) 0%, rgba(118, 75, 162, 0.1) 100%)';
      element.style.borderLeft = '3px solid #667eea';
      element.style.paddingLeft = '8px';
      element.style.transition = 'all 0.3s ease';
    }
  }

  function revertPage() {
    // Remove all translation indicators
    const translatedElements = document.querySelectorAll('[data-translated="true"]');
    translatedElements.forEach(el => {
      el.removeAttribute('data-translated');
      el.style.background = '';
      el.style.borderLeft = '';
      el.style.paddingLeft = '';
      el.style.transition = '';
    });

    // Restore original content
    originalContent.forEach((originalText, elementId) => {
      // This is a simplified revert - in a real implementation,
      // you'd need to store more detailed element references
      const elements = getTranslatableElements();
      elements.forEach(el => {
        if (originalContent.has(generateElementId(el))) {
          el.textContent = originalText;
        }
      });
    });

    originalContent.clear();
    
    // Refresh the page as a fallback
    setTimeout(() => {
      if (confirm('Would you like to refresh the page to fully restore the original content?')) {
        location.reload();
      }
    }, 1000);
  }

})();
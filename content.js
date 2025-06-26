// Content script for webpage translation
(function() {
  'use strict';

  let originalContent = new Map();
  let isTranslating = false;
  let translationConfig = null;

  // Initialize translation functionality
  window.startTranslation = async function(config) {
    translationConfig = config;
    await translatePage();
  };

  // Revert translation functionality
  window.revertTranslation = function() {
    revertPage();
  };

  async function translatePage() {
    if (isTranslating) return;
    isTranslating = true;

    try {
      // Send progress update
      chrome.runtime.sendMessage({
        type: 'TRANSLATION_PROGRESS',
        progress: 10,
        message: 'Analyzing page content...'
      });

      // Get all text elements
      const textElements = getTranslatableElements();
      
      if (textElements.length === 0) {
        throw new Error('No translatable content found on this page');
      }

      chrome.runtime.sendMessage({
        type: 'TRANSLATION_PROGRESS',
        progress: 20,
        message: `Found ${textElements.length} elements to translate...`
      });

      // Process elements in batches
      const batchSize = 10;
      const batches = [];
      
      for (let i = 0; i < textElements.length; i += batchSize) {
        batches.push(textElements.slice(i, i + batchSize));
      }

      let completedBatches = 0;

      for (const batch of batches) {
        await processBatch(batch);
        completedBatches++;
        
        const progress = 20 + (completedBatches / batches.length) * 70;
        chrome.runtime.sendMessage({
          type: 'TRANSLATION_PROGRESS',
          progress: Math.round(progress),
          message: `Translated ${completedBatches} of ${batches.length} batches...`
        });
      }

      chrome.runtime.sendMessage({
        type: 'TRANSLATION_COMPLETE',
        progress: 100
      });

    } catch (error) {
      console.error('Translation error:', error);
      chrome.runtime.sendMessage({
        type: 'TRANSLATION_ERROR',
        error: error.message
      });
    } finally {
      isTranslating = false;
    }
  }

  function getTranslatableElements() {
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

  async function processBatch(elements) {
    const textsToTranslate = elements.map(el => el.textContent.trim());
    const combinedText = textsToTranslate.join('\n---\n');

    try {
      const translatedText = await translateText(combinedText);
      const translatedParts = translatedText.split('\n---\n');

      // Apply translations
      elements.forEach((element, index) => {
        if (translatedParts[index] && translatedParts[index].trim()) {
          // Store original content
          const elementId = generateElementId(element);
          originalContent.set(elementId, element.textContent);
          
          // Apply translation
          element.textContent = translatedParts[index].trim();
          
          // Add visual indicator
          addTranslationIndicator(element.parentElement);
        }
      });

    } catch (error) {
      console.error('Batch translation error:', error);
      // Continue with next batch even if this one fails
    }
  }

  async function translateText(text) {
    const { llmUrl, model, targetLanguage } = translationConfig;

    const prompt = `Translate the following text to ${targetLanguage}. Preserve the original formatting and structure. Only return the translated text, nothing else. If there are multiple sections separated by "---", translate each section separately and maintain the "---" separators.

Text to translate:
${text}`;

    // Try different API formats based on the URL
    let response;
    
    if (llmUrl.includes('localhost:11434') || llmUrl.includes('ollama')) {
      // Ollama API format
      response = await fetch(`${llmUrl}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          prompt: prompt,
          stream: false
        })
      });
    } else {
      // OpenAI-compatible API format
      response = await fetch(`${llmUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: 'user', content: prompt }
          ],
          max_tokens: 2000,
          temperature: 0.3
        })
      });
    }

    if (!response.ok) {
      throw new Error(`Translation API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Extract translated text based on API format
    let translatedText;
    if (data.response) {
      // Ollama format
      translatedText = data.response;
    } else if (data.choices && data.choices[0]) {
      // OpenAI format
      translatedText = data.choices[0].message.content;
    } else {
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
// Simple React-like component system for the extension popup
class Component {
  constructor(props = {}) {
    this.props = props;
    this.state = {};
    this.element = null;
  }

  setState(newState) {
    this.state = { ...this.state, ...newState };
    this.render();
  }

  createElement(tag, props = {}, ...children) {
    const element = document.createElement(tag);
    
    Object.entries(props).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'onClick') {
        element.addEventListener('click', value);
      } else if (key === 'onChange') {
        element.addEventListener('change', value);
      } else if (key === 'value' && (tag === 'input' || tag === 'select')) {
        element.value = value;
      } else if (key === 'disabled') {
        element.disabled = value;
      } else if (key === 'style') {
        element.setAttribute('style', value);
      } else {
        element.setAttribute(key, value);
      }
    });

    children.forEach(child => {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else if (child instanceof HTMLElement) {
        element.appendChild(child);
      }
    });

    return element;
  }

  render() {
    // Override in subclasses
    return this.createElement('div');
  }

  mount(container) {
    this.element = this.render();
    container.appendChild(this.element);
  }

  update() {
    if (this.element && this.element.parentNode) {
      const newElement = this.render();
      this.element.parentNode.replaceChild(newElement, this.element);
      this.element = newElement;
    }
  }
}

class TranslatorPopup extends Component {
  constructor() {
    super();
    this.state = {
      llmUrl: 'http://localhost:11434',
      model: 'llama2',
      targetLanguage: 'Spanish',
      isTranslating: false,
      isTestingConnection: false,
      connectionStatus: null, // 'success', 'error', or null
      progress: 0,
      status: null,
      customLanguage: '',
      showStopButton: false // New state for stop button visibility
    };
    
    this.loadSettings();
    this.messageListener = null; // To keep track of the listener
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get([
        'llmUrl', 'model', 'targetLanguage', 'customLanguage', 'connectionStatus'
      ]);
      
      this.setState({
        llmUrl: result.llmUrl || 'http://localhost:11434',
        model: result.model || 'llama2',
        targetLanguage: result.targetLanguage || 'Spanish',
        customLanguage: result.customLanguage || '',
        connectionStatus: result.connectionStatus || null,
        // Do not reset showStopButton on load, it's transient
      });
    } catch (error) {
      console.error('Error loading settings:', error);
    }
  }

  async saveSettings() {
    try {
      await chrome.storage.sync.set({
        llmUrl: this.state.llmUrl,
        model: this.state.model,
        targetLanguage: this.state.targetLanguage,
        customLanguage: this.state.customLanguage,
        connectionStatus: this.state.connectionStatus
      });
    } catch (error) {
      console.error('Error saving settings:', error);
    }
  }

  async testConnection() {
    this.setState({ 
      isTestingConnection: true,
      status: { type: 'info', message: 'Testing connection...' } 
    });
    
    try {
      let response;
      
      // Try different endpoints based on URL
      if (this.state.llmUrl.includes('localhost:11434') || this.state.llmUrl.includes('ollama')) {
        // Test Ollama API
        response = await fetch(`${this.state.llmUrl}/api/tags`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
      } else {
        // Test OpenAI-compatible API with a simple request
        response = await fetch(`${this.state.llmUrl}/v1/models`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });
      }

      if (response.ok) {
        this.setState({ 
          connectionStatus: 'success',
          status: { type: 'success', message: 'Connection successful! You can now translate pages.' } 
        });
        await this.saveSettings();
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      console.error('Connection test error:', error);
      this.setState({ 
        connectionStatus: 'error',
        status: { 
          type: 'error', 
          message: `Connection failed: ${error.message}. Make sure your LLM server is running.` 
        } 
      });
      await this.saveSettings();
    } finally {
      this.setState({ isTestingConnection: false });
    }
  }

  isTranslateButtonEnabled() {
    const { llmUrl, model, targetLanguage, customLanguage, isTranslating, connectionStatus } = this.state;
    
    // Check if all required fields are filled
    const hasRequiredFields = llmUrl.trim() && model.trim() && 
      (targetLanguage !== 'Custom' || customLanguage.trim());
    
    // Button is enabled if not translating and has required fields
    // Connection test is recommended but not required
    return !isTranslating && hasRequiredFields;
  }

  async translatePage() {
    if (this.state.isTranslating || !this.isTranslateButtonEnabled()) return;

    this.setState({ 
      isTranslating: true, 
      progress: 0,
      status: { type: 'info', message: 'Starting translation...' },
      showStopButton: true
    });

    try {
      // Save current settings
      await this.saveSettings();

      // Get current tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        throw new Error("Could not get active tab information.");
      }
      
      // Inject content script and start translation
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: this.initializeTranslation, // This is a global function in content.js
        args: [{
          llmUrl: this.state.llmUrl,
          model: this.state.model,
          targetLanguage: this.state.targetLanguage === 'Custom' ? 
            this.state.customLanguage : this.state.targetLanguage
        }]
      });

      // Listen for progress updates
      this.listenForProgress(tab.id);

    } catch (error) {
      console.error('Translation error:', error);
      this.setState({ 
        isTranslating: false,
        status: { type: 'error', message: 'Translation failed: ' + error.message },
        showStopButton: false
      });
    }
  }

  listenForProgress(tabId) {
    // Remove existing listener if any, to avoid duplicates
    if (this.messageListener && chrome.runtime.onMessage.hasListener(this.messageListener)) {
      chrome.runtime.onMessage.removeListener(this.messageListener);
    }

    this.messageListener = (message, sender) => {
      // Ensure message is from the content script of the tab we are translating
      if (sender.tab && sender.tab.id !== tabId && message.type !== 'TRANSLATION_ERROR_GLOBAL') { // TRANSLATION_ERROR_GLOBAL could be from background
          // console.log("Popup: Ignoring message from other tab", sender.tab.id, message);
          return true;
      }

      if (message.type === 'TRANSLATION_PROGRESS') {
        this.setState({ 
          progress: message.progress,
          status: { type: 'info', message: message.message }
        });
      } else if (message.type === 'TRANSLATION_COMPLETE') {
        this.setState({ 
          isTranslating: false,
          progress: 100,
          status: { type: 'success', message: 'Translation completed!' },
          showStopButton: false
        });
        if (this.messageListener) chrome.runtime.onMessage.removeListener(this.messageListener);
      } else if (message.type === 'TRANSLATION_ERROR') {
        this.setState({ 
          isTranslating: false,
          status: { type: 'error', message: message.error },
          showStopButton: false
        });
        if (this.messageListener) chrome.runtime.onMessage.removeListener(this.messageListener);
      }
      return true; // Keep channel open for other listeners
    };

    chrome.runtime.onMessage.addListener(this.messageListener);
  }

  // This function is executed in the context of the content script
  initializeTranslation(config) {
    window.startTranslation(config);
  }

  async revertTranslation() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        throw new Error("Could not get active tab information for revert.");
      }
      
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.revertTranslation && window.revertTranslation()
      });

      this.setState({ 
        status: { type: 'success', message: 'Page reverted to original!' }
      });
    } catch (error) {
      this.setState({ 
        status: { type: 'error', message: 'Failed to revert page: ' + error.message }
      });
    }
  }

  async stopTranslation() {
    console.log("Stop translation button clicked");
    this.setState({
      status: { type: 'info', message: 'Attempting to stop translation...' },
      // isTranslating: false, // Keep true until confirmed stopped by content script or timeout
      showStopButton: false // Hide stop button immediately to prevent multiple clicks
    });

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'ABORT_TRANSLATION' });
      } else {
        throw new Error("Active tab not found to send abort signal.");
      }
      // The content script will send a TRANSLATION_ERROR message if successfully stopped.
      // Or, translation might complete before stop signal is fully processed.
    } catch (error) {
      console.error("Error sending stop translation message:", error);
      this.setState({
        status: { type: 'error', message: 'Error trying to stop: ' + error.message },
        isTranslating: false, // Assume it might not have stopped
        showStopButton: false
      });
    }
  }

  render() {
    const { 
      llmUrl, model, targetLanguage, isTranslating, isTestingConnection, 
      connectionStatus, progress, status, customLanguage, showStopButton
    } = this.state;

    const container = this.createElement('div', { className: 'popup-container' });

    // Header
    const header = this.createElement('div', { className: 'header' },
      this.createElement('h1', {}, '🌐 LLM Translator'),
      this.createElement('p', {}, 'Translate pages with your local LLM')
    );

    // Content
    const content = this.createElement('div', { className: 'content' });

    // Status
    if (status) {
      const statusEl = this.createElement('div', { 
        className: `status ${status.type}` 
      }, status.message);
      content.appendChild(statusEl);
    }

    // Progress bar
    if (isTranslating) {
      const progressContainer = this.createElement('div', { className: 'progress-bar' });
      const progressFill = this.createElement('div', { 
        className: 'progress-fill',
        style: `width: ${progress}%`
      });
      progressContainer.appendChild(progressFill);
      content.appendChild(progressContainer);
    }

    // Settings section
    const settingsSection = this.createElement('div', { className: 'settings-section' });
    settingsSection.appendChild(
      this.createElement('div', { className: 'section-title' }, '⚙️ Settings')
    );

    // LLM URL
    const urlGroup = this.createElement('div', { className: 'form-group' });
    urlGroup.appendChild(this.createElement('label', {}, 'LLM Server URL'));
    const urlInput = this.createElement('input', {
      type: 'text',
      value: llmUrl,
      placeholder: 'http://localhost:11434',
      onChange: (e) => {
        this.setState({ 
          llmUrl: e.target.value,
          connectionStatus: null // Reset connection status when URL changes
        });
      }
    });
    urlGroup.appendChild(urlInput);
    urlGroup.appendChild(
      this.createElement('div', { className: 'help-text' }, 
        'URL of your local LLM server (Ollama, OpenAI-compatible API, etc.)'
      )
    );
    settingsSection.appendChild(urlGroup);

    // Model
    const modelGroup = this.createElement('div', { className: 'form-group' });
    modelGroup.appendChild(this.createElement('label', {}, 'Model Name'));
    const modelInput = this.createElement('input', {
      type: 'text',
      value: model,
      placeholder: 'llama2',
      onChange: (e) => {
        this.setState({ 
          model: e.target.value,
          connectionStatus: null // Reset connection status when model changes
        });
      }
    });
    modelGroup.appendChild(modelInput);
    settingsSection.appendChild(modelGroup);

    // Target Language
    const langGroup = this.createElement('div', { className: 'form-group' });
    langGroup.appendChild(this.createElement('label', {}, 'Target Language'));
    const langSelect = this.createElement('select', {
      value: targetLanguage,
      onChange: (e) => this.setState({ targetLanguage: e.target.value })
    });
    
    const languages = [
      'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Russian',
      'Chinese', 'Japanese', 'Korean', 'Arabic', 'Hindi', 'Dutch',
      'Swedish', 'Norwegian', 'Danish', 'Finnish', 'Polish', 'Custom'
    ];
    
    languages.forEach(lang => {
      const option = this.createElement('option', { value: lang }, lang);
      langSelect.appendChild(option);
    });
    langGroup.appendChild(langSelect);

    // Custom language input
    if (targetLanguage === 'Custom') {
      const customInput = this.createElement('input', {
        type: 'text',
        value: customLanguage,
        placeholder: 'Enter custom language',
        onChange: (e) => this.setState({ customLanguage: e.target.value })
      });
      langGroup.appendChild(customInput);
    }

    settingsSection.appendChild(langGroup);

    // Test connection button
    const testBtn = this.createElement('button', {
      className: `btn btn-secondary ${connectionStatus === 'success' ? 'btn-success' : ''}`,
      disabled: isTestingConnection,
      onClick: () => this.testConnection()
    });
    
    if (isTestingConnection) {
      testBtn.appendChild(this.createElement('div', { className: 'loading-spinner' }));
      testBtn.appendChild(document.createTextNode(' Testing...'));
    } else if (connectionStatus === 'success') {
      testBtn.appendChild(document.createTextNode('✅ Connection OK'));
    } else {
      testBtn.appendChild(document.createTextNode('🔍 Test Connection'));
    }
    
    settingsSection.appendChild(testBtn);
    content.appendChild(settingsSection);

    // Translation controls
    const controlsContainer = this.createElement('div', { className: 'translation-controls' });
    
    const translateBtn = this.createElement('button', {
      className: 'btn btn-primary',
      disabled: !this.isTranslateButtonEnabled(),
      onClick: () => this.translatePage()
    });
    
    if (isTranslating) {
      translateBtn.appendChild(this.createElement('div', { className: 'loading-spinner' }));
      translateBtn.appendChild(document.createTextNode(' Translating...'));
    } else {
      translateBtn.appendChild(document.createTextNode('🚀 Translate Page'));
    }
    
    const revertBtn = this.createElement('button', {
      className: 'btn btn-secondary',
      onClick: () => this.revertTranslation()
    }, '↶ Revert');

    const stopBtn = this.createElement('button', {
        className: 'btn btn-danger',
        onClick: () => this.stopTranslation(),
        style: `display: ${showStopButton ? 'inline-flex' : 'none'};` // Show only when showStopButton is true
    }, '🛑 Stop Translation');

    controlsContainer.appendChild(translateBtn);
    if (showStopButton) { // Conditionally add to DOM, or just control display style
        controlsContainer.appendChild(stopBtn);
    }
    controlsContainer.appendChild(revertBtn);
    content.appendChild(controlsContainer);

    // Help text for translate button
    if (!this.isTranslateButtonEnabled() && !isTranslating) {
      const helpText = this.createElement('div', { className: 'help-text' });
      if (!llmUrl.trim() || !model.trim()) {
        helpText.appendChild(document.createTextNode('Please fill in LLM URL and Model fields to enable translation.'));
      } else if (targetLanguage === 'Custom' && !customLanguage.trim()) {
        helpText.appendChild(document.createTextNode('Please enter a custom language name.'));
      }
      content.appendChild(helpText);
    }

    container.appendChild(header);
    container.appendChild(content);

    return container;
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  const popup = new TranslatorPopup();
  popup.mount(document.getElementById('root'));
});
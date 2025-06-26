# Local LLM Webpage Translator Browser Extension

A powerful browser extension that translates web pages using your local Large Language Model (LLM). Perfect for privacy-conscious users who want translation capabilities without sending data to external services.

## Features

- 🌐 **Full Page Translation**: Translate entire web pages while preserving formatting
- 🎯 **Text Selection Translation**: Right-click to translate selected text
- 🔒 **Privacy First**: All translations happen locally - no data sent to external servers
- ⚡ **Fast & Efficient**: Direct connection to your local LLM server
- 🎨 **Beautiful UI**: Modern, responsive design with smooth animations
- 🔧 **Configurable**: Support for various LLM servers and models
- 📱 **Visual Feedback**: Clear indicators for translated content
- ↶ **Revert Function**: Easily restore original content

## Supported LLM Servers

- **Ollama** (recommended): `http://localhost:11434`
- **OpenAI-compatible APIs**: Any server that implements OpenAI's chat completions API
- **Custom endpoints**: Configure your own local LLM server

## Installation

### 1. Download & Extract
Download the extension files and extract them to a folder.

### 2. Load in Browser

#### Chrome/Edge:
1. Open `chrome://extensions/` (or `edge://extensions/`)
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select the extension folder

#### Firefox:
1. Open `about:debugging`
2. Click "This Firefox"
3. Click "Load Temporary Add-on"
4. Select the `manifest.json` file

### 3. Set Up Local LLM
Make sure you have a local LLM server running:

#### Using Ollama (Recommended):
```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Download a model
ollama pull llama2

# Start the server (runs on http://localhost:11434)
ollama serve
```

## Usage

### Configure Settings
1. Click the extension icon in your browser toolbar
2. Configure your LLM server URL (default: `http://localhost:11434`)
3. Set your model name (e.g., `llama2`, `mistral`, `codellama`)
4. Choose your target language
5. Click "Test Connection" to verify setup

### Translate Web Pages
1. Navigate to any webpage
2. Click the extension icon
3. Click "🚀 Translate Page"
4. Watch as the page is translated section by section
5. Use "↶ Revert" to restore original content

### Translate Selected Text
1. Select any text on a webpage
2. Right-click and choose "Translate with Local LLM"
3. View the translation in a tooltip

## Configuration Options

| Setting | Description | Example |
|---------|-------------|---------|
| LLM Server URL | Your local LLM server endpoint | `http://localhost:11434` |
| Model Name | The model to use for translation | `llama2`, `mistral` |
| Target Language | Language to translate to | Spanish, French, German, etc. |
| Custom Language | For languages not in the preset list | Esperanto, Latin, etc. |

## Supported Languages

The extension includes presets for common languages:
- Spanish, French, German, Italian, Portuguese
- Russian, Chinese, Japanese, Korean, Arabic, Hindi
- Dutch, Swedish, Norwegian, Danish, Finnish, Polish
- Custom language option for any language your LLM supports

## Technical Details

### Architecture
- **Manifest V3**: Modern extension architecture
- **Content Scripts**: Inject translation functionality into web pages
- **Background Service Worker**: Handle extension lifecycle and messaging
- **React-like Popup**: Modern UI components with state management
- **Chrome Storage API**: Persistent settings storage

### Translation Process
1. **Content Analysis**: Identifies translatable text elements
2. **Batch Processing**: Groups elements for efficient translation
3. **LLM Communication**: Sends requests to your local LLM server
4. **Progressive Updates**: Updates page content as translations complete
5. **Visual Indicators**: Highlights translated content

### Privacy & Security
- ✅ All data stays on your local machine
- ✅ No external API calls except to your local LLM
- ✅ No tracking or analytics
- ✅ Open source and auditable code

## Troubleshooting

### "Connection Failed" Error
- Ensure your LLM server is running
- Check the server URL in extension settings
- Verify the server is accessible at the configured port

### Slow Translation
- Try a smaller/faster model
- Reduce batch size by refreshing and retrying
- Check your LLM server's performance

### Some Text Not Translated
- The extension skips very short text, numbers, and code
- Some dynamic content may not be detected
- Try refreshing the page and translating again

### Extension Not Loading
- Ensure you've enabled Developer Mode
- Check for JavaScript errors in the browser console
- Try reloading the extension

## Development

### Building from Source
```bash
# Install dependencies (optional, for development)
npm install

# Create distribution package
npm run pack
```

### File Structure
```
local-llm-translator-extension/
├── manifest.json          # Extension manifest
├── popup.html            # Extension popup UI
├── popup.js              # Popup functionality
├── popup.css             # Popup styles
├── content.js            # Content script for page translation
├── content.css           # Styles for translated content
├── background.js         # Background service worker
├── icons/                # Extension icons
└── README.md            # This file
```

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues for bugs and feature requests.

## License

MIT License - feel free to use, modify, and distribute as needed.

## Changelog

### Version 1.0.0
- Initial release
- Full page translation
- Text selection translation
- Ollama and OpenAI-compatible API support
- Modern UI with visual feedback
- Persistent settings storage
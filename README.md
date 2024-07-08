# ScreenHawk Chrome Extension

## Overview

This Chrome extension allows users to capture screenshots of web pages and analyze them using OpenAI's GPT-4 Vision API. Users can ask questions about the captured screenshot and receive AI-generated responses.

## Features

- Screenshot capture of the current tab
- Integration with OpenAI's GPT-4 Vision API
- User-friendly interface for entering prompts
- Display of AI-generated responses within the extension

## Installation

1. Clone this repository:
git clone https://github.com/yourusername/ai-screenshot-analyzer.git

Copy
2. Navigate to the project directory:
cd ai-screenshot-analyzer

Copy
3. Install dependencies:
npm install

Copy
4. Build the extension:
npm run build

livecodeserver
Copy

## Loading the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked" and select the `dist` folder in your project directory

## Usage

1. Click the extension icon in your Chrome toolbar
2. Click "Capture Screenshot" to capture the current tab
3. Enter a prompt about the screenshot in the dialog that appears
4. View the AI-generated response in a new dialog

## Development

- `npm run build`: Build the extension
- `npm run watch`: Watch for changes and rebuild
- `npm run lint`: Run ESLint
- `npm test`: Run tests (if implemented)

## Project Structure

- `src/`: Source TypeScript files
- `public/`: Static files (HTML, manifest)
- `dist/`: Build output (generated)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- OpenAI for providing the GPT-4 Vision API
- The Chrome Extensions development community

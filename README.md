# ScreenHawk

ScreenHawk is a Chrome extension that allows you to capture a screenshot of your active tab, provide context or ask a question about it, and get an analysis from OpenAI's API. The response from OpenAI is then displayed directly on the page.

## Features

- **Screenshot Capture:** Quickly capture a screenshot of the currently active browser tab.
- **Area Selection:** Select specific areas of the screenshot using an intuitive click-and-drag interface.
- **User Input:** A prompt allows you to enter text to provide context or ask a specific question related to the captured screenshot.
- **OpenAI Integration:** Seamlessly sends the screenshot and your query to the OpenAI API for in-depth analysis.
- **In-Page Display:** Displays the OpenAI API's response directly on the current webpage, making it easy to view and use.
- **Keyboard Shortcut:** Use `Ctrl+Shift+S` (or `Cmd+Shift+S` on Mac) for quick and easy screenshot capture.

## How to Use

1.  **Activate the Extension:** Click the ScreenHawk extension icon in your Chrome toolbar or use the keyboard shortcut (`Ctrl+Shift+S` or `Cmd+Shift+S`).
2.  **Capture Screenshot:** The extension will automatically capture a screenshot of your current tab.
3.  **Select Area:** Click and drag to select a specific area of the screenshot you want to analyze. You can press Escape to cancel the selection.
4.  **Provide Context/Query:** A dialog box will appear. Enter any context or specific questions you have about the selected area.
5.  **Submit for Analysis:** Click the "Submit" button.
6.  **View Results:** The response from the OpenAI API will be displayed in an overlay on the current page.

## Installation (Development Build)

To install ScreenHawk for development:

1.  **Clone the Repository:**
    ```bash
    git clone <repository-url>
    cd screenhawk
    ```
2.  **Install Dependencies:**
    ```bash
    npm install
    ```
3.  **Build the Extension:**
    ```bash
    npm run build
    ```

4.  **Load Unpacked Extension in Chrome:**
    *   Open Chrome and navigate to `chrome://extensions`.
    *   Enable "Developer mode" using the toggle switch in the top right corner.
    *   Click the "Load unpacked" button.
    *   Select the `dist` directory from your cloned repository.

## Configuration

Before using the extension, you need to configure your OpenAI API key:

1.  Open the file `src/api.ts` in your code editor.
2.  Locate the following line:
    ```typescript
    const OPENAI_API_KEY = '';
    ```
3.  Replace `''` with your actual OpenAI API key.
4.  **Important:** Rebuild the extension (`npm run build`) after changing the API key for the changes to take effect.

## Key Technologies

-   **TypeScript:** For robust and maintainable code.
-   **Webpack:** To bundle the JavaScript, TypeScript, and other assets.
-   **Chrome Extension APIs:** To interact with the Chrome browser, capture tabs, and display content.
-   **OpenAI API:** For image analysis and contextual understanding.

## Contributing

Contributions are welcome! If you have ideas for new features, bug fixes, or improvements, please feel free to:

1.  Fork the repository.
2.  Create a new branch for your feature or fix.
3.  Make your changes.
4.  Submit a pull request with a clear description of your changes.

## License

This project is currently not licensed. Please refer to the repository for any updates on licensing.

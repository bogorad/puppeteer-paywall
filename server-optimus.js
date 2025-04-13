require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = express();
// Middleware to parse incoming JSON request bodies
app.use(express.json());

// ========================================================================
// Global Error Handlers (Always Log These)
// ========================================================================
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'Reason:', reason);
  process.exit(1);
});

// ========================================================================
// Health Check Endpoint (Simple, No Debug Logging Needed)
// ========================================================================
app.get('/health', (req, res) => {
  res.json({ status: 'alive', timestamp: Date.now() });
});

// ========================================================================
// Scraping Endpoint (`/scrape`)
// ========================================================================
app.post('/scrape', async (req, res) => {
  // --- 1. Extract Request Data & Debug Flag ---
  // Extract standard fields and the 'debug' flag. Default debug to false.
  const { url, selector, method = 'css', debug = false } = req.body;

  // --- Create a Conditional Logger ---
  // This function will only log if the 'debug' flag for this request is true.
  const logDebug = (...args) => {
    if (debug) {
      console.log(...args);
    }
  };

  // Log the raw request body ONLY if debug is enabled
  logDebug('[DEBUG] Raw req.body received:', JSON.stringify(req.body, null, 2));

  // Log basic request info ONLY if debug is enabled
  logDebug(`[REQUEST] Processing scrape request: url=${url}, selector="${selector}", method=${method}, debug=${debug}`);

  // Basic validation (Always perform, log warning only if debug enabled)
  if (!url || !selector) {
    if (debug) { // Only log the warning if debugging this request
        console.warn('[REQUEST] Bad Request: Missing url or selector.');
    }
    // Always return the error response regardless of debug flag
    return res.status(400).json({ error: 'Missing required fields: url and selector' });
  }

  // --- 2. Initialize Resources ---
  let browser = null;
  let page = null;
  let userDataDir = null;

  try {
    // --- 3. Prepare Browser Launch Options ---
    let extensionArgs = [];
    if (process.env.EXTENSION_PATHS) {
      logDebug(`[LAUNCH] Preparing extensions from: ${process.env.EXTENSION_PATHS}`);
      extensionArgs = [
        `--disable-extensions-except=${process.env.EXTENSION_PATHS}`,
        `--load-extension=${process.env.EXTENSION_PATHS}`
      ];
    }

    // Create temporary user data directory
    // No need to log the path unless debugging
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puppeteer-user-data-'));
    logDebug(`[LAUNCH] Created temporary user data dir: ${userDataDir}`);

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--use-gl=swiftshader',
      '--window-size=1280,720',
      '--font-render-hinting=none',
      ...extensionArgs
    ];

    // --- 4. Launch Browser ---
    logDebug('[LAUNCH] Initializing browser instance...');
    browser = await puppeteer.launch({
      executablePath: process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium',
      headless: false, // Consider 'new' if extensions support it and you don't need visual debugging
      userDataDir,
      args: launchArgs,
      // Only dump browser IO if the request explicitly asks for debug AND env is development
      dumpio: debug && process.env.NODE_ENV === 'development',
      timeout: 60000
    });
    logDebug('[LAUNCH] Browser launched successfully.');

    // --- 5. Create Page and Navigate ---
    logDebug('[NAVIGATE] Creating new page...');
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    logDebug('[NAVIGATE] Setting User-Agent...');
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.212 Safari/537.36');

    // Optional Delay
    logDebug('[DELAY] Waiting 3 seconds before navigating...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    logDebug(`[NAVIGATE] Loading URL: ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });
    logDebug(`[NAVIGATE] Page loaded successfully: ${url}`);

    // --- 6. Extract Data (Conditional Logic: XPath vs CSS) ---
    let extractedData;

    if (method === 'xpath') {
      // --- 6a. XPath Extraction Logic ---
      logDebug(`[XPATH] Evaluating XPath selector: ${selector}`);
      extractedData = await page.evaluate((xpathSelector) => {
        // Browser-side code - cannot use logDebug here directly
        // console.log calls inside evaluate only appear if dumpio is true
        try {
          const result = document.evaluate(xpathSelector, document, null, XPathResult.ANY_TYPE, null);
          const results = [];
          const processNode = (node) => { /* ... same as before ... */
            if (!node) return null;
            switch (node.nodeType) {
              case Node.ELEMENT_NODE: return node.outerHTML;
              case Node.ATTRIBUTE_NODE: case Node.TEXT_NODE: return node.nodeValue;
              case Node.COMMENT_NODE: return `<!-- ${node.nodeValue} -->`;
              default: return `Unsupported node type: ${node.nodeType}`;
            }
          };
          switch (result.resultType) { /* ... same as before ... */
            case XPathResult.NUMBER_TYPE: return result.numberValue;
            case XPathResult.STRING_TYPE: return result.stringValue;
            case XPathResult.BOOLEAN_TYPE: return result.booleanValue;
            case XPathResult.UNORDERED_NODE_ITERATOR_TYPE: case XPathResult.ORDERED_NODE_ITERATOR_TYPE:
              let node; while ((node = result.iterateNext())) { results.push(processNode(node)); } return results;
            case XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE: case XPathResult.ORDERED_NODE_SNAPSHOT_TYPE:
              for (let i = 0; i < result.snapshotLength; i++) { results.push(processNode(result.snapshotItem(i))); } return results;
            case XPathResult.ANY_UNORDERED_NODE_TYPE: case XPathResult.FIRST_ORDERED_NODE_TYPE:
              return processNode(result.singleNodeValue);
            default: return `Unknown XPathResult type: ${result.resultType}`;
          }
        } catch (error) {
          // console.error('Error during XPath evaluation in browser:', error); // Only visible with dumpio
          throw new Error(`XPath evaluation failed in browser: ${error.message}`);
        }
      }, selector);
      logDebug(`[XPATH] Evaluation successful.`);

    } else {
      // --- 6b. CSS Selector Extraction Logic ---
      logDebug(`[CSS] Waiting for CSS selector: ${selector}`);
      const elementHandle = await page.waitForSelector(selector, { timeout: 15000 });
      if (!elementHandle) {
          // This case should ideally not be reached if waitForSelector resolves,
          // but if it did, it's an error regardless of debug flag.
          throw new Error(`CSS selector "${selector}" was found by waitForSelector, but handle is unexpectedly null.`);
      }
      logDebug(`[CSS] Extracting outerHTML for selector: ${selector}`);
      extractedData = await elementHandle.evaluate(el => el.outerHTML);
      await elementHandle.dispose();
      logDebug(`[CSS] Extraction successful.`);
    }

    // --- 7. Send Response ---
    logDebug('[RESPONSE] Sending extracted data to client.');
    res.json(extractedData);

  } catch (error) {
    // --- 8. Handle Errors During Scraping ---
    // Always log the core error message
    console.error('[ERROR] Scraping failed:', error.message);
    // Log the full error details only if debugging this request OR in development env
    if (debug || process.env.NODE_ENV === 'development') {
        console.error('[ERROR] Full Error Details:', error);
    }

    let statusCode = 500;
    if (error.name === 'TimeoutError' || error.message.includes('timeout') || error.message.includes('exceeded')) { statusCode = 504; }
    else if (error.message.includes('selector') && (error.message.includes('not found') || error.message.includes('failed to find element'))) { statusCode = 404; }
    else if (error.message.includes('Navigation failed') || error.message.includes('net::ERR_')) { statusCode = 502; }
    else if (error.message.includes('XPath evaluation failed')) { statusCode = 400; }

    // Send error response
    res.status(statusCode).json({
      error: 'Scraping failed',
      details: error.message,
      type: error.constructor.name,
      // Include stack trace only if debugging this request OR in development env
      stack: (debug || process.env.NODE_ENV === 'development') ? error.stack : undefined
    });

  } finally {
    // --- 9. Cleanup Resources ---
    logDebug('[CLEANUP] Closing resources...');
    if (page) {
      try {
        await page.close();
        logDebug('[CLEANUP] Page closed.');
      } catch (e) {
        // Log cleanup errors only if debugging
        if (debug) console.error('[CLEANUP] Error closing page:', e);
      }
    }
    if (browser) {
      try {
        await browser.close();
        logDebug('[CLEANUP] Browser closed.');
      } catch (e) {
        // Log cleanup errors only if debugging
        if (debug) console.error('[CLEANUP] Error closing browser:', e);
      }
    }
    if (userDataDir) {
      logDebug(`[CLEANUP] Removing user data dir: ${userDataDir}`);
      try {
        if (fs.promises && fs.promises.rm) {
            await fs.promises.rm(userDataDir, { recursive: true, force: true });
        } else {
            fs.rmdirSync(userDataDir, { recursive: true });
        }
        logDebug('[CLEANUP] User data dir removed.');
      } catch (err) {
        // Log cleanup errors only if debugging
        if (debug) console.error('[CLEANUP] Failed to remove user data dir:', userDataDir, err);
      }
    }
    logDebug('[CLEANUP] Cleanup finished.');
  }
});

// ========================================================================
// Server Initialization (Always Log These)
// ========================================================================
const PORT = process.env.PORT || 5555;
app.listen(PORT, () => {
  console.log(`[SERVER] Service started. Running on port ${PORT}`);
  const execPath = process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium';
  console.log(`[CHROMIUM] Using executable path: ${execPath}`);
  if (!fs.existsSync(execPath)) {
      console.warn(`[WARNING] Chromium executable not found at specified path: ${execPath}`);
  }
  if (process.env.EXTENSION_PATHS) {
    console.log(`[CHROMIUM] Attempting to load extensions from: ${process.env.EXTENSION_PATHS}`);
  } else {
    console.log(`[CHROMIUM] No extensions configured to load.`);
  }
});

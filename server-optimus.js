require('dotenv').config();
const express = require('express');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const app = express();
app.use(express.json());

// Global error handlers
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled Rejection at:', promise, 'Reason:', reason);
  process.exit(1);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'alive', timestamp: Date.now() });
});

// Scraping endpoint
app.post('/scrape', async (req, res) => {
  const { url, selector, method = 'css' } = req.body;
  let browser, page;
  let userDataDir;

  try {
    // Prepare extension args if EXTENSION_PATHS is set
    let extensionArgs = [];
    if (process.env.EXTENSION_PATHS) {
      extensionArgs = [
        `--disable-extensions-except=${process.env.EXTENSION_PATHS}`,
        `--load-extension=${process.env.EXTENSION_PATHS}`
      ];
    }

    // Create a unique user data dir for this browser instance
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'puppeteer-user-data-'));

    console.log('[LAUNCH] Initializing browser');
    browser = await puppeteer.launch({
      executablePath: process.env.EXECUTABLE_PATH || '/usr/lib/chromium/chromium',
      headless: false, // EXTENSIONS REQUIRE HEADLESS: FALSE
      userDataDir,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--use-gl=swiftshader',
        '--window-size=1280,720',
        '--font-render-hinting=none',
        ...extensionArgs
      ],
      dumpio: true,
      timeout: 60000 // Increased timeout for slow starts
    });

    console.log('[NAVIGATE] Creating new page');
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // 3 second delay before navigation
    console.log('[DELAY] Waiting 3 seconds before navigating to the page...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    console.log(`[NAVIGATE] Loading ${url}`);
    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: 45000
    });

    let element;
    if (method === 'xpath') {
      console.log(`[XPATH] Waiting for selector: ${selector}`);
      await page.waitForXPath(selector, { timeout: 15000 });
      [element] = await page.$x(selector);
      if (!element) throw new Error('XPath selector not found');
    } else {
      console.log(`[CSS] Waiting for selector: ${selector}`);
      element = await page.waitForSelector(selector, { timeout: 15000 });
      if (!element) throw new Error('CSS selector not found');
    }

    const html = await element.evaluate(el => el.outerHTML);
    res.type('html').send(html);

  } catch (error) {
    console.error('[ERROR] Scraping failed:', error);
    res.status(500).json({
      error: 'Scraping failed',
      details: error.message,
      type: error.constructor.name,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  } finally {
    console.log('[CLEANUP] Closing resources');
    if (page) await page.close().catch(e => console.error('Page close error:', e));
    if (browser) await browser.close().catch(e => console.error('Browser close error:', e));
    // Clean up user data dir
    if (userDataDir) {
      try {
        fs.rmSync(userDataDir, { recursive: true, force: true });
      } catch (err) {
        console.error('Failed to remove user data dir:', userDataDir, err);
      }
    }
  }
});

// Server initialization
const PORT = 5555;
app.listen(PORT, () => {
  console.log(`[SERVER] Running on port ${PORT}`);
  console.log(`[CHROMIUM] Using executable: ${process.env.EXECUTABLE_PATH}`);
  if (process.env.EXTENSION_PATHS) {
    console.log(`[CHROMIUM] Loading extensions: ${process.env.EXTENSION_PATHS}`);
  }
});


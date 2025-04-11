const express = require('express');
const fs = require('fs').promises;
const puppeteer = require('puppeteer-core');

const EXTENSION_PATHS = [
  '/home/chuck/git/puppeteer-paywall/bypass-paywalls-chrome-clean-master',
  '/home/chuck/git/puppeteer-paywall/I-Still-Dont-Care-About-Cookies-1.1.4',
];
const executablePath = '/usr/lib/chromium/chromium';

const app = express();
app.use(express.json({ limit: '2mb' }));

let browser;

async function initBrowser() {
  console.log('[initBrowser] Initializing Puppeteer...');
  try {
    browser = await puppeteer.launch({
      headless: false,
      executablePath,
      args: [
        `--disable-extensions-except=${EXTENSION_PATHS.join(',')}`,
        `--load-extension=${EXTENSION_PATHS.join(',')}`
      ],
      userDataDir: './user_data',
    });
    console.log('[initBrowser] Browser launched successfully.');
  } catch (error) {
    console.error('[initBrowser] Failed to launch browser:', error);
    throw error;
  }
}

app.post('/scrape', async (req, res) => {
  console.log('[scrape] Received request.');
  const { url, selector } = req.body;
  console.log(`[scrape] url: ${url}`);
  console.log(`[scrape] selector: ${selector}`);

  if (!url || !selector) {
    console.warn('[scrape] Missing URL or selector.');
    return res.status(400).send('Missing url or selector');
  }

  let page;
  try {
    console.log('[scrape] Opening new page...');
    page = await browser.newPage();

    console.log(`[scrape] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'networkidle2' });
    console.log('[scrape] Page loaded.');

    console.log(`[scrape] Waiting for selector: ${selector}`);
    await page.waitForSelector(selector, { timeout: 10000 });
    console.log('[scrape] Selector found.');

    console.log('[scrape] Extracting outerHTML...');
    const html = await page.$eval(selector, el => el.outerHTML);
    console.log('[scrape] Extraction complete.');

    // Optionally save for debugging
    /*
    console.log('[scrape] Saving extracted HTML to last_scrape.html for debugging...');
    await fs.writeFile('last_scrape.html', html);
    */

    // Respond with raw HTML instead of JSON
    res.type('html').send(html);
  } catch (err) {
    console.error('[scrape] Error during scrape:', err);
    res.status(500).send(err.toString());
  } finally {
    try {
      if (page) {
        console.log('[scrape] Closing page...');
        await page.close();
        console.log('[scrape] Page closed.');
      }
    } catch (e) {
      console.error('[scrape] Error closing page:', e);
    }
  }
});

app.listen(5555, async () => {
  console.log('[server] Starting server at http://localhost:5555');
  try {
    await initBrowser();
  } catch (error) {
    console.error('[server] Browser failed to initialize on startup:', error);
    process.exit(1);
  }
});

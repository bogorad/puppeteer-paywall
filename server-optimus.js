require("dotenv").config();
const express = require("express");
const puppeteer = require("puppeteer-core");
const fs = require("fs");
const os = require("os");
const path = require("path");

const app = express();
app.use(express.json());

// ========================================================================
// Global Error Handlers
// ========================================================================
process.on("uncaughtException", (error) => {
  console.error("[FATAL] Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error(
    "[FATAL] Unhandled Rejection at:",
    promise,
    "Reason:",
    reason,
  );
  process.exit(1);
});

// ========================================================================
// Health Check Endpoint
// ========================================================================
app.get("/health", (req, res) => {
  res.json({ status: "alive", timestamp: Date.now() });
});

// ========================================================================
// Helper Function: Find and Duplicate Tab via Tab-Duplicator Extension
// ========================================================================
async function duplicateTabViaExtension(browser, logDebug) {
  try {
    logDebug(
      "[DUPLICATE] Looking for tab-duplicator extension...",
    );

    const targets = await browser.targets();
    logDebug(
      `[DUPLICATE] Total targets: ${targets.length}`,
    );

    // Get all service workers
    const serviceWorkers = targets.filter(
      (t) =>
        t.type() === "service_worker" &&
        t.url().includes("chrome-extension://"),
    );

    logDebug(
      `[DUPLICATE] Found ${serviceWorkers.length} extension service workers`,
    );

    // Find the tab-duplicator by sending identity check to each
    let tabDuplicatorWorker = null;

    for (const worker of serviceWorkers) {
      try {
        logDebug(
          `[DUPLICATE] Checking identity of ${worker.url()}...`,
        );
        const workerContext = await worker.worker();

        const identity = await Promise.race([
          workerContext.evaluate(() => {
            return new Promise((resolve) => {
              chrome.runtime.sendMessage(
                { action: "identify" },
                (response) => {
                  console.log(
                    "[WORKER] Identity response:",
                    response,
                  );
                  resolve(response);
                },
              );
            });
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("timeout")),
              1000,
            ),
          ),
        ]).catch((e) => {
          logDebug(`[DUPLICATE]   → Error: ${e.message}`);
          return null;
        });

        logDebug(
          `[DUPLICATE]   → identity=${identity?.identity || "unknown"}`,
        );

        if (
          identity &&
          identity.identity === "tab-duplicator"
        ) {
          logDebug(
            `[DUPLICATE] ✓ FOUND tab-duplicator at: ${worker.url()}`,
          );
          tabDuplicatorWorker = worker;
          break;
        }
      } catch (e) {
        logDebug(
          `[DUPLICATE] Worker evaluation error: ${e.message}`,
        );
        continue;
      }
    }

    if (!tabDuplicatorWorker) {
      throw new Error(
        `Tab-duplicator extension not found among ${serviceWorkers.length} service workers. ` +
          `Checked: ${serviceWorkers.map((w) => w.url()).join(", ")}`,
      );
    }

    logDebug("[DUPLICATE] Sending duplicateTab command...");
    const workerContext =
      await tabDuplicatorWorker.worker();

    const result = await workerContext.evaluate(() => {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          { action: "duplicateTab" },
          (response) => {
            console.log(
              "[WORKER] Duplicate response:",
              response,
            );
            if (chrome.runtime.lastError) {
              console.error(
                "[WORKER] Error:",
                chrome.runtime.lastError,
              );
              reject(
                new Error(chrome.runtime.lastError.message),
              );
            } else if (response && response.success) {
              resolve(response);
            } else if (!response) {
              reject(
                new Error("No response from extension"),
              );
            } else {
              reject(
                new Error(
                  response.error || "Unknown error",
                ),
              );
            }
          },
        );
      });
    });

    logDebug(
      `[DUPLICATE] ✓ Tab successfully duplicated. New tab ID: ${result.newTabId}`,
    );
    return result;
  } catch (error) {
    logDebug(`[DUPLICATE] Failed: ${error.message}`);
    throw error;
  }
}

// ========================================================================
// Scraping Endpoint (`/scrape`)
// ========================================================================
app.post("/scrape", async (req, res) => {
  const {
    url,
    selector,
    method = "css",
    debug = false,
  } = req.body;

  const logDebug = (...args) => {
    if (debug) {
      console.log(...args);
    }
  };

  logDebug(
    "[DEBUG] Raw req.body received:",
    JSON.stringify(req.body, null, 2),
  );
  logDebug(
    `[REQUEST] Processing scrape request: url=${url}, selector="${selector}", method=${method}, debug=${debug}`,
  );

  if (!url || !selector) {
    if (debug) {
      console.warn(
        "[REQUEST] Bad Request: Missing url or selector.",
      );
    }
    return res.status(400).json({
      error: "Missing required fields: url and selector",
    });
  }

  let browser = null;
  let page = null;
  let userDataDir = null;

  try {
    // --- 3. Prepare Browser Launch Options ---
    let extensionArgs = [];
    if (process.env.EXTENSION_PATHS) {
      logDebug(
        `[LAUNCH] Preparing extensions from: ${process.env.EXTENSION_PATHS}`,
      );

      // Split by COMMA (not colon), then filter empty strings
      const extensionPaths =
        process.env.EXTENSION_PATHS.split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0);

      logDebug(
        `[LAUNCH] Parsed ${extensionPaths.length} extension paths:`,
      );
      extensionPaths.forEach((p) => logDebug(`  - ${p}`));

      const disableExcept = extensionPaths.join(",");
      const loadExt = extensionPaths.join(",");

      extensionArgs = [
        // Proxy disabled temporarily for debugging
        // `--proxy-server=socks5://r5s.bruc:1080`,
        `--disable-extensions-except=${disableExcept}`,
        `--load-extension=${loadExt}`,
      ];
    }

    userDataDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "puppeteer-user-data-"),
    );
    logDebug(
      `[LAUNCH] Created temporary user data dir: ${userDataDir}`,
    );

    const launchArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--use-gl=swiftshader",
      "--window-size=1280,720",
      "--font-render-hinting=none",
      "--enable-extensions",
      "--enable-extension-assets",
      "--disable-background-networking",
      "--disable-default-apps",
      "--disable-sync",
      "--disable-translate",
      "--disable-notifications",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-web-security", // May help with extension loading
      ...extensionArgs,
    ];

    logDebug("[LAUNCH] Initializing browser instance...");

    // Debug: Check DISPLAY environment variable
    logDebug(
      `[LAUNCH] DISPLAY environment variable: ${process.env.DISPLAY || "NOT SET"}`,
    );

    // Debug: Check current process resource limits
    if (debug) {
      try {
        const { execSync } = require("child_process");
        const limits = execSync(
          `cat /proc/${process.pid}/limits | grep "open files"`,
        ).toString();
        logDebug(
          `[LAUNCH] Current process limits: ${limits.trim()}`,
        );
      } catch (e) {
        logDebug(
          `[LAUNCH] Could not read process limits: ${e.message}`,
        );
      }
    }

    browser = await puppeteer.launch({
      executablePath:
        process.env.EXECUTABLE_PATH || "/usr/bin/chromium",
      headless: "new",
      userDataDir,
      args: launchArgs,
      dumpio: true, // Keep logging for now
      timeout: 60000,
      env: process.env,
    });
    logDebug("[LAUNCH] Browser launched successfully.");

    // --- Debug: Check all loaded extension targets ---
    logDebug(
      "[LAUNCH] Checking all loaded extension targets...",
    );
    const allTargets = await browser.targets();
    logDebug(
      `[LAUNCH] Total targets: ${allTargets.length}`,
    );
    allTargets.forEach((t, i) => {
      if (t.url().includes("chrome-extension://")) {
        logDebug(
          `  [${i}] type=${t.type()}, url=${t.url()}`,
        );
      }
    });

    logDebug("[NAVIGATE] Creating new page...");
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    logDebug("[NAVIGATE] Setting User-Agent...");
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
    );

    logDebug(
      "[DELAY] Waiting 3 seconds before navigating...",
    );
    await new Promise((resolve) =>
      setTimeout(resolve, 3000),
    );

    logDebug(`[NAVIGATE] Loading URL: ${url}`);
    await page.goto(url, {
      waitUntil: "networkidle2",
      timeout: 45000,
    });
    logDebug(`[NAVIGATE] Page loaded successfully: ${url}`);

    // --- NEW: Check if URL matches wsj.com and duplicate tab ---
    if (url.includes("wsj.com/")) {
      logDebug(
        "[URL_MATCH] URL matches wsj.com/, attempting to duplicate tab...",
      );
      try {
        await duplicateTabViaExtension(browser, logDebug);
        logDebug("[URL_MATCH] Tab duplication completed.");
      } catch (dupError) {
        logDebug(
          `[URL_MATCH] Tab duplication error (non-fatal): ${dupError.message}`,
        );
        // Continue scraping even if duplication fails
      }
    }

    logDebug(`[NAVIGATE END] move and scroll.`);
    await page.mouse.move(100, 100);
    await page.evaluate(() => window.scrollBy(0, 200));

    const postNavDelay = method === "xpath" ? 5000 : 2000;
    logDebug(
      `[DELAY] Waiting ${postNavDelay / 1000} seconds after navigation before extraction...`,
    );
    await new Promise((resolve) =>
      setTimeout(resolve, postNavDelay),
    );

    // --- 6. Extract Data (Conditional Logic: XPath vs CSS) ---
    let extractedData;

    if (method === "xpath") {
      logDebug(
        `[XPATH] Evaluating XPath selector: ${selector}`,
      );
      extractedData = await page.evaluate(
        (xpathSelector) => {
          try {
            const result = document.evaluate(
              xpathSelector,
              document,
              null,
              XPathResult.ANY_TYPE,
              null,
            );
            const results = [];
            const processNode = (node) => {
              if (!node) return null;
              switch (node.nodeType) {
                case Node.ELEMENT_NODE:
                  return node.outerHTML;
                case Node.ATTRIBUTE_NODE:
                case Node.TEXT_NODE:
                  return node.nodeValue;
                case Node.COMMENT_NODE:
                  return `<!-- ${node.nodeValue} -->`;
                default:
                  return `Unsupported node type: ${node.nodeType}`;
              }
            };
            switch (result.resultType) {
              case XPathResult.NUMBER_TYPE:
                return [result.numberValue];
              case XPathResult.STRING_TYPE:
                return [result.stringValue];
              case XPathResult.BOOLEAN_TYPE:
                return [result.booleanValue];
              case XPathResult.UNORDERED_NODE_ITERATOR_TYPE:
              case XPathResult.ORDERED_NODE_ITERATOR_TYPE: {
                let node;
                while ((node = result.iterateNext())) {
                  results.push(processNode(node));
                }
                return results;
              }
              case XPathResult.UNORDERED_NODE_SNAPSHOT_TYPE:
              case XPathResult.ORDERED_NODE_SNAPSHOT_TYPE: {
                for (
                  let i = 0;
                  i < result.snapshotLength;
                  i++
                ) {
                  results.push(
                    processNode(result.snapshotItem(i)),
                  );
                }
                return results;
              }
              case XPathResult.ANY_UNORDERED_NODE_TYPE:
              case XPathResult.FIRST_ORDERED_NODE_TYPE:
                return [
                  processNode(result.singleNodeValue),
                ];
              default:
                return [
                  `Unknown XPathResult type: ${result.resultType}`,
                ];
            }
          } catch (error) {
            throw new Error(
              `XPath evaluation failed in browser: ${error.message}`,
            );
          }
        },
        selector,
      );
      logDebug(`[XPATH] Evaluation successful.`);
      logDebug(
        `[XPATH][DEBUG] Extracted Data:`,
        JSON.stringify(extractedData, null, 2),
      );
    } else {
      logDebug(
        `[CSS] Waiting for CSS selector: ${selector}`,
      );
      const elementHandle = await page.waitForSelector(
        selector,
        { timeout: 15000 },
      );
      if (!elementHandle) {
        throw new Error(
          `CSS selector "${selector}" was found by waitForSelector, but handle is unexpectedly null.`,
        );
      }
      logDebug(
        `[CSS] Extracting outerHTML for selector: ${selector}`,
      );
      extractedData = await elementHandle.evaluate(
        (el) => el.outerHTML,
      );

      await elementHandle.dispose();
      logDebug(`[CSS] Extraction successful.`);

      res.type("text/html").send(extractedData);
      return;
    }

    logDebug(
      "[RESPONSE] Sending extracted data to client.",
    );
    res.json(extractedData);
  } catch (error) {
    console.error(
      "[ERROR] Scraping failed:",
      error.message,
    );
    if (debug || process.env.NODE_ENV === "development") {
      console.error("[ERROR] Full Error Details:", error);
    }

    let statusCode = 500;
    if (
      error.name === "TimeoutError" ||
      error.message.includes("timeout") ||
      error.message.includes("exceeded")
    ) {
      statusCode = 504;
    } else if (
      error.message.includes("selector") &&
      (error.message.includes("not found") ||
        error.message.includes("failed to find element"))
    ) {
      statusCode = 404;
    } else if (
      error.message.includes("Navigation failed") ||
      error.message.includes("net::ERR_")
    ) {
      statusCode = 502;
    } else if (
      error.message.includes("XPath evaluation failed")
    ) {
      statusCode = 400;
    }

    res.status(statusCode).json({
      error: "Scraping failed",
      details: error.message,
      type: error.constructor.name,
      stack:
        debug || process.env.NODE_ENV === "development"
          ? error.stack
          : undefined,
    });
  } finally {
    logDebug("[CLEANUP] Closing resources...");
    if (page) {
      try {
        await page.close();
        logDebug("[CLEANUP] Page closed.");
      } catch (e) {
        if (debug)
          console.error("[CLEANUP] Error closing page:", e);
      }
    }
    if (browser) {
      try {
        await browser.close();
        logDebug("[CLEANUP] Browser closed.");
      } catch (e) {
        if (debug)
          console.error(
            "[CLEANUP] Error closing browser:",
            e,
          );
      }
    }
    if (userDataDir) {
      logDebug(
        `[CLEANUP] Removing user data dir: ${userDataDir}`,
      );
      try {
        if (fs.promises && fs.promises.rm) {
          await fs.promises.rm(userDataDir, {
            recursive: true,
            force: true,
          });
        } else {
          fs.rmdirSync(userDataDir, { recursive: true });
        }
        logDebug("[CLEANUP] User data dir removed.");
      } catch (err) {
        if (debug)
          console.error(
            "[CLEANUP] Failed to remove user data dir:",
            userDataDir,
            err,
          );
      }
    }
    logDebug("[CLEANUP] Cleanup finished.");
  }
});

// ========================================================================
// Server Initialization
// ========================================================================
const PORT = process.env.PORT || 5555;
app.listen(PORT, () => {
  console.log(
    `[SERVER] Service started. Running on port ${PORT}`,
  );
  const execPath =
    process.env.EXECUTABLE_PATH || "/usr/bin/chromium";
  console.log(
    `[CHROMIUM] Using executable path: ${execPath}`,
  );
  if (!fs.existsSync(execPath)) {
    console.warn(
      `[WARNING] Chromium executable not found at specified path: ${execPath}`,
    );
  }
  if (process.env.EXTENSION_PATHS) {
    console.log(
      `[CHROMIUM] Attempting to load extensions from: ${process.env.EXTENSION_PATHS}`,
    );
  } else {
    console.log(
      `[CHROMIUM] No extensions configured to load.`,
    );
  }
});

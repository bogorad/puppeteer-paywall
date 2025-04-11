const puppeteer = require('puppeteer-core');

(async () => {
  try {
    const browser = await puppeteer.launch({
      executablePath: '/usr/lib/chromium/chromium',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      dumpio: true
    });
    console.log('Success:', await browser.version());
    await browser.close();
  } catch (e) {
    console.error('FAILURE:', e);
  }
})();


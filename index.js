const chromeLauncher = require('chrome-launcher');
const puppeteer = require('puppeteer');
const lighthouse = require('lighthouse');
const request = require('request');
const util = require('util');
const fs = require('fs');

(async () => {
  const opts = {
    chromeFlags: [
      // '--headless',
      '--enable-automation',
    ],
    logLevel: 'info',
    output: 'json',
  };

  // Launch chrome using chrome-launcher.
  const chrome = await chromeLauncher.launch(opts);
  opts.port = chrome.port;

  // Connect to it using puppeteer.connect().
  const resp = await util.promisify(request)(`http://localhost:${opts.port}/json/version`);
  const { webSocketDebuggerUrl } = JSON.parse(resp.body);
  const browser = await puppeteer.connect({ browserWSEndpoint: webSocketDebuggerUrl });

  const pages = await browser.pages();
  const page = pages[0];

  browser.on('targetchanged', async target => {
    const targetPage = await target.page();
    const client = await targetPage.target().createCDPSession();
    await client.send('Runtime.evaluate', {
      expression: `Date.now = function() { return 0; }`
    });
  });

  // Login
  await page.goto('https://manager.preprod.thefork.com');
  await page.waitForSelector('[data-test="login-username"]');
  await page.type('[data-test="login-username"]', 'desantis.silvana@lafourchette.com');
  await page.type('[data-test="login-password"]', '***');
  await page.click('[data-test="submit-login-form"]');
  await page.waitForSelector('[data-test="reservation-list"]');

  // Until https://github.com/GoogleChrome/lighthouse/issues/2599#issuecomment-312005577 we can't
  // avoid clearing the localstorage and the cache simultaneously which makes the result of lighthouse
  // worst so we login using the jwt in the URL.
  const tfmFrontData = await page.evaluate(() => {
    return localStorage.getItem('tfm-front:persist');
  });

  const data = JSON.parse(JSON.parse(tfmFrontData));
  const jwt = data['token'];

  // Run Lighthouse.
  const lhr = await lighthouse(`https://manager.preprod.thefork.com/en_US/booking?jwt=${jwt}`, opts, null);

  fs.writeFileSync('report.json', JSON.stringify(lhr, null, 2));

  await browser.disconnect();
  await chrome.kill();
})();

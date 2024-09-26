import { chromium } from 'playwright';
import retry from 'async-retry';
import { log } from 'console';
import fs from 'node:fs';

async function scrapeMemberInfo() {
  let browser;
  console.log('Attempting to connect to Chrome...');
  try {
    browser = await chromium.connectOverCDP('http://localhost:9222', {
      slowMo: 50 // Slows down Playwright operations by 50ms
    });
    console.log('Successfully connected to Chrome');

    const defaultContext = browser.contexts()[0];
    const page = defaultContext.pages()[0];

    await retry(async () => {
      // Go to the URL
      console.log('here');
      let url = "https://unshackled.circle.so/rails/active_storage/representations/redirect/eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaHBCTkF2YXdJPSIsImV4cCI6bnVsbCwicHVyIjoiYmxvYl9pZCJ9fQ==--22adbd07e83cf03b31fba5b92a8bb65c1bda16ae/eyJfcmFpbHMiOnsibWVzc2FnZSI6IkJBaDdDRG9MWm05eWJXRjBTU0lKYW5CbFp3WTZCa1ZVT2hSeVpYTnBlbVZmZEc5ZmJHbHRhWFJiQjJrQ0xBRnBBaXdCT2dwellYWmxjbnNHT2dwemRISnBjRlE9IiwiZXhwIjpudWxsLCJwdXIiOiJ2YXJpYXRpb24ifX0=--ef295ed08e817a599d692fd6d8761673d3ed547f/5CFD91BB-AEBF-49DB-8417-0CEE32D9395F.jpeg"
      await page.goto(url, { waitUntil: 'networkidle' });

      console.log('Waiting for image to load...');
      await page.waitForSelector('img', { timeout: 7000 }).catch(e => console.log('Image selector timeout:', e.message));

      // Get the image URL
      const imageUrl = await page.evaluate(() => {
        console.log('Evaluating image URL...');
        const img = document.querySelector('img');
        if (!img) {
          console.log('No image found on the page');
          return null;
        }
        console.log('Image found, src:', img.src);
        return img.src;
      });

      if (!imageUrl) {
        throw new Error('Failed to get image URL');
      }
      console.log('Downloading image:', url);

      // Download the image
      const response = await page.evaluate(async (url) => {
        const res = await fetch(url);
        const arrayBuffer = await res.arrayBuffer();
        return Array.from(new Uint8Array(arrayBuffer));
      }, imageUrl);

      // Convert array to buffer
      const buffer = Buffer.from(response);

      fs.writeFileSync('Manoj_Suryadevara_profile.jpg', buffer);

      console.log('Image downloaded: Manoj_Suryadevara_profile.jpg');
    }, {
      retries: 2,
      onRetry: (error) => {
        console.log('Retrying due to error:', error);
      }
    });
  } catch (error) {
    console.error('An error occurred:', error);
    if (error.message.includes('Timeout')) {
      console.log('Timeout error. Make sure Chrome is running with remote debugging enabled on port 9222.');
    }
  } finally {
    if (browser) {
      await browser.close();
    }
    console.log('Scraping completed');
  }
}

// Run the scraping function
scrapeMemberInfo().catch(console.error);

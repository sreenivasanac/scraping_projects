import { chromium } from 'playwright';
import retry from 'async-retry';
import { log } from 'console';
import fs from 'node:fs';

async function downloadImage(page, url, filename) {
  const newPage = await page.context().newPage();
  await newPage.goto(url, { waitUntil: 'networkidle' });
  console.log('Waiting for image to load...');
  await newPage.waitForSelector('img', { timeout: 7000 }).catch(e => console.log('Image selector timeout:', e.message));

  const imageUrl = await newPage.evaluate(() => {
    const img = document.querySelector('img');
    return img ? img.src : null;
  });

  if (!imageUrl) {
    throw new Error('Failed to get image URL');
  }

  console.log('Downloading image:', url);
  try {
    const response = await newPage.evaluate(async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      return Array.from(new Uint8Array(arrayBuffer));
    }, imageUrl);

    const buffer = Buffer.from(response);
    fs.writeFileSync(filename, buffer);
    console.log(`Image downloaded: ${filename}`);
  } catch (error) {
    console.error('Error downloading image:', error.message);
  } finally {
    await newPage.close();
  }
}

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
      await page.goto('https://unshackled.circle.so/members', { waitUntil: 'networkidle' });
      console.log('Navigated to members page');

      // Wait for the initial member list to load
      await page.waitForSelector('ul[data-testid="directory_members_list"]');

      // Scroll to the bottom till all the members are loaded
      let members = await page.$$('li[data-testid="community_member"]');;
      let scrollAttempts = 0;
      const maxScrollAttempts = 60;
      while (members.length <= 430 && scrollAttempts < maxScrollAttempts) {
        members = await page.$$('li[data-testid="community_member"]');
        const element = members[members.length - 1];
        if (element) {
          await page.evaluate((el) => {
            el.scrollIntoView();
          }, element);
        }

        await page.waitForTimeout(2000); // Wait for potential content to load

        members = await page.$$('li[data-testid="community_member"]');
        console.log('Current members found:', members.length);
        scrollAttempts++;
      }

      members = await page.$$('li[data-testid="community_member"]');
      console.log('Total members found:', members.length);
      console.log('Reached the bottom of the page');

      // Now get all member elements
      members = await page.$$('li[data-testid="community_member"]');
      console.log('Total members found:', members.length);

      for (const member of members) {
        try {
          // Click on the section element to open the side panel
          await member.$eval('section.flex.min-w-0.flex-1.flex-col.gap-y-3', section => section.click());
          
          // Wait for the side panel to load
          await page.waitForSelector('div.drawer-content-wrapper', { state: 'visible', timeout: 10000 });
          await page.waitForSelector('.profile-drawer__header__name', { state: 'visible', timeout: 10000 });

          // Extract additional information from the side panel
          const memberInfo = await page.evaluate(() => {
            const panel = document.querySelector('div.drawer-content-wrapper');
            // Check if "See more" button exists and is visible
            const seeMoreButton = panel.querySelector('button[data-testid="show-expand"]');
            if (seeMoreButton && window.getComputedStyle(seeMoreButton).display !== 'none') {
              console.log('Clicking "See more" button');
              seeMoreButton.click();
            }
            
            const name = document.querySelector('.profile-drawer__header__name')?.textContent.trim() || '';
            const headline = document.querySelector('.profile-drawer__header__headline')?.textContent.trim() || '';
            const bio = document.querySelector('.line-clamp-none[data-testid="see-more-less-content"]')?.textContent.trim() || '';

            const locationElement = panel.querySelector('div[data-testid="user-profile-field"] span.text-sm.font-normal');
            const location = locationElement ? locationElement.textContent.trim() : '';

            const linkedinElement = panel.querySelector('div.text-dark.flex.items-center.gap-3.whitespace-pre-line.break-words a[href^="https://www.linkedin.com/"]');
            const linkedinUrl = linkedinElement ? linkedinElement.href : '';

            const instagramElement = panel.querySelector('div.text-dark.flex.items-center.gap-3.whitespace-pre-line.break-words a[href^="https://www.instagram.com/"]');
            const instagramUrl = instagramElement ? instagramElement.href : '';

            const websiteElement = panel.querySelector('div[data-testid="user-profile-field"] a[href^="http"]');
            const websiteUrl = websiteElement ? websiteElement.href : '';

            const imageElement = panel.querySelector('img[data-testid="user-image-element"]');
            const imageUrl = imageElement ? imageElement.src : '';
            const imageName = imageUrl ? `${name.replace(/\s+/g, '_')}_profile.jpg` : '';
            console.log('Image URL:', imageUrl);
            console.log('Image Name:', imageName);
            return { name, headline, bio, location, linkedinUrl, websiteUrl, instagramUrl, imageUrl, imageName };
          });

          if (memberInfo.imageUrl) {
            await downloadImage(page, memberInfo.imageUrl, memberInfo.imageName);
          }

          // Log member information
          console.log('Name:', memberInfo.name);
          console.log('Headline:', memberInfo.headline);
          console.log('Bio:', memberInfo.bio);
          console.log('Location:', memberInfo.location);
          console.log('LinkedIn URL:', memberInfo.linkedinUrl);
          console.log('Website URL:', memberInfo.websiteUrl);
          console.log('Instagram URL:', memberInfo.instagramUrl);
          console.log('Image URL:', memberInfo.imageUrl);
          console.log('Image Name:', memberInfo.imageName);
          console.log('---');
          // Close the side panel
          await page.click('button[data-testid="drawer-close-button"]');
          
          // Wait for the panel to close
          await page.waitForSelector('div.drawer-content-wrapper', { state: 'hidden', timeout: 10000 });
          // Wait a bit before processing the next member
          await page.waitForTimeout(500);
        } catch (memberError) {
          console.error('Error processing member:', memberError);
          // Continue with the next member
        }
      }
    }, {
      retries: 3,
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

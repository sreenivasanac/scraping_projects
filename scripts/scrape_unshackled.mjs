import { chromium } from 'playwright';
import retry from 'async-retry';
import { log } from 'console';
import fs from 'node:fs';
import path from 'path';

async function connectToBrowser() {
  console.log('Attempting to connect to Chrome...');
  const browser = await chromium.connectOverCDP('http://localhost:9222', { slowMo: 50 });
  console.log('Successfully connected to Chrome');
  return browser;
}

async function scrollToLoadAllMembers(page) {
  let members = await page.$$('li[data-testid="community_member"]');
  let scrollAttempts = 0;
  const maxScrollAttempts = 60;

  while (members.length <= 430 && scrollAttempts < maxScrollAttempts) {
    members = await page.$$('li[data-testid="community_member"]');
    const element = members[members.length - 1];
    if (element) {
      await page.evaluate((el) => el.scrollIntoView(), element);
    }
    await page.waitForTimeout(2000);
    members = await page.$$('li[data-testid="community_member"]');
    console.log('Current members found:', members.length);
    scrollAttempts++;
  }

  console.log('Total members found:', members.length);
  console.log('Reached the bottom of the page');
  return members;
}

async function extractMemberInfo(page) {
  return page.evaluate(() => {
    const panel = document.querySelector('div.drawer-content-wrapper');
    const seeMoreButton = panel.querySelector('button[data-testid="show-expand"]');
    if (seeMoreButton && window.getComputedStyle(seeMoreButton).display !== 'none') {
      console.log('Clicking "See more" button');
      seeMoreButton.click();
    }
    const memberInfo = {
      name: document.querySelector('.profile-drawer__header__name')?.textContent.trim() || '',
      headline: document.querySelector('.profile-drawer__header__headline')?.textContent.trim() || '',
      bio: document.querySelector('.line-clamp-none[data-testid="see-more-less-content"]')?.textContent.trim() || '',
      location: panel.querySelector('div[data-testid="user-profile-field"] span.text-sm.font-normal')?.textContent.trim() || '',
      linkedinUrl: panel.querySelector('div.text-dark.flex.items-center.gap-3.whitespace-pre-line.break-words a[href^="https://www.linkedin.com/"]')?.href || '',
      instagramUrl: panel.querySelector('div.text-dark.flex.items-center.gap-3.whitespace-pre-line.break-words a[href^="https://www.instagram.com/"]')?.href || '',
      websiteUrl: panel.querySelector('div[data-testid="user-profile-field"] a[href^="http"]')?.href || '',
      imageUrl: panel.querySelector('img[data-testid="user-image-element"]')?.src || '',
    };
    
    memberInfo.imageName = memberInfo.imageUrl ? `${memberInfo.name.replace(/\s+/g, '_')}_profile.jpg` : '';
    
    return memberInfo;
  });
}

function logMemberInfo(memberInfo) {
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
}

async function downloadImage(page, imageUrl, imageName) {
  try {
    const imageBuffer = await page.evaluate(async (url) => {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }, imageUrl);

    const downloadPath = path.join(process.cwd(), 'downloads');
    if (!fs.existsSync(downloadPath)) {
      fs.mkdirSync(downloadPath, { recursive: true });
    }

    const filePath = path.join(downloadPath, imageName);
    fs.writeFileSync(filePath, imageBuffer);
    console.log(`Image downloaded: ${imageName}`);
  } catch (error) {
    console.error(`Error downloading image ${imageName}:`, error);
  }
}

async function processMember(page, member) {
  try {
    await member.$eval('section.flex.min-w-0.flex-1.flex-col.gap-y-3', section => section.click());
    await page.waitForSelector('div.drawer-content-wrapper', { state: 'visible', timeout: 10000 });
    await page.waitForSelector('.profile-drawer__header__name', { state: 'visible', timeout: 10000 });

    const memberInfo = await extractMemberInfo(page);

    if (memberInfo.imageUrl) {
      await downloadImage(page, memberInfo.imageUrl, memberInfo.imageName);
    }

    logMemberInfo(memberInfo);

    await page.click('button[data-testid="drawer-close-button"]');
    await page.waitForSelector('div.drawer-content-wrapper', { state: 'hidden', timeout: 10000 });
    await page.waitForTimeout(500);
  } catch (memberError) {
    console.error('Error processing member:', memberError);
  }
}

async function scrapeMemberInfo() {
  let browser;
  try {
    browser = await connectToBrowser();
    const defaultContext = browser.contexts()[0];
    const page = defaultContext.pages()[0];

    await retry(async () => {
      await page.goto('https://unshackled.circle.so/members', { waitUntil: 'networkidle' });
      console.log('Navigated to members page');
      await page.waitForSelector('ul[data-testid="directory_members_list"]');

      const members = await scrollToLoadAllMembers(page);

      for (const member of members) {
        await processMember(page, member);
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

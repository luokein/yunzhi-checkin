// 诊断脚本：逐步打印页面状态，定位"登录态明明有效却跳转登录页"的原因
const fs = require('node:fs');
const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    storageState: 'auth.json',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const page = await context.newPage();
  page.on('console', (m) => console.log('[console]', m.text().slice(0, 120)));
  page.on('response', async (r) => {
    if (/login|token|user|welfare|benefit|sign|check/i.test(r.url())) {
      console.log('[resp]', r.status(), r.url().slice(0, 110));
    }
  });

  await page.goto('https://yunzhi.play.cn/ai/?channel_code=00000042', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });
  await page.waitForTimeout(3000);

  const text1 = await page.evaluate(() => document.body.innerText);
  console.log('=== 首页文本(前300字) ===');
  console.log(text1.slice(0, 300).replace(/\n+/g, ' | '));
  await page.screenshot({ path: 'artifacts/debug-1-home.png', fullPage: true });

  // localStorage 里的 token 是否被页面读到
  const ls = await page.evaluate(() => ({
    cloud_phone_token: (localStorage.getItem('cloud_phone_token') || '').slice(0, 20) + '...',
    user_info: (localStorage.getItem('cloud_phone_user_info') || '').slice(0, 60),
  }));
  console.log('localStorage:', JSON.stringify(ls));

  // 点权益到账浮条
  const img = page.locator('.guide-banner-img').first();
  if (await img.isVisible({ timeout: 2000 }).catch(() => false)) {
    await img.click();
    await page.waitForTimeout(3000);
    const text2 = await page.evaluate(() => document.body.innerText);
    console.log('=== 点浮条后文本(前300字) ===');
    console.log(text2.slice(0, 300).replace(/\n+/g, ' | '));
    console.log('URL:', page.url());
    await page.screenshot({ path: 'artifacts/debug-2-after-banner.png', fullPage: true });
  } else {
    console.log('没有找到 .guide-banner-img');
  }
  await browser.close();
})();

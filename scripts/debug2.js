// 诊断2：抓 401 的具体请求 + 福利接口返回内容
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

  page.on('response', async (r) => {
    const u = r.url();
    if (!/new-gm\.cn|api/i.test(u)) return;
    let body = '';
    try {
      body = (await r.text()).slice(0, 200);
    } catch (_) {}
    console.log(`[api] ${r.status()} ${u.slice(0, 90)}`);
    if (body) console.log(`      body: ${body.replace(/\s+/g, ' ')}`);
    if (r.status() === 401) {
      const req = r.request();
      const h = req.headers();
      console.log('      请求头 token 相关:', JSON.stringify({
        authorization: (h.authorization || '').slice(0, 30),
        token: (h.token || '').slice(0, 30),
        cookie: (h.cookie || '').slice(0, 60),
      }));
    }
  });

  await page.goto('https://yunzhi.play.cn/ai/?channel_code=00000042', {
    waitUntil: 'networkidle',
    timeout: 60000,
  });
  await page.waitForTimeout(4000);
  await browser.close();
})();

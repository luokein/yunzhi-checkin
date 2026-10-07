// 云智手机 每日打卡 / 开心领取奖励 脚本
// 依赖: playwright (npm i -D playwright && npx playwright install chromium)
// 登录态: 环境变量 YUNZHI_AUTH_JSON (playwright storageState 的 JSON 字符串)
//         通过 scripts/export-login.mjs 在本地登录一次后生成

const fs = require('node:fs');
const path = require('node:path');

const TARGET_URL =
  process.env.YUNZHI_URL || 'https://yunzhi.play.cn/ai/?channel_code=00000042';

// 打卡入口 / 领奖按钮的候选文案（按优先级匹配）
const ENTRY_PATTERNS = [
  /权益到账/,
  /签到/,
  /打卡/,
  /领.*奖励/,
  /每日.*任务/,
  /福利/,
];
const CLAIM_PATTERNS = [
  /开心收下/,
  /开心领取/,
  /领取奖励/,
  /立即领取/,
  /点击领取/,
  /领\s*取/,
  /签\s*到/,
  /打\s*卡/,
];
// 出现这些文案说明今天已经完成，算成功
const DONE_PATTERNS = [
  /已领取/,
  /领取成功/,
  /已签到/,
  /已打卡/,
  /明日再来/,
  /明天再来/,
  /已完成/,
];
// 出现这些说明登录态失效，必须失败退出以便收到通知
const LOGIN_PATTERNS = [/免密登录/, /验证码登录/, /账号密码登录/];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, patterns, { timeout = 1500 } = {}) {
  for (const re of patterns) {
    const loc = page
      .locator(`text=${re.source}`)
      .first();
    try {
      if (await loc.isVisible({ timeout })) {
        await loc.click({ timeout: 3000 });
        console.log(`[click] 命中文案: ${re.source}`);
        return true;
      }
    } catch (_) {
      /* 继续尝试下一个 */
    }
    // 再用正则 locator 试一次（更宽松）
    try {
      const loc2 = page.getByText(re, { exact: false }).first();
      if (await loc2.isVisible({ timeout })) {
        await loc2.click({ timeout: 3000 });
        console.log(`[click] 命中文案(正则): ${re.source}`);
        return true;
      }
    } catch (_) {
      /* ignore */
    }
  }
  return false;
}

async function pageText(page) {
  try {
    return await page.evaluate(() => document.body?.innerText || '');
  } catch (_) {
    return '';
  }
}

async function closePopups(page) {
  // 关掉常见的弹窗关闭按钮
  const closers = ['button:has-text("×")', '.close', '.close-btn', '[class*=close]'];
  for (const sel of closers) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 800 })) {
        await el.click({ timeout: 1500 });
        console.log(`[popup] 关闭弹窗: ${sel}`);
        await sleep(500);
      }
    } catch (_) {
      /* ignore */
    }
  }
}

async function main() {
  const { chromium, devices } = require('playwright');

  const authJson = process.env.YUNZHI_AUTH_JSON;
  if (!authJson) {
    console.error('缺少环境变量 YUNZHI_AUTH_JSON（登录态）。请先运行 scripts/export-login.mjs');
    process.exit(2);
  }

  const authFile = path.join(process.cwd(), '.auth-tmp.json');
  fs.writeFileSync(authFile, authJson, 'utf8');

  const outDir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      ...devices['iPhone 13'],
      storageState: authFile,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    const page = await context.newPage();

    console.log(`[open] ${TARGET_URL}`);
    await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60_000 });
    await sleep(2000);

    // 0. 登录态检查
    let text = await pageText(page);
    if (LOGIN_PATTERNS.some((re) => re.test(text))) {
      console.error('[fail] 登录态已失效，页面出现登录按钮。请重新运行 export-login.mjs 更新 YUNZHI_AUTH_JSON');
      await page.screenshot({ path: path.join(outDir, 'login-expired.png'), fullPage: true });
      process.exitCode = 1;
      return;
    }

    // 1. 点打卡/领奖入口（浮动条、卡片等），可能要点多次
    await closePopups(page);
    for (let round = 0; round < 4; round++) {
      const clicked =
        (await clickByText(page, ENTRY_PATTERNS)) ||
        (await (async () => {
          // 兜底：点页面里的引导图（.guide-banner-img 就是"就差这关 权益到账"浮条）
          try {
            const img = page.locator('.guide-banner-img').first();
            if (await img.isVisible({ timeout: 1000 })) {
              await img.click({ timeout: 2000 });
              console.log('[click] 命中入口图 .guide-banner-img');
              return true;
            }
          } catch (_) {
            /* ignore */
          }
          return false;
        })());
      if (!clicked) break;
      await sleep(2500);
      await closePopups(page);

      text = await pageText(page);
      if (DONE_PATTERNS.some((re) => re.test(text))) {
        console.log(`[done] 检测到完成态: ${DONE_PATTERNS.find((re) => re.test(text))}`);
        break;
      }
    }

    // 2. 点"开心领取奖励"一类的按钮，多轮尝试
    for (let round = 0; round < 5; round++) {
      const ok = await clickByText(page, CLAIM_PATTERNS);
      if (!ok) break;
      await sleep(2000);
      await closePopups(page);
      const t = await pageText(page);
      if (DONE_PATTERNS.some((re) => re.test(t))) {
        console.log('[done] 奖励已到账');
        break;
      }
    }

    // 3. 结果判定
    text = await pageText(page);
    const shot = path.join(outDir, `checkin-${new Date().toISOString().slice(0, 10)}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    fs.writeFileSync(path.join(outDir, 'page.html'), await page.content(), 'utf8');

    if (DONE_PATTERNS.some((re) => re.test(text))) {
      console.log('[success] 今日打卡/领奖完成 ✅');
      return;
    }
    if (LOGIN_PATTERNS.some((re) => re.test(text))) {
      console.error('[fail] 需要重新登录');
      process.exitCode = 1;
      return;
    }
    console.warn('[warn] 未能确认领取结果，请查看 artifacts 里的截图和 page.html');
    process.exitCode = 1;
  } finally {
    await browser.close();
    try {
      fs.unlinkSync(authFile);
    } catch (_) {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error('[error]', err);
  process.exit(1);
});

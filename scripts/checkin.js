// 云智手机 每日打卡 / 开心领取奖励 脚本
// 依赖: playwright (npm i -D playwright && npx playwright install chromium)
// 登录态: 环境变量 YUNZHI_AUTH_JSON (playwright storageState 的 JSON 字符串)
//         通过 scripts/export-login.mjs 在本地登录一次后生成

const fs = require('node:fs');
const path = require('node:path');

const TARGET_URL =
  process.env.YUNZHI_URL || 'https://yunzhi.play.cn/ai/?channel_code=00000042';

// 领奖按钮（优先匹配按钮元素，避免点到标题文字）
const CLAIM_PATTERNS = [
  /开心收下/, // 每日登录福利弹窗的主按钮
  /开心领取/,
  /领取奖励/,
  /立即领取/,
  /点击领取/,
  /马上领取/,
  /收\s*下/,
  /领\s*取/,
  /签\s*到/,
  /打\s*卡/,
];
// 出现这些文案说明今天已经完成，算成功
const DONE_PATTERNS = [
  /已领取/,
  /已签到/,
  /已打卡/,
  /领取成功/,
  /收下成功/,
  /已到账/,
  /明日再来/,
  /明天再来/,
  /已完成/,
];
// 出现这些说明登录态失效，必须失败退出以便收到通知
const LOGIN_PATTERNS = [/免密登录/, /验证码登录/, /账号密码登录/];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function clickByText(page, patterns, { timeout = 1500 } = {}) {
  for (const re of patterns) {
    // 1) 优先点真正的按钮/可点击元素（仅当文案不含正则转义时可用字符串匹配）
    if (!re.source.includes('\\')) {
      const buttonLike = page
        .locator(
          `button:has-text("${re.source}"), [role="button"]:has-text("${re.source}"), a:has-text("${re.source}")`,
        )
        .first();
      try {
        if (await buttonLike.isVisible({ timeout })) {
          await buttonLike.click({ timeout: 3000 });
          console.log(`[click] 命中按钮: ${re.source}`);
          return true;
        }
      } catch (_) {
        /* 继续 */
      }
    }
    // 2) 退化为任意文本元素（遍历所有匹配，跳过隐藏的）
    try {
      const all = page.getByText(re, { exact: false });
      if (await clickFirstVisible(all, { timeout, label: `文案(正则): ${re.source}` })) {
        return true;
      }
    } catch (_) {
      /* ignore */
    }
  }
  return false;
}

// 遍历 locator 的所有匹配项，点击第一个真实可见的（页面常有多个同名元素，前面的是隐藏模板）
async function clickFirstVisible(locator, { timeout = 1500, label = '' } = {}) {
  const count = await locator.count();
  for (let i = 0; i < Math.min(count, 10); i++) {
    const el = locator.nth(i);
    try {
      if (await el.isVisible({ timeout: Math.min(timeout, 800) })) {
        await el.click({ timeout: 3000 });
        console.log(`[click] 命中${label || '元素'} (第${i + 1}个匹配)`);
        return true;
      }
    } catch (_) {
      /* 试下一个 */
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

    // 1. 轮询领取奖励：
    //    每日奖励 = "今日登录福利"弹窗的【开心收下】按钮（登录后/加载后几秒内出现）。
    //    注意：不要去点"就差这关 权益到账"浮条——实测它会唤起 AI 新手教程对话，
    //    是一次性引导，不是每日奖励，点了会跑偏。
    //    关弹窗放在每轮领奖尝试之后，防止 × 把福利弹窗先关掉。
    let claimed = false;
    let sawWelfareModal = false;
    for (let round = 0; round < 6; round++) {
      text = await pageText(page);

      if (DONE_PATTERNS.some((re) => re.test(text))) {
        console.log(`[done] 检测到完成态: ${DONE_PATTERNS.find((re) => re.test(text))}`);
        break;
      }
      if (/今日登录福利|登录福利|登录礼包/.test(text)) {
        sawWelfareModal = true;
      }

      const clicked = await clickByText(page, CLAIM_PATTERNS);
      if (clicked) {
        claimed = true;
        console.log(`[claim] 第 ${round + 1} 轮点击了领奖按钮`);
        await sleep(2500);
        continue;
      }

      // 没有可点按钮时，关一轮无关弹窗再等等（福利弹窗可能延迟几秒才弹出）
      if (round >= 1) {
        await closePopups(page);
      }
      await sleep(2000);
    }

    // 2. 结果判定
    text = await pageText(page);
    const shot = path.join(outDir, `checkin-${new Date().toISOString().slice(0, 10)}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    fs.writeFileSync(path.join(outDir, 'page.html'), await page.content(), 'utf8');

    if (claimed || DONE_PATTERNS.some((re) => re.test(text))) {
      console.log('[success] 今日打卡/领奖完成 ✅');
      return;
    }
    if (LOGIN_PATTERNS.some((re) => re.test(text))) {
      console.error('[fail] 需要重新登录');
      process.exitCode = 1;
      return;
    }
    if (sawWelfareModal) {
      // 弹窗出现过但没点成，属于异常，失败退出以便收到通知
      console.error('[fail] 检测到福利弹窗但未能点击领取，请查看截图');
      process.exitCode = 1;
      return;
    }
    // 已登录、没有福利弹窗、也没有可领按钮：今天的奖励大概率已领过（或当天无活动）
    console.log('[ok] 今日没有待领取的奖励弹窗（可能已领过），登录状态正常 ✅');
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

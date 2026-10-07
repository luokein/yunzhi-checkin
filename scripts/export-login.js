// 本地登录导出工具 v2：打开浏览器 -> 自动检测登录成功 -> 立即保存登录态
// 用法: node scripts/export-login.js
// 然后把 auth.json 的内容存到 GitHub 仓库 Secret: YUNZHI_AUTH_JSON
//
// 注意：该平台可能是单会话制，导出后请勿在其他设备/浏览器登录同一账号，
//       否则已导出的登录态会被踢下线（服务器返回 401）。

const fs = require('node:fs');
const path = require('node:path');

const TARGET_URL =
  process.env.YUNZHI_URL || 'https://yunzhi.play.cn/ai/?channel_code=00000042';
const MAX_WAIT_MS = Number(process.env.LOGIN_WAIT_MS || 10 * 60 * 1000); // 默认等 10 分钟

async function main() {
  const { chromium, devices } = require('playwright');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'zh-CN' });
  const page = await context.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  console.log('==========================================================');
  console.log('浏览器已打开，请在里面完成登录（免密登录/验证码均可）。');
  console.log('检测到登录成功后会自动保存，无需回到终端按回车。');
  console.log('==========================================================');

  // 轮询检测登录态（token 出现在 localStorage 即视为登录成功）
  const deadline = Date.now() + MAX_WAIT_MS;
  let loggedIn = false;
  while (Date.now() < deadline) {
    try {
      const token = await page.evaluate(() => localStorage.getItem('cloud_phone_token'));
      if (token) {
        loggedIn = true;
        break;
      }
    } catch (_) {
      /* 页面跳转中，继续等 */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }

  if (!loggedIn) {
    console.error('等待超时，未检测到登录。请重新运行本脚本。');
    await browser.close();
    process.exit(1);
  }

  console.log('检测到登录成功，正在保存登录态...');
  await new Promise((r) => setTimeout(r, 3000)); // 等 cookie 全部落盘

  const outFile = path.join(__dirname, '..', 'auth.json');
  await context.storageState({ path: outFile });
  await browser.close();

  console.log(`\n登录态已保存到: ${outFile}`);
  console.log('下一步（二选一）:');
  console.log('  1) 本地验证:  YUNZHI_AUTH_JSON="$(cat auth.json)" npm run checkin');
  console.log('  2) 更新 GitHub Secret [YUNZHI_AUTH_JSON] 为 auth.json 的全部内容');
  console.log('\n提醒: 导出后请勿在其他设备登录同一账号，否则登录态会被踢下线。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

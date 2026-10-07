// 本地登录导出工具：打开有头浏览器 -> 你手动登录 -> 自动保存登录态
// 用法: node scripts/export-login.js
// 然后把输出的 Base64 字符串存到 GitHub 仓库 Secret: YUNZHI_AUTH_JSON

const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const TARGET_URL =
  process.env.YUNZHI_URL || 'https://yunzhi.play.cn/ai/?channel_code=00000042';

async function main() {
  const { chromium, devices } = require('playwright');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ...devices['iPhone 13'], locale: 'zh-CN' });
  const page = await context.newPage();
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  console.log('==========================================================');
  console.log('浏览器已打开，请在浏览器里完成登录（免密登录/验证码均可）。');
  console.log('登录成功并回到主界面后，回到这里按回车继续...');
  console.log('==========================================================');

  await new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('登录完成后按回车: ', () => {
      rl.close();
      resolve();
    });
  });

  const outFile = path.join(__dirname, '..', 'auth.json');
  await context.storageState({ path: outFile });
  await browser.close();

  const b64 = Buffer.from(fs.readFileSync(outFile, 'utf8')).toString('base64');
  console.log(`\n登录态已保存到: ${outFile}`);
  console.log('\n把下面这串 Base64 完整复制，存为 GitHub Secret [YUNZHI_AUTH_JSON]:\n');
  console.log(b64);
  console.log('\n(也可以在 workflow 里直接用文件内容，见 README)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

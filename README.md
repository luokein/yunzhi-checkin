# 云智手机每日打卡（GitHub Actions）

每天定时打开 <https://yunzhi.play.cn/ai/?channel_code=00000042>，自动完成打卡并「开心领取奖励」，全程截图留档。

## 工作原理

- 打卡/领奖功能需要登录（天翼账号免密登录），短信登录无法在 CI 里自动完成。
- 因此采用「本地登录一次 → 导出登录态 → 存 GitHub Secret」的方案，Action 每天复用该登录态执行打卡。
- 登录态一般能维持数周到数月；失效时 Action 会失败退出，你收到 GitHub 邮件通知后重新导出一次即可。

## 目录结构

```
├── .github/workflows/checkin.yml   # 定时任务：每天北京时间 08:17 运行
├── scripts/checkin.js              # 打卡主脚本（Playwright）
├── scripts/export-login.js         # 本地登录态导出工具
└── package.json
```

## 使用步骤

### 1. 本地准备登录态（只需一次）

```bash
npm install
npx playwright install chromium
npm run login
```

脚本会打开一个浏览器窗口，你在里面完成登录（免密登录或验证码登录均可），
回到主界面后回终端按回车。登录态会保存为 `auth.json`，并输出一串 Base64。

### 2. 配置 GitHub Secret

把上一步 `auth.json` 的**文件内容**（JSON 原文，不是 Base64 也可以）完整复制，
到仓库 `Settings → Secrets and variables → Actions` 新建 Secret：

- Name: `YUNZHI_AUTH_JSON`
- Value: `auth.json` 的全部内容

> Windows 下可用 `type auth.json | clip` 复制；macOS/Linux 用 `cat auth.json | pbcopy`。

### 3. 推送仓库并验证

```bash
git add . && git commit -m "feat: daily checkin" && git push
```

到仓库 Actions 页手动点 **Run workflow** 跑一次验证：
- 绿色 ✅ = 打卡/领奖成功（或今日已领取）
- 红色 ❌ = 登录态失效或未匹配到按钮，下载 Artifacts 里的截图排查

### 4. 调整打卡时间

编辑 `.github/workflows/checkin.yml` 里的 cron（UTC 时间）：

```yaml
- cron: '17 0 * * *'   # UTC 00:17 = 北京时间 08:17
```

## 本地手动执行

```bash
# 用刚导出的 auth.json 直接跑一次（Windows PowerShell）
$env:YUNZHI_AUTH_JSON = Get-Content auth.json -Raw
npm run checkin
```

```bash
# macOS / Linux
YUNZHI_AUTH_JSON="$(cat auth.json)" npm run checkin
```

## 注意事项

- `auth.json` 等于你的账号凭证，**不要提交到仓库**（已在 .gitignore 中忽略）。
- 脚本会自动识别「已领取 / 已签到 / 明日再来」等完成态，重复执行不会出错。
- 若页面改版导致按钮文案变化，可在 `scripts/checkin.js` 顶部的
  `ENTRY_PATTERNS` / `CLAIM_PATTERNS` 里补充新文案。
- GitHub 的定时任务在仓库长期无活动时可能被自动停用，偶尔 push 一次或手动触发即可保持活跃。

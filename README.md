# DSH API Usage Monitor

[简体中文](./README.md) | [English](./README.en.md)

一个为 DeepSeek Harness Web 侧边栏设计的 API 用量、余额与费用监控插件：把 API 余额做成血条，把当天消耗做成架势条，并用“梁子 / 梁圣”提示峰谷时段。

> 非官方社区插件，与 DeepSeek 官方无隶属或背书关系。截图中的金额为演示数据。

![DSH API Usage Monitor 主界面](./docs/images/overview.png)

## 它能做什么

| 功能 | 说明 |
| --- | --- |
| 余额血条 | 当前余额相对本管血量上限的比例；正常消费只扣血，不会莫名回满。 |
| 今日架势条 | 显示当天消费相对每日预算的比例；充值或刷新血条不会把它清零。 |
| 峰谷状态 | 峰段显示“梁子”，谷段显示“梁圣”，点击可展开价格时段与余额详情。 |
| 充值与刷新 | 点击血瓶后可前往 DeepSeek 官方充值页，充值完成后可手动刷新血条上限。 |
| 一键重启 | 从侧边栏重启当前 Harness；Windows 使用最小化监督终端，macOS 使用后台监督器。 |
| 状态持久化 | 重启 Harness 后保留血条基准和当天消费状态。 |

![充值与重启操作](./docs/images/actions.png)

![峰谷状态详情卡](./docs/images/status-card.png)

## 使用条件

- 已经能够正常运行的 DeepSeek Harness，且已配置 `DEEPSEEK_API_KEY`
- DeepSeek Harness `0.1.0-rc.6` 或兼容版本
- Node.js `^22.19.0` 或 `>=24.0.0`
- Windows 10/11 已完成隔离安装测试；macOS 为候选支持，仍需真机验收

插件不负责安装 Harness，也不会替 Harness 配置 API Key。

## 从 GitHub 安装

1. 在 GitHub 的 **Releases** 页面下载最新的 `dsh-plugin-api-usage-monitor-*.tgz`。
2. 在终端运行下面的命令，把路径换成你刚下载的文件：

```sh
dsh plugin --profile web add "/absolute/path/to/dsh-plugin-api-usage-monitor-1.9.0-rc.4.tgz"
```

3. 启动或重启 Web profile：

```sh
dsh web
```

4. 刷新 Harness 网页。插件会保留在 `web` profile 中，不需要每次重新安装。

## 日常使用

- 点击血瓶：展开“前往官方充值”和“刷新血条”两个操作。
- 充值完成后：点击“刷新血条”，当前余额会成为新的满血上限；今日架势条不会清零。
- 点击“梁子 / 梁圣”：查看当前峰谷状态、倒计时、余额、今日消费和计价分桶。
- 点击圆形箭头：重启当前 Harness。网页会等待新的 Harness 实例真正启动后再恢复。
- 拖动状态栏：可把它临时放到页面其他位置；双击可归位。

## Windows 与 macOS

Windows 的重启监督器使用一个最小化常驻终端，以避免周期性弹出 PowerShell 窗口。macOS 不显示常驻终端，监督日志写入：

```text
$DSH_HOME/logs/dsh-balance-bar-supervisor.log
```

macOS 真机验收请重点检查：安装、余额读取、点击重启、重启后的状态保留，以及是否出现残留进程。

## 隐私与安全

- API Key 只由 Harness 的凭据模块在宿主端读取，不会发送到浏览器。
- 插件直接向 DeepSeek 官方余额接口读取余额，不上传遥测数据。
- 重启接口只接受本机环回地址发出的同源请求。
- 安装包不含安装脚本，也不包含作者电脑上的 API Key、会话或余额状态。

## 卸载

```sh
dsh plugin --profile web remove dsh-plugin-api-usage-monitor
```

卸载不会删除 Harness 会话。插件自己的血条状态位于：

```text
$DSH_HOME/storages/balance-bar-day.json
```

如需完全清理，可在 Harness 停止后手动删除该文件。

## 开发与验证

```sh
npm test
npm run preflight
npm pack --dry-run
```

当前自动化测试覆盖余额扣减、手动充值刷新、跨日状态、价格策略、重复重启、崩溃恢复、随机端口和 Windows/macOS 启动方式。

## 许可证与素材

代码使用 [MIT License](./LICENSE)。角色图片不包含在 MIT 授权范围内，详见 [ASSET-NOTICE.md](./ASSET-NOTICE.md)。

# macOS 安装与管理

## 前提

使用已安装并登录的 Codex 桌面客户端，安装 Node.js 24+。本项目不修改客户端应用包，不提供 Apple 公证保证，也不要求关闭系统级安全防护。

## 安装

1. 下载 macOS ZIP 和 `SHA256SUMS.txt`，核对后完整解压：

   ```sh
   shasum -a 256 codex-sidebar-tools-0.1.0-beta.2-macos.zip
   ```

2. 双击解压目录内的 `scripts/安装.command`。也可进入项目目录执行：

   ```sh
   node manage.cjs install
   ```

3. 自行保存工作，按 `⌘Q` 完全退出客户端。然后双击 `scripts/打开Codex.command`，或执行：

   ```sh
   node manage.cjs launch
   ```

4. 等待侧栏组件加载；点击会员区域设置自己的到期日期，点击“入口”添加目标。

如果系统阻止脚本执行，请先核对下载来源和校验值，再在终端使用上述可读命令；不要为运行本项目关闭全局安全保护。

## 安装位置与启动方式

- 程序与本地数据目录：`~/Library/Application Support/CodexSidebarTools/`。
- 独立 LaunchAgent：`com.buerhe.codex-sidebar-tools`。
- 本机调试端口：`127.0.0.1:39223`。
- 首次使用本包的“打开Codex”入口启动；后台会检测后续更新或缺少本机连接的启动，并安排退出后恢复。

安装器可探测常见的 `Codex.app`／`ChatGPT.app` 位置。未自动找到时，在项目目录指定桌面应用和内置 CLI：

```sh
node manage.cjs install --app "/Applications/Codex.app" --codex-bin "/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex"
```

上例仅展示参数格式，路径须以实际应用包为准。不要把另一个版本或其他账号环境的 CLI 当作当前客户端的内置 CLI。

## 已有旧版

本项目不会自动停用或卸载旧版 Codex Usage Card／Usage Badge。检测到旧版正在启用或当前客户端不使用本项目端口时，会提示你手动处理，不会强制关闭客户端。请先决定使用哪个版本，再自行停用另一个版本。

## 更新与恢复

升级本项目时，先备份安装目录下的 `data/state.json`，下载并完整解压新版本，再运行新包的 `scripts/安装.command`。安装会更新本项目程序，保留会员日期、便签和快捷入口；不用先卸载。

客户端更新后，后台会重新检查应用和内置 CLI。检测到缺少连接的活动窗口时，只记录一次恢复待办；等你保存工作并按⌘Q完全退出后，再尝试自动打开并加载。等待约10秒。没有待处理恢复时，客户端普通退出后保持关闭。

手动恢复入口为 `scripts/恢复插件.command`，或在新包目录执行：

```sh
node manage.cjs recover
```

该入口在客户端已关闭时尝试直接打开，在客户端运行但缺少连接时安排退出后恢复；已经连接时只让后台继续加载侧栏。它不会替你关闭活动工作窗口。需要恢复时避免同时运行多个入口。后台重启后会继续本次开机内有效的待办；待办不是永久开机自动打开客户端的指令。

本项目不会自动下载自身更新。若客户端内部侧栏或协议发生变化，启动恢复不能保证修复所有界面兼容问题，请附版本与脱敏错误反馈。

## 诊断和卸载

```sh
node manage.cjs status
node manage.cjs stop-agent
node manage.cjs start-agent
node manage.cjs recover
node manage.cjs uninstall
```

也可双击 `scripts/诊断.command` 或 `scripts/卸载.command`。卸载移除本项目的后台入口，将程序归档到安装目录内的 `backups/uninstalled-时间戳`，保留 `data`、设置与安装清单。不卸载 Codex，不处理旧版插件。若要额外清除个人数据，请先自行备份。

详情见[安全说明](../SECURITY.md)和[使用说明](usage.md)。

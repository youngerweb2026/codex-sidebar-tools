# macOS 安装与管理

## 前提

使用已安装并登录的 Codex 桌面客户端，安装 Node.js 24+。本项目不修改客户端应用包，不提供 Apple 公证保证，也不要求关闭系统级安全防护。

## 安装

1. 下载 macOS ZIP 和 `SHA256SUMS.txt`，核对后完整解压：

   ```sh
   shasum -a 256 codex-sidebar-tools-0.1.0-beta.1-macos.zip
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
- 使用本包的“打开Codex”入口启动；原图标不保证加载。

安装器可探测常见的 `Codex.app`／`ChatGPT.app` 位置。未自动找到时，在项目目录指定桌面应用和内置 CLI：

```sh
node manage.cjs install --app "/Applications/Codex.app" --codex-bin "/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex"
```

上例仅展示参数格式，路径须以实际应用包为准。不要把另一个版本或其他账号环境的 CLI 当作当前客户端的内置 CLI。

## 已有旧版

本项目不会自动停用或卸载旧版 Codex Usage Card／Usage Badge。检测到旧版正在启用或当前客户端不使用本项目端口时，会提示你手动处理，不会强制关闭客户端。请先决定使用哪个版本，再自行停用另一个版本。

## 诊断和卸载

```sh
node manage.cjs status
node manage.cjs stop-agent
node manage.cjs start-agent
node manage.cjs uninstall
```

也可双击 `scripts/诊断.command` 或 `scripts/卸载.command`。卸载移除本项目的后台入口，将程序归档到安装目录内的 `backups/uninstalled-时间戳`，保留 `data`、设置与安装清单。不卸载 Codex，不处理旧版插件。若要额外清除个人数据，请先自行备份。

详情见[安全说明](../SECURITY.md)和[使用说明](usage.md)。

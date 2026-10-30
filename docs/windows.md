# Windows 安装与管理（Beta）

本版包含 Windows 路径探测、后台入口、Chrome／文件夹打开适配与自动化测试。**没有在带登录 Codex 客户端的 Windows 桌面上完成 UI 实机验收**；客户端更新可能影响启动参数和侧栏结构。

## 前提

- 原生 Windows 桌面客户端，已完成登录。
- 原生 Windows 版 Node.js 24+，`node --version` 能在 PowerShell 中运行。
- 网页快捷入口使用已安装的 Google Chrome。
- 不使用 WSL 的 Node、CLI 或账号目录代替 Windows 原生环境。

原生 Windows 与 WSL 环境的区别参考 [OpenAI Windows 桌面应用说明](https://learn.chatgpt.com/docs/windows/windows-app)。插件自身的 CDP 与侧栏注入属于非官方内部接口集成，不属于该官方说明的兼容性承诺。

## 下载与安装

1. 下载 Windows ZIP 和 `SHA256SUMS.txt`，在 PowerShell 核对：

   ```powershell
   Get-FileHash .\codex-sidebar-tools-0.1.0-beta.1-windows.zip -Algorithm SHA256
   ```

2. 右键 ZIP 选择“全部解压”，保持文件夹完整，双击 `scripts\安装.cmd`。也可在项目目录运行：

   ```powershell
   node .\manage.cjs install
   ```

3. 自行保存工作并完全退出桌面客户端，然后双击 `scripts\打开Codex.cmd`，或运行：

   ```powershell
   node .\manage.cjs launch
   ```

4. 等待加载，点击会员区域设置到期日；“入口”“便签”均从侧栏打开。

安装不需要管理员权限，不修改 Codex 应用包，不改变永久 PowerShell 执行策略。入口脚本如使用 `-ExecutionPolicy Bypass`，仅作用于它启动的当前 PowerShell 进程；不要求手动放宽系统策略。

## 路径与手动指定

程序与数据目录为 `%LOCALAPPDATA%\CodexSidebarTools`，使用独立的用户启动项和端口 `127.0.0.1:39223`。

登录后台入口为用户 Startup 文件夹中的 `CodexSidebarTools.vbs`，通过 Windows Script Host 隐藏启动本项目的 Node 进程。如果系统未提供或禁用了 VBScript／Windows Script Host，登录时自动启动可能不可用；可手动执行 `node .\manage.cjs start-agent`，或使用“打开Codex”入口，无需为此改变系统安全策略。

自动探测覆盖常见的桌面安装位置和 Microsoft Store 包位置。桌面程序与 CLI 不是同一个用途：桌面可执行文件可能叫 `Codex.exe` 或 `ChatGPT.exe`；CLI 通常位于资源目录或客户端管理的运行目录。不要仅凭文件名大小写判断。

自动探测失败时，可用真实路径指定：

```powershell
node .\manage.cjs install --app "C:\Path\To\Codex.exe" --codex-bin "C:\Path\To\resources\codex.exe"
```

上面是参数格式示例，不是可以直接照抄的安装路径。不要修改受保护的 `WindowsApps` 文件权限来强行完成探测；请先确认当前客户端可正常运行并提供实际路径。

## 诊断与卸载

```powershell
node .\manage.cjs status
node .\manage.cjs stop-agent
node .\manage.cjs start-agent
node .\manage.cjs uninstall
```

也可使用 `scripts\诊断.cmd` 和 `scripts\卸载.cmd`。卸载移除本项目的启动项，将程序归档到安装目录内的 `backups\uninstalled-时间戳`，保留 `data`、设置与安装清单。不卸载 Codex，也不自动处理旧版插件；若需额外清除个人数据，请先自行备份。

## 常见情况

| 情况 | 处理 |
| --- | --- |
| 找不到 Node | 安装原生 Node.js 24+ 后重新打开终端，确认 `node --version`。 |
| 找不到桌面客户端或 CLI | 确认客户端可正常运行，使用 `--app` 与 `--codex-bin` 指定正确路径。 |
| 已有客户端运行但工具栏不出现 | 保存工作并自行完全退出，再使用本项目“打开Codex”入口。不要反复强制结束进程。 |
| 旧版插件仍在运行 | 自行选择启用哪个版本；新版不会自动卸载或停用旧版。 |
| 更新客户端后不显示 | 内部接口可能改变，提供系统和客户端版本、复现步骤及脱敏错误。 |
| 网页打不开 | 检查 Google Chrome 已安装，入口为完整的 HTTP／HTTPS 网址。 |

不要转发调试端口，不要公开账号登录文件、私人便签或未经脱敏的日志。详见[安全说明](../SECURITY.md)。

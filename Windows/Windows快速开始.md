# Windows 快速开始

Windows Qwen 本地 CPU 代码路径已具备，但尚未完成真实 Windows 设备验证。请先按
[Windows Qwen 本地转录](Qwen本地转录.md) 完成安装和 2 至 5 分钟的冒烟转录，
通过前不要将 Windows 标为已支持。

GitHub Releases 的 Windows ZIP 只包含项目文件、演示素材和本目录的安装指引；不包含
Node.js、Python、依赖、Qwen 模型或任何用户媒体。模型会在本机执行 `npm run setup` 时下载。

## 准备

1. 从 GitHub Releases 下载 Windows ZIP，解压到短英文路径，例如 `D:\\JPWClips`。
2. 安装 Node.js 20 LTS 或更新版本。
3. 安装 64 位 Python 3.10+，建议 Python 3.12；在 PowerShell 运行 `py --version`
   或 `python --version` 确认可用。
4. 避免将解压目录放在 OneDrive、桌面、中文用户名
   和过深目录。
5. 双击 `Windows/install.cmd`，或在 PowerShell 运行 `npm run setup`。

安装完成后，运行 `npm run doctor` 和 `npm run qwen:test`。随后将直播录像放入
`输入/媒体素材/直播录像/`，按 Qwen 指南完成冒烟验证。

Whisper.cpp 仅是显式回退，不用于验证 Qwen 字幕质量。

# Windows 快速开始

Windows Qwen 本地 CPU 代码路径已具备，但尚未完成真实 Windows 设备验证。请先按
[Windows Qwen 本地转录](Qwen本地转录.md) 完成安装和 2 至 5 分钟的冒烟转录，
通过前不要将 Windows 标为已支持。

## 准备

1. 安装 Node.js 20 LTS 或更新版本。
2. 安装 64 位 Python 3.10+，建议 Python 3.12；在 PowerShell 运行 `py --version`
   或 `python --version` 确认可用。
3. 将仓库放在短英文路径，例如 `D:\\JPWClips`，避免 OneDrive、桌面、中文用户名
   和过深目录。
4. 双击 `Windows/install.cmd`，或在 PowerShell 运行 `npm run setup`。

安装完成后，运行 `npm run doctor` 和 `npm run qwen:test`。随后将直播录像放入
`输入/媒体素材/直播录像/`，按 Qwen 指南完成冒烟验证。

Whisper.cpp 仅是显式回退，不用于验证 Qwen 字幕质量。

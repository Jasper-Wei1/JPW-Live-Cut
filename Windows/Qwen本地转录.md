# Windows Qwen 本地转录

状态：代码已适配 Windows 本地 CPU 运行，尚待真实 Windows 设备验证。转录阶段
不上传音频；模型下载仅发生在安装阶段。

## 前置条件

- Windows 10/11 x64。
- Node.js 20+。
- 64 位 Python 3.10+，建议 Python 3.12，并确保 `py` 或 `python` 可在终端运行。
- 至少预留约 12 GB 可用内存和 8 GB 磁盘空间。Qwen 在 Windows 使用 CPU `float32`，
  完整直播耗时必须实测，不承诺实时完成。

## 安装与环境检查

在仓库根目录的 PowerShell 中执行：

```powershell
npm run setup
npm run doctor
npm run qwen:test
```

若系统装有多个 Python，使用本地解释器的绝对路径重建环境：

```powershell
$env:QWEN_EXPERIMENT_PYTHON = "C:\\Python312\\python.exe"
npm run setup
```

`npm run setup` 仅安装依赖并下载 `Qwen3-ASR-0.6B` 与
`Qwen3-ForcedAligner-0.6B` 到 `实验/qwen-asr/缓存/`。模型下载完成后，
`npm run transcribe` 会启用离线标记。

## 冒烟验证

先准备一段 2 到 5 分钟、含中文语音的本地 MP4，放入
`输入/媒体素材/直播录像/`，然后执行：

```powershell
npm run transcribe -- --input "输入/媒体素材/直播录像/windows-qwen-smoke.mp4" --name "windows-qwen-smoke"
```

检查 `工作区/数据/草稿/windows-qwen-smoke-transcript.qwen.metrics.json`：

- `audioLocalOnly` 和 `networkDisabledDuringTranscription` 均为 `true`。
- `configuration.device` 为 `cpu`，`dtype` 为 `float32`。
- `status` 为 `completed`，且逐字稿的时间戳覆盖无缺口。

冒烟结果正常后，再处理完整直播。保留生成的 metrics、raw 和标准化
`schemaVersion: 1` 逐字稿；若发生错误，也保留 `python-failure.json`，不要覆盖
原媒体或已有逐字稿。

## 通过标准

Windows 只有在安装、冒烟转录和完整直播均通过后，才能标为已支持。完整直播仍须
检查内存、总时长、媒体时长误差、时间轴覆盖与字幕质量；失败时把错误文件和命令
输出提供给维护者继续修复。

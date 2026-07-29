# 本地直播精彩切片工作流

这是一个只处理已保存直播录像的本地仓库。它使用本地 `Qwen3-ASR-0.6B + Qwen3-ForcedAligner-0.6B` 完成带真实对齐时间码的逐字稿，覆盖完整原片时间轴筛选候选；用户确认逐字稿切点和字幕后，再在 Remotion Studio 确认最终 9:16 视觉并渲染成片。

原始声音不会上传到云端语音服务；原直播录像始终不可修改。

## 你只需要认识两个位置

```text
输入/媒体素材/直播录像/     放一段已保存的直播原片
输出/最终成片/               取已确认的竖屏切片
```

## 安装

默认流程已在 macOS MPS 上验证，需要 Node.js 20+ 和 Python 3.10+：

```bash
npm run setup
npm run doctor
```

首次安装会下载 Remotion 依赖、独立 Qwen 环境以及两份本地模型，约 3.5 GB。正常转录强制离线，模型和环境都位于 `实验/qwen-asr/`。

Windows 用户可从 GitHub Releases 下载 Windows ZIP，解压到短英文路径后双击 `Windows/install.cmd`。ZIP 不包含模型、依赖或任何用户媒体；`npm run setup` 会在本机安装依赖并下载官方模型。Windows 已提供 Qwen 本地 CPU 代码路径，但尚未完成实机验证，不能将其视为已支持。部署和冒烟检查见 [Windows Qwen 本地转录](Windows/Qwen本地转录.md)。

## 制作一场直播的精彩切片

把一段录像放进 `输入/媒体素材/直播录像/`，然后对 Agent 说：

```text
请读取 skills/extract-livestream-clips/SKILL.md，从
输入/媒体素材/直播录像/<视频文件>.mp4 筛选精彩切片。
先交付校核后的候选逐字稿供我确认切点和字幕；最终竖屏视觉才在 Studio 确认，不要直接渲染成片。
```

固定流程：

```text
不可修改的直播原片
-> 本地 Qwen ASR + ForcedAligner 逐字稿
-> 覆盖 100% 时间轴的六维评分
-> 候选审核
-> 大模型校核候选逐字稿
-> 用户确认校核后的逐字稿和连续源区间
-> 独立派生母版并锁定时长
-> 复用已确认的校核结果生成最终字幕
-> Studio 确认 9:16 裁切和字幕
-> 最终内容标题确认
-> 渲染成片
```

每条成片只来自一段已批准的连续原片区间，并且从该区间原起点完整播放，不得冷开场或重排播放顺序。最终标题只用于文件名，不会写入画面。

## 常用命令

```bash
# 环境检查
npm run doctor

# 本地转录一场直播
npm run transcribe -- \
  --input "输入/媒体素材/直播录像/<视频文件>.mp4" \
  --name "<批次名称>"

# 打开 Studio 审核
npm run studio

# 在切点确认前导出候选字幕审校包；由当前 Agent 模型校核后应用结果
npm run clips:transcript-review -- prepare --plan "工作区/数据/草稿/<name>-clip-review-plan.json" --transcript "工作区/数据/草稿/<name>-transcript.json" --output "工作区/数据/草稿/<name>-llm-review-input.json"
npm run clips:transcript-review -- apply --plan "工作区/数据/草稿/<name>-clip-review-plan.json" --transcript "工作区/数据/草稿/<name>-transcript.json" --review "工作区/数据/草稿/<name>-llm-review-output.json"

# 切点确认并锁定母版后，复用同一份校核结果写入最终字幕
npm run clips:transcript-review -- apply --plan "工作区/数据/已确认/<name>-approved-clips.json" --review "工作区/数据/草稿/<name>-llm-review-output.json"

# 基于审校字幕生成视觉审核数据
npm run clips:video-data -- --plan "工作区/数据/已确认/<name>-approved-clips.json"

# 重新生成直播模板画廊
npm run gallery

# 运行全部验证
npm run check
```

完整边界与验收标准见 [直播切片需求](文档/直播切片需求.md)。

# Remotion 直播切片引擎

这里是直播切片的内部渲染工程。它只包含 `LivestreamClipReview`、`LivestreamClipVisualReview` 和 `LivestreamClip916` 三个 Composition。普通用户从仓库根目录的 `README.md` 开始使用。

## Studio 数据边界

- `Templates > LivestreamClip916` 固定读取 `public/video-data/livestream-clip-demo.json`，且该演示数据只能引用仓库中已提交的 `public/demo/` 资源，供画廊和 CI 稳定渲染。
- `Workflow > LivestreamClipReview` 读取 `public/workflow/clip-review-current.json`，用于逐字稿切点确认。
- `Workflow > LivestreamClipVisualReview` 读取 `public/workflow/livestream-visual-review-current.json`，用于已批准派生母版的最终视觉确认。

真实切片数据由仓库命令生成到 Workflow 路径；不得将 `public/generated/` 的本机媒体写入模板演示数据或发布包。

# 第三方组件与授权边界

根目录 [MIT License](LICENSE) 只授权 JPW Live Cut 项目作者拥有版权的代码、
文档和演示资源。下列第三方组件保留各自作者的版权，并遵循各自的许可证或使用条款；
项目的 MIT License 不会覆盖或重新授权这些内容。

## Remotion 运行时

- 组件：`remotion`、`@remotion/*`
- 当前版本：`4.0.486`
- 来源：<https://github.com/remotion-dev/remotion>
- 许可证：Remotion License，见
  <https://github.com/remotion-dev/remotion/blob/v4.0.486/LICENSE.md>

Remotion 不是 MIT 依赖。个人、小型组织与较大营利组织的授权条件不同，使用者应根据
自己的主体和用途核对 Remotion 的当前许可。Node 依赖不会包含在本仓库或 Windows
Release ZIP 中，而是在本地安装。

## Remotion 官方 Agent Skills

- 目录：`skills/remotion-best-practices/`、`skills/remotion-markup/`、
  `skills/remotion-captions/`、`skills/remotion-render/`、
  `skills/remotion-docs/`
- 来源：<https://github.com/remotion-dev/skills>
- 固定来源提交：`e4012aace885fd67d95d2a1a3a965eca33298b17`

检查上述提交时，上游仓库没有提供可识别的许可证文件。这些固定参考文件不属于本项目
的 MIT 授权范围，版权仍归上游作者所有。复用或再分发前，应先确认上游提供的适用授权。

## Qwen3-ASR 与 ForcedAligner

- `Qwen/Qwen3-ASR-0.6B`
- `Qwen/Qwen3-ForcedAligner-0.6B`
- 来源：<https://modelscope.cn/organization/Qwen>
- 模型仓库标注许可证：Apache-2.0
- 具体下载提交：见 `实验/qwen-asr/runtime-pins.json`

模型权重不包含在本仓库或 Release ZIP 中，只会在用户运行 `npm run setup` 时下载。
使用者仍需遵守模型页面展示的当前许可证和附加条款。

## 其他依赖

JavaScript 依赖记录在 `引擎/remotion/package-lock.json`，Python 直接依赖记录在
`实验/qwen-asr/requirements.txt`。安装依赖不会使这些第三方包转为 MIT；它们继续
遵循各自发布包中的许可证。

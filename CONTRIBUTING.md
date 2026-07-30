# 贡献指南

感谢你改进 JPW Live Cut。提交修改前，请先阅读 `AGENTS.md` 和与改动范围对应的项目
Skill；项目的数据结构、连续源区间、原声主音频和人工确认门禁不得被通用实现覆盖。

## 本地检查

只验证代码和模板时，无需下载 Qwen 模型：

```bash
npm ci --prefix 引擎/remotion
npm run check
npm run gallery
```

修改 Qwen 安装或真实转录路径时，再运行完整安装与本地冒烟：

```bash
npm run setup
npm run doctor
npm run qwen:test
```

真实媒体、逐字稿、缓存、检查图和成片不得提交到仓库。

## Pull Request

- 一个 PR 只解决一个明确问题。
- 说明行为变化、风险、验证命令和实际结果。
- 修改数据结构、Skill、工作流或共享模板时必须运行 `npm run check`。
- 修改视觉模板时还要渲染并实际查看代表性检查图。
- 不得把 Windows Qwen 标记为已支持，除非真实 Windows 设备上的冒烟和完整媒体均通过。

安全问题请按 `SECURITY.md` 私密报告，不要提交公开 Issue。

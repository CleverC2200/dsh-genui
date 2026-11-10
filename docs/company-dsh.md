# 公司 DSH 适配

上游基线为 omdsh-dev/dsh-genui 的 v0.16.0，提交 92209256d3c27f99a7b363823f4d654679e97204。上游贡献及许可保留在 Git 历史和 LICENSE 中。

插件名称与 dsh-ui、genui-action 协议保持上游标识，兼容已保存的会话、围栏和宿主模块引用。独立维护版本使用 company 后缀，产物由本仓库的 GitHub Release 提供。package.json 的 private 阻止向上游 npm 包误发布；上游 npm 与 Pages 工作流仅允许在上游仓库运行。

本仓库维护组件、校验、流式渲染、交互状态、宿主接口兼容和打包完整性。GEA 仅登记固定源码与产物身份、精确依赖和装配路径，不复制插件实现。

开发使用 package.json 固定的 Node 与 pnpm，按 pnpm-lock.yaml 冻结安装。pnpm check 运行既有类型、行为、构建与资源检查；pnpm check:company-dsh 使用既有 host API 检查入口，对当前公司 DSH 对应的精确 npm 宿主执行类型、全量单元测试与构建。node scripts/verify-pack.mjs --keep 走真实打包生命周期并检查归档入口、资产和体积。

本地包检查不替代实际安装和 Native 验收。公司 Core 的补丁、真实模型账号、业务写入、Windows 与第三方侧聊分别留证。发行只在本仓库源码合并并通过必要检查后进行；组件产物发布不代表 GEA 插件或正式客户端频道已更新。

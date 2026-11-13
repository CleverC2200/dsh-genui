# GenUI 历史加固计划索引与待核验收

状态：历史索引，不作为当前执行计划。原审计、失败、量化目标、分阶段要求和执行指令完整保留于[固定提交 803753d](https://github.com/CleverC2200/dsh-genui/blob/803753d44a10e5be55e8eb61be085a2022678607/docs/plans/2026-08-11-dsh-genui-hardening-execution-plan.md)。本次只收敛入口，没有重跑或关闭原验收。

当前开发归属与宿主检查见[公司 DSH 适配](../company-dsh.md)，命令、版本和包入口读取 [package.json](../../package.json)。历史计划里的主仓步骤、最低宿主、工具链、发布矩阵和 `0.4.0` 候选均按原时间解释，不授予当前修改官方 Core、上游或发布的权限。

## 已被后续决定覆盖的方案

原 password 删除方案已被[后续设计决定](2026-08-12-dsh-genui-design-optimization.md)覆盖。现有能力与不同出口语义以 [spec](../../src/client/spec.ts)、[guard](../../src/client/guard.ts)和[边界测试](../../tests/genui-boundaries.spec.tsx)核对，不从历史计划恢复删除要求。其他历史实现建议也须与当前源码、有效业务要求和本次授权核对后才适用。

## 原始事实与失败来源

| 原记录 | 固定来源与解释边界 |
| --- | --- |
| 插件 `1aade42fd73c087b3f3bd7284da5c470285f0c6e`、版本 `0.3.4`、当时 208 项测试，以及解析、3D、包体和 E2E 缺口 | [原审计基线](https://github.com/CleverC2200/dsh-genui/blob/803753d44a10e5be55e8eb61be085a2022678607/docs/plans/2026-08-11-dsh-genui-hardening-execution-plan.md#L29)，不作为当前版本状态 |
| 本地提交 `692a2b7` 和 `scripts/e2e.mjs` onboarding WIP | [原现场与保护要求](https://github.com/CleverC2200/dsh-genui/blob/803753d44a10e5be55e8eb61be085a2022678607/docs/plans/2026-08-11-dsh-genui-hardening-execution-plan.md#L37)，不是本次改动或清理对象 |
| Billing、只读令牌、模型 Key、宿主可拉取 ref、Required checks 和分发授权 | [原外部依赖与解除条件](https://github.com/CleverC2200/dsh-genui/blob/803753d44a10e5be55e8eb61be085a2022678607/docs/plans/2026-08-11-dsh-genui-hardening-execution-plan.md#L869)，当时的阻塞不等于当前仍阻塞或已经解除 |
| 原量化目标、发布元组及停止条件 | [原完成定义](https://github.com/CleverC2200/dsh-genui/blob/803753d44a10e5be55e8eb61be085a2022678607/docs/plans/2026-08-11-dsh-genui-hardening-execution-plan.md#L53)，保留原要求，不自动套用旧阈值、旧矩阵或全量重跑指令 |

## 保留的未完成验收与待核事项

下表记录原计划需要证据的范围，不认定当前实现仍存在全部原缺陷。没有逐项对应当前插件与宿主输入的证据时，状态保持待核；本次文档整理不补记通过。原验收矩阵与每阶段完整条件均在上述固定原文中保留。

| 验收范围 | 保留的证据要求 |
| --- | --- |
| 围栏来源、面板顺序与状态身份 | 对应宿主来源契约、跨消息追加、重放与排序、状态隔离、刷新和重开恢复；原两轮真实面板场景仍待对应证据 |
| tabs、字段值和动作 | tab 内提交、隐藏或禁用字段的提交语义、答案与 action payload、原答题版本的判分、错误答案和重试行为 |
| 中文 IME | 隔离页面中用中文拼音选词，第一次 Enter 不发送模型消息，随后 Enter 正常提交；组件测试不替代此项 |
| 敏感输入与失败反馈 | 按后续决定及当前行为测试核不同出口；不使用真实秘密值，不以本地按钮提示替代发送成功，错误证据不含秘密值 |
| partial、scene3d 与指针 | 病态输入的解析工作量与耗时、静止渲染、交互和卸载；删除 3D 仍需原使用证据与产品决定，整理文档不作删除授权 |
| 构建和包 | 相同冻结输入的确定性、包内文件和导出、依赖归属、Mermaid 与保留的 3D；原大小和计时阈值按原平台及决定解释 |
| 安装器文件安全 | 普通目标、同源链接、异源链接、悬空链接、目录、缺 Skill 和异常清理；外部哨兵字节不变，冲突不能返回安装成功 |
| 隔离环境和现场保护 | 独立 profile、临时工作区、准确宿主二进制和窄进程清理；活跃服务、用户 WIP、凭据、Session 与失败截图和日志保留 |
| smoke 与真实模型 E2E | 两层分别留证；新助手回复或新来源面板变化才证明 action 闭环，页面错误、资源 404 和超时保持失败；link、实际 tarball 与固定 git 输入的原验收范围保留 |
| 外部条件与发布 | 插件和宿主 SHA、实际包摘要、兼容检查、分发接收与有效授权分别核对；源码、CI、安装和业务结果不相互替代，本次不发版 |

恢复其中任何任务时，先核当前实现、原业务要求、对应失败证据与有效授权，再确定本次范围。历史指令不重新进入当前开发规则，未完成验收也不因入口收敛而关闭。

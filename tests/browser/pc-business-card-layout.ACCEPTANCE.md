# PC 业务消息卡片布局验收

2026-11-17。本地实现与隔离验收通过，托管 CI 以本次提交的 Company DSH Actions 为准。规格见 [实施计划](../../docs/plans/2026-11-17-pc-business-card-layout-plan.md)，关联 Issues #2、#3、#4、#5、#6、#7。

## 实现与影响

- 已知混合阅读卡片按原序通栏。同类数值 stat 和单 stat 卡片按实际数字宽度选择列数，同排等宽等高。
- keyvalue 按内容分配标签栏，窄处上下排列。数字主体完整保留，单位可另起一行；整行仍放不下的极端值支持聚焦、键盘横向查看和完整选取复制。
- canonical spec、原值、单位、路径、actions 和状态保持。条件、表单、图形与媒体专属布局继续保留；无 ResizeObserver 时使用静态可读布局。
- 共享呈现规则收敛业务分组，替换默认鼓励 bento 的措辞；原短答规则移到末尾，直接从名称或数值开始，保留正负号。系统段 3399/3400 字符。

部分历史混合卡片会纵向重排，这是明确的行为变化。没有删除卡片、隐藏说明或缩小字体来制造通过。

## 环境与边界

模型仍为 `gea-analysis / 2102773062849409026`。正常业务六例逐字保留原 3750 字 persona，并通过实际 SDK renderPrompt 核对最终提示。44 项可见工具的参数、strict 与顺序保持，两个 GenUI 描述按本次规则更新。

只运行私有 Electron、app、profile 和已授权执行隔离器。全部输入为合成数据，没有生产业务查询或写入。本轮未修改 Manage、GEA、官方 Core 或正式客户端，原有已授权隔离补修继续作为验收环境使用。

作用域内 genui Skill 原本禁用且内容为空，本轮未启用或改注册。验收使用公共全局注册表中同路径真实 bundled Skill 的缓存，仅用于既有隔离参考读取，源文件与构建输入哈希一致。不能据此宣称默认作用域 Skill 可用性已修复。

## 验收结果

| 层次 | 输入与检查 | 结果 |
| --- | --- | --- |
| 完整检查 | pnpm run check，含类型、单测、构建、独立导出和 lazy map 资产 | 152 文件、2134 测试通过，命令退出 0；不是实际 WebGL 验收 |
| 固定浏览器 | 既有 12 格，加九份布局夹具各六个 PC 组合 | 66/66，无布局失败 |
| PC 组合 | 1024/1440 视口，分别 640/960 内容宽度，14/17/22 字号 | 全部适用夹具通过；原有小宽度兼容用例保留，不作为手机端新增验收 |
| 其他既有浏览器检查 | 换行、宿主字号、表格换行、语义主题、交互状态、步骤标记 | 六个脚本均退出 0 |
| 同份旧输出实窗 | row 三卡、nested-grid 四卡、截图对应 mixed 三卡，1024/1440 实窗 | 6/6，原文完整，阅读卡通栏，无越界、重叠或裁切 |
| 真实模型压力输出 | 三个原压力提示各生成一次，实际 3/4/3 卡 | 18/18 浏览器复播、6/6 原生实窗通过；专用布局 Agent，不代替业务表达选择验收 |
| 正常业务生成 | 状态、库存、排行及三个原 short 控制 | 最终有效批次 6/6；三个组件最终交付，无同轮后续 llm/stream；short 精确名称、数值单位或一句所问解释 |
| 正常业务实窗 | 三份真实业务组件 × 两种 PC 窗口 | 6/6 实际显示，字段、原值、单位和范围正确 |
| 本地月份切换 | 两次实际点击，核对订单数和顺序 | 两次通过，user/message、turn、tool、llm/stream 增量均为 0 |
| 原生动作 | 核对明细按钮实际点击一次 | 一个原 action/payload、一个新轮次；状态及合成范围保持，未查询、核对或发布；最新组件实际可见 |
| 兼容 | resize/reset:false、焦点、草稿、单次 submit、状态语义、图形和表单路径、极端值键盘与选取 | 公共入口及浏览器断言通过 |
| 审查 | 独立 Standards 与 Spec 两轴 | Standards 两项阻断已修复复核；Spec 无阻断；最终无未解决发现 |

九份布局夹具中，row/nested-grid/mixed 来自真实模型，其余六份为手工合成控制，逐例标注来源。格数不是实际模型请求次数。request/context 是用户上下文事件，没有把它当作供应商网络请求数量；收口证明使用实际 llm/stream hook 的同轮后续条目。

## 保留的失败与恢复

- 初始 mixed 六格被 reading-flow 断言拒绝。纯 CSS 最小宽仍裁切，保留失败后才增加仅指标组的数字宽度测量。
- 首次完整检查有 4 文件、7 测试失败：ResizeObserver 缺失抛错，旧跨列测试未迁移。最小修复及回归后完整检查通过。
- 首个业务批次 5/6，库存短答多出“还差”。原模型提案已含前缀，计算正确；只澄清共享短答呈现后复验，未修改发布物化或计算门禁。
- 更新提示后有一次隔离启动未保持运行、一次六例上游 server_error 零输出批次。未换模型、网关或凭据。保留失败并退避后，单次授权环境恢复完整运行原六提示，通过内容验收；原失败没有改写为成功。
- 原生脚本先因侧栏 aria-selected 假设停止，尚未点击。改用实际当前 render callId 后完成两次月份切换和一次动作。user/message 内容位置读取错误曾造成 false，依据已记录的 data.content 离线复核更正，原 false 保留，没有再次点击或模型重跑。

原始 SDK 事件、完整提示、profile 和日志留在私有目录，未提交。沙箱一次 ls 尝试被进程白名单拒绝、stdout 为空，没有调用原 bash 处理器；范围外工具由执行边界阻断。

## 本机证据入口

源码检查、补丁及审查：`/Users/synear/Documents/临时任务/genui-standalone-20261110/runtime-evidence/pc-card-layout-20261117/`。

客户端、模型与交互根目录：`/Users/synear/Documents/临时任务/genui-standalone-20261110/worktrees/t5/.e2e-artifacts/candidate-runtime/`，其中：

- `pc-card-control-20261117/installed-candidate-short-format.json`：安装字节与来源。client/standalone 字节与完整布局验收一致，因此复用同字节证据。
- `pc-card-control-20261117/native-old-verification.json`：原失败输出实窗。
- `pc-card-stress-20261117/verification.json`：压力输出浏览器及实窗。
- `pc-card-control-20261117/after-short-format/preflight.environment-recovery.json`：实际模型环境、来源和执行边界。
- `pc-card-control-20261117/model-attempt-3-export-v2/semantic-review.json`：最终六例，attempt1/attempt2 原失败另存。
- `pc-card-control-20261117/native-business-content-verification.json`：实际显示内容。
- `pc-card-control-20261117/native-interactions-attempt3/execution/summary.reviewed.json`：月份和动作，原始 false 同时保留。
- `pc-card-control-20261117/native-interactions-attempt3/final-idle-audit.json`：Agent 和进程收尾。

未发布、合并 PR 或正式安装。托管 CI 在对应提交的 Actions 中单独核对，不将本地通过等同于远端通过。

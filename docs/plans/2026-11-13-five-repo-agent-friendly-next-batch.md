# 五仓主线的下一批 Agent 友好优化方案

状态：2026-11-13 研究快照与分批方案。第 1、2、3 节已进入本批实施，第 4 节留待后续。本文不是现行工程规则、验收回执或发布授权，不加入 AGENTS 的必读链。

## 结论与本批范围

建议下一批先纠正仓库归属、共享检查的输入对象和历史文档路由。这三项直接影响 Agent 会去哪里修改代码、检查哪份 SDK、按哪套要求开发。

安装生命周期和构建命名列为随后单独处理的候选，先验证真实调用者，再迁移入口。保留已有开发 CLI、冻结输入和质量门禁，不另建跨仓治理平台。

| 顺序 | 问题 | 建议结果 | 主要涉及仓库 |
| --- | --- | --- | --- |
| 1 | Workbench 包元数据仍把旧 GitLab 写成 repository | 公司维护地址与只读上游来源各有明确身份 | Workbench |
| 2 | GEA 的公开检查写死同级 Workbench，官方类型检查先验证另一个仓库的配置 | 检查明确消费当前目标仓的配置，并沿既有入口选择共享工具 | Workbench、GEA；其余三仓回归既有消费者 |
| 3 | 历史教程、桌面 README 和 GenUI 旧计划仍含现行口吻或冲突指令 | 当前路径只路由到唯一 owner，历史原文、原始失败与未完成验收可追溯 | Workbench、GEA、GenUI |
| 后续 | 构建目标名称和安装生命周期还有第二条入口 | 命令名称表达实际构建范围，安装与显式构建分开验证 | Workbench、Manage、GEA |

本批不改业务协议、权限、Prompt/Skill、包名、已发布兼容范围或 UI。官方 Core 的源码、锁文件、HEAD 和共享依赖环境均不修改，不安装客户端，不发版。

## 主线输入与核查方式

远端 main 已逐仓读取，并 fetch 到现有 checkout。当前 checkout 仍处于已合并的 PR 分支；下列每组 `git diff --name-only HEAD <main>` 都为空，读取的是与主线完全相同的文件树。起始工作树均干净。

| 仓库 | main 快照 | 读取 checkout 的 HEAD |
| --- | --- | --- |
| Workbench | `e3d9b5b3d65947005cd6bbfc255c8d3379df086e` | `479c69cc855176bcce8dd2a97def4b90a65bab64` |
| Manage | `4f3ddc68bcafd1de67f63be9006cf36f6ab57355` | `7ada199211c683204aeac88e748e4fc602fe23a7` |
| GEA | `8c5716d87deb9cf7bf77e50cf432d70dd1bf1573` | `3a5a6928ca723889b52f1d9a24e04ab7277d5502` |
| Personal Memory | `a96aa822365812d6bbc79ea24a4ff34514cf07ae` | `9f2caaaeaea43d76e32602002d5d6a1760126845` |
| GenUI | `7875eee360e834e4529887ecf1117c1dcd54eece` | `02fda432838cc524c23dd75bacac1c1084e9e35b` |

研究阶段五仓没有 CodeGraph 索引，使用源码、package/config、工作流及引用检索，没有运行安装、构建、测试、业务查询或设备验收。研究快照与实现、验收结果分别记录，源码和本批提交用于核对实际改动。

下文“未发现入站”仅指所检查的仓内文本引用，不证明不存在外部书签、动态消费者或其他仓库调用。文件不会仅因年代或无入站被列为删除对象。

## 1. 修正来源元数据，先让 Agent 找对维护仓库

**确认的问题。** Workbench 的 [package.json repository](https://github.com/CleverC2200/dsh-agent-workbench/blob/e3d9b5b3d65947005cd6bbfc255c8d3379df086e/package.json#L142) 仍指向旧 GitLab；同仓 [AGENTS](https://github.com/CleverC2200/dsh-agent-workbench/blob/e3d9b5b3d65947005cd6bbfc255c8d3379df086e/AGENTS.md#L13) 又明确保护 GitLab source。沿 package 元数据寻找修改位置，与当前公司 GitHub 的维护归属冲突。

Manage、Personal Memory、GenUI 的 repository 已指向各自 CleverC2200 仓库，见 [Manage](https://github.com/CleverC2200/dsh-agent-manage/blob/4f3ddc68bcafd1de67f63be9006cf36f6ab57355/package.json#L117)、[Memory](https://github.com/CleverC2200/dsh-personal-memory/blob/a96aa822365812d6bbc79ea24a4ff34514cf07ae/package.json#L64)、[GenUI](https://github.com/CleverC2200/dsh-genui/blob/7875eee360e834e4529887ecf1117c1dcd54eece/package.json#L60)。GEA 未声明 repository，是可补充的缺失，不等同于已存在错误地址。

**实施建议。** 将 Workbench 的维护地址改为公司 GitHub。旧 GitLab 作为只读来源按实际需要保留，不从维护地址推导新的 push 权限。GEA 可补相同用途的维护元数据，不改 package name、license 或上游贡献记录。

**完成条件。** package、当前开发入口和实际公司 remote 的维护归属一致；历史来源仍可追溯；既有锁文件、包入口检查继续成立。无需构建业务页面或发布包来验证元数据。

## 2. 共享检查要验证当前消费者，而不是碰巧相邻的仓库

### 2.1 官方类型检查的验证对象与编译对象分离

GEA [typecheck:official](https://github.com/CleverC2200/dsh-gea-plugin/blob/8c5716d87deb9cf7bf77e50cf432d70dd1bf1573/package.json#L57) 先直接执行 Workbench 的 `verify-official-input.mjs`，然后用 GEA 自己的 `tsconfig.official.json` 编译。Workbench 的 [公开函数默认 root](https://github.com/CleverC2200/dsh-agent-workbench/blob/e3d9b5b3d65947005cd6bbfc255c8d3379df086e/scripts/verify-official-input.mjs#L27) 是 Workbench；[CLI 调用](https://github.com/CleverC2200/dsh-agent-workbench/blob/e3d9b5b3d65947005cd6bbfc255c8d3379df086e/scripts/verify-official-input.mjs#L54) 没有传目标 root。因此，该公开命令首先核的是 Workbench 的 SDK 映射，随后才编译 GEA 的映射。

这是源码可确认的验证对象分离。它不证明当前两仓 SDK 已经不同，也不表示已通过的正式 CI 错误放行；正式 CI 还有独立的输入与类型校验。

**实施建议。** 复用既有 `verifyOfficialInput(root)`，使 CLI 或薄调用适配明确传入目标仓 root。验证应读取该消费者实际使用的配置、注册 Core 和声明路径，错误中说明目标仓与工具来源。保留当前 SDK 准入强度，不自动准备或切换 Core。

### 2.2 同一共享工具的路径选择不一致

Manage 的 [检查适配](https://github.com/CleverC2200/dsh-agent-manage/blob/4f3ddc68bcafd1de67f63be9006cf36f6ab57355/scripts/check-source-comments.mjs#L4)、Memory 的 [检查适配](https://github.com/CleverC2200/dsh-personal-memory/blob/a96aa822365812d6bbc79ea24a4ff34514cf07ae/scripts/check-source-comments.mjs#L3) 和 GenUI 的 [检查适配](https://github.com/CleverC2200/dsh-genui/blob/7875eee360e834e4529887ecf1117c1dcd54eece/scripts/check-source-comments.mjs#L3) 支持 `DSH_WORKBENCH_CHECKOUT`。GEA 的 [check:knowledge](https://github.com/CleverC2200/dsh-gea-plugin/blob/8c5716d87deb9cf7bf77e50cf432d70dd1bf1573/package.json#L60) 与 [check:comments](https://github.com/CleverC2200/dsh-gea-plugin/blob/8c5716d87deb9cf7bf77e50cf432d70dd1bf1573/package.json#L86) 仍直接写死 `../dsh-agent-workbench`。

**实施建议。** GEA 沿用已有的薄适配与同一环境变量，不再增加另一份工具根配置。继续区分本地工作树反馈和固定 CI 工具版本，不把本地可编辑工具强行锁死成发行输入。Memory/GenUI 的独立 CI 保留三脚本最小检出，不要求准备完整 Workbench 或 Core。

**完成条件。**

- 从相邻和非相邻 checkout 调用时，显式选择的工具路径一致生效。
- 构造“Workbench 配置有效、消费者配置指向另一 Core 或缺材料”的最小夹具，公开类型检查在编译前拒绝不匹配消费者。
- 缺共享工具时报告所需路径，不绕过检查、不退回其他历史 checkout。
- 现有 JS/TS、HTML/CSS 注释负例继续拒绝；默认完整扫描范围不缩小。
- 优先扩展 Workbench `tests/official-entry.test.mjs`、现有 source-comments 测试、GEA `scripts/development-tasks.test.mjs` 和相关公开命令测试。只补既有测试未覆盖的消费对象与路径场景。

## 3. 收掉会被读成现行指令的历史入口

### 3.1 Workbench 的第二套 HTML 开发教程

[旧完整教程](https://github.com/CleverC2200/dsh-agent-workbench/blob/e3d9b5b3d65947005cd6bbfc255c8d3379df086e/docs/html-plugin-development-guide.md#L196) 仍称“正式 GEA 执行器尚未接入”，并给出后续迁移步骤；[现行 SQL 入口](https://github.com/CleverC2200/dsh-agent-workbench/blob/e3d9b5b3d65947005cd6bbfc255c8d3379df086e/docs/agent-sql-config.md#L72) 已说明五个 Agent 接入所属页面通道，同时保留目标环境资源与权限的独立验收。实际 [agent-query](https://github.com/CleverC2200/dsh-agent-workbench/blob/e3d9b5b3d65947005cd6bbfc255c8d3379df086e/business/shared/agent-query.ts#L34) 使用当前接线。

该完整教程未发现仓内入站，但仍可通过全文检索进入，且重复了归属、SQL、分页和交付流程。

**处置建议。** 将活跃路径缩为按 HTML、SQL、资源和交付任务触发的当前 owner 路由，原正文按固定提交追溯。先核独有业务条件，不只替换一处“尚未接入”就留下另一套长流程。

**必须保留。** [直连范围与拒绝后不回退](https://github.com/CleverC2200/dsh-agent-workbench/blob/e3d9b5b3d65947005cd6bbfc255c8d3379df086e/docs/html-plugin-development-guide.md#L194)、凭据保护、取消和行列权限要求；经销商负数、单位及支撑天数等业务口径交对应 owner 核对后保留。源码接线完成不能替代真实环境授权验收。

### 3.2 GEA 桌面 README 的历史身份没有出现在正文入口

GEA 的 [knowledge 配置](https://github.com/CleverC2200/dsh-gea-plugin/blob/8c5716d87deb9cf7bf77e50cf432d70dd1bf1573/docs/agent-knowledge.json#L25) 已把 `desktop/README.md` 列为 history；该文件开头仍写 [旧 Core](https://github.com/CleverC2200/dsh-gea-plugin/blob/8c5716d87deb9cf7bf77e50cf432d70dd1bf1573/desktop/README.md#L3)，正文称 [当前 schema 为 1](https://github.com/CleverC2200/dsh-gea-plugin/blob/8c5716d87deb9cf7bf77e50cf432d70dd1bf1573/desktop/README.md#L74)，而 [包元数据](https://github.com/CleverC2200/dsh-gea-plugin/blob/8c5716d87deb9cf7bf77e50cf432d70dd1bf1573/desktop/package.json#L9) 为 schema 2。

**处置建议。** 让直接打开该文件的读者也先看到历史范围与当前桌面交付入口。schema、Core 和频道读取其现有配置，不在长 README 再维护一份。原文保留固定提交，删除或移动前核现有质量基线与测试计时清单的路径消费者。

**必须保留。** 用户数据、登录和恢复保护、签名与公证条件、Windows 真机及首次下载等未完成验收。标记旧 schema 文字为历史不代表完成跨 schema 迁移，不通过删除用户数据解决兼容问题。

### 3.3 GenUI 的公司身份与上游流程混在公开入口

[公司适配入口](https://github.com/CleverC2200/dsh-genui/blob/7875eee360e834e4529887ecf1117c1dcd54eece/docs/company-dsh.md#L3) 明确独立维护、company 产物与 GEA 仅装配的职责。[英文 README](https://github.com/CleverC2200/dsh-genui/blob/7875eee360e834e4529887ecf1117c1dcd54eece/README.md#L1) 有公司前言，[中文 README](https://github.com/CleverC2200/dsh-genui/blob/7875eee360e834e4529887ecf1117c1dcd54eece/README.zh-CN.md#L1) 没有相同入口；两份文档的公共 npm 安装流程尚需就近说明上游适用范围。[旧 Hub 建议](https://github.com/CleverC2200/dsh-genui/blob/7875eee360e834e4529887ecf1117c1dcd54eece/docs/hub-registration.md#L15) 指向 omdsh-dev，并称 `/tmp/dsh-hub` 已有可 cherry-pick 提交。

两份 README 互链且进入包文件清单，分歧会随文档分发。Hub 文件未发现仓内入站；本轮没有核验 Hub 当前运营规则或临时目录状态，不能将旧文档中的状态当作现状。

**处置建议。** 两种语言在安装命令之前说明同一公司维护身份，保留上游安装说明但标明范围。Hub 文件只保留上游登记材料的历史路由，未来公司登记另按届时实际要求办理。包名、公开协议、历史会话兼容与许可证不随文档整理改变，不向上游写入。

### 3.4 GenUI 已被覆盖的“可执行”加固计划

[旧加固计划](https://github.com/CleverC2200/dsh-genui/blob/7875eee360e834e4529887ecf1117c1dcd54eece/docs/plans/2026-08-11-dsh-genui-hardening-execution-plan.md#L3) 仍标“可执行”，要求 [先修改 DSH 主仓](https://github.com/CleverC2200/dsh-genui/blob/7875eee360e834e4529887ecf1117c1dcd54eece/docs/plans/2026-08-11-dsh-genui-hardening-execution-plan.md#L15) 并从 [公开 spec 删除 password](https://github.com/CleverC2200/dsh-genui/blob/7875eee360e834e4529887ecf1117c1dcd54eece/docs/plans/2026-08-11-dsh-genui-hardening-execution-plan.md#L58)。后续 [设计决定](https://github.com/CleverC2200/dsh-genui/blob/7875eee360e834e4529887ecf1117c1dcd54eece/docs/plans/2026-08-12-dsh-genui-design-optimization.md#L201) 已改为保留渲染并约束出口；当前 [spec](https://github.com/CleverC2200/dsh-genui/blob/7875eee360e834e4529887ecf1117c1dcd54eece/src/client/spec.ts#L223) 仍支持该类型，现有 [行为测试](https://github.com/CleverC2200/dsh-genui/blob/7875eee360e834e4529887ecf1117c1dcd54eece/tests/genui-boundaries.spec.tsx#L215) 描述其不同出口语义。

**处置建议。** 在旧计划入口明确已覆盖范围，指向当前 spec、guard 和行为测试；保留原全文固定提交、原始失败和独立环境要求。逐项区分完成、被覆盖和未验收，不把历史标识当作关闭原缺口。不得因旧计划反向删除现有能力或修改 Core。本轮只读测试代码，没有重跑这些测试。

### 文档组的共同完成条件

- 从 README、AGENTS 和直接打开的历史路径，都能区分当前 owner 与历史材料。
- 搜索旧执行器状态、旧 schema、上游写入和旧删除要求时，只在明确的历史范围中看到这些指令。
- 不把旧文档整段复制到新“总规则”；可查询实现仍留在代码与配置。
- 原业务要求、授权、失败、未完成验收、许可证和来源保留；现有路径消费者不因清理失效。
- 沿已有 knowledge/link 检查验证改动。GenUI 没有同等完整的跨仓知识入口时，只核本次文档实际链接，不为少量文案另建检查平台。

## 4. 随后再整理安装与构建入口

### 4.1 Workbench 的 build:core 实际是带业务页面的插件构建

[package script](https://github.com/CleverC2200/dsh-agent-workbench/blob/e3d9b5b3d65947005cd6bbfc255c8d3379df086e/package.json#L125) 调用 `--target core`。[实现](https://github.com/CleverC2200/dsh-agent-workbench/blob/e3d9b5b3d65947005cd6bbfc255c8d3379df086e/scripts/build.mjs#L133) 仍构建多种页面，只区别 FC/AQKC 的独立构建；[现行文档](https://github.com/CleverC2200/dsh-agent-workbench/blob/e3d9b5b3d65947005cd6bbfc255c8d3379df086e/docs/local-development.md#L38) 也必须专门解释该名称。GEA 的 [开发动作](https://github.com/CleverC2200/dsh-gea-plugin/blob/8c5716d87deb9cf7bf77e50cf432d70dd1bf1573/scripts/development-tasks.mjs#L123) 又把 `plugin` 映射回该旧名字，形成语义转换。

**建议。** 收敛为表达 Workbench 插件范围的名字，例如 `build:plugin`，同步迁移 CI、开发动作和文档。它不是官方 Core 构建。先核所有调用者和输出范围；有已登记外部消费者时，只保留有明确退场条件的短期兼容转发。保留完整构建与局部构建的实际区别，不通过少构建页面制造收益。

Workbench 对 Manage 资源、计算源码和 GEA 构建准入的依赖是真实存在的，见 [构建入口](https://github.com/CleverC2200/dsh-agent-workbench/blob/e3d9b5b3d65947005cd6bbfc255c8d3379df086e/scripts/build.mjs#L7) 与 [资源装配](https://github.com/CleverC2200/dsh-agent-workbench/blob/e3d9b5b3d65947005cd6bbfc255c8d3379df086e/scripts/build.mjs#L34)。不建议为了“单仓”复制这些业务资源或整体搬迁 SDK。缺材料时应从既有检查明确暴露实际依赖，不能猜另一个 checkout。

### 4.2 Manage 的显式准备动作与 prepare 构建声明并存

Manage [package scripts](https://github.com/CleverC2200/dsh-agent-manage/blob/4f3ddc68bcafd1de67f63be9006cf36f6ab57355/package.json#L79) 同时声明 `prepack`、`prepare` 自动调用 build；[build](https://github.com/CleverC2200/dsh-agent-manage/blob/4f3ddc68bcafd1de67f63be9006cf36f6ab57355/scripts/build.mjs#L1) 还导入相邻 GEA 的工具并写编译产物。现有 [显式依赖准备](https://github.com/CleverC2200/dsh-gea-plugin/blob/8c5716d87deb9cf7bf77e50cf432d70dd1bf1573/scripts/development-dependencies.mjs#L274) 已对 Manage 使用 `--ignore-scripts`。

可确认的是两套入口声明并存。本轮没有执行裸安装，也没有证明当前各安装场景都会触发 prepare；Git 安装、发布打包和本地工作树安装应分别核验。

**建议。** 先用最小生命周期夹具确认实际消费者，再收掉开发安装期间的隐式编译入口，沿显式 build 构建；保留打包必需的构建和现有三包交付合同。不得在共享 Core 或五仓现有依赖上重装取证。若源码 Git 安装依赖 prepare，应先提供完整迁移，不直接删除。

**完成条件。** 安装、定向构建、完整构建与打包各自副作用可判断；开发动作和原生 package 入口使用同一实际构建逻辑；缺输入在昂贵写入前失败；既有缓存回执、产物完整性、公开导出和受影响测试保持有效。

## 仓库范围与暂不处理项

| 仓库 | 本批建议 | 暂不扩大到 |
| --- | --- | --- |
| Workbench | 归属元数据、共享验证的消费者 root、旧教程路由 | 业务页面重写、复制 Manage 资源、重组官方 SDK |
| Manage | 共享入口回归；生命周期候选留后续 | 未完成 raw-capture、业务路由及预测字典问题的裁决 |
| GEA | 公开检查适配、桌面历史路由 | 新合并平台、桌面发行、业务权限变更 |
| Personal Memory | 保留已有最小工具检出，随共享入口做必要回归 | 为凑齐五仓新增框架或文档治理机制 |
| GenUI | 双语维护身份、Hub 与旧加固计划的历史范围 | 改包名、改 password 行为、写上游或改官方 Core |

Manage 的 Note 触发规则已经收窄，Personal Memory 的协议入口和独立验收说明已有归属，本轮没有找到值得优先再清理的新冲突。不能把已完成的上一批工作重复列为收益。

## 实施顺序与交付边界

1. 先完成 Workbench 的元数据与共享验证接口，再接 GEA 消费者。按需要回归 Manage、Memory、GenUI 的现有调用；不强制每仓制造代码改动。
2. 文档组按各仓当前 owner 分别提交，可独立审查。历史路径退场前核来源、消费者和原业务缺口，不改业务文件或原始失败字节。
3. 安装生命周期和构建命名另作小批次，在真实调用者和兼容退场条件明确后实施，不与本批文档清理混成一次大重构。
4. 变更后运行受影响检查和现有必需 CI。工程检查、真实业务、设备验收和发布分别留证。本方案不要求重跑无关全量测试，也不要求发版。

预计收益是减少错误修改位置、错误 SDK 验证对象和过时开发指令。没有 Agent 开发耗时的前后测量，不把文档数量减少或入口重命名写成性能提升。

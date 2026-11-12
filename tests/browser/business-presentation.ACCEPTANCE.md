# T5 业务展示验收记录

2026-11-12。本轮未通过完整验收，PR 保持 draft，不能关闭 [#7](https://github.com/CleverC2200/dsh-genui/issues/7)。组件触发、渲染通过不代表内容或业务边界通过。

## 输入与运行边界

最终模型提示与工具定义来自 `2c5f10e`，渲染器回放来自 `4e2ef3b`。后者只改表格成功状态推断及其检查，没有重新请求模型。模型为正常 GEA `gea-analysis` provider 的 `2102773062849409026`，业务 preset 为 `gea-html-inventory-apsplan`。

隔离 Host 从已安装客户端的静态公司种子建立独立 profile，通过正常 Agent 组合流程创建合成会话。候选注册自己的 GenUI section、两个工具和 bundled Skill。GEA 原有过滤仍只保留业务 persona；该 persona 的 3750 字与 41 个非 GenUI 工具定义均与同一 Host 的正常业务会话逐字比较一致。没有用用户消息注入候选展示规则，也没有只开放 GenUI 工具来替代正常工具链。

输入为 [11 个合成案例](../fixtures/business-presentation-cases.json)。另一个旧分页输入从存活窗口的已保存页面文本恢复，按原文运行；原文中的“脱敏验收数据”是历史措辞，本次仍按合成输入处理。旧完整 12 题未恢复，不声称逐题对比。模型 spec 通过本仓真实 GenuiBlock fixture 回读；没有完成候选插件 Native 客户端装载验收，也没有修改正式 profile。

## 原始失败与补修

- 首次装配缺少 bundled GenUI Skill，模型猜字段并查找旧源码。该轮已取消，不计通过，记录保留。
- `144217bf` 的首批 18 轮保留。`status-implicit` 第一轮把核对入口做成文字路径；第二轮因 `GEA_MODEL_INVALID_TOOL_CALL` 中止，request ID 为 `33e4b9fb-a096-4fc5-b027-e25587d4eb18`，工具参数不是合法 JSON。插件未修复该上游错误。
- `2c5f10e` 明确操作入口使用带 action 的按钮或真实可用链接，并把字段参考指向当前原生 GenUI Skill。公开工具描述测试先失败，随后 86 项定向测试通过，section 保持 3400 字符预算。
- 新模型输出的 badge 列又暴露“未完成”被“完成”子串误判成功。浏览器原始失败截图与测量保留。`4e2ef3b` 将成功色限制为明确完整状态标签，保留 danger/warn 规则。公开表格测试先失败，随后 17 项通过；浏览器检查覆盖真实表格组合、正常/已完成正向对照和原有 12 个固定布局组合。

## 最终模型输出与回放

六个 required 案例各运行两次，共 12 轮；三个 short 案例各一次。12/12 required 输出 inline `dsh-ui`，`render_ui` 工具调用为 0 次。12 个生成 spec 全部实际渲染，在 960px/17px 与 360px/22px 两种环境得到 24 个回放组合；页面均无横向溢出，挂载均无动作事件，浏览器无运行错误。表格保留内部滚动。

| 案例 | 内容结果 | 本地交互结果 |
| --- | --- | --- |
| status-explicit ×2 | 已读范围、partial、未完成及下一页状态保留；200 箱没有当作全量 | 每轮两个按钮各派发一次原动作，共 4 次 |
| status-implicit ×2 | 三项状态保留；补修后未完成、未知均无成功色 | 两轮核对入口均可用，含额外入口共 5 次单次派发 |
| inventory-explicit ×2 | 两仓数量、箱单位和 ±20 差额正确 | 两个明细按钮各派发一次；没有调拨 |
| inventory-implicit ×2 | A 缺 5 箱、B 余 30 箱、C 持平正确 | 只读表格，无业务动作 |
| ranking-explicit ×2 | 两个月顺序、金额与万元单位正确；第一轮合计行未显示名次总和 | 两次切换到十一月实际显示乙 130、丙 80、甲 70；完全本地更新，无后续模型响应验收 |
| ranking-implicit ×2 | 未通过。第一轮把订单数单位写成“箱”；两轮均追加了本例未要求的占比信息 | 只读排行；渲染不能纠正模型给错的单位 |
| status-short | 未通过。没有解释 partial，且触发了不允许的业务知识库读取 | 无 render_ui、dsh-ui 或控件 |
| inventory-short | 正确回答 `20箱` | 无 GenUI 路径；正常业务 persona 另调用本地计算脚本 |
| ranking-short | 未通过窄答要求。第一名正确，但额外列出其他门店 | 无 GenUI 路径或控件 |

上述 11 次按钮派发都只接 fixture 的本地事件记录，不发送业务请求。short 仅 1/3 通过。展示触发 12/12 与实际渲染 12/12 不能写成验收 12/12 通过。

optional 两例与恢复分页例保留在旧提示 `144217bf` 的实际运行结果中，没有重复运行后改称新提示通过。optional 使用正文；恢复分页例生成内联组件，保留 200 箱仅覆盖 2/100 笔的边界，没有全量缺货率。

## 业务读取审计与剩余条件

最终 `status-short` 会话自行调用了 `mcp__gea-gateway__weknora_list_knowledge_bases` 与 `mcp__gea-gateway__weknora_ask`。前者在 03:19:19.690–03:19:21.044 UTC 返回且 `isError=false`；后者在 03:19:22.724–03:19:37.784 UTC 返回且 `isError=false`、`status=COMPLETED`。实际读取成功，不是被拒绝。本轮违反合成验收不读业务来源的边界，不能计为 short 通过。没有业务写入工具调用。

03:21:43 UTC 核验本票 36 个现存 Agent 全部 idle，没有活跃循环；此后没有再发模型请求。审计只导出工具名、调用编号、时间、成功/拒绝状态等 metadata，没有导出知识库正文或凭据。

尚未满足的条件包括模型单位与输出范围、短答正确性及业务读取隔离，以及候选客户端实际装载和后续动作回答。后续若再验模型，应先在本票执行边界阻断业务读取与写入，同时保留正常工具定义；本轮没有通过继续重试来覆盖失败。

本地原始证据位于 T5 checkout 的 `.e2e-artifacts/candidate-runtime/`，没有上传运行 profile 或凭据：

- `candidate-integrity.json`、`final-candidate-integrity.json` 保存 section 与工具逐字比较结果和候选公开定义。
- `model-results/` 保存首批 18 轮，`final-model-results/` 保存最终提示 15 轮。逐例包含 session、model、工具调用、原始正文与 spec。
- `final-model-browser/` 保存 badge 补修前失败；`final-model-browser-4e2ef3b/summary.json` 及逐例 JSON/PNG 保存补修后的 24 组合、真实点击事件与月份切换行值。
- `business-read-audit.json` 保存读取审计 metadata；`table-badge-red.log`、`table-badge-green.log`、`table-badge-fixed-browser/result.json` 保存 red/green 与浏览器结果。

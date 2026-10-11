# Zotero Review Studio v0.3.1（Zotero 7 综述研究工作台）

[![Build and Test](https://github.com/seifer08ms/zotero-review-studio/actions/workflows/build.yml/badge.svg)](https://github.com/seifer08ms/zotero-review-studio/actions/workflows/build.yml)
[![最新版本](https://img.shields.io/github/v/release/seifer08ms/zotero-review-studio)](https://github.com/seifer08ms/zotero-review-studio/releases/latest)

**[下载最新 XPI](https://github.com/seifer08ms/zotero-review-studio/releases/latest)** · [English README](README.md) · [更新日志](CHANGELOG.md)

> 当前为测试版，请先使用少量非敏感论文验证模型接口和 Zotero 7 的实际兼容性。

面向多篇论文的证据驱动型文献综述、Research Gap 分析与可复用综述写作模板。适用于大规模 Zotero 文献库：**只处理用户勾选的文献**，逐篇、分段分析，不批量读取全部馆藏 PDF。

## v0.3.1 的资源优化（不改变分析结果）

- **证据视图按需加载**：分析 35 篇论文、数千条引句时，只生成论文折叠目录；点击某篇论文才生成它的全部证据，合上后移除这些页面节点。引句、页码跳转及原文核验结果没有删减。
- **每块断点仍可恢复**：每完成一个文本块都在本地原子写入该论文的增量证据；整篇完成后将其合并到项目快照，减少重复序列化与累计写盘。原有 v0.3.0 项目可以继续读取。
- **减少重复计算**：每块 PDF 原文只进行一次引句规范化；Gap 页面只构建一次证据索引；库内/网上的相关度检索复用同一套查询词。
- **PDF 页码定位机制未改变**：仍然使用 Zotero PDFWorker 的有界前缀检索；350 页/20 引句的模拟测试两版均调用 93 次。v0.3.1 不声称显著加速 PDFWorker 本身。

还修复了 v0.3.0 的 Gap 页标签映射错误：分析完成后 Gap 区域现在能正常显示，证据引用按钮可以展开对应的论文。

详见项目根目录的 **PERFORMANCE-REPORT.zh-CN.md**，附旧版/新版性能基准、验证方法和测试范围。以上属于程序测试与模拟浏览器的资源测量，尚不是 Zotero 7 桌面端的真实进程内存结果。

## 推荐操作流程

1. 在 Zotero 中选中 3–5 篇论文，工具菜单打开 **综述工作台**；输入具体研究问题。
2. 如需补充文献，点击**搜索整个 Zotero 文献库**和/或 **OpenAlex**。候选只供查看，必须自己勾选后才纳入。网上候选没有本地 PDF 时仅以摘要/元数据分析。
3. 在顶部选用 API 配置；在 **管理 API / 设置** 中新增、复制、切换、测试模型。首次使用请测试 API 并确认对所选服务商发送论文文本。
4. 点击 **① 分析证据与 Gap**。按 PDF → 文本块 → 单篇证据卡 → 跨论文 Gap 的顺序运行。每成功完成一个文本块会在本机原子写入该论文的增量断点。
5. 如任务中断，重开工作台，点击 **恢复上次项目与选文献**，确认 API 模型、分块上限保持一致，然后点击 **继续未完成分析**。已完成文本块和论文摘要会被复用；失败的论文可重试。
6. 审阅 Gap、反例、未核实的潜在问题。在“单篇证据与来源”中展开想查看的论文（未展开的论文不会预先生成全部证据节点）。点击 **定位 Gap 原文 PDF 文件页码**，插件在有可用 PDF 和经文本匹配的引文时尝试**验证真实文件页码**。
7. 选择内置模板，或选一篇已有综述作为独立范例，提炼、编辑并保存自己的模板。点击 **② 按当前模板生成初稿**。
8. 如只需修改某章，在**综述初稿**中选择章节，点击 **重新生成所选章节**。其它章节的 Markdown 原样保留；编辑中的草稿也会延迟自动保存到本机项目。

## 每套 API 独立的代理设置

**不需要每个 API 都使用代理**，由该 API 是否能从 Zotero 所在网络访问决定。现在**每一套 API 配置**都有独立的网络代理选项，而不是全局共用：

| 每套配置的选项 | 实际效果 | 适用情景 |
|---|---|---|
| **跟随 Zotero / 系统代理**（默认） | 经 `Zotero.HTTP.request` 请求，由 Zotero 的当前代理设置决定网络路线 | 一般 API、已在 Zotero 配好网络 |
| **强制直连** | 仅当前 API 的请求创建显式直连通道，绕开代理；不改系统或 Zotero 全局设置 | 本机 Ollama、LM Studio，或可直连的国内 API |
| **独立 HTTP 代理** | 仅当前 API 的请求使用该配置独立填写的代理主机和端口 | 需要走特定本地 HTTP 代理的 API |
| **独立 SOCKS5 代理** | 同上，支持选择由 SOCKS5 代理解析远程域名 | 需要独立 SOCKS5 路由的 API |

例如可以同时保存“DeepSeek / 强制直连”“OpenAI / SOCKS5 127.0.0.1:7890”“Ollama / 强制直连”。切换 API 时代理设置随该配置切换。**HTTP/SOCKS5 网络代理**和可选的**API 中转网关**是两个不同功能：前者转发网络连接；后者接收模型 API 请求、可能接触 API Key 与论文正文。只有在信任网关并得到授权时才使用。

- 目前不支持需要用户名密码的 HTTP/SOCKS 代理，也不支持直接输入带凭据的代理 URL；不支持 IPv6 代理地址。
- 仅模型请求走当前 API 配置的独立代理；OpenAlex 等候选文献在线检索仍按 Zotero 默认网络设置访问。
- 本机代理端口必须由真实代理服务监听。可先点击 **测试当前 API**，它发送的是固定短提示词、**不会上传论文**。
- 本实现基于 Gecko 的 `nsIProxiedProtocolHandler` 请求级通道，**不改** `network.proxy.*` 或 Zotero 同步网络设置。由于没有实际 Zotero 7.0.32 的各代理环境，本地浏览器与接口模拟测试通过并不等于已验证你机器上的 HTTP/SOCKS 网络连通性。
- API Key 默认仅保留在插件窗口内存里。如果主动勾选“在本机记住此配置的 API Key”，才以**明文**保存到 Zotero preferences。复制 API 配置不会复制密钥；本地分析断点也不存储 API Key。

## 长任务断点续跑

采用可恢复的**结构化中间结果**。每篇文献分析过程中，每完成一个文本块便**原子保存该论文的增量证据侧文件**；完成一篇论文后合并写入完整项目快照，跨论文归纳后也会保存。v0.3.0 单文件 JSON 断点依然可以读取。中间结果默认位于 Zotero 数据目录下的 `review-studio-projects/`，包含研究问题、勾选论文元数据、模型/分块设置、证据卡、Gap 与草稿，不包含整篇 PDF 原文和 API 密钥。

如果修改了**已选论文、研究问题、提取模型及分块设置**，旧断点不能直接用作当前分析的续跑，需重新分析或恢复旧项目。仅更换写作模板、或用另一模型基于已完成证据重新生成初稿，不需要重读 PDF。中途网络请求无法立即中断：通常在当前请求结束后停止，可从最近一次已保存的文本块继续。

当前界面优先恢复**最近一次项目**；磁盘上可存在其他项目的断点文件，尚未提供历史项目管理器。断点依赖 Zotero 本地数据目录的写入权限。如设备重装或 PDF 内容变化，需重新核对生成证据的准确性。

## 逐条 Gap 的 PDF 文件页码定位

单篇证据卡的原文引句首先必须在提取的文本块中匹配。用户按需点击“定位 Gap”，插件再调用 Zotero `PDFWorker.getFullText(attachmentID,maxPages)` 获取 PDF 前 N 页文本，利用有界二分搜索确定**引句首次出现的 PDF 物理文件页码**。并提供点击跳转按钮。

- 页码是 **PDF 文件第 N 页（从 1 开始）**，可能不同于论文正文印刷页码（封面、附录、参考资料会影响）。
- PDF 没有文本层、经过 OCR 后出现字符差异、引用不在真实 PDF 中，或超出查找预算，都会显示“未定位”，**不会请求大模型编造页码**。
- 此操作会重复调用 Zotero 的 PDF 文本提取器，长 PDF 耗时明显；因此是**手动、按需、有限制**的功能，不会在后台对一万篇论文扫描。
- 首次出现可能是在摘要或引言；请人工检查具体段落语境，不应把文件页码当成自动可靠的学术论证。

## 综述章节级重新生成

先获得综述 Markdown 草稿，再从“综述初稿”中的章节下拉框选择一个 `##` 标题（参考文献等章节排除），点击“重新生成所选章节”。模型只接收当前章节及有限的证据卡与 Gap 上下文，结果替换**该章节正文**，保留原章节标题和所有其他章节。若模型返回额外同级大章节或空内容，插件拒绝替换原草稿；不向模型重传 PDF 全文。生成后可逐节人工修改，并延迟保存 Markdown 到本地项目。

## 综述范例转模板

选择 Zotero 中的一篇现成综述 PDF，先分析章节结构、分类方式、比较维度、Gap 论证框架和图表组织，再把结果转成**可编辑、可保存、可复用**的模板。范例论文默认为写作结构参考，不会自动混入新综述的论文证据池；不应照搬范例具体论述。遇到长范例有处理上限与抽样覆盖提示。

## 科研准确性和使用限制

**Gap 是对当前证据样本的综合，不等于已证实的整个研究领域的空白。** 作者自述的局限和模型推断的潜在 Gap 分开呈现；请检查反例、评测条件、方法适用边界，以及原始论文及页码。在线文献若无 PDF 只能使用摘要，不能假称已分析全文。

单轮最多 35 篇论文（建议先试 3–5 篇）。默认每篇最多 180,000 字符、每块 11,000 字符，并显示模型调用量上限的估计。此版本支持 **OpenAI 兼容 Chat Completions**，尚未提供各服务商的原生专属协议。实际发送论文内容前必须确认服务商、网络路线和数据传输同意。

**测试状态：** Node.js 核心/模拟网络/断点/页码/单章节单元测试，以及 Chromium 页面 UI 模拟测试已通过。Gecko 网络请求通道、真实 Zotero 图形界面、具体 API/代理、PDF 页码准确性在你的文献库上仍需现场验证。建议先用少量不敏感论文试运行。

## 构建、测试

```bash
node tests/core.test.js
node tests/runtime.test.js
node tests/exemplar.test.js
node tests/profiles.test.js
node tests/v3.test.js
node tests/incremental_resume.test.js
node tests/pipeline_equivalence.test.js
node tests/performance.test.js
python3 scripts/benchmark_ui.py  # 需要 Playwright + Chromium
python3 scripts/make_browser_smoke.py
python3 tests/browser_smoke.py  # 需要 Playwright + Chromium
python3 scripts/build_xpi.py
```

XPI 输出位于 `dist/zotero-review-studio-0.3.1.xpi`。无需 npm 安装。

MIT License.


## GitHub 源码、自动构建与发布

- 完整源码存放在 `addon/`，可安装 XPI 从这里打包生成。
- `main` 分支每次 push 自动运行核心与回归测试，并上传构建产物。
- 更新 `addon/manifest.json` 的 `version`（例如 `0.3.2`）后推送到 `main`，将自动发布 `v0.3.2`，包括 XPI 和用于 Zotero 自动更新的 `update.json`（含 SHA-256）。若版本已存在则不重复发布。
- 安装：从 [Releases](https://github.com/seifer08ms/zotero-review-studio/releases/latest) 下载 XPI，在 Zotero 7 的“工具 → 插件 → 齿轮 → 从文件安装插件”中安装。
- 贡献代码与反馈见 [CONTRIBUTING.md](CONTRIBUTING.md)；程序测试见 [PERFORMANCE-REPORT.zh-CN.md](PERFORMANCE-REPORT.zh-CN.md)。

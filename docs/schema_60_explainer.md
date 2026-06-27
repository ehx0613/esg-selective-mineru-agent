# A 股 ESG 60 指标体系构建说明

本文档用于向产品、Agent 岗、项目评审或协作者解释：本项目中的 60 个 ESG 抽取指标是如何定义出来的，为什么选择这些指标，以及它们如何服务于当前的“页面快扫 -> 选择性 MinerU 解析 -> 字段级 RAG -> LLM 抽取 -> 人工复核”流程。

## 1. 指标体系定位

本项目使用的 60 个指标来自原 ESG 主项目的 A 股 v5 schema：

```text
core_esg_v5_a_share_60
```

当前 selective-MinerU 项目并不重新手写这 60 个指标，而是通过配置加载原项目中的 schema：

```text
C:\Users\18130\PycharmProjects\爬虫\esg-multimodal-extraction-agent\config\schema\a_share_v5.py
```

当前项目中的加载入口为：

```text
src/esg_selective_mineru/schema_loader.py
```

因此，这套 60 指标可以理解为一套面向 A 股 ESG 报告的跨行业核心抽取层，而不是单个公司的临时字段清单。

## 2. 构建总原则

60 个指标的构建遵循以下原则：

```text
跨行业核心
高频披露
可结构化抽取
可人工复核
可扩展
```

换句话说，第一版核心指标体系不追求覆盖所有行业、所有公司、所有表格行，而是优先构建一套稳定、可解释、可比较的核心字段集合。

## 3. 为什么不是越多越好

ESG 报告中的披露项非常多。如果把所有可能出现的表格行、行业指标、案例数据都作为字段，字段数量会很快膨胀到几百个。

字段过多会带来几个问题：

- 抽取成本上升，LLM 调用和上下文长度都会增加。
- 字段之间容易混淆，例如“排放总量”“范围一排放”“排放强度”容易相互误配。
- 人工复核压力变大，不利于快速做小样本评估。
- 行业差异过大，跨行业泛化能力下降。

因此，当前 60 项被设计为核心层。后续可以在此基础上追加行业扩展层：

```text
core schema：60 个跨行业核心指标
industry schema：电力、医药、制造、金融等行业扩展指标
company-specific schema：公司特殊披露项
```

## 4. E/S/G 覆盖思路

指标首先按 E/S/G 三大维度搭建骨架，避免抽取结果只集中在环境指标。

当前分布为：

| 维度 | 数量 | 覆盖重点 |
| --- | ---: | --- |
| E 环境 | 22 | 气候变化、能源、水资源、污染物、废弃物、生态保护、循环经济 |
| S 社会 | 28 | 员工、职业健康安全、培训发展、产品服务、数据安全、供应链、创新、社会贡献 |
| G 治理 | 10 | 董事会、ESG 治理、信息披露、投资者关系、商业道德、反腐败、风险合规 |

这种设计保证了环境、社会、治理三类信息都能进入结构化抽取结果。

## 5. 定量、定性与混合字段

ESG 报告中既有表格里的数字，也有正文里的制度机制。因此 60 个字段分为三类：

| 类型 | 数量 | 说明 |
| --- | ---: | --- |
| quantitative | 23 | 主要抽取数值、单位、年份，例如员工总数、用水量、研发投入 |
| qualitative | 27 | 主要抽取制度、机制、政策、措施，例如气候治理机制、数据安全管理 |
| hybrid | 10 | 既可能是文本机制，也可能带数值，例如环境处罚、客户投诉、反腐败 |

定量字段通常要求：

```text
value
unit
year
evidence
source_page
```

定性字段通常要求：

```text
matched
summary
evidence
source_page
```

混合字段允许同时存在文本和数值，例如“反商业贿赂与反贪污”可能披露反腐制度，也可能披露培训次数、培训人次或案件数。

## 6. 字段不是只有名称

每个指标不是简单的中文字段名，而是一组完整元数据。典型结构包括：

| 元数据 | 含义 |
| --- | --- |
| `field_key` | 程序内部唯一字段名 |
| `name_cn` | 中文指标名 |
| `category` | E / S / G |
| `topic` | 所属议题 |
| `indicator_type` | quantitative / qualitative / hybrid |
| `value_type` | number / text / mixed |
| `unit_type` | 单位类型 |
| `unit_examples` | 单位示例 |
| `aliases` | 常见别名 |
| `search_terms` | 检索关键词 |
| `domain_knowledge` | 领域解释 |
| `required_any` | 证据中建议出现的关键词 |
| `forbidden_any` | 排除词，用于降低误匹配 |
| `preferred_source` | 优先来源，例如表格或正文 |
| `evidence_required` | 证据要求 |
| `review_priority` | 人工复核优先级 |
| `unit_required` | 是否要求单位 |
| `year_required` | 是否要求年份 |

这些元数据会参与后续 RAG 召回、LLM 抽取和人工复核。

## 7. 如何选择具体指标

### 7.1 高频披露优先

优先选择多数 A 股 ESG 报告中常见的内容，例如：

- 员工总数
- 员工性别结构
- 用水量
- 用电量
- 废弃物
- 研发投入
- 供应商数量
- 董事会结构
- 反腐败
- 风险合规

高频指标的好处是可以跨公司比较，也更适合做批量抽取和评估。

### 7.2 可复核优先

一个指标是否适合作为核心字段，需要考虑是否能找到明确证据。

优先选择：

- 有明确数值的字段。
- 有单位和年份的字段。
- 有页码和原文证据的字段。
- 有明确制度、机制或措施描述的字段。

不优先选择：

- 太主观的评价项。
- 报告表达差异极大的字段。
- 需要外部数据才能判断的字段。
- 只适用于少数行业的字段。

### 7.3 跨行业优先

第一版核心 schema 尽量避免过多行业专属指标。

例如，电力行业可能关心装机容量、发电量、绿电交易量；医药行业可能关心药品质量、不良反应、研发管线；物业或环卫行业可能关心服务面积、清扫量。这些都重要，但更适合放到行业扩展层，而不是跨行业核心层。

### 7.4 技术可抽取性优先

当前技术路线依赖：

```text
PyMuPDF / MinerU 文本解析
字段级 RAG 召回
LLM 结构化抽取
人工复核
```

因此字段需要具备较好的文本检索特征。例如字段名、别名、单位、关键词能够帮助系统定位证据。

如果一个字段在报告中没有稳定表达方式，RAG 很难召回，LLM 也容易误判。

## 8. 排除词与约束的作用

部分字段之间非常容易混淆，因此 schema 中会配置 `required_any` 和 `forbidden_any`。

例如：

```text
温室气体排放总量
范围一温室气体排放
范围二温室气体排放
温室气体排放强度
```

这些字段都和“温室气体”“排放”“碳”相关，如果只靠关键词，很容易互相误配。

因此，“温室气体排放总量”会排除：

```text
范围一
范围二
Scope 1
Scope 2
强度
```

而“范围一温室气体排放”会要求看到：

```text
范围一
Scope 1
直接温室气体
```

这类约束能减少 RAG 召回和 LLM 抽取时的错配。

## 9. 60 个指标清单

### 9.1 E 环境 22 项

| 指标 | 类型 | 议题 |
| --- | --- | --- |
| 气候变化治理机制 | qualitative | 应对气候变化 |
| 气候相关风险与机遇 | qualitative | 应对气候变化 |
| 气候战略与减排目标 | qualitative | 应对气候变化 |
| 温室气体排放总量 | quantitative | 应对气候变化 |
| 范围一温室气体排放 | quantitative | 应对气候变化 |
| 范围二温室气体排放 | quantitative | 应对气候变化 |
| 温室气体排放强度 | quantitative | 应对气候变化 |
| 节能降碳措施 | qualitative | 应对气候变化 |
| 综合能源消耗量 | quantitative | 资源利用 |
| 用电量 | quantitative | 资源利用 |
| 可再生能源使用 | hybrid | 资源利用 |
| 用水量 | quantitative | 资源利用 |
| 节水与水资源管理 | qualitative | 资源利用 |
| 污染物排放 | hybrid | 污染防治 |
| 有害废弃物 | quantitative | 废弃物处理 |
| 一般废弃物 | quantitative | 废弃物处理 |
| 废弃物回收利用 | hybrid | 废弃物处理 |
| 包装材料使用 | quantitative | 资源利用 |
| 环境合规管理 | qualitative | 污染防治 |
| 环境处罚 | hybrid | 污染防治 |
| 生态系统与生物多样性保护 | qualitative | 生态系统和生物多样性保护 |
| 循环经济与资源综合利用 | qualitative | 循环经济 |

### 9.2 S 社会 28 项

| 指标 | 类型 | 议题 |
| --- | --- | --- |
| 员工总数 | quantitative | 员工 |
| 员工性别结构 | quantitative | 员工 |
| 员工年龄结构 | quantitative | 员工 |
| 员工学历结构 | quantitative | 员工 |
| 员工流失率 | quantitative | 员工 |
| 劳动雇佣合规 | qualitative | 员工 |
| 薪酬福利保障 | qualitative | 员工 |
| 职业健康与安全管理 | qualitative | 员工 |
| 工伤事故 | quantitative | 员工 |
| 因工死亡人数 | quantitative | 员工 |
| 安全生产培训 | hybrid | 员工 |
| 员工培训覆盖率 | quantitative | 员工 |
| 员工培训小时 | quantitative | 员工 |
| 员工发展与晋升 | qualitative | 员工 |
| 多元化与平等机会 | qualitative | 员工 |
| 产品质量管理 | qualitative | 产品和服务 |
| 客户服务管理 | qualitative | 产品和服务 |
| 客户投诉处理 | hybrid | 产品和服务 |
| 数据安全管理 | qualitative | 数据安全与客户隐私 |
| 客户隐私保护 | qualitative | 数据安全与客户隐私 |
| 供应链管理 | qualitative | 供应链安全 |
| 供应商数量 | quantitative | 供应链安全 |
| 供应商ESG或可持续评估 | hybrid | 供应链安全 |
| 负责任采购 | qualitative | 供应链安全 |
| 研发投入 | quantitative | 创新驱动 |
| 专利与知识产权 | quantitative | 创新驱动 |
| 乡村振兴 | qualitative | 乡村振兴 |
| 公益慈善与社会贡献 | hybrid | 社会贡献 |

### 9.3 G 治理 10 项

| 指标 | 类型 | 议题 |
| --- | --- | --- |
| 董事会结构 | hybrid | 公司治理 |
| 独立董事情况 | quantitative | 公司治理 |
| 董事会多元化 | qualitative | 公司治理 |
| ESG或可持续发展治理架构 | qualitative | 可持续发展治理 |
| 利益相关方沟通 | qualitative | 可持续发展治理 |
| 信息披露管理 | qualitative | 公司治理 |
| 投资者关系管理 | qualitative | 公司治理 |
| 商业道德 | qualitative | 商业行为 |
| 反商业贿赂与反贪污 | hybrid | 商业行为 |
| 风险管理与合规管理 | qualitative | 公司治理 |

## 10. 与当前抽取流程的关系

这 60 个指标在当前流程中有三类作用。

### 10.1 驱动 RAG 召回

系统会把字段的以下信息拼成检索查询：

```text
name_cn
field_key
topic
domain_knowledge
aliases
search_terms
required_any
expected_units
unit_examples
```

然后从 `rag_chunks.json` 中召回相关证据，生成 `field_contexts.json`。

### 10.2 驱动 LLM 抽取

LLM 每次处理一批字段，例如当前配置为：

```text
LLM_FIELD_BATCH_SIZE=6
```

模型输入包括：

- 字段定义。
- 每个字段对应的 evidence contexts。

模型输出包括：

```text
matched
value
unit
year
summary
evidence
source_chunk_id
source_page
confidence
reason
```

### 10.3 支持人工复核

人工评估时，围绕每个字段判断：

```text
field_hit_correct：字段命中判断是否正确
value_correct：抽取值是否正确
evidence_usable：证据是否可用
```

也就是说，schema 不只是抽取配置，也决定了后续评估口径。

## 11. 可直接用于讲解的一段话

可以在汇报中这样介绍：

```text
本项目的 60 个 ESG 指标采用“跨行业核心、高频披露、可结构化抽取、可人工复核”的构建思路。指标体系先按 E/S/G 三大维度搭建覆盖框架，再从 A 股 ESG 报告中选择常见且具有可比性的环境、员工、供应链、治理、合规等议题；同时区分定量、定性和混合字段，既覆盖表格中的数值指标，也覆盖正文中的制度机制披露。每个字段不仅包含中文名称，还配置别名、检索词、期望单位、证据要求和排除词，用于提升 RAG 召回与 LLM 抽取的准确性。整体上，60 项作为跨行业核心层，行业特有指标预留为后续扩展层。
```

## 12. 一句话总结

```text
60 个指标不是简单字段列表，而是一套服务于“检索、抽取、复核、评估”的 A 股 ESG 核心 schema。
```

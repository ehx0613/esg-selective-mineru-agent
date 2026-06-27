# ESG 报告智能解析与指标抽取系统技术文档

## 目录

1. 技术路线总览  
2. 系统总体架构  
3. 技术栈说明  
4. 数据采集与报告预处理技术  
5. 页级快扫与选择性 MinerU 解析技术  
6. ESG 指标体系与 Schema 管理  
7. RAG 文本块构建与证据召回技术  
8. 大模型结构化抽取技术  
9. 质量校验与人工复核技术  
10. 数据存储与任务管理技术  
11. 后端 API 技术设计  
12. React 前端与 ECharts 可视化技术  
13. 系统部署与运行配置  
14. 测试与评估  
15. 技术小结与后续优化  

## 1. 技术路线总览

### 1.1 整体处理流程

本系统以 ESG 报告 PDF 为输入，以字段级结构化数据、证据链、人工复核结果和可视化分析结果为输出。系统没有直接对整份 PDF 做高成本深度解析，而是先通过轻量快扫定位高价值页面，再对重点页面进行 MinerU 解析和字段级证据召回，最后由大模型完成结构化抽取。

【图 1-1 系统整体处理流程图，建议绘制从 PDF 上传到 CSV/可视化输出的全链路流程】

```text
PDF 报告上传 / 批量导入
        ↓
报告有效性识别
        ↓
PyMuPDF 页级快扫
        ↓
重点页解析计划生成
        ↓
选择性 MinerU 解析
        ↓
RAG 文本块构建
        ↓
字段级证据召回
        ↓
大模型结构化抽取
        ↓
质量校验与复核优先级计算
        ↓
人工复核与结果修正
        ↓
JSON / CSV / 指标分析输出
```

该流程中，各模块的职责相对独立。页级快扫负责判断“哪些页面值得深度解析”，RAG 召回负责判断“每个字段应该看哪些证据”，大模型抽取负责判断“证据中是否披露该字段以及具体值是什么”，质量校验和人工复核负责保证最终结果可检查、可修正、可导出。

### 1.2 核心技术组成

| 技术环节 | 采用技术 | 主要作用 |
| --- | --- | --- |
| PDF 快扫 | PyMuPDF | 快速提取页级文本、关键词、数值密度和表格线索 |
| 重点页解析 | MinerU | 解析表格页、图文混排页和复杂版式页 |
| 解析计划 | 规则评分 + 阈值控制 | 判断哪些页面进入 MinerU |
| 证据召回 | BM25 + Embedding + RRF | 为每个 ESG 字段召回候选证据 |
| 结构化抽取 | OpenAI-compatible LLM | 输出字段值、单位、年份、证据和置信度 |
| 质量校验 | 年份/单位/证据规则 | 标记异常结果并计算复核优先级 |
| 数据存储 | SQLite / PostgreSQL | 存储报告、任务、结果、复核记录和产物索引 |
| 后端服务 | FastAPI | 提供上传、查询、复核、导出和指标分析接口 |
| 前端展示 | React + TypeScript + Vite | 报告管理、结果复核、指标对比和导出 |
| 可视化 | ECharts | 展示定量指标横向对比和趋势分析 |

## 2. 系统总体架构

### 2.1 架构分层

系统采用前后端分离、模块化流水线的设计方式。后端负责 PDF 处理、任务调度、数据存储和接口服务，前端负责交互展示、复核操作和可视化分析。

【图 2-1 系统架构图，建议绘制前端展示层、接口服务层、核心算法层、数据存储层四层架构】

```text
前端展示层
React + TypeScript + ECharts

接口服务层
FastAPI + BackgroundTasks

核心算法层
PyMuPDF + MinerU + Retriever + LLM Extractor + Quality Checker

数据存储层
本地文件 + SQLite / PostgreSQL
```

### 2.2 模块职责

| 模块 | 对应文件 | 职责 |
| --- | --- | --- |
| API 服务 | `src/esg_selective_mineru/api.py` | 创建任务、查询状态、返回结果、保存复核、导出 CSV、提供分析接口 |
| 流水线调度 | `src/esg_selective_mineru/pipeline.py` | 串联快扫、解析、抽取和产物写出流程 |
| PDF 快扫 | `src/esg_selective_mineru/page_scan.py` | 提取页级文本、关键词、数值密度、表格线索 |
| 解析计划 | `src/esg_selective_mineru/parse_plan.py` | 根据页级特征选择 MinerU 页面 |
| MinerU 调用 | `src/esg_selective_mineru/mineru_runner.py` | 调用 MinerU 命令并记录解析结果 |
| 灰区页复判 | `src/esg_selective_mineru/mineru_page_judge.py` | 对不确定页面进行 LLM 复判 |
| 文本块构建 | `src/esg_selective_mineru/chunks.py` | 构建 RAG 检索文本块 |
| 证据召回 | `src/esg_selective_mineru/retriever.py` | BM25、Embedding 向量召回和 RRF 融合 |
| 字段抽取 | `src/esg_selective_mineru/extractor.py` | 加载 schema、召回证据、调用模型、写出结果 |
| 模型接口 | `src/esg_selective_mineru/llm_client.py` | 构造 prompt 并调用 OpenAI-compatible API |
| 质量校验 | `src/esg_selective_mineru/quality.py` | 年份、单位、证据质量和复核优先级辅助字段 |
| 数据存储 | `src/esg_selective_mineru/job_store.py` | SQLite / PostgreSQL 双后端任务存储 |
| React 前端 | `frontend-react/` | 报告管理、结果复核、指标对比、图表分析和导出 |

## 3. 技术栈说明

### 3.1 后端技术栈

| 技术 | 版本或类型 | 用途 |
| --- | --- | --- |
| Python | 3.11+ | 后端主要开发语言 |
| FastAPI | 0.115+ | 提供 HTTP API 服务 |
| Uvicorn | 0.30+ | ASGI 服务运行器 |
| PyMuPDF | 1.24+ | PDF 文本层读取和页级快扫 |
| MinerU | 外部解析工具 | 复杂 PDF 页面解析 |
| OpenAI SDK | 1.40+ | 调用 OpenAI-compatible 文本模型和 embedding 模型 |
| psycopg | 3.2+ | PostgreSQL 数据库连接 |
| python-dotenv | 1.0+ | 读取 `.env` 配置 |
| python-multipart | 0.0.9+ | 支持 FastAPI 文件上传 |

### 3.2 前端技术栈

| 技术 | 版本或类型 | 用途 |
| --- | --- | --- |
| React | 19 | 前端交互界面 |
| TypeScript | 5.9 | 类型约束和工程化开发 |
| Vite | 8 | 前端构建工具 |
| ECharts | 6 | 指标对比和趋势图表 |
| CSS | 原生 CSS | 页面布局和样式 |

### 3.3 数据库与部署技术栈

| 技术 | 用途 |
| --- | --- |
| SQLite | 本地轻量任务存储，适合单机测试 |
| PostgreSQL 16 | 生产化关系型存储，支持多报告、多指标分析查询 |
| Docker | 构建后端与前端运行镜像 |
| Docker Compose | 同时启动 API 服务和 PostgreSQL 服务 |
| JSON / CSV | 系统主要中间产物和最终导出格式 |

## 4. 数据采集与报告预处理技术

### 4.1 批量报告采集

报告采集脚本位于 `scripts/collect_a_share_esg_reports.py`。该脚本用于采集 A 股上市公司 ESG 报告 PDF，并生成报告清单。清单中记录证券代码、公司名称、公告标题、PDF URL 和本地路径，后续预处理和批量抽取都可以基于该清单运行。

【图 4-1 报告采集流程图，建议展示检索、下载、保存 PDF、写入 manifest 的过程】

| 产物 | 说明 |
| --- | --- |
| `data/a_share_esg_reports/raw/` | 原始 PDF 文件 |
| `data/a_share_esg_reports/a_share_esg_reports_manifest.csv` | 报告清单 |

### 4.2 PDF 预处理

PDF 预处理脚本位于 `scripts/preprocess_esg_pdfs.py`。该阶段负责把采集到的 PDF 转换为后续流水线可直接使用的中间产物，包括页级文本、页级扫描结果、解析计划和初始文本块。

预处理阶段的主要步骤如下：

1. 读取报告清单。
2. 对 PDF 进行统一命名和保存。
3. 使用 PyMuPDF 提取页级文本。
4. 对每页计算 ESG 关键词、数值密度和表格线索。
5. 生成 MinerU 重点页解析计划。
6. 写出 RAG 可用的初始文本块。

| 产物 | 说明 |
| --- | --- |
| `page_texts.jsonl` | PyMuPDF 页级文本 |
| `page_scan.json` | 页级关键词、数值密度、表格线索和扫描页识别结果 |
| `parse_plan.json` | MinerU 重点页选择计划 |
| `table_candidates.json` | 表格候选页与样本文本行 |
| `pymupdf_chunks.json` | RAG 初始文本块 |
| `preprocess_manifest.csv` | 批量预处理质量概览 |

### 4.3 报告有效性判断

报告过滤逻辑位于 `report_filter.py`。该模块用于在正式解析前识别无效输入，避免鉴证声明、摘要、非完整报告等文件进入高成本解析流程。

过滤规则包括：

- 标题层面缺少 ESG、环境社会治理、可持续发展等披露框架信号的传统社会责任报告会被跳过。
- 鉴证声明、审验报告、摘要等支持性文件会被跳过。
- 无法打开或无法解析的 PDF 会记录异常原因。

被跳过的报告不会进入 MinerU 和 LLM 抽取阶段，系统会写出 `skip_report.json` 和 `run_summary.json`，便于用户查看跳过原因。

## 5. 页级快扫与选择性 MinerU 解析技术

### 5.1 页级快扫技术

页级快扫由 `page_scan.py` 完成。该模块使用 PyMuPDF 快速读取 PDF 文本层，不做复杂版式还原，主要目标是判断每一页是否值得进一步解析。

| 快扫特征 | 技术含义 | 用途 |
| --- | --- | --- |
| 文本长度 | 当前页可提取文本的长度 | 判断文本层是否完整 |
| ESG 关键词 | 环境、社会、治理、碳排放、员工等关键词命中情况 | 判断页面主题相关性 |
| 数值数量 | 数字、百分比、计量单位等出现数量 | 判断是否可能包含定量指标 |
| 表格线索 | 表格标题、连续数值、指标项等线索 | 判断是否可能包含绩效表 |
| 低文本页 | 文本层很少但页面可能有图片或扫描内容 | 标记视觉解析候选页 |
| MinerU 分数 | 多种特征加权后的页面解析价值 | 决定是否进入重点解析 |

【图 5-1 页级快扫特征示意图，建议放一页 ESG 表格页并标注关键词、数值和表格线索】

### 5.2 解析计划生成

解析计划由 `parse_plan.py` 生成。该模块读取 `page_scan.json`，根据页面得分、最大页面数和阈值配置，筛选出需要进入 MinerU 的重点页面。

解析计划主要包括：

- `page_count`：报告总页数。
- `mineru_pages`：需要调用 MinerU 的重点页。
- `visual_fallback_pages`：需要视觉兜底的候选页。
- `pages`：每页的解析策略和评分信息。

系统通过 `SELECTIVE_MINERU_MAX_PAGES` 控制每份报告最多进入 MinerU 的页面数，默认值为 12。这样可以让复杂解析资源集中在高价值页面上。

### 5.3 MinerU 调用与缓存

MinerU 调用逻辑位于 `mineru_runner.py`。当解析计划中存在重点页，且配置允许自动运行 MinerU 时，系统会调用外部 MinerU 命令完成解析，并将任务结果写入 `mineru_jobs.json`。

MinerU 的作用是补充 PyMuPDF 在复杂版式上的不足，尤其是：

- 表格结构复杂的页面。
- 图文混排页面。
- 文本层质量较差的页面。
- 普通 PDF 文本提取无法稳定还原的页面。

【图 5-2 选择性 MinerU 解析流程图，建议展示 page_scan 到 parse_plan 再到 mineru_jobs 的关系】

### 5.4 灰区页面 LLM 复判

灰区页复判由 `mineru_page_judge.py` 实现。当页面得分处于低阈值和高阈值之间时，系统可以把这些页面交给 LLM 判断是否值得进入 MinerU。

该机制默认可通过配置关闭或开启。开启后，系统会限制最大复判页面数，避免额外模型调用过多。灰区复判适合处理规则判断不确定的页面，例如关键词数量不高但可能包含重要图表的页面。

## 6. ESG 指标体系与 Schema 管理

### 6.1 60 字段指标体系

系统使用 A 股 ESG 60 字段指标体系，字段定义位于 `configs/schema/a_share_v5.py`，字段加载逻辑位于 `schema_loader.py`。每个字段不仅包含字段名，还包含召回和抽取所需的辅助信息。

字段定义通常包含：

| 字段属性 | 说明 |
| --- | --- |
| `field_key` | 字段唯一编码 |
| `name_cn` | 字段中文名称 |
| `category` | ESG 维度，通常为 E、S、G |
| `indicator_type` | 指标类型，如定量、定性、摘要等 |
| `aliases` | 字段别名 |
| `search_terms` | 召回搜索词 |
| `expected_units` | 期望单位 |
| `domain_knowledge` | 字段相关背景知识或判定说明 |

### 6.2 Schema 在系统中的作用

Schema 不是单纯的字段清单，而是贯穿召回、抽取、校验和展示的核心配置。

| 使用位置 | 作用 |
| --- | --- |
| 证据召回 | 根据字段名、别名、搜索词和单位生成查询 |
| 大模型抽取 | 约束模型必须返回哪些字段 |
| 质量校验 | 判断单位、年份和字段类型是否合理 |
| 前端展示 | 按 E/S/G 维度和指标类型组织字段 |
| 指标分析 | 选择定量指标进行横向对比和趋势分析 |

【表 6-1 可补充 60 字段指标样例表，建议展示 8 到 10 个代表字段】

### 6.3 指标说明文档

项目新增 `docs/schema_60_explainer.md`，用于解释 60 字段体系的字段含义和使用方式。技术文档中可以把该文件作为指标体系说明的补充材料。

## 7. RAG 文本块构建与证据召回技术

### 7.1 RAG 文本块构建

文本块构建逻辑位于 `chunks.py`。系统会整合 PyMuPDF 提取文本和 MinerU 解析结果，生成统一的 `rag_chunks.json`。后续召回模块不直接处理 PDF，而是面向这些文本块进行字段级检索。

每个 chunk 通常包含：

- `chunk_id`：文本块编号。
- `page`：来源页码。
- `source`：来源类型，如 PyMuPDF 或 MinerU。
- `text`：文本内容。

【图 7-1 RAG 文本块构建示意图，建议展示 PyMuPDF 文本和 MinerU 文本如何合并为 chunks】

### 7.2 BM25 关键词召回

BM25 召回由 `SimpleRetriever` 实现。系统会从字段定义中提取字段名、字段编码、主题词、别名、搜索词和期望单位，将其组合为查询文本，再计算每个 chunk 与查询文本的相关性。

BM25 适合处理字段名称明确、单位明显、关键词直接出现的情况。例如“温室气体排放量”“员工总数”“研发投入”等字段，通常可以通过关键词和单位快速定位候选证据。

### 7.3 Embedding 向量召回

Embedding 向量召回由 `EmbeddingVectorRetriever` 实现。系统在 hybrid 模式下可以调用 OpenAI-compatible Embedding API，将文本块和字段查询转换为向量，再通过 cosine similarity 计算语义相似度。

Embedding 召回适合处理表达方式不完全一致的情况。例如报告中不直接写字段标准名称，而是使用同义表达、近义表达或较长的描述性句子时，向量召回比单纯关键词匹配更容易找到相关证据。

启用 embedding 召回的关键配置如下：

```text
RETRIEVER_MODE=hybrid
RETRIEVER_VECTOR_BACKEND=embedding
EMBEDDING_MODEL=text-embedding-v4
```

如果 embedding API key 缺失或调用失败，系统会自动回退到本地字符 n-gram TF-IDF 向量，并在结果中标记 `vector_backend: local_fallback`。本地向量主要作为离线测试和异常兜底，不作为正式技术路线的主要能力。

### 7.4 RRF 融合排序

Hybrid 召回由 `HybridRetriever` 实现。该模块同时执行 BM25 和 embedding 向量召回，再使用 RRF 方法融合两个结果列表。

RRF 的作用是避免单一召回方式带来的偏差：

- BM25 对关键词精确命中敏感。
- Embedding 对语义相关内容更敏感。
- RRF 将两个排序结果合并，优先保留同时被多种方法召回的证据。

融合后的结果会保留：

| 字段 | 说明 |
| --- | --- |
| `retrieval_source` | 证据来源于 BM25、vector 或两者 |
| `bm25_rank` | BM25 排名 |
| `vector_rank` | 向量召回排名 |
| `bm25_score` | BM25 分数 |
| `vector_score` | 向量相似度分数 |
| `hybrid_rank` | 融合后排名 |
| `vector_backend` | 向量后端类型 |

### 7.5 字段级证据文件

每个字段的候选证据会写入 `field_contexts.json`。该文件是大模型抽取的重要输入，也用于后续人工追溯。

字段级证据结构大致如下：

```json
{
  "field_key": [
    {
      "chunk_id": "page_10_chunk_1",
      "page": 10,
      "text": "候选证据文本",
      "score": 0.123,
      "retrieval_source": "bm25+vector"
    }
  ]
}
```

## 8. 大模型结构化抽取技术

### 8.1 抽取流程

结构化抽取逻辑位于 `extractor.py`。该模块先加载 60 字段 schema，再构建 RAG chunks 和字段级证据，最后按字段批次调用大模型。

【图 8-1 大模型结构化抽取流程图，建议展示 schema、field_contexts、LLM 和 extraction_results 的关系】

```text
加载 60 字段 schema
        ↓
构建 RAG chunks
        ↓
按字段召回候选证据
        ↓
按批次调用 LLM
        ↓
解析 JSON 返回结果
        ↓
补齐缺失字段
        ↓
质量校验
        ↓
写出 JSON / CSV
```

### 8.2 Prompt 构造

Prompt 构造逻辑位于 `llm_client.py`。系统将字段定义和候选证据一并传给模型，并明确要求模型只输出 JSON。

Prompt 中的主要约束包括：

- 每个字段必须返回一条结果。
- `matched=false` 表示未披露或证据不足。
- 定量字段优先抽取 `value`、`unit`、`year`。
- 定性字段给出 `summary`。
- `evidence` 必须是证据中的短句。
- `confidence` 取值为 0 到 1。
- 优先抽取目标年份对应的数据。

### 8.3 目标年份控制

系统新增了目标年份传递机制，用于减少跨年份数据误抽。

涉及的函数包括：

- `extract_report(..., target_year=...)`
- `run_pipeline(..., target_year=...)`
- `LLMClient.extract_fields(..., target_year=...)`

目标年份会同时进入 Prompt 和质量校验流程。这样模型抽取时会优先选择目标报告年份的数据，质量校验时也会对年份不一致的结果进行标记。

### 8.4 调用预算控制

为了控制模型调用成本，系统设置了每份报告的调用预算和字段批大小。

| 配置项 | 说明 |
| --- | --- |
| `LLM_MAX_CALLS_PER_REPORT` | 每份报告最大模型调用次数 |
| `LLM_FIELD_BATCH_SIZE` | 每次模型调用处理字段数 |
| `RAG_TOP_K` | 每个字段召回的证据块数量 |

当调用次数达到上限后，系统会为剩余字段生成空结果，并记录 `llm_call_budget_exhausted`，保证流程不中断。

### 8.5 抽取输出

| 文件 | 说明 |
| --- | --- |
| `extraction_results.json` | 字段抽取完整结果 |
| `extraction_results.csv` | 字段抽取表格结果 |
| `extraction_summary.json` | 抽取摘要 |
| `field_contexts.json` | 字段级候选证据 |

字段结果包含：

- 字段编码和字段名称。
- ESG 维度和指标类型。
- 是否命中。
- 抽取值、单位和年份。
- 定性摘要。
- 证据短句。
- 来源 chunk 和页码。
- 置信度。
- 异常原因或质量警告。

## 9. 质量校验与人工复核技术

### 9.1 质量校验

质量校验逻辑位于 `quality.py`。该模块对模型返回结果进行二次处理，补充标准化值、单位警告、年份警告、证据评分和质量提示。

| 校验项 | 说明 |
| --- | --- |
| 年份校验 | 判断字段年份是否与目标报告年份一致 |
| 单位校验 | 判断单位是否缺失或是否与字段期望单位不符 |
| 证据评分 | 判断证据文本是否足以支撑字段结果 |
| 置信度校验 | 根据模型置信度辅助人工复核 |
| 质量警告 | 汇总年份、单位、证据等异常信息 |

### 9.2 复核优先级

复核优先级计算逻辑位于 `api.py` 的 `_review_priority()`。系统会根据字段风险自动计算 0 到 100 的复核优先级，优先级越高，越需要人工检查。

影响优先级的因素包括：

- 字段未命中。
- 置信度较低。
- 缺少证据。
- 缺少来源页码。
- 证据质量评分较低。
- 年份异常。
- 单位异常。
- 人工已编辑但仍需确认。

### 9.3 人工复核状态

人工复核状态存储在 `reviews` 表和任务目录中的复核文件里。系统支持四种状态：

| 状态 | 含义 |
| --- | --- |
| `pending` | 待复核 |
| `approved` | 已确认 |
| `rejected` | 已驳回 |
| `edited` | 已编辑 |

用户可以在前端查看字段值、证据和置信度，并对 value、unit、year、evidence 和备注进行修正。

### 9.4 复核结果导出

复核后的结果通过 `/jobs/{job_id}/export.csv` 导出。导出的 CSV 会同时保留原始抽取结果和人工修正结果。

导出字段包括：

- 原始值、原始单位、原始年份。
- 复核状态。
- 修正值、修正单位、修正年份。
- 修正证据。
- 复核备注。
- 质量警告和复核优先级。

## 10. 数据存储与任务管理技术

### 10.1 SQLite / PostgreSQL 双后端

数据存储逻辑位于 `job_store.py`。系统默认可以使用 SQLite 本地数据库，也可以通过配置 `DATABASE_URL` 切换到 PostgreSQL。

SQLite 适合本地开发和轻量测试，PostgreSQL 适合多报告、多任务和指标分析场景。系统通过 `psycopg[binary]` 连接 PostgreSQL，并在 `JobStore` 中统一封装 SQL 差异。

【图 10-1 数据存储结构图，建议展示 reports、jobs、extraction_results、reviews、artifacts 五张表关系】

### 10.2 数据表设计

| 表 | 说明 |
| --- | --- |
| `reports` | 报告元数据，包括文件名、公司名、证券代码、报告年份 |
| `jobs` | 任务信息，包括状态、模式、耗时、输出目录 |
| `reviews` | 人工复核记录 |
| `extraction_results` | 字段抽取结果 |
| `artifacts` | 任务产物索引 |

### 10.3 新增存储字段

当前版本增加了更多面向分析和统计的字段：

| 字段 | 所属表 | 作用 |
| --- | --- | --- |
| `company_name` | `reports` | 公司名称 |
| `stock_code` | `reports` | 证券代码 |
| `report_year` | `reports` | 报告年份 |
| `started_at` | `jobs` | 任务开始时间 |
| `finished_at` | `jobs` | 任务结束时间 |
| `duration_seconds` | `jobs` | 任务耗时 |
| `timing_json` | `jobs` | 分阶段耗时详情 |
| `report_id` | `extraction_results` | 结果关联报告 |
| `numeric_value` | `extraction_results` | 用于图表分析的数值字段 |

### 10.4 报告元数据推断与修正

系统会从文件名中尝试推断证券代码、公司名称和报告年份。如果自动推断不准确，用户可以通过接口修正：

```text
PUT /reports/{report_id}/metadata
```

该接口用于保证后续指标横向对比和趋势分析时，公司和年份信息准确。

## 11. 后端 API 技术设计

### 11.1 任务接口

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| `POST` | `/reports` | 上传单份报告并创建任务 |
| `POST` | `/reports/batch` | 批量上传报告并创建任务 |
| `GET` | `/jobs` | 查询任务列表 |
| `GET` | `/jobs/{job_id}` | 查询任务详情 |
| `POST` | `/jobs/{job_id}/retry` | 重跑任务 |
| `DELETE` | `/jobs/{job_id}` | 删除任务 |

### 11.2 结果接口

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| `GET` | `/jobs/{job_id}/summary` | 查询任务摘要 |
| `GET` | `/jobs/{job_id}/results` | 查询字段抽取结果 |
| `GET` | `/jobs/{job_id}/quality` | 查询质量统计 |
| `GET` | `/jobs/{job_id}/export.csv` | 导出复核后 CSV |
| `GET` | `/jobs/{job_id}/artifacts` | 查询任务产物 |

### 11.3 复核接口

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| `GET` | `/jobs/{job_id}/reviews` | 查询复核记录 |
| `PUT` | `/jobs/{job_id}/reviews/{field_key}` | 保存字段复核 |

### 11.4 指标分析接口

指标分析接口用于支持前端 ECharts 可视化。

| 方法 | 路径 | 功能 |
| --- | --- | --- |
| `GET` | `/metrics/options` | 获取年份、企业、指标选项 |
| `GET` | `/metrics/compare` | 企业横向指标对比 |
| `GET` | `/metrics/trend` | 单企业指标趋势分析 |

`/metrics/compare` 适合对同一年份、同一字段下不同企业的指标值进行比较。`/metrics/trend` 适合查看同一企业在不同年份下某个指标的变化趋势。

## 12. React 前端与 ECharts 可视化技术

### 12.1 前端技术结构

前端位于 `frontend-react/`，采用 React + TypeScript + Vite 开发。前端通过 FastAPI 接口读取任务、结果、复核和指标分析数据。

【图 12-1 前端页面结构图，建议展示总览、报告管理、结果复核、指标分析、导出中心之间的关系】

### 12.2 页面功能

| 页面 | 功能 |
| --- | --- |
| 项目总览 | 展示任务数量、完成数、失败数、待复核数量 |
| 报告管理 | 上传、查看、重跑、删除报告 |
| 结果复核 | 查看字段结果、证据、置信度并进行人工修正 |
| 指标对比 | 对多份报告的同一字段进行横向比较 |
| 指标分析 | 使用 ECharts 展示定量指标图表 |
| 导出中心 | 下载复核后的 CSV |

### 12.3 ECharts 可视化

系统使用 ECharts 展示定量 ESG 指标。

当前可视化方式包括：

- 企业横向对比柱状图：展示同一年份、同一指标下不同企业的指标值。
- 企业趋势折线图：展示同一企业、同一指标在不同年份的变化趋势。
- 非定量指标证据卡片：对无法数值化的定性指标，以证据和摘要方式展示。

【图 12-2 企业横向对比柱状图占位，建议放 ECharts 图表截图】

【图 12-3 单企业趋势折线图占位，建议放 ECharts 图表截图】

### 12.4 前后端交互

前端主要通过 `fetch` 调用后端接口：

- 上传 PDF 时使用 `FormData`。
- 任务列表通过 `/jobs` 轮询刷新。
- 抽取结果通过 `/jobs/{job_id}/results` 获取。
- 复核结果通过 `PUT /jobs/{job_id}/reviews/{field_key}` 保存。
- 指标分析通过 `/metrics/compare` 和 `/metrics/trend` 获取。
- CSV 通过 `/jobs/{job_id}/export.csv` 下载。

## 13. 系统部署与运行配置

### 13.1 本地运行

后端可使用 Uvicorn 启动：

```powershell
$env:PYTHONPATH='C:\Users\18130\PycharmProjects\爬虫\esg-selective-mineru-agent\src'
& 'C:\Users\18130\.conda\envs\pachong\python.exe' -m uvicorn esg_selective_mineru.api:app --host 127.0.0.1 --port 8000 --reload
```

前端可在 `frontend-react/` 目录中运行：

```powershell
npm run dev
```

### 13.2 Docker 部署

Dockerfile 采用多阶段构建。第一阶段使用 Node.js 构建 React 前端，第二阶段使用 Python 3.11 镜像运行 FastAPI 服务。

Docker Compose 同时启动 API 和 PostgreSQL：

| 服务 | 镜像或构建方式 | 说明 |
| --- | --- | --- |
| `api` | 本项目 Dockerfile | FastAPI 后端和静态前端 |
| `postgres` | `postgres:16-alpine` | PostgreSQL 数据库 |

### 13.3 关键配置项

| 配置项 | 说明 |
| --- | --- |
| `DATABASE_URL` | 数据库连接地址，支持 SQLite 或 PostgreSQL |
| `MINERU_COMMAND` | MinerU 命令 |
| `DASHSCOPE_API_KEY` | 文本模型和 embedding 模型 API Key |
| `OPENAI_BASE_URL` | OpenAI-compatible API 地址 |
| `TEXT_MODEL` | 字段抽取模型 |
| `RETRIEVER_MODE` | 召回模式，支持 `simple` 和 `hybrid` |
| `RETRIEVER_VECTOR_BACKEND` | 向量后端，正式使用 `embedding`，异常时可 fallback |
| `EMBEDDING_MODEL` | embedding 模型名称 |
| `TARGET_REPORT_YEAR` | 默认目标报告年度 |
| `SELECTIVE_MINERU_MAX_PAGES` | 每份报告最多进入 MinerU 的页面数 |

## 14. 测试与评估

### 14.1 单元测试

| 测试文件 | 内容 |
| --- | --- |
| `tests/test_report_filter.py` | 报告过滤规则 |
| `tests/test_parse_plan.py` | 解析计划生成 |
| `tests/test_retriever.py` | 证据召回逻辑 |

### 14.2 异常输入验证

系统对以下异常输入进行处理：

- 非完整 ESG 报告。
- 鉴证声明或审验报告。
- 摘要文件。
- 无法解析的 PDF。
- 重复上传的 PDF。

异常输入不会进入 MinerU 和 LLM 抽取链路，系统会记录跳过原因。

### 14.3 抽取结果评估

系统提供人工评估流程，用于检查字段命中、value 准确性和 evidence 可用性。

评估指标包括：

- 字段命中率。
- value 准确率。
- evidence 可用率。
- 平均处理时间。
- MinerU 页面调用比例。

### 14.4 召回模式对比

系统支持对不同召回模式进行对比，包括：

- simple：BM25 召回。
- hybrid + embedding：BM25 与 embedding 向量召回融合。
- local fallback：embedding 不可用时的本地向量兜底。

对比结果可以通过人工评估表记录每个字段的最佳召回模式和证据质量。

## 15. 技术小结与后续优化

### 15.1 当前技术实现小结

当前系统已经形成从 PDF 输入到结构化指标输出的完整技术链路，包括：

- PDF 页级快扫。
- 选择性 MinerU 解析。
- 60 字段 ESG schema 管理。
- BM25 + embedding 的字段级证据召回。
- 大模型结构化抽取。
- 目标年份控制。
- 质量校验和复核优先级。
- SQLite / PostgreSQL 双后端存储。
- React 前端复核和 ECharts 指标分析。
- JSON / CSV 产物导出。

### 15.2 后续优化方向

后续可以继续优化以下技术点：

- 清理历史遗留前端目录和不再使用的静态挂载逻辑，保持正式技术栈统一。
- 增强 MinerU 表格结构化结果利用，提高复杂表格字段抽取准确率。
- 引入向量数据库，替代当前内存级 embedding 检索。
- 增加 PDF 页面截图和证据高亮功能。
- 将任务执行从 FastAPI BackgroundTasks 升级为 Celery 或 RQ。
- 扩大人工标注评估集，持续优化召回策略和抽取 prompt。
- 完善 PostgreSQL 索引，提升多报告、多指标分析查询性能。


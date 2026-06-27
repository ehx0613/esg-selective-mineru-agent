import * as echarts from 'echarts'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

const API_BASE = import.meta.env.VITE_API_BASE || ''
const LOW_CONFIDENCE = 70

type ViewId = 'dashboard' | 'reports' | 'review' | 'compare' | 'export'
type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped'
type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'edited'
type CompareMode = 'single' | 'multi'

type Job = {
  job_id: string
  report_id?: string
  status: JobStatus
  mode: string
  pdf_path: string
  output_dir: string
  use_llm: boolean
  created_at: string
  updated_at: string
  error?: string
  summary?: Record<string, unknown>
  report_filename?: string
  company_name?: string
  stock_code?: string
  report_year?: string
  started_at?: string
  finished_at?: string
  duration_seconds?: number | null
  timing?: Record<string, unknown>
}

type ReviewRecord = {
  status?: ReviewStatus
  value?: string | null
  unit?: string | null
  year?: string | null
  evidence?: string | null
  reviewer_note?: string
}

type ResultRow = {
  field_key: string
  name_cn?: string
  category?: string
  indicator_type?: string
  matched?: boolean
  value?: string
  unit?: string
  year?: string
  evidence?: string
  reason?: string
  confidence?: number
  source_page?: string | number
  source_chunk_id?: string
  source_text_short?: string
  summary?: string
  review?: ReviewRecord
}

const views: Array<[ViewId, string]> = [
  ['dashboard', '总览'],
  ['reports', '报告管理'],
  ['review', '结果复核'],
  ['compare', '报告对比'],
  ['export', '导出中心'],
]

const viewTitles: Record<ViewId, string> = {
  dashboard: '把复杂报告，变成可信赖的数据资产。',
  reports: '报告管理',
  review: '结果复核',
  compare: '报告对比',
  export: '导出中心',
}

const statusLabels: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
  skipped: '已筛选',
  pending: '待复核',
  approved: '已确认',
  rejected: '已驳回',
  edited: '已修改',
}

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, options)
  if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`)
  return response.json() as Promise<T>
}

function fileName(job?: Job): string {
  return String(job?.summary?.filename || job?.report_filename || job?.pdf_path || '').split(/[\\/]/).pop() || '-'
}

function reportTitle(job?: Job): string {
  return fileName(job)
    .replace(/\.pdf$/i, '')
    .replace(/^[a-f0-9]{16,}_[0-9]{4,}_?/i, '')
    .replace(/^[a-f0-9]{8,}_?/i, '')
    .replace(/[_-]+/g, ' ')
    .trim() || fileName(job)
}

function inferMetadata(job?: Job): Pick<Job, 'company_name' | 'stock_code' | 'report_year'> {
  const source = `${job?.report_filename || ''} ${fileName(job)} ${job?.company_name || ''} ${reportTitle(job)}`.trim()
  const tokens = source.split(/[_\-\s]+/).filter(Boolean)
  const stockCode = job?.stock_code || tokens.find((token) => /^\d{6}$/.test(token)) || ''
  const reportYear = job?.report_year || (source.match(/20[12]\d/)?.[0] || '')
  let companyName = job?.company_name || ''
  if (!companyName || (stockCode && companyName.includes(stockCode))) {
    const stockIndex = tokens.findIndex((token) => token === stockCode)
    const nextToken = stockIndex >= 0 ? tokens[stockIndex + 1] : ''
    if (nextToken && !/^20[12]\d$/.test(nextToken)) companyName = nextToken
  }
  if (stockCode && companyName.startsWith(stockCode)) companyName = companyName.slice(stockCode.length).trim()
  return {
    company_name: companyName.replace(reportYear, '').trim(),
    stock_code: stockCode,
    report_year: reportYear,
  }
}

function fmtDate(value?: string): string {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return value
  }
}

function fmtDuration(seconds?: number | null): string {
  if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return '-'
  const total = Math.max(0, Math.round(Number(seconds)))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes <= 0) return `${rest}秒`
  return `${minutes}分${String(rest).padStart(2, '0')}秒`
}

function jobDuration(job: Job): string {
  if (job.duration_seconds !== null && job.duration_seconds !== undefined) return fmtDuration(job.duration_seconds)
  const timing = job.timing || job.summary?.timing as Record<string, unknown> | undefined
  const total = Number(timing?.total_seconds)
  if (Number.isFinite(total)) return fmtDuration(total)
  if (job.status === 'running' && job.started_at) {
    const elapsed = (Date.now() - new Date(job.started_at).getTime()) / 1000
    if (Number.isFinite(elapsed)) return `运行中 ${fmtDuration(elapsed)}`
  }
  return '-'
}

function translateReason(reason?: unknown): string {
  const text = String(reason || '')
  if (!text) return ''
  if (text.includes('legacy social responsibility report') || text.includes('lacks ESG')) {
    return '疑似传统社会责任报告，缺少 ESG 披露框架信号，系统已自动筛选。'
  }
  if (text.includes('supporting statement') || text.includes('assurance report')) {
    return '疑似鉴证声明、补充说明或摘要文件，不是完整 ESG 报告，系统已自动筛选。'
  }
  if (text.includes('PDF cannot be opened or parsed')) return text.replace('PDF cannot be opened or parsed', 'PDF 无法打开或解析')
  return text
}

function formatApiError(error: unknown): string {
  const text = String(error instanceof Error ? error.message : error)
  try {
    const data = JSON.parse(text)
    const detail = data.detail
    if (detail?.code === 'duplicate_report') {
      return `${detail.message} 原任务：${detail.job_id?.slice(0, 10) || '-'}，状态：${statusLabels[detail.status] || detail.status || '-'}。`
    }
    if (typeof detail === 'string') return detail
    if (detail?.message) return detail.message
  } catch {
    return translateReason(text) || text
  }
  return text
}

function confidence(row?: ResultRow): number {
  const numeric = Number(row?.confidence || 0)
  return Math.max(0, Math.min(100, Math.round(numeric <= 1 ? numeric * 100 : numeric)))
}

function reviewStatus(row?: ResultRow): ReviewStatus {
  return row?.review?.status || 'pending'
}

function displayValue(row?: ResultRow): string {
  const review = row?.review || {}
  const value = review.value ?? row?.value ?? ''
  const unit = review.unit ?? row?.unit ?? ''
  return [value, unit].filter(Boolean).join(' ') || row?.summary || (row?.matched ? '已匹配，待复核' : '未抽取')
}

function numericValue(row?: ResultRow): number | null {
  const raw = row?.review?.value ?? row?.value ?? row?.summary ?? ''
  const match = String(raw).replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return match ? Number(match[0]) : null
}

function statusClass(status?: string): string {
  if (status && ['succeeded', 'approved', 'edited'].includes(status)) return 'verified'
  if (status && ['failed', 'skipped', 'rejected'].includes(status)) return 'rejected'
  return 'review'
}

function isQuantitative(row?: ResultRow): boolean {
  if (!row) return false
  const type = String(row.indicator_type || '').toLowerCase()
  if (type.includes('定量') || type.includes('quant') || type.includes('numeric') || type.includes('数值')) return true
  const value = row.review?.value ?? row.value ?? row.summary ?? ''
  return /\d/.test(String(value)) && Boolean(row.unit || row.review?.unit)
}

function dimensionKey(category?: string) {
  const text = String(category || '').trim().toLowerCase()
  if (text === 'e' || text.includes('环境') || text.includes('environment')) return 'E'
  if (text === 's' || text.includes('社会') || text.includes('social')) return 'S'
  if (text === 'g' || text.includes('治理') || text.includes('governance')) return 'G'
  return text.slice(0, 1).toUpperCase() || '-'
}

function Badge({ status, children }: { status?: string; children?: React.ReactNode }) {
  return <span className={`badge ${statusClass(status)}`}>{children || statusLabels[status || ''] || status || '-'}</span>
}

export default function App() {
  const [enteredWorkspace, setEnteredWorkspace] = useState(false)
  const [view, setView] = useState<ViewId>('dashboard')
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedJobId, setSelectedJobId] = useState('')
  const [results, setResults] = useState<ResultRow[]>([])
  const [selectedField, setSelectedField] = useState('')
  const [resultFilter, setResultFilter] = useState('all')
  const [jobFilter, setJobFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('上传 ESG 报告 PDF 后，系统会保留历史任务，并支持结果复核、同一报告对比和不同报告对比。')

  const selectedJob = jobs.find((job) => job.job_id === selectedJobId) || jobs[0]

  async function refreshJobs() {
    const data = await api<{ jobs: Job[] }>('/jobs')
    setJobs(data.jobs || [])
    if (!selectedJobId && data.jobs?.[0]) setSelectedJobId(data.jobs[0].job_id)
  }

  async function loadResults(jobId: string) {
    if (!jobId) return
    try {
      const rows = await api<ResultRow[]>(`/jobs/${jobId}/results`)
      setResults(rows || [])
      setSelectedField(rows?.[0]?.field_key || '')
      setResultFilter('all')
    } catch {
      setResults([])
      setSelectedField('')
    }
  }

  useEffect(() => {
    refreshJobs().catch((error) => setMessage(`读取历史任务失败：${formatApiError(error)}`))
  }, [])

  useEffect(() => {
    if (selectedJobId) loadResults(selectedJobId)
  }, [selectedJobId])

  useEffect(() => {
    const timer = window.setInterval(() => refreshJobs().catch(() => {}), 4000)
    return () => window.clearInterval(timer)
  }, [selectedJobId])

  async function upload(files: FileList | null) {
    const selected = Array.from(files || [])
    if (!selected.length) return
    setEnteredWorkspace(true)
    const formData = new FormData()
    selected.forEach((file) => formData.append('files', file))
    setMessage(`正在上传 ${selected.length} 份报告...`)
    try {
      const data = await api<{ jobs: Job[] }>('/reports/batch?mode=run&use_llm=true', { method: 'POST', body: formData })
      await refreshJobs()
      if (data.jobs?.[0]) setSelectedJobId(data.jobs[0].job_id)
      setView('reports')
      setMessage(`已创建 ${data.jobs?.length || 0} 个任务。每份报告会单独保留，后续可复核和对比。`)
    } catch (error) {
      setMessage(`上传失败：${formatApiError(error)}`)
    }
  }

  async function openJob(job: Job, nextView: ViewId = 'review') {
    setEnteredWorkspace(true)
    setSelectedJobId(job.job_id)
    setView(nextView)
    setMessage(`正在查看：${fileName(job)}`)
    await loadResults(job.job_id)
  }

  async function retry(jobId: string) {
    try {
      await api(`/jobs/${jobId}/retry`, { method: 'POST' })
      setMessage('任务已重新排队。')
      await refreshJobs()
    } catch (error) {
      setMessage(`重跑失败：${formatApiError(error)}`)
    }
  }

  async function deleteJob(jobId: string) {
    const job = jobs.find((item) => item.job_id === jobId)
    if (!window.confirm(`确定删除这份报告及其抽取结果吗？\n${fileName(job)}`)) return
    try {
      await api(`/jobs/${jobId}`, { method: 'DELETE' })
      setMessage('报告任务已删除。')
      setSelectedJobId('')
      setResults([])
      setSelectedField('')
      await refreshJobs()
    } catch (error) {
      setMessage(`删除失败：${formatApiError(error)}`)
    }
  }

  async function saveReportMetadata(job: Job, patch: Pick<Job, 'company_name' | 'stock_code' | 'report_year'>) {
    if (!job.report_id) {
      setMessage('当前报告缺少 report_id，无法保存元信息。')
      return
    }
    try {
      await api(`/reports/${encodeURIComponent(job.report_id)}/metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: patch.company_name || '',
          stock_code: patch.stock_code || '',
          report_year: patch.report_year || '',
        }),
      })
      setMessage('报告元信息已保存，可用于报告对比。')
      await refreshJobs()
    } catch (error) {
      setMessage(`保存元信息失败：${formatApiError(error)}`)
    }
  }

  async function saveReview(fieldKey: string, patch: ReviewRecord) {
    const row = results.find((item) => item.field_key === fieldKey)
    if (!row || !selectedJobId) return
    await api(`/jobs/${selectedJobId}/reviews/${encodeURIComponent(fieldKey)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: patch.status,
        value: patch.value ?? row.review?.value ?? row.value,
        unit: patch.unit ?? row.review?.unit ?? row.unit,
        year: patch.year ?? row.review?.year ?? row.year,
        evidence: patch.evidence ?? row.review?.evidence ?? row.evidence,
        reviewer_note: patch.reviewer_note ?? row.review?.reviewer_note ?? '',
      }),
    })
    const fresh = await api<ResultRow[]>(`/jobs/${selectedJobId}/results`)
    setResults(fresh || [])
    const next = fresh.find((item) => reviewStatus(item) === 'pending' && item.field_key !== fieldKey)
    if (next) {
      setSelectedField(next.field_key)
      setResultFilter('pending')
    }
    setMessage('已保存复核结果。')
  }

  const stats = useMemo(() => {
    const done = jobs.filter((job) => job.status === 'succeeded').length
    const failed = jobs.filter((job) => ['failed', 'skipped'].includes(job.status)).length
    const processing = jobs.filter((job) => ['queued', 'running'].includes(job.status)).length
    const pending = results.filter((row) => reviewStatus(row) === 'pending').length
    const avg = results.length ? Math.round(results.reduce((sum, row) => sum + confidence(row), 0) / results.length) : 0
    const quantitative = results.filter(isQuantitative).length
    return { total: jobs.length, done, failed, processing, pending, avg, quantitative }
  }, [jobs, results])

  const visibleResults = useMemo(() => results.filter((row) => {
    const haystack = `${row.category} ${row.name_cn} ${row.field_key} ${row.evidence} ${displayValue(row)}`.toLowerCase()
    const status = reviewStatus(row)
    return haystack.includes(search.toLowerCase()) && (resultFilter === 'all' || status === resultFilter || (resultFilter === 'low' && confidence(row) < LOW_CONFIDENCE))
  }), [results, search, resultFilter])

  const selectedRow = results.find((row) => row.field_key === selectedField) || visibleResults[0]

  if (!enteredWorkspace) {
    return <LandingPagePolished
      stats={stats}
      upload={upload}
      enterWorkspace={(nextView = 'dashboard') => {
        setEnteredWorkspace(true)
        setView(nextView)
      }}
    />
  }

  return <div className="shell">
    <Topbar view={view} setView={setView} search={search} setSearch={setSearch} />
    <div className="workspace">
      <Sidebar view={view} setView={setView} />
      <main className="main">
        <Header view={view} message={message} upload={upload} />
        <div className="grid">
          {view === 'dashboard' && <>
            <Stats stats={stats} setView={setView} setJobFilter={setJobFilter} setResultFilter={setResultFilter} />
            <Dashboard jobs={jobs} openJob={openJob} />
          </>}
          {view === 'reports' && <Reports jobs={jobs} jobFilter={jobFilter} setJobFilter={setJobFilter} selectedJobId={selectedJobId} openJob={openJob} retry={retry} deleteJob={deleteJob} saveReportMetadata={saveReportMetadata} />}
          {view === 'review' && <Review selectedJob={selectedJob} rows={visibleResults} selectedRow={selectedRow} setSelectedField={setSelectedField} filter={resultFilter} setFilter={setResultFilter} saveReview={saveReview} onBack={() => setView('reports')} />}
          {view === 'compare' && <MetricComparePageV2 />}
          {view === 'export' && <Export jobs={jobs} />}
        </div>
      </main>
    </div>
  </div>
}

function LandingPage({ stats, upload, enterWorkspace }: { stats: ReturnType<typeof useStatsShape>; upload: (files: FileList | null) => void; enterWorkspace: (view?: ViewId) => void }) {
  return <main className="landing-page">
    <section className="landing-hero">
      <div className="landing-copy">
        <p className="eyebrow">ESG 报告多模态智能抽取平台</p>
        <h1>把复杂报告，变成<span>可信赖的数据资产。</span></h1>
        <p>自动解析 PDF 中的文本、表格与证据片段，输出可复核、可追溯、可对比的结构化 ESG 定量指标。</p>
        <div className="actions">
          <input id="landingFileInput" type="file" accept="application/pdf,.pdf" multiple hidden onChange={(event) => upload(event.target.files)} />
          <button className="button primary" onClick={() => document.getElementById('landingFileInput')?.click()}>上传报告</button>
          <button className="button" onClick={() => enterWorkspace('compare')}>查看报告对比</button>
          <button className="button ghost" onClick={() => enterWorkspace('dashboard')}>进入工作台</button>
        </div>
      </div>
      <div className="landing-device" aria-label="ESG Miner 工作台预览">
        <div className="mini-window">
          <div className="window-top"><span /><span /><span /></div>
          <div className="mini-stats">
            <div><strong>{stats.total}</strong><span>历史报告</span></div>
            <div><strong>{stats.quantitative}</strong><span>定量指标</span></div>
            <div><strong>{stats.avg}%</strong><span>平均置信度</span></div>
          </div>
          <div className="mini-bars"><span /><span /><span /></div>
        </div>
      </div>
    </section>
  </main>
}

function LandingPagePolished({ stats, upload, enterWorkspace }: { stats: ReturnType<typeof useStatsShape>; upload: (files: FileList | null) => void; enterWorkspace: (view?: ViewId) => void }) {
  return <main className="landing-page final-landing">
    <div className="landing-logo"><span>ESG</span><span>Miner</span></div>
    <section className="landing-hero">
      <div className="landing-copy polished-copy">
        <h1>{'\u667a\u6790\u4e07\u5377'}</h1>
        <p>{'\u4e0a\u4f20 PDF\uff0c\u5373\u53ef\u6316\u6398\u62a5\u544a\u4e2d\u7684\u6570\u636e\uff0c\u5e76\u8fdb\u884c\u5bf9\u6bd4\u5206\u6790\u3002'}</p>
        <div className="actions">
          <input id="landingFileInputPolished" type="file" accept="application/pdf,.pdf" multiple hidden onChange={(event) => upload(event.target.files)} />
          <button className="button primary" onClick={() => document.getElementById('landingFileInputPolished')?.click()}>{'\u4e0a\u4f20\u62a5\u544a'}</button>
          <button className="button" onClick={() => enterWorkspace('compare')}>{'\u67e5\u770b\u62a5\u544a\u5bf9\u6bd4'}</button>
          <button className="button ghost" onClick={() => enterWorkspace('dashboard')}>{'\u8fdb\u5165\u5de5\u4f5c\u53f0'}</button>
        </div>
      </div>
      <div className="landing-visual polished-visual" aria-label="ESG Miner report intelligence preview">
        <div className="flow-card pdf-card">
          <div className="card-kicker">PDF Report</div>
          <h3>{'ESG \u62a5\u544a'}</h3>
          <span className="doc-line wide" />
          <span className="doc-line" />
          <div className="doc-table">
            <span>{'\u73af\u5883\u6570\u636e\u8868'}</span>
            <strong>{'\u80fd\u6e90\u6d88\u8017'}</strong>
          </div>
        </div>
        <div className="flow-card insight-card">
          <div className="card-kicker">Structured Data</div>
          <h3>{'\u6307\u6807\u62bd\u53d6'}</h3>
          <div className="metric-pill"><span>{'\u78b3\u6392\u653e\u91cf'}</span><strong>{'12.6 \u4e07\u5428'}</strong></div>
          <div className="metric-pill"><span>{'\u5458\u5de5\u4eba\u6570'}</span><strong>{'8,420 \u4eba'}</strong></div>
          <div className="confidence-ring">{stats.avg || 92}%</div>
        </div>
        <div className="flow-card chart-card">
          <div className="card-kicker">Comparison</div>
          <h3>{'\u5bf9\u6bd4\u5206\u6790'}</h3>
          <div className="visual-bars">
            <span style={{ height: '42%' }} />
            <span style={{ height: '72%' }} />
            <span style={{ height: '56%' }} />
            <span style={{ height: '88%' }} />
          </div>
        </div>
      </div>
    </section>
  </main>
}

function LandingPageClean({ stats, upload, enterWorkspace }: { stats: ReturnType<typeof useStatsShape>; upload: (files: FileList | null) => void; enterWorkspace: (view?: ViewId) => void }) {
  return <main className="landing-page">
    <section className="landing-hero">
      <div className="landing-copy">
        <p className="landing-brand">ESG Miner</p>
        <p className="eyebrow">ESG 报告多模态智能抽取平台</p>
        <h1>挖掘报告里的<span>可信数据。</span></h1>
        <p>上传 PDF，自动抽取 ESG 定量指标，并保留证据页码、置信度与对比结果。</p>
        <div className="actions">
          <input id="landingFileInputClean" type="file" accept="application/pdf,.pdf" multiple hidden onChange={(event) => upload(event.target.files)} />
          <button className="button primary" onClick={() => document.getElementById('landingFileInputClean')?.click()}>上传报告</button>
          <button className="button" onClick={() => enterWorkspace('compare')}>查看报告对比</button>
          <button className="button ghost" onClick={() => enterWorkspace('dashboard')}>进入工作台</button>
        </div>
      </div>
      <div className="landing-device" aria-label="ESG Miner 工作台预览">
        <div className="mini-window">
          <div className="window-top"><span /><span /><span /></div>
          <div className="mini-stats">
            <div><strong>{stats.total}</strong><span>历史报告</span></div>
            <div><strong>{stats.quantitative}</strong><span>定量指标</span></div>
            <div><strong>{stats.avg}%</strong><span>平均置信度</span></div>
          </div>
          <div className="mini-bars"><span /><span /><span /></div>
        </div>
      </div>
    </section>
  </main>
}

function LandingPageFinal({ stats, upload, enterWorkspace }: { stats: ReturnType<typeof useStatsShape>; upload: (files: FileList | null) => void; enterWorkspace: (view?: ViewId) => void }) {
  return <main className="landing-page final-landing">
    <div className="landing-logo"><span>ESG</span><span>Miner</span></div>
    <section className="landing-hero">
      <div className="landing-copy">
        <p className="eyebrow">ESG 报告多模态智能抽取平台</p>
        <h1>智析万卷</h1>
        <p>上传 PDF，即可挖掘报告中的数据，并进行对比分析。</p>
        <div className="actions">
          <input id="landingFileInputFinal" type="file" accept="application/pdf,.pdf" multiple hidden onChange={(event) => upload(event.target.files)} />
          <button className="button primary" onClick={() => document.getElementById('landingFileInputFinal')?.click()}>上传报告</button>
          <button className="button" onClick={() => enterWorkspace('compare')}>查看报告对比</button>
          <button className="button ghost" onClick={() => enterWorkspace('dashboard')}>进入工作台</button>
        </div>
      </div>
      <div className="landing-visual" aria-label="ESG Miner 报告抽取流程示意">
        <div className="flow-card pdf-card">
          <div className="card-kicker">PDF Report</div>
          <h3>2024 ESG 报告</h3>
          <span className="doc-line wide" />
          <span className="doc-line" />
          <div className="doc-table">
            <span>环境数据表</span>
            <strong>能源消耗</strong>
          </div>
        </div>
        <div className="flow-arrow">→</div>
        <div className="flow-card insight-card">
          <div className="card-kicker">Structured Data</div>
          <h3>指标抽取</h3>
          <div className="metric-pill"><span>碳排放量</span><strong>12.6 万吨</strong></div>
          <div className="metric-pill"><span>员工人数</span><strong>8,420 人</strong></div>
          <div className="confidence-ring">{stats.avg || 92}%</div>
        </div>
        <div className="flow-card chart-card">
          <div className="card-kicker">Comparison</div>
          <h3>对比分析</h3>
          <div className="visual-bars">
            <span style={{ height: '42%' }} />
            <span style={{ height: '72%' }} />
            <span style={{ height: '56%' }} />
            <span style={{ height: '88%' }} />
          </div>
        </div>
      </div>
    </section>
  </main>
}

function Topbar({ view, setView, search, setSearch }: { view: ViewId; setView: (view: ViewId) => void; search: string; setSearch: (value: string) => void }) {
  return <header className="topbar">
    <div className="brand"><span>ESG</span><span>Miner</span></div>
    <nav className="topnav">{views.map(([id, label]) => <button key={id} className={`nav-btn ${view === id ? 'active' : ''}`} onClick={() => setView(id)}>{label}</button>)}</nav>
    <div className="top-actions">
      <input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索指标、证据、字段" />
      <div className="avatar">ESG</div>
    </div>
  </header>
}

function Sidebar({ view, setView }: { view: ViewId; setView: (view: ViewId) => void }) {
  return <aside className="sidebar">
    <p className="side-label">工作区</p>
    <nav className="side-nav">{views.map(([id, label]) => <button key={id} className={view === id ? 'active' : ''} onClick={() => setView(id)}>{label}</button>)}</nav>
  </aside>
}

function Header({ view, message, upload }: { view: ViewId; message: string; upload: (files: FileList | null) => void }) {
  if (view === 'dashboard') return null
  return <section className="page-header">
    <div>
      <p className="eyebrow">ESG Miner 智能工作台</p>
      <h1>{viewTitles[view]}</h1>
      <p className="subtitle">{message}</p>
    </div>
    <div className="actions">
      <input id="fileInput" type="file" accept="application/pdf,.pdf" multiple hidden onChange={(event) => upload(event.target.files)} />
      <button className="button primary" onClick={() => document.getElementById('fileInput')?.click()}>上传报告</button>
    </div>
  </section>
}

function HeroDashboard({ stats, jobs, upload, openJob, setView }: { stats: ReturnType<typeof useStatsShape>; jobs: Job[]; upload: (files: FileList | null) => void; openJob: (job: Job, nextView?: ViewId) => void; setView: (view: ViewId) => void }) {
  return <>
    <section className="product-hero">
      <div className="hero-copy">
        <p className="eyebrow">ESG 报告多模态智能抽取平台</p>
        <h1>把复杂报告，变成<span>可信赖的数据资产。</span></h1>
        <p>自动解析 PDF 中的文本、表格与证据片段，输出可复核、可追溯、可对比的结构化 ESG 定量指标。</p>
        <div className="actions">
          <input id="heroFileInput" type="file" accept="application/pdf,.pdf" multiple hidden onChange={(event) => upload(event.target.files)} />
          <button className="button primary" onClick={() => document.getElementById('heroFileInput')?.click()}>上传报告</button>
          <button className="button" onClick={() => setView('compare')}>查看报告对比</button>
        </div>
      </div>
      <div className="hero-device">
        <div className="mini-window">
          <div className="window-top"><span /><span /><span /></div>
          <div className="mini-stats">
            <div><strong>{stats.total}</strong><span>历史报告</span></div>
            <div><strong>{stats.quantitative}</strong><span>定量指标</span></div>
            <div><strong>{stats.avg}%</strong><span>平均置信度</span></div>
          </div>
          <div className="mini-bars"><span /><span /><span /></div>
        </div>
      </div>
    </section>
    <Stats stats={stats} setView={setView} setJobFilter={() => {}} setResultFilter={() => {}} />
    <Dashboard jobs={jobs} openJob={openJob} />
  </>
}

function useStatsShape() {
  return { total: 0, done: 0, failed: 0, processing: 0, pending: 0, avg: 0, quantitative: 0 }
}

type AnalysisMode = 'compare' | 'trend'
type CompareKind = 'quantitative' | 'qualitative'

type MetricOption = {
  field_key: string
  name_cn?: string
  category?: string
  indicator_type?: string
}

type CompanyOption = {
  company_name: string
  stock_code?: string
  report_id: string
}

type YearOption = {
  year: string
}

type MetricRow = {
  job_id: string
  report_id: string
  company_name: string
  report_year?: string
  field_key: string
  name_cn?: string
  category?: string
  value?: string
  numeric_value?: number | null
  unit?: string
  normalized_value?: string
  normalized_unit?: string
  data_year?: string
  evidence?: string
  source_page?: string
  confidence?: number
}

function metricRowValue(row: MetricRow): number {
  const numeric = Number(row.numeric_value ?? row.normalized_value ?? row.value)
  if (Number.isFinite(numeric)) return numeric
  const match = String(row.value || row.normalized_value || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function metricValueLabel(row: MetricRow): string {
  return [row.normalized_value || row.value || '-', row.normalized_unit || row.unit || ''].filter(Boolean).join(' ')
}

function MetricComparePage() {
  const [kind, setKind] = useState<CompareKind>('quantitative')
  const [mode, setMode] = useState<AnalysisMode>('compare')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('加载指标选项中...')
  const [years, setYears] = useState<YearOption[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [metrics, setMetrics] = useState<MetricOption[]>([])
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([])
  const [selectedCompany, setSelectedCompany] = useState('')
  const [selectedMetric, setSelectedMetric] = useState('')
  const [rows, setRows] = useState<MetricRow[]>([])
  const chartEl = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  const quantitativeMetrics = useMemo(() => metrics.filter((item) => {
    const type = String(item.indicator_type || '').toLowerCase()
    return type.includes('定量') || type.includes('quant') || type.includes('numeric') || type.includes('数值')
  }), [metrics])

  const selectedMetricLabel = useMemo(() => {
    const metric = quantitativeMetrics.find((item) => item.field_key === selectedMetric)
    return metric?.name_cn || selectedMetric || '指标'
  }, [quantitativeMetrics, selectedMetric])

  const sortedRows = useMemo(() => {
    const copy = [...rows]
    if (mode === 'trend') return copy.sort((a, b) => String(a.report_year || a.data_year).localeCompare(String(b.report_year || b.data_year)))
    return copy.sort((a, b) => metricRowValue(b) - metricRowValue(a))
  }, [mode, rows])

  async function loadOptions() {
    setLoading(true)
    try {
      const data = await api<{ years: YearOption[]; companies: CompanyOption[]; metrics: MetricOption[] }>('/metrics/options')
      const nextYears = data.years || []
      const nextCompanies = data.companies || []
      const nextMetrics = data.metrics || []
      const nextQuantMetrics = nextMetrics.filter((item) => {
        const type = String(item.indicator_type || '').toLowerCase()
        return type.includes('定量') || type.includes('quant') || type.includes('numeric') || type.includes('数值')
      })
      setYears(nextYears)
      setCompanies(nextCompanies)
      setMetrics(nextMetrics)
      setSelectedYear(nextYears[0]?.year || '')
      setSelectedMetric(nextQuantMetrics[0]?.field_key || nextMetrics[0]?.field_key || '')
      setSelectedReportIds(nextCompanies.slice(0, 5).map((item) => item.report_id))
      setSelectedCompany(nextCompanies[0]?.company_name || '')
      setMessage(nextCompanies.length ? '选择年份、企业和指标后查看 ESG 定量指标对比。' : '暂无已完成抽取的报告，请先上传并完成抽取。')
    } catch (error) {
      setMessage(`加载失败：${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  async function loadCompare() {
    if (!selectedMetric) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (selectedYear) params.set('year', selectedYear)
      params.set('field_key', selectedMetric)
      if (selectedReportIds.length) params.set('report_ids', selectedReportIds.join(','))
      const data = await api<{ rows: MetricRow[] }>(`/metrics/compare?${params}`)
      setRows(data.rows || [])
      setMessage(data.rows?.length ? `已加载 ${data.rows.length} 条横向对比数据。` : '当前条件下暂无可对比数据。')
    } catch (error) {
      setMessage(`查询失败：${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  async function loadTrend() {
    if (!selectedMetric || !selectedCompany) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('company_name', selectedCompany)
      params.set('field_key', selectedMetric)
      const data = await api<{ rows: MetricRow[] }>(`/metrics/trend?${params}`)
      setRows(data.rows || [])
      setMessage(data.rows?.length ? `已加载 ${selectedCompany} 的趋势数据。` : '当前企业暂无该指标的多年数据。')
    } catch (error) {
      setMessage(`查询失败：${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  function toggleReport(reportId: string) {
    setSelectedReportIds((current) => current.includes(reportId) ? current.filter((item) => item !== reportId) : [...current, reportId])
  }

  useEffect(() => {
    loadOptions()
  }, [])

  useEffect(() => {
    if (kind !== 'quantitative') return
    if (mode === 'compare') loadCompare()
    else loadTrend()
  }, [kind, mode, selectedYear, selectedMetric, selectedReportIds, selectedCompany])

  useEffect(() => {
    if (!chartEl.current || kind !== 'quantitative') return
    chartRef.current ||= echarts.init(chartEl.current)
    const unit = rows.find((row) => row.normalized_unit || row.unit)?.normalized_unit || rows.find((row) => row.unit)?.unit || ''
    const labels = sortedRows.map((row) => mode === 'trend' ? String(row.report_year || row.data_year || '-') : row.company_name)
    const values = sortedRows.map(metricRowValue)
    chartRef.current.setOption({
      color: ['#0071e3', '#18a96b', '#b7791f'],
      tooltip: {
        trigger: 'axis',
        formatter(params: unknown) {
          const item = Array.isArray(params) ? params[0] as { dataIndex: number; value: number } : { dataIndex: 0, value: 0 }
          const row = sortedRows[item.dataIndex]
          return `<strong>${row?.company_name || ''}</strong><br/>${selectedMetricLabel}: ${item.value} ${unit}<br/>年份: ${row?.report_year || row?.data_year || '-'}<br/>页码: ${row?.source_page || '-'}`
        }
      },
      grid: { left: 58, right: 24, top: 48, bottom: 72 },
      xAxis: { type: 'category', data: labels, axisLabel: { rotate: labels.length > 4 ? 28 : 0 } },
      yAxis: { type: 'value', name: unit },
      series: [{
        name: selectedMetricLabel,
        type: mode === 'trend' ? 'line' : 'bar',
        smooth: mode === 'trend',
        data: values,
        barMaxWidth: 48,
        areaStyle: mode === 'trend' ? { opacity: 0.12 } : undefined
      }]
    })
  }, [kind, mode, rows, selectedMetricLabel, sortedRows])

  useEffect(() => {
    function resize() {
      chartRef.current?.resize()
    }
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  return <section className="metric-compare-page">
    <div className="compare-page-tabs">
      <button className={kind === 'quantitative' ? 'active' : ''} onClick={() => setKind('quantitative')}>定量指标对比</button>
      <button className={kind === 'qualitative' ? 'active' : ''} onClick={() => setKind('qualitative')}>定性证据对比</button>
    </div>

    {kind === 'qualitative' ? <div className="panel qualitative-placeholder">
      <p className="eyebrow">定性证据对比</p>
      <h2>定性指标不进入数值图表。</h2>
      <p>后续这里适合做证据卡片并排展示：指标名称、报告/企业、抽取文本、证据页码、置信度和复核状态。当前先保留为独立入口，避免和定量 ECharts 混在一起。</p>
    </div> : <section className="metric-compare-workspace">
      <aside className="panel metric-filter-panel">
        <div className="mode-switch">
          <button className={mode === 'compare' ? 'active' : ''} onClick={() => setMode('compare')}>不同报告对比</button>
          <button className={mode === 'trend' ? 'active' : ''} onClick={() => setMode('trend')}>同一企业趋势</button>
        </div>

        <div className="field">
          <label>定量指标</label>
          <select value={selectedMetric} onChange={(event) => setSelectedMetric(event.target.value)}>
            {quantitativeMetrics.map((metric) => <option key={metric.field_key} value={metric.field_key}>{metric.name_cn || metric.field_key}</option>)}
          </select>
        </div>

        {mode === 'compare' ? <>
          <div className="field">
            <label>年份</label>
            <select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}>
              <option value="">全部年份</option>
              {years.map((year) => <option key={year.year} value={year.year}>{year.year}</option>)}
            </select>
          </div>
          <div className="field">
            <label>企业 / 报告</label>
            <div className="report-picker compact">
              {companies.map((company) => <label key={company.report_id} className={`report-option ${selectedReportIds.includes(company.report_id) ? 'active' : ''}`}>
                <input type="checkbox" checked={selectedReportIds.includes(company.report_id)} onChange={() => toggleReport(company.report_id)} />
                <span><strong>{company.company_name}</strong><small>{company.stock_code || company.report_id.slice(0, 10)}</small></span>
              </label>)}
            </div>
          </div>
        </> : <div className="field">
          <label>企业</label>
          <select value={selectedCompany} onChange={(event) => setSelectedCompany(event.target.value)}>
            {companies.map((company) => <option key={company.report_id} value={company.company_name}>{company.company_name}</option>)}
          </select>
        </div>}
      </aside>

      <section className="panel metric-content-panel">
        <div className="panel-header">
          <div><h2 className="panel-title">{mode === 'compare' ? '不同报告定量对比' : '同一企业趋势分析'}</h2><p className="panel-subtitle">{message}</p></div>
          <span className="badge neutral">{loading ? '加载中' : `${rows.length} 条数据`}</span>
        </div>
        <div ref={chartEl} className="metric-chart" />
        <div className="table-wrap">
          <table>
            <thead><tr><th>企业</th><th>年份</th><th>指标值</th><th>置信度</th><th>证据</th></tr></thead>
            <tbody>
              {sortedRows.map((row) => <tr key={`${row.job_id}-${row.field_key}-${row.report_id}`}>
                <td>{row.company_name}</td>
                <td>{row.report_year || row.data_year || '-'}</td>
                <td><strong>{metricValueLabel(row)}</strong></td>
                <td>{Math.round(Number(row.confidence || 0) <= 1 ? Number(row.confidence || 0) * 100 : Number(row.confidence || 0))}%</td>
                <td><span className="page">第 {row.source_page || '-'} 页</span><p>{row.evidence || '暂无证据文本'}</p></td>
              </tr>)}
              {!sortedRows.length && <tr><td colSpan={5} className="empty">暂无数据，请调整筛选条件或先完成报告抽取。</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </section>}
  </section>
}

function isQuantitativeMetric(metric?: MetricOption): boolean {
  const type = String(metric?.indicator_type || '').toLowerCase()
  return type.includes('定量') || type.includes('quant') || type.includes('numeric') || type.includes('数值')
}

function MetricComparePageV2() {
  const [kind, setKind] = useState<CompareKind>('quantitative')
  const [mode, setMode] = useState<AnalysisMode>('compare')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('请选择报告和指标后开始对比。')
  const [years, setYears] = useState<YearOption[]>([])
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [metrics, setMetrics] = useState<MetricOption[]>([])
  const [selectedYear, setSelectedYear] = useState('')
  const [selectedReportIds, setSelectedReportIds] = useState<string[]>([])
  const [selectedCompany, setSelectedCompany] = useState('')
  const [selectedMetric, setSelectedMetric] = useState('')
  const [rows, setRows] = useState<MetricRow[]>([])
  const [resultOpen, setResultOpen] = useState(false)
  const chartEl = useRef<HTMLDivElement | null>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  const quantitativeMetrics = useMemo(() => metrics.filter(isQuantitativeMetric), [metrics])
  const qualitativeMetrics = useMemo(() => metrics.filter((metric) => !isQuantitativeMetric(metric)), [metrics])
  const availableMetrics = kind === 'quantitative' ? quantitativeMetrics : qualitativeMetrics
  const activeMetric = availableMetrics.find((metric) => metric.field_key === selectedMetric)
  const sortedRows = useMemo(() => {
    const copy = [...rows]
    if (mode === 'trend') return copy.sort((a, b) => String(a.report_year || a.data_year).localeCompare(String(b.report_year || b.data_year)))
    return copy.sort((a, b) => metricRowValue(b) - metricRowValue(a))
  }, [mode, rows])

  async function loadOptions() {
    setLoading(true)
    try {
      const data = await api<{ years: YearOption[]; companies: CompanyOption[]; metrics: MetricOption[] }>('/metrics/options')
      const nextYears = data.years || []
      const nextCompanies = data.companies || []
      const nextMetrics = data.metrics || []
      const nextQuantMetrics = nextMetrics.filter(isQuantitativeMetric)
      setYears(nextYears)
      setCompanies(nextCompanies)
      setMetrics(nextMetrics)
      setSelectedYear(nextYears[0]?.year || '')
      setSelectedReportIds(nextCompanies.slice(0, 2).map((item) => item.report_id))
      setSelectedCompany(nextCompanies[0]?.company_name || '')
      setSelectedMetric(nextQuantMetrics[0]?.field_key || nextMetrics[0]?.field_key || '')
      setMessage(nextCompanies.length ? '请选择报告和指标后开始对比。' : '暂无已完成抽取的报告，请先上传并完成抽取。')
    } catch (error) {
      setMessage(`加载失败：${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadOptions()
  }, [])

  useEffect(() => {
    const nextList = kind === 'quantitative' ? quantitativeMetrics : qualitativeMetrics
    if (!nextList.some((metric) => metric.field_key === selectedMetric)) {
      setSelectedMetric(nextList[0]?.field_key || '')
    }
    setRows([])
    setResultOpen(false)
  }, [kind, quantitativeMetrics, qualitativeMetrics])

  function toggleReport(reportId: string) {
    setSelectedReportIds((current) => current.includes(reportId) ? current.filter((item) => item !== reportId) : [...current, reportId])
  }

  async function startCompare() {
    if (!selectedMetric) {
      setMessage('请先选择一个指标。')
      return
    }
    if (mode === 'compare' && selectedReportIds.length < 2) {
      setMessage('请至少选择两份报告再进行对比。')
      return
    }
    if (mode === 'trend' && !selectedCompany) {
      setMessage('请先选择企业。')
      return
    }
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('field_key', selectedMetric)
      if (mode === 'compare') {
        if (selectedYear) params.set('year', selectedYear)
        if (selectedReportIds.length) params.set('report_ids', selectedReportIds.join(','))
        const data = await api<{ rows: MetricRow[] }>(`/metrics/compare?${params}`)
        setRows(data.rows || [])
        setMessage(data.rows?.length ? `已生成 ${data.rows.length} 条对比结果。` : '当前条件下暂无可对比数据。')
      } else {
        params.set('company_name', selectedCompany)
        const data = await api<{ rows: MetricRow[] }>(`/metrics/trend?${params}`)
        setRows(data.rows || [])
        setMessage(data.rows?.length ? `已生成 ${selectedCompany} 的趋势结果。` : '当前企业暂无该指标的多年数据。')
      }
      setResultOpen(true)
    } catch (error) {
      setMessage(`对比失败：${String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!resultOpen || kind !== 'quantitative' || !chartEl.current) return
    chartRef.current ||= echarts.init(chartEl.current)
    const unit = rows.find((row) => row.normalized_unit || row.unit)?.normalized_unit || rows.find((row) => row.unit)?.unit || ''
    const labels = sortedRows.map((row) => mode === 'trend' ? String(row.report_year || row.data_year || '-') : row.company_name)
    const values = sortedRows.map(metricRowValue)
    chartRef.current.setOption({
      color: ['#0071e3', '#18a96b', '#b7791f'],
      tooltip: {
        trigger: 'axis',
        formatter(params: unknown) {
          const item = Array.isArray(params) ? params[0] as { dataIndex: number; value: number } : { dataIndex: 0, value: 0 }
          const row = sortedRows[item.dataIndex]
          return `<strong>${row?.company_name || ''}</strong><br/>${activeMetric?.name_cn || selectedMetric}: ${item.value} ${unit}<br/>年份: ${row?.report_year || row?.data_year || '-'}<br/>页码: ${row?.source_page || '-'}`
        }
      },
      grid: { left: 58, right: 28, top: 48, bottom: 72 },
      xAxis: { type: 'category', data: labels, axisLabel: { rotate: labels.length > 4 ? 28 : 0 } },
      yAxis: { type: 'value', name: unit },
      series: [{
        name: activeMetric?.name_cn || selectedMetric,
        type: mode === 'trend' ? 'line' : 'bar',
        smooth: mode === 'trend',
        data: values,
        barMaxWidth: 48,
        areaStyle: mode === 'trend' ? { opacity: 0.12 } : undefined
      }]
    })
    window.setTimeout(() => chartRef.current?.resize(), 0)
  }, [resultOpen, kind, mode, rows, sortedRows, activeMetric?.name_cn, selectedMetric])

  useEffect(() => {
    function resize() {
      chartRef.current?.resize()
    }
    window.addEventListener('resize', resize)
    return () => {
      window.removeEventListener('resize', resize)
      chartRef.current?.dispose()
      chartRef.current = null
    }
  }, [])

  return <section className="metric-compare-page">
    <div className="compare-page-tabs">
      <button className={kind === 'quantitative' ? 'active' : ''} onClick={() => setKind('quantitative')}>定量指标对比</button>
      <button className={kind === 'qualitative' ? 'active' : ''} onClick={() => setKind('qualitative')}>定性证据对比</button>
    </div>

    <section className="metric-compare-workspace">
      <aside className="panel metric-filter-panel">
        <div className="mode-switch">
          <button className={mode === 'compare' ? 'active' : ''} onClick={() => setMode('compare')}>不同报告对比</button>
          <button className={mode === 'trend' ? 'active' : ''} onClick={() => setMode('trend')}>同一企业趋势</button>
        </div>

        <div className="field">
          <label>{kind === 'quantitative' ? '定量指标' : '定性指标'}</label>
          <select value={selectedMetric} onChange={(event) => setSelectedMetric(event.target.value)}>
            {availableMetrics.map((metric) => <option key={metric.field_key} value={metric.field_key}>{metric.name_cn || metric.field_key}</option>)}
          </select>
        </div>

        {mode === 'compare' ? <>
          <div className="field">
            <label>年份</label>
            <select value={selectedYear} onChange={(event) => setSelectedYear(event.target.value)}>
              <option value="">全部年份</option>
              {years.map((year) => <option key={year.year} value={year.year}>{year.year}</option>)}
            </select>
          </div>
          <div className="field">
            <label>选择报告</label>
            <div className="report-picker compact">
              {companies.map((company) => <label key={company.report_id} className={`report-option ${selectedReportIds.includes(company.report_id) ? 'active' : ''}`}>
                <input type="checkbox" checked={selectedReportIds.includes(company.report_id)} onChange={() => toggleReport(company.report_id)} />
                <span><strong>{company.company_name}</strong><small>{company.stock_code || company.report_id.slice(0, 10)}</small></span>
              </label>)}
            </div>
          </div>
        </> : <div className="field">
          <label>企业</label>
          <select value={selectedCompany} onChange={(event) => setSelectedCompany(event.target.value)}>
            {companies.map((company) => <option key={company.report_id} value={company.company_name}>{company.company_name}</option>)}
          </select>
        </div>}

        <button className="button primary compare-start" disabled={loading} onClick={startCompare}>{loading ? '生成中...' : '开始对比'}</button>
        <p className="compare-hint">{message}</p>
      </aside>

      <section className="panel compare-preview-panel">
        <p className="eyebrow">{kind === 'quantitative' ? 'ECharts 可视化结果' : '证据卡片结果'}</p>
        <h2>{kind === 'quantitative' ? '选择报告和指标后，点击开始对比生成可视化。' : '选择报告和定性指标后，点击开始对比生成证据对照。'}</h2>
        <p>{kind === 'quantitative' ? '结果会在弹窗中展示图表、明细表和证据来源。' : '定性指标不进入数值图表，会以报告证据卡片的方式并排展示。'}</p>
      </section>
    </section>

    {resultOpen && <div className="compare-modal-backdrop" onMouseDown={() => setResultOpen(false)}>
      <section className="compare-result-modal" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <div>
            <span className="badge neutral">{kind === 'quantitative' ? '定量对比' : '定性证据'}</span>
            <h2>{activeMetric?.name_cn || selectedMetric || '指标对比'}</h2>
            <p>{mode === 'compare' ? `已选择 ${selectedReportIds.length} 份报告` : selectedCompany}</p>
          </div>
          <button className="close-button" onClick={() => setResultOpen(false)} aria-label="关闭">×</button>
        </div>
        {kind === 'quantitative' ? <>
          <div ref={chartEl} className="metric-chart modal-chart" />
          <MetricRowsTable rows={sortedRows} />
        </> : <QualitativeEvidenceCards rows={sortedRows} />}
      </section>
    </div>}
  </section>
}

function MetricRowsTable({ rows }: { rows: MetricRow[] }) {
  return <div className="table-wrap modal-table">
    <table>
      <thead><tr><th>企业</th><th>年份</th><th>指标值</th><th>置信度</th><th>证据</th></tr></thead>
      <tbody>
        {rows.map((row) => <tr key={`${row.job_id}-${row.field_key}-${row.report_id}`}>
          <td>{row.company_name}</td>
          <td>{row.report_year || row.data_year || '-'}</td>
          <td><strong>{metricValueLabel(row)}</strong></td>
          <td>{Math.round(Number(row.confidence || 0) <= 1 ? Number(row.confidence || 0) * 100 : Number(row.confidence || 0))}%</td>
          <td><span className="page">第 {row.source_page || '-'} 页</span><p>{row.evidence || '暂无证据文本'}</p></td>
        </tr>)}
        {!rows.length && <tr><td colSpan={5} className="empty">暂无数据，请调整筛选条件或先完成报告抽取。</td></tr>}
      </tbody>
    </table>
  </div>
}

function QualitativeEvidenceCards({ rows }: { rows: MetricRow[] }) {
  if (!rows.length) return <div className="empty">暂无定性证据，请调整筛选条件或先完成报告抽取。</div>
  return <div className="qualitative-card-grid">
    {rows.map((row) => <article className="evidence-card" key={`${row.job_id}-${row.field_key}-${row.report_id}`}>
      <div><span className="badge neutral">{row.report_year || row.data_year || '-'}</span></div>
      <h3>{row.company_name}</h3>
      <p>{row.evidence || row.value || '暂无证据文本'}</p>
      <footer><span>第 {row.source_page || '-'} 页</span><span>置信度 {Math.round(Number(row.confidence || 0) <= 1 ? Number(row.confidence || 0) * 100 : Number(row.confidence || 0))}%</span></footer>
    </article>)}
  </div>
}

function Stats({ stats, setView, setJobFilter, setResultFilter }: { stats: ReturnType<typeof useStatsShape>; setView: (view: ViewId) => void; setJobFilter: (filter: string) => void; setResultFilter: (filter: string) => void }) {
  return <section className="stats">
    <Stat title="处理中" value={stats.processing} note="查看排队 / 运行任务" onClick={() => { setJobFilter('running'); setView('reports') }} />
    <Stat title="历史报告" value={stats.total} note="查看全部上传记录" onClick={() => { setJobFilter('all'); setView('reports') }} />
    <Stat title="已完成" value={stats.done} note="可复核 / 可导出 / 可对比" onClick={() => { setJobFilter('succeeded'); setView('reports') }} />
    <Stat title="待复核" value={stats.pending} note={`平均置信度 ${stats.avg}%`} onClick={() => { setResultFilter('pending'); setView('review') }} />
  </section>
}

function Stat({ title, value, note, onClick }: { title: string; value: number; note: string; onClick: () => void }) {
  return <article className="card stat-card" onClick={onClick}>
    <div className="stat-top"><span>{title}</span><span className="badge neutral">实时</span></div>
    <div className="stat-value">{value}</div>
    <button className="stat-link">{note}</button>
  </article>
}

function Dashboard({ jobs, openJob }: { jobs: Job[]; openJob: (job: Job, nextView?: ViewId) => void }) {
  return <div className="panel">
    <div className="panel-header"><div><h2 className="panel-title">最近报告</h2><p className="panel-subtitle">点击任意报告可进入结果复核。</p></div></div>
    <JobTable jobs={jobs.slice(0, 8)} onOpen={openJob} />
  </div>
}

function Reports(props: { jobs: Job[]; jobFilter: string; setJobFilter: (filter: string) => void; selectedJobId: string; openJob: (job: Job, nextView?: ViewId) => void; retry: (jobId: string) => void; deleteJob: (jobId: string) => void; saveReportMetadata: (job: Job, patch: Pick<Job, 'company_name' | 'stock_code' | 'report_year'>) => Promise<void> }) {
  const filtered = props.jobs.filter((job) => {
    if (props.jobFilter === 'all') return true
    if (props.jobFilter === 'running') return ['queued', 'running'].includes(job.status)
    if (props.jobFilter === 'failed') return ['failed', 'skipped'].includes(job.status)
    return job.status === props.jobFilter
  })
  return <div className="panel">
    <div className="panel-header"><div><h2 className="panel-title">历史报告列表</h2><p className="panel-subtitle">每份上传报告都会保留任务、状态、结果和复核记录。</p></div></div>
    <div className="filters">{[['all', '全部'], ['running', '处理中'], ['succeeded', '已完成'], ['failed', '异常/筛选']].map(([id, label]) => <button key={id} className={`chip ${props.jobFilter === id ? 'active' : ''}`} onClick={() => props.setJobFilter(id)}>{label}</button>)}</div>
    <JobTable jobs={filtered} selectedJobId={props.selectedJobId} onOpen={props.openJob} retry={props.retry} deleteJob={props.deleteJob} saveReportMetadata={props.saveReportMetadata} />
  </div>
}

function JobTable({ jobs, selectedJobId, onOpen, retry, deleteJob, saveReportMetadata }: { jobs: Job[]; selectedJobId?: string; onOpen: (job: Job, nextView?: ViewId) => void; retry?: (jobId: string) => void; deleteJob?: (jobId: string) => void; saveReportMetadata?: (job: Job, patch: Pick<Job, 'company_name' | 'stock_code' | 'report_year'>) => Promise<void> }) {
  if (!jobs.length) return <div className="empty">暂无符合条件的历史任务。</div>
  return <div className="table-wrap"><table>
    <thead><tr><th>报告</th><th>状态</th><th>模式</th><th>运行耗时</th><th>更新时间</th><th>原因</th><th>操作</th></tr></thead>
    <tbody>{jobs.map((job) => <tr key={job.job_id} className={selectedJobId === job.job_id ? 'selected' : ''} onClick={() => onOpen(job)}>
      <td><button className="table-link" onClick={(event) => { event.stopPropagation(); onOpen(job) }}><span className="strong" title={fileName(job)}>{reportTitle(job)}</span><span className="muted">{job.job_id.slice(0, 10)}</span></button></td>
      <td><Badge status={job.status} /></td>
      <td>{job.mode}</td>
      <td>{jobDuration(job)}</td>
      <td>{fmtDate(job.updated_at)}</td>
      <td>{translateReason(job.error || job.summary?.reason) || '-'}</td>
      <td><div className="actions">
        <button className="button" onClick={(event) => { event.stopPropagation(); onOpen(job) }}>查看结果</button>
        {retry && <button className="button" disabled={job.status === 'running'} onClick={(event) => { event.stopPropagation(); retry(job.job_id) }}>重跑</button>}
        {deleteJob && <button className="button danger" disabled={job.status === 'running'} onClick={(event) => { event.stopPropagation(); deleteJob(job.job_id) }}>删除</button>}
        {saveReportMetadata && <MetadataEditor job={job} saveReportMetadata={saveReportMetadata} />}
      </div></td>
    </tr>)}</tbody>
  </table></div>
}

function MetadataEditor({ job, saveReportMetadata }: { job: Job; saveReportMetadata: (job: Job, patch: Pick<Job, 'company_name' | 'stock_code' | 'report_year'>) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const inferred = inferMetadata(job)
  const [companyName, setCompanyName] = useState(inferred.company_name || '')
  const [stockCode, setStockCode] = useState(inferred.stock_code || '')
  const [reportYear, setReportYear] = useState(inferred.report_year || '')

  useEffect(() => {
    const next = inferMetadata(job)
    setCompanyName(next.company_name || '')
    setStockCode(next.stock_code || '')
    setReportYear(next.report_year || '')
  }, [job])

  if (!open) return <button className="button" onClick={(event) => { event.stopPropagation(); setOpen(true) }}>元信息</button>
  return <div className="metadata-editor" onClick={(event) => event.stopPropagation()}>
    <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} placeholder="公司名" />
    <input value={reportYear} onChange={(event) => setReportYear(event.target.value)} placeholder="年份" />
    <input value={stockCode} onChange={(event) => setStockCode(event.target.value)} placeholder="股票代码" />
    <button className="button primary" onClick={() => saveReportMetadata(job, { company_name: companyName, stock_code: stockCode, report_year: reportYear }).then(() => setOpen(false))}>保存</button>
    <button className="button" onClick={() => setOpen(false)}>取消</button>
  </div>
}

function Review(props: { selectedJob?: Job; rows: ResultRow[]; selectedRow?: ResultRow; setSelectedField: (field: string) => void; filter: string; setFilter: (filter: string) => void; saveReview: (fieldKey: string, patch: ReviewRecord) => Promise<void>; onBack: () => void }) {
  return <section className="split">
    <div className="panel">
      <div className="panel-header">
        <div><h2 className="panel-title">单报告复核</h2><p className="panel-subtitle">{props.selectedJob ? fileName(props.selectedJob) : '请选择报告'}。确认或驳回后会自动进入下一条待复核记录。</p></div>
        <button className="button" onClick={props.onBack}>返回报告管理</button>
      </div>
      <div className="filters">{[['all', '全部'], ['pending', '待复核'], ['approved', '已确认'], ['rejected', '已驳回'], ['low', '低置信度']].map(([id, label]) => <button key={id} className={`chip ${props.filter === id ? 'active' : ''}`} onClick={() => props.setFilter(id)}>{label}</button>)}</div>
      <ResultTable rows={props.rows} selectedRow={props.selectedRow} setSelectedField={props.setSelectedField} />
    </div>
    <Evidence row={props.selectedRow} saveReview={props.saveReview} />
  </section>
}

function ResultTable({ rows, selectedRow, setSelectedField }: { rows: ResultRow[]; selectedRow?: ResultRow; setSelectedField: (field: string) => void }) {
  if (!rows.length) return <div className="empty">当前报告暂无可展示结果。</div>
  return <div className="table-wrap"><table>
    <thead><tr><th>维度</th><th>指标</th><th>抽取值</th><th>置信度</th><th>复核状态</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={row.field_key} className={selectedRow?.field_key === row.field_key ? 'selected' : ''} onClick={() => setSelectedField(row.field_key)}>
      <td><span className="badge neutral">{row.category || '-'}</span></td>
      <td><div className="strong">{row.name_cn || row.field_key}</div><div className="muted">{row.indicator_type}</div></td>
      <td>{displayValue(row)}</td>
      <td><span className="confidence"><span className={`meter ${confidence(row) < LOW_CONFIDENCE ? 'warn' : ''}`}><span style={{ width: `${confidence(row)}%` }} /></span>{confidence(row)}%</span></td>
      <td><Badge status={reviewStatus(row)} /></td>
    </tr>)}</tbody>
  </table></div>
}

function Evidence({ row, saveReview }: { row?: ResultRow; saveReview: (fieldKey: string, patch: ReviewRecord) => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<ReviewRecord>({})
  useEffect(() => { setEditing(false); setDraft({}) }, [row?.field_key])
  if (!row) return <aside className="panel evidence"><div className="evidence-body muted">请选择一条字段记录。</div></aside>
  const value = draft.value ?? row.review?.value ?? row.value ?? ''
  const unit = draft.unit ?? row.review?.unit ?? row.unit ?? ''
  const year = draft.year ?? row.review?.year ?? row.year ?? ''
  const evidence = draft.evidence ?? row.review?.evidence ?? row.evidence ?? ''

  return <aside className="panel evidence">
    <div className="panel-header"><div><h2 className="panel-title">证据预览</h2><p className="panel-subtitle">{row.field_key}</p></div></div>
    <div className="evidence-body">
      <p className="detail-kicker">{row.category} - {row.indicator_type}</p>
      <h3 className="detail-title">{row.name_cn}</h3>
      <p className="detail-meta"><Badge status={reviewStatus(row)} /><span>来源：{row.source_page ? `第 ${row.source_page} 页` : row.source_chunk_id || '-'}</span></p>
      <div className="value-box"><span className="detail-kicker">抽取值</span><span className="extracted-value">{displayValue(row)}</span><span className="detail-meta">年份 {row.year || '-'} / 置信度 {confidence(row)}%</span></div>
      {row.source_text_short && <div className="evidence-block">{row.source_text_short}</div>}
      <div className="evidence-block">{row.evidence || row.reason || '暂无证据'}</div>
      {editing && <div className="form-grid">
        <div className="field"><label>值</label><input value={value || ''} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></div>
        <div className="field"><label>单位</label><input value={unit || ''} onChange={(event) => setDraft({ ...draft, unit: event.target.value })} /></div>
        <div className="field"><label>年份</label><input value={year || ''} onChange={(event) => setDraft({ ...draft, year: event.target.value })} /></div>
        <div className="field"><label>证据</label><textarea rows={4} value={evidence || ''} onChange={(event) => setDraft({ ...draft, evidence: event.target.value })} /></div>
      </div>}
      <div className="actions" style={{ marginTop: 16 }}>
        <button className="button primary" onClick={() => saveReview(row.field_key, { status: 'approved' })}>确认</button>
        <button className="button" onClick={() => editing ? saveReview(row.field_key, { status: 'edited', value, unit, year, evidence }) : setEditing(true)}>{editing ? '保存修改' : '编辑'}</button>
        <button className="button danger" onClick={() => saveReview(row.field_key, { status: 'rejected' })}>驳回</button>
      </div>
    </div>
  </aside>
}

function Compare({ jobs, currentJob, currentRows }: { jobs: Job[]; currentJob?: Job; currentRows: ResultRow[] }) {
  const completedJobs = jobs.filter((job) => job.status === 'succeeded')
  const [mode, setMode] = useState<CompareMode>('single')
  const [selectedIds, setSelectedIds] = useState<string[]>(currentJob?.job_id ? [currentJob.job_id] : [])
  const [resultMap, setResultMap] = useState<Record<string, ResultRow[]>>({})
  const [activeDimension, setActiveDimension] = useState('E')
  const [activeFieldKey, setActiveFieldKey] = useState('')
  const [indicatorQuery, setIndicatorQuery] = useState('')

  useEffect(() => {
    if (currentJob?.job_id && currentRows.length) {
      setResultMap((current) => ({ ...current, [currentJob.job_id]: currentRows }))
      if (!selectedIds.length) setSelectedIds([currentJob.job_id])
    }
  }, [currentJob?.job_id, currentRows])

  useEffect(() => {
    const missing = selectedIds.filter((id) => !resultMap[id])
    if (!missing.length) return
    let cancelled = false
    Promise.all(missing.map(async (id) => [id, await api<ResultRow[]>(`/jobs/${id}/results`)] as const))
      .then((entries) => {
        if (!cancelled) setResultMap((current) => ({ ...current, ...Object.fromEntries(entries) }))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [selectedIds, resultMap])

  function toggleJob(jobId: string) {
    setSelectedIds((current) => {
      if (mode === 'single') return [jobId]
      return current.includes(jobId) ? current.filter((id) => id !== jobId) : [...current, jobId]
    })
  }

  const selectedJobs = completedJobs.filter((job) => selectedIds.includes(job.job_id))
  const selectedRows = selectedIds.flatMap((id) => resultMap[id] || []).filter(isQuantitative)
  const allFields = Array.from(new Map(selectedRows.map((row) => [row.field_key, row] as const)).values())
  const fields = allFields
    .filter((field) => dimensionKey(field.category) === activeDimension)
    .filter((field) => `${field.name_cn || ''} ${field.field_key}`.toLowerCase().includes(indicatorQuery.toLowerCase()))
  const activeField = fields.find((row) => row.field_key === activeFieldKey)

  return <section className="analysis-embed">
    <div className="panel analysis-launch-panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">报告对比可视化</h2>
          <p className="panel-subtitle">这里使用已有分析页，保留你已经完成的企业横向对比、趋势分析和 ECharts 可视化。</p>
        </div>
        <button className="button primary" onClick={() => { window.location.href = '/analysis/' }}>打开完整分析页</button>
      </div>
      <div className="analysis-launch">
        <p className="eyebrow">已有可视化模块</p>
        <h3>进入 ESG 定量指标分析页</h3>
        <p>报告对比页面不再重复绘制临时图表，点击下方按钮进入你已有的分析页查看正式可视化结果。</p>
        <button className="button primary" onClick={() => { window.location.href = '/analysis/' }}>进入分析页</button>
      </div>
    </div>
  </section>

  return <section className="compare-workspace">
    <div className="panel compare-selector">
      <div className="panel-header"><div><h2 className="panel-title">选择报告</h2><p className="panel-subtitle">报告对比只展示定量指标，定性指标保留在结果复核中。</p></div><span className="badge neutral">已选 {selectedIds.length}</span></div>
      <div className="filters">
        <button className={`chip ${mode === 'single' ? 'active' : ''}`} onClick={() => { setMode('single'); setSelectedIds(selectedIds.slice(0, 1)); setActiveFieldKey('') }}>同一报告</button>
        <button className={`chip ${mode === 'multi' ? 'active' : ''}`} onClick={() => { setMode('multi'); setActiveFieldKey('') }}>不同报告</button>
      </div>
      <div className="report-picker">
        {completedJobs.length ? completedJobs.map((job) => <label key={job.job_id} className={`report-option ${selectedIds.includes(job.job_id) ? 'active' : ''}`}>
          <input type={mode === 'single' ? 'radio' : 'checkbox'} checked={selectedIds.includes(job.job_id)} onChange={() => toggleJob(job.job_id)} />
          <span><strong title={fileName(job)}>{reportTitle(job)}</strong><small>{fmtDate(job.updated_at)} · {job.job_id.slice(0, 10)}</small></span>
        </label>) : <div className="empty">暂无已完成报告。请先上传并完成抽取。</div>}
      </div>
    </div>
    <div className="compare-main">
      <div className="panel">
        <div className="panel-header compare-toolbar">
          <div><h2 className="panel-title">{mode === 'single' ? '同一报告定量指标' : '不同报告定量指标'}</h2><p className="panel-subtitle">先选择 E / S / G 维度，再选择一个定量指标查看对比矩阵。</p></div>
          <div className="compare-controls"><input value={indicatorQuery} onChange={(event) => setIndicatorQuery(event.target.value)} placeholder="筛选指标" /></div>
        </div>
        <DimensionBrowser activeDimension={activeDimension} setDimension={(next) => { setActiveDimension(next); setActiveFieldKey('') }} fields={fields} allFields={allFields} openField={setActiveFieldKey} />
        {activeField ? <CompareMatrix field={activeField} jobs={selectedJobs} resultMap={resultMap} /> : <div className="empty">请选择一个定量指标进行对比。</div>}
      </div>
    </div>
  </section>
}

function DimensionBrowser({ activeDimension, setDimension, fields, allFields, openField }: { activeDimension: string; setDimension: (dimension: string) => void; fields: ResultRow[]; allFields: ResultRow[]; openField: (fieldKey: string) => void }) {
  const dimensions = [['E', '环境'], ['S', '社会'], ['G', '治理']]
  return <div className="dimension-browser">
    <div className="dimension-tabs">
      {dimensions.map(([key, label]) => <button key={key} className={`dimension-tab ${activeDimension === key ? 'active' : ''}`} onClick={() => setDimension(key)}>
        <span>{key} · {label}</span>
        <strong>{allFields.filter((field) => dimensionKey(field.category) === key).length}</strong>
      </button>)}
    </div>
    <div className="indicator-list">
      {fields.length ? fields.map((field) => <button key={field.field_key} className="indicator-item" onClick={() => openField(field.field_key)}>
        <span className="badge neutral">{activeDimension}</span>
        <strong>{field.name_cn || field.field_key}</strong>
        <small>{field.field_key}</small>
      </button>) : <div className="empty">请先选择报告，或当前维度没有可对比的定量指标。</div>}
    </div>
  </div>
}

function CompareChart({ field, jobs, resultMap }: { field: ResultRow; jobs: Job[]; resultMap: Record<string, ResultRow[]> }) {
  const points = jobs.map((job) => {
    const row = (resultMap[job.job_id] || []).find((item) => item.field_key === field.field_key && isQuantitative(item))
    return { job, row, value: numericValue(row) }
  })
  const maxValue = Math.max(...points.map((point) => point.value || 0), 1)
  return <div className="compare-visual">
    <div className="compare-visual-head">
      <div>
        <p className="eyebrow">定量指标可视化</p>
        <h3>{field.name_cn || field.field_key}</h3>
      </div>
      <span className="badge neutral">{dimensionKey(field.category)}</span>
    </div>
    <div className="compare-bars">
      {points.map((point) => {
        const width = point.value === null ? 0 : Math.max(4, Math.round((point.value / maxValue) * 100))
        return <div className="compare-bar-row" key={point.job.job_id}>
          <div className="bar-label">
            <strong>{reportTitle(point.job)}</strong>
            <span>{point.row ? displayValue(point.row) : '未抽取'}</span>
          </div>
          <div className="bar-track"><span style={{ width: `${width}%` }} /></div>
          <div className="bar-confidence">{point.row ? `${confidence(point.row)}%` : '-'}</div>
        </div>
      })}
    </div>
  </div>
}

function CompareMatrix({ field, jobs, resultMap }: { field?: ResultRow; jobs: Job[]; resultMap: Record<string, ResultRow[]> }) {
  if (!jobs.length) return <div className="empty">请至少选择一份已完成报告。</div>
  if (!field) return <div className="empty">请选择一个指标后再进行对比。</div>
  return <>
  <CompareChart field={field} jobs={jobs} resultMap={resultMap} />
  <div className="table-wrap compare-table"><table>
    <thead><tr><th className="sticky-col">指标</th>{jobs.map((job) => <th key={job.job_id}>{reportTitle(job)}</th>)}</tr></thead>
    <tbody><tr>
      <td className="sticky-col"><span className="badge neutral">{field.category || '-'}</span><div className="strong">{field.name_cn || field.field_key}</div><div className="muted">{field.field_key}</div></td>
      {jobs.map((job) => {
        const row = (resultMap[job.job_id] || []).find((item) => item.field_key === field.field_key && isQuantitative(item))
        return <td key={job.job_id}>{row ? <div className="compare-cell"><strong>{displayValue(row)}</strong><span>{row.year || '-'} · 置信度 {confidence(row)}%</span><Badge status={reviewStatus(row)} /></div> : <span className="muted">未抽取</span>}</td>
      })}
    </tr></tbody>
  </table></div>
  </>
}

function Export({ jobs }: { jobs: Job[] }) {
  return <div className="panel">
    <div className="panel-header"><div><h2 className="panel-title">导出中心</h2><p className="panel-subtitle">每份报告可单独下载复核后的 CSV。</p></div></div>
    <div className="table-wrap"><table>
      <thead><tr><th>报告</th><th>状态</th><th>导出</th></tr></thead>
      <tbody>{jobs.map((job) => <tr key={job.job_id}><td title={fileName(job)}>{reportTitle(job)}</td><td><Badge status={job.status} /></td><td><button className="button" disabled={job.status !== 'succeeded'} onClick={() => window.open(`${API_BASE}/jobs/${job.job_id}/export.csv`, '_blank')}>下载 CSV</button></td></tr>)}</tbody>
    </table></div>
  </div>
}

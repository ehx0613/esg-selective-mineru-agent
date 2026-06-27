<script setup lang="ts">
import * as echarts from 'echarts'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

type Mode = 'compare' | 'trend'

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

const API_BASE = import.meta.env.VITE_API_BASE || ''
const mode = ref<Mode>('compare')
const loading = ref(false)
const message = ref('加载指标选项中...')
const years = ref<YearOption[]>([])
const companies = ref<CompanyOption[]>([])
const metrics = ref<MetricOption[]>([])
const selectedYear = ref('')
const selectedReportIds = ref<string[]>([])
const selectedCompany = ref('')
const selectedMetric = ref('')
const rows = ref<MetricRow[]>([])
const chartEl = ref<HTMLDivElement | null>(null)
let chart: echarts.ECharts | null = null

async function api<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`)
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<T>
}

function rowValue(row: MetricRow): number {
  const numeric = Number(row.numeric_value ?? row.normalized_value ?? row.value)
  if (Number.isFinite(numeric)) return numeric
  const match = String(row.value || row.normalized_value || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/)
  return match ? Number(match[0]) : 0
}

function metricLabel(fieldKey = selectedMetric.value): string {
  const metric = metrics.value.find((item) => item.field_key === fieldKey)
  return metric?.name_cn || fieldKey || '指标'
}

function valueLabel(row: MetricRow): string {
  return [row.normalized_value || row.value || '-', row.normalized_unit || row.unit || ''].filter(Boolean).join(' ')
}

async function loadOptions() {
  loading.value = true
  try {
    const data = await api<{ years: YearOption[]; companies: CompanyOption[]; metrics: MetricOption[] }>('/metrics/options')
    years.value = data.years || []
    companies.value = data.companies || []
    metrics.value = data.metrics || []
    selectedYear.value = years.value[0]?.year || ''
    selectedMetric.value = metrics.value[0]?.field_key || ''
    selectedReportIds.value = companies.value.slice(0, 5).map((item) => item.report_id)
    selectedCompany.value = companies.value[0]?.company_name || ''
    message.value = companies.value.length ? '选择年份、企业和指标后查看 ESG 定量指标对比。' : '暂无已完成抽取的报告，请先在主系统上传并完成抽取。'
  } catch (error) {
    message.value = `加载失败：${String(error)}`
  } finally {
    loading.value = false
  }
}

async function loadCompare() {
  if (!selectedMetric.value) return
  loading.value = true
  try {
    const params = new URLSearchParams()
    if (selectedYear.value) params.set('year', selectedYear.value)
    params.set('field_key', selectedMetric.value)
    if (selectedReportIds.value.length) params.set('report_ids', selectedReportIds.value.join(','))
    const data = await api<{ rows: MetricRow[] }>(`/metrics/compare?${params}`)
    rows.value = data.rows || []
    message.value = rows.value.length ? `已加载 ${rows.value.length} 条横向对比数据。` : '当前条件下暂无可对比数据。'
  } catch (error) {
    message.value = `查询失败：${String(error)}`
  } finally {
    loading.value = false
  }
}

async function loadTrend() {
  if (!selectedMetric.value || !selectedCompany.value) return
  loading.value = true
  try {
    const params = new URLSearchParams()
    params.set('company_name', selectedCompany.value)
    params.set('field_key', selectedMetric.value)
    const data = await api<{ rows: MetricRow[] }>(`/metrics/trend?${params}`)
    rows.value = data.rows || []
    message.value = rows.value.length ? `已加载 ${selectedCompany.value} 的趋势数据。` : '当前企业暂无该指标的多年数据。'
  } catch (error) {
    message.value = `查询失败：${String(error)}`
  } finally {
    loading.value = false
  }
}

function toggleReport(reportId: string) {
  selectedReportIds.value = selectedReportIds.value.includes(reportId)
    ? selectedReportIds.value.filter((item) => item !== reportId)
    : [...selectedReportIds.value, reportId]
}

const sortedRows = computed(() => {
  const copy = [...rows.value]
  if (mode.value === 'trend') return copy.sort((a, b) => String(a.report_year || a.data_year).localeCompare(String(b.report_year || b.data_year)))
  return copy.sort((a, b) => rowValue(b) - rowValue(a))
})

function renderChart() {
  if (!chartEl.value) return
  chart ||= echarts.init(chartEl.value)
  const unit = rows.value.find((row) => row.normalized_unit || row.unit)?.normalized_unit || rows.value.find((row) => row.unit)?.unit || ''
  const labels = sortedRows.value.map((row) => mode.value === 'trend' ? String(row.report_year || row.data_year || '-') : row.company_name)
  const values = sortedRows.value.map(rowValue)
  chart.setOption({
    color: ['#2563eb', '#0f766e', '#d97706'],
    tooltip: {
      trigger: 'axis',
      formatter(params: unknown) {
        const item = Array.isArray(params) ? params[0] as { dataIndex: number; value: number } : { dataIndex: 0, value: 0 }
        const row = sortedRows.value[item.dataIndex]
        return `<strong>${row?.company_name || ''}</strong><br/>${metricLabel()}: ${item.value} ${unit}<br/>年份: ${row?.report_year || row?.data_year || '-'}<br/>页码: ${row?.source_page || '-'}`
      }
    },
    grid: { left: 56, right: 24, top: 56, bottom: 72 },
    xAxis: { type: 'category', data: labels, axisLabel: { rotate: labels.length > 4 ? 28 : 0 } },
    yAxis: { type: 'value', name: unit },
    series: [{
      name: metricLabel(),
      type: mode.value === 'trend' ? 'line' : 'bar',
      smooth: mode.value === 'trend',
      data: values,
      barMaxWidth: 48,
      areaStyle: mode.value === 'trend' ? { opacity: 0.12 } : undefined
    }]
  })
}

watch([rows, mode], async () => {
  await nextTick()
  renderChart()
}, { deep: true })

watch([selectedYear, selectedMetric, selectedReportIds], () => {
  if (mode.value === 'compare') loadCompare()
}, { deep: true })

watch([selectedCompany, selectedMetric], () => {
  if (mode.value === 'trend') loadTrend()
})

watch(mode, () => {
  rows.value = []
  if (mode.value === 'compare') loadCompare()
  else loadTrend()
})

function resize() {
  chart?.resize()
}

onMounted(async () => {
  await loadOptions()
  await loadCompare()
  window.addEventListener('resize', resize)
})

onUnmounted(() => {
  window.removeEventListener('resize', resize)
  chart?.dispose()
})
</script>

<template>
  <main class="analysis-shell">
    <header class="hero">
      <div>
        <p class="eyebrow">ESG 指标分析</p>
        <h1>企业横向对比与趋势分析</h1>
        <p>{{ message }}</p>
      </div>
      <a class="back-link" href="/">返回主系统</a>
    </header>

    <section class="mode-tabs" aria-label="分析模式">
      <button :class="{ active: mode === 'compare' }" @click="mode = 'compare'">企业横向对比</button>
      <button :class="{ active: mode === 'trend' }" @click="mode = 'trend'">企业趋势分析</button>
    </section>

    <section class="workspace">
      <aside class="filters-panel">
        <div class="field">
          <label>指标</label>
          <select v-model="selectedMetric">
            <option v-for="metric in metrics" :key="metric.field_key" :value="metric.field_key">
              {{ metric.name_cn || metric.field_key }}
            </option>
          </select>
        </div>

        <template v-if="mode === 'compare'">
          <div class="field">
            <label>年份</label>
            <select v-model="selectedYear">
              <option value="">全部年份</option>
              <option v-for="year in years" :key="year.year" :value="year.year">{{ year.year }}</option>
            </select>
          </div>
          <div class="field">
            <label>企业 / 报告</label>
            <div class="check-list">
              <button
                v-for="company in companies"
                :key="company.report_id"
                :class="{ checked: selectedReportIds.includes(company.report_id) }"
                @click="toggleReport(company.report_id)"
              >
                <strong>{{ company.company_name }}</strong>
                <span>{{ company.stock_code || company.report_id.slice(0, 10) }}</span>
              </button>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="field">
            <label>企业</label>
            <select v-model="selectedCompany">
              <option v-for="company in companies" :key="company.report_id" :value="company.company_name">
                {{ company.company_name }}
              </option>
            </select>
          </div>
        </template>
      </aside>

      <section class="content-panel">
        <div class="panel-title">
          <div>
            <p>{{ mode === 'compare' ? '横向对比' : '年度趋势' }}</p>
            <h2>{{ metricLabel() }}</h2>
          </div>
          <span class="status">{{ loading ? '加载中' : `${rows.length} 条数据` }}</span>
        </div>

        <div ref="chartEl" class="chart"></div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>企业</th>
                <th>年份</th>
                <th>指标值</th>
                <th>置信度</th>
                <th>证据</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in sortedRows" :key="`${row.job_id}-${row.field_key}`">
                <td>{{ row.company_name }}</td>
                <td>{{ row.report_year || row.data_year || '-' }}</td>
                <td><strong>{{ valueLabel(row) }}</strong></td>
                <td>{{ Math.round(Number(row.confidence || 0) <= 1 ? Number(row.confidence || 0) * 100 : Number(row.confidence || 0)) }}%</td>
                <td>
                  <span class="page">第 {{ row.source_page || '-' }} 页</span>
                  <p>{{ row.evidence || '暂无证据文本' }}</p>
                </td>
              </tr>
              <tr v-if="!rows.length">
                <td colspan="5" class="empty">暂无数据，请调整筛选条件或先完成报告抽取。</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  </main>
</template>

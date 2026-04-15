import { createContext, useContext, useState, useCallback } from 'react'

const STORAGE_KEY = 'webnovel_dashboard_locale'

const DEFAULT_LOCALE = 'zh-CN'

export const LOCALES = [
  { code: 'zh-CN', label: '中文' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
]

// ====================================================================
// Dictionary: zh-CN / vi / en
// ====================================================================
const dict = {
  'zh-CN': {
    nav: { dashboard: '数据总览', entities: '设定词典', graph: '关系图谱', chapters: '章节一览', files: '文档浏览', reading: '追读力' },
    live: { connected: '实时同步中', disconnected: '未连接' },
    loading: '加载中…',
    dashboard: {
      title: '数据总览', genre: '未知题材', totalWords: '总字数', target: '目标', chars: '字',
      currentChapter: '当前章节', vol: '卷', protagonist: '主角状态', unknownRealm: '未知境界', notSet: '未设定',
      unresolvedForeshadow: '未回收伏笔', totalForeshadow: '总计', foreshadowUnit: '条伏笔',
      pendingForeshadow: '待回收伏笔 (Top 20)', content: '内容', status: '状态', plantedCh: '埋设章',
      strandTitle: 'Strand Weave 节奏分布',
    },
    entities: {
      title: '设定词典', all: '全部', name: '名称', type: '类型', tier: '层级',
      first: '首现', last: '末现', units: '个实体', currentStatus: '当前状态',
      historyTitle: '状态变化历史', chapter: '章', field: '字段', change: '变化',
    },
    graph: { title: '关系图谱', links: '条引力链接' },
    chapters: {
      title: '章节一览', chapter: '章节', chPrefix: '第', titleCol: '标题',
      wordCount: '字数', location: '地点', characters: '角色', noChapters: '暂无章节数据',
    },
    files: {
      title: '文档浏览', selectFile: '选择左侧文件以预览内容',
      readFailed: '[读取失败]', binaryPreview: '[二进制文件，无法预览]',
    },
    reading: {
      title: '追读力分析', chapterCol: '章节', hookType: '钩子类型', hookStrength: '钩子强度',
      transition: '过渡章', override: 'Override', debtBalance: '债务余额',
      noData: '暂无追读力数据', chapterData: '章数据',
    },
    dataView: {
      title: '全量数据视图', dataSources: '类数据源', totalRecords: '总记录数',
      totalRecordsSub: '当前返回的全部数据行', coveredSources: '已覆盖数据源',
      coveredSub: '有数据的表 / 总表数', reachedCh: '最新章节触达',
      reachedSub: '按可识别 chapter 字段估算', currentView: '当前视图', viewSub: '个数据分组',
    },
    domains: { overview: '总览', core: '基础档案', network: '关系与剧情', quality: '质量审查', ops: 'RAG 与工具' },
    groups: {
      entities: '实体', chapters: '章节', scenes: '场景', aliases: '别名',
      stateChanges: '状态变化', relationships: '关系', relationshipEvents: '关系事件',
      readingPower: '追读力', overrides: 'Override 合约', debts: '追读债务',
      debtEvents: '债务事件', reviewMetrics: '审查指标', invalidFacts: '无效事实',
      checklistScores: '写作清单评分', ragQueries: 'RAG 查询日志', toolStats: '工具调用统计',
    },
    pagination: { prev: '上一页', next: '下一页', page: '第', of: '页', total: '共', items: '条', noData: '暂无数据', unit: '条' },
    entityDetail: { typeLabel: '类型', idLabel: 'ID', descLabel: '描述', currentLabel: '当前状态' },
    filesTree: { folder: '目录' },
    number: { suffix: '万', short: false },
  },
  'vi': {
    nav: { dashboard: 'Tổng Quan Dữ Liệu', entities: 'Từ Điển Thiết Lập', graph: 'Sơ Đồ Quan Hệ', chapters: 'Danh Sách Chương', files: 'Duyệt Tài Liệu', reading: 'Lực Theo Dõi' },
    live: { connected: 'Đồng bộ thời gian thực', disconnected: 'Mất kết nối' },
    loading: 'Đang tải…',
    dashboard: {
      title: 'Tổng Quan Dữ Liệu', genre: 'Thể loại chưa xác định', totalWords: 'Tổng số từ', target: 'Mục tiêu', chars: 'từ',
      currentChapter: 'Chương hiện tại', vol: 'Quyển', protagonist: 'Trạng thái nhân vật chính', unknownRealm: 'Cảnh giới chưa biết', notSet: 'Chưa thiết lập',
      unresolvedForeshadow: 'Phục bút chưa thu hồi', totalForeshadow: 'Tổng cộng', foreshadowUnit: 'phục bút',
      pendingForeshadow: 'Phục bút chờ thu hồi (Top 20)', content: 'Nội dung', status: 'Trạng thái', plantedCh: 'Chương chôn',
      strandTitle: 'Phân bố nhịp Strand Weave',
    },
    entities: {
      title: 'Từ Điển Thiết Lập', all: 'Tất cả', name: 'Tên', type: 'Loại', tier: 'Cấp bậc',
      first: 'Xuất hiện đầu', last: 'Xuất hiện cuối', units: 'thực thể', currentStatus: 'Trạng thái hiện tại',
      historyTitle: 'Lịch sử thay đổi trạng thái', chapter: 'Chương', field: 'Trường', change: 'Thay đổi',
    },
    graph: { title: 'Sơ Đồ Quan Hệ', links: 'liên kết lực hấp dẫn' },
    chapters: {
      title: 'Danh Sách Chương', chapter: 'Chương', chPrefix: 'Chương', titleCol: 'Tiêu đề',
      wordCount: 'Số từ', location: 'Địa điểm', characters: 'Nhân vật', noChapters: 'Chưa có dữ liệu chương',
    },
    files: {
      title: 'Duyệt Tài Liệu', selectFile: 'Chọn tệp bên trái để xem trước',
      readFailed: '[Đọc thất bại]', binaryPreview: '[Tệp nhị phân, không thể xem trước]',
    },
    reading: {
      title: 'Phân Tích Lực Theo Dõi', chapterCol: 'Chương', hookType: 'Loại móc', hookStrength: 'Độ mạnh móc',
      transition: 'Chương chuyển tiếp', override: 'Override', debtBalance: 'Dư nợ',
      noData: 'Chưa có dữ liệu lực theo dõi', chapterData: 'chương dữ liệu',
    },
    dataView: {
      title: 'Chế Độ Xem Dữ Liệu Đầy Đủ', dataSources: 'loại nguồn dữ liệu', totalRecords: 'Tổng số bản ghi',
      totalRecordsSub: 'Tổng hàng dữ liệu trả về hiện tại', coveredSources: 'Nguồn dữ liệu đã phủ',
      coveredSub: 'Bảng có dữ liệu / Tổng số bảng', reachedCh: 'Chương mới nhất đạt',
      reachedSub: 'Ước tính theo trường chapter có thể nhận dạng', currentView: 'Chế độ xem hiện tại', viewSub: 'nhóm dữ liệu',
    },
    domains: { overview: 'Tổng quan', core: 'Hồ sơ cơ bản', network: 'Quan hệ & Cốt truyện', quality: 'Kiểm tra chất lượng', ops: 'RAG & Công cụ' },
    groups: {
      entities: 'Thực thể', chapters: 'Chương', scenes: 'Cảnh', aliases: 'Biệt danh',
      stateChanges: 'Thay đổi trạng thái', relationships: 'Quan hệ', relationshipEvents: 'Sự kiện quan hệ',
      readingPower: 'Lực theo dõi', overrides: 'Hợp đồng Override', debts: 'Nợ theo dõi',
      debtEvents: 'Sự kiện nợ', reviewMetrics: 'Chỉ số kiểm tra', invalidFacts: 'Sự kiện không hợp lệ',
      checklistScores: 'Điểm danh sách kiểm tra viết', ragQueries: 'Nhật ký RAG', toolStats: 'Thống kê gọi công cụ',
    },
    pagination: { prev: 'Trước', next: 'Sau', page: 'Trang', of: '/', total: 'Tổng', items: 'bản ghi', noData: 'Chưa có dữ liệu', unit: 'bản ghi' },
    entityDetail: { typeLabel: 'Loại', idLabel: 'ID', descLabel: 'Mô tả', currentLabel: 'Trạng thái hiện tại' },
    filesTree: { folder: 'Thư mục' },
    number: { suffix: ' nghìn', short: false },
  },
  'en': {
    nav: { dashboard: 'Dashboard', entities: 'Entities', graph: 'Relationship Graph', chapters: 'Chapters', files: 'Files', reading: 'Reading Power' },
    live: { connected: 'Live Sync', disconnected: 'Disconnected' },
    loading: 'Loading…',
    dashboard: {
      title: 'Dashboard', genre: 'Unknown genre', totalWords: 'Total Words', target: 'Target', chars: 'words',
      currentChapter: 'Current Chapter', vol: 'Vol', protagonist: 'Protagonist', unknownRealm: 'Unknown realm', notSet: 'Not set',
      unresolvedForeshadow: 'Unresolved Foreshadowing', totalForeshadow: 'Total', foreshadowUnit: 'items',
      pendingForeshadow: 'Pending Foreshadow (Top 20)', content: 'Content', status: 'Status', plantedCh: 'Planted Ch.',
      strandTitle: 'Strand Weave Distribution',
    },
    entities: {
      title: 'Entities', all: 'All', name: 'Name', type: 'Type', tier: 'Tier',
      first: 'First', last: 'Last', units: 'entities', currentStatus: 'Current Status',
      historyTitle: 'State Change History', chapter: 'Ch.', field: 'Field', change: 'Change',
    },
    graph: { title: 'Relationship Graph', links: 'gravity links' },
    chapters: {
      title: 'Chapters', chapter: 'Chapter', chPrefix: 'Ch.', titleCol: 'Title',
      wordCount: 'Word Count', location: 'Location', characters: 'Characters', noChapters: 'No chapter data yet',
    },
    files: {
      title: 'Files', selectFile: 'Select a file from the left to preview',
      readFailed: '[Read failed]', binaryPreview: '[Binary file, cannot preview]',
    },
    reading: {
      title: 'Reading Power Analysis', chapterCol: 'Chapter', hookType: 'Hook Type', hookStrength: 'Hook Strength',
      transition: 'Transition', override: 'Override', debtBalance: 'Debt Balance',
      noData: 'No reading power data yet', chapterData: 'chapters of data',
    },
    dataView: {
      title: 'Full Data View', dataSources: 'data sources', totalRecords: 'Total Records',
      totalRecordsSub: 'Total rows returned', coveredSources: 'Covered Sources',
      coveredSub: 'Tables with data / Total tables', reachedCh: 'Latest Chapter Reached',
      reachedSub: 'Estimated by identifiable chapter fields', currentView: 'Current View', viewSub: 'data groups',
    },
    domains: { overview: 'Overview', core: 'Core', network: 'Network & Plot', quality: 'Quality Review', ops: 'RAG & Tools' },
    groups: {
      entities: 'Entities', chapters: 'Chapters', scenes: 'Scenes', aliases: 'Aliases',
      stateChanges: 'State Changes', relationships: 'Relationships', relationshipEvents: 'Relationship Events',
      readingPower: 'Reading Power', overrides: 'Override Contracts', debts: 'Chase Debts',
      debtEvents: 'Debt Events', reviewMetrics: 'Review Metrics', invalidFacts: 'Invalid Facts',
      checklistScores: 'Writing Checklist Scores', ragQueries: 'RAG Query Log', toolStats: 'Tool Call Stats',
    },
    pagination: { prev: 'Previous', next: 'Next', page: 'Page', of: 'of', total: 'Total', items: 'items', noData: 'No data', unit: 'rows' },
    entityDetail: { typeLabel: 'Type', idLabel: 'ID', descLabel: 'Description', currentLabel: 'Current Status' },
    filesTree: { folder: 'Folder' },
    number: { suffix: 'K', short: false },
  },
}

// ====================================================================
// Helper: deep get by dot-path
// ====================================================================
function t(locale, path) {
  const lang = dict[locale] || dict[DEFAULT_LOCALE]
  return path.split('.').reduce((o, k) => o?.[k], lang) ?? path
}

const I18nContext = createContext(null)

export function I18nProvider({ children }) {
  const [locale, setLocaleRaw] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_LOCALE } catch { return DEFAULT_LOCALE }
  })

  const setLocale = useCallback((l) => {
    setLocaleRaw(l)
    try { localStorage.setItem(STORAGE_KEY, l) } catch {}
  }, [])

  const value = { locale, setLocale, t: (path) => t(locale, path), localeCode: locale }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error('useI18n must be used within I18nProvider')
  return ctx
}

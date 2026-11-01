/**
 * Excel (exceljs) and PDF (pdfkit) report exports, Arabic-first.
 *
 * PDF + Arabic: fontkit shapes Arabic glyphs correctly, but PDFKit's own line layout is not
 * bidi-aware. Each table cell is therefore laid out token-by-token: Arabic cells are placed
 * right-to-left from the cell's right edge, each token rendered with the Arabic or Latin
 * Noto font as appropriate, all on a shared alphabetic baseline.
 */
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
type ReportType = 'daily' | 'weekly' | 'monthly'

type Locale = 'ar' | 'en'
type Fmt = 'text' | 'date' | 'time' | 'minutes' | 'number' | 'percent' | 'status'

interface Column { key: string, ar: string, en: string, fmt: Fmt, width: number }

const COMMON_HEAD: Column[] = [
  { key: 'code', ar: 'الرقم', en: 'Code', fmt: 'text', width: 1 },
  { key: 'name', ar: 'الموظف', en: 'Employee', fmt: 'text', width: 2.6 },
  { key: 'department', ar: 'القسم', en: 'Department', fmt: 'text', width: 1.8 },
]

const COLUMNS: Record<ReportType, Column[]> = {
  daily: [
    ...COMMON_HEAD,
    { key: 'date', ar: 'التاريخ', en: 'Date', fmt: 'date', width: 1.5 },
    { key: 'status', ar: 'الحالة', en: 'Status', fmt: 'status', width: 1.4 },
    { key: 'checkIn', ar: 'الحضور', en: 'Check-in', fmt: 'time', width: 1 },
    { key: 'checkOut', ar: 'الانصراف', en: 'Check-out', fmt: 'time', width: 1 },
    { key: 'netMinutes', ar: 'ساعات العمل', en: 'Worked', fmt: 'minutes', width: 1.1 },
    { key: 'breakMinutes', ar: 'الاستراحة', en: 'Break', fmt: 'minutes', width: 1 },
    { key: 'lateMinutes', ar: 'التأخير', en: 'Late', fmt: 'minutes', width: 0.9 },
    { key: 'overtimeMinutes', ar: 'الإضافي', en: 'Overtime', fmt: 'minutes', width: 1 },
    { key: 'shortageMinutes', ar: 'النقص', en: 'Missing', fmt: 'minutes', width: 1 },
  ],
  weekly: [
    ...COMMON_HEAD,
    { key: 'from', ar: 'من', en: 'From', fmt: 'date', width: 1.4 },
    { key: 'to', ar: 'إلى', en: 'To', fmt: 'date', width: 1.4 },
    { key: 'netMinutes', ar: 'مجموع الساعات', en: 'Total hours', fmt: 'minutes', width: 1.2 },
    { key: 'requiredMinutes', ar: 'المطلوب', en: 'Required', fmt: 'minutes', width: 1.1 },
    { key: 'overtimeMinutes', ar: 'الإضافي', en: 'Overtime', fmt: 'minutes', width: 1 },
    { key: 'shortageMinutes', ar: 'النقص', en: 'Shortage', fmt: 'minutes', width: 1 },
    { key: 'absenceDays', ar: 'الغياب', en: 'Absent', fmt: 'number', width: 0.8 },
    { key: 'leaveDays', ar: 'الإجازات', en: 'Leave', fmt: 'number', width: 0.8 },
  ],
  monthly: [
    ...COMMON_HEAD,
    { key: 'period', ar: 'الشهر', en: 'Month', fmt: 'text', width: 1 },
    { key: 'netMinutes', ar: 'مجموع الساعات', en: 'Total hours', fmt: 'minutes', width: 1.2 },
    { key: 'requiredMinutes', ar: 'المطلوب', en: 'Required', fmt: 'minutes', width: 1.1 },
    { key: 'overtimeMinutes', ar: 'الإضافي', en: 'Overtime', fmt: 'minutes', width: 1 },
    { key: 'shortageMinutes', ar: 'النقص', en: 'Shortage', fmt: 'minutes', width: 1 },
    { key: 'lateCount', ar: 'مرات التأخير', en: 'Late arrivals', fmt: 'number', width: 1 },
    { key: 'absenceDays', ar: 'الغياب', en: 'Absent', fmt: 'number', width: 0.8 },
    { key: 'leaveDays', ar: 'الإجازات', en: 'Leave', fmt: 'number', width: 0.8 },
    { key: 'attendancePercentage', ar: 'نسبة الحضور', en: 'Attendance', fmt: 'percent', width: 1 },
  ],
}

const STATUS: Record<string, [string, string]> = {
  present: ['حاضر', 'Present'],
  absent: ['غائب', 'Absent'],
  on_leave: ['إجازة', 'On leave'],
  holiday: ['عطلة رسمية', 'Holiday'],
  day_off: ['يوم راحة', 'Day off'],
  in_progress: ['قيد العمل', 'In progress'],
  missing_checkout: ['انصراف مفقود', 'Missing check-out'],
  scheduled: ['مجدول', 'Scheduled'],
}

const TITLES: Record<ReportType, [string, string]> = {
  daily: ['تقرير الحضور اليومي', 'Daily attendance report'],
  weekly: ['تقرير الحضور الأسبوعي', 'Weekly attendance report'],
  monthly: ['تقرير الحضور الشهري', 'Monthly attendance report'],
}

export interface ExportMeta {
  orgName: string
  generatedBy: string
  timezone: string
}

function hm(minutes: number): string {
  const sign = minutes < 0 ? '-' : ''
  const m = Math.abs(Math.round(minutes))
  return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

function cellText(row: any, col: Column, locale: Locale, tz: string): string {
  const v = col.key === 'name'
    ? (locale === 'en' ? row.nameEn || row.name : row.name)
    : col.key === 'department'
      ? (locale === 'en' ? row.departmentEn : row.departmentAr) ?? ''
      : row[col.key]
  if (v === null || v === undefined || v === '') {
    return col.fmt === 'time' ? '—' : ''
  }
  switch (col.fmt) {
    case 'minutes': return hm(Number(v))
    case 'percent': return `${Number(v).toFixed(1)}%`
    case 'number': return String(Number(v))
    case 'status': return STATUS[v]?.[locale === 'ar' ? 0 : 1] ?? String(v)
    case 'time': return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v))
    default: return String(v)
  }
}

function totalsRow(report: { totals: Record<string, number> }, type: ReportType) {
  const t = report.totals
  return type === 'daily'
    ? { netMinutes: t.netMinutes, overtimeMinutes: t.overtimeMinutes, shortageMinutes: t.shortageMinutes }
    : { netMinutes: t.netMinutes, requiredMinutes: t.requiredMinutes, overtimeMinutes: t.overtimeMinutes, shortageMinutes: t.shortageMinutes, absenceDays: t.absenceDays, leaveDays: t.leaveDays }
}

// ------------------------------------------------------------------------------- Excel
export async function reportToXlsx(report: any, type: ReportType, locale: Locale, meta: ExportMeta): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = meta.orgName
  wb.created = new Date()
  const ws = wb.addWorksheet(locale === 'ar' ? 'التقرير' : 'Report', { views: [{ rightToLeft: locale === 'ar', state: 'frozen', ySplit: 5 }] })
  const cols = COLUMNS[type]
  const L = (ar: string, en: string) => (locale === 'ar' ? ar : en)

  ws.mergeCells(1, 1, 1, cols.length)
  ws.getCell(1, 1).value = `${meta.orgName} — ${L(...TITLES[type])}`
  ws.getCell(1, 1).font = { bold: true, size: 14 }
  ws.getCell(2, 1).value = `${L('الفترة', 'Period')}: ${report.from} → ${report.to}`
  ws.getCell(3, 1).value = `${L('أُنشئ بواسطة', 'Generated by')}: ${meta.generatedBy} — ${new Date().toISOString()} (${meta.timezone})`

  const header = ws.getRow(5)
  cols.forEach((c, i) => {
    const cell = header.getCell(i + 1)
    cell.value = L(c.ar, c.en)
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0866B2' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    ws.getColumn(i + 1).width = Math.round(c.width * 11)
  })

  report.items.forEach((row: any, r: number) => {
    const xr = ws.getRow(6 + r)
    cols.forEach((c, i) => {
      const cell = xr.getCell(i + 1)
      if (c.fmt === 'minutes' && row[c.key] != null) {
        // numeric hours (2 decimals) so Excel can sum them
        cell.value = Math.round((Number(row[c.key]) / 60) * 100) / 100
        cell.numFmt = '0.00'
      }
      else if ((c.fmt === 'number' || c.fmt === 'percent') && row[c.key] != null) {
        cell.value = Number(row[c.key])
        cell.numFmt = c.fmt === 'percent' ? '0.0"%"' : '0.##'
      }
      else {
        cell.value = cellText(row, c, locale, report.timezone)
      }
      cell.alignment = { horizontal: c.fmt === 'text' ? (locale === 'ar' ? 'right' : 'left') : 'center' }
    })
  })

  const totals = totalsRow(report, type)
  const tr = ws.getRow(6 + report.items.length)
  tr.getCell(1).value = L('المجموع', 'Total')
  cols.forEach((c, i) => {
    if (c.key in totals) {
      tr.getCell(i + 1).value = c.fmt === 'minutes' ? Math.round(((totals as any)[c.key] / 60) * 100) / 100 : (totals as any)[c.key]
    }
  })
  tr.font = { bold: true }
  ws.getCell(4, 1).value = L('ملاحظة: قيم الساعات بصيغة عشرية (ساعات).', 'Note: hour values are decimal hours.')
  ws.getCell(4, 1).font = { italic: true, size: 9, color: { argb: 'FF666666' } }

  return Buffer.from(await wb.xlsx.writeBuffer())
}

// ------------------------------------------------------------------------------- PDF
const AR_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/

type Strength = 'R' | 'L' | 'N'
const strength = (token: string): Strength => (AR_RE.test(token) ? 'R' : /[A-Za-z0-9]/.test(token) ? 'L' : 'N')

/** Direction of the first strong (Arabic or Latin/digit) token, if any. */
export function strongDirection(text: string): 'rtl' | 'ltr' | null {
  for (const t of text.split(/\s+/)) {
    const s = strength(t)
    if (s !== 'N') return s === 'R' ? 'rtl' : 'ltr'
  }
  return null
}

/**
 * Simplified Unicode bidi (UAX #9) at word granularity: neutrals take the direction of their
 * neighbours when both agree (else the base direction), consecutive same-direction tokens form
 * runs, runs are ordered by the base direction and RTL runs are reversed internally.
 * Returns token indices in left-to-right drawing order. Glyph shaping inside each Arabic word
 * is done by fontkit.
 */
export function visualOrder(tokens: string[], base: 'rtl' | 'ltr'): number[] {
  const baseStrength: Strength = base === 'rtl' ? 'R' : 'L'
  const raw = tokens.map(strength)
  const resolved = raw.map((s, i) => {
    if (s !== 'N') return s
    const prev = raw.slice(0, i).reverse().find(x => x !== 'N')
    const next = raw.slice(i + 1).find(x => x !== 'N')
    return prev && prev === next ? prev : baseStrength
  })
  const runs: Array<{ dir: Strength, idx: number[] }> = []
  resolved.forEach((d, i) => {
    const last = runs.at(-1)
    if (last && last.dir === d) last.idx.push(i)
    else runs.push({ dir: d, idx: [i] })
  })
  const ordered = base === 'rtl' ? [...runs].reverse() : runs
  return ordered.flatMap(r => (r.dir === 'R' ? [...r.idx].reverse() : r.idx))
}

export type PdfFonts = Record<'ar' | 'ar-b' | 'la' | 'la-b', Buffer>

async function loadFonts(): Promise<PdfFonts> {
  const storage = useStorage('assets:server')
  const read = async (name: string) => {
    const raw = await storage.getItemRaw(`fonts/${name}`)
    if (!raw) {
      throw new Error(`Font missing from server assets: ${name}`)
    }
    return Buffer.from(raw as ArrayBuffer)
  }
  return {
    'ar': await read('NotoSansArabic-Regular.ttf'),
    'ar-b': await read('NotoSansArabic-Bold.ttf'),
    'la': await read('NotoSans-Regular.ttf'),
    'la-b': await read('NotoSans-Bold.ttf'),
  }
}

/** Fonts are injectable for tests; at runtime they come from Nitro server assets. */
export async function reportToPdf(report: any, type: ReportType, locale: Locale, meta: ExportMeta, fonts?: PdfFonts): Promise<Buffer> {
  fonts ??= await loadFonts()
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28, bufferPages: true, font: fonts.la as never, info: { Title: TITLES[type][1], Author: meta.orgName } })
  for (const [name, buf] of Object.entries(fonts)) {
    doc.registerFont(name, buf)
  }
  doc.font('la')
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<Buffer>(resolve => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const rtl = locale === 'ar'
  const L = (ar: string, en: string) => (rtl ? ar : en)
  const left = doc.page.margins.left
  const right = doc.page.width - doc.page.margins.right
  const usable = right - left

  /**
   * Draw one line of text inside [x, x+w] on baseline y. `base` is the paragraph direction:
   * page furniture follows the locale; table cells follow their first strong character.
   */
  function drawText(text: string, x: number, w: number, y: number, size: number, bold: boolean, align: 'start' | 'center' | 'end', base?: 'rtl' | 'ltr') {
    const tokens = text.split(/\s+/).filter(Boolean)
    if (!tokens.length) return
    doc.fontSize(size)
    const fontOf = (t: string) => (AR_RE.test(t) ? (bold ? 'ar-b' : 'ar') : (bold ? 'la-b' : 'la'))
    const spaceW = doc.font('la').widthOfString(' ')
    const widths = tokens.map(t => doc.font(fontOf(t)).widthOfString(t))
    let total = widths.reduce((a, b) => a + b, 0) + spaceW * (tokens.length - 1)
    while (total > w - 4 && tokens.length > 1) { // truncate overflowing cells
      tokens.pop()
      widths.pop()
      total = widths.reduce((a, b) => a + b, 0) + spaceW * (tokens.length - 1)
    }
    const dir = base ?? (strongDirection(text) ?? (rtl ? 'rtl' : 'ltr'))
    const order = visualOrder(tokens, dir)
    // alignment follows the page direction; only the word order follows the text's own direction
    const startAligned = align === 'start' ? (rtl ? 'right' : 'left') : align === 'end' ? (rtl ? 'left' : 'right') : 'center'
    let cursor = startAligned === 'left' ? x + 2 : startAligned === 'right' ? x + w - 2 - total : x + (w - total) / 2
    for (const i of order) {
      doc.font(fontOf(tokens[i]!)).text(tokens[i]!, cursor, y, { lineBreak: false, baseline: 'alphabetic' })
      cursor += widths[i]! + spaceW
    }
  }

  const cols = COLUMNS[type]
  const totalWeight = cols.reduce((a, c) => a + c.width, 0)
  const widths = cols.map(c => (c.width / totalWeight) * usable)
  // RTL: first column at the right edge
  const xs: number[] = []
  let acc = 0
  for (const w of widths) {
    xs.push(rtl ? right - acc - w : left + acc)
    acc += w
  }

  const rowH = 18
  let y = doc.page.margins.top

  function header() {
    drawText(`${meta.orgName} — ${L(...TITLES[type])}`, left, usable, y + 14, 15, true, 'start', rtl ? 'rtl' : 'ltr')
    y += 22
    drawText(`${L('الفترة', 'Period')}: ${report.from} – ${report.to}   |   ${L('عدد الموظفين', 'Employees')}: ${report.employees}`, left, usable, y + 11, 9, false, 'start', rtl ? 'rtl' : 'ltr')
    y += 18
    doc.rect(left, y, usable, rowH).fill('#0866b2')
    doc.fillColor('#ffffff')
    cols.forEach((c, i) => drawText(L(c.ar, c.en), xs[i]!, widths[i]!, y + 12.5, 8.5, true, 'center', rtl ? 'rtl' : 'ltr'))
    doc.fillColor('#111111')
    y += rowH
  }

  header()
  report.items.forEach((row: any, r: number) => {
    if (y + rowH > doc.page.height - doc.page.margins.bottom - 20) {
      doc.addPage()
      y = doc.page.margins.top
      header()
    }
    if (r % 2 === 1) {
      doc.rect(left, y, usable, rowH).fill('#f1f6fb')
      doc.fillColor('#111111')
    }
    cols.forEach((c, i) => drawText(cellText(row, c, locale, report.timezone), xs[i]!, widths[i]!, y + 12.5, 8, false, c.fmt === 'text' ? 'start' : 'center'))
    y += rowH
  })

  // totals
  if (y + rowH > doc.page.height - doc.page.margins.bottom - 20) {
    doc.addPage()
    y = doc.page.margins.top
  }
  doc.rect(left, y, usable, rowH).fill('#dbe8f5')
  doc.fillColor('#111111')
  const totals = totalsRow(report, type) as Record<string, number>
  cols.forEach((c, i) => {
    if (i === 0) drawText(L('المجموع', 'Total'), xs[i]!, widths[i]!, y + 12.5, 8.5, true, 'start', rtl ? 'rtl' : 'ltr')
    else if (c.key in totals) drawText(c.fmt === 'minutes' ? hm(totals[c.key]!) : String(totals[c.key]), xs[i]!, widths[i]!, y + 12.5, 8.5, true, 'center')
  })

  // footer on every page
  const range = doc.bufferedPageRange()
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p)
    const fy = doc.page.height - doc.page.margins.bottom + 6
    drawText(`${L('صفحة', 'Page')} ${p + 1} / ${range.count}`, left, usable, fy, 8, false, 'end', rtl ? 'rtl' : 'ltr')
    drawText(`${L('أُنشئ بواسطة', 'Generated by')}: ${meta.generatedBy} — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`, left, usable, fy, 8, false, 'start', rtl ? 'rtl' : 'ltr')
  }
  doc.end()
  return done
}

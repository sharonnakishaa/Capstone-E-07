import ExcelJS from 'exceljs'
import type { sensor_logs } from '@prisma/client'

const WIB_OFFSET_MS = 7 * 3600 * 1000

const HEADER_FILL  = 'FF1F3864' // biru tua
const HEADER_FONT  = 'FFFFFFFF' // putih
const BORDER_COLOR = 'FFBFBFBF'

const thin = { style: 'thin' as const, color: { argb: BORDER_COLOR } }
const ALL_BORDERS: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin }

interface Column {
  header: string
  width: number
  numFmt?: string
  value: (log: sensor_logs) => ExcelJS.CellValue
}

const COLUMNS: Column[] = [
  // Excel tidak menyimpan zona waktu: waktu digeser ke WIB lalu ditulis sebagai tanggal biasa.
  { header: 'Waktu (WIB)',          width: 20, numFmt: 'yyyy-mm-dd hh:mm:ss', value: l => new Date(l.recorded_at.getTime() + WIB_OFFSET_MS) },
  { header: 'TVOC Mentah (ppb)',    width: 13, numFmt: '0',   value: l => l.tvoc_raw_ppb },
  { header: 'TVOC Kalman (ppb)',    width: 13, numFmt: '0.0', value: l => l.tvoc_kalman_ppb },
  { header: 'eCO₂ (ppm)',           width: 11, numFmt: '0',   value: l => l.eco2_ppm },
  { header: 'Suhu (°C)',            width: 10, numFmt: '0.0', value: l => l.temperature_celsius },
  { header: 'RH (%)',               width: 9,  numFmt: '0.0', value: l => l.humidity_percent },
  { header: 'Debu Outlet (µg/m³)',  width: 13, numFmt: '0.0', value: l => l.dust_outlet_ugm3 },
  { header: 'Status Fuzzy',         width: 13,                value: l => l.air_status },
  { header: 'Level',                width: 8,                 value: l => l.fuzzy_level },
  { header: 'Duty (%)',             width: 9,  numFmt: '0',   value: l => l.fan_duty_percent },
  { header: 'RPM',                  width: 9,  numFmt: '0',   value: l => l.fan_rpm },
]

/**
 * Buat file XLSX log sensor: header biru tua + teks putih tebal, border hanya pada area tabel
 * (judul + baris data), baris pertama dibekukan. Angka dan waktu disimpan sebagai angka/tanggal asli
 * (bukan teks), jadi bisa langsung dihitung, diurutkan, dan difilter di Excel.
 */
export async function buildSensorLogXlsx(logs: sensor_logs[], sheetTitle: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'EPEN Dashboard'
  workbook.created = new Date()

  // Nama sheet maksimal 31 karakter dan tidak boleh berisi : \ / ? * [ ]
  const sheet = workbook.addWorksheet(sheetTitle.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31) || 'Log Sensor', {
    views: [{ state: 'frozen', ySplit: 1 }],
  })

  // Tanpa style kolom: style kolom berlaku sampai baris terakhir Excel, jadi border
  // dan format angka dipasang per sel di dalam tabel saja (lihat loop data di bawah).
  sheet.columns = COLUMNS.map(c => ({ header: c.header, width: c.width }))

  const header = sheet.getRow(1)
  header.height = 32
  header.eachCell(cell => {
    cell.font      = { bold: true, color: { argb: HEADER_FONT } }
    cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } }
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }
    cell.border    = ALL_BORDERS
  })

  // Satu objek style per kolom, dipakai bersama semua sel di kolom itu (jauh lebih cepat
  // daripada mengisi border/numFmt per sel, yang membuat salinan style di setiap sel).
  const cellStyles: Partial<ExcelJS.Style>[] = COLUMNS.map(c => ({
    border: ALL_BORDERS,
    ...(c.numFmt && { numFmt: c.numFmt }),
  }))

  for (const log of logs) {
    const row = sheet.addRow(COLUMNS.map(c => c.value(log) ?? null))
    // Semua kolom tabel, termasuk sel kosong (mis. Kalman null), supaya garis tabel utuh
    for (let i = 0; i < COLUMNS.length; i++) {
      row.getCell(i + 1).style = cellStyles[i]
    }
  }

  return Buffer.from(await workbook.xlsx.writeBuffer())
}

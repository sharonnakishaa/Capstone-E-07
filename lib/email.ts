import nodemailer from 'nodemailer'
import { StatusLabel, FuzzyLevel, STATUS_META, FUZZY_LEVEL_META, TVOC_REFERENCE_PPB } from './sensor'

export interface WarningEmailPayload {
  device_id: string
  device_name: string
  location: string
  inlet_distance_cm: number
  tvoc_raw_ppb: number
  tvoc_kalman_ppb: number | null
  air_status: StatusLabel
  fuzzy_level: FuzzyLevel | null
  fan_duty_percent: number
  fan_rpm: number | null
  dust_outlet_ugm3: number | null
  temperature_celsius: number
  humidity_percent: number
  timestamp: Date
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

const fmt = (v: number | null, unit: string, digits = 0) =>
  v === null ? '—' : `${v.toLocaleString('id-ID', { maximumFractionDigits: digits })} ${unit}`

/** TVOC utama = Kalman (input fuzzy); fallback ke nilai mentah kalau firmware tidak mengirim Kalman. */
const mainTvoc = (p: WarningEmailPayload) => Math.round(p.tvoc_kalman_ppb ?? p.tvoc_raw_ppb)

function buildHtml(p: WarningEmailPayload): string {
  const t = STATUS_META[p.air_status]
  const isCritical = p.air_status === 'BERBAHAYA'
  const level = p.fuzzy_level ? `${p.fuzzy_level} — ${FUZZY_LEVEL_META[p.fuzzy_level].label}` : '—'
  const tvocLabel = p.tvoc_kalman_ppb === null ? 'TVOC (mentah)' : 'TVOC (Kalman)'

  const rows: [string, string, boolean?][] = [
    [tvocLabel,           fmt(mainTvoc(p), 'ppb'), true],
    ['TVOC mentah',       fmt(p.tvoc_raw_ppb, 'ppb')],
    ['Status fuzzy',      `${t.emoji} ${t.label}`],
    ['Level fuzzy',       level],
    ['Duty kipas',        fmt(p.fan_duty_percent, '%')],
    ['Putaran kipas',     fmt(p.fan_rpm, 'RPM')],
    ['Debu outlet',       fmt(p.dust_outlet_ugm3, 'µg/m³', 1)],
    ['Suhu',              fmt(p.temperature_celsius, '°C', 1)],
    ['Kelembapan',        fmt(p.humidity_percent, '%', 1)],
  ]

  const valueRows = rows.map(([name, value, highlight], i) => `
          <tr${i < rows.length - 1 ? ' style="border-bottom:1px solid #F1F5F9;"' : ''}>
            <td style="padding:11px 14px;color:#475569;">${name}</td>
            <td style="padding:11px 14px;text-align:right;font-family:monospace;${highlight ? `font-weight:700;color:${t.text_light};` : ''}">${value}</td>
          </tr>`).join('')

  const ref = TVOC_REFERENCE_PPB
  const thresholdRows = ([
    ['AMAN',      `&lt; ${ref.waspada} ppb`],
    ['WASPADA',   `${ref.waspada} – ${ref.berbahaya - 1} ppb`],
    ['BERBAHAYA', `≥ ${ref.berbahaya} ppb`],
  ] as [StatusLabel, string][]).map(([key, range]) => {
    const m = STATUS_META[key]
    return `
          <tr style="background:${key === p.air_status ? m.color + '18' : 'transparent'}">
            <td style="padding:8px 14px;font-size:13px;">${m.emoji} <strong>${m.label}</strong></td>
            <td style="padding:8px 14px;font-size:13px;font-family:monospace;text-align:right;">${range}</td>
          </tr>`
  }).join('')

  return `<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><title>EPEN Alert</title></head>
<body style="margin:0;padding:32px 16px;background:#F0F4F8;font-family:system-ui,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #E2E8F0;box-shadow:0 4px 24px rgba(0,0,0,.07);">

    <!-- Header -->
    <div style="padding:24px 32px;background:${isCritical ? '#1E293B' : '#FFFBEB'};border-bottom:4px solid ${t.color};">
      <div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:${isCritical ? t.color : t.text_light};font-weight:700;margin-bottom:6px;">
        EPEN — Fume Extractor Lab DTETI
      </div>
      <div style="font-size:22px;font-weight:700;color:${isCritical ? '#F1F5F9' : '#0F172A'};">
        ${t.emoji} Peringatan: Status <span style="color:${isCritical ? t.color : t.text_light}">${t.label.toUpperCase()}</span>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px;">
      <p style="color:#475569;margin-top:0;line-height:1.6;">
        Perangkat <strong style="color:#0F172A;">${escapeHtml(p.device_name)}</strong> (${escapeHtml(p.location)})
        mendeteksi TVOC <strong style="color:${t.text_light};font-family:monospace;">${fmt(mainTvoc(p), 'ppb')}</strong>
        dengan status fuzzy <strong style="color:${t.text_light};">${t.label}</strong>.
        ${t.description}
      </p>

      <!-- Sensor Values -->
      <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#F1F5F9;">
            <th style="text-align:left;padding:10px 14px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#64748B;border-bottom:1px solid #E2E8F0;">Parameter</th>
            <th style="text-align:right;padding:10px 14px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#64748B;border-bottom:1px solid #E2E8F0;">Nilai</th>
          </tr>
        </thead>
        <tbody>${valueRows}
        </tbody>
      </table>

      <p style="color:#475569;font-size:13px;line-height:1.6;margin:0 0 20px;">
        Pastikan inlet berjarak ±${p.inlet_distance_cm.toLocaleString('id-ID')} cm dari titik solder dan menghadap sumber asap.
      </p>

      <!-- Threshold Guide -->
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
        <div style="padding:10px 14px;background:#F1F5F9;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#64748B;">
          Referensi Ambang TVOC (Kalman)
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tbody>${thresholdRows}</tbody>
        </table>
      </div>
    </div>

    <!-- Footer -->
    <div style="padding:16px 32px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:12px;color:#64748B;display:flex;justify-content:space-between;">
      <span>Terdeteksi: <strong>${p.timestamp.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</strong></span>
      <span>EPEN Monitoring · Lab DTETI</span>
    </div>
  </div>
</body>
</html>`
}

export async function sendWarningEmail(payload: WarningEmailPayload): Promise<void> {
  const recipients = (process.env.ALERT_EMAIL_TO ?? '').split(',').map(e => e.trim()).filter(Boolean)

  if (recipients.length === 0) {
    console.warn('[email] ALERT_EMAIL_TO not set — skipping')
    return
  }

  const { air_status, device_name } = payload
  const tvoc = mainTvoc(payload)

  await transporter.sendMail({
    from: `"EPEN Monitor 🌿" <${process.env.SMTP_USER}>`,
    to: recipients.join(', '),
    subject: `[EPEN ${air_status}] TVOC ${tvoc.toLocaleString('id-ID')} ppb — ${device_name}`,
    html: buildHtml(payload),
  })

  console.info(`[email] Warning sent to ${recipients.join(', ')} — ${air_status} (${tvoc} ppb)`)
}

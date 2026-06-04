import nodemailer from 'nodemailer'
import { EcoStatus, ECO2_THRESHOLDS } from './sensor'

export interface WarningEmailPayload {
  deviceId: string
  eco2: number
  suhu: number
  kelembaban: number
  status: EcoStatus
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

function buildHtml(p: WarningEmailPayload): string {
  const { deviceId, eco2, suhu, kelembaban, status, timestamp } = p
  const t = ECO2_THRESHOLDS[status]
  const isCritical = status === 'BAHAYA'

  const thresholdRows = (Object.entries(ECO2_THRESHOLDS) as [EcoStatus, typeof ECO2_THRESHOLDS[EcoStatus]][])
    .map(([key, val]) => {
      const range = val.max === Infinity
        ? `≥ ${val.min.toLocaleString('id-ID')} ppm`
        : `${val.min.toLocaleString('id-ID')} – ${val.max.toLocaleString('id-ID')} ppm`
      const isCurrent = key === status
      return `
        <tr style="background:${isCurrent ? t.color + '18' : 'transparent'}">
          <td style="padding:8px 14px;font-size:13px;">${val.emoji} <strong>${val.label}</strong></td>
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
      <div style="font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:${t.color};font-weight:700;margin-bottom:6px;">
        EPEN — Sistem Monitoring Kualitas Udara
      </div>
      <div style="font-size:22px;font-weight:700;color:${isCritical ? '#F1F5F9' : '#0F172A'};">
        ${t.emoji} Peringatan: eCO₂ Level <span style="color:${t.color}">${t.label.toUpperCase()}</span>
      </div>
    </div>

    <!-- Body -->
    <div style="padding:28px 32px;">
      <p style="color:#475569;margin-top:0;line-height:1.6;">
        Perangkat <strong style="color:#0F172A;font-family:monospace;">${deviceId}</strong> mendeteksi
        kadar eCO₂ sebesar <strong style="color:${t.color};font-family:monospace;">${eco2.toLocaleString('id-ID')} ppm</strong>
        yang masuk kategori <strong style="color:${t.color};">${t.label}</strong>.
        Harap segera periksa kondisi ruangan.
      </p>

      <!-- Sensor Values -->
      <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#F1F5F9;">
            <th style="text-align:left;padding:10px 14px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#64748B;border-bottom:1px solid #E2E8F0;">Parameter</th>
            <th style="text-align:right;padding:10px 14px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#64748B;border-bottom:1px solid #E2E8F0;">Nilai</th>
          </tr>
        </thead>
        <tbody>
          <tr style="border-bottom:1px solid #F1F5F9;">
            <td style="padding:13px 14px;color:#475569;">eCO₂</td>
            <td style="padding:13px 14px;text-align:right;font-weight:700;color:${t.color};font-family:monospace;">${eco2.toLocaleString('id-ID')} ppm</td>
          </tr>
          <tr style="border-bottom:1px solid #F1F5F9;">
            <td style="padding:13px 14px;color:#475569;">Suhu</td>
            <td style="padding:13px 14px;text-align:right;font-family:monospace;">${suhu} °C</td>
          </tr>
          <tr>
            <td style="padding:13px 14px;color:#475569;">Kelembapan</td>
            <td style="padding:13px 14px;text-align:right;font-family:monospace;">${kelembaban} %</td>
          </tr>
        </tbody>
      </table>

      <!-- Threshold Guide -->
      <div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;overflow:hidden;margin-top:20px;">
        <div style="padding:10px 14px;background:#F1F5F9;font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#94A3B8;">
          Standar Ambang Batas eCO₂
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <tbody>${thresholdRows}</tbody>
        </table>
      </div>
    </div>

    <!-- Footer -->
    <div style="padding:16px 32px;background:#F8FAFC;border-top:1px solid #E2E8F0;font-size:12px;color:#94A3B8;display:flex;justify-content:space-between;">
      <span>Terdeteksi: <strong>${timestamp.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB</strong></span>
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

  const { status, eco2, deviceId } = payload
  const label = ECO2_THRESHOLDS[status].label

  await transporter.sendMail({
    from: `"EPEN Monitor 🌿" <${process.env.SMTP_USER}>`,
    to: recipients.join(', '),
    subject: `[EPEN ${label.toUpperCase()}] eCO₂ ${eco2.toLocaleString('id-ID')} ppm — ${deviceId}`,
    html: buildHtml(payload),
  })

  console.info(`[email] Warning sent to ${recipients.join(', ')} — ${status} (${eco2} ppm)`)
}

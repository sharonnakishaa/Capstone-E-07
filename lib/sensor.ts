export type StatusLabel = 'AMAN' | 'BERISIKO' | 'BERBAHAYA'

export const ECO2_THRESHOLDS = {
  AMAN:      { min: 0,    max: 999,      label: 'Aman',      emoji: '🟢', color: '#22C55E' },
  BERISIKO:  { min: 1000, max: 2499,     label: 'Berisiko',  emoji: '🟠', color: '#F97316' },
  BERBAHAYA: { min: 2500, max: Infinity, label: 'Berbahaya', emoji: '🔴', color: '#EF4444' },
} as const

export function getStatusLabel(eco2_ppm: number): StatusLabel {
  if (eco2_ppm < 1000) return 'AMAN'
  if (eco2_ppm < 2500) return 'BERISIKO'
  return 'BERBAHAYA'
}

export function getConfidences(status: StatusLabel) {
  return {
    confidence_aman:      status === 'AMAN'      ? 1.0 : 0.0,
    confidence_berisiko:  status === 'BERISIKO'  ? 1.0 : 0.0,
    confidence_berbahaya: status === 'BERBAHAYA' ? 1.0 : 0.0,
  }
}

export function shouldNotify(status: StatusLabel): boolean {
  return status === 'BERISIKO' || status === 'BERBAHAYA'
}

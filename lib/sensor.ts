export type StatusLabel = 'AMAN' | 'WASPADA' | 'BERBAHAYA'

export const ECO2_THRESHOLDS = {
  AMAN:      { min: 0,   max: 249,      label: 'Aman',      emoji: '🟢', color: '#22C55E' },
  WASPADA:  { min: 250, max: 399,      label: 'Waspada',  emoji: '🟠', color: '#F97316' },
  BERBAHAYA: { min: 400, max: Infinity, label: 'Berbahaya', emoji: '🔴', color: '#EF4444' },
} as const

export function getStatusLabel(tvoc_ppb: number): StatusLabel {
  if (tvoc_ppb < 250) return 'AMAN'
  if (tvoc_ppb < 400) return 'WASPADA'
  return 'BERBAHAYA'
}

export function getConfidences(status: StatusLabel) {
  return {
    confidence_aman:      status === 'AMAN'      ? 1.0 : 0.0,
    confidence_waspada:  status === 'WASPADA'  ? 1.0 : 0.0,
    confidence_berbahaya: status === 'BERBAHAYA' ? 1.0 : 0.0,
  }
}

export function shouldNotify(status: StatusLabel): boolean {
  return status === 'WASPADA' || status === 'BERBAHAYA'
}

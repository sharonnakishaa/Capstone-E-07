export type EcoStatus = 'AMAN' | 'SEDANG' | 'BERISIKO' | 'BAHAYA'

export const ECO2_THRESHOLDS = {
  AMAN:     { min: 0,    max: 999,      label: 'Aman',     emoji: '🟢', color: '#22C55E' },
  SEDANG:   { min: 1000, max: 1999,     label: 'Sedang',   emoji: '🟡', color: '#F59E0B' },
  BERISIKO: { min: 2000, max: 4999,     label: 'Berisiko', emoji: '🟠', color: '#F97316' },
  BAHAYA:   { min: 5000, max: Infinity, label: 'Bahaya',   emoji: '🔴', color: '#EF4444' },
} as const

export function getEcoStatus(eco2: number): EcoStatus {
  if (eco2 < 1000) return 'AMAN'
  if (eco2 < 2000) return 'SEDANG'
  if (eco2 < 5000) return 'BERISIKO'
  return 'BAHAYA'
}

export function shouldNotify(status: EcoStatus): boolean {
  return status === 'BERISIKO' || status === 'BAHAYA'
}

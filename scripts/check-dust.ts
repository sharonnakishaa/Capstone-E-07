// Uji kecil perhitungan kenaikan debu outlet (lib/dust-core.ts). Tidak butuh basis data.
// Jalankan: npx tsx scripts/check-dust.ts

import { computeDustRise, percentileCont, type DustSample } from '../lib/dust-core'

let failed = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected)
  if (!ok) failed++
  console.log(`${ok ? 'OK   ' : 'GAGAL'} ${name}: ${String(actual)}${ok ? '' : ` (harusnya ${String(expected)})`}`)
}

const T0 = Date.UTC(2026, 10, 6, 2, 0, 0) // 6 Nov 2026 09.00 WIB
const DEVICE = '00000000-0000-0000-0000-000000000001'
let nextId = 1
const sample = (sec: number, dust: number | null, duty: number, device = DEVICE): DustSample => ({
  id: BigInt(nextId++), device_id: device, recorded_at: new Date(T0 + sec * 1000),
  dust_outlet_ugm3: dust, fan_duty_percent: duty,
})

// 1. Persentil sama dengan percentile_cont PostgreSQL
check('percentileCont([1,2,3,4], 0.5)', percentileCont([1, 2, 3, 4], 0.5), 2.5)
check('percentileCont([10..50], 0.2)', percentileCont([10, 20, 30, 40, 50], 0.2), 18)

// 2. 120 sampel diam (52 µg/m³, duty 20 %) lalu 3 lonjakan menyolder (700 µg/m³, duty 100 %), tiap 5 detik
const idle = Array.from({ length: 120 }, (_, i) => sample(i * 5, 52, 20))
const spikes = Array.from({ length: 3 }, (_, i) => sample((120 + i) * 5, 700, 100))
const all = [...idle, ...spikes]
const r = computeDustRise(all)
const last = r.get(String(spikes[2].id))!
check('nilai diam sampel terakhir', last.dust_idle_ugm3, 52)
check('kenaikan lonjakan terakhir', last.dust_rise_ugm3, 648)
check('kenaikan sampel diam terakhir', r.get(String(idle[119].id))!.dust_rise_ugm3, 0)

// 3. Konteks: menghitung sampel terakhir saja dengan sampel lain sebagai konteks memberi hasil yang sama
const viaContext = computeDustRise([spikes[2]], all).get(String(spikes[2].id))!
check('hasil lewat konteks sama', viaContext.dust_rise_ugm3, 648)

// 4. Kurang dari 6 sampel debu → null
const few = Array.from({ length: 5 }, (_, i) => sample(10_000 + i * 5, 50, 20))
const fewRise = computeDustRise(few).get(String(few[4].id))!
check('< 6 sampel: nilai diam', fewRise.dust_idle_ugm3, null)
check('< 6 sampel: kenaikan', fewRise.dust_rise_ugm3, null)

// 5. Cadangan persentil-20 saat sampel diam < 12 (kipas terus kencang)
const busy = [50, 60, 70, 80, 90, 100].map((v, i) => sample(20_000 + i * 5, v, 80))
const busyRise = computeDustRise(busy).get(String(busy[5].id))!
check('cadangan persentil-20', busyRise.dust_idle_ugm3, 60)
check('kenaikan dengan cadangan', busyRise.dust_rise_ugm3, 40)

// 6. Batas bawah jendela eksklusif: sampel tepat 10 menit sebelumnya tidak ikut,
//    jadi jendela hanya berisi 5 sampel → null (kalau ikut, jadi 6 sampel dan tidak null)
const edge = [sample(30_000, 50, 80), ...Array.from({ length: 5 }, (_, i) => sample(30_000 + 580 + i * 5, 50, 80))]
const edgeRise = computeDustRise(edge).get(String(edge[5].id))!
check('batas (t − 10 menit) eksklusif', edgeRise.dust_idle_ugm3, null)

// 7. Debu null → kenaikan null, nilai diam tetap dihitung dari sampel lain
const withNull = [...Array.from({ length: 12 }, (_, i) => sample(40_000 + i * 5, 52, 20)), sample(40_060, null, 20)]
const nullRise = computeDustRise(withNull).get(String(withNull[12].id))!
check('debu null: nilai diam', nullRise.dust_idle_ugm3, 52)
check('debu null: kenaikan', nullRise.dust_rise_ugm3, null)

// 8. Alat lain tidak ikut jendela
const other = Array.from({ length: 12 }, (_, i) => sample(50_000 + i * 5, 500, 20, 'other-device'))
const mine = Array.from({ length: 12 }, (_, i) => sample(50_000 + i * 5, 52, 20))
check('dipisah per alat', computeDustRise([...other, ...mine]).get(String(mine[11].id))!.dust_idle_ugm3, 52)

console.log(failed === 0 ? '\nSemua uji lolos.' : `\n${failed} uji gagal.`)
process.exit(failed === 0 ? 0 : 1)

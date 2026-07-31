// Deterministic formatters (avoid SSR/CSR hydration mismatches)

const MONTHS_ES = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sep", "oct", "nov", "dic",
]

// 42000 -> "42.000" (dot thousands, no decimals)
export function fmtNum(value: number): string {
  const n = Math.round(Number(value) || 0)
  const neg = n < 0
  const digits = Math.abs(n).toString()
  let out = ""
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += "."
    out += digits[i]
  }
  return neg ? "-" + out : out
}

// 42000 -> "$42.000"
export function fmtCurrency(value: number): string {
  const n = Math.round(Number(value) || 0)
  return (n < 0 ? "-$" : "$") + fmtNum(Math.abs(n))
}

// ISO date string / Date -> "14 jul"
export function fmtDate(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return ""
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]}`
}

// ISO date string / Date -> "14 jul 2026, 3:45 pm"
export function fmtDateTime(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input
  if (Number.isNaN(d.getTime())) return ""
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, "0")
  const ampm = h >= 12 ? "pm" : "am"
  h = h % 12
  if (h === 0) h = 12
  return `${d.getDate()} ${MONTHS_ES[d.getMonth()]} ${d.getFullYear()}, ${h}:${m} ${ampm}`
}

// 0.1234 -> "+12,3%" | -0.05 -> "-5,0%"
export function fmtPct(value: number, withSign = true): string {
  const pct = (Number(value) || 0) * 100
  const rounded = Math.round(pct * 10) / 10
  const sign = withSign && rounded > 0 ? "+" : ""
  return `${sign}${rounded.toString().replace(".", ",")}%`
}

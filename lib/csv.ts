// Helper mínimo para armar CSVs desde el server. Sin dependencias.
// Encoding: UTF-8 con BOM (Excel Windows abre con tildes/ñ correctos).

const BOM = "﻿"

function escapeCell(value: unknown): string {
  if (value == null) return ""
  const s = String(value)
  if (s.includes(",") || s.includes("\"") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

export function buildCSV(headers: string[], rows: unknown[][]): string {
  const lines: string[] = []
  lines.push(headers.map(escapeCell).join(","))
  for (const row of rows) lines.push(row.map(escapeCell).join(","))
  return BOM + lines.join("\r\n")
}

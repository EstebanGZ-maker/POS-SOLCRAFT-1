import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Formats a number as Colombian-style currency: $42.000 (dot thousands, no decimals)
export function formatCurrency(value: number) {
  const rounded = Math.round(Number(value) || 0)
  return "$" + rounded.toLocaleString("es-CO")
}

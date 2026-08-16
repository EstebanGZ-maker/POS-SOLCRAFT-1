"use client"

import * as React from "react"
import { Input } from "@/components/ui/input"
import { fmtNum } from "@/lib/format"

// Money input for COP amounts.
// - Padre almacena number (o number | null si emptyAsNull=true).
// - Muestra separador de miles al perder foco (fmtNum es-CO: 1.500.000).
// - Mientras el usuario tipea, muestra sólo dígitos (sin puntos) para no
//   mover el cursor. Al blur re-formatea.
// - Copiar/pegar "1.500.000" se limpia automáticamente.
// - COP no usa decimales: cualquier no-dígito se descarta.
export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type" | "inputMode"> {
  value: number | null | undefined
  onChange: (value: number | null) => void
  emptyAsNull?: boolean
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onChange, emptyAsNull = false, onFocus, onBlur, autoComplete = "off", ...rest }, ref) => {
    const [focused, setFocused] = React.useState(false)
    const [raw, setRaw] = React.useState<string>(() =>
      value == null ? "" : String(Math.round(value)),
    )

    React.useEffect(() => {
      if (focused) return
      const next = value == null ? "" : String(Math.round(value))
      setRaw((prev) => (prev === next ? prev : next))
    }, [value, focused])

    const display = focused ? raw : raw === "" ? "" : fmtNum(Number(raw))

    function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
      const digits = e.target.value.replace(/\D/g, "")
      setRaw(digits)
      if (digits === "") {
        onChange(emptyAsNull ? null : 0)
      } else {
        onChange(Number(digits))
      }
    }

    return (
      <Input
        ref={ref}
        type="text"
        inputMode="numeric"
        autoComplete={autoComplete}
        value={display}
        onChange={handleChange}
        onFocus={(e) => {
          setFocused(true)
          e.target.select()
          onFocus?.(e)
        }}
        onBlur={(e) => {
          setFocused(false)
          onBlur?.(e)
        }}
        {...rest}
      />
    )
  },
)
MoneyInput.displayName = "MoneyInput"

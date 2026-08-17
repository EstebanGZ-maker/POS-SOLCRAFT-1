"use client"

import * as React from "react"
import { NumericFormat } from "react-number-format"
import { Input } from "@/components/ui/input"

// Money input for COP amounts.
// - Padre almacena number (o number | null si emptyAsNull=true).
// - Formateo EN VIVO con puntos de miles al tipear (es-CO: 1.500.000).
//   El manejo de cursor lo hace react-number-format: al insertar/borrar
//   un dígito con el caret en medio del número, el caret se recoloca en
//   la posición lógica correcta ignorando los puntos.
// - Copiar/pegar "1.500.000" se limpia automáticamente.
// - COP no usa decimales: decimalScale=0 descarta cualquier cifra decimal.
// - No permite negativos.
export interface MoneyInputProps {
  value: number | null | undefined
  onChange: (value: number | null) => void
  emptyAsNull?: boolean
  id?: string
  className?: string
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
  onBlur?: React.FocusEventHandler<HTMLInputElement>
  onFocus?: React.FocusEventHandler<HTMLInputElement>
  autoComplete?: string
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  (
    {
      value,
      onChange,
      emptyAsNull = false,
      id,
      className,
      placeholder,
      disabled,
      autoFocus,
      onBlur,
      onFocus,
      autoComplete = "off",
    },
    ref,
  ) => {
    return (
      <NumericFormat
        thousandSeparator="."
        decimalSeparator=","
        decimalScale={0}
        allowNegative={false}
        // value=null / undefined → "" → display vacío.
        value={value ?? ""}
        onValueChange={(values) => {
          const n = values.floatValue
          if (n === undefined) {
            onChange(emptyAsNull ? null : 0)
          } else {
            onChange(n)
          }
        }}
        customInput={Input}
        getInputRef={ref}
        id={id}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onBlur={onBlur}
        onFocus={(e) => {
          e.target.select()
          onFocus?.(e)
        }}
        inputMode="numeric"
        autoComplete={autoComplete}
      />
    )
  },
)
MoneyInput.displayName = "MoneyInput"

"use client"

import type React from "react"
import { useState } from "react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { X, Sparkles, ChevronUp } from "lucide-react"
import { createContact } from "@/lib/actions"
import { normalizePhoneCO, PHONE_CO_ERROR } from "@/lib/validators/customer"
import { toast } from "@/components/ui/use-toast"

interface NewContactDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreated: (customer: any) => void
}

const ID_TYPES = [
  "Cédula de ciudadanía",
  "Cédula de extranjería",
  "NIT",
  "Pasaporte",
  "Tarjeta de identidad",
]

const DEPARTMENTS = [
  "Bogotá D.C.",
  "Antioquia / Medellín",
  "Valle del Cauca / Cali",
  "Atlántico / Barranquilla",
  "Santander / Bucaramanga",
  "Bolívar / Cartagena",
]

export function NewContactDialog({ open, onOpenChange, onCreated }: NewContactDialogProps) {
  const [idType, setIdType] = useState("")
  const [idNumber, setIdNumber] = useState("")
  const [firstName, setFirstName] = useState("")
  const [secondName, setSecondName] = useState("")
  const [lastNames, setLastNames] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [cityState, setCityState] = useState("")
  const [address, setAddress] = useState("")
  const [postalCode, setPostalCode] = useState("")
  const [saving, setSaving] = useState(false)

  const normalizedPhone = normalizePhoneCO(phone)
  const phoneValid = /^3\d{9}$/.test(normalizedPhone)
  const canSave =
    firstName.trim() !== "" && lastNames.trim() !== "" && phoneValid

  const reset = () => {
    setIdType("")
    setIdNumber("")
    setFirstName("")
    setSecondName("")
    setLastNames("")
    setEmail("")
    setPhone("")
    setCityState("")
    setAddress("")
    setPostalCode("")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    const result = await createContact({
      id_type: idType,
      id_number: idNumber,
      first_name: firstName,
      second_name: secondName,
      last_names: lastNames,
      email,
      phone,
      city_state: cityState,
      address,
      postal_code: postalCode,
    })
    setSaving(false)
    if (result.success && result.customer) {
      toast({ title: "Contacto creado", description: result.message })
      onCreated(result.customer)
      reset()
      onOpenChange(false)
    } else {
      toast({ title: "Error", description: result.message, variant: "destructive" })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden [&>button]:hidden">
        <form onSubmit={handleSubmit} className="flex max-h-[85vh] flex-col">
          {/* Header */}
          <div className="flex items-start justify-between border-b px-6 py-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Nuevo contacto</h2>
              <p className="text-sm text-muted-foreground">
                Crea los contactos que asociarás en tus facturas de venta.{" "}
                <span className="text-primary underline">Saber más</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted"
              aria-label="Cerrar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground">Datos generales</h3>
                <p className="text-sm text-muted-foreground">
                  Ingresa la información principal de tu cliente
                </p>
              </div>
              <ChevronUp className="h-5 w-5 text-muted-foreground" />
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Tipo de identificación</Label>
                <Select value={idType} onValueChange={setIdType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {ID_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Identificación</Label>
                <div className="flex gap-2">
                  <Input
                    value={idNumber}
                    onChange={(e) => setIdNumber(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    className="gap-1.5 text-muted-foreground"
                    disabled
                  >
                    <Sparkles className="h-4 w-4" /> Autocompletar
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>
                    Primer nombre <span className="text-primary">*</span>
                  </Label>
                  <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label>Segundo nombre</Label>
                  <Input value={secondName} onChange={(e) => setSecondName(e.target.value)} />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>
                  Apellidos <span className="text-primary">*</span>
                </Label>
                <Input value={lastNames} onChange={(e) => setLastNames(e.target.value)} required />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Correo</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Celular <span className="text-primary">*</span>
                  </Label>
                  <Input
                    type="tel"
                    inputMode="numeric"
                    placeholder="3001234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    aria-invalid={phone.length > 0 && !phoneValid}
                  />
                  {phone.length > 0 && !phoneValid && (
                    <p className="text-xs text-destructive">{PHONE_CO_ERROR}</p>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Municipio / Departamento</Label>
                <Select value={cityState} onValueChange={setCityState}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Dirección</Label>
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Código postal</Label>
                  <Input value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" className="flex-1" disabled={!canSave || saving}>
              {saving ? "Guardando..." : "Guardar contacto"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

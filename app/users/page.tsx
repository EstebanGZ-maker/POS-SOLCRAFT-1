"use client"

import { useEffect, useMemo, useState } from "react"
import useSWR from "swr"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useToast } from "@/hooks/use-toast"
import {
  getUsers, getSitesForSelect, getUserSiteIds,
  createUser, updateUserProfile, resetUserPassword,
} from "@/lib/user-actions"
import {
  MODULES, GROUP_LABELS, ROLE_DEFAULT_PERMISSIONS,
  type ModuleKey, type UserRole,
} from "@/lib/permissions"
import { UserCog, Shield, MapPin, Users, Plus, KeyRound, Sparkles } from "lucide-react"

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administrador",
  contador: "Contador",
  encargado: "Encargado",
  vendedor: "Vendedor",
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  contador: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  encargado: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  vendedor: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
}

const ROLE_DESC: Record<UserRole, string> = {
  admin: "Acceso total. Ve y opera todas las sedes.",
  contador: "Acceso global de lectura + contabilidad.",
  encargado: "Administra una o varias sedes: inventario, traslados, ventas.",
  vendedor: "Solo POS y clientes en las sedes asignadas.",
}

function groupModules() {
  const groups: Record<string, typeof MODULES> = {}
  for (const m of MODULES) {
    groups[m.group] = groups[m.group] || []
    groups[m.group].push(m)
  }
  return groups
}

function PermissionsSelector({
  selected,
  onChange,
  role,
}: {
  selected: Set<ModuleKey>
  onChange: (next: Set<ModuleKey>) => void
  role: UserRole
}) {
  const groups = useMemo(() => groupModules(), [])
  const toggle = (key: ModuleKey) => {
    const next = new Set(selected)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    onChange(next)
  }
  const applyDefault = () => {
    onChange(new Set(ROLE_DEFAULT_PERMISSIONS[role]))
  }
  const disabled = role === "admin"

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm">Módulos habilitados</Label>
        <Button type="button" size="sm" variant="outline" className="gap-1 h-7" onClick={applyDefault} disabled={disabled}>
          <Sparkles className="h-3 w-3" />
          Aplicar defaults de {ROLE_LABELS[role]}
        </Button>
      </div>
      {disabled && (
        <p className="text-xs text-muted-foreground">
          El administrador tiene acceso a todo automáticamente.
        </p>
      )}
      <div className="rounded-md border max-h-72 overflow-y-auto p-3 space-y-4">
        {Object.entries(groups).map(([groupKey, mods]) => (
          <div key={groupKey}>
            <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">
              {GROUP_LABELS[groupKey as keyof typeof GROUP_LABELS]}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {mods.map((m) => {
                const checked = disabled || selected.has(m.key)
                return (
                  <label
                    key={m.key}
                    className="flex items-start gap-2 rounded-md border p-2 cursor-pointer hover:bg-accent/40"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => !disabled && toggle(m.key)}
                      disabled={disabled}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{m.label}</div>
                      <div className="text-xs text-muted-foreground">{m.description}</div>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SitesSelector({
  sites,
  selected,
  onChange,
  role,
}: {
  sites: any[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  role: UserRole
}) {
  const globalRole = role === "admin" || role === "contador"
  const central = sites.find((s) => s.is_central)
  const stores = sites.filter((s) => !s.is_central)
  // La bodega central solo es asignable a admin/encargado (nunca a vendedor).
  const centralAllowed = role === "admin" || role === "encargado"

  const toggle = (siteId: string) => {
    const next = new Set(selected)
    if (next.has(siteId)) next.delete(siteId)
    else next.add(siteId)
    onChange(next)
  }
  const selectAllStores = () => {
    const next = new Set(selected)
    stores.forEach((s) => next.add(s.site_id))
    onChange(next)
  }
  const clearAll = () => onChange(new Set())

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">Sedes accesibles</Label>
        {!globalRole && stores.length > 0 && (
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={selectAllStores}>
              Todas las tiendas
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={clearAll}>
              Ninguna
            </Button>
          </div>
        )}
      </div>
      {globalRole ? (
        <p className="text-xs text-muted-foreground rounded-md border bg-muted/30 p-3">
          Los roles <b>{ROLE_LABELS[role]}</b> tienen acceso a todas las sedes automáticamente (incluida la bodega central).
        </p>
      ) : (
        <div className="rounded-md border max-h-56 overflow-y-auto p-2 space-y-1">
          {central && (
            <label
              key={central.site_id}
              className={`flex items-center gap-2 rounded p-2 border ${
                centralAllowed ? "cursor-pointer hover:bg-accent/40 border-amber-500/40 bg-amber-500/5" : "opacity-50 cursor-not-allowed border-dashed"
              }`}
              title={centralAllowed ? "" : "Solo admin o encargado pueden acceder a la bodega central."}
            >
              <Checkbox
                checked={centralAllowed && selected.has(central.site_id)}
                disabled={!centralAllowed}
                onCheckedChange={() => centralAllowed && toggle(central.site_id)}
              />
              <span className="text-sm flex-1 flex items-center gap-2">
                {central.name}
                <Badge variant="outline" className="text-[10px] border-amber-500/50 text-amber-700 dark:text-amber-300">
                  Bodega central
                </Badge>
              </span>
              {!centralAllowed && (
                <span className="text-[10px] text-muted-foreground">no permitido para {ROLE_LABELS[role]}</span>
              )}
            </label>
          )}
          {stores.length === 0 && !central && (
            <p className="text-xs text-muted-foreground p-2">No hay sedes creadas.</p>
          )}
          {stores.map((s) => (
            <label
              key={s.site_id}
              className="flex items-center gap-2 rounded p-2 cursor-pointer hover:bg-accent/40"
            >
              <Checkbox
                checked={selected.has(s.site_id)}
                onCheckedChange={() => toggle(s.site_id)}
              />
              <span className="text-sm flex-1">{s.name}</span>
            </label>
          ))}
        </div>
      )}
      {!globalRole && selected.size === 0 && (
        <p className="text-xs text-destructive">Este rol requiere al menos una sede asignada.</p>
      )}
    </div>
  )
}

export default function UsersPage() {
  const { toast } = useToast()
  const { data: users = [], mutate } = useSWR("users-list", getUsers)
  const { data: sites = [] } = useSWR("sites-select", getSitesForSelect)

  const [createOpen, setCreateOpen] = useState(false)
  const [newEmail, setNewEmail] = useState("")
  const [newName, setNewName] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [newRole, setNewRole] = useState<UserRole>("vendedor")
  const [newSiteIds, setNewSiteIds] = useState<Set<string>>(new Set())
  const [newPerms, setNewPerms] = useState<Set<ModuleKey>>(new Set(ROLE_DEFAULT_PERMISSIONS.vendedor))
  const [creating, setCreating] = useState(false)

  const [editUser, setEditUser] = useState<any | null>(null)
  const [editRole, setEditRole] = useState<UserRole>("vendedor")
  const [editName, setEditName] = useState("")
  const [editActive, setEditActive] = useState(true)
  const [editSiteIds, setEditSiteIds] = useState<Set<string>>(new Set())
  const [editPerms, setEditPerms] = useState<Set<ModuleKey>>(new Set())
  const [saving, setSaving] = useState(false)

  const [pwUser, setPwUser] = useState<any | null>(null)
  const [newPw, setNewPw] = useState("")
  const [confirmPw, setConfirmPw] = useState("")
  const [resetting, setResetting] = useState(false)

  function resetCreateForm() {
    setNewEmail("")
    setNewName("")
    setNewPassword("")
    setNewRole("vendedor")
    setNewSiteIds(new Set())
    setNewPerms(new Set(ROLE_DEFAULT_PERMISSIONS.vendedor))
  }

  useEffect(() => {
    setNewPerms(new Set(ROLE_DEFAULT_PERMISSIONS[newRole]))
  }, [newRole])

  async function handleCreate() {
    if (!newEmail || !newPassword || !newName) {
      toast({ title: "Error", description: "Nombre, correo y contraseña son obligatorios.", variant: "destructive" })
      return
    }
    if (newPassword.length < 6) {
      toast({ title: "Error", description: "La contraseña debe tener al menos 6 caracteres.", variant: "destructive" })
      return
    }
    const isGlobal = newRole === "admin" || newRole === "contador"
    if (!isGlobal && newSiteIds.size === 0) {
      toast({ title: "Error", description: "Encargado y vendedor requieren al menos una sede.", variant: "destructive" })
      return
    }
    setCreating(true)
    const siteIdsArr = Array.from(newSiteIds)
    const res = await createUser({
      email: newEmail,
      password: newPassword,
      full_name: newName,
      role: newRole,
      site_id: siteIdsArr[0] ?? null,
      site_ids: siteIdsArr,
      permissions: Array.from(newPerms),
    })
    toast({
      title: res.success ? "Usuario creado" : "Error",
      description: res.message,
      variant: res.success ? "default" : "destructive",
    })
    if (res.success) {
      setCreateOpen(false)
      resetCreateForm()
      mutate()
    }
    setCreating(false)
  }

  async function openEdit(user: any) {
    setEditUser(user)
    setEditRole(user.role)
    setEditName(user.full_name || "")
    setEditActive(user.is_active)
    setEditPerms(new Set((user.permissions || []) as ModuleKey[]))
    const ids = await getUserSiteIds(user.id)
    const set = new Set(ids)
    if (set.size === 0 && user.site_id) set.add(user.site_id)
    setEditSiteIds(set)
  }

  useEffect(() => {
    if (editUser && editRole === "admin") {
      setEditPerms(new Set(ROLE_DEFAULT_PERMISSIONS.admin))
    }
  }, [editRole, editUser])

  async function handleSave() {
    if (!editUser) return
    const isGlobal = editRole === "admin" || editRole === "contador"
    if (!isGlobal && editSiteIds.size === 0) {
      toast({ title: "Error", description: "Encargado y vendedor requieren al menos una sede.", variant: "destructive" })
      return
    }
    setSaving(true)
    const siteIdsArr = Array.from(editSiteIds)
    const res = await updateUserProfile(editUser.id, {
      role: editRole,
      site_id: isGlobal ? null : (siteIdsArr[0] ?? null),
      site_ids: siteIdsArr,
      permissions: Array.from(editPerms),
      full_name: editName || null,
      is_active: editActive,
    })
    toast({
      title: res.success ? "Guardado" : "Error",
      description: res.message,
      variant: res.success ? "default" : "destructive",
    })
    if (res.success) {
      setEditUser(null)
      mutate()
    }
    setSaving(false)
  }

  async function handleResetPassword() {
    if (!pwUser) return
    if (newPw.length < 6) {
      toast({ title: "Error", description: "Mínimo 6 caracteres.", variant: "destructive" })
      return
    }
    if (newPw !== confirmPw) {
      toast({ title: "Error", description: "Las contraseñas no coinciden.", variant: "destructive" })
      return
    }
    setResetting(true)
    const res = await resetUserPassword(pwUser.id, newPw)
    toast({
      title: res.success ? "Contraseña cambiada" : "Error",
      description: res.message,
      variant: res.success ? "default" : "destructive",
    })
    if (res.success) {
      setPwUser(null)
      setNewPw("")
      setConfirmPw("")
    }
    setResetting(false)
  }

  const siteName = (user: any) => {
    if (user.role === "admin" || user.role === "contador") return "Global"
    return (user.sites as any)?.name || (user.site_id ? "—" : "Sin sede")
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <PageHeader
          title="Gestión de usuarios"
          description="Crea usuarios, define roles, sedes accesibles y módulos habilitados."
          icon={UserCog}
        />
        <Button onClick={() => { resetCreateForm(); setCreateOpen(true) }} className="gap-2">
          <Plus className="h-4 w-4" />
          Crear usuario
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {(["admin", "contador", "encargado", "vendedor"] as UserRole[]).map((r) => (
          <Card key={r}>
            <CardContent className="p-4 flex items-center gap-3">
              <Shield className="h-5 w-5 text-muted-foreground" />
              <div>
                <div className="text-sm text-muted-foreground">{ROLE_LABELS[r]}</div>
                <div className="text-xl font-bold">{users.filter((u: any) => u.role === r).length}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Sedes</TableHead>
                <TableHead>Módulos</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="w-32 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user: any) => (
                <TableRow key={user.id} className={!user.is_active ? "opacity-50" : ""}>
                  <TableCell className="font-medium">{user.email}</TableCell>
                  <TableCell>{user.full_name || "—"}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={ROLE_COLORS[user.role as UserRole]}>
                      {ROLE_LABELS[user.role as UserRole] || user.role}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1 text-sm">
                      <MapPin className="h-3 w-3" />
                      {siteName(user)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="text-xs text-muted-foreground">
                      {user.role === "admin"
                        ? "Todos"
                        : `${(user.permissions || []).length} módulo(s)`}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.is_active ? "default" : "outline"}>
                      {user.is_active ? "Activo" : "Inactivo"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setPwUser(user); setNewPw(""); setConfirmPw("") }} title="Cambiar contraseña">
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => openEdit(user)}>
                        Editar
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                    No hay usuarios registrados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Crear nuevo usuario</DialogTitle>
            <DialogDescription>
              Define rol, sedes accesibles y módulos que podrá usar.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>Nombre completo *</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Juan Pérez" />
              </div>
              <div>
                <Label>Correo electrónico *</Label>
                <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="juan@solcraft.dev" />
              </div>
              <div>
                <Label>Contraseña *</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Mínimo 6 caracteres" autoComplete="new-password" />
              </div>
              <div>
                <Label>Rol</Label>
                <Select value={newRole} onValueChange={(v) => setNewRole(v as UserRole)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Administrador</SelectItem>
                    <SelectItem value="contador">Contador</SelectItem>
                    <SelectItem value="encargado">Encargado</SelectItem>
                    <SelectItem value="vendedor">Vendedor</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">{ROLE_DESC[newRole]}</p>
              </div>
            </div>
            <Separator />
            <SitesSelector sites={sites} selected={newSiteIds} onChange={setNewSiteIds} role={newRole} />
            <Separator />
            <PermissionsSelector selected={newPerms} onChange={setNewPerms} role={newRole} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button onClick={handleCreate} disabled={creating}>
              {creating ? "Creando..." : "Crear usuario"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={!!editUser} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Editar usuario</DialogTitle>
            <DialogDescription>{editUser?.email}</DialogDescription>
          </DialogHeader>
          {editUser && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Nombre completo</Label>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
                </div>
                <div>
                  <Label>Rol</Label>
                  <Select value={editRole} onValueChange={(v) => setEditRole(v as UserRole)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">Administrador</SelectItem>
                      <SelectItem value="contador">Contador</SelectItem>
                      <SelectItem value="encargado">Encargado</SelectItem>
                      <SelectItem value="vendedor">Vendedor</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">{ROLE_DESC[editRole]}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Switch checked={editActive} onCheckedChange={setEditActive} />
                <Label>{editActive ? "Usuario activo" : "Usuario inactivo"}</Label>
              </div>
              <Separator />
              <SitesSelector sites={sites} selected={editSiteIds} onChange={setEditSiteIds} role={editRole} />
              <Separator />
              <PermissionsSelector selected={editPerms} onChange={setEditPerms} role={editRole} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditUser(null)}>Cancelar</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Guardando..." : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!pwUser} onOpenChange={(open) => !open && setPwUser(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Cambiar contraseña</DialogTitle>
            <DialogDescription>{pwUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nueva contraseña</Label>
              <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Mínimo 6 caracteres" autoComplete="new-password" />
            </div>
            <div>
              <Label>Confirmar contraseña</Label>
              <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="Repite la contraseña" autoComplete="new-password" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwUser(null)}>Cancelar</Button>
            <Button onClick={handleResetPassword} disabled={resetting}>
              {resetting ? "Cambiando..." : "Cambiar contraseña"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Plus, X } from "lucide-react"

export interface PosTab {
  id: string
  label: string
  itemCount: number
}

interface TabBarProps {
  tabs: PosTab[]
  activeId: string
  onSelect: (id: string) => void
  onAdd: () => void
  onClose: (id: string) => void
}

export function TabBar({ tabs, activeId, onSelect, onAdd, onClose }: TabBarProps) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b bg-muted/30 px-2 py-1">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelect(tab.id)}
          className={cn(
            "group relative flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-sm transition-colors",
            tab.id === activeId
              ? "border border-b-0 bg-card font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <span className="max-w-[120px] truncate">{tab.label}</span>
          {tab.itemCount > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
              {tab.itemCount}
            </span>
          )}
          {tabs.length > 1 && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.stopPropagation()
                  onClose(tab.id)
                }
              }}
              className={cn(
                "ml-0.5 flex h-4 w-4 items-center justify-center rounded-sm transition-opacity",
                tab.id === activeId
                  ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  : "opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive",
              )}
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </button>
      ))}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 text-muted-foreground"
        onClick={onAdd}
        aria-label="Nueva pestaña"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  )
}

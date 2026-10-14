-- s29 — Rubro por instancia (base del perfil IA de /central).
--
-- Agrega `business_settings.rubro TEXT NOT NULL DEFAULT 'ropa'` con un
-- CHECK que limita los valores a los rubros soportados por el repo.
--
-- Preserva comportamiento ropa en instancias existentes: Solcraft y
-- Taiwy Sport quedan `rubro='ropa'` por default. El UPDATE a
-- `'tecnologia'` para celulares-carmen va APARTE como intervención
-- manual registrada (no se mete en esta migración para no acoplar
-- schema con config de una instancia específica).
--
-- CHECK (rubro IN ('ropa','tecnologia')): un error de tipeo debe
-- fallar a la vista, no caer en 'ropa' en silencio. Con el mapa de
-- perfiles en `lib/rubro-profiles.ts`, agregar un rubro ya exige un
-- commit en código → la migración extra para ampliar el CHECK cuesta
-- lo mismo (ALTER TABLE … DROP CONSTRAINT … ADD CONSTRAINT …), y la
-- defensa in-DB evita que un UPDATE libre deje la columna en estado
-- inválido. Si en el futuro se promueve `rubro` a tabla
-- (`rubro_profiles` con FK), este CHECK se reemplazaría en esa misma
-- migración por el FK constraint.
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + DROP CONSTRAINT IF EXISTS +
-- ADD CONSTRAINT. Se puede re-aplicar sobre una instancia ya migrada.
--
-- Orden canario de aplicación: celulares-carmen → Solcraft → Taiwy Sport.

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS rubro TEXT NOT NULL DEFAULT 'ropa';

ALTER TABLE business_settings
  DROP CONSTRAINT IF EXISTS business_settings_rubro_check;

ALTER TABLE business_settings
  ADD CONSTRAINT business_settings_rubro_check
  CHECK (rubro IN ('ropa','tecnologia'));

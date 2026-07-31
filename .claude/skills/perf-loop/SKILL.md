---
name: perf-loop
description: Optimiza el rendimiento del POS iterando ruta por ruta hasta que todas carguen bajo presupuesto. Diseñada para consumir el mínimo de tokens. Úsala junto con /goal.
argument-hint: "[presupuesto-ms opcional, default 1000]"
allowed-tools: Bash(node scripts/measure-perf.mjs*), Bash(npx*), Read, Grep, Edit
disable-model-invocation: true
---

# Loop de optimización de rendimiento — bajo consumo de tokens

Objetivo: cada ruta del POS con LCP < ${ARGUMENTS:-1000}ms, medido por
`scripts/measure-perf.mjs`. Este flujo está diseñado para gastar el mínimo de tokens.

## Reglas de economía de contexto (IMPORTANTES)

- **NO leas todo el código.** En cada iteración carga solo los archivos de la ruta
  que estás arreglando (su page.tsx, su server action, su query). Usa `Grep` para
  localizar, no `Read` de directorios enteros.
- **NO vuelques logs.** El script ya escribe un resumen compacto en `perf-results.json`.
  Lee ese archivo, no la salida cruda del navegador.
- **Una ruta por iteración**: la más lenta (`slowest` en el JSON). Ignora el resto
  hasta que esa pase.
- **Re-mide solo esa ruta** con `--route <path>`, no toda la suite.
- **Compacta entre iteraciones**: cuando termines una ruta, resume en 2-3 líneas qué
  cambiaste y por qué, y descarta el detalle de exploración.
- Máximo **3 intentos por ruta**. Si no baja, documenta el cuello de botella en
  `perf-notes.md` y pasa a la siguiente.

## Ciclo

1. **Medir todo (una vez al inicio):**
   ```
   node scripts/measure-perf.mjs --json
   ```
   Lee `perf-results.json`. Si `fails` está vacío → terminado, reporta y detente.

2. **Elegir objetivo:** toma `slowest.path`.

3. **Diagnosticar (barato):**
   - Si en la medición `total >> lcp` para esa ruta → el cuello es backend/DB.
     Localiza el server action con `Grep`, saca la query Supabase, córrela con
     `EXPLAIN ANALYZE` (vía MCP Supabase o SQL Editor).
   - Si `lcp` domina → es front. Revisa si el page.tsx importa libs pesadas
     (recharts, jsbarcode) que deberían ser dynamic import.
   - Consulta los patrones en `@PERFORMANCE.md` según el caso; no repitas el análisis
     completo en el chat.

4. **Aplicar UN cambio dirigido** (el de mayor retorno según el orden de ataque de
   PERFORMANCE.md). Un cambio por vez para saber qué funcionó.

5. **Re-medir solo esa ruta:**
   ```
   node scripts/measure-perf.mjs --route <path>
   ```
   - Pasa → resume en 2-3 líneas y vuelve al paso 1 (re-mide todo, puede haber
     cambiado el ranking).
   - No pasa y llevas <3 intentos → vuelve al paso 3.
   - No pasa y llevas 3 intentos → anota en `perf-notes.md` y pasa a la siguiente
     ruta que falle.

6. Repite hasta que `perf-results.json` reporte `fails: []`.

## Salida final

Cuando todas pasen, entrega un resumen breve: rutas optimizadas, el cambio clave de
cada una, y cualquier ruta que quedó marcada como difícil en `perf-notes.md`.

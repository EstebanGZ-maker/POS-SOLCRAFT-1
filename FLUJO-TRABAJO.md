# Flujo de trabajo con Claude Code — POS-SOLCRAFT

Guía de hábitos para trabajar en este monorepo sin agotar el contexto ni el
límite de 5 horas a mitad de jornada.

## 1. Reestructuración del CLAUDE.md (ya hecha)

- `CLAUDE.md` raíz: solo principios rectores, roles, stack, convenciones y el
  mapa del proyecto. Se carga siempre, es corto.
- `app/<módulo>/CLAUDE.md`: reglas de negocio de ese módulo. Se carga solo
  cuando referencias esa carpeta.
- `SUPABASE.md`, `ROADMAP.md`, `PERFORMANCE.md`: se cargan bajo demanda con
  `@archivo.md` en el prompt, no automáticamente.

Efecto esperado: cada sesión arranca con ~1/4 del contexto que arrancaba
antes (cuando todo vivía en un único CLAUDE.md de 200+ líneas).

## 2. Trabaja por bloques, no por jornada completa

En vez de una sesión continua todo el día:

1. Elige el módulo/tarea del bloque (ej: "arreglar promociones en POS").
2. Empieza la sesión referenciando explícitamente el `CLAUDE.md` de ese
   módulo: `@app/pos/CLAUDE.md, quiero que...`
3. Termina el bloque → `/clear`.
4. Si necesitas retomar contexto de un bloque anterior, `/resume` en vez de
   dejarlo todo acumulado en una sola conversación.

Regla simple: **cambiaste de módulo o de tipo de tarea (feature → debugging,
backend → frontend) = `/clear`.**

## 3. Sé explícito con el alcance

- Referencia archivos concretos en vez de pedir exploración abierta del repo:
  "revisa `lib/actions.ts` y `app/pos/page.tsx`", no "revisa todo el POS".
  Esto importa más en este proyecto por ser monorepo grande — una
  exploración abierta puede terminar leyendo módulos que no tocan la tarea.
- Una tarea = un objetivo cerrado. "Implementa pagos mixtos en el diálogo de
  cobro" en vez de "mejora el POS para que se parezca más a Alegra" (esto
  último son ~6 tareas distintas, ver `ROADMAP.md`).

## 4. Cuándo cargar los documentos bajo demanda

| Documento | Cárgalo cuando... |
|---|---|
| `@SUPABASE.md` | vas a tocar esquema, RPCs, o necesitas el detalle de conexión |
| `@ROADMAP.md` | vas a planear qué sigue o priorizar deudas técnicas |
| `@PERFORMANCE.md` | vas a optimizar o corres `measure-perf.mjs` |

No los referencies "por si acaso" — eso es exactamente el contexto que
sobra en cada sesión.

## 5. Delega en subagentes lo que no necesita estar en el hilo principal

Para comparar un módulo contra Alegra (research), revisar seguridad de RLS,
o planear una fase completa (ej. Fase 2 de traslados con estados), delega a
un subagente. Cada uno tiene su propia ventana y no infla la sesión principal
donde estás implementando.

## 6. Cambios de modelo

Si cambias de modelo (`/model`) a mitad de una sesión larga, el siguiente
request relee todo el historial sin caché — puede consumir una porción
grande del límite de golpe. Mejor: decide el modelo al empezar el bloque
(Sonnet para la mayoría de tareas de este repo; sube a un modelo más potente
solo para diseño de RPCs complejas o revisión de invariantes de kardex).

## 7. Monitorea

Corre `/usage` un par de veces por bloque para ver cuánto llevas del límite
de 5 horas y decidir si conviene cerrar el bloque antes, o bajar de modelo
para lo que falta del día.

## 8. Cómo escribir el prompt con `@archivo`

`@archivo` carga el contenido de ese archivo en el contexto de esa consulta,
sumado a lo que ya tienes cargado (raíz + `CLAUDE.md` del módulo activo).
Fórmula: `@archivo(s) [qué quieres que haga] [con qué archivo/función/tabla]`.

Antes de escribir el prompt, pregúntate: "¿qué documento tiene la respuesta a
esto que Claude no sabe todavía por defecto?" Si la respuesta es "ninguno, ya
está en lo que carga automático", no agregues nada — cargar de más es el
hábito que estamos tratando de romper.

| Si la tarea es... | Referencia |
|---|---|
| Bug en un RPC o el esquema | `@SUPABASE.md` |
| Feature nueva o priorización | `@ROADMAP.md` |
| Algo lento | `@PERFORMANCE.md` |
| Solo lógica de un módulo (UI, server action) | nada extra — ya tienes raíz + `CLAUDE.md` del módulo |
| Cruza dos módulos (ej. venta que afecta contabilidad) | los `CLAUDE.md` de ambos módulos |

Ejemplos:
```
@SUPABASE.md revisa por qué el RPC transfer_stock no está descontando bien el stock
@app/pos/CLAUDE.md @ROADMAP.md quiero implementar pagos mixtos en el diálogo de cobro, sigue la prioridad que marca el roadmap
@ROADMAP.md ¿qué le falta a Traslados para llegar a Fase 2?
```

## 9. Seguridad (aparte de contexto)

El `CLAUDE.md` original tenía la contraseña del usuario de desarrollo en
texto plano. Si ese archivo está versionado en el repo, muévela a
`.env.local` o a un gestor de secretos — no por optimización de contexto,
sino porque un `CLAUDE.md` committeado con credenciales es un riesgo real.

# tests/snapshots/rubro-ropa/

Fixture mecánico del perfil IA "ropa" + verificación de aislamiento
ropa↔tecnología. **No se escribe a mano** — todo lo que vive en
`outputs/` se regenera desde el código actual con `run.mjs`.

## Cuándo usarlo

- **Antes del refactor del perfil IA** (`main @ 1aff84b` y posteriores
  hasta que se mergee `feat/ia-rubro-perfil`): el fixture captura el
  estado actual de `app/api/analyze-product/route.ts` y
  `components/central/ai-ingress-panel.tsx` y lo congela como
  referencia inmutable del comportamiento de ropa.
- **Después del refactor**: el mismo script, con `--source=profile`,
  genera el fixture a partir de `getRubroProfile('ropa')` definido en
  `lib/rubro-profiles.ts`. **El output debe ser idéntico byte a byte**
  — si cambia un carácter del prompt, un placeholder o la etiqueta de
  un campo, el fixture falla.

## Comandos

```bash
# Regenerar outputs/ (pre-refactor):
node tests/snapshots/rubro-ropa/run.mjs

# Verificar byte a byte sin git (post-refactor):
node tests/snapshots/rubro-ropa/run.mjs --source=profile --verify

# Verificar aislamiento ropa↔tecnología (post-refactor):
node tests/snapshots/rubro-ropa/run.mjs --isolation
```

## Qué contiene `outputs/`

| Archivo | Qué guarda | Fuente de verdad |
|---|---|---|
| `prompt-{no,with}-hint-{image,video}.json` | Argumentos exactos que recibe `generateObject`: model, maxRetries, instructions y la estructura completa de messages (incluyendo plantilla de usuario con y sin hint, imagen y video). | `--source=route`: ejecuta `route.POST()` con mocks determinísticos; `--source=profile`: reconstruye del perfil. |
| `schema-jsonschema.json` | JSON Schema real del esquema del producto, compilado con `ai.zodSchema(...).jsonSchema`. | Esquema Zod del route o del perfil. |
| `schema-fields.json` | Lista plana `[{key, type, isInt, description}]` para diffs legibles. | Walk de `schema.shape` + `._def`. |
| `ui-labels.json` | Pares `<Label>` + input/placeholder/maxLength extraídos por AST del panel. | `--source=route`: AST de `ai-ingress-panel.tsx`; `--source=profile`: `profile.ui.labels`. |
| `ui-constants.json` | `PREFIX_HINTS` + `AI_MIN_INTERVAL_MS`. | AST / perfil. |
| `ui-hero.txt` | Texto del párrafo hero del panel, con etiquetas JSX stripeadas y espacios normalizados. | AST / perfil. |
| `client-fallbacks.json` | Defaults iniciales de `IngressItem` + los `product.X ?? FALLBACK` del callback `analyze()`. | Regex del fuente / perfil. |
| `response-full-object.json` | Status + body cuando `generateObject` devuelve los 9 campos del schema. | `routeMod.POST()` con `__ropa_ai_result = FULL_AI_RESULT`. |
| `response-gemini-throws.json` | Status 500 + body cuando `generateObject` lanza. Mensaje fijo `"simulated gemini 429 rate limit"` para determinismo. | `routeMod.POST()` con `__ropa_ai_mode = "throw"`. |
| `response-missing-dataurl.json` | Status 400 cuando el body no trae `dataUrl`. | `routeMod.POST(req sin dataUrl)`. |
| `response-malformed-dataurl.json` | Status 400 cuando `dataUrl` no es string. | `routeMod.POST(req con dataUrl: 12345)`. |
| `media-{image-jpeg,octet-stream,empty,video-mp4}.json` | Normalización de `mediaType` del commit 700c6aa: `image/jpeg`→`image/jpeg`, `application/octet-stream`→`image/jpeg`, `""`→`image/jpeg`, `video/mp4`→`video/mp4`. Guarda `{inputMediaType, sentToGemini, status}`. | `captures[0].messages[0].content[file].mediaType` tras `routeMod.POST()`. |

## Determinismo

- `dataUrl` fijo: `data:image/jpeg;base64,FAKE` o `data:video/mp4;base64,FAKE`.
- Hint fijo: `camisa monastery` (ya aparece como ejemplo en el prompt).
- Ningún `Date.now()` ni UUID random en los outputs. Los temporales de
  `_tmp/` tampoco llevan sufijos.

## Aislamiento (`--isolation`)

Verificaciones automáticas:

1. Perfil **ropa** contiene ≥1 marcador del dominio ropa.
2. Perfil **ropa** NO contiene ningún marcador de tecnología.
3. Perfil **tecnología** contiene ≥1 marcador de tecnología (post-refactor).
4. Perfil **tecnología** NO contiene ningún marcador de ropa, excluyendo
   la frase de rechazo `"no corresponde al rubro"` (que vive en una
   constante propia del perfil tecnología y se verifica aparte).
5. `getRubroProfile('tecnologia')` contiene la frase de rechazo;
   `getRubroProfile('ropa')` NO la contiene.
6. `getRubroProfile('desconocido')` lanza excepción.
7. `wordMatches` matchea por palabra completa (no subcadena), con NFD
   + strip accents + lowercase + lookarounds `(?<![a-z0-9])term(?![a-z0-9])`.
   Casos de prueba: `'mah' en 'manana'` NO matchea; `'funda' en
   'fundamental'` NO matchea; `'usb-c' en 'un usb-c power'` SÍ matchea.
8. **Fail-closed** (solo tras el refactor): si `business_settings.rubro`
   da error o devuelve vacío, `route.POST()` responde con status ≥ 400
   y **NO** invoca `generateObject` — nunca cae a 'ropa' por default.

Scope del escaneo cruzado: `instructions` + `messageTemplate` + todos
los `description` del schema + `ui.labels[].{label,placeholder}` +
`ui.hero` + valores string de `ui.constants`.

## Advertencia — error de género en la plantilla de usuario del perfil ropa

El mensaje al usuario del route actual (main @ 1aff84b) contiene un error
de género:

> `"Analiza este imagen de una prenda de ropa..."` (lo correcto sería
> `"Analiza esta imagen..."`).

**El perfil `ropa`, tras el refactor, debe conservarlo BYTE A BYTE** — si
lo arreglás junto con el refactor, `--verify` falla sobre
`prompt-*-image.json` y vas a confundir "lo arreglé" con "rompí algo".

Fix "correcto" = commit **aparte**, posterior al merge del refactor:
`feat(perfil-ropa): corregir género del mensaje al usuario` que regenera
el fixture a propósito, con la mutación visible en el diff.

El perfil `tecnologia` arranca con Spanish correcto desde el día uno (no
hereda el bug) — la asimetría es deliberada y queda documentada acá.

## Alcance del fixture

El fixture captura lo que define al perfil IA del rubro. **No** captura:

- Estado del formulario (`code` vacío = autogenerar — permanece en el panel).
- Lógica del endpoint (reintentos, normalización de mediaType, manejo
  de errores). El refactor conserva ese código tal cual.
- `resolveCategoryId` en `lib/inventory-actions.ts`: el flag
  `allowCreateCategory` del perfil se consume ahí; su default queda
  idéntico al comportamiento actual (true para ropa).

## Si un diff rompe el fixture

- **Intencional** (cambio deliberado del perfil): regenerar con
  `node tests/snapshots/rubro-ropa/run.mjs`, revisar el diff de
  `outputs/`, committear con el commit del cambio.
- **No intencional**: el refactor movió un string. Localizar en el
  diff el archivo divergente, revertir el cambio en la fuente.

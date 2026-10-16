#!/usr/bin/env node
// Captura mecánica del perfil IA "ropa" + verificación de aislamiento.
//
// Modos:
//   --source=route    (default, pre-refactor) extrae de route.ts + panel.tsx
//   --source=profile  (post-refactor) extrae de lib/rubro-profiles.ts
//
// Flags:
//   --verify     Regenera a _verify/ y compara byte a byte contra outputs/
//                sin usar git. Exit 1 ante cualquier diferencia.
//   --isolation  Verifica cruzado ropa↔tecnología: marcadores de dominio
//                prohibidos en el perfil contrario, frase de rechazo
//                presente solo en tecnología, rubro desconocido lanza
//                excepción, fail-closed si business_settings.rubro falla.
//
// Dependencias: `typescript` + `ai` (ambas ya en package.json). Sin tsx,
// sin zod-to-json-schema. Resolución bare-import de "zod" vía
// node_modules del repo (walk ascendente desde _tmp/).

import fs from "node:fs"
import path from "node:path"
import url from "node:url"
import ts from "typescript"
import { zodSchema as aiZodSchema } from "ai"

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, "../../..")
const OUT_DIR = path.join(__dirname, "outputs")
const TMP_DIR = path.join(__dirname, "_tmp")
const MOCKS_DIR = path.join(__dirname, "_mocks")
const VERIFY_DIR = path.join(__dirname, "_verify")

// ---------- CLI args --------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=")
    return [k, v === undefined ? true : v]
  }),
)
const MODE_SOURCE = args.source || "route"
const DO_VERIFY = !!args.verify
const DO_ISOLATION = !!args.isolation

// ---------- Captura: variantes y valores deterministas ---------------
const DUMMY_DATAURL_IMAGE = "data:image/jpeg;base64,FAKE"
const DUMMY_DATAURL_VIDEO = "data:video/mp4;base64,FAKE"
const DUMMY_HINT = "camisa monastery"
const VARIANTS = [
  ["no-hint-image",   { dataUrl: DUMMY_DATAURL_IMAGE, mediaType: "image/jpeg" }],
  ["with-hint-image", { dataUrl: DUMMY_DATAURL_IMAGE, mediaType: "image/jpeg", hint: DUMMY_HINT }],
  ["no-hint-video",   { dataUrl: DUMMY_DATAURL_VIDEO, mediaType: "video/mp4" }],
  ["with-hint-video", { dataUrl: DUMMY_DATAURL_VIDEO, mediaType: "video/mp4", hint: DUMMY_HINT }],
]

// ---------- Isolation: listas de marcadores cruzados -----------------
// Normalización: NFD + strip accents + lowercase + regex con lookarounds
// `(?<![a-z0-9])term(?![a-z0-9])` para palabra completa (los term usan
// solo [a-z0-9-]). Esto evita falsos positivos tipo "mah" ⊂ "cumaha".
export const ROPA_MARKERS = [
  "prenda", "prendas",
  "talla", "tallas",
  "camisa", "camisas",
  "pantalon", "pantalones",
  "vestido", "vestidos",
  "blusa", "blusas",
  "chaqueta", "chaquetas",
  "buzo", "buzos",
  "sueter", "sueteres",
  "short", "shorts",
  "zapato", "zapatos",
  "falda", "faldas",
  // "ropa" como palabra abstracta aparece hoy en el prompt ("almacén de
  // ropa") como contexto no específico — se omite para no obligar al
  // perfil tecnología a inventar un rodeo. Si en algún momento el perfil
  // tecnología usa "ropa" como término de dominio, agregarlo acá.
]
export const TECNOLOGIA_MARKERS = [
  "funda", "fundas",
  "celular", "celulares",
  "cargador", "cargadores",
  "audifono", "audifonos",
  "powerbank", "powerbanks",
  "parlante", "parlantes",
  // "cable" se omite: puede aparecer como accesorio en descripciones de ropa.
  "iphone", "samsung", "redmi", "xiaomi", "honor", "oppo", "infinix", "tecno",
  "almacenamiento",
  "lightning",
  "usb-c", "usbc",
  "mah",
]
// Frase que el perfil tecnología usa cuando la imagen no es del rubro
// (p.ej. una prenda subida al panel de celulares). Vive en su propia
// constante dentro del perfil y se excluye del escaneo negativo —
// sin esta exclusión el perfil tecnología fallaría por mencionar
// "prenda" o "ropa" en el texto de rechazo. Se verifica aparte.
export const REJECTION_PHRASE_TECNOLOGIA = "no corresponde al rubro"

// ---------- Utilitarios ----------------------------------------------
const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true })
const mkd = (p) => fs.mkdirSync(p, { recursive: true })
const writeJSON = (p, obj) => fs.writeFileSync(p, JSON.stringify(obj, null, 2) + "\n")
const writeText = (p, text) => fs.writeFileSync(p, text.endsWith("\n") ? text : text + "\n")
const stripAccents = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
export function wordMatches(haystackNormalized, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "u")
  return re.test(haystackNormalized)
}

function transpileToMjs(tsSource, { importRewrites = {}, jsx = false } = {}) {
  let rewritten = tsSource
  for (const [bare, replacement] of Object.entries(importRewrites)) {
    const re = new RegExp(`from\\s+["']${bare.replace(/[/\-]/g, "\\$&")}["']`, "g")
    rewritten = rewritten.replace(re, `from "${replacement}"`)
  }
  const out = ts.transpileModule(rewritten, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: jsx ? ts.JsxEmit.ReactJSX : ts.JsxEmit.Preserve,
    },
  }).outputText
  return out
}

// ---------- Loader del route transpilado ----------------------------
async function loadRouteWithMocks(cacheBuster = "") {
  const routeSrc = fs.readFileSync(path.join(REPO_ROOT, "app/api/analyze-product/route.ts"), "utf8")
  const aiMock = url.pathToFileURL(path.join(MOCKS_DIR, "ai.mjs")).href
  const nextMock = url.pathToFileURL(path.join(MOCKS_DIR, "next-server.mjs")).href
  const supaMock = url.pathToFileURL(path.join(MOCKS_DIR, "supabase-server.mjs")).href
  const transpiled = transpileToMjs(routeSrc, {
    importRewrites: { "ai": aiMock, "next/server": nextMock, "@/lib/supabase/server": supaMock },
  })
  const genPath = path.join(TMP_DIR, "route.generated.mjs")
  fs.writeFileSync(genPath, transpiled)
  const q = cacheBuster ? `?t=${cacheBuster}` : ""
  return import(url.pathToFileURL(genPath).href + q)
}

function resetAiGlobals() {
  globalThis.__ropa_ai_mode = "capture"
  globalThis.__ropa_ai_result = {}
  delete globalThis.__ropa_ai_error_message
}

// Fixed deterministic "complete object" for response-full capture. Nueve
// campos del schema con valores que replican una respuesta ejemplar de
// Gemini para una camisa manga larga a cuadros (COP, talla M, cantidad 1).
const FULL_AI_RESULT = {
  name: "Camisa manga larga a cuadros",
  type_prefix: "CA",
  category: "Camisas",
  description: "Camisa manga larga a cuadros azul y rojo",
  size: "M",
  color: "azul",
  suggested_price: 95000,
  suggested_cost: 45000,
  quantity: 1,
}

// ---------- Captura de prompts (args de generateObject) --------------
async function capturePrompts(outDir, routeMod) {
  resetAiGlobals()
  const captures = []
  globalThis.__ropa_capture = (a) => captures.push(a)

  let lastSchema = null
  for (const [label, body] of VARIANTS) {
    captures.length = 0
    const req = new Request("http://x/", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })
    const resp = await routeMod.POST(req)
    if (!resp || resp.status !== 200) throw new Error(`Route returned ${resp?.status} for ${label}`)
    if (captures.length !== 1) throw new Error(`Expected 1 capture for ${label}, got ${captures.length}`)
    const [a] = captures
    lastSchema = a.schema
    writeJSON(path.join(outDir, `prompt-${label}.json`), {
      model: a.model,
      maxRetries: a.maxRetries,
      instructions: a.instructions,
      messages: a.messages,
    })
  }
  if (!lastSchema) throw new Error("No schema captured")
  writeJSON(path.join(outDir, "schema-jsonschema.json"), aiZodSchema(lastSchema).jsonSchema)
  const fields = Object.entries(lastSchema.shape).map(([key, f]) => ({
    key,
    type: f._def.typeName,
    isInt: Array.isArray(f._def.checks) && f._def.checks.some((c) => c.kind === "int"),
    description: f.description ?? null,
  }))
  writeJSON(path.join(outDir, "schema-fields.json"), fields)
}

// ---------- Captura de respuestas y errores --------------------------
async function captureResponses(outDir, routeMod) {
  // Scenario 1: generateObject devuelve un objeto completo de 9 campos.
  resetAiGlobals()
  globalThis.__ropa_ai_result = FULL_AI_RESULT
  const req1 = new Request("http://x/", {
    method: "POST",
    body: JSON.stringify({ dataUrl: DUMMY_DATAURL_IMAGE, mediaType: "image/jpeg" }),
    headers: { "content-type": "application/json" },
  })
  const resp1 = await routeMod.POST(req1)
  writeJSON(path.join(outDir, "response-full-object.json"), {
    status: resp1.status,
    contentType: resp1.headers.get("content-type"),
    body: await resp1.json(),
  })

  // Scenario 2: generateObject lanza. Mensaje fijo para que el fixture sea
  // determinista (sin fecha ni rate real).
  resetAiGlobals()
  globalThis.__ropa_ai_mode = "throw"
  globalThis.__ropa_ai_error_message = "simulated gemini 429 rate limit"
  // Silenciar el console.error del route (está en el catch): intercepto el
  // stderr nativo para que la salida del script quede limpia en --verify.
  const origErr = console.error
  console.error = () => {}
  const req2 = new Request("http://x/", {
    method: "POST",
    body: JSON.stringify({ dataUrl: DUMMY_DATAURL_IMAGE, mediaType: "image/jpeg" }),
    headers: { "content-type": "application/json" },
  })
  const resp2 = await routeMod.POST(req2)
  console.error = origErr
  writeJSON(path.join(outDir, "response-gemini-throws.json"), {
    status: resp2.status,
    contentType: resp2.headers.get("content-type"),
    body: await resp2.json(),
  })

  // Scenario 3: body sin dataUrl.
  resetAiGlobals()
  const req3 = new Request("http://x/", {
    method: "POST",
    body: JSON.stringify({ mediaType: "image/jpeg" }),
    headers: { "content-type": "application/json" },
  })
  const resp3 = await routeMod.POST(req3)
  writeJSON(path.join(outDir, "response-missing-dataurl.json"), {
    status: resp3.status,
    contentType: resp3.headers.get("content-type"),
    body: await resp3.json(),
  })

  // Scenario 4: dataUrl de tipo incorrecto (número).
  const req4 = new Request("http://x/", {
    method: "POST",
    body: JSON.stringify({ dataUrl: 12345, mediaType: "image/jpeg" }),
    headers: { "content-type": "application/json" },
  })
  const resp4 = await routeMod.POST(req4)
  writeJSON(path.join(outDir, "response-malformed-dataurl.json"), {
    status: resp4.status,
    contentType: resp4.headers.get("content-type"),
    body: await resp4.json(),
  })
}

// ---------- Captura de normalización de mediaType (commit 700c6aa) ---
async function captureMediaNormalization(outDir, routeMod) {
  const cases = [
    ["media-image-jpeg",   { dataUrl: DUMMY_DATAURL_IMAGE, mediaType: "image/jpeg" }],
    ["media-octet-stream", { dataUrl: DUMMY_DATAURL_IMAGE, mediaType: "application/octet-stream" }],
    ["media-empty",        { dataUrl: DUMMY_DATAURL_IMAGE, mediaType: "" }],
    ["media-video-mp4",    { dataUrl: DUMMY_DATAURL_VIDEO, mediaType: "video/mp4" }],
  ]
  resetAiGlobals()
  const captures = []
  globalThis.__ropa_capture = (a) => captures.push(a)
  for (const [label, body] of cases) {
    captures.length = 0
    const req = new Request("http://x/", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })
    const resp = await routeMod.POST(req)
    if (resp.status !== 200) throw new Error(`media case ${label} returned ${resp.status}`)
    const sentToGemini = captures[0]?.messages?.[0]?.content?.find((c) => c.type === "file")?.mediaType ?? null
    writeJSON(path.join(outDir, `${label}.json`), {
      inputMediaType: body.mediaType,
      sentToGemini,
      status: resp.status,
    })
  }
}

// ---------- Captura top-level desde route (pre-refactor) ------------
async function captureFromRoute(outDir) {
  const routeMod = await loadRouteWithMocks()
  await capturePrompts(outDir, routeMod)
  await captureResponses(outDir, routeMod)
  await captureMediaNormalization(outDir, routeMod)
}

// ---------- Captura UI desde panel.tsx (pre-refactor) ----------------
function captureUIFromPanel(outDir) {
  const panelPath = path.join(REPO_ROOT, "components/central/ai-ingress-panel.tsx")
  const src = fs.readFileSync(panelPath, "utf8")
  const sf = ts.createSourceFile(panelPath, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  const constants = {}
  const pairs = []
  function readAttr(attrs, name) {
    for (const a of attrs.properties) {
      if (!ts.isJsxAttribute(a) || !ts.isIdentifier(a.name) || a.name.text !== name) continue
      const init = a.initializer
      if (!init) return true
      if (ts.isStringLiteral(init)) return init.text
      if (ts.isJsxExpression(init) && init.expression) {
        const e = init.expression
        if (ts.isNumericLiteral(e)) return Number(e.text)
        if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
        if (ts.isTemplateExpression(e)) {
          let out = e.head.text
          for (const span of e.templateSpans) out += "${…}" + span.literal.text
          return out
        }
      }
    }
    return null
  }
  const textOfJsxChildren = (children) =>
    children.map((c) => (ts.isJsxText(c) ? c.text : "")).join("").trim()

  function visit(node) {
    if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue
        const name = d.name.text
        if (name === "PREFIX_HINTS" && (ts.isStringLiteral(d.initializer) || ts.isNoSubstitutionTemplateLiteral(d.initializer))) {
          constants.PREFIX_HINTS = d.initializer.text
        }
        if (name === "AI_MIN_INTERVAL_MS" && ts.isNumericLiteral(d.initializer)) {
          constants.AI_MIN_INTERVAL_MS = Number(d.initializer.text)
        }
      }
    }
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      const children = node.children
      for (let i = 0; i < children.length; i++) {
        const c = children[i]
        if (!ts.isJsxElement(c)) continue
        const tag = c.openingElement.tagName
        if (!ts.isIdentifier(tag) || tag.text !== "Label") continue
        const labelText = textOfJsxChildren(c.children)
        for (let j = i + 1; j < children.length; j++) {
          const nx = children[j]
          if (!ts.isJsxElement(nx) && !ts.isJsxSelfClosingElement(nx)) continue
          const nxOpen = ts.isJsxElement(nx) ? nx.openingElement : nx
          const nxTag = nxOpen.tagName
          if (!ts.isIdentifier(nxTag)) break
          if (!["Input", "MoneyInput", "Textarea"].includes(nxTag.text)) break
          pairs.push({
            label: labelText,
            component: nxTag.text,
            placeholder: readAttr(nxOpen.attributes, "placeholder"),
            maxLength: readAttr(nxOpen.attributes, "maxLength"),
          })
          break
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)

  // Hero paragraph: <p className="max-w-xl ...">...</p>
  let hero = null
  function visitHero(node) {
    if (hero) return
    if (ts.isJsxElement(node)) {
      const t = node.openingElement.tagName
      if (ts.isIdentifier(t) && t.text === "p") {
        const cls = readAttr(node.openingElement.attributes, "className")
        if (typeof cls === "string" && cls.includes("max-w-xl")) {
          let out = ""
          const walk = (n) => {
            if (ts.isJsxText(n)) out += n.text
            else if (ts.isJsxElement(n)) for (const ch of n.children) walk(ch)
            else if (ts.isJsxExpression(n) && n.expression && ts.isStringLiteral(n.expression)) out += n.expression.text
          }
          for (const ch of node.children) walk(ch)
          hero = out.replace(/\s+/g, " ").trim()
        }
      }
    }
    ts.forEachChild(node, visitHero)
  }
  visitHero(sf)

  // ---------- Extractor por AST (fix 2026-10-16, ver README §bugs) --------
  // Captura `clientFallbacks` desde los dos bloques de `panel.tsx` usando
  // AST + node.getText(), no regex. Elige la función exacta por nombre y
  // falla duro si no encuentra EXACTAMENTE un match por bloque. Antes de
  // este fix el extractor era regex-based y cargaba dos bugs: tomaba la
  // primera coincidencia de `const newItem: IngressItem` (que es la de
  // `duplicateItem()`, no la de `handleFiles()`) y truncaba expresiones
  // en la primera coma interna (ej. `.slice(0, 4)` quedaba cortado a
  // `.slice(0`). Ver `README.md` para el detalle.
  const INITIAL_KEYS = ["type_prefix", "size", "color", "quantity", "price", "cost"]
  const ANALYZE_KEYS = ["name", "type_prefix", "category", "description", "size", "color", "price", "cost", "quantity"]

  function findFunction(sf, name) {
    const hits = []
    function walk(node) {
      if (ts.isFunctionDeclaration(node) && node.name && node.name.text === name) {
        hits.push(node)
      }
      ts.forEachChild(node, walk)
    }
    walk(sf)
    if (hits.length !== 1) {
      throw new Error(`AST extractor: esperaba 1 función "${name}", encontró ${hits.length}`)
    }
    return hits[0]
  }

  function findNewItemObjectIn(fnNode) {
    const hits = []
    function walk(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "newItem" && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        hits.push(node.initializer)
      }
      ts.forEachChild(node, walk)
    }
    walk(fnNode)
    if (hits.length !== 1) {
      throw new Error(`AST extractor: esperaba 1 "const newItem" dentro de "${fnNode.name?.text}", encontró ${hits.length}`)
    }
    return hits[0]
  }

  function findUpdateCallObjectIn(fnNode) {
    const hits = []
    function walk(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "update" &&
        node.arguments.length === 2 &&
        ts.isObjectLiteralExpression(node.arguments[1])
      ) {
        hits.push(node.arguments[1])
      }
      ts.forEachChild(node, walk)
    }
    walk(fnNode)
    // analyze() tiene DOS update(id, {...}): el feliz y el del catch con
    // solo status/errorMsg. Elegimos el que tiene las claves de analyze.
    const matches = hits.filter((obj) => obj.properties.some((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "name"))
    if (matches.length !== 1) {
      throw new Error(`AST extractor: esperaba 1 "update(id, {...})" con propiedad "name" dentro de "${fnNode.name?.text}", encontró ${matches.length} (total updates: ${hits.length})`)
    }
    return matches[0]
  }

  function textOfProperty(objLit, key) {
    for (const p of objLit.properties) {
      if (!ts.isPropertyAssignment(p)) continue
      if (!ts.isIdentifier(p.name) || p.name.text !== key) continue
      return p.initializer.getText(sf)
    }
    throw new Error(`AST extractor: propiedad "${key}" no encontrada en el object literal`)
  }

  const handleFilesFn = findFunction(sf, "handleFiles")
  const analyzeFn = findFunction(sf, "analyze")
  const newItemObj = findNewItemObjectIn(handleFilesFn)
  const updateObj = findUpdateCallObjectIn(analyzeFn)

  const initial = Object.fromEntries(INITIAL_KEYS.map((k) => [k, textOfProperty(newItemObj, k)]))
  const analyze = Object.fromEntries(ANALYZE_KEYS.map((k) => [k, textOfProperty(updateObj, k)]))

  // Auditoría independiente: cantidad de <Label en el source vs entradas
  // en el array `pairs`. Falla si no coinciden.
  const labelCount = (src.match(/<Label\b/g) || []).length
  if (pairs.length !== labelCount) {
    throw new Error(`AST extractor: ${labelCount} <Label en panel.tsx vs ${pairs.length} entradas en ui-labels. Mismatch.`)
  }
  const placeholderCount = (src.match(/\bplaceholder=/g) || []).length
  const pairsWithPlaceholder = pairs.filter((p) => p.placeholder !== null).length
  if (pairsWithPlaceholder !== placeholderCount) {
    throw new Error(`AST extractor: ${placeholderCount} placeholder= en panel.tsx vs ${pairsWithPlaceholder} entradas con placeholder en ui-labels.`)
  }

  // Orden canónico para ui-constants: alfabético. Preserva el orden que el
  // visitor accidentalmente produjo (AI_MIN_INTERVAL_MS, PREFIX_HINTS) y
  // garantiza determinismo si el perfil post-refactor cambia la insertion
  // order del object literal.
  const canonicalConstants = Object.fromEntries(
    Object.keys(constants).sort().map((k) => [k, constants[k]]),
  )

  writeJSON(path.join(outDir, "ui-labels.json"), pairs)
  writeJSON(path.join(outDir, "ui-constants.json"), canonicalConstants)
  writeText(path.join(outDir, "ui-hero.txt"), hero || "")
  writeJSON(path.join(outDir, "client-fallbacks.json"), { initial, analyze })
}

// ---------- Captura desde el perfil (post-refactor) ------------------
async function captureFromProfile(outDir) {
  const profilePath = path.join(REPO_ROOT, "lib/rubro-profiles.ts")
  if (!fs.existsSync(profilePath)) {
    console.error("[fixture] --source=profile pero lib/rubro-profiles.ts no existe. Corré con --source=route o aplicá el refactor.")
    process.exit(2)
  }
  // Prompts + responses + media vienen de ejercitar el route refactorizado,
  // que ya consume el perfil internamente. UI/schema/client-fallbacks los
  // leemos directo del perfil para probar que sus bytes coinciden con lo
  // que el AST extrae en pre-refactor.
  const routeMod = await loadRouteWithMocks()
  await capturePrompts(outDir, routeMod)
  await captureResponses(outDir, routeMod)
  await captureMediaNormalization(outDir, routeMod)

  const src = fs.readFileSync(profilePath, "utf8")
  const transpiled = transpileToMjs(src)
  const genPath = path.join(TMP_DIR, "rubro-profiles.generated.mjs")
  fs.writeFileSync(genPath, transpiled)
  const mod = await import(url.pathToFileURL(genPath).href)
  const profile = mod.getRubroProfile("ropa")

  const ui = profile.ui
  writeJSON(path.join(outDir, "ui-labels.json"), ui.labels)
  writeJSON(path.join(outDir, "ui-constants.json"), ui.constants)
  writeText(path.join(outDir, "ui-hero.txt"), ui.hero)
  writeJSON(path.join(outDir, "client-fallbacks.json"), ui.clientFallbacks)
}

// ---------- --verify byte a byte -------------------------------------
function verifyByteByByte() {
  if (!fs.existsSync(OUT_DIR)) {
    console.error(`[verify] outputs/ no existe. Correr primero sin --verify.`)
    process.exit(1)
  }
  const expected = fs.readdirSync(OUT_DIR).sort()
  const actual = fs.readdirSync(VERIFY_DIR).sort()
  let failures = 0
  for (const f of expected) {
    const a = fs.readFileSync(path.join(OUT_DIR, f))
    const bPath = path.join(VERIFY_DIR, f)
    if (!fs.existsSync(bPath)) {
      console.error(`[verify] FALTA en _verify: ${f}`)
      failures++
      continue
    }
    const b = fs.readFileSync(bPath)
    if (!a.equals(b)) {
      console.error(`[verify] DIFIERE: ${f} (outputs=${a.length}B _verify=${b.length}B)`)
      const n = Math.min(a.length, b.length)
      for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) {
          const ctx = (buf) => Array.from(buf.slice(Math.max(0, i - 16), i + 16))
            .map((x) => x.toString(16).padStart(2, "0")).join(" ")
          console.error(`  byte ${i}: outputs=0x${a[i].toString(16)} _verify=0x${b[i].toString(16)}`)
          console.error(`  outputs: ${ctx(a)}`)
          console.error(`  _verify: ${ctx(b)}`)
          break
        }
      }
      if (a.length !== b.length) {
        console.error(`  tamaños distintos: outputs=${a.length}B _verify=${b.length}B`)
      }
      failures++
    }
  }
  for (const f of actual) {
    if (!expected.includes(f)) {
      console.error(`[verify] EXTRA en _verify: ${f}`)
      failures++
    }
  }
  if (failures > 0) {
    console.error(`[verify] FAIL — ${failures} diferencia(s).`)
    process.exit(1)
  }
  console.log(`[verify] OK — ${expected.length} archivo(s) idéntico(s) byte a byte.`)
}

// ---------- --isolation ----------------------------------------------
async function runIsolation() {
  const profilePath = path.join(REPO_ROOT, "lib/rubro-profiles.ts")
  if (!fs.existsSync(profilePath)) {
    console.log("[isolation] SKIPPED — lib/rubro-profiles.ts no existe (correr tras el refactor).")
    return
  }
  const src = fs.readFileSync(profilePath, "utf8")
  const transpiled = transpileToMjs(src)
  const genPath = path.join(TMP_DIR, "rubro-profiles.generated.mjs")
  fs.writeFileSync(genPath, transpiled)
  const mod = await import(url.pathToFileURL(genPath).href + `?t=${Date.now()}`)

  const results = { pass: [], fail: [] }
  const check = (name, cond) => {
    (cond ? results.pass : results.fail).push(name)
    console.log(`  ${cond ? "✓" : "✗"} ${name}`)
  }

  function scanTextOf(profile) {
    const parts = [profile.instructions, profile.messageTemplate]
    for (const f of Object.values(profile.schema.shape)) if (f.description) parts.push(f.description)
    const ui = profile.ui || {}
    if (Array.isArray(ui.labels)) {
      for (const p of ui.labels) {
        if (p.label) parts.push(p.label)
        if (typeof p.placeholder === "string") parts.push(p.placeholder)
      }
    }
    if (ui.hero) parts.push(ui.hero)
    for (const v of Object.values(ui.constants || {})) if (typeof v === "string") parts.push(v)
    return stripAccents(parts.join(" | "))
  }

  // Sanity de wordMatches
  check("wordMatches: 'mah' no matchea en 'manana'", !wordMatches("manana", "mah"))
  check("wordMatches: 'mah' matchea en 'mah' solo", wordMatches("mah", "mah"))
  check("wordMatches: 'usb-c' matchea en 'un usb-c power'", wordMatches("un usb-c power", "usb-c"))
  check("wordMatches: 'funda' no matchea en 'fundamental'", !wordMatches("fundamental", "funda"))

  // Perfil ropa
  const ropaProfile = mod.getRubroProfile("ropa")
  const ropaText = scanTextOf(ropaProfile)
  check("ropa.positive — ≥1 marcador ROPA presente", ROPA_MARKERS.some((t) => wordMatches(ropaText, t)))
  const ropaBadHits = TECNOLOGIA_MARKERS.filter((t) => wordMatches(ropaText, t))
  check(`ropa.negative — 0 marcadores TECNOLOGIA (hits: ${ropaBadHits.join(",") || "ninguno"})`, ropaBadHits.length === 0)
  check("ropa NO contiene la frase de rechazo", !scanTextOf(ropaProfile).includes(stripAccents(REJECTION_PHRASE_TECNOLOGIA)))

  // Perfil tecnología (si existe)
  let tecProfile = null
  try { tecProfile = mod.getRubroProfile("tecnologia") } catch (e) {
    console.log(`[isolation] perfil 'tecnologia' aún no disponible: ${e?.message || e}`)
  }
  if (tecProfile) {
    const tecTextRaw = scanTextOf(tecProfile)
    const tecText = tecTextRaw.replaceAll(stripAccents(REJECTION_PHRASE_TECNOLOGIA), "")
    check("tecnologia.positive — ≥1 marcador TECNOLOGIA presente", TECNOLOGIA_MARKERS.some((t) => wordMatches(tecText, t)))
    const tecBadHits = ROPA_MARKERS.filter((t) => wordMatches(tecText, t))
    check(`tecnologia.negative — 0 marcadores ROPA (hits: ${tecBadHits.join(",") || "ninguno"})`, tecBadHits.length === 0)
    check("tecnologia contiene la frase de rechazo", tecTextRaw.includes(stripAccents(REJECTION_PHRASE_TECNOLOGIA)))
  }

  // Rubro desconocido debe lanzar
  let threw = false
  try { mod.getRubroProfile("desconocido") } catch { threw = true }
  check("getRubroProfile('desconocido') lanza excepción", threw)

  // Fail-closed: si business_settings.rubro falla o viene vacío, la ruta
  // debe fallar sin invocar generateObject. Solo corre si el route ya
  // importa supabase (post-refactor).
  const routeSrc = fs.readFileSync(path.join(REPO_ROOT, "app/api/analyze-product/route.ts"), "utf8")
  const routeUsesSupabase = /createServerSupabaseClient|from\s+["']@\/lib\/supabase\/server["']/.test(routeSrc)
  if (routeUsesSupabase) {
    const aiMock = url.pathToFileURL(path.join(MOCKS_DIR, "ai.mjs")).href
    const nextMock = url.pathToFileURL(path.join(MOCKS_DIR, "next-server.mjs")).href
    const supaMock = url.pathToFileURL(path.join(MOCKS_DIR, "supabase-server.mjs")).href
    const transpiledRoute = transpileToMjs(routeSrc, {
      importRewrites: { "ai": aiMock, "next/server": nextMock, "@/lib/supabase/server": supaMock },
    })
    const routeGen = path.join(TMP_DIR, "route.isolation.mjs")
    fs.writeFileSync(routeGen, transpiledRoute)
    const routeMod = await import(url.pathToFileURL(routeGen).href + `?t=${Date.now()}`)

    const captures = []
    globalThis.__ropa_capture = (a) => captures.push(a)

    // 1) Error de Supabase → NO cae a 'ropa', NO llama generateObject.
    captures.length = 0
    globalThis.__ROPA_FIXTURE_SUPABASE_ERROR = true
    const req1 = new Request("http://x/", { method: "POST", body: JSON.stringify({ dataUrl: DUMMY_DATAURL_IMAGE, mediaType: "image/jpeg" }) })
    const resp1 = await routeMod.POST(req1)
    globalThis.__ROPA_FIXTURE_SUPABASE_ERROR = false
    check("fail-closed: error de business_settings NO llama generateObject", captures.length === 0)
    check("fail-closed: error de business_settings devuelve status >= 400", resp1.status >= 400)

    // 2) rubro null → NO cae a 'ropa', NO llama generateObject.
    captures.length = 0
    globalThis.__ROPA_FIXTURE_RUBRO = null
    const req2 = new Request("http://x/", { method: "POST", body: JSON.stringify({ dataUrl: DUMMY_DATAURL_IMAGE, mediaType: "image/jpeg" }) })
    const resp2 = await routeMod.POST(req2)
    globalThis.__ROPA_FIXTURE_RUBRO = undefined
    check("fail-closed: rubro null NO llama generateObject", captures.length === 0)
    check("fail-closed: rubro null devuelve status >= 400", resp2.status >= 400)
  } else {
    console.log("[isolation] fail-closed de business_settings: SKIPPED — route.ts aún no lee supabase.")
  }

  if (results.fail.length > 0) {
    console.error(`[isolation] FAIL — ${results.fail.length} regla(s) rotas.`)
    process.exit(1)
  }
  console.log(`[isolation] OK — ${results.pass.length} regla(s) satisfechas.`)
}

// ---------- Main ------------------------------------------------------
rmrf(TMP_DIR); mkd(TMP_DIR)

if (DO_ISOLATION) {
  await runIsolation()
  rmrf(TMP_DIR)
  process.exit(0)
}

const outDir = DO_VERIFY ? VERIFY_DIR : OUT_DIR
rmrf(outDir); mkd(outDir)

if (MODE_SOURCE === "route") {
  await captureFromRoute(outDir)
  captureUIFromPanel(outDir)
} else if (MODE_SOURCE === "profile") {
  await captureFromProfile(outDir)
} else {
  console.error(`[fixture] --source=${MODE_SOURCE} inválido. Usar 'route' | 'profile'.`)
  process.exit(2)
}

const finalCount = fs.readdirSync(outDir).length
const finalRel = path.relative(REPO_ROOT, outDir).replace(/\\/g, "/")

if (DO_VERIFY) {
  verifyByteByByte()
  rmrf(VERIFY_DIR)
}

rmrf(TMP_DIR)
if (!DO_VERIFY) {
  console.log(`[fixture] OK — ${finalCount} archivo(s) en ${finalRel}/`)
}

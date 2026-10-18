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
const DO_BEHAVIOR = !!args.behavior

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

// Literales exclusivos de ropa que NO deben aparecer hardcoded en
// `components/central/ai-ingress-panel.tsx` tras el refactor. Si queda
// uno, el panel está consumiendo strings propios del rubro en vez de
// leerlos del perfil. Escaneo literal (incluye tildes y mayúsculas).
export const PANEL_ROPA_LITERALS = [
  '"Talla"',
  '"Tipo (prefijo)"',
  '"Camisas"',
  '"Ej: Camisa manga larga"',
  '"CA=Camisa',
  '"Material, estilo, detalles',
  'CA-M-95-00',
  '"Sube fotos de las prendas',
  '"La IA detecta el tipo, la descripción, la talla',
]

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

// ---------- Transpilador de la cadena @/lib/rubro-* ------------------
// Transpila rubro-ui + rubro-profiles (en ese orden, por dependencia) y
// devuelve las URLs file:// de los .mjs resultantes para rewrites y para
// `import()`.
function buildRubroChain(cacheBuster = "") {
  const uiSrc = fs.readFileSync(path.join(REPO_ROOT, "lib/rubro-ui.ts"), "utf8")
  const uiTranspiled = transpileToMjs(uiSrc)
  const uiPath = path.join(TMP_DIR, `rubro-ui.generated.mjs`)
  fs.writeFileSync(uiPath, uiTranspiled)
  const uiHref = url.pathToFileURL(uiPath).href

  const profSrc = fs.readFileSync(path.join(REPO_ROOT, "lib/rubro-profiles.ts"), "utf8")
  const profTranspiled = transpileToMjs(profSrc, { importRewrites: { "@/lib/rubro-ui": uiHref } })
  const profPath = path.join(TMP_DIR, `rubro-profiles.generated.mjs`)
  fs.writeFileSync(profPath, profTranspiled)
  const profHref = url.pathToFileURL(profPath).href
  return { uiHref, profHref, cacheBuster }
}

async function loadProfileModule(cacheBuster = "") {
  const { profHref } = buildRubroChain(cacheBuster)
  const q = cacheBuster ? `?t=${cacheBuster}` : ""
  return import(profHref + q)
}

// ---------- Loader del route transpilado ----------------------------
async function loadRouteWithMocks(cacheBuster = "") {
  const { profHref } = buildRubroChain(cacheBuster)
  const routeSrc = fs.readFileSync(path.join(REPO_ROOT, "app/api/analyze-product/route.ts"), "utf8")
  const aiMock = url.pathToFileURL(path.join(MOCKS_DIR, "ai.mjs")).href
  const nextMock = url.pathToFileURL(path.join(MOCKS_DIR, "next-server.mjs")).href
  const supaMock = url.pathToFileURL(path.join(MOCKS_DIR, "supabase-server.mjs")).href
  const transpiled = transpileToMjs(routeSrc, {
    importRewrites: {
      "ai": aiMock,
      "next/server": nextMock,
      "@/lib/supabase/server": supaMock,
      "@/lib/rubro-profiles": profHref,
    },
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
  globalThis.__ROPA_FIXTURE_RUBRO = "ropa"
  globalThis.__ROPA_FIXTURE_SUPABASE_ERROR = false
  globalThis.__ROPA_FIXTURE_CATEGORIES = []
  // Sesión + rol de usuario autenticado por default: admin activo.
  // Casos de 401/403 setean estos globals explícitamente.
  globalThis.__ROPA_FIXTURE_AUTH_USER = { id: "fixture-user-admin" }
  globalThis.__ROPA_FIXTURE_AUTH_ERROR = false
  globalThis.__ROPA_FIXTURE_ROLE = "admin"
  globalThis.__ROPA_FIXTURE_IS_ACTIVE = true
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

// ---------- Captura UI desde el perfil (opción 1, post-refactor) ----
// Templates de las expresiones del callback `analyze()` por campo.
// Deben matchear BYTE-A-BYTE el extractor AST que generó el fixture
// corregido en el commit 71791a5 — ese fixture es la fuente de verdad.
// La función `applyAnalysisToItem(product, "ropa")` del módulo
// `lib/apply-analysis.ts` implementa EL MISMO comportamiento que estas
// expresiones; el gate `--behavior` lo verifica evaluando el oráculo.
const ANALYZE_EXPR = {
  name:        (f) => `product.name ?? ${JSON.stringify(f)}`,
  type_prefix: (f) => `(product.type_prefix ?? ${JSON.stringify(f)}).toUpperCase().slice(0, 4)`,
  category:    (f) => `product.category ?? ${JSON.stringify(f)}`,
  description: (f) => `product.description ?? ${JSON.stringify(f)}`,
  size:        (f) => `(product.size ?? ${JSON.stringify(f)}).toUpperCase()`,
  color:       (f) => `product.color ?? ${JSON.stringify(f)}`,
  price:       (f) => `Math.round(product.suggested_price ?? ${f})`,
  cost:        (f) => `Math.round(product.suggested_cost ?? ${f})`,
  quantity:    (f) => `product.quantity ?? ${f}`,
}
const serializeInitial = (v) => (typeof v === "string" ? JSON.stringify(v) : String(v))

async function captureUIFromProfile(outDir) {
  const mod = await loadProfileModule()
  const profile = mod.getRubroProfile("ropa")
  const ui = profile.ui

  // ui-labels / ui-hero: salen directo del perfil (ya es un object
  // keyed por campo del IngressItem — name, type_prefix, category…).
  writeJSON(path.join(outDir, "ui-labels.json"), ui.labels)
  writeText(path.join(outDir, "ui-hero.txt"), ui.hero)

  // ui-constants: orden canónico (alfabético) para blindaje contra
  // insertion-order drift del object literal en TypeScript.
  const canonicalConstants = Object.fromEntries(
    Object.keys(ui.constants).sort().map((k) => [k, ui.constants[k]]),
  )
  writeJSON(path.join(outDir, "ui-constants.json"), canonicalConstants)

  // client-fallbacks: serializa cada valor como el fixture committed los
  // tiene (strings tipo "XX" quedan como `"\"XX\""`, números como `"0"`),
  // y aplica el template de expresión por campo para `analyze`.
  const INITIAL_KEYS = ["type_prefix", "size", "color", "quantity", "price", "cost"]
  const ANALYZE_KEYS = ["name", "type_prefix", "category", "description", "size", "color", "price", "cost", "quantity"]
  const initial = Object.fromEntries(
    INITIAL_KEYS.map((k) => [k, serializeInitial(ui.clientFallbacks.initial[k])]),
  )
  const analyze = Object.fromEntries(
    ANALYZE_KEYS.map((k) => {
      const tmpl = ANALYZE_EXPR[k]
      if (!tmpl) throw new Error(`captureUIFromProfile: campo "${k}" sin template en ANALYZE_EXPR.`)
      const fb = ui.clientFallbacks.analyze[k]
      return [k, tmpl(fb)]
    }),
  )
  writeJSON(path.join(outDir, "client-fallbacks.json"), { initial, analyze })
}

// ---------- Captura UI desde panel.tsx @ 1aff84b (oráculo independiente) ----
// `--source=route` extrae desde el panel ORIGINAL (git show 1aff84b),
// NO desde el panel refactorizado (que ya no tiene literales). Es un
// extractor independiente del perfil: si en el futuro alguien rompe el
// perfil para que ya no refleje el design original, `--source=route`
// sigue dando los bytes de la fuente de verdad histórica. Mismos bytes
// que `--source=profile` → confirma que el refactor fue identity-preserving.
import { execSync as execSyncForPanel } from "node:child_process"
const PANEL_ANCHOR = "1aff84b"

function captureUIFromPanelOracle(outDir) {
  // Panel original — nunca cambia (commit congelado).
  try {
    execSyncForPanel(`git cat-file -e ${PANEL_ANCHOR}:components/central/ai-ingress-panel.tsx`, { stdio: "pipe" })
  } catch {
    console.error(`[fixture] --source=route: el commit ancla ${PANEL_ANCHOR} no es accesible. Usar --source=profile o verificar que el repo no sea shallow.`)
    process.exit(2)
  }
  const src = execSyncForPanel(`git show ${PANEL_ANCHOR}:components/central/ai-ingress-panel.tsx`).toString("utf8")
  const sf = ts.createSourceFile("ai-ingress-panel.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

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

  // AST independiente para initial/analyze — mismo algoritmo del fix 71791a5.
  function findFn(name) {
    const hits = []
    function walk(node) {
      if (ts.isFunctionDeclaration(node) && node.name && node.name.text === name) hits.push(node)
      ts.forEachChild(node, walk)
    }
    walk(sf)
    if (hits.length !== 1) throw new Error(`AST oracle: esperaba 1 "${name}" en panel @ ${PANEL_ANCHOR}, encontró ${hits.length}`)
    return hits[0]
  }
  function findNewItem(fnNode) {
    const hits = []
    function walk(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "newItem" && node.initializer && ts.isObjectLiteralExpression(node.initializer)) hits.push(node.initializer)
      ts.forEachChild(node, walk)
    }
    walk(fnNode)
    if (hits.length !== 1) throw new Error(`AST oracle: esperaba 1 "newItem" en ${fnNode.name?.text}, encontró ${hits.length}`)
    return hits[0]
  }
  function findUpdate(fnNode) {
    const hits = []
    function walk(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "update" && node.arguments.length === 2 && ts.isObjectLiteralExpression(node.arguments[1])) hits.push(node.arguments[1])
      ts.forEachChild(node, walk)
    }
    walk(fnNode)
    const matches = hits.filter((obj) => obj.properties.some((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "name"))
    if (matches.length !== 1) throw new Error(`AST oracle: esperaba 1 update() con "name" en ${fnNode.name?.text}, encontró ${matches.length}`)
    return matches[0]
  }
  function textOf(obj, key) {
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue
      if (!ts.isIdentifier(p.name) || p.name.text !== key) continue
      return p.initializer.getText(sf)
    }
    throw new Error(`AST oracle: propiedad "${key}" no encontrada`)
  }

  const INITIAL_KEYS = ["type_prefix", "size", "color", "quantity", "price", "cost"]
  const ANALYZE_KEYS = ["name", "type_prefix", "category", "description", "size", "color", "price", "cost", "quantity"]
  const handleFilesFn = findFn("handleFiles")
  const analyzeFn = findFn("analyze")
  const initial = Object.fromEntries(INITIAL_KEYS.map((k) => [k, textOf(findNewItem(handleFilesFn), k)]))
  const analyze = Object.fromEntries(ANALYZE_KEYS.map((k) => [k, textOf(findUpdate(analyzeFn), k)]))

  // Auditoría independiente de cuentas.
  const labelCount = (src.match(/<Label\b/g) || []).length
  if (pairs.length !== labelCount) throw new Error(`AST oracle: ${labelCount} <Label vs ${pairs.length} pairs`)
  const placeholderCount = (src.match(/\bplaceholder=/g) || []).length
  const pairsWithPh = pairs.filter((p) => p.placeholder !== null).length
  if (pairsWithPh !== placeholderCount) throw new Error(`AST oracle: ${placeholderCount} placeholder= vs ${pairsWithPh} entries`)

  const canonicalConstants = Object.fromEntries(Object.keys(constants).sort().map((k) => [k, constants[k]]))

  // Convertir los pairs extraídos del AST (posicionales) a objeto keyed
  // por campo del IngressItem — mismo shape que el que emite el perfil.
  // El orden de los <Label> en el panel original @ 1aff84b es fijo:
  const ROPA_FIELD_KEYS = ["name", "type_prefix", "category", "size", "color", "price", "cost", "quantity", "code", "description"]
  if (pairs.length !== ROPA_FIELD_KEYS.length) {
    throw new Error(`AST oracle: esperaba ${ROPA_FIELD_KEYS.length} pairs, encontró ${pairs.length}`)
  }
  const labelsByKey = Object.fromEntries(pairs.map((p, i) => [ROPA_FIELD_KEYS[i], p]))

  writeJSON(path.join(outDir, "ui-labels.json"), labelsByKey)
  writeJSON(path.join(outDir, "ui-constants.json"), canonicalConstants)
  writeText(path.join(outDir, "ui-hero.txt"), hero || "")
  writeJSON(path.join(outDir, "client-fallbacks.json"), { initial, analyze })
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

// ---------- --behavior -----------------------------------------------
// Oráculo: evalúa las expresiones del `analyze()` ORIGINAL (del main
// pre-refactor, git show 1aff84b) con `new Function` sobre entradas de
// muestra. Compara con `applyAnalysisToItem` del módulo nuevo. Verifica
// equivalencia byte-a-byte en runtime (no textual). Idem para
// tecnología: todos los campos deben caer a vacíos, nunca XX ni M.
// Mutación: parchea en memoria la implementación de apply-analysis y
// comprueba que la prueba FALLA, luego la revierte.
import { execSync } from "node:child_process"

async function runBehavior() {
  const results = { pass: [], fail: [] }
  const check = (name, cond, extra = "") => {
    (cond ? results.pass : results.fail).push(name)
    console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`)
  }

  // ---------- 1. Oráculo: extraer expresiones del panel @ 1aff84b ----
  // Verificamos que el commit existe antes de leerlo (shallow clone →
  // --behavior falla visible, no silencioso).
  const ANCHOR = "1aff84b"
  try {
    execSync(`git cat-file -e ${ANCHOR}:components/central/ai-ingress-panel.tsx`, { stdio: "pipe" })
  } catch {
    console.error(`[behavior] FATAL — el commit ancla ${ANCHOR} no es accesible (shallow clone?). Abortado.`)
    process.exit(2)
  }
  const originalPanelSrc = execSync(`git show ${ANCHOR}:components/central/ai-ingress-panel.tsx`).toString("utf8")
  const sf = ts.createSourceFile("ai-ingress-panel.tsx", originalPanelSrc, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

  // AST walk para encontrar handleFiles.newItem y analyze.update object literals.
  function findFunctionByName(name) {
    const hits = []
    function walk(node) {
      if (ts.isFunctionDeclaration(node) && node.name && node.name.text === name) hits.push(node)
      ts.forEachChild(node, walk)
    }
    walk(sf)
    if (hits.length !== 1) throw new Error(`behavior: esperaba 1 función "${name}" en el panel original, encontró ${hits.length}`)
    return hits[0]
  }
  function findNewItemObj(fnNode) {
    const hits = []
    function walk(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "newItem" && node.initializer && ts.isObjectLiteralExpression(node.initializer)) hits.push(node.initializer)
      ts.forEachChild(node, walk)
    }
    walk(fnNode)
    if (hits.length !== 1) throw new Error(`behavior: esperaba 1 "const newItem" en ${fnNode.name?.text}, encontró ${hits.length}`)
    return hits[0]
  }
  function findAnalyzeUpdateObj(fnNode) {
    const hits = []
    function walk(node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "update" && node.arguments.length === 2 && ts.isObjectLiteralExpression(node.arguments[1])) hits.push(node.arguments[1])
      ts.forEachChild(node, walk)
    }
    walk(fnNode)
    const matches = hits.filter((obj) => obj.properties.some((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "name"))
    if (matches.length !== 1) throw new Error(`behavior: esperaba 1 update() con propiedad "name" en ${fnNode.name?.text}, encontró ${matches.length}`)
    return matches[0]
  }
  function textOfProp(obj, key) {
    for (const p of obj.properties) {
      if (!ts.isPropertyAssignment(p)) continue
      if (!ts.isIdentifier(p.name) || p.name.text !== key) continue
      return p.initializer.getText(sf)
    }
    throw new Error(`behavior: propiedad "${key}" no encontrada en el object literal`)
  }
  const handleFilesFn = findFunctionByName("handleFiles")
  const analyzeFn = findFunctionByName("analyze")
  const newItemObj = findNewItemObj(handleFilesFn)
  const updateObj = findAnalyzeUpdateObj(analyzeFn)

  const ANALYZE_FIELDS = ["name", "type_prefix", "category", "description", "size", "color", "price", "cost", "quantity"]
  const INITIAL_FIELDS = ["type_prefix", "size", "color", "quantity", "price", "cost"]

  // Construye función oráculo que evalúa todo el object literal con `product` como input.
  function buildOracle(obj, fields) {
    const entries = fields.map((f) => `${f}: (${textOfProp(obj, f)})`).join(", ")
    return new Function("product", `return ({ ${entries} })`)
  }
  const oracleAnalyze = buildOracle(updateObj, ANALYZE_FIELDS)
  // Oracle inicial no toma `product` — es el bloque de defaults.
  const initialOracle = new Function(`return ({ ${INITIAL_FIELDS.map((f) => `${f}: (${textOfProp(newItemObj, f)})`).join(", ")} })`)()

  // ---------- 2. Cargar apply-analysis + rubro-ui transpilados -------
  async function loadApplyAnalysis(mutator) {
    const uiSrc = fs.readFileSync(path.join(REPO_ROOT, "lib/rubro-ui.ts"), "utf8")
    let applySrc = fs.readFileSync(path.join(REPO_ROOT, "lib/apply-analysis.ts"), "utf8")
    if (mutator) applySrc = mutator(applySrc)
    const uiTranspiled = transpileToMjs(uiSrc)
    const uiPath = path.join(TMP_DIR, `rubro-ui.behavior.${Date.now()}.mjs`)
    fs.writeFileSync(uiPath, uiTranspiled)
    const uiHref = url.pathToFileURL(uiPath).href
    const applyTranspiled = transpileToMjs(applySrc, { importRewrites: { "@/lib/rubro-ui": uiHref } })
    const applyPath = path.join(TMP_DIR, `apply-analysis.behavior.${Date.now()}.mjs`)
    fs.writeFileSync(applyPath, applyTranspiled)
    return import(url.pathToFileURL(applyPath).href + `?t=${Date.now()}`)
  }
  const applyMod = await loadApplyAnalysis(null)

  // ---------- 3. Samples (ropa) --------------------------------------
  const ROPA_SAMPLES = [
    ["respuesta vacía",              {}],
    ["parcial (name)",               { name: "Camisa" }],
    ["completa",                     FULL_AI_RESULT],
    ["type_prefix >4 chars",         { type_prefix: "LARGO123" }],
    ["size en minúscula",            { size: "m" }],
    ["suggested_price decimales",    { suggested_price: 95000.75 }],
    ["quantity ausente",             { name: "X", type_prefix: "CA" }],
  ]

  function deepEq(a, b) {
    return JSON.stringify(a) === JSON.stringify(b)
  }

  // Verificación initial: createInitialItem(ropa) debe matchear el bloque
  // de defaults de handleFiles.newItem.
  const actualInit = applyMod.createInitialItem("ropa")
  const expectedInit = initialOracle
  const initKeys = Object.keys(expectedInit)
  const initOk = initKeys.every((k) => deepEq(actualInit[k], expectedInit[k]))
  check(
    "createInitialItem(ropa) === defaults de handleFiles @ 1aff84b",
    initOk,
    initOk ? "" : `expected=${JSON.stringify(expectedInit)} actual=${JSON.stringify(Object.fromEntries(initKeys.map(k => [k, actualInit[k]])))}`,
  )

  // Verificación analyze para cada sample.
  for (const [label, sample] of ROPA_SAMPLES) {
    const expected = oracleAnalyze(sample)
    const actual = applyMod.applyAnalysisToItem(sample, "ropa")
    const ok = ANALYZE_FIELDS.every((f) => deepEq(actual[f], expected[f]))
    check(
      `applyAnalysisToItem(ropa) [${label}] === oráculo`,
      ok,
      ok ? "" : `expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`,
    )
  }

  // ---------- 4. Samples tecnología ----------------------------------
  // Los samples de tec usan los nombres de campo tecnológicos
  // (brand_prefix, reference). Verificamos que normalizan a mayúsculas +
  // alfanum + length cap, y que valores inválidos quedan en vacío —
  // nunca "XX" ni "M".
  const TEC_SAMPLES = [
    ["respuesta vacía",            {}],
    ["brand_prefix 'ip' lower",    { brand_prefix: "ip" },             { type_prefix: "IP", size: "" }],
    ["reference '17 pm' espacio",  { reference: "17 pm" },             { type_prefix: "", size: "17PM" }],
    ["brand_prefix 'SAMSUNG'",     { brand_prefix: "SAMSUNG" },        { type_prefix: "SA", size: "" }],
    ["reference 'TUNE-520!'",      { reference: "TUNE-520!" },         { type_prefix: "", size: "TUNE520" }],
    ["brand_prefix vacío",         { brand_prefix: "" },               { type_prefix: "", size: "" }],
    ["reference vacía",            { reference: "" },                  { type_prefix: "", size: "" }],
    ["name + partial",             { name: "Funda", brand_prefix: "sp" }, { type_prefix: "SP", size: "" }],
  ]
  for (const [label, sample, expectedPartial = {}] of TEC_SAMPLES) {
    const actual = applyMod.applyAnalysisToItem(sample, "tecnologia")
    // Nunca XX ni M.
    const noFallbackLeak =
      actual.type_prefix !== "XX" &&
      actual.size !== "M" &&
      actual.type_prefix !== "XX".toLowerCase() &&
      actual.size !== "M".toLowerCase()
    check(
      `applyAnalysisToItem(tec) [${label}] — nunca cae a XX/M`,
      noFallbackLeak,
      noFallbackLeak ? "" : `type_prefix=${JSON.stringify(actual.type_prefix)} size=${JSON.stringify(actual.size)}`,
    )
    // Si viene con expectedPartial, verificar type_prefix/size concretos.
    if (Object.keys(expectedPartial).length > 0) {
      const partialOk = Object.entries(expectedPartial).every(([k, v]) => actual[k] === v)
      check(
        `applyAnalysisToItem(tec) [${label}] — normaliza correctamente`,
        partialOk,
        partialOk ? "" : `expected=${JSON.stringify(expectedPartial)} actual.type_prefix=${JSON.stringify(actual.type_prefix)} actual.size=${JSON.stringify(actual.size)}`,
      )
    }
  }

  // createInitialItem(tec) debe tener type_prefix: "", size: "", color: "".
  const tecInit = applyMod.createInitialItem("tecnologia")
  check(
    "createInitialItem(tec) — type_prefix vacío, size vacío",
    tecInit.type_prefix === "" && tecInit.size === "",
    `type_prefix=${JSON.stringify(tecInit.type_prefix)} size=${JSON.stringify(tecInit.size)}`,
  )

  // ---------- 5. Mutación automática en memoria ----------------------
  // Patch: Math.round → Math.ceil en la rama ropa de apply-analysis.
  // Volvemos a cargar el módulo mutado, re-corremos el sample con
  // decimales y verificamos que el oráculo detecta la diferencia (fail).
  const mutApply = await loadApplyAnalysis((src) =>
    src.replace(
      "price: Math.round(typeof p.suggested_price === \"number\" ? p.suggested_price : 0),",
      "price: Math.ceil(typeof p.suggested_price === \"number\" ? p.suggested_price : 0),",
    ),
  )
  // 95000.3 → round=95000, ceil=95001 — mutación detectable.
  const sampleDecimals = { suggested_price: 95000.3 }
  const expectedDecimals = oracleAnalyze(sampleDecimals)
  const mutatedActual = mutApply.applyAnalysisToItem(sampleDecimals, "ropa")
  const mutationDetected = !deepEq(mutatedActual.price, expectedDecimals.price)
  check(
    "[behavior-mutation] OK — detectó la mutación Math.round→Math.ceil y falló como esperado",
    mutationDetected,
    `oracle.price=${expectedDecimals.price} mutated.price=${mutatedActual.price}`,
  )

  if (results.fail.length > 0) {
    console.error(`[behavior] FAIL — ${results.fail.length} regla(s) rotas.`)
    process.exit(1)
  }
  console.log(`[behavior] OK — ${results.pass.length} regla(s) satisfechas.`)
}

// ---------- --isolation ----------------------------------------------
async function runIsolation() {
  const profilePath = path.join(REPO_ROOT, "lib/rubro-profiles.ts")
  if (!fs.existsSync(profilePath)) {
    console.log("[isolation] SKIPPED — lib/rubro-profiles.ts no existe (correr tras el refactor).")
    return
  }
  const mod = await loadProfileModule(String(Date.now()))

  const results = { pass: [], fail: [] }
  const check = (name, cond) => {
    (cond ? results.pass : results.fail).push(name)
    console.log(`  ${cond ? "✓" : "✗"} ${name}`)
  }

  function scanTextOf(profile) {
    const parts = [
      profile.buildInstructions({ categories: ["FUNDAS", "CARGADORES", "AUDIFONOS"] }),
      profile.messageTemplate("imagen"),
      profile.messageTemplate("video"),
    ]
    for (const f of Object.values(profile.schema.shape)) if (f.description) parts.push(f.description)
    const ui = profile.ui || {}
    if (ui.labels && typeof ui.labels === "object") {
      for (const p of Object.values(ui.labels)) {
        if (p && p.label) parts.push(p.label)
        if (p && typeof p.placeholder === "string") parts.push(p.placeholder)
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
    // La REGLA DE RUBRO (constante propia) menciona "prendas de vestir"
    // y otros términos de ropa como ejemplos de qué rechazar. Esteban
    // dejó dicho que el escaneo negativo la excluye COMPLETA (no solo
    // la frase corta "no corresponde al rubro") y que una verificación
    // aparte comprueba que existe. Para la exclusión usamos la constante
    // exportada por el perfil.
    const rejectionRuleStripped = stripAccents(mod.REJECTION_RULE_TECNOLOGIA || "")
    const tecText = rejectionRuleStripped
      ? tecTextRaw.replaceAll(rejectionRuleStripped, "")
      : tecTextRaw.replaceAll(stripAccents(REJECTION_PHRASE_TECNOLOGIA), "")
    check("tecnologia.positive — ≥1 marcador TECNOLOGIA presente", TECNOLOGIA_MARKERS.some((t) => wordMatches(tecText, t)))
    const tecBadHits = ROPA_MARKERS.filter((t) => wordMatches(tecText, t))
    check(`tecnologia.negative — 0 marcadores ROPA (hits: ${tecBadHits.join(",") || "ninguno"})`, tecBadHits.length === 0)
    check("tecnologia contiene la frase de rechazo", tecTextRaw.includes(stripAccents(REJECTION_PHRASE_TECNOLOGIA)))
  }

  // Rubro desconocido debe lanzar
  let threw = false
  try { mod.getRubroProfile("desconocido") } catch { threw = true }
  check("getRubroProfile('desconocido') lanza excepción", threw)

  // Fail-closed: si business_settings.rubro falla, viene vacío, o es
  // inválido, la ruta debe fallar sin invocar generateObject. Solo corre
  // si el route ya consume supabase + perfil (post-refactor).
  const routeSrc = fs.readFileSync(path.join(REPO_ROOT, "app/api/analyze-product/route.ts"), "utf8")
  const routeUsesSupabase = /createServerSupabaseClient|from\s+["']@\/lib\/supabase\/server["']/.test(routeSrc)
  if (routeUsesSupabase) {
    const routeMod = await loadRouteWithMocks(String(Date.now()))
    const captures = []
    globalThis.__ropa_capture = (a) => captures.push(a)
    const origErr = console.error
    console.error = () => {}

    async function hit() {
      captures.length = 0
      const req = new Request("http://x/", { method: "POST", body: JSON.stringify({ dataUrl: DUMMY_DATAURL_IMAGE, mediaType: "image/jpeg" }) })
      return routeMod.POST(req)
    }

    // (a) Error de Supabase → NO cae a 'ropa', NO llama generateObject.
    resetAiGlobals()
    globalThis.__ROPA_FIXTURE_SUPABASE_ERROR = true
    const r1 = await hit()
    check("fail-closed: error de business_settings NO llama generateObject", captures.length === 0)
    check("fail-closed: error de business_settings devuelve status >= 400", r1.status >= 400)

    // (b) Sin sesión (auth.getUser devuelve user=null) → 401
    // "unauthenticated". No se consulta business_settings ni se llama al
    // modelo.
    resetAiGlobals()
    globalThis.__ROPA_FIXTURE_AUTH_USER = null
    const r2 = await hit()
    check("no-session: user=null NO llama generateObject", captures.length === 0)
    check("no-session: user=null devuelve status === 401", r2.status === 401)

    // (c) Rubro inválido ("mascotas") → status 500 "rubro_invalid", NO
    // llama al modelo. Nunca cae a 'ropa' por default.
    resetAiGlobals()
    globalThis.__ROPA_FIXTURE_RUBRO = "mascotas"
    const r3 = await hit()
    check("rubro inválido: NO llama generateObject", captures.length === 0)
    check("rubro inválido: devuelve status >= 400", r3.status >= 400)

    // (d) Rol no autorizado (vendedor) → 403 "forbidden". No se llama al
    // modelo. Admin y encargado pasan; vendedor y contador no.
    resetAiGlobals()
    globalThis.__ROPA_FIXTURE_ROLE = "vendedor"
    const r4 = await hit()
    check("rol vendedor: NO llama generateObject", captures.length === 0)
    check("rol vendedor: devuelve status === 403", r4.status === 403)

    // (e) Usuario inactivo → 403 "forbidden".
    resetAiGlobals()
    globalThis.__ROPA_FIXTURE_IS_ACTIVE = false
    const r5 = await hit()
    check("usuario inactivo: NO llama generateObject", captures.length === 0)
    check("usuario inactivo: devuelve status === 403", r5.status === 403)

    // (f) Rubro null (RLS vacío con usuario autenticado) → 503
    // "rubro_missing". NO 401, porque la autenticación ya pasó.
    resetAiGlobals()
    globalThis.__ROPA_FIXTURE_RUBRO = null
    const r6 = await hit()
    check("rubro null: NO llama generateObject", captures.length === 0)
    check("rubro null: devuelve status === 503", r6.status === 503)

    console.error = origErr
  } else {
    console.log("[isolation] fail-closed de business_settings: SKIPPED — route.ts aún no lee supabase.")
  }

  // Scan de literales de ropa en el panel. Si queda alguno hardcoded tras
  // el refactor, el panel está consumiendo strings propios del rubro en
  // vez de leerlos del perfil.
  const panelPath = path.join(REPO_ROOT, "components/central/ai-ingress-panel.tsx")
  const panelSrc = fs.readFileSync(panelPath, "utf8")
  const leaked = PANEL_ROPA_LITERALS.filter((lit) => panelSrc.includes(lit))
  check(
    `panel-literals-leak: 0 literales de ropa hardcoded (hits: ${leaked.join(" | ") || "ninguno"})`,
    leaked.length === 0,
  )

  // Mutation proofs — demostramos que el gate rechaza una fuga cruzada.
  // Modificamos la fuente del perfil EN MEMORIA (transpilamos un source
  // mutado), re-cargamos el módulo y verificamos que la regla negativa
  // ahora falla. Sin tocar el disco.
  async function reloadMutated(mutator) {
    const uiSrc = fs.readFileSync(path.join(REPO_ROOT, "lib/rubro-ui.ts"), "utf8")
    const profSrc = fs.readFileSync(path.join(REPO_ROOT, "lib/rubro-profiles.ts"), "utf8")
    const { uiSrc: mutUi, profSrc: mutProf } = mutator({ uiSrc, profSrc })
    const uiTranspiled = transpileToMjs(mutUi)
    const uiPath = path.join(TMP_DIR, `rubro-ui.mut.${Date.now()}.mjs`)
    fs.writeFileSync(uiPath, uiTranspiled)
    const uiHref = url.pathToFileURL(uiPath).href
    const profTranspiled = transpileToMjs(mutProf, { importRewrites: { "@/lib/rubro-ui": uiHref } })
    const profPath = path.join(TMP_DIR, `rubro-profiles.mut.${Date.now()}.mjs`)
    fs.writeFileSync(profPath, profTranspiled)
    return import(url.pathToFileURL(profPath).href + `?t=${Date.now()}`)
  }

  // Mutación 1: inyectar "talla" (marcador ROPA) en instrucciones de tec.
  const mutTec = await reloadMutated(({ uiSrc, profSrc }) => ({
    uiSrc,
    // Agregamos "talla" al final del TECNOLOGIA_INSTRUCTIONS_BASE antes del
    // último punto. Buscamos un string literal fácil de parchear.
    profSrc: profSrc.replace(
      '"CANTIDAD (`quantity`):',
      '"TALLA: (campo residual inyectado por prueba de mutación) " + "CANTIDAD (`quantity`):',
    ),
  }))
  const mutTecText = scanTextOf(mutTec.getRubroProfile("tecnologia")).replaceAll(stripAccents(REJECTION_PHRASE_TECNOLOGIA), "")
  const mutTecBadHits = ROPA_MARKERS.filter((t) => wordMatches(mutTecText, t))
  check(
    `mutation(ropa→tec): la fuga introducida es detectada (hits esperados: talla; hits: ${mutTecBadHits.join(",") || "ninguno"})`,
    mutTecBadHits.includes("talla"),
  )

  // Mutación 2: inyectar "funda" (marcador TECNOLOGIA) en instrucciones de ropa.
  const mutRopa = await reloadMutated(({ uiSrc, profSrc }) => ({
    uiSrc,
    profSrc: profSrc.replace(
      '"Si detectas una etiqueta de precio o talla en la imagen, úsala.',
      '"Si detectas una funda (texto inyectado por prueba de mutación) o una etiqueta de precio o talla en la imagen, úsala.',
    ),
  }))
  const mutRopaText = scanTextOf(mutRopa.getRubroProfile("ropa"))
  const mutRopaBadHits = TECNOLOGIA_MARKERS.filter((t) => wordMatches(mutRopaText, t))
  check(
    `mutation(tec→ropa): la fuga introducida es detectada (hits esperados: funda; hits: ${mutRopaBadHits.join(",") || "ninguno"})`,
    mutRopaBadHits.includes("funda"),
  )

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

if (DO_BEHAVIOR) {
  await runBehavior()
  rmrf(TMP_DIR)
  process.exit(0)
}

const outDir = DO_VERIFY ? VERIFY_DIR : OUT_DIR
rmrf(outDir); mkd(outDir)

// Post-refactor: dos extractores UI independientes. `--source=route`
// extrae del panel ORIGINAL (git show 1aff84b) vía AST — oráculo
// histórico. `--source=profile` extrae de `lib/rubro-profiles.ts` →
// fuente de verdad actual del rubro. Ambos deben producir bytes
// idénticos: si divergen, el perfil dejó de reflejar el diseño original.
// Prompts/responses/media siempre vienen del route refactorizado con mocks.
await captureFromRoute(outDir)
if (MODE_SOURCE === "route") {
  captureUIFromPanelOracle(outDir)
} else if (MODE_SOURCE === "profile") {
  await captureUIFromProfile(outDir)
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

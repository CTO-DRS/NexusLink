#!/usr/bin/env node
// Extracts Arabic string literals from source files to build the EN translation dictionary
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs"
import { join, extname } from "node:path"

const ROOTS = ["src/components/nexus", "src/lib", "src/hooks", "src/app"]
const SKIP = new Set(["src/lib/i18n.ts", "src/lib/legacy-en.ts"])
const out = new Set()
const attrOut = new Set()

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    const st = statSync(p)
    if (st.isDirectory()) walk(p)
    else if ([".tsx", ".ts"].includes(extname(p)) && !SKIP.has(p.replace(/\\/g, "/"))) {
      scan(readFileSync(p, "utf8"))
    }
  }
}

// match string literals containing Arabic characters
function scan(src) {
  const re = /(['"`])((?:\\.|(?!\1)[^\\\n])*)\1/g
  let m
  while ((m = re.exec(src))) {
    const s = m[2]
    if (/[\u0600-\u06FF]/.test(s) && s.length >= 2 && s.length <= 220) {
      out.add(s)
    }
  }
  // common JSX attrs
  const re2 = /(aria-label|placeholder|title)=(["'])((?:\\.|(?!\2)[^\\\n])*)\2/g
  while ((m = re2.exec(src))) {
    const s = m[3]
    if (/[\u0600-\u06FF]/.test(s)) attrOut.add(s)
  }
  // JSX text children: >النص< (strip expression braces, split on boundaries)
  const re3 = />([^<>]*[\u0600-\u06FF][^<>]*)</g
  while ((m = re3.exec(src))) {
    const segs = m[1].split(/\{[^}]*\}/g)
    for (const s of segs) {
      const t = s.trim()
      if (/[\u0600-\u06FF]/.test(t) && t.length >= 2 && t.length <= 220) {
        out.add(t)
        out.add(s.replace(/\s+/g, " ")) // raw form with surrounding spaces
      }
    }
  }
}

for (const r of ROOTS) walk(r)
const all = [...out].sort()
const attrs = [...attrOut].sort()
writeFileSync("scripts/ar-strings.json", JSON.stringify({ strings: all, attrs }, null, 0))
console.log("strings:", all.length, "| attrs:", attrs.length)
console.log(all.slice(0, 40).join("\n---\n"))

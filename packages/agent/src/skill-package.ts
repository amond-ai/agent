import { encodeBase64 } from './base64.ts'
import type { PackagedSkillDirectory, PackagedSkillFile, SkillReference } from './types.ts'

export interface SkillPackageInput {
  name: string
  description: string
  files: ReadonlyArray<{ path: string, content: Uint8Array }>
}

const directoryKey = Symbol.for('@amond-ai/agent/packaged-skill/v1')
const encoder = new TextEncoder()

export function buildPackagedSkill(input: SkillPackageInput): PackagedSkillDirectory {
  const entries = [...input.files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  )
  const hashInput: Uint8Array[] = []
  const files: Record<string, PackagedSkillFile> = Object.create(null)
  for (const entry of entries) {
    const pathBytes = encoder.encode(entry.path)
    const content = new Uint8Array(entry.content)
    const lengths = new Uint8Array(8)
    const view = new DataView(lengths.buffer)
    view.setUint32(0, pathBytes.byteLength)
    view.setUint32(4, content.byteLength)
    hashInput.push(lengths, pathBytes, content)
    files[entry.path] = Object.freeze({
      encoding: 'base64',
      kind: isTextContent(content) ? 'text' : 'binary',
      content: encodeBase64(content),
    })
  }
  return Object.freeze({
    id: `skill:${input.name}:${sha256Hex(concatBytes(hashInput)).slice(0, 16)}`,
    name: input.name,
    description: input.description,
    files: Object.freeze(files),
  })
}

export function createSkillReference(directory: PackagedSkillDirectory): SkillReference {
  const reference: SkillReference = {
    __amondSkillReference: true,
    id: directory.id,
    name: directory.name,
    description: directory.description,
  }
  Object.defineProperty(reference, directoryKey, { value: directory })
  return Object.freeze(reference)
}

export function getSkillReferenceDirectory(
  reference: SkillReference,
): PackagedSkillDirectory | undefined {
  return (reference as SkillReference & { [directoryKey]?: PackagedSkillDirectory })[directoryKey]
}

function isTextContent(content: Uint8Array): boolean {
  if (content.includes(0)) { return false }
  try {
    new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(content)
    return true
  }
  catch {
    return false
  }
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.byteLength
  }
  return result
}

function sha256Hex(input: Uint8Array): string {
  const constants = new Uint32Array([
    0x428A2F98, 
    0x71374491, 
    0xB5C0FBCF, 
    0xE9B5DBA5, 
    0x3956C25B, 
    0x59F111F1, 
    0x923F82A4, 
    0xAB1C5ED5,
    0xD807AA98, 
    0x12835B01, 
    0x243185BE, 
    0x550C7DC3, 
    0x72BE5D74, 
    0x80DEB1FE, 
    0x9BDC06A7, 
    0xC19BF174,
    0xE49B69C1, 
    0xEFBE4786, 
    0x0FC19DC6, 
    0x240CA1CC, 
    0x2DE92C6F, 
    0x4A7484AA, 
    0x5CB0A9DC, 
    0x76F988DA,
    0x983E5152, 
    0xA831C66D, 
    0xB00327C8, 
    0xBF597FC7, 
    0xC6E00BF3, 
    0xD5A79147, 
    0x06CA6351, 
    0x14292967,
    0x27B70A85, 
    0x2E1B2138, 
    0x4D2C6DFC, 
    0x53380D13, 
    0x650A7354, 
    0x766A0ABB, 
    0x81C2C92E, 
    0x92722C85,
    0xA2BFE8A1, 
    0xA81A664B, 
    0xC24B8B70, 
    0xC76C51A3, 
    0xD192E819, 
    0xD6990624, 
    0xF40E3585, 
    0x106AA070,
    0x19A4C116, 
    0x1E376C08, 
    0x2748774C, 
    0x34B0BCB5, 
    0x391C0CB3, 
    0x4ED8AA4A, 
    0x5B9CCA4F, 
    0x682E6FF3,
    0x748F82EE, 
    0x78A5636F, 
    0x84C87814, 
    0x8CC70208, 
    0x90BEFFFA, 
    0xA4506CEB, 
    0xBEF9A3F7, 
    0xC67178F2,
  ])
  const length = input.byteLength
  const paddedLength = Math.ceil((length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  padded.set(input)
  padded[length] = 0x80
  const view = new DataView(padded.buffer)
  const bitLength = BigInt(length) * 8n
  view.setUint32(paddedLength - 8, Number(bitLength >> 32n))
  view.setUint32(paddedLength - 4, Number(bitLength & 0xFFFFFFFFn))
  const state = new Uint32Array([
    0x6A09E667, 
    0xBB67AE85, 
    0x3C6EF372, 
    0xA54FF53A, 
    0x510E527F, 
    0x9B05688C, 
    0x1F83D9AB, 
    0x5BE0CD19,
  ])
  const words = new Uint32Array(64)
  const word = (index: number) => words[index] ?? 0
  const constant = (index: number) => constants[index] ?? 0
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index++) { words[index] = view.getUint32(offset + index * 4) }
    for (let index = 16; index < 64; index++) {
      const a = word(index - 15)
      const b = word(index - 2)
      const s0 = rotateRight(a, 7) ^ rotateRight(a, 18) ^ (a >>> 3)
      const s1 = rotateRight(b, 17) ^ rotateRight(b, 19) ^ (b >>> 10)
      words[index] = (word(index - 16) + s0 + word(index - 7) + s1) >>> 0
    }
    let a = state[0] ?? 0
    let b = state[1] ?? 0
    let c = state[2] ?? 0
    let d = state[3] ?? 0
    let e = state[4] ?? 0
    let f = state[5] ?? 0
    let g = state[6] ?? 0
    let h = state[7] ?? 0
    for (let index = 0; index < 64; index++) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
      const choice = (e & f) ^ (~e & g)
      const temporary1 = (h + sum1 + choice + constant(index) + word(index)) >>> 0
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
      const majority = (a & b) ^ (a & c) ^ (b & c)
      const temporary2 = (sum0 + majority) >>> 0
      h = g
      g = f
      f = e
      e = (d + temporary1) >>> 0
      d = c
      c = b
      b = a
      a = (temporary1 + temporary2) >>> 0
    }
    state[0] = (wordFrom(state, 0) + a) >>> 0
    state[1] = (wordFrom(state, 1) + b) >>> 0
    state[2] = (wordFrom(state, 2) + c) >>> 0
    state[3] = (wordFrom(state, 3) + d) >>> 0
    state[4] = (wordFrom(state, 4) + e) >>> 0
    state[5] = (wordFrom(state, 5) + f) >>> 0
    state[6] = (wordFrom(state, 6) + g) >>> 0
    state[7] = (wordFrom(state, 7) + h) >>> 0
  }
  return [...state].map(word => word.toString(16).padStart(8, '0')).join('')
}

function wordFrom(words: Uint32Array, index: number): number {
  return words[index] ?? 0
}

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount))
}

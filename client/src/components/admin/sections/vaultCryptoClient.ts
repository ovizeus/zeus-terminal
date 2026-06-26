// [VAULT 2026-06-26] Zero-knowledge vault — browser crypto (WebCrypto / SubtleCrypto).
// The vault password NEVER leaves this device. We generate an RSA-OAEP keypair;
// the public key is stored on the server (used to encrypt new items — by the
// operator here, or by the assistant server-side); the private key is wrapped
// under PBKDF2(password) + AES-GCM and stored as ciphertext. Reading requires the
// password (unwrap private key here). Format is byte-compatible with the server
// helper (server/services/vaultCrypto.js): encKey = RSA-OAEP(raw 32B AES key);
// ciphertext = AES-256-GCM(ct||tag). Vetted primitives only.

const subtle = (): SubtleCrypto => {
  const c = (window.crypto || (window as any).msCrypto)
  if (!c || !c.subtle) throw new Error('WebCrypto unavailable (needs HTTPS)')
  return c.subtle
}
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' }
const enc = new TextEncoder()
const dec = new TextDecoder()
// TS 5.x narrows Uint8Array to Uint8Array<ArrayBufferLike>, which no longer matches
// BufferSource directly — cast at the WebCrypto boundary (runtime is unaffected).
const bs = (d: ArrayBuffer | ArrayBufferView): BufferSource => d as unknown as BufferSource

function b64(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i])
  return btoa(s)
}
function unb64(s: string): Uint8Array {
  const bin = atob(s)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return u
}
function spkiToPem(der: ArrayBuffer): string {
  const b = b64(der).replace(/(.{64})/g, '$1\n')
  return `-----BEGIN PUBLIC KEY-----\n${b}\n-----END PUBLIC KEY-----`
}
function pemToDer(pem: string): Uint8Array {
  return unb64(pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, ''))
}

async function deriveKdfKey(password: string, salt: Uint8Array, iters: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', bs(enc.encode(password)), 'PBKDF2', false, ['deriveKey'])
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: bs(salt), iterations: iters, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

export interface VaultKeyBlob { publicKey: string; wrappedPriv: string; salt: string; iv: string; kdfIters: number }

// First-time setup: generate keypair, wrap private key under the password.
export async function generateVault(password: string): Promise<VaultKeyBlob> {
  const kp = await subtle().generateKey(
    { ...RSA, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) } as RsaHashedKeyGenParams,
    true, ['encrypt', 'decrypt'],
  ) as CryptoKeyPair
  const spki = await subtle().exportKey('spki', kp.publicKey)
  const pkcs8 = await subtle().exportKey('pkcs8', kp.privateKey)
  const salt = window.crypto.getRandomValues(new Uint8Array(16))
  const iv = window.crypto.getRandomValues(new Uint8Array(12))
  const iters = 210000
  const kdf = await deriveKdfKey(password, salt, iters)
  const wrapped = await subtle().encrypt({ name: 'AES-GCM', iv: bs(iv) }, kdf, bs(pkcs8))
  return { publicKey: spkiToPem(spki), wrappedPriv: b64(wrapped), salt: b64(salt), iv: b64(iv), kdfIters: iters }
}

// Unlock: returns the RSA-OAEP private CryptoKey, held only in memory. Throws on wrong password.
export async function unlock(password: string, blob: VaultKeyBlob): Promise<CryptoKey> {
  const kdf = await deriveKdfKey(password, unb64(blob.salt), blob.kdfIters || 210000)
  let pkcs8: ArrayBuffer
  try {
    pkcs8 = await subtle().decrypt({ name: 'AES-GCM', iv: bs(unb64(blob.iv)) }, kdf, bs(unb64(blob.wrappedPriv)))
  } catch { throw new Error('WRONG_PASSWORD') }
  return subtle().importKey('pkcs8', bs(pkcs8), RSA, false, ['decrypt'])
}

async function importPublic(pem: string): Promise<CryptoKey> {
  return subtle().importKey('spki', bs(pemToDer(pem)), RSA, false, ['encrypt'])
}

export interface EncItem {
  category: string; type: 'secret' | 'note' | 'link' | 'file'
  encKey: string; metaIv: string; metaCt: string
  fileIv?: string; fileBlob?: Uint8Array
}
export interface ItemMeta { name: string; note?: string; content?: string; fileName?: string }

// Encrypt an item for the public key (operator-side add). One random AES key
// encrypts the metadata and, for files, the file bytes (different IVs); the AES
// key is RSA-wrapped. Byte-compatible with the server helper.
export async function encryptItem(publicPem: string, category: string, type: EncItem['type'], meta: ItemMeta, fileBytes?: Uint8Array): Promise<EncItem> {
  const pub = await importPublic(publicPem)
  const rawAes = window.crypto.getRandomValues(new Uint8Array(32))
  const aesKey = await subtle().importKey('raw', bs(rawAes), { name: 'AES-GCM' }, false, ['encrypt'])
  const metaIv = window.crypto.getRandomValues(new Uint8Array(12))
  const metaCt = await subtle().encrypt({ name: 'AES-GCM', iv: bs(metaIv) }, aesKey, bs(enc.encode(JSON.stringify(meta))))
  const encKey = await subtle().encrypt(RSA, pub, bs(rawAes))
  const out: EncItem = { category, type, encKey: b64(encKey), metaIv: b64(metaIv), metaCt: b64(metaCt) }
  if (type === 'file' && fileBytes) {
    const fileIv = window.crypto.getRandomValues(new Uint8Array(12))
    const blob = await subtle().encrypt({ name: 'AES-GCM', iv: bs(fileIv) }, aesKey, bs(fileBytes))
    out.fileIv = b64(fileIv)
    out.fileBlob = new Uint8Array(blob)
  }
  return out
}

// Decrypt an item row (from the list) — returns metadata + the AES key (for the file blob too).
export async function decryptMeta(priv: CryptoKey, row: { enc_key: string; meta_iv: string; meta_ct: string }): Promise<{ meta: ItemMeta; aesKey: CryptoKey }> {
  const rawAes = await subtle().decrypt(RSA, priv, bs(unb64(row.enc_key)))
  const aesKey = await subtle().importKey('raw', bs(rawAes), { name: 'AES-GCM' }, false, ['decrypt'])
  const metaBuf = await subtle().decrypt({ name: 'AES-GCM', iv: bs(unb64(row.meta_iv)) }, aesKey, bs(unb64(row.meta_ct)))
  return { meta: JSON.parse(dec.decode(metaBuf)) as ItemMeta, aesKey }
}

export async function decryptFile(aesKey: CryptoKey, fileIv: string, encryptedBlob: Uint8Array): Promise<Uint8Array> {
  const buf = await subtle().decrypt({ name: 'AES-GCM', iv: bs(unb64(fileIv)) }, aesKey, bs(encryptedBlob))
  return new Uint8Array(buf)
}

// Browser-native encryption for the Teamwork API key at rest.
//
// We use PBKDF2 to derive a key from the user's session password,
// then AES-GCM to encrypt/decrypt the API key. Everything happens in
// the browser via the Web Crypto API — no third-party libraries, no
// secrets cross any network boundary except the plaintext API key
// itself which has to go to Teamwork via our proxy (unavoidable).
//
// At rest, localStorage holds an opaque base64 blob that is useless
// without the session password.
//
// Format of the stored blob: base64(salt[16] || iv[12] || ciphertext)

const PBKDF2_ITERATIONS = 250_000;
const KEY_LEN_BITS = 256;
const SALT_LEN = 16;
const IV_LEN = 12;

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const raw = atob(s);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: KEY_LEN_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptString(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(password, salt);
  const enc = new TextEncoder();
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, enc.encode(plaintext)),
  );

  // Concat: salt || iv || ciphertext
  const out = new Uint8Array(salt.length + iv.length + ciphertext.length);
  out.set(salt, 0);
  out.set(iv, salt.length);
  out.set(ciphertext, salt.length + iv.length);
  return b64encode(out);
}

export async function decryptString(blob: string, password: string): Promise<string> {
  const bytes = b64decode(blob);
  if (bytes.length < SALT_LEN + IV_LEN + 1) {
    throw new Error("Encrypted blob too short");
  }
  const salt = bytes.slice(0, SALT_LEN);
  const iv = bytes.slice(SALT_LEN, SALT_LEN + IV_LEN);
  const ciphertext = bytes.slice(SALT_LEN + IV_LEN);
  const key = await deriveKey(password, salt);
  let plaintextBuf: ArrayBuffer;
  try {
    plaintextBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, ciphertext as BufferSource);
  } catch {
    throw new Error("Incorrect password");
  }
  return new TextDecoder().decode(plaintextBuf);
}

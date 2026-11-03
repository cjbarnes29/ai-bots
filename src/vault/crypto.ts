import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const ALGORITHM = "aes-256-gcm";

export interface Encrypted {
  iv: string;
  tag: string;
  ciphertext: string;
}

/**
 * Encrypts a secret. The secret's NAME is bound into the encryption, so an encrypted value copied
 * under a different name will not decrypt.
 */
export function encryptSecret(key: Buffer, name: string, value: string): Encrypted {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(name, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

/** Throws if the key is wrong or the stored data was changed. */
export function decryptSecret(key: Buffer, name: string, data: Encrypted): string {
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(data.iv, "base64"));
  decipher.setAAD(Buffer.from(name, "utf8"));
  decipher.setAuthTag(Buffer.from(data.tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data.ciphertext, "base64")), decipher.final()]).toString("utf8");
}

/**
 * The encryption key is kept in its own file, away from the database, so a copy of the database
 * (a backup, or a file you send to someone) does not contain readable secrets.
 * Anyone who can read BOTH files on this PC can decrypt them: this protects secrets at rest, not from a hostile local user.
 */
export function loadOrCreateKeyFile(path: string): Buffer {
  if (existsSync(path)) {
    const key = Buffer.from(readFileSync(path, "utf8").trim(), "hex");
    if (key.length !== 32) throw new Error(`The vault key file ${path} is damaged (it must hold 64 hexadecimal characters).`);
    return key;
  }
  mkdirSync(dirname(path), { recursive: true });
  const key = randomBytes(32);
  writeFileSync(path, key.toString("hex"), { flag: "wx", mode: 0o600 });
  return key;
}

export function newEphemeralKey(): Buffer {
  return randomBytes(32);
}

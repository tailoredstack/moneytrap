// Encryption for values the platform must hold but never return, such as network credentials (DM-016, spec §4.4). The
// key ID travels with the ciphertext, so keys can rotate without re-encrypting everything at once. `context` binds a
// ciphertext to the row it was sealed for, so a copied ciphertext does not open under another row. open throws when the
// key is unknown or the ciphertext does not verify; its error never carries the plaintext or the ciphertext.
export interface SealedSecret {
  keyId: string;
  ciphertext: string;
}

export interface SecretBox {
  seal(plaintext: string, context: string): SealedSecret;
  open(sealed: SealedSecret, context: string): string;
}

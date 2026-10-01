/** SHA-256 dos bytes em hexadecimal minúsculo (o formato que o servidor confere no upload). */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(hash, (b) => b.toString(16).padStart(2, '0')).join('');
}

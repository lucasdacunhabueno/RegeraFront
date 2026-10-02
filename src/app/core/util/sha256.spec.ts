import { sha256Hex } from './sha256';

describe('sha256Hex', () => {
  it('devolve o SHA-256 em hexadecimal minúsculo (vetor do FIPS 180-2)', async () => {
    const bytes = new TextEncoder().encode('abc');
    expect(await sha256Hex(bytes.buffer as ArrayBuffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('bytes vazios', async () => {
    expect(await sha256Hex(new ArrayBuffer(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});

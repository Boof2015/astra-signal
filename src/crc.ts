/** CRC-16/CCITT-FALSE: poly 0x1021, init 0xffff, no reflection, xorout 0. */
export function crc16Ccitt(bytes: ReadonlyArray<number>): number {
  let crc = 0xffff;
  for (const byte of bytes) {
    crc ^= (byte & 0xff) << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc;
}

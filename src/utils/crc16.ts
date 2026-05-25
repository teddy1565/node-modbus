/**
 * CRC16 (Modbus) — polynomial 0xA001, initial value 0xFFFF.
 *
 * Ported verbatim from node-modbus-serial `utils/crc16.js`; behaviour is
 * byte-for-byte identical (see note 02-algorithms.md).
 *
 * @param buffer the bytes to checksum (must NOT include the CRC itself).
 * @returns the 16-bit CRC as an unsigned integer (0..0xFFFF).
 */
export function crc16(buffer: Buffer): number {
    let crc = 0xFFFF;
    let odd: number;

    for (let i = 0; i < buffer.length; i++) {
        crc = crc ^ buffer[i];

        for (let j = 0; j < 8; j++) {
            odd = crc & 0x0001;
            crc = crc >> 1;
            if (odd) {
                crc = crc ^ 0xA001;
            }
        }
    }

    return crc;
}

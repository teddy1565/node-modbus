/**
 * LRC (Longitudinal Redundancy Check) — used by Modbus ASCII.
 *
 * Algorithm: two's complement of the 8-bit sum of all bytes.
 * Ported from node-modbus-serial `utils/lrc.js` (see note 02-algorithms.md).
 *
 * @param buffer the bytes to checksum (address + PDU, without the LRC byte).
 * @returns the 8-bit LRC as an unsigned integer (0..0xFF).
 */
export function lrc(buffer: Buffer): number {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i] & 0xFF;
    }

    return ((sum ^ 0xFF) + 1) & 0xFF;
}

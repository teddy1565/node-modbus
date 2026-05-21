/**
 * Bit operations on a Buffer.
 *
 * node-modbus-serial patches `Buffer.prototype` with `writeBit`/`readBit`;
 * this re-implementation provides them as pure functions instead, so the
 * global `Buffer` prototype is never polluted (see note 12-architecture.md).
 *
 * Bit ordering follows Modbus coil packing: bit 0 is the LSB of the first
 * data byte.
 */

/**
 * Set one bit in a buffer.
 *
 * @param buffer the target buffer.
 * @param value the new state of the bit.
 * @param bitIndex linear bit index across the data region.
 * @param offset byte offset where the data region starts.
 */
export function writeBit(buffer: Buffer, value: boolean | 0 | 1, bitIndex: number, offset: number): void {
    const byteOffset = Math.floor(bitIndex / 8) + offset;
    const bitOffset = bitIndex % 8;
    const bitMask = 0x1 << bitOffset;

    let byte = buffer.readUInt8(byteOffset);
    if (value) {
        byte |= bitMask;
    } else {
        byte &= ~bitMask;
    }
    buffer.writeUInt8(byte, byteOffset);
}

/**
 * Read one bit from a buffer.
 *
 * @param buffer the source buffer.
 * @param bitIndex linear bit index across the data region.
 * @param offset byte offset where the data region starts.
 * @returns the state of the bit.
 */
export function readBit(buffer: Buffer, bitIndex: number, offset: number): boolean {
    const byteOffset = Math.floor(bitIndex / 8) + offset;
    const bitOffset = bitIndex % 8;
    const bitMask = 0x1 << bitOffset;

    const byte = buffer.readUInt8(byteOffset);
    return (byte & bitMask) === bitMask;
}

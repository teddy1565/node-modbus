/**
 * TestPort — an in-memory Modbus slave simulator (no real I/O).
 *
 * Simulates six slave behaviours selected by unit id (see notes 05 §9, 13 §3):
 *   1 — answers correctly
 *   2 — answers with short (truncated) data
 *   3 — answers with a bad CRC
 *   4 — answers with the wrong unit id
 *   5 — answers with a Modbus exception
 *   6 — does not answer at all
 *
 * Primarily used to exercise the client core's error-handling paths.
 */

import { crc16 } from "../utils/crc16";
import { readBit } from "../utils/buffer-bit";
import { encodeRtuFrame, parseRtuFrame } from "../protocol/framing";
import { EXCEPTION_BIT } from "../protocol/constants";
import { AbsModbusTransport } from "./transport.interface";

/** Minimum acceptable request frame length for TestPort. */
const MIN_DATA_LENGTH = 7;

export class TestPort extends AbsModbusTransport {
    /** 11 simulated input registers. */
    private readonly registers: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    /** 11 simulated holding registers. */
    private readonly holdingRegisters: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0xa12b, 0xffff, 0xb21a];
    /** 16 simulated coils / digital inputs, packed as a bitfield. */
    private coils = 0x0000;

    public get isOpen(): boolean {
        return true;
    }

    public open(callback: (error?: Error) => void): void {
        callback();
    }

    public close(callback: (error?: Error) => void): void {
        callback();
    }

    public write(frame: Buffer, transactionId: number): void {
        if (frame.length < MIN_DATA_LENGTH) {
            return;
        }

        const crcIn = frame.readUInt16LE(frame.length - 2);
        if (crcIn !== crc16(frame.subarray(0, frame.length - 2))) {
            return; // bad CRC: ignore, like a real slave
        }

        const { unitId, pdu } = parseRtuFrame(frame);
        const responsePdu = this.buildResponse(pdu);
        if (responsePdu === null) {
            return;
        }

        const response = this.corrupt(unitId, encodeRtuFrame(unitId, responsePdu));
        if (response === null) {
            return; // unit 6: no answer
        }

        setImmediate(() => this.emit("data", response, transactionId));
    }

    /** Build the response PDU for a request PDU, or null if unsupported. */
    private buildResponse(pdu: Buffer): Buffer | null {
        const fc = pdu.readUInt8(0);

        switch (fc) {
            case 1:
            case 2: {
                const address = pdu.readUInt16BE(1);
                const length = pdu.readUInt16BE(3);
                const dataBytes = Math.trunc((length - 1) / 8 + 1);
                const resp = Buffer.alloc(2 + dataBytes);
                resp.writeUInt8(fc, 0);
                resp.writeUInt8(dataBytes, 1);
                resp.writeUInt16LE((this.coils >> address) & 0xffff, 2);
                return resp;
            }
            case 3:
            case 4: {
                const address = pdu.readUInt16BE(1);
                const length = pdu.readUInt16BE(3);
                const source = fc === 3 ? this.holdingRegisters : this.registers;
                const resp = Buffer.alloc(2 + length * 2);
                resp.writeUInt8(fc, 0);
                resp.writeUInt8(length * 2, 1);
                for (let i = 0; i < length; i++) {
                    resp.writeUInt16BE(source[address + i] ?? 0, 2 + i * 2);
                }
                return resp;
            }
            case 5: {
                const address = pdu.readUInt16BE(1);
                const state = pdu.readUInt16BE(3);
                if (state === 0xff00) {
                    this.coils |= 1 << address;
                } else {
                    this.coils &= ~(1 << address);
                }
                return Buffer.from(pdu); // echo
            }
            case 6: {
                const address = pdu.readUInt16BE(1);
                this.holdingRegisters[address] = pdu.readUInt16BE(3);
                return Buffer.from(pdu); // echo
            }
            case 15: {
                const address = pdu.readUInt16BE(1);
                const length = pdu.readUInt16BE(3);
                for (let i = 0; i < length; i++) {
                    if (readBit(pdu, i, 6)) {
                        this.coils |= 1 << (address + i);
                    } else {
                        this.coils &= ~(1 << (address + i));
                    }
                }
                return Buffer.from(pdu.subarray(0, 5)); // [fc][addr][qty]
            }
            case 16: {
                const address = pdu.readUInt16BE(1);
                const length = pdu.readUInt16BE(3);
                for (let i = 0; i < length; i++) {
                    this.holdingRegisters[address + i] = pdu.readUInt16BE(6 + i * 2);
                }
                return Buffer.from(pdu.subarray(0, 5));
            }
            case 22: {
                const address = pdu.readUInt16BE(1);
                const andMask = pdu.readUInt16BE(3);
                const orMask = pdu.readUInt16BE(5);
                const old = this.holdingRegisters[address] ?? 0;
                this.holdingRegisters[address] = (old & andMask) | (orMask & ~andMask);
                return Buffer.from(pdu); // echo
            }
            case 43: {
                const productCode = "MyProductCode1234";
                const resp = Buffer.alloc(7 + 2 + productCode.length);
                resp.writeUInt8(43, 0);
                resp.writeUInt8(0x0e, 1); // MEI type
                resp.writeUInt8(pdu.readUInt8(2), 2); // read device id code (echo)
                resp.writeUInt8(0x01, 3); // conformity level
                resp.writeUInt8(0, 4); // more follows
                resp.writeUInt8(0, 5); // next object id
                resp.writeUInt8(1, 6); // number of objects
                resp.writeUInt8(pdu.readUInt8(3), 7); // object id (echo)
                resp.writeUInt8(productCode.length, 8);
                resp.write(productCode, 9, "ascii");
                return resp;
            }
            case 100: {
                // Custom: multiply each data byte by 2.
                const resp = Buffer.alloc(pdu.length);
                resp.writeUInt8(100, 0);
                for (let i = 1; i < pdu.length; i++) {
                    resp.writeUInt8((pdu.readUInt8(i) * 2) & 0xff, i);
                }
                return resp;
            }
            default:
                return null;
        }
    }

    /** Apply the per-unit fault behaviour, returning null for "no answer". */
    private corrupt(unitId: number, frame: Buffer): Buffer | null {
        switch (unitId) {
            case 2: {
                // short data
                return frame.subarray(0, frame.length - 5);
            }
            case 3: {
                // bad CRC
                const corrupted = Buffer.from(frame);
                corrupted.writeUInt16LE((crc16(frame.subarray(0, frame.length - 2)) + 1) & 0xffff, frame.length - 2);
                return corrupted;
            }
            case 4: {
                // wrong unit id
                const corrupted = Buffer.from(frame);
                corrupted.writeUInt8((unitId + 2) & 0xff, 0);
                corrupted.writeUInt16LE(crc16(corrupted.subarray(0, corrupted.length - 2)), corrupted.length - 2);
                return corrupted;
            }
            case 5: {
                // exception response
                const fc = frame.readUInt8(1);
                return encodeRtuFrame(unitId, Buffer.from([fc | EXCEPTION_BIT, 0x04]));
            }
            case 6:
                return null; // no answer
            default:
                return frame; // unit 1 (and others): correct
        }
    }
}

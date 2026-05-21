/**
 * Function-code encoders and parsers.
 *
 * Each `encode*Request` builds a request PDU (`[function code][data]`);
 * each `parse*Response` decodes a response PDU. Pure functions, no I/O —
 * directly comparable byte-for-byte with node-modbus-serial's `writeFCxx`
 * buffer assembly and `_readFCxx` parsing (see note 03).
 */

import { readBit, writeBit } from "../utils/buffer-bit";
import {
    ModbusFunctionCode,
    MEI_TYPE_DEVICE_IDENTIFICATION,
    MAX_READ_REGISTERS_FC23,
    MAX_WRITE_REGISTERS_FC23,
} from "./constants";
import type {
    IModbusReadRequest_Result,
    IWriteCoilResult,
    IWriteRegisterResult,
    IWriteMultipleResult,
    IReportServerIDResult,
    IReadFileRecordsResult,
    IMaskWriteRegisterResult,
    IReadWriteRegistersResult,
    ICustomFunctionResult,
    RegisterValue,
} from "./types";

/** Number of data bytes needed to pack `bitCount` coils. */
function coilByteCount(bitCount: number): number {
    return Math.ceil(bitCount / 8);
}

// ── FC1/2 — Read Coils / Read Discrete Inputs ──────────────────────

/** Build a Read Coils (FC1) or Read Discrete Inputs (FC2) request PDU. */
export function encodeReadBitsRequest(
    functionCode: ModbusFunctionCode.READ_COILS | ModbusFunctionCode.READ_DISCRETE_INPUTS,
    dataAddress: number,
    quantity: number,
): Buffer {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(functionCode, 0);
    pdu.writeUInt16BE(dataAddress, 1);
    pdu.writeUInt16BE(quantity, 3);
    return pdu;
}

/** Parse a FC1/FC2 response PDU into a boolean array. */
export function parseReadBitsResponse(pdu: Buffer): IModbusReadRequest_Result<boolean[]> {
    const byteCount = pdu.readUInt8(1);
    const contents: boolean[] = [];
    for (let i = 0; i < byteCount; i++) {
        let reg = pdu[i + 2];
        for (let j = 0; j < 8; j++) {
            contents.push((reg & 1) === 1);
            reg = reg >> 1;
        }
    }
    return { data: contents, buffer: pdu.subarray(2, 2 + byteCount) };
}

// ── FC3/4 — Read Holding / Input Registers ─────────────────────────

/** Build a Read Holding Registers (FC3) or Read Input Registers (FC4) request PDU. */
export function encodeReadRegistersRequest(
    functionCode: ModbusFunctionCode.READ_HOLDING_REGISTERS | ModbusFunctionCode.READ_INPUT_REGISTERS,
    dataAddress: number,
    quantity: number,
): Buffer {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(functionCode, 0);
    pdu.writeUInt16BE(dataAddress, 1);
    pdu.writeUInt16BE(quantity, 3);
    return pdu;
}

/** Parse a FC3/FC4 response PDU into a 16-bit register array. */
export function parseReadRegistersResponse(pdu: Buffer): IModbusReadRequest_Result<number[]> {
    const byteCount = pdu.readUInt8(1);
    const contents: number[] = [];
    for (let i = 0; i < byteCount; i += 2) {
        contents.push(pdu.readUInt16BE(i + 2));
    }
    return { data: contents, buffer: pdu.subarray(2, 2 + byteCount) };
}

// ── FC5 — Write Single Coil ────────────────────────────────────────

/** Build a Write Single Coil (FC5) request PDU. */
export function encodeWriteCoilRequest(dataAddress: number, state: boolean): Buffer {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(ModbusFunctionCode.WRITE_SINGLE_COIL, 0);
    pdu.writeUInt16BE(dataAddress, 1);
    pdu.writeUInt16BE(state ? 0xff00 : 0x0000, 3);
    return pdu;
}

/** Parse a FC5 response PDU. */
export function parseWriteCoilResponse(pdu: Buffer): IWriteCoilResult {
    return {
        address: pdu.readUInt16BE(1),
        state: pdu.readUInt16BE(3) === 0xff00,
    };
}

// ── FC6 — Write Single Register ────────────────────────────────────

/** Build a Write Single Register (FC6) request PDU. */
export function encodeWriteRegisterRequest(dataAddress: number, value: RegisterValue): Buffer {
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(ModbusFunctionCode.WRITE_SINGLE_REGISTER, 0);
    pdu.writeUInt16BE(dataAddress, 1);
    if (Buffer.isBuffer(value)) {
        value.copy(pdu, 3, 0, 2);
    } else {
        pdu.writeUInt16BE(value, 3);
    }
    return pdu;
}

/** Parse a FC6 response PDU. */
export function parseWriteRegisterResponse(pdu: Buffer): IWriteRegisterResult {
    return {
        address: pdu.readUInt16BE(1),
        value: pdu.readUInt16BE(3),
    };
}

// ── FC15 — Write Multiple Coils ────────────────────────────────────

/** Build a Write Multiple Coils (FC15) request PDU. */
export function encodeWriteCoilsRequest(dataAddress: number, states: boolean[]): Buffer {
    const byteCount = coilByteCount(states.length);
    const pdu = Buffer.alloc(6 + byteCount);
    pdu.writeUInt8(ModbusFunctionCode.WRITE_MULTIPLE_COILS, 0);
    pdu.writeUInt16BE(dataAddress, 1);
    pdu.writeUInt16BE(states.length, 3);
    pdu.writeUInt8(byteCount, 5);
    for (let i = 0; i < states.length; i++) {
        if (states[i]) {
            writeBit(pdu, 1, i, 6);
        }
    }
    return pdu;
}

/** Parse a FC15/FC16 response PDU (shared layout: address + quantity). */
export function parseWriteMultipleResponse(pdu: Buffer): IWriteMultipleResult {
    return {
        address: pdu.readUInt16BE(1),
        length: pdu.readUInt16BE(3),
    };
}

// ── FC16 — Write Multiple Registers ────────────────────────────────

/** Build a Write Multiple Registers (FC16) request PDU. */
export function encodeWriteRegistersRequest(dataAddress: number, values: number[] | Buffer): Buffer {
    const dataLength = Buffer.isBuffer(values) ? values.length / 2 : values.length;
    const byteCount = dataLength * 2;
    const pdu = Buffer.alloc(6 + byteCount);
    pdu.writeUInt8(ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS, 0);
    pdu.writeUInt16BE(dataAddress, 1);
    pdu.writeUInt16BE(dataLength, 3);
    pdu.writeUInt8(byteCount, 5);
    if (Buffer.isBuffer(values)) {
        values.copy(pdu, 6);
    } else {
        for (let i = 0; i < dataLength; i++) {
            pdu.writeUInt16BE(values[i], 6 + 2 * i);
        }
    }
    return pdu;
}

// ── FC17 — Report Server ID ────────────────────────────────────────

/** Build a Report Server ID (FC17) request PDU. */
export function encodeReportServerIdRequest(): Buffer {
    return Buffer.from([ModbusFunctionCode.REPORT_SERVER_ID]);
}

/** Parse a FC17 response PDU. */
export function parseReportServerIdResponse(pdu: Buffer): IReportServerIDResult {
    const byteCount = pdu.readUInt8(1);
    const serverId = pdu.readUInt8(2);
    const running = pdu.readUInt8(3) === 0xff;
    const additionalData =
        byteCount > 2 ? Buffer.from(pdu.subarray(4, 4 + byteCount - 2)) : Buffer.alloc(0);
    return { serverId, running, additionalData };
}

// ── FC20 — Read File Records ───────────────────────────────────────

/** Reference type byte for a file record sub-request. */
const FC20_REFERENCE_TYPE = 6;
/** Fixed record-length value used by node-modbus-serial. */
const FC20_RECORD_LENGTH = 100;

/** Build a Read File Records (FC20) request PDU (single sub-request). */
export function encodeReadFileRecordsRequest(fileNumber: number, recordNumber: number): Buffer {
    const pdu = Buffer.alloc(9);
    pdu.writeUInt8(ModbusFunctionCode.READ_FILE_RECORDS, 0);
    pdu.writeUInt8(7, 1); // byte count of the sub-request
    pdu.writeUInt8(FC20_REFERENCE_TYPE, 2);
    pdu.writeUInt16BE(fileNumber, 3);
    pdu.writeUInt16BE(recordNumber, 5);
    // offset 7 is the record-length high byte, left zero by Buffer.alloc.
    pdu.writeUInt8(FC20_RECORD_LENGTH, 8);
    return pdu;
}

/** Parse a FC20 response PDU. */
export function parseReadFileRecordsResponse(pdu: Buffer): IReadFileRecordsResult {
    const fileRespLength = pdu.readUInt8(1);
    const data: number[] = [];
    for (let i = 4; i < fileRespLength + 4; i++) {
        data.push(pdu.readUInt8(i));
    }
    return { data, length: fileRespLength };
}

// ── FC22 — Mask Write Register ─────────────────────────────────────

/** Build a Mask Write Register (FC22) request PDU. */
export function encodeMaskWriteRegisterRequest(
    dataAddress: number,
    andMask: number,
    orMask: number,
): Buffer {
    const pdu = Buffer.alloc(7);
    pdu.writeUInt8(ModbusFunctionCode.MASK_WRITE_REGISTER, 0);
    pdu.writeUInt16BE(dataAddress, 1);
    pdu.writeUInt16BE(andMask, 3);
    pdu.writeUInt16BE(orMask, 5);
    return pdu;
}

/** Parse a FC22 response PDU. */
export function parseMaskWriteRegisterResponse(pdu: Buffer): IMaskWriteRegisterResult {
    return {
        address: pdu.readUInt16BE(1),
        andMask: pdu.readUInt16BE(3),
        orMask: pdu.readUInt16BE(5),
    };
}

// ── FC23 — Read/Write Multiple Registers ───────────────────────────

/** Validate an FC23 register count: integer within `1..max`. */
function isValidFc23Count(n: number, max: number): boolean {
    return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= max;
}

/**
 * Build a Read/Write Multiple Registers (FC23) request PDU.
 *
 * @throws Error when register counts are out of range or `valuesToWrite`
 *   does not match `numWrite`.
 */
export function encodeReadWriteRegistersRequest(
    readAddress: number,
    numRead: number,
    writeAddress: number,
    valuesToWrite: number[] | Buffer,
): Buffer {
    if (!Array.isArray(valuesToWrite) && !Buffer.isBuffer(valuesToWrite)) {
        throw new Error("valuesToWrite must be an array or buffer");
    }
    if (!isValidFc23Count(numRead, MAX_READ_REGISTERS_FC23)) {
        throw new Error(`numRead must be an integer from 1 to ${MAX_READ_REGISTERS_FC23}`);
    }
    const numWrite = Buffer.isBuffer(valuesToWrite) ? valuesToWrite.length / 2 : valuesToWrite.length;
    if (!isValidFc23Count(numWrite, MAX_WRITE_REGISTERS_FC23)) {
        throw new Error(`numWrite must be an integer from 1 to ${MAX_WRITE_REGISTERS_FC23}`);
    }

    const writeByteCount = numWrite * 2;
    const pdu = Buffer.alloc(10 + writeByteCount);
    pdu.writeUInt8(ModbusFunctionCode.READ_WRITE_MULTIPLE_REGISTERS, 0);
    pdu.writeUInt16BE(readAddress, 1);
    pdu.writeUInt16BE(numRead, 3);
    pdu.writeUInt16BE(writeAddress, 5);
    pdu.writeUInt16BE(numWrite, 7);
    pdu.writeUInt8(writeByteCount, 9);
    if (Buffer.isBuffer(valuesToWrite)) {
        valuesToWrite.copy(pdu, 10);
    } else {
        for (let i = 0; i < numWrite; i++) {
            pdu.writeUInt16BE(valuesToWrite[i], 10 + 2 * i);
        }
    }
    return pdu;
}

/** Parse a FC23 response PDU — note: no `buffer` field. */
export function parseReadWriteRegistersResponse(pdu: Buffer): IReadWriteRegistersResult {
    const byteCount = pdu.readUInt8(1);
    const data: number[] = [];
    for (let i = 0; i < byteCount; i += 2) {
        data.push(pdu.readUInt16BE(i + 2));
    }
    return { data };
}

// ── FC43 — Read Device Identification (MEI 0x0E) ───────────────────

/** Result of parsing one FC43 response (may be one of several). */
export interface IDeviceIdentificationPartial {
    result: Record<number, string>;
    conformityLevel: number;
    moreFollows: boolean;
    nextObjectId: number;
}

/** Build a Read Device Identification (FC43) request PDU. */
export function encodeReadDeviceIdentificationRequest(deviceIdCode: number, objectId: number): Buffer {
    const pdu = Buffer.alloc(4);
    pdu.writeUInt8(ModbusFunctionCode.READ_DEVICE_IDENTIFICATION, 0);
    pdu.writeUInt8(MEI_TYPE_DEVICE_IDENTIFICATION, 1);
    pdu.writeUInt8(deviceIdCode, 2);
    pdu.writeUInt8(objectId, 3);
    return pdu;
}

/**
 * Parse one FC43 response PDU. The response may be split across several
 * frames; the client core uses `moreFollows`/`nextObjectId` to keep reading.
 */
export function parseDeviceIdentificationResponse(pdu: Buffer): IDeviceIdentificationPartial {
    const conformityLevel = pdu.readUInt8(3);
    const moreFollows = pdu.readUInt8(4) !== 0;
    const nextObjectId = pdu.readUInt8(5);
    const numOfObjects = pdu.readUInt8(6);

    const result: Record<number, string> = {};
    let startAt = 7;
    for (let i = 0; i < numOfObjects && startAt < pdu.length; i++) {
        const objectId = pdu.readUInt8(startAt);
        const objectLength = pdu.readUInt8(startAt + 1);
        const startOfData = startAt + 2;
        result[objectId] = pdu.toString("ascii", startOfData, startOfData + objectLength);
        startAt = startOfData + objectLength;
    }
    return { result, conformityLevel, moreFollows, nextObjectId };
}

// ── Custom function codes (FC65-72 / FC100-110) ────────────────────

/** Build a custom-function request PDU. */
export function encodeCustomFunctionRequest(functionCode: number, data: number[] | Buffer): Buffer {
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const pdu = Buffer.alloc(1 + bytes.length);
    pdu.writeUInt8(functionCode, 0);
    bytes.copy(pdu, 1);
    return pdu;
}

/** Parse a custom-function response PDU. */
export function parseCustomFunctionResponse(pdu: Buffer): ICustomFunctionResult {
    const data: number[] = [];
    for (let i = 1; i < pdu.length; i++) {
        data.push(pdu.readUInt8(i));
    }
    return { data, buffer: Buffer.from(pdu.subarray(1)) };
}

/** Re-exported so callers can pack coil arrays consistently. */
export { readBit, writeBit, coilByteCount };

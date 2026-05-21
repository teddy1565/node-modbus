/**
 * ADU framing — convert between PDUs and the wire formats of each transport.
 *
 * The client/server cores work internally with **RTU frames**
 * (`address + PDU + CRC16-LE`); transports use these helpers to translate
 * to/from their physical wire format (see notes 01, 12).
 */

import { crc16 } from "../utils/crc16";
import { lrc } from "../utils/lrc";
import { CRC_LENGTH, LRC_LENGTH, MBAP_LENGTH, ASCII_START_CHAR, ASCII_END_DELIMITER } from "./constants";

/** A parsed RTU frame. */
export interface IRtuFrame {
    unitId: number;
    /** Protocol Data Unit: function code + data. */
    pdu: Buffer;
    /** Whether the trailing CRC16 matched. */
    crcValid: boolean;
}

/** A parsed TCP frame (MBAP header + PDU). */
export interface ITcpFrame {
    transactionId: number;
    protocolId: number;
    /** MBAP Length field (unit id + PDU byte count). */
    length: number;
    unitId: number;
    pdu: Buffer;
}

/**
 * Build an RTU frame: `address + PDU + CRC16-LE`.
 *
 * @param unitId the slave/unit address.
 * @param pdu the Protocol Data Unit (function code + data).
 */
export function encodeRtuFrame(unitId: number, pdu: Buffer): Buffer {
    const frame = Buffer.alloc(1 + pdu.length + CRC_LENGTH);
    frame.writeUInt8(unitId & 0xff, 0);
    pdu.copy(frame, 1);
    frame.writeUInt16LE(crc16(frame.subarray(0, frame.length - CRC_LENGTH)), 1 + pdu.length);
    return frame;
}

/**
 * Parse an RTU frame and verify its CRC.
 *
 * @param frame `address + PDU + CRC16-LE`.
 */
export function parseRtuFrame(frame: Buffer): IRtuFrame {
    const unitId = frame.readUInt8(0);
    const pdu = frame.subarray(1, frame.length - CRC_LENGTH);
    const crcIn = frame.readUInt16LE(frame.length - CRC_LENGTH);
    const crcValid = crcIn === crc16(frame.subarray(0, frame.length - CRC_LENGTH));
    return { unitId, pdu, crcValid };
}

/**
 * Build a Modbus TCP frame: `MBAP header + unit id + PDU` (no CRC).
 *
 * @param transactionId MBAP transaction identifier.
 * @param unitId the unit id.
 * @param pdu the Protocol Data Unit.
 */
export function encodeTcpFrame(transactionId: number, unitId: number, pdu: Buffer): Buffer {
    const frame = Buffer.alloc(MBAP_LENGTH + 1 + pdu.length);
    frame.writeUInt16BE(transactionId & 0xffff, 0); // Transaction Identifier
    frame.writeUInt16BE(0, 2); // Protocol Identifier (always 0)
    frame.writeUInt16BE(1 + pdu.length, 4); // Length: unit id + PDU
    frame.writeUInt8(unitId & 0xff, 6); // Unit Identifier
    pdu.copy(frame, MBAP_LENGTH + 1);
    return frame;
}

/**
 * Parse a Modbus TCP frame.
 *
 * @param frame `MBAP header + unit id + PDU`.
 */
export function parseTcpFrame(frame: Buffer): ITcpFrame {
    return {
        transactionId: frame.readUInt16BE(0),
        protocolId: frame.readUInt16BE(2),
        length: frame.readUInt16BE(4),
        unitId: frame.readUInt8(6),
        pdu: frame.subarray(MBAP_LENGTH + 1),
    };
}

/**
 * Convert an RTU frame to a Modbus TCP frame (strip CRC, prepend MBAP).
 */
export function rtuFrameToTcp(transactionId: number, rtuFrame: Buffer): Buffer {
    const { unitId, pdu } = parseRtuFrame(rtuFrame);
    return encodeTcpFrame(transactionId, unitId, pdu);
}

/**
 * Convert a Modbus TCP frame to an RTU frame (strip MBAP, append CRC16).
 */
export function tcpFrameToRtu(tcpFrame: Buffer): Buffer {
    const { unitId, pdu } = parseTcpFrame(tcpFrame);
    return encodeRtuFrame(unitId, pdu);
}

/**
 * ASCII-encode an RTU frame: `":" + hex(address+PDU+LRC) + CRLF`.
 * The 2-byte CRC of the RTU frame is replaced by a 1-byte LRC.
 *
 * @param rtuFrame `address + PDU + CRC16-LE`.
 * @param startChar start-of-frame character (default ":").
 */
export function encodeAsciiFrame(rtuFrame: Buffer, startChar: number = ASCII_START_CHAR): Buffer {
    const dataLength = rtuFrame.length - CRC_LENGTH; // address + PDU
    const body = Buffer.alloc(dataLength + LRC_LENGTH); // address + PDU + LRC
    rtuFrame.copy(body, 0, 0, dataLength);
    body.writeUInt8(lrc(rtuFrame.subarray(0, dataLength)), dataLength);

    const hex = body.toString("hex").toUpperCase();
    return Buffer.from(String.fromCharCode(startChar) + hex + ASCII_END_DELIMITER, "ascii");
}

/**
 * Decode an ASCII frame back to an RTU frame (LRC replaced by CRC16).
 *
 * @param ascii a complete ASCII frame including the start char and CRLF.
 * @returns the RTU frame, or `null` if the LRC check fails.
 */
export function decodeAsciiFrame(ascii: Buffer): Buffer | null {
    // ascii = startChar(1) + hex chars + CRLF(2)
    const hexCharCount = ascii.length - 3;
    if (hexCharCount <= 0 || hexCharCount % 2 !== 0) {
        return null;
    }
    const decoded = Buffer.from(ascii.toString("ascii", 1, 1 + hexCharCount), "hex"); // address + PDU + LRC
    if (decoded.length < 2) {
        return null;
    }

    const body = decoded.subarray(0, decoded.length - LRC_LENGTH); // address + PDU
    const lrcIn = decoded[decoded.length - 1];
    if (lrc(body) !== lrcIn) {
        return null;
    }

    const rtu = Buffer.alloc(body.length + CRC_LENGTH);
    body.copy(rtu, 0);
    rtu.writeUInt16LE(crc16(body), body.length);
    return rtu;
}

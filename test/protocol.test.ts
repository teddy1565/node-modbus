/**
 * Protocol-layer tests — crc16, lrc, framing and function-code codecs.
 *
 * Test vectors are drawn from note 13/14 (extracted from node-modbus-serial's
 * own test suite), so the re-implementation is verified byte-for-byte.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
    crc16,
    lrc,
    encodeRtuFrame,
    parseRtuFrame,
    encodeTcpFrame,
    parseTcpFrame,
    encodeAsciiFrame,
    decodeAsciiFrame,
    encodeReadRegistersRequest,
    parseReadRegistersResponse,
    encodeReadBitsRequest,
    parseReadBitsResponse,
    encodeWriteCoilRequest,
    parseWriteCoilResponse,
    encodeReadWriteRegistersRequest,
    ModbusFunctionCode,
} from "../dist/index.js";

test("crc16 — note 13 vectors", () => {
    assert.equal(crc16(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 0])), 50227);
    assert.equal(crc16(Buffer.from("110100130025", "hex")), 33806);
});

test("lrc — note 13 vector", () => {
    assert.equal(lrc(Buffer.from("1103006B0003", "hex")), 126);
});

test("encodeRtuFrame — FC3 request frame (note 13)", () => {
    const frame = encodeRtuFrame(1, encodeReadRegistersRequest(ModbusFunctionCode.READ_HOLDING_REGISTERS, 8, 3));
    assert.equal(frame.toString("hex"), "0103000800038409");
});

test("parseRtuFrame — verifies CRC", () => {
    const frame = encodeRtuFrame(1, encodeReadBitsRequest(ModbusFunctionCode.READ_COILS, 8, 4));
    const parsed = parseRtuFrame(frame);
    assert.equal(parsed.crcValid, true);
    assert.equal(parsed.unitId, 1);

    const corrupt = Buffer.from(frame);
    corrupt[corrupt.length - 1] ^= 0xff;
    assert.equal(parseRtuFrame(corrupt).crcValid, false);
});

test("TCP frame roundtrip", () => {
    const pdu = encodeReadRegistersRequest(ModbusFunctionCode.READ_HOLDING_REGISTERS, 5, 4);
    const tcp = encodeTcpFrame(0x1234, 7, pdu);
    const parsed = parseTcpFrame(tcp);
    assert.equal(parsed.transactionId, 0x1234);
    assert.equal(parsed.protocolId, 0);
    assert.equal(parsed.unitId, 7);
    assert.deepEqual(parsed.pdu, pdu);
});

test("ASCII frame — encode/decode roundtrip (note 14)", () => {
    const rtu = encodeRtuFrame(0x11, Buffer.from("03006B0003", "hex"));
    const ascii = encodeAsciiFrame(rtu);
    assert.equal(ascii.toString("ascii"), ":1103006B00037E\r\n");
    assert.deepEqual(decodeAsciiFrame(ascii), rtu);
});

test("decodeAsciiFrame — rejects a bad LRC", () => {
    const ascii = Buffer.from(":1103006B00037F\r\n", "ascii"); // LRC 7F instead of 7E
    assert.equal(decodeAsciiFrame(ascii), null);
});

test("FC3 response parse — note 13 [42,128,5]", () => {
    const result = parseReadRegistersResponse(Buffer.from("0306002a00800005", "hex"));
    assert.deepEqual(result.data, [42, 128, 5]);
});

test("FC1 response parse — bit unpacking (LSB first)", () => {
    // byte count 1, data byte 0b00001101 -> coils 0,2,3 set
    const result = parseReadBitsResponse(Buffer.from("01010d", "hex"));
    assert.deepEqual(result.data.slice(0, 4), [true, false, true, true]);
});

test("FC5 — write coil request/response", () => {
    assert.equal(encodeWriteCoilRequest(13, true).toString("hex"), "05000dff00");
    assert.equal(encodeWriteCoilRequest(13, false).toString("hex"), "05000d0000");
    const r = parseWriteCoilResponse(Buffer.from("05000dff00", "hex"));
    assert.deepEqual(r, { address: 13, state: true });
});

test("FC23 — encoder enforces register-count limits", () => {
    assert.throws(() => encodeReadWriteRegistersRequest(0, 0, 0, [1]), /numRead/);
    assert.throws(() => encodeReadWriteRegistersRequest(0, 126, 0, [1]), /numRead/);
    assert.throws(() => encodeReadWriteRegistersRequest(0, 1, 0, []), /numWrite/);
    // 123 writes is allowed (serial-impl limit), 124 is not.
    assert.doesNotThrow(() => encodeReadWriteRegistersRequest(0, 1, 0, new Array(123).fill(0)));
    assert.throws(() => encodeReadWriteRegistersRequest(0, 1, 0, new Array(124).fill(0)), /numWrite/);
});

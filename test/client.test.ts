/**
 * Client-core tests against the in-memory TestPort.
 *
 * TestPort simulates six slave behaviours by unit id; these tests exercise
 * both the happy path and every error path of the validation pipeline
 * (see notes 04 §6, 13 §3).
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
    ModbusClientCore,
    TestPort,
    encodeReadRegistersRequest,
    parseReadRegistersResponse,
    encodeWriteRegisterRequest,
    parseWriteRegisterResponse,
    ModbusFunctionCode,
} from "../dist/index.js";

function openCore(timeout = 200): Promise<ModbusClientCore> {
    const core = new ModbusClientCore({ transport: new TestPort(), timeout });
    return new Promise((resolve, reject) => {
        core.open((error) => (error ? reject(error) : resolve(core)));
    });
}

const readHolding = (core: ModbusClientCore, unit: number, addr: number, qty: number) =>
    core.request({
        unitId: unit,
        functionCode: ModbusFunctionCode.READ_HOLDING_REGISTERS,
        pdu: encodeReadRegistersRequest(ModbusFunctionCode.READ_HOLDING_REGISTERS, addr, qty),
        expectedLength: 3 + 2 * qty + 2,
        parse: parseReadRegistersResponse,
    });

test("FC3 — reads TestPort holding registers", async () => {
    const core = await openCore();
    const result = await readHolding(core, 1, 8, 3);
    assert.deepEqual(result.data, [0xa12b, 0xffff, 0xb21a]);
    await new Promise<void>((r) => core.close(() => r()));
});

test("FC6 write then FC3 read back", async () => {
    const core = await openCore();
    await core.request({
        unitId: 1,
        functionCode: ModbusFunctionCode.WRITE_SINGLE_REGISTER,
        pdu: encodeWriteRegisterRequest(2, 4321),
        expectedLength: 8,
        parse: parseWriteRegisterResponse,
    });
    const result = await readHolding(core, 1, 2, 1);
    assert.deepEqual(result.data, [4321]);
    await new Promise<void>((r) => core.close(() => r()));
});

test("unit 3 — bad CRC rejects with CrcError", async () => {
    const core = await openCore();
    await assert.rejects(readHolding(core, 3, 8, 1), (error: Error) => error.name === "CrcError");
    await new Promise<void>((r) => core.close(() => r()));
});

test("unit 5 — exception response rejects with ModbusExceptionError", async () => {
    const core = await openCore();
    await assert.rejects(readHolding(core, 5, 8, 1), (error: Error & { modbusCode?: number }) => {
        return error.name === "ModbusExceptionError" && error.modbusCode === 4;
    });
    await new Promise<void>((r) => core.close(() => r()));
});

test("unit 6 — no answer rejects with TransactionTimedOutError", async () => {
    const core = await openCore(120);
    await assert.rejects(
        readHolding(core, 6, 8, 1),
        (error: Error) => error.name === "TransactionTimedOutError",
    );
    await new Promise<void>((r) => core.close(() => r()));
});

test("requests are serialised — concurrent calls all settle in order", async () => {
    const core = await openCore();
    const results = await Promise.all([
        readHolding(core, 1, 8, 1),
        readHolding(core, 1, 9, 1),
        readHolding(core, 1, 10, 1),
    ]);
    assert.deepEqual(
        results.map((r) => r.data[0]),
        [0xa12b, 0xffff, 0xb21a],
    );
    await new Promise<void>((r) => core.close(() => r()));
});

test("a failed request does not stall the queue behind it", async () => {
    const core = await openCore(120);
    const failing = assert.rejects(readHolding(core, 6, 8, 1)); // unit 6 never answers
    const ok = await readHolding(core, 1, 8, 1); // queued behind the failing one
    assert.deepEqual(ok.data, [0xa12b]);
    await failing;
    await new Promise<void>((r) => core.close(() => r()));
});

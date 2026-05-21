/**
 * Worker-layer tests — typed reads/writes and batch polling.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { ModbusTCPServer, ModbusTCPClient, ModbusWorker, bufferize, unbufferize } from "../dist/index.js";
import type { IModbusServerVector } from "../dist/index.js";

const PORT = 5601;

test("bufferize / unbufferize — int32 / float roundtrip", () => {
    assert.deepEqual(unbufferize(bufferize([305419896, -1], "int32"), "int32"), [305419896, -1]);
    const floats = unbufferize(bufferize([3.5, -2.25], "float"), "float");
    assert.deepEqual(floats, [3.5, -2.25]);
});

test("worker send/poll over a live server", async () => {
    // 8 holding registers; [0..1] hold one int32 = 0x00010002.
    const holding = [0x0001, 0x0002, 100, 200, 300, 400, 500, 600];
    const vector: IModbusServerVector = {
        getHoldingRegister: (addr) => holding[addr] ?? 0,
        setRegister: (addr, value) => {
            holding[addr] = value;
        },
        setRegisterArray: (addr, values) => {
            values.forEach((value, i) => (holding[addr + i] = value));
        },
    };

    const server = new ModbusTCPServer(vector, { host: "127.0.0.1", port: PORT });
    await new Promise<void>((resolve) => server.once("initialized", resolve));
    const client = new ModbusTCPClient({ host: "127.0.0.1", port: PORT, timeout: 1000 });
    await client.connect();
    const worker = new ModbusWorker(client);

    try {
        // typed int32 read: registers 0,1 -> 0x00010002
        const i32 = (await worker.send({ fc: 3, address: 0, quantity: 1, type: "int32" })) as number[];
        assert.deepEqual(i32, [0x00010002]);

        // typed int16 read of registers 2..5
        const i16 = (await worker.send({ fc: 3, address: 2, quantity: 4, type: "int16" })) as number[];
        assert.deepEqual(i16, [100, 200, 300, 400]);

        // typed int32 write then read back
        await worker.send({ fc: 16, address: 2, value: [0x12345678], type: "int32" });
        const back = (await worker.send({ fc: 3, address: 2, quantity: 1, type: "int32" })) as number[];
        assert.deepEqual(back, [0x12345678]);

        // batch poll of scattered int16 registers
        const polled = await worker.poll({
            map: [{ fc: 3, address: [4, 5, 6, 7], type: "int16" }],
        });
        assert.equal(polled[4], 300);
        assert.equal(polled[7], 600);
    } finally {
        await client.disconnect();
        await server.close();
    }
});

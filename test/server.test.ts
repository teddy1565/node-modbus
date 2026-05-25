/**
 * End-to-end server tests — a ModbusTCPServer and ModbusTCPClient talking
 * over a real localhost socket.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { ModbusTCPServer, ModbusTCPClient } from "../dist/index.js";
import type { IModbusServerVector } from "../dist/index.js";

const PORT = 5599;

/** Spin up a server + connected client sharing a small register/coil store. */
async function withPair(
    run: (client: ModbusTCPClient) => Promise<void>,
    vector?: IModbusServerVector,
): Promise<void> {
    const holding = [10, 20, 30, 40, 50];
    const coils = [true, false, true, false];
    const v: IModbusServerVector = vector ?? {
        getHoldingRegister: (addr) => holding[addr] ?? 0,
        getInputRegister: (addr) => 1000 + addr,
        getCoil: (addr) => coils[addr] ?? false,
        setRegister: (addr, value) => {
            holding[addr] = value;
        },
        setCoil: (addr, state) => {
            coils[addr] = state;
        },
        setRegisterArray: (addr, values) => {
            values.forEach((value, i) => (holding[addr + i] = value));
        },
        reportServerID: () => ({ id: 7, running: true, additionalData: Buffer.from("ok") }),
    };

    const server = new ModbusTCPServer(v, { host: "127.0.0.1", port: PORT });
    await new Promise<void>((resolve) => server.once("initialized", resolve));
    const client = new ModbusTCPClient({ host: "127.0.0.1", port: PORT, timeout: 1000 });
    await client.connect();
    try {
        await run(client);
    } finally {
        await client.disconnect();
        await server.close();
    }
}

test("FC3/FC4/FC1 — reads", async () => {
    await withPair(async (client) => {
        assert.deepEqual((await client.read_holding_registers(0, 5)).data, [10, 20, 30, 40, 50]);
        assert.deepEqual((await client.read_input_registers(0, 3)).data, [1000, 1001, 1002]);
        assert.deepEqual((await client.read_coils(0, 4)).data.slice(0, 4), [true, false, true, false]);
    });
});

test("FC6/FC5/FC16 — writes round-trip", async () => {
    await withPair(async (client) => {
        assert.equal((await client.write_register(2, 999)).value, 999);
        assert.deepEqual((await client.read_holding_registers(2, 1)).data, [999]);

        assert.equal((await client.write_coil(1, true)).state, true);
        assert.equal((await client.read_coils(1, 1)).data[0], true);

        assert.equal((await client.write_registers(0, [7, 8, 9])).length, 3);
        assert.deepEqual((await client.read_holding_registers(0, 3)).data, [7, 8, 9]);
    });
});

test("FC15 — write multiple coils round-trip", async () => {
    const coilStore: boolean[] = [];
    await withPair(
        async (client) => {
            const result = await client.write_coils(0, [true, false, true, true]);
            assert.equal(result.length, 4);
            assert.deepEqual(coilStore.slice(0, 4), [true, false, true, true]);
        },
        {
            setCoilArray: (addr, states) => {
                states.forEach((state, i) => (coilStore[addr + i] = state));
            },
            getCoil: (addr) => coilStore[addr] ?? false,
        },
    );
});

test("FC23 — read/write multiple registers in one transaction", async () => {
    await withPair(async (client) => {
        // write [77,88] at address 3, read 5 registers from address 0
        const result = await client.read_write_registers(0, 5, 3, [77, 88]);
        assert.deepEqual(result.data, [10, 20, 30, 77, 88]);
    });
});

test("FC22 — mask write register", async () => {
    await withPair(async (client) => {
        // reg[0] = 10 (0b01010); and 0xF0F0, or 0x0003 -> (10 & 0xF0F0)|(0x0003 & ~0xF0F0)
        await client.mask_write_register(0, 0xf0f0, 0x0003);
        const value = (await client.read_holding_registers(0, 1)).data[0];
        assert.equal(value, (10 & 0xf0f0) | (0x0003 & ~0xf0f0));
    });
});

test("FC17 — report server id", async () => {
    await withPair(async (client) => {
        const result = await client.report_server_id();
        assert.equal(result.serverId, 7);
        assert.equal(result.running, true);
        assert.equal(result.additionalData.toString(), "ok");
    });
});

test("unsupported function code yields an illegal-function exception", async () => {
    await withPair(async (client) => {
        await assert.rejects(
            client.read_discrete_inputs(0, 1), // no getDiscreteInput in the vector
            (error: Error & { modbusCode?: number }) =>
                error.name === "ModbusExceptionError" && error.modbusCode === 1,
        );
    });
});

test("a Promise-style vector handler is awaited", async () => {
    await withPair(
        async (client) => {
            const result = await client.read_holding_registers(0, 2);
            assert.deepEqual(result.data, [111, 222]);
        },
        {
            getHoldingRegister: (addr) => Promise.resolve([111, 222][addr] ?? 0),
        },
    );
});

test("a callback-style vector handler is supported", async () => {
    await withPair(
        async (client) => {
            const result = await client.read_holding_registers(0, 2);
            assert.deepEqual(result.data, [333, 444]);
        },
        {
            getHoldingRegister: (addr, _unitId, callback) => {
                callback(null, [333, 444][addr] ?? 0);
            },
        },
    );
});

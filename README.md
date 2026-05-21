# node-modbus

A TypeScript Modbus library for **TCP** and **RTU**, providing both **client**
(master) and **server** (slave) implementations.

## Background

[node-modbus-serial](https://github.com/yaacov/node-modbus-serial#readme) is
probably the most complete and easy-to-use Modbus package in the existing
community. I have also contributed to it, but it still has several issues:

- Incomplete TS type definitions — this largely prevents developers from using
  editor autocompletion or type checking. Although it has Modbus TCP/RTU
  Client/Server functionality, the lack of documentation and unclear types
  means developers must read the source to use it.
- The underlying implementation is too bloated to fully utilise V8's
  performance — many prototype-chain modifications, and a large number of
  allocated objects that can cause GC/OOM/performance issues.

This package is a clean re-implementation: a pure, fully-typed protocol core
with four explicit top-level classes.

## Features

- **Four top-level classes** — `ModbusTCPClient`, `ModbusRTUClient`,
  `ModbusTCPServer`, `ModbusRTUServer`.
- **Function codes** — FC1-6, 15, 16, 17, 20, 22, 23, 43, plus custom codes.
- **Transports** — TCP, RTU (serial), Modbus ASCII, UDP, RTU-over-TCP,
  telnet, and the C701 UDP-to-serial bridge.
- **Promise API** — every request returns a `Promise`; fully typed results.
- **Reliable by design** — requests are serialised, every transaction has a
  single settle point, and a closed/failed connection rejects all pending
  requests (no permanently-pending promises).
- **Extras** — a Worker layer for typed (`int32`/`float`/…) reads and batch
  polling, and the Enron 32-bit register variant.
- **No `Buffer.prototype` pollution**; pure, unit-tested protocol functions.

## Install

```sh
npm install node-modbus-lib
```

`serialport` is a dependency and is only loaded when a serial transport
(RTU / ASCII) is used.

## Quick start

### TCP client

```ts
import { ModbusTCPClient } from "node-modbus-lib";

const client = new ModbusTCPClient({ host: "192.168.1.10", port: 502, timeout: 2000 });
await client.connect();

const holding = await client.read_holding_registers(0, 10); // { data: number[], buffer }
console.log(holding.data);

await client.write_register(4, 1234);
await client.write_coils(0, [true, false, true]);

await client.disconnect();
```

### RTU client

```ts
import { ModbusRTUClient } from "node-modbus-lib";

const client = new ModbusRTUClient({ path: "/dev/ttyUSB0", baud_rate: 9600, unit_id: 1 });
await client.connect();
const result = await client.read_input_registers(0, 4);
await client.disconnect();
```

### TCP server

```ts
import { ModbusTCPServer, IModbusServerVector } from "node-modbus-lib";

const registers = new Map<number, number>();

const vector: IModbusServerVector = {
    getHoldingRegister: (address) => registers.get(address) ?? 0,
    setRegister: (address, value) => { registers.set(address, value); },
    getCoil: (address) => false,
};

const server = new ModbusTCPServer(vector, { host: "0.0.0.0", port: 502 });
server.on("initialized", () => console.log("listening"));
server.on("socketError", (err) => console.error(err));
```

A vector handler may be written in **value**, **Promise**, or **callback**
style — all three are detected automatically:

```ts
const vector: IModbusServerVector = {
    getHoldingRegister: (address) => 42,                       // value
    getInputRegister: async (address) => readFromDevice(address), // Promise
    getCoil: (address, unitId, callback) => callback(null, true), // callback
};
```

## API overview

### Client methods (`ModbusTCPClient` / `ModbusRTUClient`)

| Method | Function code |
|--------|---------------|
| `read_coils(address, quantity, unitId?)` | FC1 |
| `read_discrete_inputs(address, quantity, unitId?)` | FC2 |
| `read_holding_registers(address, quantity, unitId?)` | FC3 |
| `read_input_registers(address, quantity, unitId?)` | FC4 |
| `write_coil(address, state, unitId?)` | FC5 |
| `write_register(address, value, unitId?)` | FC6 |
| `write_coils(address, states, unitId?)` | FC15 |
| `write_registers(address, values, unitId?)` | FC16 |
| `report_server_id(unitId?)` | FC17 |
| `read_file_records(fileNumber, recordNumber, unitId?)` | FC20 |
| `mask_write_register(address, andMask, orMask, unitId?)` | FC22 |
| `read_write_registers(readAddr, readQty, writeAddr, values, unitId?)` | FC23 |
| `read_device_identification(deviceIdCode, objectId, unitId?)` | FC43 |
| `custom_function(functionCode, data, unitId?)` | FC65-72 / 100-110 |

Lifecycle: `connect()`, `disconnect()` / `close()`, `destroy()`, `is_open`.
Settings: `set_id()`, `set_timeout()`, `set_debug_enabled()`.

### Transports

`ModbusTCPClient` accepts `transport: "tcp" | "tcp-rtu-buffered" | "telnet" |
"udp" | "c701"` (default `"tcp"`).
`ModbusRTUClient` accepts `transport: "rtu" | "ascii"` (default `"rtu"`).

### Errors

All errors extend `ModbusError`: `PortNotOpenError`, `BadAddressError`,
`TransactionTimedOutError`, `SerialPortError`, `ModbusExceptionError`
(carries `modbusCode`), `CrcError`, `UnexpectedDataError`.

```ts
import { ModbusExceptionError } from "node-modbus-lib";

try {
    await client.read_holding_registers(0, 1);
} catch (err) {
    if (err instanceof ModbusExceptionError) {
        console.error("device exception code:", err.modbusCode);
    }
}
```

## Worker — typed reads & batch polling

```ts
import { ModbusWorker } from "node-modbus-lib";

const worker = new ModbusWorker(client);

// read one int32 (two registers) starting at address 0
const [value] = (await worker.send({ fc: 3, address: 0, quantity: 1, type: "int32" })) as number[];

// batch-poll scattered addresses (contiguous ones are coalesced)
const values = await worker.poll({
    map: [{ fc: 3, address: [0, 2, 4], type: "float" }],
});
```

## Enron variant

```ts
const client = new ModbusTCPClient({
    host: "192.168.1.10",
    enron: true,
    enron_tables: { shortRange: [3001, 3999] },
});
// addresses outside shortRange are encoded as 32-bit registers
```

## Build & test

```sh
npm run build   # compile src/ to dist/
npm test        # build, then run the test suite (Node's built-in runner)
```

## License

MIT

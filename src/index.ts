/**
 * node-modbus-lib — a TypeScript Modbus library for TCP and RTU.
 *
 * Public entry point. Exposes four top-level classes — `ModbusTCPClient`,
 * `ModbusRTUClient`, `ModbusTCPServer`, `ModbusRTUServer` — over a shared,
 * pure protocol core (see note 12-architecture.md).
 */

import { SerialPort } from "serialport";

// ── Clients ────────────────────────────────────────────────────────
export { AbsModbusClient } from "./client/abs-modbus-client";
export type { IModbusClientBaseOptions } from "./client/abs-modbus-client";
export { ModbusClientCore } from "./client/modbus-client-core";
export type { IRequestSpec, IModbusClientCoreOptions, ResponseParser } from "./client/modbus-client-core";
export { ModbusTCPClient } from "./client/modbus-tcp-client";
export type { IModbusTCPClientOptions, TcpTransportKind } from "./client/modbus-tcp-client";
export { ModbusRTUClient } from "./client/modbus-rtu-client";
export type { IModbusRTUClientOptions, SerialTransportKind } from "./client/modbus-rtu-client";

// ── Servers ────────────────────────────────────────────────────────
export { ModbusServerCore } from "./server/modbus-server-core";
export type { IModbusServerCoreOptions, ResponseWriter } from "./server/modbus-server-core";
export { ModbusTCPServer } from "./server/modbus-tcp-server";
export type { IModbusTCPServerOptions, IModbusServerEvents } from "./server/modbus-tcp-server";
export { ModbusRTUServer } from "./server/modbus-rtu-server";
export type { IModbusRTUServerOptions } from "./server/modbus-rtu-server";
export { ServerException } from "./server/handlers";
export type {
    IModbusServerVector,
    IReportServerIDPayload,
    ValueOrPromise,
    ServerCallback,
    VectorGetter,
    VectorMultiGetter,
    VectorSetter,
} from "./server/vector.interface";

// ── Transports ─────────────────────────────────────────────────────
export { AbsModbusTransport } from "./ports/transport.interface";
export type { IModbusTransport, IModbusTransportEvents } from "./ports/transport.interface";
export { TcpPort } from "./ports/tcp-port";
export type { ITcpPortOptions } from "./ports/tcp-port";
export { RtuBufferedPort } from "./ports/rtu-buffered-port";
export type { ISerialPortOptions } from "./ports/rtu-buffered-port";
export { AsciiPort } from "./ports/ascii-port";
export { UdpPort } from "./ports/udp-port";
export { TelnetPort } from "./ports/telnet-port";
export { TcpRTUBufferedPort } from "./ports/tcp-rtu-buffered-port";
export { TestPort } from "./ports/test-port";

// ── Protocol ───────────────────────────────────────────────────────
export * from "./protocol/constants";
export * from "./protocol/types";
export * from "./protocol/errors";
export * from "./protocol/framing";
export * from "./protocol/function-codes";

// ── Utilities ──────────────────────────────────────────────────────
export { crc16 } from "./utils/crc16";
export { lrc } from "./utils/lrc";
export { writeBit, readBit } from "./utils/buffer-bit";

/**
 * List the available serial ports.
 * (Corresponds to node-modbus-serial's `getPorts`.)
 */
export async function get_ports(): Promise<Array<{ path: string; manufacturer?: string }>> {
    const ports = await SerialPort.list();
    return ports.map((port) => ({
        path: port.path,
        manufacturer: port.manufacturer,
    }));
}

/**
 * ModbusTCPClient — a Modbus master over TCP (standard MBAP framing).
 */

import * as net from "net";
import { TcpPort } from "../ports/tcp-port";
import { AbsModbusClient, type IModbusClientBaseOptions } from "./abs-modbus-client";

/** Options for {@link ModbusTCPClient}. */
export interface IModbusTCPClientOptions extends IModbusClientBaseOptions {
    /** Slave host / IP address. */
    host: string;
    /** TCP port (default 502). */
    port?: number;
    /** Use an existing, externally-managed socket instead of connecting. */
    socket?: net.Socket;
    /** Local address to bind the outgoing socket to. */
    local_address?: string;
    /** IP family: 0 = either, 4 = IPv4, 6 = IPv6. */
    family?: 0 | 4 | 6;
}

export class ModbusTCPClient extends AbsModbusClient {
    constructor(options: IModbusTCPClientOptions) {
        const transport = new TcpPort({
            host: options.host,
            port: options.port,
            timeout: options.timeout,
            socket: options.socket,
            localAddress: options.local_address,
            family: options.family,
        });
        super(transport, options);
    }
}

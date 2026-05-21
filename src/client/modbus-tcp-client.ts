/**
 * ModbusTCPClient — a Modbus master over TCP.
 *
 * Defaults to standard MBAP framing; the `transport` option selects a
 * variant (RTU-over-TCP, telnet, or UDP).
 */

import * as net from "net";
import { TcpPort, type ITcpPortOptions } from "../ports/tcp-port";
import { TcpRTUBufferedPort } from "../ports/tcp-rtu-buffered-port";
import { TelnetPort } from "../ports/telnet-port";
import { UdpPort } from "../ports/udp-port";
import { C701Port } from "../ports/c701-port";
import type { IModbusTransport } from "../ports/transport.interface";
import { AbsModbusClient, type IModbusClientBaseOptions } from "./abs-modbus-client";

/** TCP transport variants. */
export type TcpTransportKind = "tcp" | "tcp-rtu-buffered" | "telnet" | "udp" | "c701";

/** Options for {@link ModbusTCPClient}. */
export interface IModbusTCPClientOptions extends IModbusClientBaseOptions {
    /** Slave host / IP address. */
    host: string;
    /** TCP/UDP port (default 502, or 2217 for telnet). */
    port?: number;
    /** Use an existing, externally-managed socket instead of connecting. */
    socket?: net.Socket;
    /** Local address to bind the outgoing socket to. */
    local_address?: string;
    /** IP family: 0 = either, 4 = IPv4, 6 = IPv6. */
    family?: 0 | 4 | 6;
    /** Transport variant (default "tcp"). */
    transport?: TcpTransportKind;
}

export class ModbusTCPClient extends AbsModbusClient {
    constructor(options: IModbusTCPClientOptions) {
        const portOptions: ITcpPortOptions = {
            host: options.host,
            port: options.port,
            timeout: options.timeout,
            socket: options.socket,
            localAddress: options.local_address,
            family: options.family,
        };

        let transport: IModbusTransport;
        switch (options.transport ?? "tcp") {
            case "tcp-rtu-buffered":
                transport = new TcpRTUBufferedPort(portOptions);
                break;
            case "telnet":
                transport = new TelnetPort(portOptions);
                break;
            case "udp":
                transport = new UdpPort(portOptions);
                break;
            case "c701":
                transport = new C701Port(portOptions);
                break;
            case "tcp":
            default:
                transport = new TcpPort(portOptions);
                break;
        }
        super(transport, options);
    }
}

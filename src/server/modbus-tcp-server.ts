/**
 * ModbusTCPServer — a Modbus TCP slave.
 */

import * as net from "net";
import { EventEmitter } from "events";
import { tcpFrameToRtu, rtuFrameToTcp } from "../protocol/framing";
import { MODBUS_TCP_PORT, MBAP_LENGTH, MAX_PDU_LENGTH } from "../protocol/constants";
import type { IEnronTables } from "../protocol/types";
import type { IModbusServerVector } from "./vector.interface";
import { ModbusServerCore } from "./modbus-server-core";

/** Server lifecycle / error events. */
export interface IModbusServerEvents {
    /** The server is listening. */
    initialized: () => void;
    /** A per-connection socket error. */
    socketError: (error: Error) => void;
    /** A server-level (listener) error. */
    serverError: (error: Error) => void;
    /** An error while producing a response. */
    error: (error: Error) => void;
}

/** Options for {@link ModbusTCPServer}. */
export interface IModbusTCPServerOptions {
    /** Listen host (default "127.0.0.1"). */
    host?: string;
    /** Listen port (default 502). */
    port?: number;
    /** Server unit id; 255 (default) accepts any unit. */
    unit_id?: number;
    debug?: boolean;
    /** Enable the Enron 32-bit register variant for FC3/6. */
    enron?: boolean;
    /** Enron address-range table (required when `enron` is true). */
    enron_tables?: IEnronTables;
}

/** Largest plausible MBAP length field. */
const MAX_MBAP_LENGTH_FIELD = MAX_PDU_LENGTH + 1;

export class ModbusTCPServer extends EventEmitter {
    private readonly server: net.Server;
    private readonly core: ModbusServerCore;
    private readonly sockets = new Set<net.Socket>();

    constructor(vector: IModbusServerVector, options: IModbusTCPServerOptions = {}) {
        super();
        this.core = new ModbusServerCore(vector, {
            unitId: options.unit_id ?? 255,
            debug: options.debug,
            enron: options.enron,
            enronTables: options.enron_tables,
        });

        this.server = net.createServer();
        this.server.on("error", (error) => this.emit("serverError", error));
        this.server.on("connection", (socket) => this.onConnection(socket));
        this.server.listen(
            { port: options.port ?? MODBUS_TCP_PORT, host: options.host ?? "127.0.0.1" },
            () => this.emit("initialized"),
        );
    }

    /** Stop listening and drop all open connections. */
    public close(): Promise<void> {
        return new Promise<void>((resolve) => {
            for (const socket of this.sockets) {
                socket.destroy();
            }
            this.sockets.clear();
            this.server.close(() => resolve());
        });
    }

    public override on<E extends keyof IModbusServerEvents>(event: E, listener: IModbusServerEvents[E]): this {
        return super.on(event, listener as (...args: unknown[]) => void);
    }

    public override once<E extends keyof IModbusServerEvents>(event: E, listener: IModbusServerEvents[E]): this {
        return super.once(event, listener as (...args: unknown[]) => void);
    }

    private onConnection(socket: net.Socket): void {
        this.sockets.add(socket);
        let recvBuffer = Buffer.alloc(0);

        socket.on("data", (data: Buffer) => {
            recvBuffer = Buffer.concat([recvBuffer, data]);

            while (recvBuffer.length > MBAP_LENGTH) {
                const transactionId = recvBuffer.readUInt16BE(0);
                const pduLength = recvBuffer.readUInt16BE(4);

                if (pduLength < 1 || pduLength > MAX_MBAP_LENGTH_FIELD) {
                    recvBuffer = Buffer.alloc(0); // malformed MBAP length: resync
                    break;
                }
                if (recvBuffer.length - MBAP_LENGTH < pduLength) {
                    break; // wait for the rest of the frame
                }

                const tcpFrame = recvBuffer.subarray(0, MBAP_LENGTH + pduLength);
                recvBuffer = recvBuffer.subarray(MBAP_LENGTH + pduLength);
                const rtuFrame = tcpFrameToRtu(tcpFrame);

                this.core.handleRequest(rtuFrame, (error, responseFrame) => {
                    if (error) {
                        this.emit("error", error);
                        return;
                    }
                    if (responseFrame && !socket.destroyed) {
                        socket.write(rtuFrameToTcp(transactionId, responseFrame));
                    }
                });
            }
        });

        socket.on("error", (error) => this.emit("socketError", error));
        socket.once("close", () => this.sockets.delete(socket));
    }
}

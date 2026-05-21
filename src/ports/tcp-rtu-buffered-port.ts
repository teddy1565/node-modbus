/**
 * TcpRTUBufferedPort — RTU frames carried over TCP, tolerant of leading junk.
 *
 * Requests are sent MBAP-wrapped (like Modbus TCP); the receive path scans
 * for a valid MBAP header so it can resynchronise after stray bytes — useful
 * with imperfect serial-to-TCP gateways (see note 05 §3).
 */

import * as net from "net";
import { encodeRtuFrame, rtuFrameToTcp } from "../protocol/framing";
import { MODBUS_TCP_PORT, MBAP_LENGTH, MAX_BUFFER_LENGTH } from "../protocol/constants";
import { SerialPortError } from "../protocol/errors";
import { AbsModbusTransport } from "./transport.interface";
import type { ITcpPortOptions } from "./tcp-port";

const EXCEPTION_LENGTH = 3; // (0x80|FC) + code (PDU only, MBAP excluded)

export class TcpRTUBufferedPort extends AbsModbusTransport {
    private readonly client: net.Socket;
    private readonly externalSocket: net.Socket | null;
    private readonly connectOptions: net.TcpSocketConnectOpts;
    private openFlag = false;
    private callback: ((error?: Error) => void) | null = null;
    private buffer: Buffer = Buffer.alloc(0);

    constructor(options: ITcpPortOptions) {
        super();
        this.connectOptions = {
            host: options.host ?? options.ip ?? "127.0.0.1",
            port: options.port ?? MODBUS_TCP_PORT,
        };
        this.externalSocket = options.socket ?? null;
        this.client = this.externalSocket ?? new net.Socket();
        if (this.externalSocket) {
            this.openFlag =
                this.externalSocket.readyState === "opening" || this.externalSocket.readyState === "open";
        }
        if (options.timeout) {
            this.client.setTimeout(options.timeout);
        }
        this.registerEvents();
    }

    public get isOpen(): boolean {
        return this.openFlag;
    }

    public open(callback: (error?: Error) => void): void {
        if (this.externalSocket === null) {
            this.callback = callback;
            this.client.connect(this.connectOptions);
        } else if (this.openFlag) {
            callback();
        } else {
            callback(new Error("TcpRTUBuffered port: external socket is not open"));
        }
    }

    public close(callback: (error?: Error) => void): void {
        this.callback = callback;
        this.client.end();
    }

    public destroy(callback: (error?: Error) => void): void {
        this.callback = callback;
        if (!this.client.destroyed) {
            this.client.destroy();
        } else {
            callback();
        }
    }

    public write(frame: Buffer, transactionId: number): void {
        this.client.write(rtuFrameToTcp(transactionId, frame));
    }

    private fireCallback(error?: Error): void {
        if (this.callback) {
            const cb = this.callback;
            this.callback = null;
            cb(error);
        }
    }

    private registerEvents(): void {
        this.client.on("data", (data: Buffer) => this.onData(data));
        this.client.on("connect", () => {
            this.openFlag = true;
            this.fireCallback();
        });
        this.client.on("close", (hadError: boolean) => {
            if (this.openFlag) {
                this.openFlag = false;
                this.buffer = Buffer.alloc(0);
                this.fireCallback(hadError ? new Error("TcpRTUBuffered port closed with error") : undefined);
                this.emit("close");
            }
        });
        this.client.on("error", (error: Error) => {
            this.openFlag = false;
            this.fireCallback(error);
            this.emit("error", new SerialPortError(error));
        });
        this.client.on("timeout", () => this.fireCallback(new Error("TcpRTUBuffered Connection Timed Out")));
    }

    private onData(data: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, data]);
        if (this.buffer.length > MAX_BUFFER_LENGTH) {
            this.buffer = this.buffer.subarray(-MAX_BUFFER_LENGTH);
        }
        if (this.buffer.length < MBAP_LENGTH + EXCEPTION_LENGTH) {
            return;
        }

        const maxOffset = this.buffer.length - MBAP_LENGTH;
        for (let i = 0; i <= maxOffset; i++) {
            const protocolId = this.buffer.readUInt16BE(i + 2);
            const msgLength = this.buffer.readUInt16BE(i + 4);
            const functionCode = this.buffer[i + 7];

            if (
                protocolId === 0 &&
                functionCode !== 0 &&
                msgLength >= EXCEPTION_LENGTH &&
                i + MBAP_LENGTH + msgLength <= this.buffer.length
            ) {
                const transactionId = this.buffer.readUInt16BE(i);
                // bytes after the MBAP header are: unit id + PDU
                const unitAndPdu = this.buffer.subarray(i + MBAP_LENGTH, i + MBAP_LENGTH + msgLength);
                this.buffer = this.buffer.subarray(i + MBAP_LENGTH + msgLength);
                const rtuFrame = encodeRtuFrame(unitAndPdu[0], unitAndPdu.subarray(1));
                this.emit("data", rtuFrame, transactionId);
                return;
            }
        }
    }
}

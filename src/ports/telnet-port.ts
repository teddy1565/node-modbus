/**
 * TelnetPort — RTU frames carried raw over a TCP (telnet) connection.
 *
 * No MBAP wrapping: the RTU frame (CRC included) is written verbatim, and
 * received bytes are split by matching the expected response length of the
 * outstanding request (see note 05 §5).
 */

import * as net from "net";
import { ModbusFunctionCode, MODBUS_TELNET_PORT } from "../protocol/constants";
import { SerialPortError } from "../protocol/errors";
import { AbsModbusTransport } from "./transport.interface";
import type { ITcpPortOptions } from "./tcp-port";

const EXCEPTION_LENGTH = 5;
const MIN_EXPECTED_LENGTH = 6;

export class TelnetPort extends AbsModbusTransport {
    private readonly client: net.Socket;
    private readonly externalSocket: net.Socket | null;
    private readonly host: string;
    private readonly port: number;
    private openFlag = false;
    private callback: ((error?: Error) => void) | null = null;
    private buffer: Buffer = Buffer.alloc(0);
    private id = 0;
    private cmd = 0;
    private expectedLength = 0;
    private lastTransactionId = 0;

    constructor(options: ITcpPortOptions) {
        super();
        this.host = options.host ?? options.ip ?? "127.0.0.1";
        this.port = options.port ?? MODBUS_TELNET_PORT;
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
            this.client.connect(this.port, this.host);
        } else if (this.openFlag) {
            callback();
        } else {
            callback(new Error("Telnet port: external socket is not open"));
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
        this.id = frame.readUInt8(0);
        this.cmd = frame.readUInt8(1);
        this.lastTransactionId = transactionId;
        this.expectedLength = this.computeExpectedLength(frame);
        this.client.write(frame);
    }

    private computeExpectedLength(frame: Buffer): number {
        switch (this.cmd) {
            case ModbusFunctionCode.READ_COILS:
            case ModbusFunctionCode.READ_DISCRETE_INPUTS:
                return 3 + Math.trunc((frame.readUInt16BE(4) - 1) / 8 + 1) + 2;
            case ModbusFunctionCode.READ_HOLDING_REGISTERS:
            case ModbusFunctionCode.READ_INPUT_REGISTERS:
                return 3 + 2 * frame.readUInt16BE(4) + 2;
            case ModbusFunctionCode.WRITE_SINGLE_COIL:
            case ModbusFunctionCode.WRITE_SINGLE_REGISTER:
            case ModbusFunctionCode.WRITE_MULTIPLE_COILS:
            case ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS:
                return 8;
            default:
                return 0;
        }
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
                this.fireCallback(hadError ? new Error("Telnet port closed with error") : undefined);
                this.emit("close");
            }
        });
        this.client.on("error", (error: Error) => {
            this.openFlag = false;
            this.fireCallback(error);
            this.emit("error", new SerialPortError(error));
        });
        this.client.on("timeout", () => this.fireCallback(new Error("Telnet Connection Timed Out")));
    }

    private emitFrame(start: number, length: number): void {
        const frame = Buffer.from(this.buffer.subarray(start, start + length));
        this.buffer = this.buffer.subarray(start + length);
        this.emit("data", frame, this.lastTransactionId);
    }

    private onData(data: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, data]);
        if (this.expectedLength < MIN_EXPECTED_LENGTH || this.buffer.length < EXCEPTION_LENGTH) {
            return;
        }

        const maxOffset = this.buffer.length - EXCEPTION_LENGTH;
        for (let i = 0; i <= maxOffset; i++) {
            if (this.buffer[i] !== this.id) {
                continue;
            }
            const functionCode = this.buffer[i + 1];
            if (functionCode === this.cmd && i + this.expectedLength <= this.buffer.length) {
                this.emitFrame(i, this.expectedLength);
                return;
            }
            if (functionCode === (0x80 | this.cmd) && i + EXCEPTION_LENGTH <= this.buffer.length) {
                this.emitFrame(i, EXCEPTION_LENGTH);
                return;
            }
            if (functionCode === (0x7f & this.cmd)) {
                break;
            }
        }
    }
}

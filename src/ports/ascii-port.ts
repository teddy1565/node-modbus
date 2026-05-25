/**
 * AsciiPort — Modbus ASCII over a physical serial line.
 *
 * ASCII frames are self-delimiting (`":" ... CRLF`), so received bytes are
 * buffered until a complete frame is present, then decoded back to an RTU
 * frame (see notes 01 §3, 05 §4).
 */

import { SerialPort } from "serialport";
import { encodeAsciiFrame, decodeAsciiFrame } from "../protocol/framing";
import { ASCII_START_CHAR } from "../protocol/constants";
import { SerialPortError } from "../protocol/errors";
import { AbsModbusTransport } from "./transport.interface";
import type { ISerialPortOptions } from "./rtu-buffered-port";

/** ASCII end-of-frame delimiter: line feed. */
const LF = 0x0a;

export class AsciiPort extends AbsModbusTransport {
    private readonly serial: SerialPort;
    private readonly startChar: number;
    private buffer: Buffer = Buffer.alloc(0);
    private lastTransactionId = 0;

    constructor(options: ISerialPortOptions) {
        super();
        this.startChar = options.startOfSlaveFrameChar ?? ASCII_START_CHAR;
        this.serial = new SerialPort({
            path: options.path,
            baudRate: options.baudRate ?? 9600,
            parity: options.parity ?? "none",
            dataBits: options.dataBits ?? 8,
            stopBits: options.stopBits ?? 1,
            autoOpen: false,
        });

        this.serial.on("data", (data: Buffer) => this.onData(data));
        this.serial.on("error", (error: Error) => this.emit("error", new SerialPortError(error)));
        this.serial.on("close", () => this.emit("close"));
    }

    public get isOpen(): boolean {
        return this.serial.isOpen;
    }

    public open(callback: (error?: Error) => void): void {
        this.serial.open((error) => callback(error ?? undefined));
    }

    public close(callback: (error?: Error) => void): void {
        this.serial.close((error) => callback(error ?? undefined));
    }

    public write(frame: Buffer, transactionId: number): void {
        this.lastTransactionId = transactionId;
        this.serial.write(encodeAsciiFrame(frame, this.startChar));
    }

    /** Accumulate bytes and decode any complete `":" ... CRLF` frames. */
    private onData(data: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, data]);

        for (;;) {
            const start = this.buffer.indexOf(this.startChar);
            if (start === -1) {
                this.buffer = Buffer.alloc(0); // no start delimiter: discard noise
                return;
            }
            if (start > 0) {
                this.buffer = this.buffer.subarray(start); // drop noise before the start char
            }

            const lfIndex = this.buffer.indexOf(LF);
            if (lfIndex === -1 || lfIndex < 2 || this.buffer[lfIndex - 1] !== 0x0d) {
                return; // no complete frame yet
            }

            const asciiFrame = this.buffer.subarray(0, lfIndex + 1);
            this.buffer = this.buffer.subarray(lfIndex + 1);

            const rtuFrame = decodeAsciiFrame(asciiFrame);
            if (rtuFrame !== null) {
                this.emit("data", rtuFrame, this.lastTransactionId);
            }
        }
    }
}

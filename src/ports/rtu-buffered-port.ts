/**
 * RtuBufferedPort — Modbus RTU over a physical serial port.
 *
 * RTU frames have no length prefix, so received bytes are buffered and split
 * by matching the expected unit id / function code / response length of the
 * outstanding request (see note 05 §2).
 */

import { SerialPort } from "serialport";
import { ModbusFunctionCode, EXCEPTION_BIT, MAX_BUFFER_LENGTH } from "../protocol/constants";
import { SerialPortError } from "../protocol/errors";
import type { Parity } from "../protocol/types";
import { AbsModbusTransport } from "./transport.interface";

/** Options for serial-line transports. */
export interface ISerialPortOptions {
    /** Serial device path (e.g. "COM3", "/dev/ttyUSB0"). */
    path: string;
    /** Baud rate (default 9600). */
    baudRate?: number;
    parity?: Parity;
    dataBits?: 5 | 6 | 7 | 8;
    stopBits?: 1 | 1.5 | 2;
    /** ASCII start-of-slave-frame character (AsciiPort only). */
    startOfSlaveFrameChar?: number;
}

const EXCEPTION_LENGTH = 5;
const MIN_DATA_LENGTH = 6;
const MIN_WRITE_DATA_LENGTH = 4;
const CRC_LENGTH = 2;

/** Sentinel for a response whose length cannot be predicted from the request. */
const LENGTH_UNKNOWN = "unknown";
type ExpectedLength = number | typeof LENGTH_UNKNOWN;

export class RtuBufferedPort extends AbsModbusTransport {
    private readonly serial: SerialPort;
    private buffer: Buffer = Buffer.alloc(0);
    private id = 0;
    private cmd = 0;
    private expectedLength: ExpectedLength = 0;
    private lastTransactionId = 0;

    constructor(options: ISerialPortOptions) {
        super();
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
        if (frame.length < MIN_WRITE_DATA_LENGTH) {
            return;
        }

        this.id = frame.readUInt8(0);
        this.cmd = frame.readUInt8(1);
        this.lastTransactionId = transactionId;
        this.expectedLength = this.computeExpectedLength(frame);

        this.serial.write(frame);
    }

    /** Predict the response frame length from the request frame. */
    private computeExpectedLength(frame: Buffer): ExpectedLength {
        switch (this.cmd) {
            case ModbusFunctionCode.READ_COILS:
            case ModbusFunctionCode.READ_DISCRETE_INPUTS: {
                const quantity = frame.readUInt16BE(4);
                return 3 + Math.trunc((quantity - 1) / 8 + 1) + 2;
            }
            case ModbusFunctionCode.READ_HOLDING_REGISTERS:
            case ModbusFunctionCode.READ_INPUT_REGISTERS: {
                const quantity = frame.readUInt16BE(4);
                return 3 + 2 * quantity + 2;
            }
            case ModbusFunctionCode.WRITE_SINGLE_COIL:
            case ModbusFunctionCode.WRITE_SINGLE_REGISTER:
            case ModbusFunctionCode.WRITE_MULTIPLE_COILS:
            case ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS:
                return 8;
            case ModbusFunctionCode.REPORT_SERVER_ID:
            case ModbusFunctionCode.READ_DEVICE_IDENTIFICATION:
                return LENGTH_UNKNOWN;
            default:
                return 0;
        }
    }

    /** Emit a complete frame and cut it from the receive buffer. */
    private emitFrame(start: number, length: number): void {
        const frame = this.buffer.subarray(start, start + length);
        this.buffer = this.buffer.subarray(start + length);
        this.emit("data", Buffer.from(frame), this.lastTransactionId);
    }

    /** Accumulate serial bytes and try to split out a complete RTU frame. */
    private onData(data: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, data]);

        const expected = this.expectedLength;
        if ((expected !== LENGTH_UNKNOWN && expected < MIN_DATA_LENGTH) || this.buffer.length < EXCEPTION_LENGTH) {
            return;
        }

        if (this.buffer.length > MAX_BUFFER_LENGTH) {
            this.buffer = this.buffer.subarray(-MAX_BUFFER_LENGTH);
        }

        const bufferLength = this.buffer.length;
        const maxOffset = bufferLength - EXCEPTION_LENGTH;

        for (let i = 0; i <= maxOffset; i++) {
            const unitId = this.buffer[i];
            const functionCode = this.buffer[i + 1];
            if (unitId !== this.id) {
                continue;
            }

            if (functionCode === this.cmd && functionCode === ModbusFunctionCode.READ_DEVICE_IDENTIFICATION) {
                if (bufferLength <= 7 + i) {
                    return;
                }
                const numObjects = this.buffer[7 + i];
                const fc43 = this.calculateFc43Length(numObjects, i, bufferLength);
                if (fc43 !== null) {
                    this.emitFrame(i, fc43);
                    return;
                }
            } else if (functionCode === this.cmd && functionCode === ModbusFunctionCode.REPORT_SERVER_ID) {
                if (i + 2 >= bufferLength) {
                    return; // content-length byte not received yet
                }
                // address + FC + byteCount + content + CRC
                const frameLength = this.buffer[i + 2] + 5;
                if (i + frameLength <= bufferLength) {
                    this.emitFrame(i, frameLength);
                    return;
                }
                return; // full frame not received yet
            } else if (typeof expected === "number") {
                if (functionCode === this.cmd && i + expected <= bufferLength) {
                    this.emitFrame(i, expected);
                    return;
                }
                if (functionCode === (EXCEPTION_BIT | this.cmd) && i + EXCEPTION_LENGTH <= bufferLength) {
                    this.emitFrame(i, EXCEPTION_LENGTH);
                    return;
                }
            }

            if (functionCode === (0x7f & this.cmd)) {
                break; // frame header matched but bytes are still pending
            }
        }
    }

    /**
     * Compute the total frame length of an FC43 response, or null if the
     * full frame (including CRC) has not arrived yet.
     */
    private calculateFc43Length(numObjects: number, i: number, bufferLength: number): number | null {
        let currentByte = 8 + i;
        for (let j = 0; j < numObjects; j++) {
            // Need the object id and its length byte to be present.
            if (currentByte + 1 >= bufferLength) {
                return null;
            }
            const objLength = this.buffer[currentByte + 1];
            if (!objLength) {
                return null;
            }
            currentByte += 2 + objLength;
        }
        if (currentByte + CRC_LENGTH > bufferLength) {
            return null;
        }
        return currentByte + CRC_LENGTH;
    }
}

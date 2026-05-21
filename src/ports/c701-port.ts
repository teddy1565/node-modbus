/**
 * C701Port — RTU frames carried over a C701 UDP-to-serial bridge.
 *
 * The C701 wraps each RTU frame in a 116-byte proprietary UDP header.
 * Outgoing datagrams use magic `600`; replies use magic `602`, with the RTU
 * frame at the tail of the datagram (see note 05 §7).
 */

import * as dgram from "dgram";
import { crc16 } from "../utils/crc16";
import { ModbusFunctionCode, C701_PORT, EXCEPTION_FRAME_LENGTH } from "../protocol/constants";
import { AbsModbusTransport } from "./transport.interface";
import type { ITcpPortOptions } from "./tcp-port";

/** Size of the proprietary C701 header that precedes the RTU frame. */
const C701_HEADER_LENGTH = 116;
/** Magic written into outgoing datagrams. */
const C701_SEND_MAGIC = 600;
/** Magic expected in reply datagrams. */
const C701_REPLY_MAGIC = 602;

export class C701Port extends AbsModbusTransport {
    private readonly socket: dgram.Socket;
    private readonly host: string;
    private readonly port: number;
    private openFlag = false;
    private id = 0;
    private cmd = 0;
    private expectedLength = 0;
    private lastTransactionId = 0;

    constructor(options: ITcpPortOptions) {
        super();
        this.host = options.host ?? options.ip ?? "127.0.0.1";
        this.port = options.port ?? C701_PORT;
        this.socket = dgram.createSocket("udp4");

        this.socket.on("message", (data, rinfo) => {
            if (rinfo.address === this.host) {
                this.onMessage(data);
            }
        });
        this.socket.on("listening", () => {
            this.openFlag = true;
        });
        this.socket.on("close", () => {
            this.openFlag = false;
        });
        this.socket.on("error", (error) => this.emit("error", error));
    }

    public get isOpen(): boolean {
        return this.openFlag;
    }

    public open(callback: (error?: Error) => void): void {
        this.socket.bind(() => {
            this.openFlag = true;
            callback();
        });
    }

    public close(callback: (error?: Error) => void): void {
        this.socket.close(() => callback());
    }

    public write(frame: Buffer, transactionId: number): void {
        this.id = frame.readUInt8(0);
        this.cmd = frame.readUInt8(1);
        this.lastTransactionId = transactionId;
        this.expectedLength = this.computeExpectedLength(frame);

        const datagram = Buffer.alloc(C701_HEADER_LENGTH + frame.length);
        datagram.writeUInt16LE(C701_SEND_MAGIC, 2);
        datagram.writeUInt16LE(0, 36); // RS485 connector number
        datagram.writeUInt16LE(this.expectedLength, 38); // expected serial reply length
        datagram.writeUInt16LE(1, 102); // RS485 hub number
        datagram.writeUInt16LE(frame.length, 104); // serial data length
        frame.copy(datagram, C701_HEADER_LENGTH);

        this.socket.send(datagram, 0, datagram.length, this.port, this.host);
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

    /** Whether `candidate` looks like the awaited RTU response. */
    private isExpectedResponse(candidate: Buffer): boolean {
        if (candidate.length < EXCEPTION_FRAME_LENGTH) {
            return false;
        }
        if (candidate[0] !== this.id || (0x7f & candidate[1]) !== this.cmd) {
            return false;
        }
        const crcIn = candidate.readUInt16LE(candidate.length - 2);
        return crcIn === crc16(candidate.subarray(0, candidate.length - 2));
    }

    private onMessage(data: Buffer): void {
        if (data.length < C701_HEADER_LENGTH + EXCEPTION_FRAME_LENGTH) {
            return;
        }
        if (data.readUInt16LE(2) !== C701_REPLY_MAGIC) {
            return;
        }

        // The RTU frame sits at the tail of the datagram.
        if (this.expectedLength > 0 && data.length >= this.expectedLength) {
            const candidate = data.subarray(data.length - this.expectedLength);
            if (this.isExpectedResponse(candidate)) {
                this.emit("data", Buffer.from(candidate), this.lastTransactionId);
                return;
            }
        }
        // Otherwise try a 5-byte exception frame.
        const exception = data.subarray(data.length - EXCEPTION_FRAME_LENGTH);
        if (this.isExpectedResponse(exception)) {
            this.emit("data", Buffer.from(exception), this.lastTransactionId);
        }
    }
}

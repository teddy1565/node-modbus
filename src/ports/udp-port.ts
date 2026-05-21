/**
 * UdpPort — Modbus over UDP.
 *
 * Uses the same MBAP framing as Modbus TCP, carried in UDP datagrams
 * (see note 05 §6).
 */

import * as dgram from "dgram";
import { rtuFrameToTcp, tcpFrameToRtu } from "../protocol/framing";
import { MODBUS_TCP_PORT, MBAP_LENGTH, MAX_PDU_LENGTH } from "../protocol/constants";
import { AbsModbusTransport } from "./transport.interface";
import type { ITcpPortOptions } from "./tcp-port";

const MAX_MBAP_LENGTH_FIELD = MAX_PDU_LENGTH + 1;

export class UdpPort extends AbsModbusTransport {
    private readonly socket: dgram.Socket;
    private readonly host: string;
    private readonly port: number;
    private openFlag = false;

    constructor(options: ITcpPortOptions) {
        super();
        this.host = options.host ?? options.ip ?? "127.0.0.1";
        this.port = options.port ?? MODBUS_TCP_PORT;
        this.socket = dgram.createSocket("udp4");

        this.socket.on("message", (data, rinfo) => {
            if (rinfo.address !== this.host || rinfo.port !== this.port) {
                return; // datagram not from our peer
            }
            this.onMessage(data);
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
        let settled = false;
        const onBindError = (error: Error): void => {
            if (!settled) {
                settled = true;
                callback(error);
            }
        };
        this.socket.once("error", onBindError);
        this.socket.bind(() => {
            this.socket.removeListener("error", onBindError);
            if (!settled) {
                settled = true;
                this.openFlag = true;
                callback();
            }
        });
    }

    public close(callback: (error?: Error) => void): void {
        this.socket.close(() => callback());
    }

    public write(frame: Buffer, transactionId: number): void {
        const tcpFrame = rtuFrameToTcp(transactionId, frame);
        this.socket.send(tcpFrame, 0, tcpFrame.length, this.port, this.host);
    }

    private onMessage(data: Buffer): void {
        let offset = 0;
        while (data.length - offset > MBAP_LENGTH) {
            const length = data.readUInt16BE(offset + 4);
            if (length < 1 || length > MAX_MBAP_LENGTH_FIELD || data.length - offset < length + MBAP_LENGTH) {
                return;
            }
            const tcpFrame = data.subarray(offset, offset + MBAP_LENGTH + length);
            const transactionId = tcpFrame.readUInt16BE(0);
            this.emit("data", tcpFrameToRtu(tcpFrame), transactionId);
            offset += MBAP_LENGTH + length;
        }
    }
}

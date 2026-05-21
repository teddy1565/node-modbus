/**
 * TcpPort — standard Modbus TCP transport.
 *
 * Converts between internal RTU frames and Modbus TCP frames (MBAP header,
 * no CRC). See notes 05 §1 and 19 (robustness).
 */

import * as net from "net";
import { rtuFrameToTcp, tcpFrameToRtu } from "../protocol/framing";
import { MODBUS_TCP_PORT, MBAP_LENGTH, MAX_PDU_LENGTH } from "../protocol/constants";
import { SerialPortError } from "../protocol/errors";
import { AbsModbusTransport } from "./transport.interface";

/** Options for TCP-family transports. */
export interface ITcpPortOptions {
    /** Slave host/IP. */
    host?: string;
    /** Alias for `host`. */
    ip?: string;
    /** TCP port (default 502). */
    port?: number;
    /** Socket inactivity timeout in ms. */
    timeout?: number;
    /** Use an existing, externally-managed socket (link mode). */
    socket?: net.Socket;
    /** Constructor options for a freshly created socket. */
    socketOpts?: net.SocketConstructorOpts;
    /** Local address to bind to. */
    localAddress?: string;
    /** IP family: 0 = either, 4 = IPv4, 6 = IPv6. */
    family?: 0 | 4 | 6;
}

/** The largest plausible MBAP `length` field (unit id + max PDU). */
const MAX_MBAP_LENGTH_FIELD = MAX_PDU_LENGTH + 1;

export class TcpPort extends AbsModbusTransport {
    private readonly client: net.Socket;
    private readonly externalSocket: net.Socket | null;
    private readonly connectOptions: net.TcpSocketConnectOpts;
    private openFlag = false;
    private callback: ((error?: Error) => void) | null = null;
    private rcvBuffer: Buffer = Buffer.alloc(0);

    constructor(options: ITcpPortOptions) {
        super();

        this.connectOptions = {
            host: options.host ?? options.ip ?? "127.0.0.1",
            port: options.port ?? MODBUS_TCP_PORT,
        };
        if (options.localAddress !== undefined) {
            this.connectOptions.localAddress = options.localAddress;
        }
        if (options.family !== undefined) {
            this.connectOptions.family = options.family;
        }

        if (options.socket) {
            this.externalSocket = options.socket;
            this.openFlag =
                this.externalSocket.readyState === "opening" || this.externalSocket.readyState === "open";
        } else {
            this.externalSocket = null;
        }

        this.client = this.externalSocket ?? new net.Socket(options.socketOpts);
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
            callback(new Error("TCP port: external socket is not open"));
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
        const tcpFrame = rtuFrameToTcp(transactionId, frame);
        // Node guarantees ordered delivery of sequential writes to a socket,
        // so an explicit write-completion chain is unnecessary (note 19 G1-G4).
        this.client.write(tcpFrame);
    }

    /** Invoke the pending callback exactly once. */
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
            this.client.setNoDelay();
            this.fireCallback();
        });

        this.client.on("close", (hadError: boolean) => {
            if (this.openFlag) {
                this.openFlag = false;
                this.rcvBuffer = Buffer.alloc(0);
                this.fireCallback(hadError ? new Error("TCP port closed with error") : undefined);
                this.emit("close");
            }
        });

        this.client.on("error", (error: Error) => {
            this.openFlag = false;
            this.fireCallback(error);
            this.emit("error", new SerialPortError(error));
        });

        this.client.on("timeout", () => {
            this.fireCallback(new Error("TCP Connection Timed Out"));
        });
    }

    /** Accumulate received bytes and split out complete TCP frames. */
    private onData(data: Buffer): void {
        this.rcvBuffer = Buffer.concat([this.rcvBuffer, data]);

        while (this.rcvBuffer.length > MBAP_LENGTH) {
            const length = this.rcvBuffer.readUInt16BE(4);

            // Guard against a malformed / hostile MBAP length field.
            if (length < 1 || length > MAX_MBAP_LENGTH_FIELD) {
                this.rcvBuffer = Buffer.alloc(0);
                this.emit("error", new Error(`Invalid MBAP length field: ${length}`));
                return;
            }

            if (this.rcvBuffer.length < length + MBAP_LENGTH) {
                return; // wait for the rest of the frame
            }

            const tcpFrame = this.rcvBuffer.subarray(0, MBAP_LENGTH + length);
            const transactionId = tcpFrame.readUInt16BE(0);
            const rtuFrame = tcpFrameToRtu(tcpFrame);
            this.rcvBuffer = this.rcvBuffer.subarray(MBAP_LENGTH + length);

            this.emit("data", rtuFrame, transactionId);
        }
    }
}

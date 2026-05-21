/**
 * ModbusClientCore — the transaction engine shared by ModbusTCPClient and
 * ModbusRTUClient.
 *
 * Corresponds to node-modbus-serial's `ModbusRTU` internals (transaction
 * table, timeout handling, `_onReceive` validation pipeline — note 04 §6),
 * with the reliability fixes from note 19:
 *  - requests are strictly serialised (one in-flight at a time);
 *  - every transaction has exactly one settle point;
 *  - transport close/error rejects all pending transactions (no permanently
 *    pending promises);
 *  - settled transactions are never retained.
 */

import { EventEmitter } from "events";
import { encodeRtuFrame, parseRtuFrame } from "../protocol/framing";
import { EXCEPTION_BIT, EXCEPTION_FRAME_LENGTH } from "../protocol/constants";
import {
    ModbusError,
    PortNotOpenError,
    CrcError,
    UnexpectedDataError,
    ModbusExceptionError,
    TransactionTimedOutError,
} from "../protocol/errors";
import type { IModbusTransport } from "../ports/transport.interface";

/** Parses a response PDU into the caller's result type. */
export type ResponseParser<T> = (responsePdu: Buffer) => T;

/** Describes one request to be sent by the core. */
export interface IRequestSpec<T> {
    /** Target unit id. */
    unitId: number;
    /** Function code (used to validate the response code). */
    functionCode: number;
    /** Request PDU (function code + data). */
    pdu: Buffer;
    /** Expected total RTU frame length; omit when unpredictable. */
    expectedLength?: number;
    /** True when the response length cannot be predicted (FC17/20/43/custom). */
    lengthUnknown?: boolean;
    /** Response PDU parser. */
    parse: ResponseParser<T>;
}

/** Options for constructing the core. */
export interface IModbusClientCoreOptions {
    transport: IModbusTransport;
    /** Response timeout in ms; 0 / undefined disables the timer. */
    timeout?: number;
    unitId?: number;
    debugEnabled?: boolean;
}

interface ITransaction {
    id: number;
    spec: IRequestSpec<unknown>;
    frame: Buffer;
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timeoutHandle?: NodeJS.Timeout;
    timeoutFired?: boolean;
    request?: Uint8Array;
    responses?: Uint8Array[];
}

export class ModbusClientCore extends EventEmitter {
    private readonly transport: IModbusTransport;
    private timeout: number;
    private unitId: number;
    private debugEnabled: boolean;

    /** The single in-flight transaction (requests are serialised). */
    private current: ITransaction | null = null;
    /** Requests waiting for the in-flight transaction to settle. */
    private readonly queue: ITransaction[] = [];
    /** Next transaction id (1..65535, wrapping). */
    private nextTransactionId = 1;

    private readonly boundOnData = (frame: Buffer, transactionId: number): void =>
        this.onData(frame, transactionId);
    private readonly boundOnError = (error: Error): void => this.onError(error);
    private readonly boundOnClose = (): void => this.onClose();

    constructor(options: IModbusClientCoreOptions) {
        super();
        this.transport = options.transport;
        this.timeout = options.timeout ?? 0;
        this.unitId = options.unitId ?? 1;
        this.debugEnabled = options.debugEnabled ?? false;
    }

    public get isOpen(): boolean {
        return this.transport.isOpen;
    }

    public getId(): number {
        return this.unitId;
    }

    public setId(id: number): void {
        this.unitId = id;
    }

    public getTimeout(): number {
        return this.timeout;
    }

    public setTimeout(ms: number): void {
        this.timeout = ms;
    }

    public setDebugEnabled(enable: boolean): void {
        this.debugEnabled = enable;
    }

    public get isDebugEnabled(): boolean {
        return this.debugEnabled;
    }

    /** Open the transport and register frame listeners. */
    public open(callback: (error?: Error) => void): void {
        this.transport.open((error) => {
            if (error) {
                callback(error);
                return;
            }
            this.transport.removeListener("data", this.boundOnData);
            this.transport.removeListener("error", this.boundOnError);
            this.transport.removeListener("close", this.boundOnClose);
            this.transport.on("data", this.boundOnData);
            this.transport.on("error", this.boundOnError);
            this.transport.once("close", this.boundOnClose);
            callback();
        });
    }

    /** Close the transport, rejecting any pending transactions. */
    public close(callback: (error?: Error) => void): void {
        this.rejectAll(new PortNotOpenError());
        this.transport.removeListener("data", this.boundOnData);
        this.transport.removeListener("error", this.boundOnError);
        this.transport.removeListener("close", this.boundOnClose);
        this.transport.close(callback);
    }

    /** Forcibly destroy the transport, rejecting any pending transactions. */
    public destroy(callback: (error?: Error) => void): void {
        this.rejectAll(new PortNotOpenError());
        this.transport.removeListener("data", this.boundOnData);
        this.transport.removeListener("error", this.boundOnError);
        this.transport.removeListener("close", this.boundOnClose);
        if (this.transport.destroy) {
            this.transport.destroy(callback);
        } else {
            this.transport.close(callback);
        }
    }

    /**
     * Send a request and resolve with the parsed response.
     * Requests are queued and dispatched one at a time.
     */
    public request<T>(spec: IRequestSpec<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (!this.transport.isOpen) {
                reject(new PortNotOpenError());
                return;
            }
            const transaction: ITransaction = {
                id: this.takeTransactionId(),
                spec: spec as IRequestSpec<unknown>,
                frame: encodeRtuFrame(spec.unitId, spec.pdu),
                resolve: resolve as (value: unknown) => void,
                reject,
            };
            this.queue.push(transaction);
            this.pump();
        });
    }

    /** Generate the next transaction id (1..65535, wrapping). */
    private takeTransactionId(): number {
        const id = this.nextTransactionId;
        this.nextTransactionId = (this.nextTransactionId % 0xffff) + 1;
        return id;
    }

    /** Dispatch the next queued request if nothing is in flight. */
    private pump(): void {
        if (this.current !== null || this.queue.length === 0) {
            return;
        }
        const transaction = this.queue.shift() as ITransaction;
        this.current = transaction;

        if (this.debugEnabled) {
            transaction.request = Uint8Array.prototype.slice.call(transaction.frame);
            transaction.responses = [];
        }

        if (this.timeout > 0) {
            transaction.timeoutHandle = setTimeout(() => {
                transaction.timeoutFired = true;
                const error = new TransactionTimedOutError();
                if (this.debugEnabled) {
                    error.modbusRequest = transaction.request;
                    error.modbusResponses = transaction.responses;
                }
                this.settle(error);
            }, this.timeout);
        }

        this.transport.write(transaction.frame, transaction.id);
    }

    /** Settle the in-flight transaction and dispatch the next one. */
    private settle(error: Error | null, result?: unknown): void {
        const transaction = this.current;
        if (transaction === null) {
            return;
        }
        this.current = null;
        if (transaction.timeoutHandle) {
            clearTimeout(transaction.timeoutHandle);
        }

        if (error) {
            transaction.reject(error);
        } else {
            transaction.resolve(result);
        }
        this.pump();
    }

    /** Reject the in-flight transaction and everything queued. */
    private rejectAll(error: Error): void {
        const pending = this.current ? [this.current, ...this.queue] : [...this.queue];
        this.current = null;
        this.queue.length = 0;
        for (const transaction of pending) {
            if (transaction.timeoutHandle) {
                clearTimeout(transaction.timeoutHandle);
            }
            transaction.reject(error);
        }
    }

    private onError(error: Error): void {
        // Reject any in-flight transaction so callers are not left hanging
        // when a transport error is not followed by a close event.
        this.rejectAll(error);
        this.emit("error", error);
    }

    private onClose(): void {
        this.rejectAll(new PortNotOpenError());
        this.emit("close");
    }

    /**
     * Validate a received frame against the in-flight transaction and settle
     * it. Mirrors `_onReceive` (note 04 §6); the step order is significant.
     */
    private onData(frame: Buffer, transactionId: number): void {
        const transaction = this.current;
        if (transaction === null || transactionId !== transaction.id) {
            return; // unsolicited / stale frame
        }
        if (this.debugEnabled && transaction.responses) {
            transaction.responses.push(Uint8Array.prototype.slice.call(frame));
        }
        if (transaction.timeoutHandle) {
            clearTimeout(transaction.timeoutHandle);
            transaction.timeoutHandle = undefined;
        }
        if (transaction.timeoutFired === true) {
            return;
        }

        const { spec } = transaction;

        // Step 6a — absolute minimum length. A frame shorter than
        // address(1) + function code(1) + CRC(2) cannot be parsed at all;
        // this check is unconditional so `parseRtuFrame` never reads a
        // CRC at a negative offset (would throw outside the try block).
        if (frame.length < 4) {
            this.settle(new UnexpectedDataError(`Data length error, got ${frame.length}`));
            return;
        }

        // Step 6b — minimum length for fixed-length responses.
        if (!spec.lengthUnknown && frame.length < EXCEPTION_FRAME_LENGTH) {
            this.settle(
                new UnexpectedDataError(
                    `Data length error, expected ${spec.expectedLength} got ${frame.length}`,
                ),
            );
            return;
        }

        // Step 7 — CRC.
        const parsed = parseRtuFrame(frame);
        if (!parsed.crcValid) {
            this.settle(new CrcError());
            return;
        }

        const address = frame.readUInt8(0);
        const code = frame.readUInt8(1);

        // Step 9 — exception response.
        if (frame.length >= EXCEPTION_FRAME_LENGTH && code === (EXCEPTION_BIT | spec.functionCode)) {
            const error = new ModbusExceptionError(frame.readUInt8(2));
            if (this.debugEnabled) {
                error.modbusRequest = transaction.request;
                error.modbusResponses = transaction.responses;
            }
            this.settle(error);
            return;
        }

        // Step 11 — exact length.
        if (!spec.lengthUnknown && spec.expectedLength !== undefined && frame.length !== spec.expectedLength) {
            this.settle(
                new UnexpectedDataError(
                    `Data length error, expected ${spec.expectedLength} got ${frame.length}`,
                ),
            );
            return;
        }

        // Step 12 — address.
        if (address !== spec.unitId) {
            this.settle(
                new UnexpectedDataError(`Unexpected data error, expected address ${spec.unitId} got ${address}`),
            );
            return;
        }

        // Step 13 — function code.
        if (code !== spec.functionCode) {
            this.settle(
                new UnexpectedDataError(`Unexpected data error, expected code ${spec.functionCode} got ${code}`),
            );
            return;
        }

        // Step 14 — parse.
        try {
            this.settle(null, spec.parse(parsed.pdu));
        } catch (e) {
            this.settle(e instanceof Error ? e : new UnexpectedDataError(String(e)));
        }
    }
}

export { ModbusError };

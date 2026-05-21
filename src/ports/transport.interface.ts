/**
 * Transport (port) abstraction.
 *
 * The client/server cores always speak **RTU frames**; a transport converts
 * those to/from its physical wire format. This interface only mandates
 * `open`/`close`/`write`/`isOpen` plus the `data`/`error`/`close` events,
 * replacing node-modbus-serial's loose `_id`/`_cmd`/`_transactionId*` field
 * conventions (see notes 05, 12, 18).
 */

import { EventEmitter } from "events";

/** Transport events. `data` carries one complete RTU frame plus its id. */
export interface IModbusTransportEvents {
    /**
     * A complete RTU frame was received.
     * @param frame `address + PDU + CRC16-LE`.
     * @param transactionId the id correlating this frame to a request
     *   (the MBAP id for TCP; the echoed request id for RTU/serial).
     */
    data: (frame: Buffer, transactionId: number) => void;
    error: (error: Error) => void;
    close: () => void;
}

/** Unified transport interface. */
export interface IModbusTransport {
    /** Whether the port is currently open. */
    readonly isOpen: boolean;

    /** Open the port. */
    open(callback: (error?: Error) => void): void;

    /** Close the port gracefully. */
    close(callback: (error?: Error) => void): void;

    /**
     * Write one RTU frame. The caller supplies the `transactionId` so that
     * the response can be correlated; the transport embeds it (TCP MBAP) or
     * echoes it back on the `data` event (RTU/serial).
     */
    write(frame: Buffer, transactionId: number): void;

    /** Forcibly destroy the port. Only some transports support this. */
    destroy?(callback: (error?: Error) => void): void;

    on<E extends keyof IModbusTransportEvents>(event: E, listener: IModbusTransportEvents[E]): this;
    once<E extends keyof IModbusTransportEvents>(event: E, listener: IModbusTransportEvents[E]): this;
    removeListener<E extends keyof IModbusTransportEvents>(event: E, listener: IModbusTransportEvents[E]): this;
    emit<E extends keyof IModbusTransportEvents>(event: E, ...args: Parameters<IModbusTransportEvents[E]>): boolean;
}

/**
 * Base class for transports: a typed `EventEmitter` implementing the
 * `IModbusTransport` event signatures.
 */
export abstract class AbsModbusTransport extends EventEmitter implements IModbusTransport {
    public abstract get isOpen(): boolean;
    public abstract open(callback: (error?: Error) => void): void;
    public abstract close(callback: (error?: Error) => void): void;
    public abstract write(frame: Buffer, transactionId: number): void;

    public override on<E extends keyof IModbusTransportEvents>(event: E, listener: IModbusTransportEvents[E]): this {
        return super.on(event, listener as (...args: unknown[]) => void);
    }

    public override once<E extends keyof IModbusTransportEvents>(event: E, listener: IModbusTransportEvents[E]): this {
        return super.once(event, listener as (...args: unknown[]) => void);
    }

    public override removeListener<E extends keyof IModbusTransportEvents>(
        event: E,
        listener: IModbusTransportEvents[E],
    ): this {
        return super.removeListener(event, listener as (...args: unknown[]) => void);
    }

    public override emit<E extends keyof IModbusTransportEvents>(
        event: E,
        ...args: Parameters<IModbusTransportEvents[E]>
    ): boolean {
        return super.emit(event, ...args);
    }
}

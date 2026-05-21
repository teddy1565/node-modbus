/**
 * Modbus error class hierarchy.
 *
 * node-modbus-serial uses hand-rolled error objects with no real class
 * hierarchy; this re-implementation provides proper `Error` subclasses so
 * `instanceof` works and event types can be narrowed (see notes 11, 18).
 */

import { ModbusExceptionCode, modbusErrorMessages } from "./constants";

/** Base class for all Modbus errors. */
export abstract class ModbusError extends Error {
    /** errno field carried over from node-modbus-serial. */
    public readonly errno?: string;

    constructor(message: string) {
        super(message);
        // Restore prototype chain (required when targeting ES2022/CommonJS).
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

/** The transport port is not open. */
export class PortNotOpenError extends ModbusError {
    public override readonly name = "PortNotOpenError";
    public override readonly errno = "ECONNREFUSED";

    constructor() {
        super("Port Not Open");
    }
}

/** A required address / dataAddress argument was undefined. */
export class BadAddressError extends ModbusError {
    public override readonly name = "BadAddressError";
    public override readonly errno = "ECONNREFUSED";

    constructor() {
        super("Bad Client Address");
    }
}

/** A transaction did not receive a response within the timeout window. */
export class TransactionTimedOutError extends ModbusError {
    public override readonly name = "TransactionTimedOutError";
    public override readonly errno = "ETIMEDOUT";

    /** Raw request bytes (debug mode only). */
    public modbusRequest?: Uint8Array;
    /** Raw response chunks (debug mode only). */
    public modbusResponses?: Uint8Array[];

    constructor() {
        super("Timed out");
    }
}

/** Wraps a low-level transport (socket / serial) error. */
export class SerialPortError extends ModbusError {
    public override readonly name = "SerialPortError";
    public override readonly errno = "ECONNREFUSED";

    constructor(original: Error) {
        super(original.message);
        if (original.stack) {
            this.stack = original.stack;
        }
    }
}

/** The device returned a Modbus exception response (function code 0x80 | FC). */
export class ModbusExceptionError extends ModbusError {
    public override readonly name = "ModbusExceptionError";
    /** The exception code reported by the device. */
    public readonly modbusCode: ModbusExceptionCode | number;
    /** Raw request bytes (debug mode only). */
    public modbusRequest?: Uint8Array;
    /** Raw response chunks (debug mode only). */
    public modbusResponses?: Uint8Array[];

    constructor(code: number) {
        super(`Modbus exception ${code}: ${modbusErrorMessages[code] || "Unknown error"}`);
        this.modbusCode = code;
    }
}

/** CRC16 verification of a received frame failed. */
export class CrcError extends ModbusError {
    public override readonly name = "CrcError";

    constructor() {
        super("CRC error");
    }
}

/**
 * A received frame did not match the expected length / address / function
 * code (corresponds to `_onReceive` steps 6, 11, 12, 13).
 */
export class UnexpectedDataError extends ModbusError {
    public override readonly name = "UnexpectedDataError";

    constructor(message: string) {
        super(message);
    }
}

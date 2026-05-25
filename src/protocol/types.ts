/**
 * Shared protocol type definitions.
 *
 * Result types are corrected against node-modbus-serial's faulty `.d.ts`
 * (see notes 11, 18): FC23 result has no `buffer`, FC43 result is an
 * object keyed by objectId.
 */

import { BadAddressError } from "./errors";

// ── Branded id types ───────────────────────────────────────────────

/** Modbus slave/unit address (1..255); 255 means "all addresses" on a server. */
export type UnitID = number & { readonly __brand: "UnitID" };

/** MBAP transaction id (1..65535). */
export type TransactionID = number & { readonly __brand: "TransactionID" };

/**
 * Validate and brand a unit id.
 * @throws BadAddressError when out of the 0..255 range.
 */
export function toUnitID(value: number): UnitID {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
        throw new BadAddressError();
    }
    return value as UnitID;
}

/**
 * Validate and brand a transaction id.
 * @throws BadAddressError when out of the 0..65535 range.
 */
export function toTransactionID(value: number): TransactionID {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 0xffff) {
        throw new BadAddressError();
    }
    return value as TransactionID;
}

// ── Function-code result types ─────────────────────────────────────

/** FC1/2/3/4 read result. */
export interface IModbusReadRequest_Result<T> {
    /** FC1/2: boolean[]; FC3/4: number[]. */
    data: T;
    /** Raw register/coil bytes from the response. */
    buffer: Buffer;
}

/** FC5 Write Single Coil result. */
export interface IWriteCoilResult {
    address: number;
    state: boolean;
}

/** FC6 Write Single Register result. */
export interface IWriteRegisterResult {
    address: number;
    value: number;
}

/** FC15/16 Write Multiple result. */
export interface IWriteMultipleResult {
    address: number;
    length: number;
}

/** FC17 Report Server ID result. */
export interface IReportServerIDResult {
    serverId: number;
    running: boolean;
    additionalData: Buffer;
}

/** FC20 Read File Records result. */
export interface IReadFileRecordsResult {
    data: number[];
    length: number;
}

/** FC22 Mask Write Register result. */
export interface IMaskWriteRegisterResult {
    address: number;
    andMask: number;
    orMask: number;
}

/** FC23 Read/Write Multiple Registers result — note: no `buffer` field. */
export interface IReadWriteRegistersResult {
    data: number[];
}

/** FC43 Read Device Identification result — object keyed by objectId. */
export interface IReadDeviceIdentificationResult {
    data: Record<number, string>;
    conformityLevel: number;
}

/** Custom function (FC65-72 / FC100-110) result. */
export interface ICustomFunctionResult {
    data: number[];
    buffer: Buffer;
}

/** FC6 / FC16 register value: a number or a raw Buffer. */
export type RegisterValue = number | Buffer;

// ── Enron ──────────────────────────────────────────────────────────

/** Enron address-range table (32-bit register variant). */
export interface IEnronTables {
    /** Short integer (16-bit) register range; must be length 2 with [0] < [1]. */
    shortRange: [number, number];
    longRange?: [number, number];
    floatRange?: [number, number];
    booleanRange?: [number, number];
}

/** Serial parity options. */
export type Parity = "none" | "even" | "odd" | "mark" | "space";

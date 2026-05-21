/**
 * Server vector — the set of read/write handler functions a user supplies
 * to a Modbus server.
 *
 * Each handler may be written in value, Promise, or callback style; the
 * server detects the style at call time (see notes 06 §1, 18 §4.3).
 */

/** A handler return value: a plain value or a Promise of one. */
export type ValueOrPromise<T> = T | Promise<T>;

/** Node-style callback used by callback-style handlers. */
export type ServerCallback<T> = (error: Error | null, value?: T) => void;

/** Value/Promise-style or callback-style single-address getter. */
export type VectorGetter<T> =
    | ((address: number, unitId: number) => ValueOrPromise<T>)
    | ((address: number, unitId: number, callback: ServerCallback<T>) => void);

/** Value/Promise-style or callback-style multi-address getter. */
export type VectorMultiGetter<T> =
    | ((address: number, length: number, unitId: number) => ValueOrPromise<T>)
    | ((address: number, length: number, unitId: number, callback: ServerCallback<T>) => void);

/** Value/Promise-style or callback-style single-address setter. */
export type VectorSetter<T> =
    | ((address: number, value: T, unitId: number) => ValueOrPromise<void>)
    | ((address: number, value: T, unitId: number, callback: ServerCallback<void>) => void);

/** Report Server ID payload. */
export interface IReportServerIDPayload {
    id: number;
    running: boolean;
    additionalData?: Buffer;
}

/**
 * The handler vector. Every handler is optional; an unimplemented function
 * code yields a Modbus "illegal function" exception.
 */
export interface IModbusServerVector {
    /** FC1 — read a coil. */
    getCoil?: VectorGetter<boolean>;
    /** FC2 — read a discrete input. */
    getDiscreteInput?: VectorGetter<boolean>;
    /** FC3 — read a holding register. */
    getHoldingRegister?: VectorGetter<number>;
    /** FC3 — read several holding registers at once (preferred when length > 1). */
    getMultipleHoldingRegisters?: VectorMultiGetter<number[]>;
    /** FC4 — read an input register. */
    getInputRegister?: VectorGetter<number>;
    /** FC4 — read several input registers at once (preferred when length > 1). */
    getMultipleInputRegisters?: VectorMultiGetter<number[]>;
    /** FC5 / FC15 — write a coil. */
    setCoil?: VectorSetter<boolean>;
    /** FC15 — write several coils at once (preferred). */
    setCoilArray?: VectorSetter<boolean[]>;
    /** FC6 / FC16 — write a register. */
    setRegister?: VectorSetter<number>;
    /** FC16 — write several registers at once (preferred). */
    setRegisterArray?: VectorSetter<number[]>;
    /** FC22 — mask-write a register. */
    getHoldingRegisterForMask?: VectorGetter<number>;
    /** FC17 — report server id (value/Promise style only). */
    reportServerID?: (unitId: number) => ValueOrPromise<IReportServerIDPayload>;
    /** FC43 — read device identification (value/Promise style only). */
    readDeviceIdentification?: (unitId: number) => ValueOrPromise<Record<number, string>>;
}

/**
 * Server-side function-code handlers.
 *
 * Each handler takes a request PDU and returns a response PDU (or throws a
 * {@link ServerException}). Vector functions are invoked uniformly whether
 * they are value-, Promise-, or callback-style — this cleanly replaces the
 * broken implicit-global branches in node-modbus-serial (see note 06 §9).
 */

import { writeBit, readBit } from "../utils/buffer-bit";
import { ModbusFunctionCode, ModbusExceptionCode, MEI_TYPE_DEVICE_IDENTIFICATION } from "../protocol/constants";
import type { IModbusServerVector } from "./vector.interface";

/** Thrown by a handler to produce a Modbus exception response. */
export class ServerException extends Error {
    public readonly exceptionCode: number;

    constructor(exceptionCode: number, message?: string) {
        super(message ?? `Modbus exception ${exceptionCode}`);
        this.name = "ServerException";
        this.exceptionCode = exceptionCode;
    }
}

/** A vector function in any of the three supported styles. */
type AnyVectorFn = (...args: unknown[]) => unknown;

/**
 * Invoke a vector function uniformly across value / Promise / callback styles.
 *
 * @param fn the vector function.
 * @param args positional arguments (without any callback).
 * @param callbackArity the function arity that indicates callback style.
 */
function invokeVector<T>(fn: AnyVectorFn, args: unknown[], callbackArity: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        try {
            if (fn.length >= callbackArity) {
                fn(...args, (error: Error | null, value?: T) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve(value as T);
                    }
                });
            } else {
                const result = fn(...args);
                if (result && typeof (result as Promise<T>).then === "function") {
                    (result as Promise<T>).then(resolve, reject);
                } else {
                    resolve(result as T);
                }
            }
        } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
        }
    });
}

/** FC1/FC2 — Read Coils / Read Discrete Inputs. */
export async function handleReadBits(
    pdu: Buffer,
    vector: IModbusServerVector,
    unitId: number,
    functionCode: ModbusFunctionCode.READ_COILS | ModbusFunctionCode.READ_DISCRETE_INPUTS,
): Promise<Buffer> {
    const address = pdu.readUInt16BE(1);
    const length = pdu.readUInt16BE(3);
    if (length < 1) {
        throw new ServerException(ModbusExceptionCode.ILLEGAL_DATA_VALUE, "Invalid length");
    }

    const getter =
        functionCode === ModbusFunctionCode.READ_COILS ? vector.getCoil : vector.getDiscreteInput;
    if (!getter) {
        throw new ServerException(ModbusExceptionCode.ILLEGAL_FUNCTION);
    }

    const dataBytes = Math.ceil(length / 8);
    const response = Buffer.alloc(2 + dataBytes);
    response.writeUInt8(functionCode, 0);
    response.writeUInt8(dataBytes, 1);
    for (let i = 0; i < length; i++) {
        const value = await invokeVector<boolean>(getter as AnyVectorFn, [address + i, unitId], 3);
        if (value) {
            writeBit(response, 1, i, 2);
        }
    }
    return response;
}

/** FC3/FC4 — Read Holding / Input Registers. */
export async function handleReadRegisters(
    pdu: Buffer,
    vector: IModbusServerVector,
    unitId: number,
    functionCode: ModbusFunctionCode.READ_HOLDING_REGISTERS | ModbusFunctionCode.READ_INPUT_REGISTERS,
): Promise<Buffer> {
    const address = pdu.readUInt16BE(1);
    const length = pdu.readUInt16BE(3);
    if (length < 1) {
        throw new ServerException(ModbusExceptionCode.ILLEGAL_DATA_VALUE, "Invalid length");
    }

    const isHolding = functionCode === ModbusFunctionCode.READ_HOLDING_REGISTERS;
    const multi = isHolding ? vector.getMultipleHoldingRegisters : vector.getMultipleInputRegisters;
    const single = isHolding ? vector.getHoldingRegister : vector.getInputRegister;

    const response = Buffer.alloc(2 + length * 2);
    response.writeUInt8(functionCode, 0);
    response.writeUInt8(length * 2, 1);

    if (multi && length > 1) {
        const values = await invokeVector<number[]>(multi as AnyVectorFn, [address, length, unitId], 4);
        if (!Array.isArray(values) || values.length !== length) {
            throw new ServerException(
                ModbusExceptionCode.SLAVE_DEVICE_FAILURE,
                "Requested address length and response length do not match",
            );
        }
        for (let i = 0; i < length; i++) {
            response.writeUInt16BE(values[i] & 0xffff, 2 + i * 2);
        }
    } else if (single) {
        for (let i = 0; i < length; i++) {
            const value = await invokeVector<number>(single as AnyVectorFn, [address + i, unitId], 3);
            response.writeUInt16BE(value & 0xffff, 2 + i * 2);
        }
    } else {
        throw new ServerException(ModbusExceptionCode.ILLEGAL_FUNCTION);
    }
    return response;
}

/** FC5 — Write Single Coil. */
export async function handleWriteCoil(
    pdu: Buffer,
    vector: IModbusServerVector,
    unitId: number,
): Promise<Buffer> {
    if (!vector.setCoil) {
        throw new ServerException(ModbusExceptionCode.ILLEGAL_FUNCTION);
    }
    const address = pdu.readUInt16BE(1);
    const state = pdu.readUInt16BE(3) === 0xff00;
    await invokeVector<void>(vector.setCoil as AnyVectorFn, [address, state, unitId], 4);
    return Buffer.from(pdu); // echo
}

/** FC6 — Write Single Register. */
export async function handleWriteRegister(
    pdu: Buffer,
    vector: IModbusServerVector,
    unitId: number,
): Promise<Buffer> {
    if (!vector.setRegister) {
        throw new ServerException(ModbusExceptionCode.ILLEGAL_FUNCTION);
    }
    const address = pdu.readUInt16BE(1);
    const value = pdu.readUInt16BE(3);
    await invokeVector<void>(vector.setRegister as AnyVectorFn, [address, value, unitId], 4);
    return Buffer.from(pdu); // echo
}

/** FC15 — Write Multiple Coils. */
export async function handleWriteCoils(
    pdu: Buffer,
    vector: IModbusServerVector,
    unitId: number,
): Promise<Buffer> {
    const address = pdu.readUInt16BE(1);
    const length = pdu.readUInt16BE(3);
    if (length < 1) {
        throw new ServerException(ModbusExceptionCode.ILLEGAL_DATA_VALUE, "Invalid length");
    }

    const states: boolean[] = [];
    for (let i = 0; i < length; i++) {
        states.push(readBit(pdu, i, 6));
    }

    if (vector.setCoilArray) {
        await invokeVector<void>(vector.setCoilArray as AnyVectorFn, [address, states, unitId], 4);
    } else if (vector.setCoil) {
        for (let i = 0; i < length; i++) {
            await invokeVector<void>(vector.setCoil as AnyVectorFn, [address + i, states[i], unitId], 4);
        }
    } else {
        throw new ServerException(ModbusExceptionCode.ILLEGAL_FUNCTION);
    }

    const response = Buffer.alloc(5);
    response.writeUInt8(ModbusFunctionCode.WRITE_MULTIPLE_COILS, 0);
    response.writeUInt16BE(address, 1);
    response.writeUInt16BE(length, 3);
    return response;
}

/** FC16 — Write Multiple Registers. */
export async function handleWriteRegisters(
    pdu: Buffer,
    vector: IModbusServerVector,
    unitId: number,
): Promise<Buffer> {
    const address = pdu.readUInt16BE(1);
    const length = pdu.readUInt16BE(3);
    if (length < 1) {
        throw new ServerException(ModbusExceptionCode.ILLEGAL_DATA_VALUE, "Invalid length");
    }

    const values: number[] = [];
    for (let i = 0; i < length; i++) {
        values.push(pdu.readUInt16BE(6 + i * 2));
    }

    if (vector.setRegisterArray) {
        await invokeVector<void>(vector.setRegisterArray as AnyVectorFn, [address, values, unitId], 4);
    } else if (vector.setRegister) {
        for (let i = 0; i < length; i++) {
            await invokeVector<void>(vector.setRegister as AnyVectorFn, [address + i, values[i], unitId], 4);
        }
    } else {
        throw new ServerException(ModbusExceptionCode.ILLEGAL_FUNCTION);
    }

    const response = Buffer.alloc(5);
    response.writeUInt8(ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS, 0);
    response.writeUInt16BE(address, 1);
    response.writeUInt16BE(length, 3);
    return response;
}

/** FC22 — Mask Write Register. */
export async function handleMaskWriteRegister(
    pdu: Buffer,
    vector: IModbusServerVector,
    unitId: number,
): Promise<Buffer> {
    const getter = vector.getHoldingRegisterForMask ?? vector.getHoldingRegister;
    if (!getter || !vector.setRegister) {
        throw new ServerException(ModbusExceptionCode.ILLEGAL_FUNCTION);
    }
    const address = pdu.readUInt16BE(1);
    const andMask = pdu.readUInt16BE(3);
    const orMask = pdu.readUInt16BE(5);

    const current = await invokeVector<number>(getter as AnyVectorFn, [address, unitId], 3);
    const updated = ((current & andMask) | (orMask & ~andMask)) & 0xffff;
    await invokeVector<void>(vector.setRegister as AnyVectorFn, [address, updated, unitId], 4);
    return Buffer.from(pdu); // echo
}

/** FC17 — Report Server ID. */
export async function handleReportServerID(
    vector: IModbusServerVector,
    unitId: number,
): Promise<Buffer> {
    if (!vector.reportServerID) {
        throw new ServerException(ModbusExceptionCode.ILLEGAL_FUNCTION);
    }
    const value = await Promise.resolve(vector.reportServerID(unitId));
    if (!value || typeof value.id !== "number" || typeof value.running !== "boolean") {
        throw new ServerException(ModbusExceptionCode.SLAVE_DEVICE_FAILURE, "Invalid Report Server ID payload");
    }

    const additionalData = value.additionalData ?? Buffer.alloc(0);
    const contentLength = 2 + additionalData.length; // server id + run status + extra
    const response = Buffer.alloc(2 + contentLength);
    response.writeUInt8(ModbusFunctionCode.REPORT_SERVER_ID, 0);
    response.writeUInt8(contentLength, 1);
    response.writeUInt8(value.id, 2);
    response.writeUInt8(value.running ? 0xff : 0x00, 3);
    additionalData.copy(response, 4);
    return response;
}

/** FC43/14 — Read Device Identification. */
export async function handleReadDeviceIdentification(
    pdu: Buffer,
    vector: IModbusServerVector,
    unitId: number,
): Promise<Buffer> {
    if (pdu.readUInt8(1) !== MEI_TYPE_DEVICE_IDENTIFICATION) {
        throw new ServerException(ModbusExceptionCode.ILLEGAL_FUNCTION);
    }
    if (!vector.readDeviceIdentification) {
        throw new ServerException(ModbusExceptionCode.ILLEGAL_FUNCTION);
    }

    const readDeviceIdCode = pdu.readUInt8(2);
    const requestedObjectId = pdu.readUInt8(3);
    const objects = await Promise.resolve(vector.readDeviceIdentification(unitId));

    // Collect requested object ids (>= the requested start), sorted.
    const ids = Object.keys(objects)
        .map((k) => parseInt(k, 10))
        .filter((id) => !Number.isNaN(id) && id >= requestedObjectId)
        .sort((a, b) => a - b);

    const headerLength = 7; // FC + MEI + idCode + conformity + moreFollows + nextId + numObjects
    let conformityLevel = 0x81;
    let bodyLength = 0;
    const encoded: Buffer[] = [];
    for (const id of ids) {
        if (id > 0x02) {
            conformityLevel = 0x82;
        }
        if (id > 0x80) {
            conformityLevel = 0x83;
        }
        const valueBytes = Buffer.from(objects[id], "ascii");
        const objectBuffer = Buffer.alloc(2 + valueBytes.length);
        objectBuffer.writeUInt8(id, 0);
        objectBuffer.writeUInt8(valueBytes.length, 1);
        valueBytes.copy(objectBuffer, 2);
        encoded.push(objectBuffer);
        bodyLength += objectBuffer.length;
    }

    const response = Buffer.alloc(headerLength + bodyLength);
    response.writeUInt8(ModbusFunctionCode.READ_DEVICE_IDENTIFICATION, 0);
    response.writeUInt8(MEI_TYPE_DEVICE_IDENTIFICATION, 1);
    response.writeUInt8(readDeviceIdCode, 2);
    response.writeUInt8(conformityLevel, 3);
    response.writeUInt8(0x00, 4); // more follows: all objects fit in one response
    response.writeUInt8(0x00, 5); // next object id
    response.writeUInt8(encoded.length, 6);
    let offset = headerLength;
    for (const objectBuffer of encoded) {
        objectBuffer.copy(response, offset);
        offset += objectBuffer.length;
    }
    return response;
}

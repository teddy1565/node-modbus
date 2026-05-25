/**
 * ModbusWorker — an optional high-level layer over a client.
 *
 * Adds typed reads/writes (int16/uint16/int32/uint32/float) and batch
 * polling on top of the raw function-code API (see note 10).
 *
 * Request serialisation and queuing are already handled by ModbusClientCore,
 * so the worker focuses on value typing and request batching.
 */

import type { AbsModbusClient } from "../client/abs-modbus-client";

/** Numeric encoding of a register value. */
export type WorkerValueType = "int16" | "uint16" | "int32" | "uint32" | "float";

/** A single worker request. */
export interface IWorkerRequest {
    /** Function code: 1, 2, 3, 4, 5, 6 or 16. */
    fc: number;
    /** Unit id (defaults to the client's configured id). */
    unit?: number;
    /** Starting data address. */
    address: number;
    /** Number of typed values (reads). */
    quantity?: number;
    /** Value(s) to write. */
    value?: number | number[] | boolean | boolean[];
    /** Numeric type for register reads/writes (default "int16"). */
    type?: WorkerValueType;
}

/** One entry of a poll map. */
export interface IPollMapEntry {
    /** Function code: 1, 2, 3 or 4. */
    fc: number;
    /** A single address or a list of addresses. */
    address: number | number[];
    /** Numeric type for register entries (default "int16"). */
    type?: WorkerValueType;
}

/** Options for {@link ModbusWorker.poll}. */
export interface IPollOptions {
    unit?: number;
    map: IPollMapEntry[];
    /** Maximum registers/coils per underlying request (default 32). */
    maxChunkSize?: number;
}

/** Byte width of a worker value type. */
function byteLength(type: WorkerValueType): number {
    return type === "int32" || type === "uint32" || type === "float" ? 4 : 2;
}

/** Decode a register byte buffer into typed numbers. */
export function unbufferize(buffer: Buffer, type: WorkerValueType): number[] {
    const width = byteLength(type);
    const values: number[] = [];
    for (let i = 0; i + width <= buffer.length; i += width) {
        switch (type) {
            case "int16":
                values.push(buffer.readInt16BE(i));
                break;
            case "uint16":
                values.push(buffer.readUInt16BE(i));
                break;
            case "int32":
                values.push(buffer.readInt32BE(i));
                break;
            case "uint32":
                values.push(buffer.readUInt32BE(i));
                break;
            case "float":
                values.push(buffer.readFloatBE(i));
                break;
        }
    }
    return values;
}

/** Encode typed numbers into a register byte buffer (big-endian). */
export function bufferize(values: number[], type: WorkerValueType): Buffer {
    const width = byteLength(type);
    const buffer = Buffer.alloc(values.length * width);
    values.forEach((value, i) => {
        switch (type) {
            case "int16":
                buffer.writeInt16BE(value, i * width);
                break;
            case "uint16":
                buffer.writeUInt16BE(value, i * width);
                break;
            case "int32":
                buffer.writeInt32BE(value, i * width);
                break;
            case "uint32":
                buffer.writeUInt32BE(value, i * width);
                break;
            case "float":
                buffer.writeFloatBE(value, i * width);
                break;
        }
    });
    return buffer;
}

export class ModbusWorker {
    constructor(private readonly client: AbsModbusClient) {}

    /**
     * Execute one typed request.
     *  - FC1/2 resolve to `boolean[]`.
     *  - FC3/4 resolve to `number[]` decoded per `type`.
     *  - FC5/6/16 resolve to `void`.
     */
    public async send(request: IWorkerRequest): Promise<boolean[] | number[] | void> {
        const unit = request.unit;
        const quantity = request.quantity ?? 1;

        switch (request.fc) {
            case 1:
                return (await this.client.read_coils(request.address, quantity, unit)).data.slice(0, quantity);
            case 2:
                return (await this.client.read_discrete_inputs(request.address, quantity, unit)).data.slice(
                    0,
                    quantity,
                );
            case 3:
            case 4: {
                const type = request.type ?? "int16";
                const registerCount = quantity * (byteLength(type) / 2);
                const result =
                    request.fc === 3
                        ? await this.client.read_holding_registers(request.address, registerCount, unit)
                        : await this.client.read_input_registers(request.address, registerCount, unit);
                return unbufferize(result.buffer, type);
            }
            case 5:
                await this.client.write_coil(request.address, Boolean(request.value), unit);
                return;
            case 6:
            case 16: {
                const type = request.type ?? "int16";
                const raw = Array.isArray(request.value)
                    ? (request.value as number[])
                    : [request.value as number];
                const buffer = bufferize(raw, type);
                if (request.fc === 6 && buffer.length <= 2) {
                    await this.client.write_register(request.address, buffer, unit);
                } else {
                    await this.client.write_registers(request.address, buffer, unit);
                }
                return;
            }
            default:
                throw new Error(`Unsupported worker function code: ${request.fc}`);
        }
    }

    /**
     * Batch-read a set of addresses. Contiguous register addresses of the
     * same type are coalesced into chunked requests.
     *
     * @returns a map of `address -> value`.
     */
    public async poll(options: IPollOptions): Promise<Record<number, number | boolean>> {
        const maxChunkSize = options.maxChunkSize ?? 32;
        const result: Record<number, number | boolean> = {};

        for (const entry of options.map) {
            const addresses = Array.isArray(entry.address) ? [...entry.address] : [entry.address];
            addresses.sort((a, b) => a - b);

            if (entry.fc === 1 || entry.fc === 2) {
                for (const address of addresses) {
                    const data = (await this.send({ fc: entry.fc, unit: options.unit, address, quantity: 1 })) as
                        | boolean[]
                        | undefined;
                    result[address] = data?.[0] ?? false;
                }
            } else if (entry.fc === 3 || entry.fc === 4) {
                const type = entry.type ?? "int16";
                const step = byteLength(type) / 2; // registers per value
                for (const chunk of chunkContiguous(addresses, step, maxChunkSize)) {
                    const values = (await this.send({
                        fc: entry.fc,
                        unit: options.unit,
                        address: chunk[0],
                        quantity: chunk.length,
                        type,
                    })) as number[];
                    chunk.forEach((address, i) => {
                        result[address] = values[i];
                    });
                }
            } else {
                throw new Error(`Unsupported poll function code: ${entry.fc}`);
            }
        }
        return result;
    }
}

/** Group sorted addresses into contiguous runs of at most `maxChunkSize`. */
function chunkContiguous(addresses: number[], step: number, maxChunkSize: number): number[][] {
    const chunks: number[][] = [];
    let current: number[] = [];
    for (const address of addresses) {
        const last = current[current.length - 1];
        if (current.length === 0 || (address === last + step && current.length < maxChunkSize)) {
            current.push(address);
        } else {
            chunks.push(current);
            current = [address];
        }
    }
    if (current.length > 0) {
        chunks.push(current);
    }
    return chunks;
}

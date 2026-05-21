/**
 * AbsModbusClient — shared implementation for ModbusTCPClient and
 * ModbusRTUClient.
 *
 * Holds a ModbusClientCore and exposes the public snake_case Promise API.
 * The two concrete clients differ only in which transport they construct.
 */

import { EventEmitter } from "events";
import { ModbusFunctionCode } from "../protocol/constants";
import { BadAddressError } from "../protocol/errors";
import type {
    IModbusReadRequest_Result,
    IWriteCoilResult,
    IWriteRegisterResult,
    IWriteMultipleResult,
    IReportServerIDResult,
    IReadFileRecordsResult,
    IMaskWriteRegisterResult,
    IReadWriteRegistersResult,
    IReadDeviceIdentificationResult,
    ICustomFunctionResult,
    RegisterValue,
} from "../protocol/types";
import {
    encodeReadBitsRequest,
    parseReadBitsResponse,
    encodeReadRegistersRequest,
    parseReadRegistersResponse,
    encodeWriteCoilRequest,
    parseWriteCoilResponse,
    encodeWriteRegisterRequest,
    parseWriteRegisterResponse,
    encodeWriteCoilsRequest,
    encodeWriteRegistersRequest,
    parseWriteMultipleResponse,
    encodeReportServerIdRequest,
    parseReportServerIdResponse,
    encodeReadFileRecordsRequest,
    parseReadFileRecordsResponse,
    encodeMaskWriteRegisterRequest,
    parseMaskWriteRegisterResponse,
    encodeReadWriteRegistersRequest,
    parseReadWriteRegistersResponse,
    encodeReadDeviceIdentificationRequest,
    parseDeviceIdentificationResponse,
    encodeCustomFunctionRequest,
    parseCustomFunctionResponse,
} from "../protocol/function-codes";
import type { IModbusTransport } from "../ports/transport.interface";
import { ModbusClientCore, type IRequestSpec } from "./modbus-client-core";

/** Options common to all clients. */
export interface IModbusClientBaseOptions {
    /** Default unit id (default 1). */
    unit_id?: number;
    /** Response timeout in ms (0 = no timeout). */
    timeout?: number;
}

/** Reject early if a numeric argument is missing/invalid (helps JS callers). */
function assertNumber(value: unknown): void {
    if (typeof value !== "number" || Number.isNaN(value)) {
        throw new BadAddressError();
    }
}

export abstract class AbsModbusClient extends EventEmitter {
    protected readonly core: ModbusClientCore;

    protected constructor(transport: IModbusTransport, options: IModbusClientBaseOptions) {
        super();
        this.core = new ModbusClientCore({
            transport,
            timeout: options.timeout,
            unitId: options.unit_id ?? 1,
        });
        this.core.on("error", (error: Error) => this.emit("error", error));
        this.core.on("close", () => this.emit("close"));
    }

    // ── Connection management ──────────────────────────────────────

    /** Open the underlying transport. */
    public connect(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.core.open((error) => (error ? reject(error) : resolve()));
        });
    }

    /** Close the underlying transport. */
    public disconnect(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.core.close((error) => (error ? reject(error) : resolve()));
        });
    }

    /** Alias of {@link disconnect}. */
    public close(): Promise<void> {
        return this.disconnect();
    }

    /** Forcibly destroy the underlying transport. */
    public destroy(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.core.destroy((error) => (error ? reject(error) : resolve()));
        });
    }

    public get is_open(): boolean {
        return this.core.isOpen;
    }

    // ── Settings ───────────────────────────────────────────────────

    public set_id(unit_id: number): void {
        this.core.setId(unit_id);
    }

    public get_id(): number {
        return this.core.getId();
    }

    public set_timeout(ms: number): void {
        this.core.setTimeout(ms);
    }

    public get_timeout(): number {
        return this.core.getTimeout();
    }

    public set_debug_enabled(enable: boolean): void {
        this.core.setDebugEnabled(enable);
    }

    public get is_debug_enabled(): boolean {
        return this.core.isDebugEnabled;
    }

    // ── FC1/2 — read bits ──────────────────────────────────────────

    /** FC1 — Read Coils. */
    public read_coils(
        address: number,
        quantity: number,
        unit_id?: number,
    ): Promise<IModbusReadRequest_Result<boolean[]>> {
        return this.requestReadBits(ModbusFunctionCode.READ_COILS, address, quantity, unit_id);
    }

    /** FC2 — Read Discrete Inputs. */
    public read_discrete_inputs(
        address: number,
        quantity: number,
        unit_id?: number,
    ): Promise<IModbusReadRequest_Result<boolean[]>> {
        return this.requestReadBits(ModbusFunctionCode.READ_DISCRETE_INPUTS, address, quantity, unit_id);
    }

    private requestReadBits(
        functionCode: ModbusFunctionCode.READ_COILS | ModbusFunctionCode.READ_DISCRETE_INPUTS,
        address: number,
        quantity: number,
        unit_id?: number,
    ): Promise<IModbusReadRequest_Result<boolean[]>> {
        return this.run(() => {
            assertNumber(address);
            assertNumber(quantity);
            return {
                unitId: unit_id ?? this.core.getId(),
                functionCode,
                pdu: encodeReadBitsRequest(functionCode, address, quantity),
                expectedLength: 3 + Math.ceil(quantity / 8) + 2,
                parse: parseReadBitsResponse,
            };
        });
    }

    // ── FC3/4 — read registers ─────────────────────────────────────

    /** FC3 — Read Holding Registers. */
    public read_holding_registers(
        address: number,
        quantity: number,
        unit_id?: number,
    ): Promise<IModbusReadRequest_Result<number[]>> {
        return this.requestReadRegisters(ModbusFunctionCode.READ_HOLDING_REGISTERS, address, quantity, unit_id);
    }

    /** FC4 — Read Input Registers. */
    public read_input_registers(
        address: number,
        quantity: number,
        unit_id?: number,
    ): Promise<IModbusReadRequest_Result<number[]>> {
        return this.requestReadRegisters(ModbusFunctionCode.READ_INPUT_REGISTERS, address, quantity, unit_id);
    }

    private requestReadRegisters(
        functionCode: ModbusFunctionCode.READ_HOLDING_REGISTERS | ModbusFunctionCode.READ_INPUT_REGISTERS,
        address: number,
        quantity: number,
        unit_id?: number,
    ): Promise<IModbusReadRequest_Result<number[]>> {
        return this.run(() => {
            assertNumber(address);
            assertNumber(quantity);
            return {
                unitId: unit_id ?? this.core.getId(),
                functionCode,
                pdu: encodeReadRegistersRequest(functionCode, address, quantity),
                expectedLength: 3 + 2 * quantity + 2,
                parse: parseReadRegistersResponse,
            };
        });
    }

    // ── FC5/6 — write single ───────────────────────────────────────

    /** FC5 — Write Single Coil. */
    public write_coil(address: number, state: boolean, unit_id?: number): Promise<IWriteCoilResult> {
        return this.run(() => {
            assertNumber(address);
            return {
                unitId: unit_id ?? this.core.getId(),
                functionCode: ModbusFunctionCode.WRITE_SINGLE_COIL,
                pdu: encodeWriteCoilRequest(address, state),
                expectedLength: 8,
                parse: parseWriteCoilResponse,
            };
        });
    }

    /** FC6 — Write Single Register. */
    public write_register(address: number, value: RegisterValue, unit_id?: number): Promise<IWriteRegisterResult> {
        return this.run(() => {
            assertNumber(address);
            return {
                unitId: unit_id ?? this.core.getId(),
                functionCode: ModbusFunctionCode.WRITE_SINGLE_REGISTER,
                pdu: encodeWriteRegisterRequest(address, value),
                expectedLength: 8,
                parse: parseWriteRegisterResponse,
            };
        });
    }

    // ── FC15/16 — write multiple ───────────────────────────────────

    /** FC15 — Write Multiple Coils. */
    public write_coils(address: number, states: boolean[], unit_id?: number): Promise<IWriteMultipleResult> {
        return this.run(() => {
            assertNumber(address);
            return {
                unitId: unit_id ?? this.core.getId(),
                functionCode: ModbusFunctionCode.WRITE_MULTIPLE_COILS,
                pdu: encodeWriteCoilsRequest(address, states),
                expectedLength: 8,
                parse: parseWriteMultipleResponse,
            };
        });
    }

    /** FC16 — Write Multiple Registers. */
    public write_registers(
        address: number,
        values: number[] | Buffer,
        unit_id?: number,
    ): Promise<IWriteMultipleResult> {
        return this.run(() => {
            assertNumber(address);
            return {
                unitId: unit_id ?? this.core.getId(),
                functionCode: ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS,
                pdu: encodeWriteRegistersRequest(address, values),
                expectedLength: 8,
                parse: parseWriteMultipleResponse,
            };
        });
    }

    // ── Extended function codes ────────────────────────────────────

    /** FC17 — Report Server ID. */
    public report_server_id(unit_id?: number): Promise<IReportServerIDResult> {
        return this.run(() => ({
            unitId: unit_id ?? this.core.getId(),
            functionCode: ModbusFunctionCode.REPORT_SERVER_ID,
            pdu: encodeReportServerIdRequest(),
            lengthUnknown: true,
            parse: parseReportServerIdResponse,
        }));
    }

    /** FC20 — Read File Records (single sub-request). */
    public read_file_records(
        file_number: number,
        record_number: number,
        unit_id?: number,
    ): Promise<IReadFileRecordsResult> {
        return this.run(() => {
            assertNumber(file_number);
            assertNumber(record_number);
            return {
                unitId: unit_id ?? this.core.getId(),
                functionCode: ModbusFunctionCode.READ_FILE_RECORDS,
                pdu: encodeReadFileRecordsRequest(file_number, record_number),
                lengthUnknown: true,
                parse: parseReadFileRecordsResponse,
            };
        });
    }

    /** FC22 — Mask Write Register. */
    public mask_write_register(
        address: number,
        and_mask: number,
        or_mask: number,
        unit_id?: number,
    ): Promise<IMaskWriteRegisterResult> {
        return this.run(() => {
            assertNumber(address);
            return {
                unitId: unit_id ?? this.core.getId(),
                functionCode: ModbusFunctionCode.MASK_WRITE_REGISTER,
                pdu: encodeMaskWriteRegisterRequest(address, and_mask, or_mask),
                expectedLength: 10,
                parse: parseMaskWriteRegisterResponse,
            };
        });
    }

    /** FC23 — Read/Write Multiple Registers. */
    public read_write_registers(
        read_address: number,
        read_quantity: number,
        write_address: number,
        values: number[] | Buffer,
        unit_id?: number,
    ): Promise<IReadWriteRegistersResult> {
        return this.run(() => {
            assertNumber(read_address);
            assertNumber(write_address);
            return {
                unitId: unit_id ?? this.core.getId(),
                functionCode: ModbusFunctionCode.READ_WRITE_MULTIPLE_REGISTERS,
                pdu: encodeReadWriteRegistersRequest(read_address, read_quantity, write_address, values),
                expectedLength: 3 + 2 * read_quantity + 2,
                parse: parseReadWriteRegistersResponse,
            };
        });
    }

    /** FC43 — Read Device Identification (follows `moreFollows` continuations). */
    public async read_device_identification(
        device_id_code: number,
        object_id: number,
        unit_id?: number,
    ): Promise<IReadDeviceIdentificationResult> {
        const unit = unit_id ?? this.core.getId();
        const merged: Record<number, string> = {};
        let conformityLevel = 0;
        let currentObjectId = object_id;

        for (;;) {
            const partial = await this.core.request({
                unitId: unit,
                functionCode: ModbusFunctionCode.READ_DEVICE_IDENTIFICATION,
                pdu: encodeReadDeviceIdentificationRequest(device_id_code, currentObjectId),
                lengthUnknown: true,
                parse: parseDeviceIdentificationResponse,
            });
            Object.assign(merged, partial.result);
            conformityLevel = partial.conformityLevel;

            if (partial.moreFollows && Object.keys(partial.result).length > 0) {
                currentObjectId = partial.nextObjectId;
            } else {
                break;
            }
        }
        return { data: merged, conformityLevel };
    }

    /** Custom function code (FC65-72 / FC100-110). */
    public custom_function(
        function_code: number,
        data: number[] | Buffer,
        unit_id?: number,
    ): Promise<ICustomFunctionResult> {
        return this.run(() => ({
            unitId: unit_id ?? this.core.getId(),
            functionCode: function_code,
            pdu: encodeCustomFunctionRequest(function_code, data),
            lengthUnknown: true,
            parse: parseCustomFunctionResponse,
        }));
    }

    /** Build a request spec (catching encoder errors) and dispatch it. */
    private run<T>(build: () => IRequestSpec<T>): Promise<T> {
        let spec: IRequestSpec<T>;
        try {
            spec = build();
        } catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error(String(error)));
        }
        return this.core.request(spec);
    }
}

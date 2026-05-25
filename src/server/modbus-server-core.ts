/**
 * ModbusServerCore — shared request dispatch for ModbusTCPServer and
 * ModbusRTUServer.
 *
 * Parses an RTU request frame, dispatches to the vector handlers, and hands
 * an RTU response frame back through a writer. A single dispatch table is
 * used for both transports, so FC17 is supported uniformly — fixing the
 * missing `case 17` in node-modbus-serial's TCP server (notes 06, 16).
 */

import { encodeRtuFrame, parseRtuFrame } from "../protocol/framing";
import {
    ModbusFunctionCode,
    ModbusExceptionCode,
    EXCEPTION_BIT,
} from "../protocol/constants";
import type { IEnronTables } from "../protocol/types";
import type { IModbusServerVector } from "./vector.interface";
import {
    ServerException,
    handleReadBits,
    handleReadRegisters,
    handleWriteCoil,
    handleWriteRegister,
    handleWriteCoils,
    handleWriteRegisters,
    handleReadWriteRegisters,
    handleMaskWriteRegister,
    handleReportServerID,
    handleReadDeviceIdentification,
    type IServerHandlerContext,
} from "./handlers";

/** Receives the RTU response frame (or an error) produced for a request. */
export type ResponseWriter = (error: Error | null, responseFrame?: Buffer) => void;

/** Options for the server core. */
export interface IModbusServerCoreOptions {
    /** Server unit id; 255 accepts requests for any unit. */
    unitId: number;
    debug?: boolean;
    /** Enable the Enron 32-bit register variant for FC3/6. */
    enron?: boolean;
    /** Enron address-range table (required when `enron` is true). */
    enronTables?: IEnronTables;
}

/** Smallest acceptable request frame: address + FC + CRC. */
const MIN_REQUEST_LENGTH = 4;

export class ModbusServerCore {
    private readonly handlerContext: IServerHandlerContext;

    constructor(
        private readonly vector: IModbusServerVector,
        private readonly options: IModbusServerCoreOptions,
    ) {
        this.handlerContext = { enron: options.enron, enronTables: options.enronTables };
    }

    /**
     * Process one RTU request frame and deliver an RTU response through
     * `writer`. Malformed or out-of-scope requests are silently ignored.
     */
    public handleRequest(requestFrame: Buffer, writer: ResponseWriter): void {
        if (requestFrame.length < MIN_REQUEST_LENGTH) {
            return;
        }

        const parsed = parseRtuFrame(requestFrame);
        if (!parsed.crcValid) {
            return; // bad CRC: ignore, like a real device
        }
        const { unitId, pdu } = parsed;
        if (this.options.unitId !== 255 && this.options.unitId !== unitId) {
            return; // request addressed to another unit
        }

        const functionCode = pdu.readUInt8(0);
        this.dispatch(functionCode, pdu, unitId)
            .then((responsePdu) => {
                writer(null, encodeRtuFrame(unitId, responsePdu));
            })
            .catch((error: unknown) => {
                const code =
                    error instanceof ServerException
                        ? error.exceptionCode
                        : ModbusExceptionCode.SLAVE_DEVICE_FAILURE;
                const exceptionPdu = Buffer.from([(functionCode | EXCEPTION_BIT) & 0xff, code]);
                writer(null, encodeRtuFrame(unitId, exceptionPdu));
            });
    }

    /** Route a request PDU to the matching handler. */
    private dispatch(functionCode: number, pdu: Buffer, unitId: number): Promise<Buffer> {
        switch (functionCode) {
            case ModbusFunctionCode.READ_COILS:
            case ModbusFunctionCode.READ_DISCRETE_INPUTS:
                return handleReadBits(pdu, this.vector, unitId, functionCode);
            case ModbusFunctionCode.READ_HOLDING_REGISTERS:
            case ModbusFunctionCode.READ_INPUT_REGISTERS:
                return handleReadRegisters(pdu, this.vector, unitId, functionCode, this.handlerContext);
            case ModbusFunctionCode.WRITE_SINGLE_COIL:
                return handleWriteCoil(pdu, this.vector, unitId);
            case ModbusFunctionCode.WRITE_SINGLE_REGISTER:
                return handleWriteRegister(pdu, this.vector, unitId, this.handlerContext);
            case ModbusFunctionCode.WRITE_MULTIPLE_COILS:
                return handleWriteCoils(pdu, this.vector, unitId);
            case ModbusFunctionCode.WRITE_MULTIPLE_REGISTERS:
                return handleWriteRegisters(pdu, this.vector, unitId);
            case ModbusFunctionCode.READ_WRITE_MULTIPLE_REGISTERS:
                return handleReadWriteRegisters(pdu, this.vector, unitId);
            case ModbusFunctionCode.REPORT_SERVER_ID:
                return handleReportServerID(this.vector, unitId);
            case ModbusFunctionCode.MASK_WRITE_REGISTER:
                return handleMaskWriteRegister(pdu, this.vector, unitId);
            case ModbusFunctionCode.READ_DEVICE_IDENTIFICATION:
                return handleReadDeviceIdentification(pdu, this.vector, unitId);
            default:
                return Promise.reject(new ServerException(ModbusExceptionCode.ILLEGAL_FUNCTION));
        }
    }
}

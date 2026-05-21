/**
 * ModbusRTUClient — a Modbus master over a physical serial line (RTU).
 */

import { RtuBufferedPort } from "../ports/rtu-buffered-port";
import type { Parity } from "../protocol/types";
import { AbsModbusClient, type IModbusClientBaseOptions } from "./abs-modbus-client";

/** Options for {@link ModbusRTUClient}. */
export interface IModbusRTUClientOptions extends IModbusClientBaseOptions {
    /** Serial device path (e.g. "COM3", "/dev/ttyUSB0"). */
    path: string;
    /** Baud rate (default 9600). */
    baud_rate?: number;
    parity?: Parity;
    data_bits?: 5 | 6 | 7 | 8;
    stop_bits?: 1 | 1.5 | 2;
}

export class ModbusRTUClient extends AbsModbusClient {
    constructor(options: IModbusRTUClientOptions) {
        const transport = new RtuBufferedPort({
            path: options.path,
            baudRate: options.baud_rate,
            parity: options.parity,
            dataBits: options.data_bits,
            stopBits: options.stop_bits,
        });
        super(transport, options);
    }
}

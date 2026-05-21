/**
 * ModbusRTUClient — a Modbus master over a physical serial line.
 *
 * Defaults to RTU framing; set `transport: "ascii"` for Modbus ASCII.
 */

import { RtuBufferedPort, type ISerialPortOptions } from "../ports/rtu-buffered-port";
import { AsciiPort } from "../ports/ascii-port";
import type { IModbusTransport } from "../ports/transport.interface";
import type { Parity } from "../protocol/types";
import { AbsModbusClient, type IModbusClientBaseOptions } from "./abs-modbus-client";

/** Serial transport variants. */
export type SerialTransportKind = "rtu" | "ascii";

/** Options for {@link ModbusRTUClient}. */
export interface IModbusRTUClientOptions extends IModbusClientBaseOptions {
    /** Serial device path (e.g. "COM3", "/dev/ttyUSB0"). */
    path: string;
    /** Baud rate (default 9600). */
    baud_rate?: number;
    parity?: Parity;
    data_bits?: 5 | 6 | 7 | 8;
    stop_bits?: 1 | 1.5 | 2;
    /** Transport variant (default "rtu"). */
    transport?: SerialTransportKind;
    /** ASCII start-of-slave-frame character (transport "ascii" only). */
    start_of_slave_frame_char?: number;
}

export class ModbusRTUClient extends AbsModbusClient {
    constructor(options: IModbusRTUClientOptions) {
        const portOptions: ISerialPortOptions = {
            path: options.path,
            baudRate: options.baud_rate,
            parity: options.parity,
            dataBits: options.data_bits,
            stopBits: options.stop_bits,
            startOfSlaveFrameChar: options.start_of_slave_frame_char,
        };

        const transport: IModbusTransport =
            options.transport === "ascii" ? new AsciiPort(portOptions) : new RtuBufferedPort(portOptions);
        super(transport, options);
    }
}

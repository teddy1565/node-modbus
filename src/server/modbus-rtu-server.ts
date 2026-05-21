/**
 * ModbusRTUServer — a Modbus RTU slave over a physical serial line.
 *
 * Incoming RTU requests have no length prefix, so a request frame is
 * delimited by an inter-frame silence: bytes are buffered and dispatched
 * once the line has been idle for `interval` ms (see note 06 §3).
 */

import { SerialPort } from "serialport";
import { EventEmitter } from "events";
import type { Parity, IEnronTables } from "../protocol/types";
import { SerialPortError } from "../protocol/errors";
import type { IModbusServerVector } from "./vector.interface";
import { ModbusServerCore } from "./modbus-server-core";
import type { IModbusServerEvents } from "./modbus-tcp-server";

/** Options for {@link ModbusRTUServer}. */
export interface IModbusRTUServerOptions {
    /** Serial device path (e.g. "COM3", "/dev/ttyUSB0"). */
    path: string;
    /** Baud rate (default 9600). */
    baud_rate?: number;
    parity?: Parity;
    data_bits?: 5 | 6 | 7 | 8;
    stop_bits?: 1 | 1.5 | 2;
    /** Server unit id; 255 (default) accepts any unit. */
    unit_id?: number;
    /** Inter-frame silence in ms that delimits a request (default 30). */
    interval?: number;
    debug?: boolean;
    /** Enable the Enron 32-bit register variant for FC3/6. */
    enron?: boolean;
    /** Enron address-range table (required when `enron` is true). */
    enron_tables?: IEnronTables;
}

export class ModbusRTUServer extends EventEmitter {
    private readonly serial: SerialPort;
    private readonly core: ModbusServerCore;
    private readonly interval: number;
    private buffer: Buffer = Buffer.alloc(0);
    private idleTimer: NodeJS.Timeout | null = null;

    constructor(vector: IModbusServerVector, options: IModbusRTUServerOptions) {
        super();
        this.core = new ModbusServerCore(vector, {
            unitId: options.unit_id ?? 255,
            debug: options.debug,
            enron: options.enron,
            enronTables: options.enron_tables,
        });
        this.interval = options.interval ?? 30;

        this.serial = new SerialPort({
            path: options.path,
            baudRate: options.baud_rate ?? 9600,
            parity: options.parity ?? "none",
            dataBits: options.data_bits ?? 8,
            stopBits: options.stop_bits ?? 1,
            autoOpen: false,
        });

        this.serial.on("data", (data: Buffer) => this.onData(data));
        this.serial.on("error", (error: Error) => this.emit("socketError", new SerialPortError(error)));
        this.serial.open((error) => {
            if (error) {
                this.emit("serverError", error);
            } else {
                this.emit("initialized");
            }
        });
    }

    /** The underlying serial port. */
    public getPort(): SerialPort {
        return this.serial;
    }

    /** Close the serial port. */
    public close(): Promise<void> {
        return new Promise<void>((resolve) => {
            if (this.idleTimer) {
                clearTimeout(this.idleTimer);
                this.idleTimer = null;
            }
            if (this.serial.isOpen) {
                this.serial.close(() => resolve());
            } else {
                resolve();
            }
        });
    }

    public override on<E extends keyof IModbusServerEvents>(event: E, listener: IModbusServerEvents[E]): this {
        return super.on(event, listener as (...args: unknown[]) => void);
    }

    public override once<E extends keyof IModbusServerEvents>(event: E, listener: IModbusServerEvents[E]): this {
        return super.once(event, listener as (...args: unknown[]) => void);
    }

    private onData(data: Buffer): void {
        this.buffer = Buffer.concat([this.buffer, data]);
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        this.idleTimer = setTimeout(() => this.flushFrame(), this.interval);
    }

    /** A full request frame has arrived (line went idle); dispatch it. */
    private flushFrame(): void {
        this.idleTimer = null;
        const requestFrame = this.buffer;
        this.buffer = Buffer.alloc(0);
        if (requestFrame.length === 0) {
            return;
        }

        this.core.handleRequest(requestFrame, (error, responseFrame) => {
            if (error) {
                this.emit("error", error);
                return;
            }
            if (responseFrame && this.serial.isOpen) {
                this.serial.write(responseFrame);
            }
        });
    }
}

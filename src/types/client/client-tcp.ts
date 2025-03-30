

import net from "net";

import {
    EventEmitter
} from "events";

import { crc16 } from "../utils/crc16";

import {
    IModbusReadRequest,
    IModbusWriteRequest,
    ModbusTCPUnitID,
    ModbusTCPTransactionID,
    MODBUS_TCP_CONSTANT_MAX_TRANSACTIONS,
    MODBUS_TCP_CONSTANT_CRC_LENGTH,
    MODBUS_TCP_CONSTANT_MIN_MBAP_LENGTH,
    MODBUS_TCP_CONSTANT_MIN_DATA_LENGTH,
    IModbusReadRequest_Result
} from "../protocol/modbus-tcp";

export interface IModbusClientTCPBase extends IModbusReadRequest, IModbusWriteRequest {
    disconnect(): Promise<boolean>;
}

export interface IModbusTCPClientOptions {
    host: string;
    port: number;
    /**
     * Range 1-255
     */
    unit_id?: ModbusTCPUnitID;
    timeout?: number;
    autoReconnect?: boolean;
    reconnectTimeout?: number;
    maxRetries?: number;
    retryInterval?: number;
}

type SocketConOptions = net.SocketConstructorOpts;
type SocketConnectOptions = net.TcpSocketConnectOpts;
export type ModbusTCPClient_SocketOptions = Partial<SocketConOptions & SocketConnectOptions>;


/**
 * @deprecated
 */
export interface IModbusTCPClientSocketOptions_SocketOptionsItem {
    fd: number;
    allowHalfOpen?: boolean;
    readable?: boolean;
    writeable?: boolean;
    signal?: AbortSignal;
};

/**
 * @deprecated
 */
export interface IModbusTCPClientSocketOptions {
    port?: number;
    localAddress?: string;
    family?: 0 | 4 | 6;
    timeout?: number;
    socket?: net.Socket;
    socketOptions?: IModbusTCPClientSocketOptions_SocketOptionsItem;
}

/**
 * @deprecated
 */
export type ModbusTCPClientSocketOptions = IModbusTCPClientSocketOptions & net.TcpSocketConnectOpts;



export interface IModbusTCPClient extends IModbusClientTCPBase {
}

export abstract class AbsModbusClientTCP {
    protected abstract net_socket: net.Socket;
    protected abstract transaction_id: ModbusTCPTransactionID;
    /**
     * Default Unit ID
     */
    protected abstract primary_unit_id: ModbusTCPUnitID;

    /**
     * If true, the client is connecting to the server, but not yet connected
     * If false, the client is not connecting to the server
     */
    protected abstract is_connecting: boolean;

    /**
     * If true, the client is connected to the server
     * If false, the client is not connected to the server
     */
    protected abstract is_connected: boolean;

    protected abstract response_emitter: EventEmitter;
}


export class ModbusClientTCP extends AbsModbusClientTCP implements IModbusTCPClient {

    public static connect(client_options: IModbusTCPClientOptions, socket_options?: ModbusTCPClient_SocketOptions): ModbusClientTCP {
        const _socket_options: ModbusTCPClient_SocketOptions = {
            ...socket_options,
            ...client_options
        }

        return new ModbusClientTCP(client_options, _socket_options);
    }

    protected readonly net_socket: net.Socket;
    protected transaction_id: ModbusTCPTransactionID = 1;
    protected primary_unit_id: ModbusTCPUnitID;

    protected is_connected: boolean = false;
    protected is_connecting: boolean = false;

    protected readonly response_emitter: EventEmitter = new EventEmitter();

    private constructor(client_options: IModbusTCPClientOptions, socket_options: ModbusTCPClient_SocketOptions) {
        super();
        this.response_emitter.setMaxListeners(0);
        this.primary_unit_id = client_options?.unit_id || 1;
        this.net_socket = new net.Socket(socket_options);
        this.net_socket.connect({
            ...{
                host: client_options.host,
                port: client_options.port
            },
            ...socket_options
        });
        this.is_connecting = true;

        this.net_socket.on("data", (data) => {
            /**
             * @note
             * here need better implementation
             */
            let buffer;
            let crc;
            let length;

            // check data length
            while (data.length > MODBUS_TCP_CONSTANT_MIN_MBAP_LENGTH) {
                // parse tcp header length
                length = data.readUInt16BE(4);

                // cut 6 bytes of mbap and copy pdu
                buffer = Buffer.alloc(length + MODBUS_TCP_CONSTANT_CRC_LENGTH);
                data.copy(buffer, 0, MODBUS_TCP_CONSTANT_MIN_MBAP_LENGTH);

                // add crc to message
                crc = crc16(buffer.slice(0, -MODBUS_TCP_CONSTANT_CRC_LENGTH));
                buffer.writeUInt16LE(crc, buffer.length - MODBUS_TCP_CONSTANT_CRC_LENGTH);
                const transaction_id = buffer.readUInt16BE(0);
                this.response_emitter.emit(`${transaction_id}-res`, buffer);
                // reset data
                data = data.slice(length + MODBUS_TCP_CONSTANT_MIN_MBAP_LENGTH);
            }
        });

        this.net_socket.on("connect", () => {
            this.is_connecting = false;
            this.is_connected = true;
        });


    }

    private send_request(data: Buffer): void {
        throw new Error("Not implemented");
        if (data.length < MODBUS_TCP_CONSTANT_MIN_DATA_LENGTH) {
            return;
        }

        // remove crc and add mbap
        const buffer = Buffer.alloc(data.length + MODBUS_TCP_CONSTANT_MIN_MBAP_LENGTH - MODBUS_TCP_CONSTANT_CRC_LENGTH);
        buffer.writeUInt16BE(this.transaction_id, 0);
        buffer.writeUInt16BE(0, 2);
        buffer.writeUInt16BE(data.length - MODBUS_TCP_CONSTANT_CRC_LENGTH, 4);
        data.copy(buffer, MODBUS_TCP_CONSTANT_MIN_MBAP_LENGTH);

        this.net_socket.write(buffer);

        this.transaction_id = ((this.transaction_id + 1) % MODBUS_TCP_CONSTANT_MAX_TRANSACTIONS) as ModbusTCPTransactionID;
    }

    public disconnect(): Promise<boolean> {
        if (!this.is_connected) {
            this.net_socket.destroy();
            this.is_connected = false;
        }
        return Promise.resolve(true);
    }

    public read_coils(address: number, quantity: number, unit_id?: ModbusTCPUnitID): Promise<IModbusReadRequest_Result<Array<boolean>>> {
        throw new Error("Not implemented");
        this.send_request(Buffer.from([]));
        const transaction_id = this.transaction_id;
        return new Promise((resolve, reject) => {
            this.response_emitter.once(`${transaction_id}-res`, (data: Buffer) => {
                return resolve({
                    data: [...data].map(x => x !== 0),
                    buffer: data
                })
            });
        });

    }

    /**
     *
     * @param address
     * @param quantity
     * @param unit_id
     * @returns
     */
    public read_discrete_inputs(address: number, quantity: number, unit_id?: ModbusTCPUnitID): Promise<IModbusReadRequest_Result<Array<boolean>>> {
        throw new Error("Not implemented");
        return Promise.resolve({
            data: [],
            buffer: Buffer.from([])
        });
    }

    /**
     *
     * @param address
     * @param quantity
     * @param unit_id
     * @returns
     */
    public read_holding_registers(address: number, quantity: number, unit_id?: ModbusTCPUnitID): Promise<IModbusReadRequest_Result<Array<number>>> {
        throw new Error("Not implemented");
        return Promise.resolve({
            data: [],
            buffer: Buffer.from([])
        });
    }

    public read_input_registers(address: number, quantity: number, unit_id?: ModbusTCPUnitID): Promise<IModbusReadRequest_Result<Array<number>>> {
        throw new Error("Not implemented");
        return Promise.resolve({
            data: [],
            buffer: Buffer.from([])
        });
    }

    public write_coil(address: number, state: boolean, unit_id?: ModbusTCPUnitID): Promise<boolean> {
        throw new Error("Not implemented");
        return Promise.resolve(false);
    }

    public write_coils(address: number, states: Array<boolean>, unit_id?: ModbusTCPUnitID): Promise<boolean> {
        throw new Error("Not implemented");
        return Promise.resolve(false);
    }

    public write_register(address: number, value: number, unit_id?: ModbusTCPUnitID): Promise<boolean> {
        throw new Error("Not implemented");
        return Promise.resolve(false);
    }

    public write_registers(address: number, values: Array<number>, unit_id?: ModbusTCPUnitID): Promise<boolean> {
        throw new Error("Not implemented");
        return Promise.resolve(false);
    }

}

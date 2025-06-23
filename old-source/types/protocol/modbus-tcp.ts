export const MODBUS_TCP_CONSTANT_MAX_TRANSACTIONS = 256;
export const MODBUS_TCP_CONSTANT_MIN_DATA_LENGTH = 6;
export const MODBUS_TCP_CONSTANT_MIN_MBAP_LENGTH = 6;
export const MODBUS_TCP_CONSTANT_CRC_LENGTH = 2;

export interface IModbusReadRequest_Result<T> {
    data: T;
    buffer: Buffer;
}

type Enumerate<N extends number, Acc extends number[] = []> = Acc['length'] extends N
  ? Acc[number]
  : Enumerate<N, [...Acc, Acc['length']]>

type IntRange<F extends number, T extends number> = Exclude<Enumerate<T>, Enumerate<F>>

export type ModbusTCPUnitID = IntRange<1, 256>;
export type ModbusTCPTransactionID = IntRange<1, typeof MODBUS_TCP_CONSTANT_MAX_TRANSACTIONS>;

export interface IModbusReadRequest {
    read_coils(address: number, quantity: number, unit_id?: ModbusTCPUnitID): Promise<IModbusReadRequest_Result<Array<boolean>>>;
    read_discrete_inputs(address: number, quantity: number, unit_id?: ModbusTCPUnitID): Promise<IModbusReadRequest_Result<Array<boolean>>>;
    read_holding_registers (address: number, quantity: number, unit_id?: ModbusTCPUnitID): Promise<IModbusReadRequest_Result<Array<number>>>;
    read_input_registers (address: number, quantity: number, unit_id?: ModbusTCPUnitID): Promise<IModbusReadRequest_Result<Array<number>>>;
}

export interface IModbusWriteRequest {
    write_coil(address: number, state: boolean, unit_id?: ModbusTCPUnitID): Promise<boolean>;
    write_coils(address: number, states: Array<boolean>, unit_id?: ModbusTCPUnitID): Promise<boolean>;
    write_register(address: number, value: number, unit_id?: ModbusTCPUnitID): Promise<boolean>;
    write_registers(address: number, values: Array<number>, unit_id?: ModbusTCPUnitID): Promise<boolean>;
}

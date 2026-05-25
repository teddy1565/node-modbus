/**
 * Modbus protocol constants and enumerations.
 *
 * Values are taken from node-modbus-serial and the official Modbus
 * Application Protocol V1.1b (see notes 01, 08, 16).
 */

/** Modbus function codes supported by this library (matches node-modbus-serial). */
export enum ModbusFunctionCode {
    READ_COILS = 0x01, // FC1
    READ_DISCRETE_INPUTS = 0x02, // FC2
    READ_HOLDING_REGISTERS = 0x03, // FC3
    READ_INPUT_REGISTERS = 0x04, // FC4
    WRITE_SINGLE_COIL = 0x05, // FC5
    WRITE_SINGLE_REGISTER = 0x06, // FC6
    WRITE_MULTIPLE_COILS = 0x0f, // FC15
    WRITE_MULTIPLE_REGISTERS = 0x10, // FC16
    REPORT_SERVER_ID = 0x11, // FC17
    READ_FILE_RECORDS = 0x14, // FC20
    MASK_WRITE_REGISTER = 0x16, // FC22
    READ_WRITE_MULTIPLE_REGISTERS = 0x17, // FC23
    READ_DEVICE_IDENTIFICATION = 0x2b, // FC43 (MEI)
}

/** Exception responses set the high bit of the function code: exceptionFC = 0x80 | FC. */
export const EXCEPTION_BIT = 0x80;

/** Modbus exception codes. */
export enum ModbusExceptionCode {
    ILLEGAL_FUNCTION = 0x01,
    ILLEGAL_DATA_ADDRESS = 0x02,
    ILLEGAL_DATA_VALUE = 0x03,
    SLAVE_DEVICE_FAILURE = 0x04,
    ACKNOWLEDGE = 0x05,
    SLAVE_DEVICE_BUSY = 0x06,
    NEGATIVE_ACKNOWLEDGE = 0x07,
    MEMORY_PARITY_ERROR = 0x08,
    GATEWAY_PATH_UNAVAILABLE = 0x0a,
    GATEWAY_TARGET_DEVICE_FAILED = 0x0b,
}

/**
 * Exception code -> human readable message.
 * Index 0..11; verbatim from node-modbus-serial `modbusErrorMessages`
 * (see note 04-client-core.md section 9).
 */
export const modbusErrorMessages: Readonly<Record<number, string>> = Object.freeze({
    0: "Unknown error",
    1: "Illegal function (device does not support this read/write function)",
    2: "Illegal data address (register not supported by device)",
    3: "Illegal data value (value cannot be written to this register)",
    4: "Slave device failure (device reports internal error)",
    5: "Acknowledge (requested data will be available later)",
    6: "Slave device busy (retry request again later)",
    7: "Negative acknowledge (slave device cannot perform programming functions)",
    8: "Memory parity error (slave device detected a parity error in memory)",
    9: "Unknown error",
    10: "Gateway path unavailable (misconfigured gateway)",
    11: "Gateway target device failed to respond (retry request again later)",
});

/** MEI type for FC43 Read Device Identification. */
export const MEI_TYPE_DEVICE_IDENTIFICATION = 0x0e;

/**
 * Whether `code` is a custom/user-defined function code.
 * node-modbus-serial treats FC65-72 and FC100-110 as custom.
 */
export function isCustomFunctionCode(code: number): boolean {
    return (code >= 65 && code <= 72) || (code >= 100 && code <= 110);
}

// ── Framing constants ──────────────────────────────────────────────

/** Default Modbus TCP port. */
export const MODBUS_TCP_PORT = 502;

/** Default Telnet (RTU-over-Telnet) port. */
export const MODBUS_TELNET_PORT = 2217;

/** C701 UDP-to-serial bridge port. */
export const C701_PORT = 0x7002;

/** MBAP prefix length used internally (Transaction + Protocol + Length); UnitID counted separately. */
export const MBAP_LENGTH = 6;

/** Full MBAP header length per the official spec (includes Unit Identifier). */
export const MBAP_HEADER_LENGTH = 7;

/** RTU CRC16 length in bytes. */
export const CRC_LENGTH = 2;

/** ASCII LRC length in bytes. */
export const LRC_LENGTH = 1;

/** Smallest meaningful RTU frame size. */
export const MIN_MODBUS_RTU_FRAME_LENGTH = 5;

/** Exception response frame length: address + (0x80|FC) + code + CRC16. */
export const EXCEPTION_FRAME_LENGTH = 5;

/** TcpPort transaction id modulus. */
export const MAX_TRANSACTIONS_TCP = 256;

/** TcpRTUBufferedPort transaction id modulus. */
export const MAX_TRANSACTIONS_TCP_RTU = 64;

/** Max internal receive-buffer length for buffered ports. */
export const MAX_BUFFER_LENGTH = 256;

/** PDU maximum length per the official spec. */
export const MAX_PDU_LENGTH = 253;

/** RTU ADU maximum length (address + PDU + CRC). */
export const MAX_RTU_ADU_LENGTH = 256;

/** TCP ADU maximum length (MBAP header + PDU). */
export const MAX_TCP_ADU_LENGTH = 260;

// ── FC23 register-count limits ─────────────────────────────────────
//
// node-modbus-serial uses 123 for the write limit; the official spec
// V1.1b says 121 (0x0079). This is an intentional deviation — we match
// the serial implementation (see note 16-spec-gap-analysis.md).

/** FC23 maximum registers to read. */
export const MAX_READ_REGISTERS_FC23 = 125;

/** FC23 maximum registers to write (serial-impl value; spec says 121). */
export const MAX_WRITE_REGISTERS_FC23 = 123;

/** ASCII frame start-of-slave-frame character (":"). */
export const ASCII_START_CHAR = 0x3a;

/** ASCII frame end delimiter (CR LF). */
export const ASCII_END_DELIMITER = "\r\n";

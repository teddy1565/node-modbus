
export function lrc(buffer: Buffer): number {
    let lrc = 0;
    for (let i = 0; i < buffer.length; i++) {
        lrc += buffer[i] & 0xFF;
    }

    return ((lrc ^ 0xFF) + 1) & 0xFF;
}
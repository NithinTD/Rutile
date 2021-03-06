import { toHex } from "../utils/hexUtils";

export class Memory {
    buffer: SharedArrayBuffer = null;

    constructor(raw: SharedArrayBuffer) {
        this.buffer = raw;
    }

    write(offset: number, length: number, value: ArrayLike<number>) {
        // Grow if needed, need to rework since we are using shared buffers
        // if (this._raw.buffer.byteLength < length) {
        //     const diff = length - this._raw.buffer.byteLength
        //     const pageSize = 64 * 1024
        //     this._raw.grow(Math.ceil(diff / pageSize))
        // }

        const m = new Uint8Array(this.buffer, offset, length);
        m.set(value);
    }

    read(offset: number, length: number) {
        const data = new Uint8Array(this.buffer, offset, length);

        return data;
    }
}

export function synchroniseMemoryToBuffer(memory: WebAssembly.Memory, buffer: SharedArrayBuffer) {
    const ui8Shared = new Uint8Array(buffer);
    const ui8Memory = new Uint8Array(memory.buffer);

    for (let index = 0; index < ui8Memory.length; index++) {
        Atomics.store(ui8Shared, index, ui8Memory[index]);
    }
}

export function synchroniseBufferToMemory(memory: WebAssembly.Memory, buffer: SharedArrayBuffer) {
    const ui8Shared = new Uint8Array(buffer);
    const ui8Memory = new Uint8Array(memory.buffer);

    for (let index = 0; index < ui8Shared.length; index++) {
        ui8Memory[index] = Atomics.load(ui8Shared, index);
    }
}

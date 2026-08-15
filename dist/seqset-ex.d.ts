export interface SeqSetExTransport {
    request(op: "seqsetex_size" | "seqsetex_is_empty" | "seqsetex_remaining" | "seqsetex_next_chunk" | "seqsetex_release", payload: unknown): Promise<unknown>;
    isClosed(): boolean;
}
export declare class LfeSeqSetEx {
    #private;
    constructor(transport: SeqSetExTransport, handleId: number);
    size(): Promise<number>;
    isEmpty(): Promise<boolean>;
    remaining(): Promise<number>;
    nextChunk(maxItems: number): Promise<bigint[]>;
    release(): Promise<void>;
}

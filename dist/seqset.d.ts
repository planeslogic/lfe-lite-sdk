export interface SeqSetTransport {
    request(op: "seqset_size" | "seqset_is_empty" | "seqset_has" | "seqset_first" | "seqset_release", payload: unknown): Promise<unknown>;
    isClosed(): boolean;
}
export declare class LfeSeqSet {
    #private;
    constructor(transport: SeqSetTransport, handleId: number);
    size(): Promise<number>;
    isEmpty(): Promise<boolean>;
    has(seq: bigint): Promise<boolean>;
    first(limit: number): Promise<bigint[]>;
    release(): Promise<void>;
}

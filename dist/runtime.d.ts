import { LfeSeqSet } from "./seqset.js";
import { LfeSeqSetEx } from "./seqset-ex.js";
import type { LfeBatch, LfeLiteLicenseState, LfeLiteOptions, LogicalDefinition, LogicalRecord, Query, ReconstructionState, ResolveSeqBoundary } from "./types.js";
export declare class LfeLite {
    #private;
    private constructor();
    static create(options?: LfeLiteOptions): Promise<LfeLite>;
    licenseState(): Promise<LfeLiteLicenseState>;
    setLicense(license: string | null): Promise<LfeLiteLicenseState>;
    define(definition: LogicalDefinition): Promise<void>;
    add(seq: bigint, logical: LogicalRecord): Promise<void>;
    addBatch(batch: LfeBatch): Promise<number>;
    update(seq: bigint, patch: LogicalRecord): Promise<void>;
    delete(seq: bigint): Promise<void>;
    resolve(query: Query): Promise<LfeSeqSet>;
    resolveEx(query: Query): Promise<LfeSeqSetEx>;
    resolveBounded(query: Query, boundary: ResolveSeqBoundary): Promise<LfeSeqSet>;
    projectionValidFromSeq(): Promise<bigint>;
    purgeBefore(seqExclusive: bigint): Promise<bigint>;
    beginReconstruction(startSeq: bigint): Promise<void>;
    reconstructionAddBatch(batch: LfeBatch): Promise<number>;
    reconstructionState(): Promise<ReconstructionState | null>;
    publishReconstruction(): Promise<bigint>;
    abortReconstruction(): Promise<boolean>;
    close(): Promise<void>;
}

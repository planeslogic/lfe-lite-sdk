export declare class LfeLiteError extends Error {
    readonly code: string;
    readonly operation?: string;
    constructor(code: string, message: string, operation?: string);
}

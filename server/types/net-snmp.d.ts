declare module 'net-snmp' {
  export const Version1: number;
  export const Version2c: number;
  export const Version3: number;

  export interface SessionOptions {
    port?: number;
    version?: number;
    timeout?: number;
    retries?: number;
  }

  export interface VarBind {
    oid: string;
    type: number;
    value: number | string | Buffer | null;
  }

  export function createSession(target: string, community: string, options?: SessionOptions): Session;
  export function isVarbindError(varbind: VarBind): boolean;

  export class Session {
    get(oids: string[], callback: (error: Error | null, varbinds: VarBind[]) => void): void;
    getNext(oids: string[], callback: (error: Error | null, varbinds: VarBind[]) => void): void;
    getBulk(oids: string[], nonRepeaters: number, maxRepetitions: number, callback: (error: Error | null, varbinds: VarBind[]) => void): void;
    close(): void;
  }
}

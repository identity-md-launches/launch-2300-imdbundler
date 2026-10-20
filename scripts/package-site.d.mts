/// <reference types="node" />
export interface SitePackage {
  cid: string;
  car: Buffer;
  root: Buffer;
  blocks: number;
}
export function varint(value: number | bigint): Buffer;
export function base32(bytes: Uint8Array): string;
export function packageDirectory(directory: string): Promise<SitePackage>;
export function buildSite(source?: string, output?: string): Promise<SitePackage>;

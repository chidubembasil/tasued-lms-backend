
declare module 'clamscan' {
  interface ClamScanResult {
    isInfected: boolean | null;
    viruses: string[];
    file?: string;
  }

  interface ClamScanOptions {
    preference?: string;
    clamdscan?: {
      host?: string;
      port?: number;
      timeout?: number;
      active?: boolean;
      localFallback?: boolean;
    };
  }

  class NodeClam {
    init(options?: ClamScanOptions): Promise<{
      isInfected(
        filePath: string,
      ): Promise<ClamScanResult>;
    }>;
  }

  export default NodeClam;
}

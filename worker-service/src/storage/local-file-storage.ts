import fs from 'fs';
import path from 'path';

export class LocalFileStorage {
    private basePath: string;

    constructor(basePath: string) {
        this.basePath = path.resolve(basePath);
    }

    async saveRawDocument(sourceId: string, id: string, content: string | Buffer, metadata?: Record<string, any>): Promise<string> {
        const now = new Date();
        const year = metadata?.year || now.getUTCFullYear().toString();
        const monthNumeric = now.getUTCMonth() + 1;
        const month = metadata?.month || monthNumeric.toString().padStart(2, '0');
        const day = now.getUTCDate().toString().padStart(2, '0');

        let destDir = path.join(this.basePath, sourceId, year, month, day);

        // Optional: Custom directory structure override
        if (metadata?.customDir) {
            destDir = path.join(this.basePath, sourceId, metadata.customDir);
            // Custom subdirectory override (e.g. src-news/<customSubDir>/)
        } else if (metadata?.customSubDir) {
            destDir = path.join(this.basePath, sourceId, metadata.customSubDir);
            // Optional: Singleton mode (save directly to source directory)
        } else if (metadata?.isSingleton) {
            destDir = path.join(this.basePath, sourceId);
            // Use company folder if available (e.g. egazette: src-egazette/<company>/<year>/<month>)
        } else if (metadata?.company) {
            destDir = path.join(this.basePath, sourceId, metadata.company, year, month);
            // Use agency folder if available (e.g. data-gov-sg: src-data-gov-sg/<year>/<month>/<agency>)
        } else if (metadata?.agency) {
            destDir = path.join(this.basePath, sourceId, year, month, metadata.agency);
        }

        await fs.promises.mkdir(destDir, { recursive: true });

        const isBuffer = Buffer.isBuffer(content);
        const defaultExt = isBuffer ? 'pdf' : 'json';
        const filename = metadata?.filename || `${id}.${defaultExt}`;
        const destPath = path.join(destDir, filename);

        if (isBuffer) {
            await fs.promises.writeFile(destPath, content);
        } else {
            await fs.promises.writeFile(destPath, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf-8');
        }

        return destPath;
    }
}

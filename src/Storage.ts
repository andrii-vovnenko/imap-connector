import fs from 'fs';
import path from 'path';

export interface IStorage {
  saveEmail(filePath: string, emailContent: string): void;
  saveAttachment(filePath: string, filename: string, attachment: Buffer): void;
}

export class Storage implements IStorage {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;

    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Save email to storage
   * @param filePath - path to save email
   * @param emailContent - text/html email content
   */
  saveEmail(filePath: string, emailContent: string) {
    this._saveFile(filePath, 'email.html', emailContent);
  }

  /**
   * Save attachment to storage
   * @param filePath - path to save attachment
   * @param filename - filename to save attachment
   * @param attachment - attachment content Buffer
   */
  saveAttachment(filePath: string, filename: string, attachment: Buffer) {
    this._saveFile(path.join(filePath, 'attachments'), filename, attachment);
  }

  _saveFile(filePath: string, filename: string, content: string | Buffer) {
    const _path = path.join(this.basePath, filePath);
    if (!fs.existsSync(_path)) {
      fs.mkdirSync(_path, { recursive: true });
    }

    fs.writeFileSync(path.join(_path, filename), content);
  }
};
import * as fs from "fs";
import * as path from "path";

export interface TokenData {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  expiry_date?: number;
  id_token?: string;
}

export interface AccountRecord {
  alias: string;
  email: string;
  token: TokenData;
}

export interface AccountSummary {
  alias: string;
  email: string;
}

export class AccountStore {
  constructor(private readonly accountsDir: string) {}

  private fileFor(alias: string): string {
    return path.join(this.accountsDir, `${alias}.json`);
  }

  list(): AccountSummary[] {
    if (!fs.existsSync(this.accountsDir)) return [];
    return fs
      .readdirSync(this.accountsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const rec = JSON.parse(fs.readFileSync(path.join(this.accountsDir, f), "utf-8")) as AccountRecord;
        return { alias: rec.alias, email: rec.email };
      });
  }

  get(alias: string): AccountRecord | null {
    const p = this.fileFor(alias);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as AccountRecord;
  }

  has(alias: string): boolean {
    return fs.existsSync(this.fileFor(alias));
  }

  add(record: AccountRecord): void {
    fs.mkdirSync(this.accountsDir, { recursive: true });
    fs.writeFileSync(this.fileFor(record.alias), JSON.stringify(record, null, 2));
  }

  remove(alias: string): void {
    const p = this.fileFor(alias);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  saveToken(alias: string, token: TokenData): void {
    const rec = this.get(alias);
    if (!rec) throw new Error(`No such account: ${alias}`);
    rec.token = token;
    this.add(rec);
  }
}

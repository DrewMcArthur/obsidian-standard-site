import { Client, ok } from "@atcute/client";
import type { } from "@atcute/atproto";
import type { } from "@atcute/standard-site";
import type { Did } from "@atcute/lexicons/syntax";
import { createOAuthClient, parseDid, type OAuthConfig, type OAuthStoreData } from "./oauth";
import type { DocumentRecord, PublicationRecord, BlobRef } from "./types";

export interface RecordRef {
	uri: string;
	cid: string;
}

export interface ListedRecord {
	uri: string;
	cid: string;
	value: any;
}

export class StandardSiteClient {
	private rpc!: Client;
	private _did!: Did;
	private _pdsUrl!: string;

	get did(): Did {
		if (!this._did) {
			throw new Error("StandardSiteClient is not authenticated. Connect ATProto OAuth before accessing did.");
		}
		return this._did;
	}

	get pdsUrl(): string {
		return this._pdsUrl;
	}

	async restoreOAuthSession(did: string, store: OAuthStoreData, save: () => Promise<void>, config: OAuthConfig): Promise<void> {
		const oauthClient = await createOAuthClient(store, save, config);
		const session = await oauthClient.restore(did);
		const tokenInfo = await session.getTokenInfo("auto");
		this.rpc = new Client({ handler: (pathname, init) => session.fetchHandler(pathname, init) });
		this._did = parseDid(session.did);
		this._pdsUrl = tokenInfo.aud;
	}

	async createPublication(record: PublicationRecord): Promise<RecordRef> {
		const { uri, cid } = await ok(this.rpc.post("com.atproto.repo.createRecord", {
			input: {
				repo: this.did,
				collection: "site.standard.publication",
				record: record as unknown as Record<string, unknown>,
			},
		}));
		return { uri, cid };
	}

	async updatePublication(rkey: string, record: PublicationRecord): Promise<RecordRef> {
		const { uri, cid } = await ok(this.rpc.post("com.atproto.repo.putRecord", {
			input: {
				repo: this.did,
				collection: "site.standard.publication",
				rkey,
				record: record as unknown as Record<string, unknown>,
			},
		}));
		return { uri, cid };
	}

	async getPublication(rkey: string): Promise<ListedRecord | null> {
		try {
			const data = await ok(this.rpc.get("com.atproto.repo.getRecord", {
				params: {
					repo: this.did,
					collection: "site.standard.publication",
					rkey,
				},
			}));
			return { uri: data.uri, cid: data.cid ?? "", value: data.value };
		} catch (err: any) {
			if (err?.name === "ClientResponseError" && (err.status === 404 || err.error === "RecordNotFound" || err.error === "InvalidRequest" || err.message?.includes("Record not found"))) {
				return null;
			}
			throw err;
		}
	}

	async listPublications(): Promise<ListedRecord[]> {
		const allRecords: ListedRecord[] = [];
		let cursor: string | undefined;

		do {
			const data = await ok(this.rpc.get("com.atproto.repo.listRecords", {
				params: {
					repo: this.did,
					collection: "site.standard.publication",
					limit: 100,
					cursor,
				},
			}));
			for (const record of data.records) {
				allRecords.push({
					uri: record.uri,
					cid: record.cid,
					value: record.value,
				});
			}
			cursor = data.cursor;
		} while (cursor);

		return allRecords;
	}

	async createDocument(record: DocumentRecord): Promise<RecordRef> {
		const { uri, cid } = await ok(this.rpc.post("com.atproto.repo.createRecord", {
			input: {
				repo: this.did,
				collection: "site.standard.document",
				record: record as unknown as Record<string, unknown>,
			},
		}));
		return { uri, cid };
	}

	async updateDocument(rkey: string, record: DocumentRecord): Promise<RecordRef> {
		const { uri, cid } = await ok(this.rpc.post("com.atproto.repo.putRecord", {
			input: {
				repo: this.did,
				collection: "site.standard.document",
				rkey,
				record: record as unknown as Record<string, unknown>,
			},
		}));
		return { uri, cid };
	}

	async deleteDocument(rkey: string): Promise<void> {
		await ok(this.rpc.post("com.atproto.repo.deleteRecord", {
			input: {
				repo: this.did,
				collection: "site.standard.document",
				rkey,
			},
		}));
	}

	async getDocument(rkey: string): Promise<ListedRecord | null> {
		try {
			const data = await ok(this.rpc.get("com.atproto.repo.getRecord", {
				params: {
					repo: this.did,
					collection: "site.standard.document",
					rkey,
				},
			}));
			return { uri: data.uri, cid: data.cid ?? "", value: data.value };
		} catch (err: any) {
			if (err?.name === "ClientResponseError" && (err.status === 404 || err.error === "RecordNotFound" || err.error === "InvalidRequest" || err.message?.includes("Record not found"))) {
				return null;
			}
			throw err;
		}
	}

	async listDocuments(): Promise<ListedRecord[]> {
		const allRecords: ListedRecord[] = [];
		let cursor: string | undefined;

		do {
			const data = await ok(this.rpc.get("com.atproto.repo.listRecords", {
				params: {
					repo: this.did,
					collection: "site.standard.document",
					limit: 100,
					cursor,
				},
			}));
			for (const record of data.records) {
				allRecords.push({
					uri: record.uri,
					cid: record.cid,
					value: record.value,
				});
			}
			cursor = data.cursor;
		} while (cursor);

		return allRecords;
	}

	async uploadBlob(data: Uint8Array, mimeType: string): Promise<BlobRef> {
		const result = await ok(this.rpc.post("com.atproto.repo.uploadBlob", {
			input: data,
			headers: { "content-type": mimeType },
		}));
		return result.blob as unknown as BlobRef;
	}

	extractRkey(uri: string): string {
		const parts = uri.split("/");
		return parts[parts.length - 1] ?? "";
	}
}

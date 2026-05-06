import { Client, ok } from "@atcute/client";
import type { } from "@atcute/atproto";
import type { } from "@atcute/standard-site";
import type { Did } from "@atcute/lexicons/syntax";
import {
	NodeOAuthClient,
	buildAtprotoLoopbackClientMetadata,
	requestLocalLock,
	type NodeSavedSession,
	type NodeSavedState,
} from "@atproto/oauth-client-node";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
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

export interface StoredOAuthState {
	createdAt: number;
	value: NodeSavedState;
}

export interface OAuthStoreData {
	oauthSessions: Record<string, NodeSavedSession>;
	oauthStates: Record<string, StoredOAuthState>;
}

export interface OAuthConfig {
	oauthClientId?: string;
	oauthRedirectUri?: string;
	oauthLoopbackPort?: number;
	oauthAllowHttp?: boolean;
}

export interface OAuthLoginFlow {
	authorizationUrl: URL;
	redirectUri: string;
	finished: Promise<OAuthLoginResult>;
	cancel(): void;
}

export interface OAuthLoginResult {
	did: Did;
}

export const DEFAULT_OAUTH_LOOPBACK_PORT = 45231;
export const OAUTH_CALLBACK_PATH = "/standard-site-oauth-callback";
export const OAUTH_SCOPE = "atproto repo:site.standard.publication repo:site.standard.document blob:image/*";
const OAUTH_STATE_TTL_MS = 60 * 60 * 1000;

export function getOAuthRedirectUri(config: OAuthConfig): string {
	return config.oauthRedirectUri?.trim() || `http://127.0.0.1:${config.oauthLoopbackPort || DEFAULT_OAUTH_LOOPBACK_PORT}${OAUTH_CALLBACK_PATH}`;
}

export function getOAuthClientId(config: OAuthConfig): string {
	const redirectUri = getOAuthRedirectUri(config);
	return config.oauthClientId?.trim() || buildAtprotoLoopbackClientMetadata({
		redirect_uris: [redirectUri],
		scope: OAUTH_SCOPE,
	}).client_id;
}

function ensureOAuthStore(store: OAuthStoreData): void {
	store.oauthSessions ??= {};
	store.oauthStates ??= {};
}

function createSessionStore(store: OAuthStoreData, save: () => Promise<void>) {
	return {
		async get(key: string) {
			ensureOAuthStore(store);
			return store.oauthSessions[key];
		},
		async set(key: string, value: NodeSavedSession) {
			ensureOAuthStore(store);
			store.oauthSessions[key] = value;
			await save();
		},
		async del(key: string) {
			ensureOAuthStore(store);
			delete store.oauthSessions[key];
			await save();
		},
		async clear() {
			store.oauthSessions = {};
			await save();
		},
	};
}

function pruneExpiredStates(store: OAuthStoreData): void {
	const cutoff = Date.now() - OAUTH_STATE_TTL_MS;
	for (const [key, entry] of Object.entries(store.oauthStates)) {
		if (!entry || entry.createdAt < cutoff) {
			delete store.oauthStates[key];
		}
	}
}

function createStateStore(store: OAuthStoreData, save: () => Promise<void>) {
	return {
		async get(key: string) {
			ensureOAuthStore(store);
			pruneExpiredStates(store);
			const entry = store.oauthStates[key];
			return entry?.value;
		},
		async set(key: string, value: NodeSavedState) {
			ensureOAuthStore(store);
			pruneExpiredStates(store);
			store.oauthStates[key] = { createdAt: Date.now(), value };
			await save();
		},
		async del(key: string) {
			ensureOAuthStore(store);
			delete store.oauthStates[key];
			await save();
		},
		async clear() {
			store.oauthStates = {};
			await save();
		},
	};
}

export async function createOAuthClient(store: OAuthStoreData, save: () => Promise<void>, config: OAuthConfig): Promise<NodeOAuthClient> {
	ensureOAuthStore(store);
	const clientId = getOAuthClientId(config);
	const redirectUri = getOAuthRedirectUri(config);
	const isLoopbackClient = clientId.startsWith("http://localhost");
	const clientMetadata = isLoopbackClient
		? buildAtprotoLoopbackClientMetadata({ redirect_uris: [redirectUri], scope: OAUTH_SCOPE })
		: await NodeOAuthClient.fetchMetadata({ clientId: clientId as any });

	return new NodeOAuthClient({
		clientMetadata,
		stateStore: createStateStore(store, save),
		sessionStore: createSessionStore(store, save),
		requestLock: requestLocalLock,
		allowHttp: config.oauthAllowHttp || isLoopbackClient,
	});
}

export async function startOAuthLoginFlow(
	identifier: string,
	store: OAuthStoreData,
	save: () => Promise<void>,
	config: OAuthConfig,
): Promise<OAuthLoginFlow> {
	const redirectUri = getOAuthRedirectUri(config);
	const callback = await listenForOAuthCallback(redirectUri);
	const oauthClient = await createOAuthClient(store, save, config);

	try {
		const authorizationUrl = await oauthClient.authorize(identifier, { redirect_uri: redirectUri as any });
		const finished = callback.params.then(async (params) => {
			const { session } = await oauthClient.callback(params, { redirect_uri: redirectUri as any });
			return { did: session.did as Did };
		});

		return {
			authorizationUrl,
			redirectUri,
			finished,
			cancel: callback.cancel,
		};
	} catch (err) {
		callback.cancel();
		throw err;
	}
}

function listenForOAuthCallback(redirectUri: string): Promise<{ params: Promise<URLSearchParams>; cancel(): void }> {
	const url = new URL(redirectUri);
	if (url.protocol !== "http:" || (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]")) {
		throw new Error("This plugin can only receive OAuth callbacks on a loopback redirect URI such as http://127.0.0.1:45231/standard-site-oauth-callback.");
	}

	const port = Number(url.port || "80");
	const listenHost = url.hostname === "[::1]" ? "::1" : url.hostname;
	let server: Server | null = null;
	let timeout: ReturnType<typeof setTimeout> | null = null;
	let resolveParams: (params: URLSearchParams) => void;
	let rejectParams: (err: Error) => void;
	const params = new Promise<URLSearchParams>((resolve, reject) => {
		resolveParams = resolve;
		rejectParams = reject;
	});

	const close = () => {
		if (timeout) {
			clearTimeout(timeout);
			timeout = null;
		}
		if (server?.listening) {
			server.close();
		}
		server = null;
	};

	server = createServer((req, res) => {
		const requestUrl = new URL(req.url || "/", redirectUri);
		if (requestUrl.pathname !== url.pathname) {
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			res.end("Not found");
			return;
		}

		res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
		res.end("<!doctype html><title>Standard.site OAuth</title><p>Authentication complete. You can return to Obsidian.</p>");
		resolveParams(requestUrl.searchParams);
		close();
	});

	return new Promise((resolve, reject) => {
		server!.once("error", (err) => {
			const message = err instanceof Error ? err.message : String(err);
			rejectParams(new Error(message));
			reject(new Error(`Could not start OAuth callback listener on ${redirectUri}: ${message}`));
		});
		server!.listen(port, listenHost, () => {
			timeout = setTimeout(() => {
				rejectParams(new Error("OAuth login timed out before the callback was received."));
				close();
			}, 10 * 60 * 1000);

			const address = server!.address() as AddressInfo;
			if (address.port !== port) {
				close();
				reject(new Error(`OAuth callback listener started on unexpected port ${address.port}.`));
				return;
			}

			resolve({
				params,
				cancel() {
					rejectParams(new Error("OAuth login was cancelled."));
					close();
				},
			});
		});
	});
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
		this._did = session.did as Did;
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

import { describe, it, expect, vi, beforeEach } from "vitest";
import { StandardSiteClient } from "../src/atproto";
import type { DocumentRecord, PublicationRecord } from "../src/types";

const mockRpc = {
	get: vi.fn(),
	post: vi.fn(),
};

const mockSession = {
	did: "did:plc:testuser123",
	fetchHandler: vi.fn(),
	getTokenInfo: vi.fn().mockResolvedValue({
		aud: "https://test.pds.example",
	}),
};

const mockOAuthClient = {
	restore: vi.fn().mockResolvedValue(mockSession),
	authorize: vi.fn(),
	callback: vi.fn(),
	revoke: vi.fn(),
};

vi.mock("@atproto/oauth-client-node", () => ({
	NodeOAuthClient: vi.fn(function () { return mockOAuthClient; }),
	buildAtprotoLoopbackClientMetadata: vi.fn(({ redirect_uris, scope }) => ({
		client_id: `http://localhost/?redirect_uri=${encodeURIComponent(redirect_uris[0])}`,
		redirect_uris,
		scope,
		response_types: ["code"],
		grant_types: ["authorization_code", "refresh_token"],
		token_endpoint_auth_method: "none",
		application_type: "native",
		dpop_bound_access_tokens: true,
	})),
	requestLocalLock: vi.fn(async (_key: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@atcute/client", () => ({
	Client: vi.fn(function () { return mockRpc; }),
	ok: vi.fn((promise: any) => promise.then((r: any) => {
		if (r && typeof r === "object" && "ok" in r) {
			if (!r.ok) throw new Error(r.data?.message || "Request failed");
			return r.data;
		}
		return r;
	})),
}));

describe("StandardSiteClient", () => {
	let client: StandardSiteClient;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockOAuthClient.restore.mockResolvedValue(mockSession);
		mockSession.getTokenInfo.mockResolvedValue({ aud: "https://test.pds.example" });
		client = new StandardSiteClient();
		await client.restoreOAuthSession("did:plc:testuser123", { oauthSessions: {}, oauthStates: {} }, async () => {}, {});
	});

	describe("createDocument", () => {
		it("calls createRecord with correct collection and record", async () => {
			const doc: DocumentRecord = {
				$type: "site.standard.document",
				site: "at://did:plc:testuser123/site.standard.publication/3mc7ts3zshc2y",
				title: "Test Post",
				path: "/test-post",
				publishedAt: "2026-02-26T12:00:00.000Z",
				textContent: "test",
				content: { $type: "at.markpub.markdown", text: "test", flavor: "GFM" },
			};

			mockRpc.post.mockResolvedValue({
				ok: true,
				data: { uri: "at://did:plc:testuser123/site.standard.document/abc123", cid: "cid123" },
			});

			const result = await client.createDocument(doc);

			expect(mockRpc.post).toHaveBeenCalledWith("com.atproto.repo.createRecord", {
				input: {
					repo: "did:plc:testuser123",
					collection: "site.standard.document",
					record: doc,
				},
			});
			expect(result.uri).toBe("at://did:plc:testuser123/site.standard.document/abc123");
		});
	});

	describe("updateDocument", () => {
		it("calls putRecord with rkey", async () => {
			const doc: DocumentRecord = {
				$type: "site.standard.document",
				site: "at://did:plc:testuser123/site.standard.publication/3mc7ts3zshc2y",
				title: "Updated Post",
				path: "/test-post",
				publishedAt: "2026-02-26T12:00:00.000Z",
				textContent: "updated",
				content: { $type: "at.markpub.markdown", text: "updated", flavor: "GFM" },
			};

			mockRpc.post.mockResolvedValue({
				ok: true,
				data: { uri: "at://did:plc:testuser123/site.standard.document/abc123", cid: "cid456" },
			});

			await client.updateDocument("abc123", doc);

			expect(mockRpc.post).toHaveBeenCalledWith("com.atproto.repo.putRecord", {
				input: {
					repo: "did:plc:testuser123",
					collection: "site.standard.document",
					rkey: "abc123",
					record: doc,
				},
			});
		});
	});

	describe("deleteDocument", () => {
		it("calls deleteRecord with rkey", async () => {
			mockRpc.post.mockResolvedValue({ ok: true, data: {} });
			await client.deleteDocument("abc123");

			expect(mockRpc.post).toHaveBeenCalledWith("com.atproto.repo.deleteRecord", {
				input: {
					repo: "did:plc:testuser123",
					collection: "site.standard.document",
					rkey: "abc123",
				},
			});
		});
	});

	describe("listDocuments", () => {
		it("returns all document records", async () => {
			mockRpc.get.mockResolvedValue({
				ok: true,
				data: {
					records: [
						{
							uri: "at://did:plc:testuser123/site.standard.document/abc123",
							cid: "cid1",
							value: { title: "Post 1", path: "/post-1" },
						},
					],
					cursor: undefined,
				},
			});

			const records = await client.listDocuments();
			expect(records).toHaveLength(1);
			expect(records[0].value.title).toBe("Post 1");
		});
	});

	describe("createPublication", () => {
		it("calls createRecord without rkey", async () => {
			const pub: PublicationRecord = {
				$type: "site.standard.publication",
				url: "https://example.com",
				name: "My Blog",
			};

			mockRpc.post.mockResolvedValue({
				ok: true,
				data: { uri: "at://did:plc:testuser123/site.standard.publication/3mc7ts3zshc2y", cid: "cidpub1" },
			});

			const result = await client.createPublication(pub);

			expect(mockRpc.post).toHaveBeenCalledWith("com.atproto.repo.createRecord", {
				input: {
					repo: "did:plc:testuser123",
					collection: "site.standard.publication",
					record: pub,
				},
			});
			// Verify no rkey was passed in input
			const callArgs = mockRpc.post.mock.calls[0][1].input;
			expect(callArgs).not.toHaveProperty("rkey");
			expect(result.uri).toBe("at://did:plc:testuser123/site.standard.publication/3mc7ts3zshc2y");
		});
	});

	describe("updatePublication", () => {
		it("calls putRecord with rkey and updated record", async () => {
			const pub: PublicationRecord = {
				$type: "site.standard.publication",
				url: "https://myblog.example.com",
				name: "My Blog",
			};

			mockRpc.post.mockResolvedValue({
				ok: true,
				data: { uri: "at://did:plc:testuser123/site.standard.publication/3mc7ts3zshc2y", cid: "cidpub2" },
			});

			const result = await client.updatePublication("3mc7ts3zshc2y", pub);

			expect(mockRpc.post).toHaveBeenCalledWith("com.atproto.repo.putRecord", {
				input: {
					repo: "did:plc:testuser123",
					collection: "site.standard.publication",
					rkey: "3mc7ts3zshc2y",
					record: pub,
				},
			});
			expect(result.uri).toBe("at://did:plc:testuser123/site.standard.publication/3mc7ts3zshc2y");
		});
	});

	describe("listPublications", () => {
		it("returns all publication records with pagination", async () => {
			mockRpc.get
				.mockResolvedValueOnce({
					ok: true,
					data: {
						records: [
							{
								uri: "at://did:plc:testuser123/site.standard.publication/3mc7ts3zshc2y",
								cid: "cid1",
								value: { name: "Blog 1" },
							},
						],
						cursor: "next",
					},
				})
				.mockResolvedValueOnce({
					ok: true,
					data: {
						records: [
							{
								uri: "at://did:plc:testuser123/site.standard.publication/3mc7ts4abcd2z",
								cid: "cid2",
								value: { name: "Blog 2" },
							},
						],
						cursor: undefined,
					},
				});

			const records = await client.listPublications();
			expect(records).toHaveLength(2);
			expect(records[0].value.name).toBe("Blog 1");
			expect(records[1].value.name).toBe("Blog 2");
			expect(mockRpc.get).toHaveBeenCalledWith("com.atproto.repo.listRecords", {
				params: {
					repo: "did:plc:testuser123",
					collection: "site.standard.publication",
					limit: 100,
					cursor: undefined,
				},
			});
		});
	});

	describe("getDocument", () => {
		it("returns a document by rkey", async () => {
			mockRpc.get.mockResolvedValue({
				ok: true,
				data: {
					uri: "at://did:plc:testuser123/site.standard.document/abc123",
					cid: "cid1",
					value: { title: "Post 1" },
				},
			});

			const record = await client.getDocument("abc123");
			expect(record!.value.title).toBe("Post 1");
		});

		it("returns null when record not found", async () => {
			const notFoundError = new Error("Record not found");
			notFoundError.name = "ClientResponseError";
			(notFoundError as any).error = "RecordNotFound";
			(notFoundError as any).status = 400;
			mockRpc.get.mockRejectedValue(notFoundError);

			const record = await client.getDocument("nonexistent");
			expect(record).toBeNull();
		});
	});

	describe("uploadBlob", () => {
		it("uploads blob data and returns blob ref", async () => {
			const blobRef = { $type: "blob", ref: { $link: "bafyreia..." }, mimeType: "image/png", size: 1024 };
			mockRpc.post.mockResolvedValue({ ok: true, data: { blob: blobRef } });
			const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
			const result = await client.uploadBlob(data, "image/png");
			expect(mockRpc.post).toHaveBeenCalledWith("com.atproto.repo.uploadBlob", {
				input: data,
				headers: { "content-type": "image/png" },
			});
			expect(result).toEqual(blobRef);
		});
	});
});

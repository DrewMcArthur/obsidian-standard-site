import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type StandardSitePlugin from "./main";
import { DEFAULT_OAUTH_LOOPBACK_PORT, getOAuthClientId, getOAuthRedirectUri, type OAuthStoreData, type StoredOAuthState } from "./atproto";
import type { NodeSavedSession } from "@atproto/oauth-client-node";

export interface StandardSiteSettings extends OAuthStoreData {
	handle: string;
	oauthSessionDid: string;
	oauthClientId: string;
	oauthRedirectUri: string;
	oauthLoopbackPort: number;
	oauthAllowHttp: boolean;
	pdsUrl: string;
	publicationName: string;
	publicationDescription: string;
	publicationUrl: string;
	publicationUri: string;
	publishRoot: string;
	pullFolder: string;
}

export const DEFAULT_SETTINGS: StandardSiteSettings = {
	handle: "",
	oauthSessionDid: "",
	oauthClientId: "",
	oauthRedirectUri: "",
	oauthLoopbackPort: DEFAULT_OAUTH_LOOPBACK_PORT,
	oauthAllowHttp: false,
	oauthSessions: {} as Record<string, NodeSavedSession>,
	oauthStates: {} as Record<string, StoredOAuthState>,
	pdsUrl: "",
	publicationName: "",
	publicationDescription: "",
	publicationUrl: "",
	publicationUri: "",
	publishRoot: "",
	pullFolder: "",
};

export class StandardSiteSettingTab extends PluginSettingTab {
	plugin: StandardSitePlugin;
	private updateBaseUrlUI: (url: string) => void = () => {};

	constructor(app: App, plugin: StandardSitePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Standard.site Publisher" });

		containerEl.createEl("h3", { text: "Authentication" });

		new Setting(containerEl)
			.setName("ATProto handle")
			.setDesc("Your handle or DID. Used as the OAuth login hint.")
			.addText((text) =>
				text
					.setPlaceholder("alice.bsky.social")
					.setValue(this.plugin.settings.handle)
					.onChange(async (value) => {
						this.plugin.settings.handle = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("OAuth account")
			.setDesc(this.plugin.settings.oauthSessionDid ? `Connected as ${this.plugin.settings.oauthSessionDid}` : "Connect with ATProto OAuth. App passwords are no longer used.")
			.addButton((btn) =>
				btn
					.setButtonText(this.plugin.settings.oauthSessionDid ? "Reconnect" : "Connect")
					.setCta()
					.onClick(async () => {
						try {
							await this.plugin.connectOAuth();
							this.display();
						} catch (e: any) {
							new Notice(`ATProto OAuth failed: ${e.message}`);
							console.error("ATProto OAuth failed:", e);
						}
					})
			)
			.addButton((btn) => {
				btn
					.setButtonText("Disconnect")
					.setDisabled(!this.plugin.settings.oauthSessionDid)
					.onClick(async () => {
						try {
							await this.plugin.disconnectOAuth();
							this.display();
						} catch (e: any) {
							new Notice(`Disconnect failed: ${e.message}`);
							console.error("ATProto OAuth disconnect failed:", e);
						}
					});
			});

		const advancedAuthDetails = containerEl.createEl("details");
		advancedAuthDetails.createEl("summary", { text: "Advanced OAuth Settings" });

		new Setting(advancedAuthDetails)
			.setName("Loopback callback port")
			.setDesc("Port used for the temporary local OAuth callback server.")
			.addText((text) =>
				text
					.setPlaceholder(String(DEFAULT_OAUTH_LOOPBACK_PORT))
					.setValue(String(this.plugin.settings.oauthLoopbackPort || DEFAULT_OAUTH_LOOPBACK_PORT))
					.onChange(async (value) => {
						const port = Number(value.trim());
						this.plugin.settings.oauthLoopbackPort = Number.isFinite(port) && port > 0 ? port : DEFAULT_OAUTH_LOOPBACK_PORT;
						this.plugin.settings.oauthRedirectUri = "";
						this.plugin.settings.oauthClientId = "";
						await this.plugin.saveSettings();
					})
			);

		new Setting(advancedAuthDetails)
			.setName("OAuth redirect URI")
			.setDesc(`Defaults to ${getOAuthRedirectUri(this.plugin.settings)}. Leave empty unless you host custom client metadata.`)
			.addText((text) =>
				text
					.setPlaceholder(getOAuthRedirectUri(this.plugin.settings))
					.setValue(this.plugin.settings.oauthRedirectUri)
					.onChange(async (value) => {
						this.plugin.settings.oauthRedirectUri = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(advancedAuthDetails)
			.setName("OAuth client ID")
			.setDesc(`Defaults to the ATProto loopback client ID ${getOAuthClientId(this.plugin.settings)}.`)
			.addText((text) =>
				text
					.setPlaceholder(getOAuthClientId(this.plugin.settings))
					.setValue(this.plugin.settings.oauthClientId)
					.onChange(async (value) => {
						this.plugin.settings.oauthClientId = value.trim();
						await this.plugin.saveSettings();
					})
			);

		new Setting(advancedAuthDetails)
			.setName("Allow HTTP OAuth servers")
			.setDesc("Only enable for local PDS development. Production ATProto OAuth should use HTTPS.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.oauthAllowHttp)
					.onChange(async (value) => {
						this.plugin.settings.oauthAllowHttp = value;
						await this.plugin.saveSettings();
					})
			);

		containerEl.createEl("h3", { text: "Publication" });

		this.renderPublicationPicker(containerEl);

		new Setting(containerEl)
			.setName("Base URL")
			.setDesc("Your site URL (e.g. https://myblog.example.com). Synced to publication record.")
			.addText((text) => {
				this.updateBaseUrlUI = (url: string) => {
					if (text.inputEl && text.inputEl.isConnected) {
						text.setValue(url);
					}
				};
				text
					.setPlaceholder("https://myblog.example.com")
					.setValue(this.plugin.settings.publicationUrl)
					.onChange(async (value) => {
						this.plugin.settings.publicationUrl = value;
						await this.plugin.saveSettings();
					});
			});

		containerEl.createEl("h3", { text: "Vault" });

		new Setting(containerEl)
			.setName("Publish root folder")
			.setDesc("Vault folder for published notes (leave empty for vault root)")
			.addText((text) =>
				text
					.setPlaceholder("publish")
					.setValue(this.plugin.settings.publishRoot)
					.onChange(async (value) => {
						this.plugin.settings.publishRoot = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Pull folder")
			.setDesc("Where to save notes pulled from ATProto (defaults to publish root)")
			.addText((text) =>
				text
					.setPlaceholder("publish")
					.setValue(this.plugin.settings.pullFolder)
					.onChange(async (value) => {
						this.plugin.settings.pullFolder = value;
						await this.plugin.saveSettings();
					})
			);
	}

	private renderPublicationPicker(containerEl: HTMLElement) {
		const wrapper = containerEl.createDiv();
		this.renderPublicationPickerInternal(wrapper);
	}

	private renderPublicationPickerInternal(wrapper: HTMLDivElement) {
		wrapper.empty();

		if (!this.plugin.settings.oauthSessionDid) {
			new Setting(wrapper)
				.setName("Active publication")
				.setDesc("Connect your ATProto account above to load publications.");
			return;
		}

		new Setting(wrapper)
			.setName("Fetch publications")
			.setDesc("Load your publications from the server after connecting or reconnecting.")
			.addButton((btn) =>
				btn.setButtonText("Fetch").onClick(() => {
					this.loadPublications(wrapper);
				})
			);

		if (this.plugin.settings.publicationUri) {
			const displayName = this.plugin.settings.publicationName
				? `${this.plugin.settings.publicationName} (${this.plugin.settings.publicationUri})`
				: this.plugin.settings.publicationUri;

			new Setting(wrapper)
				.setName("Active publication (saved)")
				.setDesc(displayName)
				.setTooltip("This is the publication currently saved in settings. Fetch publications to see if it's still valid or select a different one.");
		}
	}

	private loadPublications(wrapper: HTMLDivElement) {
		wrapper.empty();

		new Setting(wrapper)
			.setName("Active publication")
			.setDesc("Loading publications...");

		this.plugin.getAuthenticatedClient().then(async (client) => {
			const publications = await client.listPublications();
			wrapper.empty();

			const setting = new Setting(wrapper)
				.setName("Active publication")
				.setDesc("Select which publication to publish to");

			setting.addDropdown((dropdown) => {
				for (const pub of publications) {
					const rkey = client.extractRkey(pub.uri);
					dropdown.addOption(pub.uri, pub.value.name || rkey);
				}
				dropdown.addOption("__new__", "+ Create new...");

				if (this.plugin.settings.publicationUri) {
					dropdown.setValue(this.plugin.settings.publicationUri);

					const currentPub = publications.find(p => p.uri === this.plugin.settings.publicationUri);
					if (currentPub) {
						let updated = false;
						if (currentPub.value.url && !this.plugin.settings.publicationUrl) {
							this.plugin.settings.publicationUrl = currentPub.value.url;
							this.updateBaseUrlUI(currentPub.value.url);
							updated = true;
						}
						const name = currentPub.value.name || "";
						if (this.plugin.settings.publicationName !== name) {
							this.plugin.settings.publicationName = name;
							updated = true;
						}

						if (updated) {
							this.plugin.saveSettings();
						}
					}
				}

				dropdown.onChange(async (value) => {
					if (value === "__new__") {
						newPubWrapper.style.display = "";
						return;
					}
					newPubWrapper.style.display = "none";
					this.plugin.settings.publicationUri = value;

					const selectedPub = publications.find(p => p.uri === value);
					if (selectedPub) {
						if (selectedPub.value.url) {
							this.plugin.settings.publicationUrl = selectedPub.value.url;
							this.updateBaseUrlUI(selectedPub.value.url);
						}
						this.plugin.settings.publicationName = selectedPub.value.name || "";
					}

					await this.plugin.saveSettings();
				});
			});

			const newPubWrapper = wrapper.createDiv();
			newPubWrapper.style.display = "none";

			let newName = "";
			new Setting(newPubWrapper)
				.setName("New publication name")
				.addText((text) =>
					text.setPlaceholder("My Cooking Blog").onChange((v) => { newName = v; })
				);

			new Setting(newPubWrapper)
				.addButton((btn) =>
					btn.setButtonText("Create publication").setCta().onClick(async () => {
						if (!newName.trim()) {
							new Notice("Enter a publication name before creating it.");
							return;
						}
						try {
							const ref = await client.createPublication({
								$type: "site.standard.publication",
								url: this.plugin.settings.publicationUrl ||
									`https://bsky.app/profile/${this.plugin.settings.handle}`,
								name: newName.trim(),
							});
							this.plugin.settings.publicationUri = ref.uri;
							this.plugin.settings.publicationName = newName.trim();
							await this.plugin.saveSettings();
							new Notice(`Created publication: ${newName.trim()}`);
							this.display();
						} catch (e: any) {
							new Notice(`Failed to create publication: ${e.message}`);
							console.error("Failed to create publication:", e);
						}
					})
				);
		}).catch(() => {
			wrapper.empty();
			new Setting(wrapper)
				.setName("Active publication")
				.setDesc("Could not connect. Reconnect your ATProto account and try again.");
			new Notice("Could not load publications. Reconnect your ATProto account and try again.");
		});
	}
}

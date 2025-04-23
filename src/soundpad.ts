import net from "net";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
	allowBooleanAttributes: true,
	attributesGroupName: "$",
	alwaysCreateTextNode: false,
	trimValues: true,
	parseAttributeValue: true,
	ignoreAttributes: false,
	attributeNamePrefix: "",
});

export enum PlayStatus {
	STOPPED = "STOPPED",
	PLAYING = "PLAYING",
	PAUSED = "PAUSED",
	SEEKING = "SEEKING",
}

export interface Sound {
	index: number;
	url: string;
	artist: string;
	title: string;
	duration: string;
	addedOn: string;
	color?: string;
	tag: string;
	lastPlayedOn: string;
	playCount: number;
}

// Soundpad's native response to sounds list query (after XML -> JS conversion)
interface SPSoundlistResponse {
	Soundlist: {
		Sound: Array<{
			$: Sound;
		}>;
	};
}

// Soundpad's native response to category query (after XML -> JS conversion)
export interface Category {
	index: number;
	type?: number;
	name: string;
	hidden?: boolean;
	sounds?: Sound[];
	icon?: string;
	subCategories?: Category[];
}

// Soundpad's native response to categories query (after XML -> JS conversion)
interface SPCategoryResponse {
	$: Category;
	Category?: Array<SPCategoryResponse> | SPCategoryResponse;
	Sound: Array<{
		$: Sound;
	}>;
}

interface SPCategoriesResponse {
	Categories: {
		Category: Array<SPCategoryResponse>;
	};
}

interface Options {
	autoReconnect: boolean;
	startSoundpadOnConnect: boolean;
}

class Soundpad extends EventTarget {
	private _pipe: net.Socket | null = null;
	private dataDriver: ((query: string) => Promise<string>) | null = null;
	connectionAwaiter: Promise<boolean> | null = null;
	private connectionResolveFunction: (
		value: boolean | PromiseLike<boolean>,
	) => void = () => {};

	private readonly options: Options = {
		autoReconnect: false,
		startSoundpadOnConnect: false,
	};

	isConnected: boolean;

	constructor(
		options: Partial<Options> = {
			autoReconnect: false,
			startSoundpadOnConnect: false,
		},
	) {
		super();
		this.isConnected = false;

		this.options.autoReconnect =
			options.autoReconnect ?? this.options.autoReconnect;
		this.options.startSoundpadOnConnect =
			options.startSoundpadOnConnect ?? this.options.startSoundpadOnConnect;

		this.connectionAwaiter = new Promise((resolve) => {
			this.connectionResolveFunction = resolve;
		});
	}

	setOptions(options: Partial<Options>): void {
		this.options.autoReconnect =
			options.autoReconnect ?? this.options.autoReconnect;
		this.options.startSoundpadOnConnect =
			options.startSoundpadOnConnect ?? this.options.startSoundpadOnConnect;
	}

	async connect(
		dataDriver: (query: string) => Promise<string> = this.sendQuery,
	): Promise<boolean> {
		if (this.options.startSoundpadOnConnect) {
			await this.openSoundpad();
		}
		return await new Promise((resolve, reject) => {
			if (dataDriver === this.sendQuery) {
				this._pipe = net.connect("\\\\.\\pipe\\sp_remote_control", () => {
					this.isConnected = true;
					this.connectionResolveFunction(true);
					this.dispatchEvent(new Event("connected"));

					resolve(true);
				});

				this._pipe.on("error", (error) => {
					this._pipe = null;
					this.isConnected = false;
					reject(error);
				});

				this._pipe.on("close", async () => {
					this.isConnected = false;
					this._pipe = null;

					this.dispatchEvent(new Event("close"));

					if (this.options.autoReconnect) {
						if (this.options.startSoundpadOnConnect) {
							await this.openSoundpad();
						}
						this.connectionAwaiter = new Promise((resolve) => {
							this.connectionResolveFunction = resolve;
						});
						void this.connect();
					}
				});

				this._pipe.on("end", () => {
					this.isConnected = false;
					this._pipe = null;
				});

				this._pipe.on("timeout", () => {
					this.isConnected = false;
					this._pipe = null;
				});
			} else {
				this.dataDriver = dataDriver;
				this.isConnected = true;
				this.connectionResolveFunction(true);
				resolve(true);
			}
		});
	}

	disconnect(): void {
		this._pipe?.end();
	}

	private isSuccess(response: string): boolean;
	private isSuccess(response: Promise<string>): Promise<boolean>;
	private isSuccess(
		response: Promise<string> | string,
	): Promise<boolean> | boolean {
		if (!(response instanceof Promise)) {
			return response.startsWith("R-200");
		}
		return new Promise((resolve) => {
			void response.then((awaitedResponse) => {
				resolve(awaitedResponse.toString().startsWith("R-200"));
			});
		});
	}

	async sendQuery(query: string): Promise<string> {
		if (this.dataDriver !== null && typeof this.dataDriver === "function") {
			return await this.dataDriver(query);
		}
		if (this._pipe === null) {
			if (this.options.startSoundpadOnConnect) {
				await this.openSoundpad();
			} else {
				throw new Error("Please connect the pipe before sending a message");
			}
		}

		await this.connectionAwaiter;

		return await new Promise((resolve) => {
			this._pipe?.write(query);
			this._pipe?.once("data", (buffer) => {
				resolve(buffer.toString());
			});
		});
	}

	async getSoundListJSON(): Promise<Sound[]> {
		const response = await this.sendQuery("GetSoundlist()");
		const parsed = parser.parse(response) as SPSoundlistResponse;

		if ((parsed.Soundlist as unknown) === "") {
			// If there are no sounds
			return [];
		}

		if (!Array.isArray(parsed.Soundlist.Sound)) {
			// If there is only one sound
			return [(parsed.Soundlist.Sound as { $: Sound }).$];
		}

		return fixSoundsName(parsed.Soundlist.Sound.map((sound) => sound.$));
	}

	/**
	 * Get the category tree.
	 *
	 * @param {boolean} [withSounds=false] includes all sound entries of each category into the response
	 * @param {boolean} [withIcons=false] base64 encoded PNGs
	 * @return {Promise<Category[]>} category list
	 */
	public async getCategoriesJSON(
		withSounds = false,
		withIcons = false,
	): Promise<Category[]> {
		const response = await this.sendQuery(
			`GetCategories(${withSounds}, ${withIcons})`,
		);
		if (response.startsWith("R")) {
			throw new Error(response);
		}
		const parsed = parser.parse(response) as SPCategoriesResponse;

		if ((parsed.Categories as unknown) === "") {
			// If there are no sounds
			return [];
		}

		if (!Array.isArray(parsed.Categories.Category)) {
			// If there is only one sound
			const parsedUniqueCategory = JSON.parse(
				JSON.stringify(parsed.Categories.Category),
			);
			parsed.Categories.Category = [parsedUniqueCategory];
		}

		function handleCategory(xmlParsedCategory: SPCategoryResponse): Category {
			const categoryData = xmlParsedCategory.$;
			categoryData.name = String(categoryData.name);
			categoryData.subCategories = [];
			if (withSounds) {
				if (xmlParsedCategory.Sound !== undefined) {
					const soundsArray = Array.isArray(xmlParsedCategory.Sound)
						? xmlParsedCategory.Sound
						: [xmlParsedCategory.Sound]; // If there is only one sound, it's not an array
					categoryData.sounds = fixSoundsName(
						soundsArray.map((sound) => sound.$),
					);
				}
			}
			if (xmlParsedCategory.Category !== undefined) {
				categoryData.subCategories = Array.isArray(xmlParsedCategory.Category)
					? xmlParsedCategory.Category.map(handleCategory)
					: [handleCategory(xmlParsedCategory.Category)];
			}
			return categoryData;
		}

		return parsed.Categories.Category.map(handleCategory);
	}

	/**
	 * Get a category identified by its index. Use
	 * {@link getCategoriesJSON} to get the index.
	 *
	 * @param {number} categoryIndex
	 * @param {boolean} withSounds includes all sound entries of each category into the response
	 * @param {boolean} withIcons base64 encoded PNGs
	 * @return {Promise<Category | null>} category list
	 */
	public async getCategoryJSON(
		categoryIndex: number,
		withSounds: boolean,
		withIcons: boolean,
	): Promise<Category | null> {
		const response = await this.sendQuery(
			`GetCategory(${categoryIndex}, ${withSounds}, ${withIcons})`,
		);
		if (response.startsWith("R")) {
			throw new Error(response);
		}
		const parsed = parser.parse(response) as SPCategoriesResponse;

		const returnedObject = {
			...parsed.Categories.Category[0].$,
		};

		returnedObject.name = String(returnedObject.name);

		if (withSounds && parsed.Categories.Category[0].Sound !== undefined) {
			return {
				...returnedObject,
				sounds: fixSoundsName(
					parsed.Categories.Category[0].Sound?.map((sound) => sound.$) ?? [],
				),
			};
		}

		return returnedObject;
	}

	/**
	 * Porting from https://www.leppsoft.com/soundpad/files/rc/SoundpadRemoteControl.java
	 *
	 * =========== PORTING START ===========
	 */

	/**
	 * Play a sound by index.
	 *
	 * @param {number} index Get the index by calling {@link getSoundlist} first.
	 * @return {boolean} true on success
	 */
	public async playSound(index: number): Promise<boolean>;

	/**
	 * Play a sound by index.
	 *
	 * @param {number} index Get the index by calling {@link getSoundlist} first.
	 * @param {boolean} renderLine set to true to play on speakers so you hear it.
	 * @param {boolean} captureLine set to true to play on microphone so others hear it.
	 * @return {boolean} true on success
	 */
	public async playSound(
		index: number,
		renderLine: boolean,
		captureLine: boolean,
	): Promise<boolean>;
	public async playSound(
		index: number,
		renderLine?: boolean,
		captureLine?: boolean,
	): Promise<boolean> {
		if (renderLine === undefined || captureLine === undefined) {
			return await this.isSuccess(this.sendQuery(`DoPlaySound(${index})`));
		} else {
			return await this.isSuccess(
				this.sendQuery(
					`DoPlaySound(${index}, ${renderLine ?? true}, ${captureLine ?? true})`,
				),
			);
		}
	}

	/**
	 * Play previous sound in the list. The play mode is the same as it was for
	 * the last played file. Means, if a sound was played on speakers only, then
	 * this function will play on speakers only as well.
	 */
	public async playPreviousSound(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoPlayPreviousSound()"));
	}

	/**
	 * @see playPreviousSound()
	 */
	public async playNextSound(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoPlayNextSound()"));
	}

	public async stopSound(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoStopSound()"));
	}

	public async togglePause(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoTogglePause()"));
	}

	/**
	 * Use negative values to jump backwards.
	 *
	 * @param {number} timeMillis
	 * e.g. 5000 to jump 5 seconds forward.
	 */
	public async jump(timeMillis: number): Promise<boolean> {
		return await this.isSuccess(this.sendQuery(`DoJumpMs(${timeMillis})`));
	}

	/**
	 * Jump to a particular position in the currently played sound.
	 *
	 * @param {number} timeMillis
	 * e.g. 5000 to jump to the 5th second of the sound.
	 */
	public async seek(timeMillis: number): Promise<boolean> {
		return await this.isSuccess(this.sendQuery(`DoSeekMs(${timeMillis})`));
	}

	/**
	 * Start recording. This call is handled the same way as if a recording is
	 * started by hotkeys, which means a notification sound is played. This is
	 * the default behavior, but the notification sound can be turned off in
	 * Soundpad.
	 */
	public async startRecording(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoStartRecording()"));
	}

	public async stopRecording(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoStopRecording()"));
	}

	/**
	 * Uses Soundpad's instant search to highlight sounds.
	 * @param {string} searchTerm
	 */
	public async search(searchTerm: string): Promise<boolean> {
		const response: string = await this.sendQuery(
			'DoSearch("' + searchTerm + '")',
		);
		if (response !== "R-200") {
			console.error(response);
			return false;
		}
		return true;
	}

	/**
	 * Closes search panel.
	 */
	public async resetSearch(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoResetSearch()"));
	}

	/**
	 * Select previous search hit. Search is always wrapped. Means it starts
	 * again at the first hit if the last hit is reached.
	 */
	public async selectPreviousHit(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoSelectPreviousHit()"));
	}

	/**
	 * @see selectPreviousHit()
	 */
	public async selectNextHit(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoSelectNextHit()"));
	}

	/**
	 * Select the sound at the given row in the list. This method was created
	 * before categories were introduced, as such the row is not the sound
	 * index, but the position in the currently selected category.
	 * @param {number} row
	 */
	public async selectRow(row: number): Promise<boolean> {
		return await this.isSuccess(this.sendQuery(`DoSelectIndex(${row})`));
	}

	/**
	 * Scroll down or up by this many rows. Use negative values to scroll
	 * upwards.
	 * @param {number} rows
	 */
	public async scrollBy(rows: number): Promise<boolean> {
		return await this.isSuccess(this.sendQuery(`DoScrollBy(${rows})`));
	}

	/**
	 * Scroll to a particular row.
	 * @param {number} row
	 */
	public async scrollTo(row: number): Promise<boolean> {
		return await this.isSuccess(this.sendQuery(`DoScrollTo(${row})`));
	}

	/**
	 * Returns the total amount of sounds over all categories independent of
	 * currently selected category.
	 */
	public async getSoundFileCount(): Promise<number> {
		return Number.parseInt(await this.sendQuery("GetSoundFileCount()"));
	}

	/**
	 * Returns playback position of currently played sound file in milliseconds.
	 */
	public async getPlaybackPosition(): Promise<number> {
		return Number.parseInt(await this.sendQuery("GetPlaybackPositionInMs()"));
	}

	/**
	 * Returns duration of currently played sound file in milliseconds.
	 */
	public async getPlaybackDuration(): Promise<number> {
		return Number.parseInt(await this.sendQuery("GetPlaybackDurationInMs()"));
	}

	/**
	 * Returns recording position in milliseconds.
	 */
	public async getRecordingPosition(): Promise<number> {
		return Number.parseInt(await this.sendQuery("GetRecordingPositionInMs()"));
	}

	/**
	 * Returns current recording peak.
	 */
	public async getRecordingPeak(): Promise<number> {
		return Number.parseInt(await this.sendQuery("GetRecordingPeak()"));
	}

	/**
	 * Get a section of the sound list.
	 *
	 * @see getSoundlist()
	 *
	 * @param {number} fromIndex starts with 1
	 * @param {number} toIndex the sound file at toIndex is included in the response
	 * @return {string} xml formatted sound list
	 */
	public async getSoundlist(
		fromIndex?: number,
		toIndex?: number,
	): Promise<string> {
		if (toIndex !== undefined && fromIndex !== undefined) {
			return await this.sendQuery(`GetSoundlist(${fromIndex},${toIndex})`);
		} else if (fromIndex !== undefined) {
			return await this.sendQuery(`GetSoundlist(${fromIndex})`);
		}
		return await this.sendQuery("GetSoundlist()");
	}

	public async getMainFrameTitleText(): Promise<string> {
		return await this.sendQuery("GetTitleText()");
	}

	public async getStatusBarText(): Promise<string> {
		return await this.sendQuery("GetStatusBarText()");
	}

	public async getPlayStatus(): Promise<PlayStatus> {
		const response: string = await this.sendQuery("GetPlayStatus()");
		if (response.startsWith("R")) {
			console.error(response);
		}
		if (response in PlayStatus) {
			return PlayStatus[response as PlayStatus];
		}
		return PlayStatus.STOPPED;
	}

	/**
	 * Returns the version of Soundpad. Not the version of the remote control
	 * interface.
	 */
	public async getVersion(): Promise<string> {
		return await this.sendQuery("GetVersion()");
	}

	public async getRemoteControlVersion(): Promise<string> {
		return await this.sendQuery("GetRemoteControlVersion()");
	}

	/**
	 * Adds a sound to the sound list.
	 * @param url full path and file name, e.g. C:\mysounds\sound.mp3
	 * @return {boolean} true on success
	 */
	public async addSound(url: string): Promise<boolean>;

	/**
	 * Adds a sound to the sound list.
	 * @param url full path and file name, e.g. C:\mysounds\sound.mp3
	 * @param index The index to add the sound to in the default category.
	 * @return {boolean} true on success
	 */
	public async addSound(url: string, index?: number): Promise<boolean>;

	/**
	 * Adds a sound to the sound list.
	 * @param url full path and file name, e.g. C:\mysounds\sound.mp3
	 * @param index The category to add the sound to.
	 * @param insertAtPosition The index to add the sound to.
	 * @return {boolean} true on success
	 */
	public async addSound(
		url: string,
		index: number,
		insertAtPosition: number,
	): Promise<boolean>;
	public async addSound(
		url: string,
		index?: number,
		insertAtPosition?: number,
	): Promise<boolean> {
		if (insertAtPosition !== undefined && index !== undefined) {
			return await this.isSuccess(
				this.sendQuery(`DoAddSound("${url}", ${index}, ${insertAtPosition})`),
			);
		} else if (index !== undefined) {
			return await this.isSuccess(
				this.sendQuery(`DoAddSound("${url}", ${index})`),
			);
		}
		return await this.isSuccess(this.sendQuery(`DoAddSound("${url}")`));
	}

	public async removeSelectedEntries(
		removeOnDiskToo = false,
	): Promise<boolean> {
		return await this.isSuccess(
			this.sendQuery(`DoRemoveSelectedEntries(${removeOnDiskToo})`),
		);
	}

	/**
	 * Undo last action. Same as Edit > Undo in Soundpad.
	 */
	public async undo(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoUndo()"));
	}

	/**
	 * Redo last action. Same as Edit > Redo in Soundpad.
	 */
	public async redo(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoRedo()"));
	}

	/**
	 * Shows file selection dialog if sound list was never saved before.
	 */
	public async saveSoundlist(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoSaveSoundlist()"));
	}

	/**
	 * @return {Promise<number>} volume between 0 and 100.
	 */
	public async getVolume(): Promise<number> {
		const response: string = await this.sendQuery("GetVolume()");
		return Number.parseInt(response);
	}

	/**
	 * @return {Promise<boolean>} true if the volume of the speakers is 0 or muted.
	 */
	public async isMuted(): Promise<boolean> {
		const response: string = await this.sendQuery("IsMuted()");
		return Number.parseInt(response) === 1;
	}

	/**
	 * Change volume of the speakers.
	 *
	 * @param {number} volume
	 * a value between 0 and 100.
	 */
	public async setVolume(volume: number): Promise<boolean> {
		return await this.isSuccess(this.sendQuery(`SetVolume(${volume})`));
	}

	/**
	 * Mutes or unmutes speakers in Soundpad.
	 */
	public async toggleMute(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoToggleMute()"));
	}

	/**
	 * @return {boolean} true if Soundpad is running and the remote control interface is accessible.
	 */
	public async isAlive(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("IsAlive()"));
	}

	public async playSelectedSound(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoPlaySelectedSound()"));
	}

	public async playCurrentSoundAgain(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoPlayCurrentSoundAgain()"));
	}

	public async playPreviouslyPlayedSound(): Promise<boolean> {
		return await this.isSuccess(
			this.sendQuery("DoPlayPreviouslyPlayedSound()"),
		);
	}

	public async addCategory(
		name: string,
		parentCategoryIndex = -1,
	): Promise<boolean> {
		return await this.isSuccess(
			this.sendQuery(`DoAddCategory("${name}", ${parentCategoryIndex})`),
		);
	}

	/**
	 * Start recording of the speakers. Method might fail if the microphone is
	 * currently being recorded. This call is handled the same way as if a
	 * recording is started by hotkeys, which means a notification sound is
	 * played. This is the default behavior, but the notification sound can be
	 * turned off in Soundpad.
	 *
	 * @return {Promise<boolean>} true if recording was started or was already running
	 */
	public async startRecordingSpeakers(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoStartRecordingSpeakers()"));
	}

	/**
	 * Start recording of the microphone. Method might fail if the speakers are
	 * currently being recorded. This call is handled the same way as if a
	 * recording is started by hotkeys, which means a notification sound is
	 * played. This is the default behavior, but the notification sound can be
	 * turned off in Soundpad.
	 *
	 * @return {Promise<boolean>} true if recording was started or was already running
	 */
	public async startRecordingMicrophone(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoStartRecordingMicrophone()"));
	}

	/**
	 * Select the category identified by its index. Use
	 * {@link getCategories} to get the index.
	 *
	 * @param {number} categoryIndex The index of the category to be selected.
	 * @return {Promise<boolean>} true on success
	 */
	public async selectCategory(categoryIndex: number): Promise<boolean> {
		return await this.isSuccess(
			this.sendQuery(`DoSelectCategory(${categoryIndex})`),
		);
	}

	public async selectPreviousCategory(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoSelectPreviousCategory()"));
	}

	public async selectNextCategory(): Promise<boolean> {
		return await this.isSuccess(this.sendQuery("DoSelectNextCategory()"));
	}

	/**
	 * Remove a category identified by its index. Use
	 * {@link getCategories} to get the index.
	 *
	 * @param {number} categoryIndex The index of the category to be removed.
	 * @return {Promise<boolean>} true on success
	 */
	public async removeCategory(categoryIndex: number): Promise<boolean> {
		return await this.isSuccess(
			this.sendQuery(`DoRemoveCategory(${categoryIndex})`),
		);
	}

	/**
	 * Get the category tree.
	 *
	 * @param {boolean} [withSounds=false] includes all sound entries of each category into the response
	 * @param {boolean} [withIcons=false] base64 encoded PNGs
	 * @return {Promise<string>} xml formatted category list
	 */
	public async getCategories(
		withSounds = false,
		withIcons = false,
	): Promise<string> {
		const response: string = await this.sendQuery(
			`GetCategories(${withSounds}, ${withIcons})`,
		);
		if (response.startsWith("R")) {
			console.error(response);
		}
		return response;
	}

	/**
	 * Get a category identified by its index. Use
	 * {@link getCategories} to get the index.
	 *
	 * @param {number} categoryIndex
	 * @param {boolean} withSounds includes all sound entries associated to that category
	 * @param {boolean} withIcons base64 encoded PNG
	 * @return {Promise<string>} xml formatted category list
	 */
	public async getCategory(
		categoryIndex: number,
		withSounds: boolean,
		withIcons: boolean,
	): Promise<string> {
		const response: string = await this.sendQuery(
			`GetCategory(${categoryIndex}, ${withSounds}, ${withIcons})`,
		);
		if (response.startsWith("R")) {
			console.error(response);
		}
		return response;
	}

	/**
	 * Let Soundpad play a sound from a particular category.
	 *
	 * @param {number} categoryIndex set to -1 to play a sound from the currently selected category or use {@link getCategories} to find the index of a category.
	 * @param {number} soundIndex it's not the index as used in {@link playSound}, but the position in the category, e.g. 5 = 5th sound in the category.
	 * @param {boolean} renderLine set to true to play on speakers so you hear it.
	 * @param {boolean} captureLine set to true to play on microphone so others hear it.
	 * @return {Promise<boolean>} true on success
	 */
	public async playSoundFromCategory(
		categoryIndex: number,
		soundIndex: number,
		renderLine: boolean,
		captureLine: boolean,
	): Promise<boolean> {
		return await this.isSuccess(
			this.sendQuery(
				`DoPlaySoundFromCategory(${categoryIndex}, ${soundIndex}, ${renderLine}, ${captureLine})`,
			),
		);
	}

	//***********************************************************************//
	//
	// Remote Control v1.1.2
	//
	//***********************************************************************//

	/**
	 * Let Soundpad play a random sound from any category.
	 *
	 * @param renderLine set to true to play on speakers so you hear it.
	 * @param captureLine set to true to play on microphone so others hear it.
	 * @return true on success
	 */
	public async playRandomSound(
		renderLine: boolean,
		captureLine: boolean,
	): Promise<boolean> {
		return await this.isSuccess(
			this.sendQuery(`DoPlayRandomSound(${renderLine}, ${captureLine})`),
		);
	}

	/**
	 * Let Soundpad play a random sound from a particular category.
	 *
	 * @param categoryIndex set to -1 to play a random sound from the currently selected category or use {@link #getCategories(boolean, boolean)} to find the index of a category.
	 * @param renderLine set to true to play on speakers so you hear it.
	 * @param captureLine set to true to play on microphone so others hear it.
	 * @return true on success
	 */
	public async playRandomSoundFromCategory(
		categoryIndex: number,
		renderLine: boolean,
		captureLine: boolean,
	): Promise<boolean> {
		return await this.isSuccess(
			this.sendQuery(
				`DoPlayRandomSoundFromCategory(${categoryIndex}, ${renderLine}, ${captureLine})`,
			),
		);
	}

	/**
	 * @return true if the client is using the trial version, false if it is the full version or null if undermined.
	 */
	public async isTrial(): Promise<boolean | null> {
		const response = await this.sendQuery("IsTrial()");
		if (response.trim() === "") {
			return null;
		}
		return Number.parseInt(response) == 1;
	}

	/**
	 * =========== PORTING END ===========
	 */

	/**
	 * @param status The status to wait for (default: STOPPED)
	 * @param pollInterval The interval to poll the status (default: 100ms)
	 * @returns A promise that resolves when the status is reached
	 */
	async waitForStatus(
		status = PlayStatus.STOPPED,
		pollInterval = 100,
	): Promise<void> {
		return await new Promise((resolve) => {
			const interval = setInterval(async () => {
				const currentStatus = await this.getPlayStatus();
				if (currentStatus === status) {
					clearInterval(interval);
					resolve();
				}
			}, pollInterval);
		});
	}

	protected async openSoundpad(): Promise<void> {
		// NOOP
		return await Promise.resolve();
	}
}

/**
 * Fixed when shounds titles only have digits (fast-xml-parser converts them to numbers instead of strings)
 * @param sounds
 * @returns
 */
function fixSoundsName(sounds: Sound[]): Sound[] {
	return sounds.map((sound) => {
		sound.title = String(sound.title);
		sound.tag = String(sound.tag);
		return sound;
	});
}

// const soundpad = new Soundpad()

export default Soundpad;

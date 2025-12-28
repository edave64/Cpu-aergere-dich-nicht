import {
	GameState,
	MoveLaggingFirst,
	MoveFurthestFirst,
	RandomIntelligence,
	type PlayerName,
	PlayerIntelligence,
	PiecePosition,
} from "./lib";

const walkableChips = Array.from(
	document.querySelectorAll("svg > circle"),
) as SVGCircleElement[];
const playerPaths = new Map<string, number[]>();
const playerReserves = new Map<string, SVGCircleElement[]>();
const playerHomes = new Map<string, SVGCircleElement[]>();
const playerPieces = new Map<string, SVGCircleElement[]>();
const openPaths = new Set<string>();
let i = 0;

do {
	let closePath: string | undefined = undefined;
	const currentI = i;
	const chip = walkableChips[currentI];
	i = (i + 1) % walkableChips.length;

	if (chip.classList.length > 0) {
		const chipClass = chip.classList[0];
		if (chipClass.endsWith("_goal")) {
			closePath = chipClass.slice(0, -5);
		} else if (!playerPaths.has(chipClass)) {
			openPaths.add(chipClass);
			playerPaths.set(chipClass, []);
			playerReserves.set(
				chipClass,
				Array.from(
					document.querySelectorAll(
						`svg > .${chipClass}_reserve > circle`,
					),
				),
			);
			playerHomes.set(
				chipClass,
				Array.from(
					document.querySelectorAll(
						`svg > .${chipClass}_home > circle`,
					),
				),
			);
		}
	}

	for (const player of openPaths) {
		playerPaths.get(player)!.push(currentI);
	}

	if (closePath) {
		openPaths.delete(closePath);
	}
} while (openPaths.size > 0);

function renderState(state: GameState) {
	for (const player of state.players) {
		let pieces = playerPieces.get(player);
		if (pieces === undefined) {
			pieces = [0, 0, 0, 0].map((_) => {
				const circle = document.createElementNS(
					"http://www.w3.org/2000/svg",
					"circle",
				);
				circle.setAttribute("cx", "0");
				circle.setAttribute("cy", "0");
				circle.setAttribute("r", "24");
				circle.style.stroke = "#fff";
				circle.style.pointerEvents = "none";
				circle.classList.add(player);
				document.querySelector("svg")!.appendChild(circle);
				return circle;
			});
			playerPieces.set(player, pieces);
		}

		for (let i = 0; i < 4; i++) {
			const piece = pieces[i];
			const piecePosition = state.pieces.get(player)![i];
			let targetCircle: SVGCircleElement | undefined;
			if (piecePosition.section === "field") {
				targetCircle = walkableChips[piecePosition.index]!;
			} else if (piecePosition.section === "home") {
				targetCircle = playerHomes.get(player)![piecePosition.index];
			} else if (piecePosition.section === "reserve") {
				targetCircle = playerReserves.get(player)![piecePosition.index];
			} else {
				throw new Error("Unknown piece position");
			}
			piece.style.transform = `translate(${targetCircle.getAttribute(
				"cx",
			)}px, ${targetCircle.getAttribute("cy")}px)`;
		}
	}
}

let running: Game | null = null;
const winBanner = document.getElementById("winBanner")!;
const playButton = document.getElementById("play")!;
const speedInput = document.getElementById("speed")! as HTMLInputElement;
playButton.addEventListener("click", () => {
	if (!running || running.winner !== undefined) {
		running = new Game();
	}
	running.start();
});

class Game {
	private state: GameState;
	private nextMoveTimeout: number | null = null;
	private readonly abortController = new AbortController();
	private _winner: PlayerName | undefined = undefined;
	private _running: boolean = false;

	constructor() {
		winBanner.textContent = "";
		this.state = new GameState(
			[...playerHomes.keys()],
			new Map(
				[...playerHomes.keys()].map(([player, _homes]) => {
					const aiValue = (
						document.getElementById(
							`${player}-intelligence`,
						) as HTMLSelectElement
					).value;
					let ai: PlayerIntelligence;
					switch (aiValue) {
						case "manual":
							ai = new ManualIntelligence(player);
							break;
						case "eager":
							ai = new MoveFurthestFirst(player);
							break;
						case "cluster":
							ai = new MoveLaggingFirst(player);
							break;
						default:
							ai = new RandomIntelligence();
					}
					return [player, ai];
				}),
			),
			playerPaths,
		);
		this.state.onRoll((rolled, player) => {
			const rect = document.querySelector(`rect`)!;
			rect.style.display = "block";
			rect.setAttribute("class", player);
			const dice = document.getElementById("dice")!;
			dice.setAttribute("aria-valuenow", rolled.toString());
		});
	}

	get winner() {
		return this._winner;
	}

	public async start() {
		if (this._running) {
			return;
		}
		this._running = true;
		// oxlint-disable-next-line no-this-alias
		const self = this;
		await runner();
		async function runner() {
			if (!self._running) return;
			await self.step();
			if (self._winner === undefined) {
				const timeout = speedInput.valueAsNumber;
				if (timeout <= 0) {
					runner();
				} else {
					self.nextMoveTimeout = setTimeout(
						runner,
						speedInput.valueAsNumber,
					);
				}
			} else {
				self.abortController.abort();
				winBanner.textContent = fullNames.get(self._winner)!;
			}
		}
	}

	public stop() {
		this._running = false;
		if (this.nextMoveTimeout !== null) {
			clearTimeout(this.nextMoveTimeout);
			this.nextMoveTimeout = null;
		}
	}

	public async step() {
		if (this._winner === undefined) {
			await this.state.nextMove();
			this._winner = this.state.getWinner();
			renderState(this.state);
		}
	}
}

const fullNames = new Map<PlayerName, string>([
	["y", "Yellow"],
	["g", "Green"],
	["r", "Red"],
	["b", "Black"],
]);

const sidebar = document.getElementById("sidebar")!;

for (const player of playerHomes.keys()) {
	const template = document.getElementById(
		"intelligence-template",
	)! as HTMLTemplateElement;

	const instance = template.content.cloneNode(true) as DocumentFragment;
	const label = instance.querySelector("label")!;
	label.setAttribute("for", player + "-intelligence");
	label.querySelector("span")!.textContent = fullNames.get(player)!;
	const select = instance.querySelector("select")!;
	select.value = "random";
	select.id = player + "-intelligence";
	sidebar.appendChild(instance);
}

const waitingForInput = new Map<SVGCircleElement, () => void>();

class ManualIntelligence implements PlayerIntelligence {
	private readonly player: PlayerName;
	constructor(player: PlayerName) {
		this.player = player;
	}

	public getNextMove(
		_state: GameState,
		_rolled: number,
		possibleMoves: [PiecePosition, PiecePosition][],
	): Promise<[PiecePosition, PiecePosition]> {
		const promises: Promise<[PiecePosition, PiecePosition]>[] = [];
		for (const move of possibleMoves) {
			const piece = move[0];
			const target = move[1];
			let targetCircle: SVGCircleElement | undefined;
			if (piece.section === "field") {
				targetCircle = walkableChips[piece.index]!;
			} else if (piece.section === "home") {
				targetCircle = playerHomes.get(this.player)![piece.index];
			} else if (piece.section === "reserve") {
				targetCircle = playerReserves.get(this.player)![piece.index];
			}
			if (!targetCircle) {
				throw new Error("Unknown piece position");
			}
			const promise = new Promise<[PiecePosition, PiecePosition]>(
				(resolve) => {
					waitingForInput.set(targetCircle, () => {
						resolve([piece, target]);
					});
				},
			);
			promises.push(promise);
		}
		return Promise.race(promises);
	}
}

document.body.addEventListener("pointerdown", (e) => {
	const target = e.target;

	if (!(target instanceof SVGCircleElement)) {
		return;
	}

	const callback = waitingForInput.get(target);
	if (callback) {
		waitingForInput.clear();
		callback();
	} else {
		const group = target.closest("g");
		const className = group?.getAttribute("class");
		if (group && className?.endsWith("_reserve")) {
			for (const [circle, callback] of waitingForInput) {
				if (group.contains(circle)) {
					waitingForInput.delete(circle);
					callback();
				}
			}
		}
	}
});

console.log(playerPaths);
console.log(playerReserves);
console.log(playerHomes);

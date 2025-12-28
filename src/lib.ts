export type PlayerName = string;

const TurnState = {
	First: 0,
	Reroll: 1,
	ReserveEscape: 2,
} as const;

type TurnState = (typeof TurnState)[keyof typeof TurnState];

export class GameState {
	readonly players: PlayerName[];
	readonly intelligences: Map<PlayerName, PlayerIntelligence>;
	readonly paths = new Map<PlayerName, number[]>();
	readonly pieces = new Map<
		PlayerName,
		[PiecePosition, PiecePosition, PiecePosition, PiecePosition]
	>();
	private turnState: TurnState = TurnState.First;
	private rollCallbacks: ((rolled: number, player: PlayerName) => void)[] =
		[];
	private i = 0;

	constructor(
		players: PlayerName[],
		intelligences: Map<PlayerName, PlayerIntelligence>,
		paths: Map<PlayerName, number[]>,
	) {
		this.players = players;
		this.intelligences = intelligences;
		this.paths = paths;
		this.pieces = new Map(
			players.map((player) => [
				player,
				[
					new PiecePosition(0, "reserve"),
					new PiecePosition(1, "reserve"),
					new PiecePosition(2, "reserve"),
					new PiecePosition(3, "reserve"),
				],
			]),
		);
	}

	public getWinner(): PlayerName | undefined {
		for (const player of this.players) {
			if (
				this.pieces
					.get(player)
					?.every((piece) => piece.section === "home")
			) {
				return player;
			}
		}
		return undefined;
	}

	public async nextMove(): Promise<[PiecePosition, PiecePosition] | null> {
		const currentPlayerIdx = this.i;

		const currentPlayer = this.players[currentPlayerIdx];
		const currentIntelligence = this.intelligences.get(currentPlayer)!;

		const path = this.paths.get(currentPlayer)!;
		const pieces = this.pieces.get(currentPlayer)!;
		const piecesOnField = pieces.filter(
			(piece) => piece.section === "field",
		);
		const pathLength = path.length;

		const rolled = throwD6();

		if (rolled === 6) {
			this.turnState = TurnState.Reroll;
		} else if (this.turnState === TurnState.Reroll) {
			this.turnState = TurnState.First;
		} else if (this.turnState === TurnState.ReserveEscape) {
			this.turnState = TurnState.Reroll;
		} else if (piecesOnField.length === 0) {
			this.turnState = TurnState.ReserveEscape;
		}

		if (this.turnState === TurnState.First) {
			this.i = (currentPlayerIdx + 1) % this.players.length;
		}

		console.log(`player ${currentPlayer} rolled ${rolled}`);
		const possibleMoves: [PiecePosition, PiecePosition][] = [];

		this.rollCallbacks.forEach((callback) =>
			callback(rolled, currentPlayer),
		);

		const piecesInReserve = pieces.filter(
			(piece) => piece.section === "reserve",
		);

		if (rolled === 6 && piecesInReserve.length > 0) {
			const startField = path[0];
			const startFieldOpen = !piecesOnField.find(
				(piece) => piece.index === startField,
			);
			if (startFieldOpen) {
				possibleMoves.push([
					piecesInReserve[0],
					new PiecePosition(startField, "field"),
				]);
			}
		}

		const piecesInHome = pieces.filter((piece) => piece.section === "home");
		const homePlaces = [0, 1, 2, 3].map(
			(x) => !piecesInHome.find((piece) => piece.index === x),
		);

		for (const piece of piecesOnField) {
			const pieceOnPathIdx = path.findIndex(
				(pathPiece) => pathPiece === piece.index,
			);
			const movedIdx = pieceOnPathIdx + rolled;
			if (movedIdx < pathLength) {
				const target = path[movedIdx];
				if (!piecesOnField.find((piece) => piece.index === target)) {
					possibleMoves.push([
						piece,
						new PiecePosition(path[movedIdx], "field"),
					]);
				}
			} else {
				const intoHome = movedIdx - pathLength;
				if (homePlaces[intoHome]) {
					possibleMoves.push([
						piece,
						new PiecePosition(intoHome, "home"),
					]);
				}
			}
		}

		for (const piece of piecesInHome) {
			if (homePlaces[piece.index + rolled]) {
				possibleMoves.push([
					piece,
					new PiecePosition(piece.index + rolled, "home"),
				]);
			}
		}

		if (possibleMoves.length === 0) {
			return null;
		}

		const pickedMove = await currentIntelligence.getNextMove(
			this,
			rolled,
			possibleMoves,
		);

		const pieceIdx = pieces.findIndex((piece) => piece === pickedMove[0]);
		pieces[pieceIdx] = pickedMove[1];

		for (const otherPlayer of this.players) {
			if (otherPlayer === currentPlayer) continue;

			const pieces = this.pieces.get(otherPlayer)!;
			const collidingPieceIdx = pieces.findIndex(
				(piece) =>
					piece.section === "field" &&
					piece.index === pickedMove[1].index,
			);

			if (collidingPieceIdx !== -1) {
				pieces[collidingPieceIdx] = new PiecePosition(
					[0, 1, 2, 3].find(
						(x) =>
							!pieces.find(
								(piece) =>
									piece.section === "reserve" &&
									piece.index === x,
							),
					)!,
					"reserve",
				);
				break;
			}
		}

		return pickedMove;
	}

	public onRoll(callback: (rolled: number, player: PlayerName) => void) {
		this.rollCallbacks.push(callback);
	}
}

function throwD6(): 1 | 2 | 3 | 4 | 5 | 6 {
	const d6 = Math.floor(Math.random() * 6) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
	if (d6 === 6) {
		return 6;
	}
	return (d6 + 1) as 1 | 2 | 3 | 4 | 5 | 6;
}

export abstract class PlayerIntelligence {
	abstract getNextMove(
		state: GameState,
		rolled: number,
		possibleMoves: [PiecePosition, PiecePosition][],
	): [PiecePosition, PiecePosition] | Promise<[PiecePosition, PiecePosition]>;
}

export class PiecePosition {
	section: "home" | "reserve" | "field";
	index: number;

	constructor(
		index: number,
		section: "home" | "reserve" | "field" = "reserve",
	) {
		this.index = index;
		this.section = section;
	}
}

export class RandomIntelligence implements PlayerIntelligence {
	getNextMove(
		state: GameState,
		rolled: number,
		possibleMoves: [PiecePosition, PiecePosition][],
	): [PiecePosition, PiecePosition] {
		const randomMove =
			possibleMoves[Math.floor(Math.random() * possibleMoves.length)];
		return randomMove;
	}
}

export class MoveLaggingFirst implements PlayerIntelligence {
	private readonly player: PlayerName;

	constructor(player: PlayerName) {
		this.player = player;
	}

	getNextMove(
		state: GameState,
		rolled: number,
		possibleMoves: [PiecePosition, PiecePosition][],
	): [PiecePosition, PiecePosition] {
		const randomMove = possibleMoves.sort(
			(a, b) =>
				state.paths.get(this.player)!.indexOf(a[0].index) -
				state.paths.get(this.player)!.indexOf(b[0].index),
		)[0];
		return randomMove;
	}
}

export class MoveFurthestFirst implements PlayerIntelligence {
	private readonly player: PlayerName;

	constructor(player: PlayerName) {
		this.player = player;
	}

	getNextMove(
		state: GameState,
		rolled: number,
		possibleMoves: [PiecePosition, PiecePosition][],
	): [PiecePosition, PiecePosition] {
		const randomMove = possibleMoves.sort(
			(a, b) =>
				state.paths.get(this.player)!.indexOf(b[0].index) -
				state.paths.get(this.player)!.indexOf(a[0].index),
		)[0];
		return randomMove;
	}
}

export const TRAINING_BOARD_SIZE = 10;

export const TRAINING_LESSONS = Object.freeze([
  Object.freeze({
    titleKey: "training.lesson.connect.title",
    descriptionKey: "training.lesson.connect.description",
    hintKey: "training.lesson.connect.hint",
    successKey: "training.lesson.connect.success",
    objective: "piece",
    targets: Object.freeze([{ row: 4, col: 4 }]),
    pieces: Object.freeze([{ row: 4, col: 3, player: "X" }, { row: 0, col: 9, player: "O" }])
  }),
  Object.freeze({
    titleKey: "training.lesson.contact.title",
    descriptionKey: "training.lesson.contact.description",
    hintKey: "training.lesson.contact.hint",
    successKey: "training.lesson.contact.success",
    objective: "reaction",
    targets: Object.freeze([{ row: 4, col: 3 }]),
    pieces: Object.freeze([
      { row: 4, col: 2, player: "X" },
      { row: 4, col: 4, player: "O" },
      { row: 3, col: 4, player: "O" },
      { row: 5, col: 4, player: "O" },
      { row: 4, col: 5, player: "O" }
    ])
  }),
  Object.freeze({
    titleKey: "training.lesson.shield.title",
    descriptionKey: "training.lesson.shield.description",
    hintKey: "training.lesson.shield.hint",
    successKey: "training.lesson.shield.success",
    objective: "shield",
    item: "shield",
    targets: Object.freeze([{ row: 4, col: 3 }, { row: 4, col: 4 }, { row: 5, col: 4 }]),
    pieces: Object.freeze([{ row: 4, col: 3, player: "X" }, { row: 0, col: 9, player: "O" }])
  }),
  Object.freeze({
    titleKey: "training.lesson.bomb.title",
    descriptionKey: "training.lesson.bomb.description",
    hintKey: "training.lesson.bomb.hint",
    successKey: "training.lesson.bomb.success",
    objective: "bomb",
    item: "bomb",
    targets: Object.freeze([{ row: 4, col: 4 }]),
    pieces: Object.freeze([
      { row: 4, col: 3, player: "X" },
      { row: 4, col: 4, player: "O" },
      { row: 5, col: 5, player: "O" }
    ])
  })
]);

export function createTrainingBoard(lessonIndex) {
  const board = Array.from({ length: TRAINING_BOARD_SIZE }, () => Array(TRAINING_BOARD_SIZE).fill(""));
  for (const { row, col, player } of TRAINING_LESSONS[lessonIndex].pieces) board[row][col] = player;
  return board;
}
